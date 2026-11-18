import { api } from "../contracts";
import { checkStudy, storageKey, type Course, type Event } from "../lesson-types";
import type { FieldFlagship, FlagshipView, SceneSelector, Tick } from "./flagship-types";
import type { ComparisonConditions } from "./inquiry";

export type SourceRef = {
  run_id: string; case_version: string; engine_version: string; result_hash: string;
  seq: number; tick: number; event_type: string; actor?: string;
};
export type PairRef = { base: SourceRef; branch: SourceRef; label: string; kind?: "initial_layout" };
type Response = { first: string; latest: string; original?: string };
export type FieldStudy = {
  case_id: FieldFlagship; content_version: string; stage: number; unlocked: number; action: string;
  runs: Record<string, string>; tick: number; revealed: number; pinned: string;
  answers: Record<string, Response>; confidence: string; originalConfidence?: string;
  forecasts: Record<string, string>; evidence: SourceRef[]; comparisons: PairRef[];
  records?: Record<string, string>;
  explanation: string; condition: string; updatedAt: number;
};

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const matchesPattern = (value: unknown, pattern: RegExp): value is string =>
  string(value) && pattern.test(value);

export function isSourceRef(value: unknown): value is SourceRef {
  return record(value) && matchesPattern(value.run_id, uuid) && matchesPattern(value.result_hash, hash) &&
    string(value.case_version) && string(value.engine_version) && number(value.seq) && number(value.tick) &&
    string(value.event_type) && (value.actor === undefined || string(value.actor));
}

export const fieldStudyKey = (caseId: FieldFlagship) => `civitas/${caseId}/lesson-v2`;

export function parseFieldStudy(caseId: FieldFlagship, saved: unknown): FieldStudy | null {
  if (!record(saved) || saved.case_id !== caseId || !string(saved.content_version) ||
      !number(saved.stage) || !number(saved.unlocked) || saved.stage > saved.unlocked || saved.unlocked > 6 ||
      !string(saved.action) || !number(saved.tick) || !number(saved.revealed) || saved.tick > saved.revealed ||
      !string(saved.pinned) || !record(saved.runs) || !Object.values(saved.runs).every(id => matchesPattern(id, uuid)) ||
      !record(saved.answers) || !Object.values(saved.answers).every(value =>
        record(value) && string(value.first) && string(value.latest) && (value.original === undefined || string(value.original))) ||
      !record(saved.forecasts) || !Object.values(saved.forecasts).every(string) ||
      (saved.records !== undefined && (!record(saved.records) || !Object.values(saved.records).every(string))) ||
      !string(saved.confidence) || (saved.originalConfidence !== undefined && !string(saved.originalConfidence)) ||
      !string(saved.explanation) || !string(saved.condition) || !number(saved.updatedAt) ||
      !Array.isArray(saved.evidence) || saved.evidence.length > 200 || !saved.evidence.every(isSourceRef) ||
      !Array.isArray(saved.comparisons) || saved.comparisons.length > 100 || !saved.comparisons.every(value =>
        record(value) && isSourceRef(value.base) && isSourceRef(value.branch) && string(value.label) &&
        (value.kind === undefined || caseId === "schelling_segregation" && value.kind === "initial_layout"))) {
    return null;
  }
  return saved as FieldStudy;
}

export function readFieldStudy(caseId: FieldFlagship, key = fieldStudyKey(caseId)) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return { study: null, bad: false };
    const study = parseFieldStudy(caseId, JSON.parse(raw));
    return { study, bad: study === null };
  } catch {
    return { study: null, bad: true };
  }
}

export function legacyProgress(course: Course) {
  try {
    const raw = localStorage.getItem(storageKey(course));
    return raw ? checkStudy(course, JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function getFieldView(runId: string, tick: Tick, review = false, signal?: AbortSignal) {
  const filter = new URLSearchParams({ tick: String(tick), mode: review ? "review" : "guided" });
  return api<FlagshipView>(`/runs/${encodeURIComponent(runId)}/classroom-view?${filter}`, undefined, signal);
}

export function eventActors(event: Event) {
  return event.actors ?? [];
}

export function eventMatch(event: FlagshipView["events"][number], selector: SceneSelector, view?: FlagshipView) {
  const metric = selector.metric_positive ? view?.series[event.tick]?.metrics[selector.metric_positive] : undefined;
  const list = selector.nonempty ? event[selector.nonempty] : undefined;
  return event.event_type === selector.event_type &&
    (!selector.actor_id || eventActors(event).includes(selector.actor_id)) &&
    selector.fields.every(field => Object.hasOwn(event, field)) &&
    Object.entries(selector.equals ?? {}).every(([key, value]) => event[key] === value) &&
    (!selector.nonempty || (Array.isArray(list) && list.length > 0)) &&
    (!selector.metric_positive || (typeof metric === "number" && metric > 0));
}

export function sourceRef(view: FlagshipView, event: Event, actor?: string): SourceRef {
  return {
    run_id: view.run_id, case_version: view.case_version, engine_version: view.engine_version,
    result_hash: view.result_hash, seq: event.seq, tick: event.tick, event_type: event.event_type, ...(actor ? { actor } : {}),
  };
}

export type Alignment = { axis_label: string; rows: {
  phase: "opening" | "checkpoint" | "ending"; checkpoint: number | null;
  baseline: { tick: number } | null; branch: { tick: number } | null;
}[] };
export const alignmentLabel = (data: Alignment, row: Alignment["rows"][number]) =>
  row.phase === "opening" ? "开局" : row.phase === "ending" ? "各自结束" : `${data.axis_label} ${row.checkpoint}`;

export async function verifyLayoutPair(pair: PairRef, baseline: string, signal?: AbortSignal) {
  if (pair.kind !== "initial_layout" || pair.base.run_id !== baseline) return false;
  const [left, right, alignment] = await Promise.all([
    getFieldView(pair.base.run_id, pair.base.tick, false, signal),
    getFieldView(pair.branch.run_id, pair.branch.tick, false, signal),
    api<Alignment & { conditions?: ComparisonConditions }>(
      `/runs/${pair.base.run_id}/compare/${pair.branch.run_id}`, undefined, signal),
  ]);
  const matches = (view: FlagshipView, ref: SourceRef) => {
    const event = view.events[ref.seq];
    return view.case_id === "schelling_segregation" && view.run_id === ref.run_id && view.tick === ref.tick &&
      view.result_hash === ref.result_hash && view.case_version === ref.case_version &&
      view.engine_version === ref.engine_version && event?.seq === ref.seq && event.tick === ref.tick &&
      event.event_type === ref.event_type && (!ref.actor || eventActors(event).includes(ref.actor));
  };
  const conditions = alignment.conditions;
  const treatment = conditions?.treatments.initial_layout;
  return matches(left, pair.base) && matches(right, pair.branch) && right.parent_run_id === left.run_id &&
    conditions?.class === "initial_treatment" && Object.keys(conditions.treatments).length === 1 &&
    treatment?.baseline === "seeded" && (treatment.branch === "mixed" || treatment.branch === "segregated") &&
    alignment.rows.some(row => row.baseline?.tick === pair.base.tick && row.branch?.tick === pair.branch.tick &&
      `初态对照 · ${alignmentLabel(alignment, row)}` === pair.label);
}
