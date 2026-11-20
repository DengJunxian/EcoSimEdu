import type { AuctionRun } from "../../auction.ts";
import { canonicalBrowserJson, sha256Text } from "../../browser-result.ts";
import type { CasePackage } from "../../domain-contracts.ts";
import { bankEventDeltas } from "../../run-evidence.ts";
import type { SvbRun } from "../../svb.ts";

const bookMetrics = ["best_bid", "best_ask", "volume", "surplus", "platform_cash"] as const;
const bankMetrics = ["cash", "requested", "paid", "queued", "equity", "price", "sold", "deposits", "borrowing"] as const;

export async function auctionExplanationSource(run: AuctionRun, seq: number, course: CasePackage) {
  if (run.frames[seq]?.record.seq !== seq) throw new Error("Order evidence unavailable");
  const rows = run.frames.slice(0, seq + 1).map(frame =>
    [frame.record, frame.book, bookMetrics.map(key => frame.metrics[key])]);
  const data = ["auction-review/1", run.id, course.caseVersion, course.browserContentVersion, rows];
  return { run_id: run.id, seq, digest: await sha256Text(canonicalBrowserJson(data)) };
}

export async function svbExplanationSource(run: SvbRun, seq: number, eventId: string, course: CasePackage) {
  const position = run.frames[seq]?.events.findIndex(event => event.id === eventId) ?? -1;
  if (position < 0) throw new Error("Bank transaction unavailable");
  const start = bankMetrics.map(key => run.frames[0].metrics[key]);
  const rows = run.frames.slice(1, seq + 1).flatMap(frame => {
    const events = frame.tick === seq ? frame.events.slice(0, position + 1) : frame.events;
    return events.map(event => {
      const changes = bankEventDeltas(frame, run.frames[frame.tick - 1], event);
      return [frame.tick, event.kind, event.actorId ?? null, bankMetrics.map(key => changes[key] ?? 0)];
    });
  });
  const data = ["svb-review/1", run.id, course.caseVersion, course.browserContentVersion, start, rows];
  return { run_id: run.id, seq, event_id: eventId, digest: await sha256Text(canonicalBrowserJson(data)) };
}
