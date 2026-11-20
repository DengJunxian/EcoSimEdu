import { courseById } from "./curriculum.ts";

const prefix = "ecosimedu:teaching:v1:";
export const reflectionOptions = {
  need_help: "我还需要核对因果链",
  can_explain: "我能指出支持论断的事件",
  can_apply: "我可以试着解释另一个情境",
};

type NoteKey = { caseId: string; reference: string; savedAt: string };
export type TeachingRecord = NoteKey & (
  | { kind: "forecast_exposure"; level: 1 | 2 | 3; original: string }
  | { kind: "self_assessment"; answer: keyof typeof reflectionOptions }
  | { kind: "mechanism_evidence"; eventTick: number; choiceTick: number }
  | { kind: "coach_advice"; advice: string; eventId: string; runId: string }
);

const key = (record: Pick<TeachingRecord, "caseId" | "reference" | "kind">) =>
  prefix + JSON.stringify([record.kind, record.caseId, record.reference]);

function valid(record: unknown): record is TeachingRecord {
  if (!record || typeof record !== "object") return false;
  const value = record as TeachingRecord;
  if (!Object.hasOwn(courseById, value.caseId) || typeof value.reference !== "string" ||
      !value.reference || value.reference.length > 400 || typeof value.savedAt !== "string" ||
      !Number.isFinite(Date.parse(value.savedAt))) return false;
  if (value.kind === "mechanism_evidence") return ["school_matching", "lemons_market", "information_cascade"].includes(value.caseId) &&
    Number.isSafeInteger(value.eventTick) && value.eventTick > 0 && Number.isSafeInteger(value.choiceTick) &&
    value.choiceTick >= 0 && value.choiceTick <= value.eventTick;
  if (value.kind === "self_assessment") return Object.hasOwn(reflectionOptions, value.answer);
  if (value.kind === "forecast_exposure") return [1, 2, 3].includes(value.level) &&
    typeof value.original === "string" && value.original.length <= 200;
  return value.kind === "coach_advice" && typeof value.advice === "string" && value.advice.length <= 1000 &&
    typeof value.runId === "string" && !!value.runId && value.runId.length <= 250 &&
    typeof value.eventId === "string" && !!value.eventId && value.eventId.length <= 80;
}

export function readTeaching<K extends TeachingRecord["kind"]>(storage: Storage, caseId: string, reference: string, kind: K) {
  try {
    const value: unknown = JSON.parse(storage.getItem(key({ kind, caseId, reference })) ?? "null");
    return valid(value) && value.caseId === caseId && value.reference === reference && value.kind === kind
      ? value as Extract<TeachingRecord, { kind: K }> : undefined;
  } catch { return undefined; }
}

export function saveTeaching(storage: Storage, record: TeachingRecord) {
  if (!valid(record)) throw new Error("学习反馈无法核对。");
  const id = key(record);
  if (record.kind === "forecast_exposure") {
    const previous = readTeaching(storage, record.caseId, record.reference, record.kind);
    if (previous && previous.level >= record.level) return;
  }
  storage.setItem(id, JSON.stringify(record));
}

export function exportTeachingRecords(storage: Storage) {
  return Object.keys(storage).filter(id => id.startsWith(prefix)).flatMap(id => {
    try {
      const raw = storage.getItem(id);
      const value: unknown = JSON.parse(raw ?? "null");
      return valid(value) && key(value) === id ? [value] : [];
    } catch { return []; }
  });
}

export function verifiedTeachingRecords(value: unknown) {
  if (!Array.isArray(value) || value.length > 10000 || !value.every(valid) ||
      new Set(value.map(key)).size !== value.length) throw new Error("学习反馈档案格式错误。");
  return new Map(value.map(record => [key(record), JSON.stringify(record)]));
}
