"""Offer published review items for one scheduled outcome."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..learning_content import load_learning_package
from ..lessons import CATALOG


class Signal(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    result: Literal["correct", "incorrect"]
    used_hint: bool
    evidence: Literal["independent", "assisted", "repeated"]


class RecommendationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    confirm: Literal[True]
    case_id: str = Field(pattern=r"^[a-z_]{1,48}$")
    content_version: str = Field(max_length=40)
    outcome_id: str = Field(pattern=r"^[a-z_]{1,48}\.[1-3]$")
    signal: Signal


def evidence(query):
    if query.case_id not in CATALOG:
        return None
    pack = load_learning_package(query.case_id)
    if pack is None or pack["content_version"] != query.content_version:
        return None
    goal = next((goal for goal in pack["outcomes"] if goal["id"] == query.outcome_id), None)
    if goal is None:
        return None
    refs = {row["content_ref"] for row in pack["activities"]
            if row["kind"] == "review" and query.outcome_id in row["outcome_ids"]}
    questions = {item["id"]: item["prompt"] for item in pack["items"] if item["id"] in refs}
    if len(questions) < 2:
        return None
    signal = query.signal
    blocks = {
        "goal": {"text": goal["performance"], "event_seqs": []},
        "recent": {"text": f"Latest scored independent-task attempt: {signal.result}. Evidence class: "
                           f"{signal.evidence}. Hint used: {signal.used_hint}.", "event_seqs": []},
    }
    return {"anchor": query.model_dump(exclude={"confirm", "signal"}), "intent": "review_recommendation",
            "blocks": blocks, "required": ("goal", "recent"), "questions": questions}
