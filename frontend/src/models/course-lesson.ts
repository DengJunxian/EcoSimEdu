import type { Frame, Lesson, Metric, Run } from "../lesson.ts";
import type { ModelRun } from "./record.ts";

type Case = {
  title: string; seed: number; version: string;
  action: { label: string; options: readonly { id: string; label: string }[]; default: string };
  sources: readonly { title: string; url: string }[];
  scenarios: readonly { id: string; parameters: object }[];
};

type Teaching = {
  title: string;
  role: string;
  story: string;
  facts: Lesson["role"]["facts"];
  steps: readonly [string, string, string];
  predict: { question: string; answers: readonly [string, string] };
  metrics: readonly [Metric, ...Metric[]];
  target: string;
  policy: { id: string; label: string; names: readonly [string, string]; note: string };
  rule: string;
  explanation: string;
  periodLabel: string;
  periods: readonly number[];
  selectFrame?: (run: ModelRun, period: number) => Frame | undefined;
  baseline?: number;
  alternative?: number;
  priceMetric?: string;
  map?: boolean;
};

export type MigratedLesson = Lesson & { id: string; contentVersion: string; teaching: Teaching };

const states = {
  participant: { label: "参与者", color: "#bce0ca" },
  institution: { label: "机构或公共账户", color: "#f4c16a" },
};
export const metric = (id: string, label: string, unit: string): Metric => ({ id, label, unit, color: "#25665a" });

export function defineCourse<T extends Case>(
  id: string, source: T, teaching: Teaching,
  simulate: (seed: number, action: string, scenario: string, params: T["scenarios"][number]["parameters"]) => ModelRun,
): MigratedLesson {
  const { policy } = teaching;
  const baseline = teaching.baseline ?? 0, alternative = teaching.alternative ?? 1;
  const openingCase = source.scenarios.find(entry => entry.id === "baseline")!;
  const comparison = source.scenarios.find(entry => entry.id === policy.id)!;
  const project = (run: Run) => {
    const recorded = run as ModelRun;
    const byPeriod = new Map(recorded.records.map(event => [event.period, recorded.frames[event.seq]]));
    return teaching.periods.map((period, index) => {
      const selected = teaching.selectFrame
        ? teaching.selectFrame(recorded, period)
        : byPeriod.get(period);
      return { ...(selected ?? { metrics: {}, actors: [], events: [] }), tick: index };
    });
  };
  return {
    id, explanationPrompt: teaching.explanation, originalId: id, contentVersion: source.version, teaching, title: teaching.title, seed: source.seed,
    role: { title: teaching.role, perspective: teaching.story, facts: teaching.facts,
      timeline: teaching.steps.map((label, i) => ({ label, highlighted: i === 0 })) },
    populationTitle: source.title,
    source: { kind: "documented_case",
      note: "历史材料提供背景。角色、数字与结果来自本课的教学模型。",
      references: source.sources },
    decisions: [
      { prompt: source.action.label, options: source.action.options.map(option => ({
        ...option, response: "本次运行将采用这个决定。",
      })) },
      { prompt: teaching.predict.question, options: teaching.predict.answers.map((label, index) => ({
        id: `prediction-${index}`, label, response: "保留你的判断，随后在运行中核对。",
      })) },
    ],
    metrics: teaching.metrics,
    bridge: { minTick: 2, metrics: teaching.metrics.filter(item => item.id !== teaching.target).map(item => item.id),
      chartMetric: teaching.target, rule: teaching.rule, closeLabel: "查看运行收尾",
      prompt: "播放到关键时点，沿曲线回查原始事件，再看这次变化是否进入后续的个体决策。",
      comparisonAxis: teaching.periodLabel },
    tickUnit: "event",
    rangeLookup: teaching.map,
    states: teaching.map ? { A: { label: "A 组", color: "#bce0ca" }, B: { label: "B 组", color: "#f4c16a" } } : states,
    priceMetric: teaching.priceMetric,
    policy: { label: policy.label, min: baseline, max: alternative, baseline, unit: "", step: alternative - baseline,
      labels: { [baseline]: policy.names[0], [alternative]: policy.names[1] },
      describe: policy.note, measure: "final", project },
    run({ seed, choices, policy: option }) {
      if (seed !== source.seed || !source.action.options.some(action => action.id === choices[0]) ||
        (option !== baseline && option !== alternative)) throw new Error(`Invalid classroom input for ${id}`);
      const scenario = option === baseline ? openingCase : comparison;
      return { ...simulate(seed, choices[0], scenario.id, scenario.parameters as T["scenarios"][number]["parameters"]),
        intervention: scenario.parameters };
    },
  };
}

export const windowOf = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
export const eventAt = (type: string) => (run: ModelRun) =>
  run.frames[run.records.findIndex(entry => entry.event_type === type)];
