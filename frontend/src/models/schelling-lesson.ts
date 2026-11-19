import definition from "../../../cases/schelling_segregation/case.json" with { type: "json" };
import { coordinates, openingChoice, openingNeighbors, openingTarget, schelling } from "./schelling.ts";
import { defineCourse, metric, windowOf } from "./course-lesson.ts";

export const schellingLesson = defineCourse("schelling_segregation", definition, {
  title: "邻居变了，你会搬家吗？", role: "社区居民 A001",
  story: "参照 Schelling 对居住选择的模型。你可先决定是否搬到一处预留空位。之后每户按照自己看到的相邻八格行动。",
  facts: [{ label: "原址同组 / 已占邻格", value: openingNeighbors.join(" / ") },
    { label: `预留空位 · ${coordinates(openingChoice)}`, value: `${openingTarget.join(" / ")}（按你搬离原址后计算）` }],
  steps: ["看两处邻居", "决定搬迁", "追踪邻里"],
  predict: { question: "如果一户迁出，谁的邻居比例可能当场改变？", answers: ["原址周围和新址周围的住户", "只有搬家的住户"] },
  metrics: [metric("similarity", "同组邻接比例", "%"), metric("moves", "累计搬迁", "次"),
    metric("satisfied", "达到当前阈值的居民", "%"), metric("remaining", "未达阈值的居民", "户")],
  target: "similarity",
  policy: { id: "higher", label: "最低同组邻居比例", names: ["30%", "50%"],
    note: "同一批住户、同一张开局地图、同一学生决定。每户只改变阈值规则；可用空位和后续路径仍随运行变化。" },
  rule: "计数只纳入已占邻格。同组邻接比例为全体同组邻接计数 ÷ 全体已占邻接计数。低于阈值才搜索满足阈值的空位。",
  explanation: "选择一条具体搬迁和一条对照运行中的事件。写明谁的邻居集合变了、邻接比例怎样变化，并区分一次配对结果和对真实社区的解释假设。",
  baseline: 30, alternative: 50, periodLabel: "各轮收尾", periods: windowOf(0, 8),
  map: true,
}, (seed, action, scenario, params) => schelling(seed, action, scenario, params.threshold));
