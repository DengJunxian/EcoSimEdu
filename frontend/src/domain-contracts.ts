import packages from "../../cases/case-packages-v1.json" with { type: "json" };

export type MetricRoles = {
  observation: string;
  comparison: string;
  statistic: "final" | "peak";
};

export type MetricDefinition = {
  id: string;
  label: string;
  unit: string;
  definition: string;
  undefinedReason: string;
};

export type Clock = { id: string; label: string };

export type CasePackage = Omit<(typeof packages)[number], "schemaVersion" | "identity" | "browserMetricRoles" | "archivedMetricRoles"> & {
  schemaVersion: 1;
  identity: "historical_event" | "academic_experiment" | "laboratory_experiment" | "theoretical_model" | "institutional_case";
  browserMetricRoles: MetricRoles;
  archivedMetricRoles: MetricRoles;
};

export const casePackages = new Map((packages as CasePackage[]).map(row => [row.caseId, row]));
export function casePackage(caseId: string) {
  const value = casePackages.get(caseId);
  if (!value) throw new Error(`CasePackage unavailable for ${caseId}`);
  return value;
}

export const browserEngineVersion = "browser-v1";

export type RunId = string;
export type EventId = string;
export type ActorId = string;
export type Versions = { case: string; engine: string | null; content: string | null };
export type ResultDigest = {
  algorithm: "sha256";
  scope: "browser-evidence/v1" | "stored-result/v1";
  value: string;
};

export type RunEnvelope = {
  schemaVersion: 1;
  runId: RunId;
  caseId: string;
  versions: Versions;
  inputs: Record<string, unknown>;
  seed: number;
  origin: string | null;
  status: string;
  resultDigest: ResultDigest | null;
  metrics: readonly MetricDefinition[];
  metricRoles: MetricRoles | null;
  clock: Clock | null;
};

export type EventEnvelope = {
  runId: RunId;
  eventId: EventId;
  sequence: number | null;
  frameTick: number | null;
  economicTime: { clockId: string; value: number } | null;
  actorIds: readonly ActorId[];
  kind: string;
  summary: string | null;
  record: object;
  sourceEvents: readonly { eventId: EventId; frameTick: number | null }[];
};

export type Evidence = {
  schemaVersion: 1;
  runId: RunId;
  caseId: string;
  versions: Versions;
  resultDigest: ResultDigest;
  scope: "archive" | "visible_prefix";
  asOf: number | null;
  event: EventEnvelope;
};

export type EvidencePointer = Pick<Evidence, "runId" | "caseId" | "versions" | "resultDigest"> & {
  eventId: EventId;
  frameTick: number;
};
