import published from "../../../../cases/visible-event-guides-v3.json" with { type: "json" };
import { sha256Text } from "../../browser-result.ts";
import type { CasePackage } from "../../domain-contracts.ts";
import type { Run } from "../../lesson.ts";
import type { ModelRun } from "../../models/record.ts";

const guides: Readonly<Record<string, {
  policy: string;
  metrics: Record<string, string>;
  events: Record<string, { label: string; policy_label?: string; facts?: Record<string, string> }>;
}>> = published;

function measure(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(measure);
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 1_000_000);
  if (value == null || typeof value === "string" || typeof value === "boolean") return value ?? null;
  throw new Error("Non-public classroom value");
}

export function supportsCourseEvent(run: Run | undefined, seq: number): run is ModelRun {
  if (!run || !("records" in run) || seq < 1) return false;
  const model = run as ModelRun;
  const event = model.records[seq];
  const guide = guides[model.caseId];
  return !!guide && (model.scenario === "baseline" || model.scenario === guide.policy) && event?.seq === seq &&
    Object.hasOwn(guide.events, event.event_type);
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(display).join("、") || "无";
  if (typeof value === "number") return String(Number(value.toFixed(6)));
  return String(value ?? "未定义");
}

export function courseEventEntry(run: ModelRun, seq: number) {
  const guide = guides[run.caseId];
  const record = run.records[seq];
  const spec = guide.events[record.event_type];
  const data = record.data as Record<string, unknown> | undefined;
  return {
    label: run.scenario === guide.policy ? spec.policy_label ?? spec.label : spec.label,
    facts: Object.entries(spec.facts ?? {}).map(([key, label]) => ({ label, value: display(data?.[key]) })),
    readings: Object.entries(guide.metrics).map(([key, label]) => ({
      label, before: display(run.frames[seq - 1].metrics[key]), after: display(run.frames[seq].metrics[key]),
    })),
  };
}

export async function courseEventFocus(run: ModelRun, seq: number, course: CasePackage) {
  if (!supportsCourseEvent(run, seq) || run.caseId !== course.caseId)
    throw new Error("Classroom event unavailable");
  const guide = guides[run.caseId];
  const metrics = Object.keys(guide.metrics);
  const rows = run.records.slice(0, seq + 1).map(record => {
    const frame = run.frames[record.seq];
    const fields = Object.keys(guide.events[record.event_type]?.facts ?? {});
    const data = record.data as Record<string, unknown> | undefined;
    return [record.seq, record.event_type, metrics.map(key => measure(frame.metrics[key])),
      fields.map(key => measure(data?.[key]))];
  });
  const proof = ["course-event/1", run.id, course.caseVersion, course.browserContentVersion, rows];
  return { stage: 3 as const, perspective: "system" as const, case_id: course.caseId, run_id: run.id,
    case_version: course.caseVersion, content_version: course.browserContentVersion,
    event_seq: seq, digest: await sha256Text(JSON.stringify(proof)) };
}
