import type { LiveResult } from "./live-panel";
import { ApiError, api } from "./contracts";

export type Scalar = number | string | boolean | null;
export type Grid = { size: number; cells: (string | null)[]; marked: number[] };
export type Frame = {
  tick: number;
  metrics: Record<string, number | null>;
  entities: Record<string, Record<string, Scalar>>;
  relations?: { from: string; to: string; label: string; origin_seq?: number }[];
  grid?: Grid;
};
export type Event = {
  seq: number; tick: number; event_type: string; summary: string; actors?: string[];
  buy_order_id?: string; sell_order_id?: string; order_id?: string; purpose?: string; time?: number;
  choice_if_private_a?: string;
  choice_if_private_b?: string;
  action_likelihood_given_a?: number;
  action_likelihood_given_b?: number;
  changed_neighbors?: { actor: string; before: [number, number]; after: [number, number] }[];
};
export type LessonRun = {
  run_id: string;
  case_id: string;
  case_version: string;
  scenario_id: string;
  action: string;
  seed: number;
  parent_run_id: string | null;
  execution_status: "completed" | "cancelled";
  origin: "offline_simulation" | "live_simulation";
  result_hash: string;
  result: {
    root_hash: string;
    initial_hash: string;
    intervention: Record<string, Scalar>;
    events: Event[];
    snapshots: Frame[];
    live?: LiveResult;
    metrics: Record<string, number | null>;
  };
};

export type Question = { prompt: string; options: Record<string, string> };
export type Course = {
  case_id: string; version: string; title: string; subtitle: string; identity: string; identity_label: string;
  minutes: string; intro: string; background: string; goals: string[]; seed: number;
  action: { label: string; default: string; options: { id: string; label: string }[] };
  metrics: { id: string; label: string; unit: string }[];
  lessons: { id: string; title: string; prompt: string }[];
  scenarios: { id: string; label: string; description: string; parameters: Record<string, Scalar> }[];
  minimum_evidence: number; evidence_types: string[]; checkpoint: { event_type: string; message: string };
  questions: {
    prediction: Question; explain: Question & { answer: string; feedback: string };
    transfer: { prompt: string; rubric: string };
  };
  glossary: { term: string; definition: string }[];
  sources: { id: string; title: string; url: string; supports: string }[];
};

export const noteKeys = ["observation", "mechanism", "condition", "transfer"] as const;
export const noteNames = { observation: "观察", mechanism: "机制解释", condition: "成立条件", transfer: "迁移" };
export type Study = {
  case_id: string; version: string; stage: number; unlocked: number;
  prediction: string; explanation: string; action: string;
  runs: Record<string, string>;
  selections: Record<string, { tick: number; actor: string }>;
  evidence: { run_id: string; seq: number }[];
  notes: Record<typeof noteKeys[number], string>;
  complete: boolean;
  reviewRequired?: boolean;
};
export const storageKey = (course: Course) => `civitas/${course.case_id}/${course.version}`;

export function newStudy(course: Course): Study {
  return { case_id: course.case_id, version: course.version, stage: 0, unlocked: 0,
    prediction: "", explanation: "", action: course.action.default, runs: {}, selections: {},
    evidence: [], notes: { observation: "", mechanism: "", condition: "", transfer: "" }, complete: false };
}

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const has = (record: object, key: string) => Object.hasOwn(record, key);
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function index(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
export function checkStudy(course: Course, raw: unknown): Study {
  if (!object(raw) || raw.case_id !== course.case_id || raw.version !== course.version) {
    throw new Error("学习记录的课程或版本不匹配。");
  }
  const { stage, unlocked, runs, selections, notes, evidence, prediction, explanation } = raw;
  if (!index(stage) || !index(unlocked) || stage > unlocked || unlocked >= course.lessons.length ||
      typeof prediction !== "string" || (prediction !== "" && !has(course.questions.prediction.options, prediction)) ||
      typeof explanation !== "string" || (explanation !== "" && !has(course.questions.explain.options, explanation)) ||
      !course.action.options.some(option => option.id === raw.action) || typeof raw.complete !== "boolean" ||
      (has(raw, "reviewRequired") && typeof raw.reviewRequired !== "boolean") ||
      !object(runs) || !Object.entries(runs).every(([key, id]) =>
        course.scenarios.some(scenario => scenario.id === key) && typeof id === "string" && uuid.test(id)) ||
      !object(selections) || !Object.entries(selections).every(([id, value]) =>
        Object.values(runs).includes(id) && object(value) && index(value.tick) &&
        typeof value.actor === "string" && value.actor.length <= 100) ||
      !object(notes) || !noteKeys.every(key => typeof notes[key] === "string" && notes[key].length <= 5000) ||
      !Array.isArray(evidence) || evidence.length > 200 || !evidence.every(item =>
        object(item) && Object.values(runs).includes(item.run_id) && index(item.seq))) {
    throw new Error("学习记录格式错误。");
  }
  if (new Set(evidence.map(e => `${e.run_id}/${e.seq}`)).size !== evidence.length ||
      (unlocked >= 2 && !prediction) || (unlocked >= 3 && !runs.baseline) ||
      (unlocked >= 5 && !explanation) ||
      (unlocked >= 6 && !course.scenarios.every(s => runs[s.id])) ||
      (raw.complete && (raw.reviewRequired || unlocked !== 6 || evidence.length < course.minimum_evidence ||
        !noteKeys.every(key => (notes[key] as string).trim())))) {
    throw new Error("学习记录缺少当前阶段的任务产出。");
  }
  return raw as Study;
}

export async function restoreRuns(course: Course, study: Study): Promise<Record<string, LessonRun>> {
  const received = await Promise.all(Object.entries(study.runs).map(async ([id, runId]) => {
    const run = await api<LessonRun>(`/runs/${runId}`);
    if (run.execution_status !== "completed" || run.case_id !== course.case_id ||
        run.case_version !== course.version || run.scenario_id !== id || run.seed !== course.seed) {
      throw new Error("学习记录中的运行无法核对。");
    }
    const bookmark = study.selections[runId];
    if (bookmark && (bookmark.tick >= run.result.snapshots.length ||
        (bookmark.actor && !has(run.result.snapshots[bookmark.tick].entities, bookmark.actor)))) {
      throw new Error("学习记录中的时间点或角色无法核对。");
    }
    return run;
  }));
  const baseline = received.find(run => run.scenario_id === "baseline");
  if (received.some(run => run !== baseline && (run.parent_run_id !== baseline?.run_id ||
      run.action !== baseline.action || run.result.root_hash !== baseline.result.root_hash))) {
    throw new Error("学习记录中的比较分支无法核对。");
  }
  if (study.evidence.some(item => {
    const event = received.find(run => run.run_id === item.run_id)?.result.events[item.seq];
    return !event || !course.evidence_types.includes(event.event_type);
  })) throw new Error("学习记录中的运行证据无法核对。");
  return Object.fromEntries(received.map(run => [run.scenario_id, run]));
}

export async function runLesson(course: Course, scenario: string, action: string, requestId: string, parent?: string) {
  const payload = { case_id: course.case_id, scenario_id: scenario, action, request_id: requestId,
    seed: course.seed, provider_kind: "rule", parent_run_id: parent ?? null };
  const created = await api<{ run_id: string; execution_status: string }>("/runs", payload);
  if (created.execution_status === "cancelled") throw new ApiError("RUN_ALREADY_TERMINAL", "这次运行已取消。可重新运行。");
  const result = await api<LessonRun>(`/runs/${created.run_id}/start`, {});
  if (result.case_id !== course.case_id || result.case_version !== course.version ||
      result.scenario_id !== scenario || result.seed !== course.seed || result.action !== action ||
      result.parent_run_id !== (parent ?? null) || result.execution_status !== "completed") {
    throw new Error("运行与当前课程版本或请求不匹配。请刷新后重试。");
  }
  return result;
}
