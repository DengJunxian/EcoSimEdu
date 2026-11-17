import { api, type MarketEvent, type Provider, type Run, type Snapshot } from "../../contracts";
import lesson from "../../../../cases/double_auction/case.json";

export const auctionStudyKey = "civitas/double_auction/lesson-v2";
export const auctionStages = lesson.lessons.map(item => item.id);
export type Branch = "demand" | "fee";
export type Mode = "guided" | "review" | "explore";

export type AuctionEvidence = {
  kind: "trade" | "unfilled";
  run_id: string;
  case_version: string;
  engine_version: string;
  result_hash: string;
  seq: number;
  tick: number;
  actor_id: string;
  metric: "last_price" | "filled";
  unit: string;
  value: number;
};

export type AuctionView = {
  run_id: string;
  origin: Run["origin"];
  result_hash: string;
  case_version: string;
  engine_version: string;
  seed: number;
  bid: number;
  root_hash: string;
  initial_hash: string;
  intervention: Run["result"]["intervention"];
  tick: number;
  end: number | null;
  closed: boolean;
  round: number | null;
  frame: Snapshot & { platform_cash?: number };
  events: (MarketEvent & { round?: number })[];
  settlement: {
    buy: MarketEvent;
    sell: MarketEvent;
    maker_order_id: string;
    before: Snapshot["accounts"];
    value?: number;
    cost?: number;
    buyer_surplus?: number;
    seller_surplus?: number;
    platform_fee?: number;
  } | null;
  private_information: Pick<Run["result"], "supply" | "demand" | "metrics"> | null;
  evidence: AuctionEvidence | null;
  student_order: MarketEvent | null;
  student_trade: number | null;
  student_close: number | null;
};

export type Prediction = { answer: string; confidence: string; maxPayment: string };
type ComparisonNote = {
  branch: Branch; run_id: string; checkpoint: string; tick: number; baselineTick: number;
  resultHash: string; baselineHash: string; engineVersion: string; caseVersion: string;
};
export type AuctionStudy = {
  scene: string;
  updatedAt?: number;
  unlocked: number;
  bid: string;
  provider: Provider;
  runs: Partial<Record<"baseline" | Branch, string>>;
  tick: number;
  revealed: number;
  pinned: string;
  responses: Record<string, { first: string; latest: string }>;
  prediction: { first: Prediction; latest: Prediction } | null;
  forecasts: Record<Branch, string>;
  comparison: ComparisonNote | null;
  evidence: AuctionEvidence[];
  notes: { explanation: string; condition: string; selfReview: string };
};

export const emptyAuctionStudy: AuctionStudy = {
  scene: "intro", unlocked: 0, bid: String(lesson.preset_bid), provider: "rule", runs: {},
  tick: 0, revealed: 0, pinned: "B01", responses: {}, prediction: null,
  forecasts: { demand: "", fee: "" }, comparison: null, evidence: [],
  notes: { explanation: "", condition: "", selfReview: "" },
};

export function readAuctionStudy(): AuctionStudy | null {
  try {
    const raw = localStorage.getItem(auctionStudyKey);
    if (!raw) return null;
    const saved = JSON.parse(raw) as AuctionStudy;
    if (!saved || !auctionStages.includes(saved.scene) || !saved.runs || !saved.notes ||
        !Array.isArray(saved.evidence) || saved.evidence.length > 200 || saved.evidence.some(item =>
          !item || typeof item.run_id !== "string" || !Number.isSafeInteger(item.seq)) ||
        !Number.isInteger(saved.unlocked) ||
        saved.unlocked < auctionStages.indexOf(saved.scene) || saved.unlocked >= auctionStages.length ||
        !Number.isInteger(saved.tick) || saved.tick < 0 || !Number.isInteger(saved.revealed) ||
        saved.revealed < saved.tick || typeof saved.bid !== "string" ||
        !["rule", "replay"].includes(saved.provider) || !saved.responses || !saved.forecasts) return null;
    return saved;
  } catch {
    return null;
  }
}

export function auctionView(run: string, tick: number | "close", mode: Mode = "guided", explain = false) {
  return api<AuctionView>(`/runs/${encodeURIComponent(run)}/auction-view?tick=${tick}&mode=${mode}&explain=${explain}`);
}

export function sameEvidence(saved: AuctionEvidence, authoritative: AuctionEvidence | null) {
  return authoritative !== null &&
    (Object.keys(authoritative) as (keyof AuctionEvidence)[]).every(key => authoritative[key] === saved[key]);
}

export type Alignment = {
  rows: {
    phase: "opening" | "checkpoint" | "ending";
    checkpoint: number | null;
    baseline: { tick: number; metrics: Record<string, number | null> } | null;
    branch: { tick: number; metrics: Record<string, number | null> } | null;
  }[];
};

export function compareAuction(base: string, branch: string) {
  return api<Alignment>(`/runs/${encodeURIComponent(base)}/compare/${encodeURIComponent(branch)}`);
}

export const checkpointLabel = (row: Alignment["rows"][number]) =>
  row.phase === "opening" ? "开局" : row.phase === "ending" ? "收盘" : `第 ${(row.checkpoint ?? 0) + 1} 轮结束`;
