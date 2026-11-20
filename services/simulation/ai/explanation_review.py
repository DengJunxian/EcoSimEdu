"""Validate exact sources before asking a model to choose a rubric question."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..domain import case_packages
from . import auction_review, schelling_review, svb_review
from .schelling_tutor import ClassroomVersion


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    run_id: str = Field(max_length=100)
    seq: int = Field(ge=0, le=1000)
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    event_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]{0,3}/[1-9][0-9]{0,3}$")


Excerpt = Annotated[str, Field(min_length=1, max_length=160)]


class Explanation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    claim: Excerpt
    rule: Excerpt
    calculation: Excerpt
    comparison: Excerpt
    hypothesis: Excerpt
    alternative: Excerpt | None = None


class ReviewRequest(ClassroomVersion):
    confirm: Literal[True]
    case_id: Literal["schelling_segregation", "svb_run", "double_auction"] = "schelling_segregation"
    baseline: Source
    comparison: Source
    explanation: Explanation


REVIEWERS = {"schelling_segregation": schelling_review, "svb_run": svb_review, "double_auction": auction_review}


def evidence(query):
    package = case_packages()[query.case_id]
    if (query.case_version, query.content_version) != (package.caseVersion, package.browserContentVersion):
        return None
    reviewer = REVIEWERS[query.case_id]
    pair = reviewer.evidence(query)
    if pair is None:
        return None
    return {"anchor": query.model_dump(exclude={"confirm", "explanation"}, exclude_unset=True, exclude_none=True),
            "intent": "review_explanation", "blocks": dict(zip(("baseline", "comparison"), pair, strict=True)),
            "required": ("baseline", "comparison"), "questions": reviewer.QUESTIONS,
            "explanation": query.explanation.model_dump(exclude_none=True)}
