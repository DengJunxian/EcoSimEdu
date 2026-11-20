import definition from "../../../cases/schelling_segregation/case.json" with { type: "json" };
import boundaries from "../../../cases/boundaries.json" with { type: "json" };
import { coordinates, forkSchelling, openingChoice, openingNeighbors, openingTarget, schelling, schellingCheckpoint } from "./schelling.ts";
import type { ModelRun } from "./record.ts";
import { seedOffset } from "../seed-assets.ts";
import { defineCourse, metric, windowOf } from "./course-lesson.ts";

const standard = defineCourse("schelling_segregation", definition, {
  title: "邻居变了，你会搬家吗？", role: "社区居民 A001",
  story: "参照 Schelling 用局部迁居规则研究空间分化的理论模型。这里的 340 名居民是合成角色。你可先决定是否搬到预留空位，随后每户依据相邻八格行动。",
  facts: [{ label: "原址同组 / 已占邻格", value: openingNeighbors.join(" / ") },
    { label: `预留空位 · ${coordinates(openingChoice)}`, value: `${openingTarget.join(" / ")}（按你搬离原址后计算）` }],
  steps: ["看两处邻居", "决定搬迁", "追踪邻里"],
  predict: { question: "如果一户迁出，谁的邻居比例可能当场改变？", answers: ["原址周围和新址周围的住户", "只有搬家的住户"] },
  metrics: [metric("similarity", "同组邻接比例", "%"), metric("moves", "累计搬迁", "次"),
    metric("satisfied", "达到当前阈值的居民", "%"), metric("remaining", "未达阈值的居民", "户")],
  policy: { id: "higher", label: "最低同组邻居比例", names: ["30%", "50%"],
    note: "同一批住户、同一张开局地图、同一学生决定。每户只改变阈值规则；可用空位和后续路径仍随运行变化。" },
  rule: "计数只纳入已占邻格。同组邻接比例为全体同组邻接计数 ÷ 全体已占邻接计数。低于阈值才搜索满足阈值的空位。",
  explanation: "选择一条具体搬迁和一条对照运行中的事件。写明谁的邻居集合变了、邻接比例怎样变化，并区分一次配对结果和对真实社区的解释假设。",
  baseline: 30, alternative: 50, periodLabel: "各轮收尾", periods: windowOf(0, 8), phaseLabels: ["开局决定后"],
  map: true,
}, (seed, action, scenario, params) => schelling(seed, action, scenario, params.threshold));

const edge = boundaries.schelling_segregation;
const zero = definition.scenarios.find(scenario => scenario.id === "zero")!;
const scenarioFor = (policy: number) => policy === zero.parameters.threshold ? zero :
  policy === edge.parameters.threshold ? { id: "boundary", parameters: edge.parameters } :
    definition.scenarios.find(entry => entry.parameters.threshold === policy);

export const schellingLesson: typeof standard = {
  ...standard,
  fork: {
    checkpoint: (run, tick) => !!schellingCheckpoint(run as ModelRun, tick),
    run: (run, tick, { destination, action }) => {
      if (destination === undefined || action !== undefined) throw new Error("需要有效的迁入空格。");
      return forkSchelling(run as ModelRun, tick, destination);
    },
  },
  policy: { ...standard.policy, unit: "%", rangeLabel: "30% 与 50%",
    alternates: [
      { value: zero.parameters.threshold, label: zero.label, description: zero.description },
      { value: edge.parameters.threshold, label: `最低比例 ${edge.parameters.threshold}%`,
        description: "用相同开局和学生决定试验严格阈值。查明停下时是全部达标、无合格空格，还是轮数到了上限。" },
    ] },
  async prepareSeed(seed) {
    const index = seedOffset(definition.seed, seed);
    const { default: inputs } = await import("../data/paired-schelling.json", { with: { type: "json" } });
    return request => {
      const scenario = scenarioFor(request.policy);
      if (request.seed !== seed || !scenario || !definition.action.options.some(option => option.id === request.choices[0]))
        throw new Error("未知社区开局、动作或政策");
      return { ...schelling(seed, request.choices[0], scenario.id, request.policy, inputs[index]),
        intervention: scenario.parameters };
    };
  },
  run(input) {
    if (input.seed !== definition.seed || !definition.action.options.some(option => option.id === input.choices[0]))
      throw new Error("未知社区开局或动作");
    const edgeCase = input.policy === zero.parameters.threshold ? zero : input.policy === edge.parameters.threshold ?
      { id: "boundary", parameters: edge.parameters } : undefined;
    return edgeCase ? { ...schelling(input.seed, input.choices[0], edgeCase.id, input.policy), intervention: edgeCase.parameters } :
      standard.run(input);
  },
};
