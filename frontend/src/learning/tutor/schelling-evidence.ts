import { sha256Text } from "../../browser-result.ts";
import type { CasePackage } from "../../domain-contracts.ts";
import type { ModelRun } from "../../models/record.ts";

type Relocation = { actor_id: string; origin: number; destination: number; source: "student" | "rule";
  before: readonly number[]; after: readonly number[];
  changed_neighbors: readonly { actor: string; before: readonly number[]; after: readonly number[] }[] };

export function relocationAt(run: ModelRun, tick: number) {
  const event = run.records[tick];
  return event && (event.event_type === "student_move" || event.event_type === "move") ? event.data as Relocation : undefined;
}

function courseVersion(course: CasePackage) {
  return { case_version: course.caseVersion, content_version: course.browserContentVersion };
}

async function replayDigest(run: ModelRun, seq: number, course: CasePackage) {
  const prefix = run.frames.slice(0, seq + 1).map(({ tick, board, metrics }) => {
    const record = run.records[tick];
    if (!board || !record || record.seq !== tick) throw new Error("Replay frame unavailable");
    const move = relocationAt(run, tick);
    const values = [metrics.similarity, metrics.satisfied].map(value => {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Relocation metric unavailable");
      return Math.round(value * 100);
    });
    return [tick, record.event_type, record.actors, board.size, board.cells, board.marked, values,
      metrics.moves, metrics.remaining, move ? [move.actor_id, move.origin, move.destination, move.before, move.after,
        move.changed_neighbors.map(row => [row.actor, row.before, row.after])] : null];
  });
  const data = ["schelling-relocation/2", run.id, course.caseVersion, course.browserContentVersion, prefix];
  return sha256Text(JSON.stringify(data));
}

export async function relocationAnchor(run: ModelRun, seq: number, course: CasePackage) {
  if (!relocationAt(run, seq)) throw new Error("Relocation evidence unavailable");
  return { ...courseVersion(course), run_id: run.id, event_seq: seq, digest: await replayDigest(run, seq, course) };
}

export async function explanationSource(run: ModelRun, seq: number, course: CasePackage) {
  if (run.records[seq]?.seq !== seq) throw new Error("Explanation evidence unavailable");
  return { run_id: run.id, seq, digest: await replayDigest(run, seq, course) };
}

export function storyFocus(course: CasePackage) {
  return { ...courseVersion(course), stage: 1 as const, case_id: course.caseId };
}

export async function completionAnchor(run: ModelRun, course: CasePackage) {
  const close = run.records.at(-1);
  const terminal = (close?.data as { terminal?: string } | undefined)?.terminal;
  const threshold = (run.intervention as { threshold?: number } | undefined)?.threshold;
  if (close?.event_type !== "market_close" || !terminal || threshold === undefined)
    throw new Error("Completed replay unavailable");
  const prefix = await replayDigest(run, close.seq, course);
  return { run_id: run.id, seq: close.seq, digest: await sha256Text(JSON.stringify(["schelling-close/1", prefix, terminal, threshold])) };
}

export async function comparisonFocus(baseline: ModelRun, comparison: ModelRun, course: CasePackage) {
  const [start, end] = await Promise.all([completionAnchor(baseline, course), completionAnchor(comparison, course)]);
  return {
    ...courseVersion(course), stage: 4 as const,
    run_id: start.run_id, event_seq: start.seq, digest: start.digest,
    comparison_run_id: end.run_id, comparison_event_seq: end.seq, comparison_digest: end.digest,
  };
}

export type StudyFocus = ReturnType<typeof storyFocus> | Awaited<ReturnType<typeof comparisonFocus>> |
  (Awaited<ReturnType<typeof relocationAnchor>> & { stage: 2 | 3; perspective: "system" });
