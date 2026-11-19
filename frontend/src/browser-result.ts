import type { AuctionRun } from "./auction.ts";
import type { ResultDigest } from "./domain-contracts.ts";
import type { Run } from "./lesson.ts";
import type { ModelRun } from "./models/record.ts";

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
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const value = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  return { algorithm: "sha256", scope: "browser-evidence/v1", value };
}
