import type { Run } from "./lesson.ts";
import type { AuctionRun } from "./auction.ts";
import type { ModelRun } from "./models/record.ts";

export function runRecords(run: Run) {
  if ("records" in run) return (run as ModelRun).records;
  return run.frames.map(frame => {
    const original = (frame as AuctionRun["frames"][number]).record;
    return { seq: frame.tick, event_type: original?.event_type ?? "round", period: frame.tick,
      summary: frame.events.map(event => event.text).join(" ") || "开局状态",
      actors: frame.events.flatMap(event => event.actorId ? [event.actorId] : []), data: original };
  });
}

export function seedEvidence(run: Run, sequence: number) {
  const event = runRecords(run)[sequence];
  const frame = run.frames[sequence];
  if (!event || !frame) throw new Error("Unavailable evidence");
  return { runId: run.id, event, before: run.frames[sequence - 1]?.metrics ?? null, after: frame.metrics };
}
