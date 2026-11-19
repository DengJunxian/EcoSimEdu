import { courseById } from "./curriculum.ts";
import { legalChoice, nextStageReady, startLesson, type Lesson, type Session, type Trend } from "./lesson.ts";

const progressPrefix = "ecosimedu:progressive:progress:v1:";
const explanationPrefix = "ecosimedu:progressive:explanation:v1:";

export type CourseRef = { caseId: string; market?: "no-overlap" };

export function courseRef(query: URLSearchParams): CourseRef | undefined {
  const caseId = query.get("lesson");
  if (!caseId || caseId === "demo") return undefined;
  return { caseId, market: caseId === "double_auction" && query.get("market") === "no-overlap" ? "no-overlap" : undefined };
}

export function courseLink(course: CourseRef, extra?: Record<string, string>): string {
  const query = new URLSearchParams({ lesson: course.caseId, ...extra });
  if (course.market) query.set("market", course.market);
  return `?${query}`;
}

const courseKey = (course: CourseRef) => `${course.caseId}${course.market ? `|${course.market}` : ""}`;
const trend = (value: unknown): value is Trend => value === "up" || value === "down" || value === "same";
const index = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function readItem<T>(storage: Storage, key: string): T | undefined {
  try {
    return JSON.parse(storage.getItem(key) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}

export function validChoices(lesson: Lesson, value: unknown, complete = true): value is string[] {
  return Array.isArray(value) && (complete ? value.length === lesson.decisions.length : value.length <= lesson.decisions.length) &&
    value.every((choice, i) => typeof choice === "string" && legalChoice(lesson.decisions[i], choice));
}

function validPolicy(lesson: Lesson, value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= lesson.policy.min && value <= lesson.policy.max &&
    (value - lesson.policy.min) % (lesson.policy.step ?? 1) === 0;
}

type SavedProgress = Omit<Session, "run" | "comparison" | "playing"> & {
  course: CourseRef;
  updatedAt: number;
  runId?: string;
  comparisonId?: string;
};

export const stageNames = ["真实场景代入", "微观机制透视", "宏微观双屏联动", "反事实与制度实验"];

function validProgress(record: SavedProgress | undefined): record is SavedProgress {
  return !!record && typeof record.course?.caseId === "string" && index(record.updatedAt) &&
    index(record.stage) && record.stage >= 1 && record.stage <= 4 &&
    index(record.cursor) && index(record.revealed) && record.cursor <= record.revealed &&
    Array.isArray(record.choices) && record.choices.length > 0;
}

export function latestProgress(storage: Storage, courseExists: (caseId: string) => boolean) {
  return Object.keys(storage).filter(key => key.startsWith(progressPrefix)).map(key => readItem<SavedProgress>(storage, key))
    .filter(record => validProgress(record) && courseExists(record.course.caseId) &&
      (record.course.market === undefined || record.course.caseId === "double_auction" && record.course.market === "no-overlap"))
    .sort((a, b) => b!.updatedAt - a!.updatedAt)[0];
}

export function saveProgress(storage: Storage, course: CourseRef, session: Session) {
  if (!session.choices.length) return;
  const { run, comparison, playing: _playing, ...state } = session;
  const record: SavedProgress = { ...state, course, updatedAt: Date.now(), runId: run?.id, comparisonId: comparison?.run.id };
  storage.setItem(progressPrefix + courseKey(course), JSON.stringify(record));
}

export function resumeProgress(storage: Storage, course: CourseRef, lesson: Lesson): Session | undefined {
  const record = readItem<SavedProgress>(storage, progressPrefix + courseKey(course));
  if (!validProgress(record) || courseKey(record.course) !== courseKey(course) ||
    !validChoices(lesson, record.choices, record.stage > 1)) return undefined;
  const initial = startLesson(lesson);
  if (record.stage === 1) return { ...initial, choices: record.choices };

  try {
    const run = lesson.run({ seed: lesson.seed, choices: record.choices, policy: initial.policy });
    const frame = run.frames[record.cursor];
    if (run.id !== record.runId || !frame || !run.frames[record.revealed]) return undefined;
    const selected = frame.actors.find(actor => actor.id === record.selected)?.id;
    const focusedMetric = lesson.metrics.find(metric => metric.id === record.focusedMetric)?.id;
    const replay: Session = { ...initial, stage: record.stage, run, choices: record.choices, selected, focusedMetric,
      cursor: record.cursor, revealed: record.revealed };
    if (record.stage !== 4) return replay;
    if (!nextStageReady(lesson, { ...replay, stage: 3 }) || !validPolicy(lesson, record.policy)) return undefined;
    const prediction = record.policy !== initial.policy && trend(record.prediction) ? record.prediction : undefined;
    if (!record.comparisonId) return { ...replay, policy: record.policy, prediction };
    if (!prediction) return undefined;
    const branch = lesson.run({ seed: run.seed, choices: record.choices, policy: record.policy });
    if (branch.id !== record.comparisonId) return undefined;
    return { ...replay, policy: record.policy, prediction, comparison: { run: branch, policy: record.policy, prediction } };
  } catch {
    return undefined;
  }
}

export type Explanation = {
  baselineEvent: number;
  comparisonEvent: number;
  rule: string;
  calculation: string;
  comparison: string;
  hypothesis: string;
};

export type SavedExplanation = Explanation & {
  savedAt: string;
  choices: readonly string[];
  prediction: Trend;
  baselineId: string;
  comparisonId: string;
  policy?: number;
};

export type StudentNote = SavedExplanation & { id: string; course: CourseRef };

export const trendLabel = { up: "增加", same: "不变", down: "减少" };

function parseNote(value: SavedExplanation | undefined, id: string): StudentNote | undefined {
  if (!value || typeof value.baselineId !== "string" || typeof value.comparisonId !== "string" ||
    typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt)) ||
    !trend(value.prediction) || !index(value.baselineEvent) || !index(value.comparisonEvent) ||
    !Array.isArray(value.choices) || !value.choices.every(choice => typeof choice === "string") ||
    ![value.rule, value.calculation, value.comparison, value.hypothesis].every(text => typeof text === "string")) return undefined;
  const model = value.baselineId.split("/")[0];
  const caseId = model === "double-auction" ? "double_auction" : model === "svb" ? "svb_run" : model;
  const market = caseId === "double_auction" && value.baselineId.split("/")[3] === "boundary" ? "no-overlap" : undefined;
  return { ...value, id, course: { caseId, market } };
}

export function readNote(storage: Storage, id: string): StudentNote | undefined {
  return parseNote(readItem<SavedExplanation>(storage, explanationPrefix + id), id);
}

export function allNotes(storage: Storage, baselineId?: string, comparisonId?: string): StudentNote[] {
  return Object.keys(storage).filter(key => key.startsWith(explanationPrefix)).flatMap(key => {
    const note = readNote(storage, key.slice(explanationPrefix.length));
    return note && (!baselineId || note.baselineId === baselineId && note.comparisonId === comparisonId) ? [note] : [];
  }).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveNote(storage: Storage, note: SavedExplanation): string {
  const suffix = crypto.getRandomValues(new Uint32Array(3)).join("-");
  const id = `${note.baselineId}|${note.savedAt}|${suffix}`;
  storage.setItem(explanationPrefix + id, JSON.stringify(note));
  return id;
}

export function notesLink(id?: string) {
  return `?${new URLSearchParams(id ? { view: "notes", note: id } : { view: "notes" })}`;
}

export function sourceLink(note: StudentNote, side: "baseline" | "comparison") {
  return courseLink(note.course, { source: note.id, side });
}

export function sourceRun(lesson: Lesson, note: StudentNote, side: "baseline" | "comparison") {
  if (!validChoices(lesson, note.choices)) return undefined;
  const policy = side === "baseline" ? lesson.policy.baseline : note.policy ?? lesson.policy.max;
  if (!validPolicy(lesson, policy) || side === "comparison" && policy === lesson.policy.baseline) return undefined;
  try {
    const run = lesson.run({ seed: lesson.seed, choices: note.choices, policy });
    const tick = side === "baseline" ? note.baselineEvent : note.comparisonEvent;
    if (run.id === (side === "baseline" ? note.baselineId : note.comparisonId) && run.frames[tick]) return { run, tick };
  } catch {
    return undefined;
  }
}

const archiveKind = "ecosimedu-progressive-backup/v1";
const knownKey = (key: string) => key.startsWith(progressPrefix) || key.startsWith(explanationPrefix);

export function exportProgressArchive(storage: Storage) {
  const entries = Object.keys(storage).filter(knownKey).flatMap(key => {
    const raw = storage.getItem(key);
    return raw === null ? [] : [[key, raw]];
  });
  return { kind: archiveKind, entries };
}

export function restoreProgressArchive(storage: Storage, archive: unknown) {
  const badFormat = "请选择从四阶课堂导出的备份 JSON。";
  if (!archive || typeof archive !== "object" || !("kind" in archive) || archive.kind !== archiveKind ||
    !("entries" in archive) || !Array.isArray(archive.entries)) throw new Error(badFormat);

  const records = new Map<string, string>();
  for (const entry of archive.entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" ||
      typeof entry[1] !== "string" || !knownKey(entry[0]) || records.has(entry[0])) throw new Error(badFormat);
    const [key, raw] = entry as [string, string];
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error(badFormat); }
    if (key.startsWith(progressPrefix)) {
      if (!validProgress(value) || !Object.hasOwn(courseById, value.course.caseId) ||
        (value.course.market !== undefined && (value.course.caseId !== "double_auction" || value.course.market !== "no-overlap")) ||
        !value.choices.every(choice => typeof choice === "string") ||
        key !== progressPrefix + courseKey(value.course)) throw new Error(badFormat);
    } else {
      const id = key.slice(explanationPrefix.length);
      const note = id && parseNote(value, id);
      if (!note || !Object.hasOwn(courseById, note.course.caseId)) throw new Error(badFormat);
    }
    records.set(key, raw);
  }

  const result = { restored: 0, existing: 0, conflicts: 0, failed: 0 };
  for (const [key, raw] of records) {
    try {
      const current = storage.getItem(key);
      if (current === raw) result.existing++;
      else if (current !== null) result.conflicts++;
      else {
        storage.setItem(key, raw);
        result.restored++;
      }
    } catch {
      result.failed++;
    }
  }
  return result;
}
