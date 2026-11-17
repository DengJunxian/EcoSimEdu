import lesson from "../../cases/double_auction/case.json";
import type { ScenarioId, Run } from "./contracts";

export const studyKey = `civitas/${lesson.case_id}/${lesson.version}`;
export const fields = ["observation", "mechanism", "condition", "transfer"] as const;
export type NoteField = typeof fields[number];
export type Evidence = { run_id: string; seq: number };
export type Study = {
  version: string;
  case_id: string;
  stage: number;
  unlocked: number;
  prediction: string;
  explanation: string;
  bid: string;
  runs: Partial<Record<ScenarioId, string>>;
  selections: Record<string, { tick: number; actor: string }>;
  notes: Record<NoteField, string>;
  evidence: Evidence[];
  complete: boolean;
};
export const emptyStudy: Study = {
  version: lesson.version, case_id: lesson.case_id, stage: 0, unlocked: 0, prediction: "",
  explanation: "", bid: String(lesson.preset_bid), runs: {}, selections: {},
  notes: { observation: "", mechanism: "", condition: "", transfer: "" }, evidence: [], complete: false,
};
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const actorId = /^[BS](0[1-9]|10)$/;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validStage(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < lesson.lessons.length;
}
export function validateStudy(value: unknown): Study {
  if (!record(value) || value.case_id !== lesson.case_id || value.version !== lesson.version) {
    throw new Error("记录的案例或版本不匹配。");
  }
  const { stage, unlocked, runs, selections, notes, evidence } = value;
  if (!validStage(stage) || !validStage(unlocked) || stage > unlocked ||
      typeof value.prediction !== "string" || !["", "yes", "no", "unknown"].includes(value.prediction) ||
      typeof value.explanation !== "string" || !["", "yes", "no"].includes(value.explanation) ||
      typeof value.bid !== "string" || value.bid.length > 32 || typeof value.complete !== "boolean" ||
      !record(runs) || !Object.entries(runs).every(([key, id]) =>
        ["baseline", "demand", "fee"].includes(key) && typeof id === "string" && uuid.test(id)) ||
      !record(selections) || !Object.entries(selections).every(([id, selection]) => Object.values(runs).includes(id) &&
        record(selection) && typeof selection.tick === "number" && Number.isInteger(selection.tick) && selection.tick >= 0 &&
        typeof selection.actor === "string" && (selection.actor === "" || actorId.test(selection.actor))) ||
      !record(notes) || !fields.every(key => typeof notes[key] === "string" && notes[key].length <= 5000) ||
      !Array.isArray(evidence) || evidence.length > 200 || !evidence.every(item =>
        record(item) && Object.values(runs).includes(item.run_id) &&
        typeof item.seq === "number" && Number.isInteger(item.seq) && item.seq >= 0)) {
    throw new Error("学习记录格式错误。");
  }
  if (new Set(evidence.map(item => `${item.run_id}/${item.seq}`)).size !== evidence.length) {
    throw new Error("学习记录包含重复的成交证据。");
  }
  if ((unlocked >= 2 && !value.prediction) || (unlocked >= 3 && !runs.baseline) ||
      (unlocked >= 5 && !value.explanation) ||
      (unlocked >= 6 && !(runs.demand && runs.fee)) ||
      (value.complete && (unlocked !== 6 || evidence.length < lesson.minimum_evidence ||
        !fields.every(key => (notes[key] as string).trim())))) {
    throw new Error("学习记录缺少当前阶段的任务产出。");
  }
  return value as Study;
}
export function readStudy() {
  try {
    const saved = localStorage.getItem(studyKey);
    return saved ? { study: validateStudy(JSON.parse(saved)), error: "" } : { study: emptyStudy, error: "" };
  } catch {
    return { study: emptyStudy, error: "本地草稿版本或内容无效。可导入有效记录或重新开始。" };
  }
}
export function validateRuns(study: Study, runs: Run[]) {
  const byId = new Map(runs.map(run => [run.run_id, run]));
  const base = runs.find(run => run.scenario_id === "baseline");
  for (const [scenario, id] of Object.entries(study.runs)) {
    const run = byId.get(id);
    if (!run || run.case_id !== lesson.case_id || run.scenario_id !== scenario || run.case_version !== lesson.version ||
        run.execution_status !== "completed" ||
        (study.selections[id] && study.selections[id].tick >= run.result.snapshots.length) ||
        (scenario !== "baseline" && (run.parent_run_id !== base?.run_id ||
          run.result.root_hash !== base?.result.root_hash))) {
      throw new Error("学习记录中的运行或时间点无法核对。");
    }
  }
  for (const item of study.evidence) {
    const event = byId.get(item.run_id)?.result.events[item.seq];
    if (event?.event_type !== "trade") throw new Error("学习记录中的成交证据无法核对。");
  }
}
