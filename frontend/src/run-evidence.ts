import { browserEngineVersion } from "./domain-contracts.ts";
import { browserResultDigest } from "./browser-result.ts";
import type { CasePackage, RunEnvelope, EventEnvelope, Evidence, EvidencePointer } from "./domain-contracts.ts";
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

export function browserEvents(run: Run, course: CasePackage, asOf = run.frames.length - 1): EventEnvelope[] {
  if (!Number.isSafeInteger(asOf) || asOf < 0 || !run.frames[asOf]) return [];
  const frames = run.frames.slice(0, asOf + 1);
  const sampled = new Map<string, number>();
  for (const frame of frames) {
    for (const event of frame.events) sampled.set(event.id, frame.tick);
  }

  if (course.caseId === "svb_run") {
    return frames.flatMap(frame => frame.events.map(event => ({
      runId: run.id, eventId: event.id, sequence: null, frameTick: frame.tick,
      economicTime: { clockId: course.clock.id, value: frame.tick },
      actorIds: event.actorId ? [event.actorId] : [],
      kind: event.kind ?? "unclassified", summary: event.text,
      record: event,
      sourceEvents: (event.observed ?? []).flatMap(ref => sampled.get(ref.eventId) === ref.tick && ref.tick <= frame.tick
        ? [{ eventId: ref.eventId, frameTick: ref.tick }] : []),
    })));
  }

  const records = (run as Partial<ModelRun>).records;
  const orderAnchors = new Map<string, { eventId: string; frameTick: number }>();
  return frames.flatMap(frame => {
    const modelEvent = records?.[frame.tick];
    const auctionEvent = (frame as AuctionRun["frames"][number]).record;
    const raw = modelEvent ?? auctionEvent;
    if (!raw || raw.seq !== frame.tick) return [];

    const period = modelEvent?.period ?? auctionEvent?.round;
    const explicit = modelEvent ? modelEvent.actors :
      [auctionEvent.actor_id, auctionEvent.buyer_id, auctionEvent.seller_id];
    const actorIds = Array.from(new Set([...explicit,
      ...frame.events.flatMap(event => [event.actorId, event.counterpartyId])].filter((id): id is string => !!id)));
    const sourceEvents = frame.events.flatMap(event => (event.sourceEvents ?? []).flatMap(ref => {
      const origin = frames[ref.tick]?.events[0];
      return origin && ref.tick < frame.tick ? [{ eventId: origin.id, frameTick: ref.tick }] : [];
    }));
    if (auctionEvent) {
      for (const orderId of [auctionEvent.buy_order_id, auctionEvent.sell_order_id]) {
        const anchor = orderId && orderAnchors.get(orderId);
        if (anchor) sourceEvents.push({ eventId: anchor.eventId, frameTick: anchor.frameTick });
      }
      if (auctionEvent.event_type === "order_submitted" && auctionEvent.order_id) {
        orderAnchors.set(auctionEvent.order_id, { eventId: String(raw.seq), frameTick: frame.tick });
      }
    }
    return [{
      runId: run.id, eventId: String(raw.seq), sequence: raw.seq, frameTick: frame.tick,
      economicTime: period === undefined ? null : { clockId: course.clock.id, value: period },
      actorIds, kind: raw.event_type, summary: frame.events[0]?.text ?? modelEvent?.summary ?? null, record: raw, sourceEvents,
    }];
  });
}

export async function browserEnvelope(run: Run, course: CasePackage, inputs: RunEnvelope["inputs"]): Promise<RunEnvelope> {
  return {
    schemaVersion: 1, runId: run.id, caseId: course.caseId,
    versions: { case: course.caseVersion, engine: browserEngineVersion, content: course.browserContentVersion },
    inputs, seed: run.seed, origin: "browser_rule_engine", status: "completed",
    resultDigest: await browserResultDigest(run), metrics: course.metrics,
    metricRoles: course.browserMetricRoles, clock: course.clock,
  };
}

export function browserEvidence(envelope: RunEnvelope, event: EventEnvelope, asOf: number): Evidence {
  if (!envelope.resultDigest || event.runId !== envelope.runId || !Number.isSafeInteger(asOf) ||
      event.frameTick === null || event.frameTick < 0 || event.frameTick > asOf) {
    throw new Error("Evidence is outside the recorded prefix");
  }
  return {
    schemaVersion: 1, runId: envelope.runId, caseId: envelope.caseId, versions: envelope.versions,
    resultDigest: envelope.resultDigest, scope: "visible_prefix", asOf, event,
  };
}

export function evidencePointer(evidence: Evidence): EvidencePointer {
  const { runId, caseId, versions, resultDigest, event } = evidence;
  if (event.frameTick === null) throw new Error("Unavailable source frame");
  return { runId, caseId, versions, resultDigest, eventId: event.eventId, frameTick: event.frameTick };
}
