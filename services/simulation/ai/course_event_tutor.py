"""Verify the small public projection used to explain a classroom event."""

import json
import re
from functools import lru_cache
from hashlib import sha256
from hmac import compare_digest
from math import floor
from unicodedata import normalize

from ..auction import ROOT
from ..lessons import load_case, simulate

VERSION = "course-event/1"
SCALE = 1_000_000


@lru_cache(maxsize=1)
def guides():
    return json.loads((ROOT / "cases/visible-event-guides-v3.json").read_text())


@lru_cache(maxsize=16)
def published_run(case_id, action, scenario):
    case = load_case(case_id)
    return simulate(case, scenario, case["seed"], action)


def measure(value):
    if isinstance(value, (list, tuple)):
        return [measure(entry) for entry in value]
    if type(value) in (int, float):
        return floor(value * SCALE + 0.5)
    if value is None or isinstance(value, (str, bool)):
        return value
    raise ValueError("Non-public classroom value")


def prefix_digest(case_id, run_id, versions, run, seq):
    guide = guides()[case_id]
    rows = []
    for event, frame in zip(run["events"][:seq + 1], run["snapshots"][:seq + 1], strict=True):
        kind = event["event_type"]
        fields = guide["events"].get(kind, {}).get("facts", {})
        rows.append([event["seq"], kind, [measure(frame["metrics"].get(key)) for key in guide["metrics"]],
                     [measure(event.get(key)) for key in fields]])
    wire = json.dumps([VERSION, run_id, *versions, rows], ensure_ascii=False, separators=(",", ":"))
    return sha256(wire.encode()).hexdigest()


def resolve(focus):
    if focus.stage != 3 or focus.case_id not in guides():
        return None
    case = load_case(focus.case_id)
    guide = guides()[focus.case_id]
    runs = {f"{focus.case_id}/browser-v1|{case['seed']}|{option['id']}|{scenario}": (option["id"], scenario)
            for option in case["action"]["options"] for scenario in ("baseline", guide["policy"])}
    source = runs.get(focus.run_id)
    if source is None:
        return None
    run = published_run(focus.case_id, *source)
    seq = focus.event_seq
    if seq >= len(run["events"]) or run["events"][seq]["event_type"] not in guide["events"]:
        return None
    proof = prefix_digest(focus.case_id, focus.run_id, (focus.case_version, focus.content_version), run, seq)
    return run if compare_digest(focus.digest, proof) else None


def display(value):
    if value is None:
        return "未定义"
    if isinstance(value, (list, tuple)):
        return "、".join(map(display, value)) or "无"
    if type(value) is float:
        return f"{value:.6f}".rstrip("0").rstrip(".")
    return str(value)


def question_intent(question, seq, labels):
    text = re.sub(r"\s+", "", normalize("NFKC", question or "")).rstrip("?!。")
    text = re.sub(rf"事件{seq}(?![0-9])", "本事件", text)
    text = re.sub(r"^(请问|请解释|请帮我)[,，:]?", "", text)
    text = re.sub(r"^(?:这一步|这一事件|当前事件|本事件|这个事件)(?:的)?[,，:]?", "", text)
    if text in {"为什么会发生", "为什么发生", "发生了什么", "用了什么规则", "依据什么规则",
                "怎么运作", "为什么会这样", "为什么"}:
        return "explain"
    if text in {"怎么回查", "怎么核对", "如何核对", "到哪里核对", "从哪里核对", "从哪条记录核对",
                "记录了什么", "在哪里看原记录", "怎样核对原事件"}:
        return "hint"
    metric = r"数据|读数|指标|" + "|".join(re.escape(normalize("NFKC", label).split("(")[0].replace(" ", ""))
                                            for label in labels)
    if re.fullmatch(rf"(?:前后(哪些|什么)(?:{metric})变了|前后(?:{metric})是什么|"
                    rf"(?:{metric})(?:前后)?(?:是|变了|变化了|增加了|减少了)?多少|"
                    rf"(?:{metric})(?:有变化吗|变了吗|如何变化|怎么变化|如何核对|怎样变化|是什么))", text):
        return "formula"
    return None


def materials(query, run):
    seq = query.event_seq
    guide = guides()[query.case_id]
    event = run["events"][seq]
    spec = guide["events"][event["event_type"]]
    policy = query.run_id.endswith(f"|{guide['policy']}")
    label = spec.get("policy_label", spec["label"]) if policy else spec["label"]
    rule = spec.get("policy_rule", spec["rule"]) if policy else spec["rule"]
    next_question = spec.get("policy_question", spec["question"]) if policy else spec["question"]
    intent = query.intent
    if intent == "question":
        topic = question_intent(query.question, seq, [*guide["metrics"].values(), *spec.get("facts", {}).values()])
        if topic is None:
            return None, {}, (), {"scope": f"可问事件 {seq} 的规则、怎么回查，或「这一步前后哪些读数变了？」"}
        intent = f"question:{topic}"
    before, after = (frame["metrics"] for frame in run["snapshots"][seq - 1:seq + 1])
    values = "、".join(f"{label} {display(before.get(key))} → {display(after.get(key))}"
                      for key, label in guide["metrics"].items())
    facts = "、".join(f"{label} {display(event.get(key))}" for key, label in spec.get("facts", {}).items())
    source = "政策组" if policy else "基线组"
    entry = f"{source}事件 {seq} · {label}。"
    if facts:
        entry += facts + "。"
    blocks = {
        "event": {"text": entry, "event_seqs": [seq]},
        "change": {"text": f"事件前后的读数为 {values}。", "event_seqs": [seq - 1, seq]},
        "rule": {"text": rule, "event_seqs": [seq]},
    }
    choices = {"explain": ("event", "change", "rule"), "hint": ("rule", "event", "change"),
               "formula": ("change", "event", "rule"), "question:explain": ("rule", "event", "change"),
               "question:hint": ("event", "change", "rule"), "question:formula": ("change", "event", "rule")}
    return intent, blocks, choices[intent], {"next": next_question}
