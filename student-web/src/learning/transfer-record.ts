import { result, transact } from "./learner-repository";
import { getFieldView, isSourceRef, sourceRef, type SourceRef } from "./flagship-study";
import type { FlagshipView } from "./flagship-types";
import type { Exposure } from "./education-types";

export const transferCases = ["svb_run", "flash_crash"] as const;
export const dimensions = ["主体约束", "互动与传导", "系统指标", "边界与对照"] as const;
export const taskVersion = "svb-flash-v1";
const exposureId = JSON.stringify([transferCases[0], taskVersion]);

type Review = {
  reviewed_at: string;
  scores: number[];
  verdict: "pass" | "revise";
  comment: string;
};
export type TransferAttempt = {
  id: string;
  version: typeof taskVersion;
  submitted_at: string;
  exposure: "independent" | "assisted" | "repeated";
  source_refs: [SourceRef, SourceRef];
  answers: string[];
};
export type TransferRecord = {
  id: string; profile: string; origin: "local" | "imported"; attempt: TransferAttempt; reviews: Review[];
};
type ViewEvent = FlagshipView["events"][number];

export function transferEvent(view: FlagshipView, event: ViewEvent) {
  const bank = view.case_id === "svb_run";
  const metric = bank ? "cash" : "bid_depth";
  const before = view.series[event.tick - 1]?.metrics[metric];
  const after = view.series[event.tick]?.metrics[metric];
  if (view.origin !== "offline_simulation" || !transferCases.some(caseId => view.case_id === caseId) ||
      (bank ? event.event_type !== "payments" : !["trade", "cancel"].includes(event.event_type)) ||
      before == null || after == null || after >= before) return;
  return { ref: sourceRef(view, event), summary: event.summary, before, after };
}

export async function verifyTransfer(refs: TransferAttempt["source_refs"], signal?: AbortSignal) {
  return Promise.all(refs.map(async (ref, index) => {
    const view = await getFieldView(ref.run_id, ref.tick, false, signal);
    const event = view.events[ref.seq];
    const evidence = event && transferEvent(view, event);
    if (view.case_id !== transferCases[index] || !evidence ||
        !Object.entries(evidence.ref).every(([key, value]) => ref[key as keyof SourceRef] === value) || ref.actor !== undefined) {
      throw new Error("运行、事件或指标变化无法核对。请选择这门课的真实记录。");
    }
    return evidence;
  }));
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 800;
const scoresValid = (scores: unknown): scores is number[] =>
  Array.isArray(scores) && scores.length === dimensions.length && scores.every(n => Number.isInteger(n) && n >= 0 && n <= 2);

export function parseTransfer(value: unknown, profile: string): TransferRecord {
  if (!object(value) || !object(value.attempt) || !Array.isArray(value.reviews) || value.reviews.length > 50) {
    throw new Error("迁移作答格式错误。");
  }
  const a = value.attempt;
  if (a.version !== taskVersion || typeof a.id !== "string" ||
      !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(a.id) || !date(a.submitted_at) ||
      (a.exposure !== "independent" && a.exposure !== "assisted" && a.exposure !== "repeated") ||
      !Array.isArray(a.source_refs) || a.source_refs.length !== 2 || !a.source_refs.every(isSourceRef) ||
      !Array.isArray(a.answers) || a.answers.length !== dimensions.length || !a.answers.every(text)) {
    throw new Error("作答缺少版本、双来源或完整答案。");
  }
  const reviews = value.reviews.map((review: unknown): Review => {
    if (!object(review) || !date(review.reviewed_at) || !scoresValid(review.scores) || !text(review.comment) ||
        (review.verdict !== "pass" && review.verdict !== "revise")) throw new Error("复核记录格式错误。");
    return { reviewed_at: review.reviewed_at, scores: review.scores, verdict: review.verdict, comment: review.comment };
  });
  const source_refs = a.source_refs.map(ref => {
    const { run_id, case_version, engine_version, result_hash, seq, tick, event_type, actor } = ref as SourceRef;
    return { run_id, case_version, engine_version, result_hash, seq, tick, event_type, ...(actor === undefined ? {} : { actor }) };
  }) as TransferAttempt["source_refs"];
  return { id: JSON.stringify([profile, a.id]), profile, origin: value.origin === "local" ? "local" : "imported", attempt: {
    id: a.id, version: taskVersion, submitted_at: a.submitted_at, exposure: a.exposure, source_refs, answers: a.answers,
  }, reviews };
}

export function readTransfers(profile: string) {
  return transact(["transfers"], "readonly", async tx => {
    const entries = await result(tx.objectStore("transfers").getAll()) as TransferRecord[];
    return entries.filter(entry => entry.profile === profile).sort((a, b) => b.attempt.submitted_at.localeCompare(a.attempt.submitted_at));
  });
}

export function exposeTransferHint() {
  return transact(["exposures"], "readwrite", async tx => {
    const store = tx.objectStore("exposures");
    const exposure = await result(store.get(exposureId)) as Exposure | undefined;
    await result(store.put({ ...exposure, id: exposureId, answer_seen: !!exposure?.answer_seen,
      exemplar_seen: !!exposure?.exemplar_seen, prior_feedback_for_variant: !!exposure?.prior_feedback_for_variant,
      exposure_unknown: !!exposure?.exposure_unknown, max_hint_level: 1 }));
  });
}

export async function saveTransfer(profile: string, source_refs: TransferAttempt["source_refs"], answers: string[]) {
  await verifyTransfer(source_refs);
  return transact(["transfers", "exposures"], "readwrite", async tx => {
    const exposures = tx.objectStore("exposures");
    const prior = await result(exposures.get(exposureId)) as Exposure | undefined;
    const entry = parseTransfer({ origin: "local", attempt: {
      id: crypto.randomUUID(), version: taskVersion, submitted_at: new Date().toISOString(), source_refs, answers,
      exposure: prior?.prior_feedback_for_variant ? "repeated" :
        prior?.max_hint_level || prior?.answer_seen || prior?.exemplar_seen || prior?.exposure_unknown ? "assisted" : "independent",
    }, reviews: [] }, profile);
    await result(tx.objectStore("transfers").add(entry));
    await result(exposures.put({ ...prior, id: exposureId, max_hint_level: prior?.max_hint_level ?? 0,
      answer_seen: !!prior?.answer_seen, exemplar_seen: !!prior?.exemplar_seen,
      exposure_unknown: !!prior?.exposure_unknown, prior_feedback_for_variant: true }));
    return entry;
  });
}

export async function importTransfer(profile: string, value: unknown) {
  if (!object(value) || value.kind !== "ecosimedu-transfer") throw new Error("请选择迁移作答 JSON。");
  const entry = parseTransfer({ ...value, origin: "imported" }, profile);
  await verifyTransfer(entry.attempt.source_refs);
  return transact(["transfers"], "readwrite", async tx => {
    const store = tx.objectStore("transfers");
    const saved = await result(store.get(entry.id)) as TransferRecord | undefined;
    if (saved) {
      if (JSON.stringify(saved.attempt) !== JSON.stringify(entry.attempt)) throw new Error("同编号作答内容不同。");
      const known = new Set(saved.reviews.map(review => JSON.stringify(review)));
      const reviews = [...saved.reviews, ...entry.reviews.filter(review => !known.has(JSON.stringify(review)))]
        .sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
      const merged = parseTransfer({ ...saved, reviews }, profile);
      await result(store.put(merged));
      return merged;
    }
    await result(store.add(entry));
    return entry;
  });
}

export async function saveTransferReview(entry: TransferRecord, scores: number[], verdict: Review["verdict"], comment: string) {
  await verifyTransfer(entry.attempt.source_refs);
  return transact(["transfers"], "readwrite", async tx => {
    const store = tx.objectStore("transfers");
    const saved = await result(store.get(entry.id)) as TransferRecord | undefined;
    if (!saved || saved.profile !== entry.profile) throw new Error("请先保存或导入作答。");
    const review = { reviewed_at: new Date().toISOString(), scores, verdict, comment };
    await result(store.put(parseTransfer({ ...saved, reviews: [...saved.reviews, review] }, entry.profile)));
  });
}
