import type { AuctionRun } from "./auction.ts";
import type { ResultDigest } from "./domain-contracts.ts";
import type { Run } from "./lesson.ts";
import type { ModelRun } from "./models/record.ts";

export async function sha256Text(text: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

// The earlier demand comparison recorded the treatment sentinel as an event fee.
export function withLegacyDemandDeltas(run: Run): Run {
  if (!run.id.startsWith("double-auction/browser-v1/") || !run.id.endsWith("/demand")) return run;
  const auction = run as AuctionRun;
  return { ...auction, frames: auction.frames.map(frame => frame.record.event_type === "trade"
    ? { ...frame, events: frame.events.map(event => ({ ...event,
      deltas: { ...event.deltas, platform_cash: -2, participant_surplus: event.deltas.surplus! + 2 },
    })) } : frame) };
}

export async function browserResultDigest(run: Run): Promise<ResultDigest> {
  const evidence = {
    id: run.id,
    seed: run.seed,
    frames: run.frames.map(frame => ({
      tick: frame.tick, metrics: frame.metrics, actorIds: frame.actors.map(actor => actor.id),
      events: frame.events, equations: frame.equations,
      auctionEvent: (frame as AuctionRun["frames"][number]).record,
    })),
    records: (run as Partial<ModelRun>).records,
    orders: (run as Partial<AuctionRun>).quotes,
  };
  const canonical = JSON.stringify(evidence, (_key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite model value");
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
  return { algorithm: "sha256", scope: "browser-evidence/v1", value: await sha256Text(canonical) };
}
