"""Read-only case tutor. All answer text comes from course assets or a selected trace."""

from __future__ import annotations

import math
import re
import unicodedata

from .projection import frame_metrics, metric_registry

EVENT_NUMBER = re.compile(r"(?:事件|\btick)\s*#?\s*([+-]?[0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)
SYSTEM_REQUEST = re.compile(
    r"忽略(?:之前|以上|所有|系统|规则)|(?:执行|删除|修改|覆盖)(?:命令|运行|账本)|"
    r"系统提示词|密钥|(?:ignore|override)\s+(?:all|previous|system)|"
    r"\b(?:api[-_ ]?key|system prompt|password|bearer)\b", re.IGNORECASE,
)
TRACE_CUES = ("事件", "当前", "这一步", "这笔", "本轮", "本次", "本场", "运行数据", "发生了什么", "tick")
HISTORICAL_CUES = ("历史", "出处", "原始资料", "研究背景", "监管报告", "史实", "文献", "原报告")
SOURCE_NUMBER = re.compile(r"(?<![a-z0-9_-])s[0-9]{2,}(?:-[a-z0-9]+)*(?![a-z0-9_-])")


def _normalize(text):
    return unicodedata.normalize("NFKC", text).strip().casefold()


def _concept_reply(term):
    return _response("concept", term["definition"],
                     {"kind": "concept", "label": term["term"], "concept": term["term"]})


def _id_mentioned(identifier, question):
    return bool(re.search(rf"(?<![a-z0-9_-]){re.escape(_normalize(identifier))}(?![a-z0-9_-])", question))


def _response(kind, answer, *citations):
    return {"kind": kind, "answer": answer, "citations": list(citations)}


def _lesson_reply(case, step, answer=None):
    lesson = next(item for item in case["lessons"] if item["id"] == step)
    return _response("model", answer or lesson["prompt"],
                     {"kind": "lesson", "label": lesson["title"], "lesson_id": step})


def _source_reply(case, question):
    sources = case["sources"]
    if any(cue in question for cue in ("出处", "来源", "原文", "文献", "报告")):
        requested = set(SOURCE_NUMBER.findall(question))
        if requested - {_normalize(source["id"]) for source in sources}:
            return _response("insufficient", "当前课程没有登记所指定的来源。可在课程资料中核对来源编号。")
    matched = [source for source in sources
               if _id_mentioned(source["id"], question) or _normalize(source["title"]) in question]
    selected = matched or sources
    answer = "本课资料记录了这些来源的支持范围。" if matched else case["background"]
    return _response(
        "history", answer,
        *({"kind": "source", "label": source["title"], "url": source["url"],
           "supports": source["supports"], "source_id": source["id"]} for source in selected),
    )


def _event_citation(run, tick):
    return {"kind": "event", "label": f"查看事件 {tick}", "run_id": str(run["run_id"]), "tick": tick}


def _first_request_batch(run, events, tick):
    for index, event in enumerate(events[:tick + 1]):
        if event["event_type"] != "requests" or event["tick"] != index:
            continue
        people = sorted({item["person"] for item in event["requests"]})
        if people:
            suffix = "。同批申请的组内先后没有记录。" if len(people) > 1 else "。"
            return _response("observation", f"截至所选时点，最早的提款申请记录在事件 {index}。申请人为"
                             f'{"、".join(people)}{suffix}', _event_citation(run, index))
    return _response("insufficient", "截至所选时点，运行没有记录提款申请。")


def _observation(case, run, tick, descriptors, *, first_request=False, guided=False):
    if (run is None or run.get("case_id") != case["case_id"]
            or run.get("case_version") != case["version"] or not run.get("run_id")):
        return _response("insufficient", "请在本案例的运行面板选取一个观察点，再查询该事件和指标。")
    result = run.get("result", {})
    frames, events = result.get("snapshots", []), result.get("events", [])
    tick = len(frames) - 1 if tick is None else tick
    if (type(tick) is not int or not 0 <= tick < min(len(frames), len(events))
            or frames[tick]["tick"] != tick or events[tick]["tick"] != tick):
        return _response("insufficient", "本次运行在该时点没有可核查的事件和快照。")
    if first_request:
        return _first_request_batch(run, events, tick)
    event, frame = events[tick], frames[tick]
    if guided:
        if case["case_id"] == "double_auction":
            from .auction_view import project_auction

            view = project_auction(run, tick)
        else:
            from .flagship_view import project_flagship

            view = project_flagship(run, tick)
        event, frame = view["events"][-1], view["frame"]
    metrics = frame_metrics(frame)
    values = []
    for descriptor in descriptors:
        value = metrics.get(descriptor["id"])
        if type(value) in (int, float) and math.isfinite(value):
            values.append(f'{descriptor["label"]}为 {value} {descriptor["unit"]}')
        elif guided and descriptor["id"] not in metrics:
            values.append(f'{descriptor["label"]}在当前课堂视图未揭示')
        else:
            values.append(f'{descriptor["label"]}没有记录')
    summary = event.get("summary")
    if not summary and event["event_type"] == "trade":
        summary = f'{event["buyer_id"]} 与 {event["seller_id"]} 的订单完成撮合。'
    answer = "。".join(part for part in (summary and summary.rstrip("。"), "，".join(values)) if part)
    return _response("observation", f'本次教学实验的事件 {tick}。{answer}。',
                     _event_citation(run, tick))


def answer_tutor(case, question, run=None, tick=None, *, reveal_until=None):
    """Find a supported explanation, with exact stored evidence for observations."""
    question = _normalize(question)
    if not question or len(question) > 300 or SYSTEM_REQUEST.search(question):
        return _response("insufficient", "可查询本课概念、课程资料或当前运行的已记录事件。")
    if (case["case_id"] in {"flash_crash", "gamestop"}
            and any(cue in question for cue in ("实时行情", "真实股价", "真实成交价", "股票最新价"))
            and not any(cue in question for cue in ("实验", "模型", "模拟"))):
        return _response("insufficient", "本课运行记录为教学模拟，当前行情需要独立的行情来源。")
    about_trace = any(cue in question for cue in TRACE_CUES)
    if (any(cue in question for cue in HISTORICAL_CUES)
            or ("来源" in question and not about_trace)
            or any(_id_mentioned(source["id"], question) or _normalize(source["title"]) in question
                   for source in case["sources"])):
        return _source_reply(case, question)

    compact = "".join(question.split())
    glossary = sorted(case["glossary"], key=lambda item: -len(item["term"]))
    term = next((item for item in glossary if "".join(_normalize(item["term"]).split()) in compact), None)
    if term and any(cue in question for cue in ("什么是", "是什么意思", "含义", "定义")):
        return _concept_reply(term)

    registry = metric_registry(case)
    matched = [item for item in registry if "".join(_normalize(item["label"]).split()) in compact
               or _id_mentioned(item["id"], question)]
    selected_events = set(EVENT_NUMBER.findall(question))
    if len(selected_events) > 1 or any("." in number for number in selected_events):
        return _response("insufficient", "请输入一个整数事件编号，或在对照面板查看配对观察点。")
    first_request = (case["case_id"] == "svb_run"
                     and any(cue in question for cue in ("最先", "第一个", "首批"))
                     and any(cue in question for cue in ("提款", "取款"))
                     and any(cue in question for cue in ("谁", "哪些")))
    if matched or selected_events or about_trace or first_request:
        selected_tick = int(selected_events.pop()) if selected_events else tick
        if reveal_until is not None:
            selected_tick = reveal_until if selected_tick is None else selected_tick
            if selected_tick > reveal_until:
                return _response("insufficient", "引导播放尚未到达所查询的事件。可继续播放或查看全程。")
        return _observation(case, run, selected_tick, matched or registry, first_request=first_request,
                            guided=reveal_until is not None)

    if "反事实" in question or "对照" in question or "比较" in question:
        return _lesson_reply(case, "compare")
    if term:
        return _concept_reply(term)

    questions = case["questions"]
    if "复盘" in question or "解释题" in question or _normalize(questions["explain"]["prompt"]) in question:
        return _lesson_reply(case, "explain", questions["explain"]["feedback"])
    if "预测" in question or "提示" in question:
        return _lesson_reply(case, "predict", questions["prediction"]["prompt"])
    if "迁移" in question or "笔记" in question or "总结" in question:
        return _lesson_reply(case, "notebook", questions["transfer"]["rubric"])
    for scenario in case["scenarios"]:
        if _normalize(scenario["label"]) in question:
            return _lesson_reply(case, "compare", scenario["description"])
    return _response("insufficient", "课程资料没有直接支持这个问题。可以试试术语表中的概念，或询问一个具体运行事件。")
