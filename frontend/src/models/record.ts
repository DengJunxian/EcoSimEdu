import type { Actor, Frame, LessonEvent, Run } from "../lesson.ts";

export type Metrics = Record<string, number | null>;
export type Facts = Record<string, string | number | boolean | null>;
export type Entity = Record<string, Facts>;
type Change = Pick<LessonEvent, "text" | "actorId" | "counterpartyId" | "deltas" | "focusMetrics" | "priorSignal" | "sourceEvents">;
type RecordOptions = {
  actors?: readonly string[];
  entities?: Entity;
  evidence?: readonly Change[];
  sourceEvents?: LessonEvent["sourceEvents"];
  data?: object;
  panelData?: object;
  panelEntities?: Entity;
  period?: number;
  signal?: LessonEvent["priorSignal"];
  turningPoint?: string;
  board?: Frame["board"];
};

const kinds = new Set(["trade", "cancel", "reject"]);
export const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
export const ids = (prefix: string, count: number, start = 1, digits = 2) =>
  Array.from({ length: count }, (_, i) => prefix + String(i + start).padStart(digits, "0"));
export const recordOf = <T>(keys: readonly string[], value: (key: string, index: number) => T): Record<string, T> =>
  Object.fromEntries(keys.map((key, index) => [key, value(key, index)]));
export const roundEven = (value: number) => {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + floor % 2 : Math.round(value);
};
export const shown = (value: number) => Number(value.toFixed(4));
export const showFacts = (facts: Facts) => Object.entries(facts)
  .map(([name, value]) => `${name} ${value === null ? "未定义" : typeof value === "number" ? shown(value) : value}`)
  .join(" · ");

type ModelFrame = Frame & { panel?: { entities: Entity; data?: object } };

export class Recorder {
  readonly frames: ModelFrame[] = [];
  readonly records: { seq: number; event_type: string; period: number; summary: string; actors: readonly string[]; data?: object }[] = [];
  readonly entities: Entity = {};

  readonly participants;
  readonly profiles;
  readonly domainPanel: boolean;

  constructor(participants: readonly string[], profiles: Readonly<Record<string, Omit<Actor, "id">>>,
    domainPanel = false) {
    this.domainPanel = domainPanel;
    this.participants = participants;
    this.profiles = profiles;
  }

  emit(kind: string, text: string, metrics: Metrics, options: RecordOptions = {}) {
    const tick = this.frames.length;
    const previous = this.frames.at(-1)?.metrics;
    const actorIds = options.actors?.filter(id => this.participants.includes(id)) ?? [];
    const deltas: Record<string, number> = {};
    const focusMetrics = [];
    for (const [key, value] of Object.entries(metrics)) {
      const prior = previous?.[key];
      if (tick && typeof value === "number" && value !== prior) {
        if (typeof prior === "number") deltas[key] = value - prior;
        focusMetrics.push(key);
      }
    }
    const evidence = options.evidence ?? [];
    for (const { deltas: part } of evidence) {
      for (const [id, value] of Object.entries(part)) {
        if (deltas[id] !== undefined && value !== undefined) deltas[id] -= value;
      }
    }
    const main: LessonEvent = {
      id: String(tick), text, actorId: actorIds[0], counterpartyId: actorIds[1],
      kind: kinds.has(kind) ? kind as LessonEvent["kind"] : undefined,
      deltas, focusMetrics, priorSignal: options.signal,
      participants: actorIds, sourceEvents: options.sourceEvents,
    };
    for (const [actor, facts] of Object.entries(options.entities ?? {})) this.entities[actor] = facts;
    const actors: Actor[] = this.participants.map(id => {
      const profile = this.profiles[id];
      const facts = this.entities[id];
      const event = evidence.find(entry => entry.actorId === id || entry.counterpartyId === id);
      return { id, ...profile, signal: facts ? showFacts(facts) : profile.signal,
        reason: event?.text ?? (actorIds.includes(id) ? text : profile.reason),
        priorSignal: event?.priorSignal ?? (actorIds.includes(id) ? options.signal : undefined) };
    });
    this.frames.push({
      tick, actors, metrics: { ...metrics }, events: [main, ...evidence.map((event, index) => ({ ...event, id: `${tick}.${index + 1}` }))],
      turningPoint: options.turningPoint, board: options.board,
      ...(this.domainPanel ? { panel: { entities: { ...this.entities, ...options.panelEntities }, data: options.panelData } } : {}),
    });
    this.records.push({ seq: tick, event_type: kind, period: options.period ?? tick, summary: text, actors: actorIds, data: options.data });
    return tick;
  }

  run(caseId: string, seed: number, action: string, scenario: string): ModelRun {
    return { id: `${caseId}/browser-v1|${seed}|${action}|${scenario}`, seed,
      frames: this.frames, records: this.records, caseId, action, scenario };
  }
}

export type ModelRun = Run & {
  frames: readonly ModelFrame[];
  caseId: string; action: string; scenario: string; intervention?: object; records: Recorder["records"];
};

export function profiles(participants: readonly string[], constraint: string, reason: string) {
  return recordOf(participants, (name, index) => ({
    name, marker: /^[A-Z][0-9]+$/.test(name) ? name : String(index + 1),
    state: "participant", constraint, reason, signal: "等待本场记录",
  }));
}
