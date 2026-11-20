"""Additive V2 domain contracts for completed browser and service results."""
from functools import lru_cache
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .auction import ROOT


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceReference(DomainModel):
    id: str
    title: str
    url: str
    locator: str
    support: str
    limits: str


class SourceRights(DomainModel):
    sourceId: str
    status: str
    detail: str
    evidenceUrl: str
    distribution: str


class HistoricalFact(DomainModel):
    text: str
    sourceIds: list[str]


class SyntheticPopulation(DomainModel):
    description: str
    count: int | None = None
    kind: Literal["synthetic"] = "synthetic"


class SourceData(DomainModel):
    sourceId: str
    acquisition: str
    version: str | None
    license_status: str
    distribution: str


class DataProvenance(DomainModel):
    resultKind: Literal["teaching_simulation"] = "teaching_simulation"
    originalSourceData: list[SourceData]


class MetricDefinition(DomainModel):
    id: str
    label: str
    unit: str
    definition: str
    undefinedReason: str


class MetricRoles(DomainModel):
    observation: str
    comparison: str
    statistic: Literal["final", "peak", "cumulative"]


class Clock(DomainModel):
    id: str
    label: str


class CasePackage(DomainModel):
    schemaVersion: Literal[1] = 1
    caseId: str
    caseVersion: str
    browserContentVersion: str
    learningContentVersion: str
    title: str
    identity: Literal["historical_event", "academic_experiment", "laboratory_experiment",
                      "theoretical_model", "institutional_case"]
    identityLabel: str
    background: str
    historicalFacts: list[HistoricalFact]
    sourceReferences: list[SourceReference]
    modelAssumptions: list[str]
    syntheticPopulation: SyntheticPopulation
    dataProvenance: DataProvenance
    rights: list[SourceRights]
    learningOutcomes: list[dict]
    metrics: list[MetricDefinition]
    browserMetricRoles: MetricRoles
    archivedMetricRoles: MetricRoles
    clock: Clock


class Versions(DomainModel):
    case: str
    engine: str | None
    content: str | None


class ResultDigest(DomainModel):
    algorithm: Literal["sha256"] = "sha256"
    scope: Literal["browser-evidence/v1", "stored-result/v1"]
    value: str = Field(pattern=r"^[a-f0-9]{64}$")


class RunEnvelope(DomainModel):
    schemaVersion: Literal[1] = 1
    runId: str
    caseId: str
    versions: Versions
    inputs: dict
    seed: int
    origin: str | None
    status: str
    resultDigest: ResultDigest | None
    metrics: list[MetricDefinition]
    metricRoles: MetricRoles | None
    clock: Clock | None


class EconomicTime(DomainModel):
    clockId: str
    value: int


class SourceEvent(DomainModel):
    eventId: str
    frameTick: int | None


class EventEnvelope(DomainModel):
    runId: str
    eventId: str
    sequence: int | None
    frameTick: int | None
    economicTime: EconomicTime | None
    actorIds: list[str]
    kind: str
    summary: str | None
    record: dict
    sourceEvents: list[SourceEvent] = Field(default_factory=list)


class Evidence(DomainModel):
    schemaVersion: Literal[1] = 1
    runId: str
    caseId: str
    versions: Versions
    resultDigest: ResultDigest
    scope: Literal["archive", "visible_prefix"]
    asOf: int | None = None
    event: EventEnvelope

    @model_validator(mode="after")
    def check_source(self):
        if self.event.runId != self.runId:
            raise ValueError("EVIDENCE_RUN_MISMATCH")
        if self.scope == "visible_prefix" and (
            self.asOf is None or self.asOf < 0 or self.event.frameTick is None or self.event.frameTick > self.asOf or
            any(ref.frameTick is None or ref.frameTick > self.asOf for ref in self.event.sourceEvents)
        ):
            raise ValueError("EVIDENCE_NOT_VISIBLE")
        return self


@lru_cache
def case_packages():
    source = ROOT / "cases/case-packages-v1.json"
    return {row["caseId"]: CasePackage.model_validate(row) for row in json.loads(source.read_text())}


def archived_envelope(run, definition, clock_definition, known_engines):
    package = case_packages()[run["case_id"]]
    engine = run.get("result", {}).get("engine_version")
    current = run["case_version"] == package.caseVersion and engine in known_engines
    clock = (definition.get("alignment") or clock_definition) if current else None
    digest = run.get("result_hash")
    return RunEnvelope(
        runId=run["run_id"], caseId=run["case_id"],
        versions=Versions(case=run["case_version"], engine=engine,
                          content=run.get("content_version")),
        inputs={key: run[key] for key in ("bid", "action", "scenario_id", "provider_kind", "parent_run_id",
                                          "parameter_patch", "effective_parameters", "weekly_orders", "round_contributions")
                if key in run},
        seed=run["seed"], origin=run.get("origin"), status=run["execution_status"],
        resultDigest=ResultDigest(scope="stored-result/v1", value=digest) if digest else None,
        metrics=package.metrics if current else [],
        metricRoles=package.archivedMetricRoles if current else None,
        clock=Clock(id=clock["field"], label=clock["axis_label"]) if clock else None,
    )


def archived_evidence(envelope, record, frame_tick, events):
    if envelope.resultDigest is None:
        raise ValueError("RUN_INTEGRITY_ERROR")
    clock = envelope.clock
    period = record.get(clock.id) if clock else None
    actor_ids = list(dict.fromkeys(record[field] for field in ("actor_id", "buyer_id", "seller_id", "sender_id", "recipient_id")
                                    if isinstance(record.get(field), str)))
    refs = []
    seq = record.get("origin_seq")
    if type(seq) is int and 0 <= seq < record["seq"] and events[seq]["seq"] == seq:
        refs.append(SourceEvent(eventId=str(seq), frameTick=events[seq].get("tick")))
    order_ids = {record[field] for field in ("buy_order_id", "sell_order_id") if isinstance(record.get(field), str)}
    if order_ids:
        for prior in events[:record["seq"]]:
            if prior.get("event_type") == "order_submitted" and prior.get("order_id") in order_ids:
                refs.append(SourceEvent(eventId=str(prior["seq"]), frameTick=prior.get("tick")))
    return Evidence(
        runId=envelope.runId, caseId=envelope.caseId, versions=envelope.versions,
        resultDigest=envelope.resultDigest, scope="archive",
        event=EventEnvelope(
            runId=envelope.runId, eventId=str(record["seq"]), sequence=record["seq"], frameTick=frame_tick,
            economicTime=EconomicTime(clockId=clock.id, value=period) if type(period) is int else None,
            actorIds=actor_ids, kind=record["event_type"], summary=record.get("summary"), record=record, sourceEvents=refs,
        ),
    )
