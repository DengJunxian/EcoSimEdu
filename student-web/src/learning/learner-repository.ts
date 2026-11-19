import { scheduleFromAttempt } from "./review-schedule";
import type { SourceRef } from "./flagship-study";
import { evaluate } from "./assessment";
import type { Activity, Attempt, Exposure, Item, LearningPackage, Response, SessionState } from "./education-types";

type Store = typeof stores[number];
const stores = ["profiles", "sessions", "attempts", "exposures", "evidence_cache", "experiments",
  "migration_backups", "explanations", "reviews", "recommendations", "archived_attempts", "transfers", "evidence_checks"] as const;
const emptyExposure: Exposure = {
  max_hint_level: 0, answer_seen: false, exemplar_seen: false, prior_feedback_for_variant: false, exposure_unknown: false,
};
const unknownExposures = new Set<string>();

export function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let connection: Promise<IDBDatabase> | undefined;

function open() {
  if (!connection) {
    const request = indexedDB.open("ecosimedu-learning", 4);
    request.onupgradeneeded = () => {
      for (const name of stores) {
        if (!request.result.objectStoreNames.contains(name)) {
          const store = request.result.createObjectStore(name, { keyPath: "id" });
          if (name === "attempts") store.createIndex("session", "session_id");
        }
      }
    };
    connection = result(request).then(db => {
      db.onversionchange = () => { db.close(); connection = undefined; };
      return db;
    }).catch(error => { connection = undefined; throw error; });
  }
  return connection;
}

export async function transact<T>(names: Store[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => T | Promise<T>) {
  const tx = (await open()).transaction(names, mode);
  const completed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("学习记录事务已中止"));
  });
  void completed.catch(() => undefined);
  try {
    const value = await action(tx);
    await completed;
    return value;
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction already ended. */ }
    await completed.catch(() => undefined);
    throw error;
  }
}

export async function profileId(demo: boolean) {
  return transact(["profiles"], "readwrite", async tx => {
    const profiles = tx.objectStore("profiles");
    const id = demo ? "demo" : "personal";
    const existing = await result(profiles.get(id)) as { id: string; profile: string } | undefined;
    if (existing) return existing.profile;
    const profile = crypto.randomUUID();
    await result(profiles.add({ id, profile }));
    return profile;
  });
}

export function emptySession(pack: LearningPackage, profile: string): SessionState {
  return {
    id: JSON.stringify([profile, pack.case_id, pack.content_version]), schema_version: 1, local_profile_id: profile,
    case_id: pack.case_id, content_version: pack.content_version, accessible_activity_ids: [],
    activity_states: {}, phase_cursor: {}, return_stack: [],
  };
}

export async function readSession(base: SessionState) {
  return transact(["sessions", "attempts"], "readonly", async tx => {
    const saved = await result(tx.objectStore("sessions").get(base.id)) as SessionState | undefined;
    const attempts = await result(tx.objectStore("attempts").index("session").getAll(base.id)) as Attempt[];
    return { session: saved ?? base, attempts: attempts.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)) };
  });
}

export async function changeSession(base: SessionState, change: (state: SessionState) => SessionState) {
  return transact(["sessions"], "readwrite", async tx => {
    const sessions = tx.objectStore("sessions");
    const state = change(await result(sessions.get(base.id)) as SessionState ?? base);
    await result(sessions.put(state));
    return state;
  });
}

function exposureKey(session: SessionState, item: Item) {
  // Help in a demo still exposes the variant to the same browser.
  return JSON.stringify([session.case_id, item.variant_id]);
}

export function markUnsavedExposure(session: SessionState, item: Item) {
  const id = exposureKey(session, item);
  unknownExposures.add(id);
  try { localStorage.setItem("civitas/exposure-unknown/" + id, "true"); } catch { /* Storage may be unavailable. */ }
}

async function readExposure(store: IDBObjectStore, id: string): Promise<Exposure> {
  let unknown = unknownExposures.has(id);
  try { unknown ||= localStorage.getItem("civitas/exposure-unknown/" + id) === "true"; } catch { unknown = true; }
  const saved = await result(store.get(id)) as Exposure | undefined;
  return { ...emptyExposure, ...saved, exposure_unknown: unknown || !!saved?.exposure_unknown };
}

export async function expose(session: SessionState, item: Item, kind: "hint" | "answer" | "example") {
  const id = exposureKey(session, item);
  await transact(["exposures"], "readwrite", async tx => {
    const exposures = tx.objectStore("exposures");
    const current = await readExposure(exposures, id);
    await result(exposures.put({
      ...current, id, max_hint_level: kind === "hint" ? Math.max(current.max_hint_level, 1) : current.max_hint_level,
      answer_seen: current.answer_seen || kind === "answer", exemplar_seen: current.exemplar_seen || kind === "example",
      solution_seen_at: current.solution_seen_at ?? (kind === "hint" ? undefined : new Date().toISOString()),
    }));
  });
}

export async function submitAttempt(
  base: SessionState, activity: Activity, item: Item, response: Response, presentedOrder: string[], reviewId?: string,
  sourceRefs: SourceRef[] = [], unknown = false, keepCurrent = false,
) {
  const id = exposureKey(base, item);
  return transact(["attempts", "exposures", "sessions", "reviews"], "readwrite", async tx => {
    const exposures = tx.objectStore("exposures");
    const recorded = await readExposure(exposures, id);
    const exposure = { ...recorded, exposure_unknown: recorded.exposure_unknown || unknown };
    const submitted_at = new Date().toISOString();
    const evaluation = evaluate(item, response);
    const attempt: Attempt = {
      id: crypto.randomUUID(), schema_version: 1, local_profile_id: base.local_profile_id, session_id: base.id,
      case_id: base.case_id, content_version: base.content_version, activity_id: activity.id, item_id: item.id,
      item_version: item.version, variant_id: item.variant_id, family_id: item.family_id, outcome_ids: item.outcome_ids,
      assessment_role: item.assessment_role, response, submitted_at, evaluation, exposure, source_refs: sourceRefs,
      presented_order: presentedOrder,
      evidence_class: exposure.prior_feedback_for_variant ? "repeated" :
        exposure.answer_seen || exposure.exemplar_seen || exposure.max_hint_level || exposure.exposure_unknown ? "assisted" : "independent",
    };
    const sessions = tx.objectStore("sessions");
    const current = await result(sessions.get(base.id)) as SessionState ?? base;
    const session: SessionState = { ...current,
      ...(activity.kind === "review" || unknown || keepCurrent ? {} : { current_activity_id: activity.id }),
      accessible_activity_ids: Array.from(new Set([...current.accessible_activity_ids, activity.id])),
      activity_states: { ...current.activity_states, [activity.id]: "submitted" } };
    await result(tx.objectStore("attempts").add(attempt));
    // The response and exposure to its feedback commit before the UI can show either.
    await result(exposures.put({ ...exposure, id, prior_feedback_for_variant: true, solution_seen_at:
      exposure.solution_seen_at ?? submitted_at }));
    await result(sessions.put(session));
    const reviews = tx.objectStore("reviews");
    if (reviewId) {
      const review = await result(reviews.get(reviewId));
      if (!review || review.status !== "scheduled" || review.profile !== base.local_profile_id ||
          !item.outcome_ids.includes(review.outcome_id) || review.content_version !== base.content_version) {
        throw new Error("复习安排已更新，请刷新。");
      }
      await result(reviews.put({ ...review, status: "completed" }));
    }
    for (const review of scheduleFromAttempt(attempt)) {
      if (!await result(reviews.getKey(review.id))) await result(reviews.add(review));
    }
    return { session, attempt };
  });
}
