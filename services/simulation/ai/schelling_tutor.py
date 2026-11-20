"""Verified evidence and structured teaching across the Schelling classroom."""

import json
from functools import lru_cache
from hashlib import sha256
from hmac import compare_digest, digest as hmac_digest
from secrets import token_bytes
from time import monotonic
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from .. import live_client
from ..auction import ROOT
from ..domain import case_packages
from ..emergence.schelling import MOVES, grid_metrics
from ..lessons import load_case, simulate
from . import course_event_tutor, schelling_questions

CASE_ID = "schelling_segregation"
ENGINE = "browser-v1"
METRICS = ("similarity", "satisfied")
REPLAY_VERSION = "schelling-relocation/2"
TUTOR_VERSION = "schelling-tutor/4"
GRANT_SECONDS = 90
_grant_key = token_bytes(32)


class ClassroomVersion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    case_version: str = Field(max_length=24)
    content_version: str = Field(max_length=40)


class StoryFocus(ClassroomVersion):
    stage: Literal[1]
    case_id: str = Field(pattern=r"^[a-z_]{1,48}$")


class ReplayFocus(ClassroomVersion):
    stage: Literal[2, 3]
    perspective: Literal["system"]
    run_id: str = Field(max_length=100)
    event_seq: int = Field(ge=1, le=1000)
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    case_id: str | None = Field(default=None, pattern=r"^[a-z_]{1,48}$")


class PairFocus(ClassroomVersion):
    stage: Literal[4]
    run_id: str = Field(max_length=100)
    event_seq: int = Field(ge=1, le=1000)
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    comparison_run_id: str = Field(max_length=100)
    comparison_event_seq: int = Field(ge=1, le=1000)
    comparison_digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class Ask(BaseModel):
    grant: str = Field(pattern=r"^[0-9]{1,12}\.[0-9a-f]{64}$")
    intent: Literal["explain", "hint", "formula", "question"]
    question: str | None = Field(default=None, min_length=1, max_length=160)
    confirm: Literal[True]


class StoryRequest(StoryFocus, Ask):
    pass


class ReplayRequest(ReplayFocus, Ask):
    pass


class PairRequest(PairFocus, Ask):
    pass


FOCUS = TypeAdapter(Annotated[StoryFocus | ReplayFocus | PairFocus, Field(discriminator="stage")])
REQUEST = TypeAdapter(Annotated[StoryRequest | ReplayRequest | PairRequest, Field(discriminator="stage")])
REQUEST_FIELDS = {"grant", "intent", "question", "confirm"}


def anchor(focus):
    return focus.model_dump(exclude=REQUEST_FIELDS, exclude_none=True)


@lru_cache(maxsize=1)
def case_package():
    cases = json.loads((ROOT / "cases/case-packages-v1.json").read_text())
    return next(case for case in cases if case["caseId"] == CASE_ID)


@lru_cache(maxsize=1)
def classroom_guides():
    return json.loads((ROOT / "cases/classroom-guides-v3.json").read_text())


def _block(text, *events):
    return {"text": text, "event_seqs": events}


@lru_cache(maxsize=8)
def classroom_replay(action, scenario="baseline"):
    case = load_case(CASE_ID)
    run_id = f"{CASE_ID}/{ENGINE}|{case['seed']}|{action}|{scenario}"
    return run_id, simulate(case, scenario, case["seed"], action)


def resolve_focus(focus: ReplayFocus):
    action = focus.run_id.split("|")[-2] if focus.run_id.count("|") == 3 else ""
    if action not in {"stay", "move"}:
        return None
    run_id, result = classroom_replay(action)
    seq = focus.event_seq
    if (focus.run_id != run_id or seq >= len(result["events"])
            or result["events"][seq]["event_type"] not in MOVES):
        return None
    return result


def replay_digest(run_id, result, seq):
    package = case_package()
    prefix = []
    for event, frame in zip(result["events"][:seq + 1], result["snapshots"][:seq + 1], strict=True):
        grid, metrics = frame["grid"], frame["metrics"]
        relocation = None
        if event["event_type"] in MOVES:
            relocation = [event["actor_id"], event["origin"], event["destination"], event["before"], event["after"],
                          [[row["actor"], row["before"], row["after"]] for row in event["changed_neighbors"]]]
        prefix.append([event["seq"], event["event_type"], event["actors"], grid["size"], grid["cells"], grid["marked"],
                       [round(metrics[name] * 100) for name in METRICS], metrics["moves"], metrics["remaining"], relocation])
    data = [REPLAY_VERSION, run_id, package["caseVersion"], package["browserContentVersion"], prefix]
    return sha256(json.dumps(data, separators=(",", ":")).encode()).hexdigest()


def completion_digest(run_id, result):
    event = result["events"][-1]
    data = ["schelling-close/1", replay_digest(run_id, result, event["seq"]), event["terminal"],
            result["intervention"]["threshold"]]
    return sha256(json.dumps(data, separators=(",", ":")).encode()).hexdigest()


def paired_runs(focus: PairFocus):
    action = focus.run_id.split("|")[-2] if focus.run_id.count("|") == 3 else ""
    scenario = focus.comparison_run_id.rsplit("|", 1)[-1]
    if action not in {"move", "stay"} or scenario not in {"zero", "higher", "boundary"}:
        return None
    baseline_id, baseline = classroom_replay(action)
    branch_id, branch = classroom_replay(action, scenario)
    if (focus.run_id != baseline_id or focus.comparison_run_id != branch_id
            or baseline["initial_hash"] != branch["initial_hash"]
            or any(run["events"][-1]["event_type"] != "market_close" for run in (baseline, branch))
            or focus.event_seq != baseline["events"][-1]["seq"]
            or focus.comparison_event_seq != branch["events"][-1]["seq"]):
        return None
    return baseline, branch


def _grant_signature(focus, origin, binding, expiry):
    data = [TUTOR_VERSION, origin, binding, anchor(focus), expiry]
    return hmac_digest(_grant_key, json.dumps(data, separators=(",", ":"), sort_keys=True).encode(), "sha256").hex()


def grant_scope(focus, origin, binding):
    case_id = (focus.case_id or CASE_ID) if isinstance(focus, (StoryFocus, ReplayFocus)) else CASE_ID
    if case_id != CASE_ID and case_id not in classroom_guides():
        return None
    package = case_packages()[case_id]
    if (focus.case_version, focus.content_version) != (package.caseVersion, package.browserContentVersion):
        return None
    if isinstance(focus, ReplayFocus):
        if focus.case_id is not None:
            if course_event_tutor.resolve(focus) is None:
                return None
        else:
            result = resolve_focus(focus)
            if result is None or not compare_digest(focus.digest, replay_digest(focus.run_id, result, focus.event_seq)):
                return None
    elif isinstance(focus, PairFocus):
        pair = paired_runs(focus)
        if pair is None or not all(compare_digest(proof, completion_digest(run_id, run))
                                   for proof, run_id, run in zip((focus.digest, focus.comparison_digest),
                                                                 (focus.run_id, focus.comparison_run_id), pair, strict=True)):
            return None
    expiry = int(monotonic()) + GRANT_SECONDS
    return f"{expiry}.{_grant_signature(focus, origin, binding, expiry)}"


def scope_valid(query, origin, binding):
    clock, signature = query.grant.split(".")
    expiry = int(clock)
    return monotonic() < expiry and compare_digest(signature, _grant_signature(query, origin, binding, expiry))


def reply_anchor(query):
    identity = anchor(query)
    if isinstance(query, ReplayRequest):
        identity["revealed_until"] = query.event_seq
    return identity


def _pack(query, intent, blocks, choices, questions):
    return {"anchor": reply_anchor(query), "intent": intent, "blocks": {key: blocks[key] for key in choices},
            "required": choices[:2], "questions": questions}


def _selection(query):
    if query.intent != "question":
        return query.intent
    if isinstance(query, StoryRequest):
        sources = ()
    elif isinstance(query, PairRequest):
        sources = (query.event_seq, query.comparison_event_seq)
    else:
        sources = (query.event_seq,)
    topic = schelling_questions.topic(query.stage, query.question, sources)
    return f"question:{topic}" if topic else None


def story_evidence(query: StoryRequest, intent):
    case = load_case(CASE_ID)
    threshold = next(row["parameters"]["threshold"] for row in case["scenarios"] if row["id"] == "baseline")
    blocks = {
        "setting": _block(case["background"] + "你的角色是居民 A001，可选择留在原地或搬入预留空位。"),
        "count": _block("数一数周围已经住人的格子，再数其中与你同组的住户。棋盘边缘按实际存在的邻格计算。"),
        "threshold": _block(f"用同组已占邻格数除以全部已占邻格数，再和 {threshold}% 的开局阈值比较。无已占邻格时按规则达标。"),
        "observe": _block("先在开局图上找到 A001 和预留位置。写下自己想观察的变化，开始回放后逐步核对。"),
    }
    options = {
        "explain": ("setting", "count", "threshold"),
        "hint": ("observe", "count"),
        "formula": ("count", "threshold"),
        "question:setting": ("setting", "observe"),
        "question:threshold": ("count", "threshold"),
        "question:observe": ("observe", "count"),
    }
    return _pack(query, intent, blocks, options[intent], {
        "denominator": "哪些格子应计入已占邻格的分母？",
        "opening": "开始前你想核对 A001 周围的哪项条件？",
    })


def course_briefing(query):
    case = load_case(query.case_id)
    package = case_packages()[query.case_id]
    guide = classroom_guides()[query.case_id]
    if query.intent == "question":
        return _pack(query, None, {}, (), {"scope": "可选择角色、观察线索或制度口径，查看已公布的课程材料。"})
    role = f"你的开局任务是「{case['action']['label']}」。{guide['starter']}"
    blocks = {"role": _block(role), "rule": _block("".join(package.modelAssumptions)),
              "observe": _block(guide["observation"]), "compare": _block(guide["comparison"])}
    choices = {"explain": ("role", "rule", "observe"), "hint": ("observe", "role"),
               "formula": ("rule", "compare")}
    return _pack(query, query.intent, blocks, choices[query.intent], {"checkpoint": guide["question"]})


def pair_evidence(query: PairRequest, intent):
    pair = paired_runs(query)
    if pair is None:
        return None
    baseline, branch = pair
    for run in pair:
        metrics = grid_metrics(run["snapshots"][-1], run["intervention"]["threshold"])
        if any(run["metrics"][name] != metrics.get(name) for name in METRICS):
            return None
    start, end = baseline["metrics"], branch["metrics"]
    threshold = branch["intervention"]["threshold"]
    terminal = {
        "blocked": "没有可行搬迁",
        "round_limit": "达到轮数上限",
        "all_satisfied": "全体居民达标",
    }
    sources = [
        {"side": "baseline", "run_id": query.run_id, "event_seq": query.event_seq},
        {"side": "comparison", "run_id": query.comparison_run_id, "event_seq": query.comparison_event_seq},
    ]

    def cite(text):
        return _block(text) | {"source_refs": sources}

    difference = (round(end["similarity"] * 100) - round(start["similarity"] * 100)) / 100
    blocks = {
        "controls": cite(f"本组对照使用课堂固定种子，两组从同一初始地图出发，保留 A001 的开局选择。改变的是最低同组邻居阈值，"
                         f"从 {baseline['intervention']['threshold']}% 调至 {threshold}%。"),
        "outcome": cite(f"期末同组邻接比例从 {start['similarity']:.2f}% 变为 {end['similarity']:.2f}%，"
                        f"干预组减基线为 {difference:+.2f} 个百分点；达标比例从 {start['satisfied']:.2f}% 变为 {end['satisfied']:.2f}%。"),
        "stop": cite(f"两组各自的停止条件为：基线{terminal[baseline['events'][-1]['terminal']]}、"
                     f"干预组{terminal[branch['events'][-1]['terminal']]}。比较的是两条规则运行各自的期末状态。"),
        "measure": cite("同组邻接比例以全图占用邻接边为分母。达标比例以住户为分母，两组分别使用各自的阈值。"),
        "inspect": cite("在两组各自的收尾记录中，先核对停止条件，再比较表中同一行的数值。最后回看自己的原预测。"),
    }
    options = {
        "explain": ("controls", "outcome", "stop"),
        "hint": ("controls", "inspect", "measure"),
        "formula": ("measure", "outcome", "stop"),
        "question:controls": ("controls", "inspect"),
        "question:outcome": ("outcome", "controls", "stop"),
        "question:stop": ("stop", "inspect"),
        "question:measure": ("measure", "outcome"),
        "question:inspect": ("inspect", "controls"),
    }
    return _pack(query, intent, blocks, options[intent], {
        "compare": "两组各用自己的阈值时，同组邻接比例和达标比例各回答什么问题？",
        "limits": "改用另一张开局地图后，你会怎样检查这一组差异是否重现？",
    })


def evidence(query):
    # The router validates the exact focus grant before assembling evidence.
    if isinstance(query, StoryRequest) and query.case_id != CASE_ID:
        return course_briefing(query)
    if isinstance(query, ReplayRequest) and query.case_id is not None:
        run = course_event_tutor.resolve(query)
        return _pack(query, *course_event_tutor.materials(query, run)) if run else None
    intent = _selection(query)
    if intent is None:
        return _pack(query, intent, {}, (), {"scope": schelling_questions.GUIDANCE[query.stage]})
    if isinstance(query, StoryRequest):
        return story_evidence(query, intent)
    if isinstance(query, PairRequest):
        return pair_evidence(query, intent)
    result = resolve_focus(query)
    if result is None:
        return None
    seq = query.event_seq
    event = result["events"][seq]
    start_frame, end_frame = result["snapshots"][seq - 1:seq + 1]
    threshold = result["intervention"]["threshold"]
    for frame in (start_frame, end_frame):
        recomputed = grid_metrics(frame, threshold)
        if any(frame["metrics"][metric] != recomputed.get(metric) for metric in METRICS):
            return None
    start, end = start_frame["metrics"], end_frame["metrics"]

    before, after = event["before"], event["after"]
    mover = event["actor_id"]
    local = _block(f"{mover} 的同组已占邻格，从 {before[0]}/{before[1]} 变为 {after[0]}/{after[1]}。", seq - 1, seq)
    neighbors = _block(f"搬迁改变了原址和新址的占用状态。事件记录了两处周围 {len(event['changed_neighbors'])} 户的邻域前后值。",
                       seq)
    system = _block(f"全图同组邻接比例从 {start['similarity']}% 变为 {end['similarity']}%，"
                    f"居民达标比例从 {start['satisfied']}% 变为 {end['satisfied']}%。", seq - 1, seq)
    rule = _block(f"{mover} 在原址低于 {threshold}% 阈值，迁入了满足阈值的可用空格。"
                  if event["event_type"] == "move" else f"{mover} 依照学生的开局决定迁入预留空格。", seq)
    blocks = {
        "local": local, "neighbors": neighbors, "rule": rule, "system": system,
        "formula": _block("用同组占用邻接对数除以全部占用邻接对数。每条邻接边计一次。"
                          "达标比例则用达到阈值的户数除以总户数。", seq - 1, seq),
        "places": _block("在网格上找出原址和新址。圈出两处周围仍有居民的格子。", seq),
        "count": _block("选一户邻居，分别用前后两帧列出它的同组邻居和所有已占邻居。", seq - 1, seq),
        "check": _block("先核对分母。一个空格在搬迁后有人住，周围居民的已占邻格数量可能改变。", seq),
    }
    options = {
        "explain": ("local", "neighbors", "rule", "system"),
        "hint": ("places", "count", "check"),
        "formula": ("formula", "system", "local"),
        "question:cause": ("rule", "local"),
        "question:impact": ("neighbors", "local", "system"),
        "question:system": ("system", "formula"),
        "question:formula": ("formula", "system"),
        "question:hint": ("places", "count", "check"),
    }
    questions = {
        "vacancy": "新址附近有一户居民时，它的已占邻居分母可能怎样变化？",
        "overlap": "同时靠近原址和新址的居民，在前后两帧会数到哪些邻居？",
    }
    if intent not in {"hint", "question:hint"}:
        questions["compare"] = "用哪两项指标可以分别描述空间分布与住户是否达标？"
    return _pack(query, intent, blocks, options[intent], questions)


def render(pack, selection=None, *, reason=None, usage=None):
    steps = pack["required"]
    question = next(iter(pack["questions"]))
    mode = "author"
    if selection is not None:
        proposed = selection.get("steps")
        proposed_question = selection.get("question")
        if (set(selection) == {"steps", "question"}
                and isinstance(proposed, list) and len(steps) <= len(proposed) <= 3
                and all(isinstance(step, str) and step in pack["blocks"] for step in proposed)
                and len(set(proposed)) == len(proposed) and set(steps) <= set(proposed)
                and isinstance(proposed_question, str) and proposed_question in pack["questions"]):
            steps, question, mode = proposed, proposed_question, "ai"
        else:
            reason = "invalid_model_output"
    return {"version": TUTOR_VERSION, "anchor": pack["anchor"], "mode": mode, "reason": reason,
            "steps": [pack["blocks"][key] for key in steps], "question": pack["questions"][question], "usage": usage,
            **({"item_id": question} if pack["intent"] == "review_recommendation" else {})}


def teach(profile, key, pack):
    observation = {name: pack[name] for name in ("intent", "blocks", "questions", "required")}
    if "explanation" in pack:
        observation["explanation"] = pack["explanation"]
    report = live_client.compose_lesson(profile, key, observation)
    return render(pack, report.get("selection"), reason=report["reason"], usage=report["usage"])
