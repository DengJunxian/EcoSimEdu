"""Versioned source references shared with existing learning records."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, NonNegativeInt, model_validator


ResultHash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
ClaimKind = Literal["accounting_identity", "model_rule", "paired_difference", "interpretive_hypothesis"]
Perspective = Literal["role", "system"]


class SourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    case_version: str
    engine_version: str
    result_hash: ResultHash
    seq: NonNegativeInt
    tick: NonNegativeInt
    event_type: str
    actor: str | None = None


class Focus(BaseModel):
    event_seq: NonNegativeInt
    metric_id: str
    clock: str
    economic_time: int | None


class TraceNode(BaseModel):
    id: str
    kind: Literal["actor_state", "event", "relation", "group_metric", "system_metric", "rule"]
    label: str
    actor_id: str | None = None
    metric_id: str | None = None
    value: float | None = None
    unit: str | None = None
    source_refs: list[SourceRef] = Field(min_length=1)


class TraceEdge(BaseModel):
    source: str
    target: str
    kind: ClaimKind | Literal["observed_transition"]
    label: str
    source_refs: list[SourceRef] = Field(min_length=1)


class EmergenceTrace(BaseModel):
    schema_version: Literal[1] = 1
    case_id: str
    run_id: UUID
    result_hash: ResultHash
    as_of_seq: NonNegativeInt
    perspective: Perspective
    reveal_scope: Literal["visible_prefix"] = "visible_prefix"
    focus: Focus
    evidence_level: Literal["exact_identity", "rule_trace", "partial", "hypothesis"]
    nodes: list[TraceNode]
    edges: list[TraceEdge]
    notes: list[str]

    @model_validator(mode="after")
    def bound_evidence(self):
        if self.focus.event_seq > self.as_of_seq:
            raise ValueError("FOCUS_NOT_VISIBLE")
        for item in (*self.nodes, *self.edges):
            for ref in item.source_refs:
                if (ref.run_id != self.run_id or ref.result_hash != self.result_hash
                        or ref.seq > self.as_of_seq):
                    raise ValueError("SOURCE_NOT_VISIBLE")
        return self


def source_ref(run, event, actor=None):
    return SourceRef(run_id=run["run_id"], case_version=run["case_version"],
                     engine_version=run["result"]["engine_version"], result_hash=run["result_hash"],
                     seq=event["seq"], tick=event["tick"], event_type=event["event_type"], actor=actor)
