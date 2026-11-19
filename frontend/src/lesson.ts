import type { ActorId, CasePackage, EventId, MetricRoles, RunId } from "./domain-contracts.ts";
import type { ObservationPerspective } from "../../content/microscope.ts";
import { microscopeRole, type TraceFocus } from "./microscope.ts";

export type Stage = 1 | 2 | 3 | 4;
export type Trend = "down" | "same" | "up";

type PriorSignal = { metricId: string; tick: number; value: number };

export type Actor = {
  id: ActorId;
  name: string;
  marker: string;
  state: string;
  constraint: string;
  signal: string;
  reason: string;
  nextDecision?: string;
  priorSignal?: PriorSignal;
};

export type Metric = {
  id: string;
  label: string;
  unit: string;
  color: string;
};

export type LessonEvent = {
  id: EventId;
  actorId?: string;
  counterpartyId?: string;
  focusMetrics?: readonly string[];
  sourceEvents?: readonly { tick: number; label: string }[];
  participants?: readonly string[];
  text: string;
  kind?: "request" | "payment" | "support" | "sale" | "revaluation" | "trade" | "quote" | "cancel" | "reject";
  deltas: Readonly<Partial<Record<string, number>>>;
  priorSignal?: PriorSignal;
  observed?: readonly { actorId: string; tick: number; eventId: string }[];
};

export type Frame = {
  tick: number;
  actors: readonly Actor[];
  metrics: Readonly<Record<string, number | null>>;
  events: readonly LessonEvent[];
  turningPoint?: string;
  equations?: readonly string[];
  board?: { size: number; cells: readonly (string | null)[]; marked: readonly number[] };
};

export type Run = {
  id: RunId;
  seed: number;
  frames: readonly Frame[];
};

type Choice = { id: string; label: string; response: string };
type Decision = { prompt: string } & ({ options: readonly Choice[] } |
  { amount: { label: string; min: number; max: number; suggested: number; unit: string } });

export function legalChoice(decision: Decision, value: string): boolean {
  if ("options" in decision) return decision.options.some(option => option.id === value);
  const amount = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(amount) &&
    amount >= decision.amount.min && amount <= decision.amount.max;
}

export type Lesson = {
  title: string;
  role: { title: string; perspective: string; facts: readonly { label: string; value: string }[];
    timeline: readonly { label: string; highlighted?: boolean }[] };
  populationTitle: string;
  source: { kind: "illustrative" | CasePackage["identity"]; note: string;
    references?: readonly { title: string; url: string }[];
    timeline?: readonly { date: string; text: string; url: string }[] };
  casePackage?: CasePackage;
  metricRoles: MetricRoles;
  decisions: readonly Decision[];
  metrics: readonly [Metric, ...Metric[]];
  states: Readonly<Record<string, { label: string; color: string }>>;
  bridge?: { minTick: number; metrics: readonly string[]; rule: string;
    prompt?: string; closeLabel?: string; comparisonAxis?: string; };
  tickUnit?: "event";
  priceMetric?: string;
  rangeLookup?: boolean;
  originalId?: string;
  explanationPrompt?: string;
  policy: { label: string; min: number; max: number; baseline: number; unit: string;
    step?: number; describe?: string; labels?: Readonly<Record<number, string>>; project?: (run: Run) => readonly Frame[];
    alternate?: { value: number; label: string; description: string }; };
  seed: number;
  run: (input: { seed: number; choices: readonly string[]; policy: number }) => Run;
};

export function legalPolicy(lesson: Lesson, value: unknown): value is number {
  const { policy } = lesson;
  return typeof value === "number" && Number.isInteger(value) && (policy.alternate?.value === value ||
    value >= policy.min && value <= policy.max && (value - policy.min) % (policy.step ?? 1) === 0);
}

type Comparison = { run: Run; policy: number; prediction: Trend };

export type Session = {
  stage: Stage;
  choices: readonly string[];
  run?: Run;
  selected?: string;
  focusedMetric?: string;
  traceFocus?: TraceFocus;
  perspective?: ObservationPerspective;
  cursor: number;
  revealed: number;
  playing: boolean;
  policy: number;
  prediction?: Trend;
  comparison?: Comparison;
};

export type Command =
  | { type: "choose"; option: string }
  | { type: "next-stage" }
  | { type: "select"; actorId: string }
  | { type: "play" | "pause" | "step" | "back" | "reset" | "go-to-close" | "go-to-turn" }
  | { type: "locate"; tick: number; metricId: string; actorId?: string }
  | { type: "trace"; focus: TraceFocus; actorId?: string }
  | { type: "perspective"; perspective: ObservationPerspective }
  | { type: "policy"; value: number }
  | { type: "predict"; value: Trend }
  | { type: "compare" | "new-comparison" };

export function startLesson(lesson: Lesson): Session {
  return { stage: 1, choices: [], cursor: 0, revealed: 0, playing: false,
    policy: lesson.policy.baseline };
}

export function nextStageReady(lesson: Lesson, session: Session): boolean {
  if (session.stage === 1) return session.choices.length === lesson.decisions.length;
  if (session.stage === 2) return !!session.selected && session.revealed > 0;
  if (session.stage !== 3 || !session.run) return false;
  const turningTick = session.run.frames.find(frame => frame.turningPoint)?.tick ?? 0;
  const needed = Math.max(lesson.bridge?.minTick ?? 2, turningTick + 1);
  return session.revealed >= Math.min(needed, session.run.frames.length - 1);
}

function declaredMetric(lesson: Lesson, id: string): Metric {
  const metric = lesson.metrics.find(entry => entry.id === id);
  if (!metric) throw new Error(`Missing declared metric ${id}`);
  return metric;
}

export function chartMetric(lesson: Lesson): Metric {
  return declaredMetric(lesson, lesson.metricRoles.observation);
}

export function comparisonMetric(lesson: Lesson): Metric {
  return declaredMetric(lesson, lesson.metricRoles.comparison);
}

export function frameLabel(unit: Lesson["tickUnit"], tick: number): string {
  return unit === "event" ? `事件 ${tick}` : `第 ${tick} 轮`;
}

export function matchesMetric(event: LessonEvent, metricId: string): boolean {
  return (event.deltas[metricId] ?? 0) !== 0 || !!event.focusMetrics?.includes(metricId);
}

export function relatedActors(frame: Frame, metricId?: string): string[] {
  return [...new Set(frame.events.flatMap(event =>
    metricId === undefined || matchesMetric(event, metricId)
      ? [...(event.participants ?? []), event.actorId, event.counterpartyId].filter((id): id is string => !!id) : []))];
}

export function transition(lesson: Lesson, session: Session, command: Command): Session {
  const { stage, run, cursor } = session;
  const replay = !!run && (stage === 2 || stage === 3);
  switch (command.type) {
    case "choose": {
      const decision = lesson.decisions[session.choices.length];
      if (stage !== 1 || !decision || !legalChoice(decision, command.option)) return session;
      return { ...session, choices: [...session.choices, command.option] };
    }
    case "next-stage":
      if (!nextStageReady(lesson, session)) return session;
      if (stage === 1) return { ...session, stage: 2,
        run: lesson.run({ seed: lesson.seed, choices: session.choices, policy: lesson.policy.baseline }) };
      if (stage === 2) return { ...session, stage: 3, cursor: 0, revealed: 0, playing: false };
      return { ...session, stage: 4, playing: false };
    case "select":
      if (!replay || session.perspective === "role" || !run.frames[cursor].actors.some(actor => actor.id === command.actorId)) return session;
      return { ...session, selected: command.actorId, traceFocus: undefined };
    case "play":
      return replay && cursor < run.frames.length - 1 ? { ...session, playing: true } : session;
    case "pause":
      return session.playing ? { ...session, playing: false } : session;
    case "step": {
      if (!replay || cursor >= run.frames.length - 1) return session;
      const next = run.frames[cursor + 1];
      const metric = stage === 3 && session.perspective !== "role" && next.turningPoint ? chartMetric(lesson).id : undefined;
      return { ...session, cursor: next.tick, revealed: Math.max(next.tick, session.revealed), traceFocus: undefined,
        focusedMetric: metric ?? (lesson.originalId ? session.focusedMetric : undefined),
        selected: session.perspective === "role" ? microscopeRole(lesson) :
          metric ? relatedActors(next, metric)[0] ?? session.selected : session.selected,
        playing: session.playing && next.tick < run.frames.length - 1 && !metric };
    }
    case "back":
      return replay ? { ...session, cursor: Math.max(0, cursor - 1), playing: false, traceFocus: undefined, focusedMetric: lesson.originalId ? session.focusedMetric : undefined } : session;
    case "reset":
      return replay ? { ...session, cursor: 0, playing: false, traceFocus: undefined, focusedMetric: lesson.originalId ? session.focusedMetric : undefined } : session;
    case "go-to-turn": {
      const next = run?.frames.find(frame => frame.tick > cursor && frame.turningPoint);
      if (stage !== 3 || session.perspective === "role" || !next) return session;
      const metric = chartMetric(lesson).id;
      return { ...session, cursor: next.tick, revealed: Math.max(next.tick, session.revealed),
        playing: false, traceFocus: undefined, focusedMetric: metric, selected: relatedActors(next, metric)[0] ?? session.selected };
    }
    case "go-to-close":
      return stage === 3 && run && lesson.bridge?.closeLabel ?
        { ...session, cursor: run.frames.length - 1, revealed: run.frames.length - 1,
          playing: false, traceFocus: undefined, focusedMetric: lesson.originalId ? session.focusedMetric : undefined } : session;
    case "locate": {
      if (stage !== 3 || session.perspective === "role" || !run || !Number.isInteger(command.tick) || command.tick > session.revealed ||
          !run.frames[command.tick] || !lesson.metrics.some(metric => metric.id === command.metricId)) return session;
      const frame = run.frames[command.tick];
      const contributors = relatedActors(frame, command.metricId);
      const selected = command.actorId && relatedActors(frame).includes(command.actorId)
        ? command.actorId : contributors[0];
      return { ...session, cursor: command.tick, playing: false, selected, focusedMetric: command.metricId, traceFocus: undefined };
    }
    case "perspective": {
      const role = microscopeRole(lesson);
      if (stage !== 3 || !role || session.perspective === command.perspective) return session;
      return { ...session, perspective: command.perspective, playing: false, traceFocus: undefined,
        selected: command.perspective === "role" ? role : session.selected };
    }
    case "trace": {
      if (stage !== 3 || !run || !microscopeRole(lesson)) return session;
      const { tick, eventId } = command.focus;
      const current = Number.isSafeInteger(tick) && tick <= session.revealed ? run.frames[tick] : undefined;
      const event = current?.events.find(item => item.id === eventId);
      const role = microscopeRole(lesson);
      if (!current || (eventId !== undefined && (!event || session.perspective === "role" &&
          event.actorId !== role && event.counterpartyId !== role))) return session;
      const actorId = session.perspective === "role" ? role : command.actorId ?? session.selected;
      return { ...session, cursor: tick, selected: current.actors.find(actor => actor.id === actorId)?.id,
        traceFocus: command.focus, playing: false };
    }
    case "policy": {
      if (stage !== 4 || session.comparison || !legalPolicy(lesson, command.value) || command.value === session.policy) return session;
      return { ...session, policy: command.value, prediction: undefined };
    }
    case "predict":
      return stage === 4 && !session.comparison && session.policy !== lesson.policy.baseline
        ? { ...session, prediction: command.value } : session;
    case "compare":
      if (stage !== 4 || !run || !session.prediction || session.policy === lesson.policy.baseline ||
          session.comparison) return session;
      return { ...session, comparison: { policy: session.policy, prediction: session.prediction,
        run: lesson.run({ seed: run.seed, choices: session.choices, policy: session.policy }) } };
    case "new-comparison":
      return stage === 4 ? { ...session, comparison: undefined, prediction: undefined } : session;
  }
}

export function peak(run: Run, metricId: string): number | null {
  const observed = run.frames.map(frame => frame.metrics[metricId]).filter((value): value is number => typeof value === "number");
  return observed.length ? Math.max(...observed) : null;
}

export function outcome(lesson: Lesson, run: Run): number | null {
  const id = comparisonMetric(lesson).id;
  return lesson.metricRoles.statistic === "final" ? run.frames.at(-1)?.metrics[id] ?? null : peak(run, id);
}

export function outcomeLabel(lesson: Lesson): string {
  return `${lesson.metricRoles.statistic === "final" ? "期末" : "峰值"}${comparisonMetric(lesson).label}`;
}

export const displayNumber = (value: number | null | undefined) =>
  typeof value === "number" ? Number(value.toFixed(4)) : "未定义";

export const displayObservation = (value: number | null | undefined) =>
  value === undefined ? "缺少记录" : displayNumber(value);
