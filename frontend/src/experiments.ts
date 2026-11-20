import { sha256Text, withLegacyDemandDeltas } from "./browser-result.ts";
import { additionalSeeds } from "./seed-assets.ts";
import { comparisonMetric, legalPolicy, outcome, validPair, type AlignedFrame, type Lesson, type Run, type Trend } from "./lesson.ts";
import { validChoices, type CourseRef } from "./learning-store.ts";
import { browserEnvelope, browserEvents, browserEvidence, evidencePointer } from "./run-evidence.ts";

export type ExperimentPlan = {
  course: CourseRef; choices: readonly string[]; policy: number; prediction: Trend; seeds: readonly number[];
};
export type Pair = {
  seed: number; baseline: Run; branch: Run; left: number | null; right: number | null; delta: number | null;
};
export type Sample = Pair | { seed: number; failed: true };
export const comparable = (sample: Sample): sample is Pair => !("failed" in sample);

export function pairResult(lesson: Lesson, seed: number, baseline: Run, branch: Run): Pair {
  if (!validPair(baseline, branch, seed)) throw new Error("两组运行的种子、参与者或观测值无法核对。");
  const left = outcome(lesson, baseline);
  const right = outcome(lesson, branch);
  return { seed, baseline, branch, left, right, delta: left === null || right === null ? null : right - left };
}

export async function runSamples(lesson: Lesson, plan: ExperimentPlan, primary?: Pair): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (const seed of plan.seeds) {
    try {
      if (seed === primary?.seed) {
        samples.push(primary);
      } else {
        const run = seed === lesson.seed ? lesson.run : await lesson.prepareSeed?.(seed);
        if (!run) throw new Error("未登记该种子。");
        const inputs = { seed, choices: plan.choices };
        samples.push(pairResult(lesson, seed, run({ ...inputs, policy: lesson.policy.baseline }),
          run({ ...inputs, policy: plan.policy })));
      }
    } catch { samples.push({ seed, failed: true }); }
  }
  return samples;
}

export function pairedRows(lesson: Lesson, baseline: Run, branch: Run) {
  const project = lesson.policy.project ?? ((run: Run): AlignedFrame[] =>
    run.frames.map(frame => ({ ...frame, sourceTick: frame.tick })));
  const left = new Map(project(baseline).map(frame => [frame.tick, frame]));
  const right = new Map(project(branch).map(frame => [frame.tick, frame]));
  return [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a - b).map(tick => {
    const baseline = left.get(tick), branch = right.get(tick);
    return { tick, label: baseline?.axisLabel ?? branch?.axisLabel ?? String(tick), baseline, branch };
  });
}

export function sharedRange(values: readonly (number | null | undefined)[]) {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!numbers.length) return undefined;
  const min = Math.min(...numbers), max = Math.max(...numbers);
  const padding = (max - min || Math.abs(max) || 1) * 0.1;
  return { min: min - padding, max: max + padding };
}

export function distribution(samples: readonly Sample[]) {
  const sorted = samples.flatMap(sample => comparable(sample) && sample.delta !== null ? [sample.delta] : []).sort((a, b) => a - b);
  const count = sorted.length;
  const failed = samples.filter(sample => !comparable(sample)).length;
  return { count, failed, undefinedCount: samples.length - count - failed, minimum: sorted[0],
    median: count ? (sorted[Math.floor((count - 1) / 2)] + sorted[Math.floor(count / 2)]) / 2 : undefined,
    maximum: sorted.at(-1) };
}

export const deltaUnit = (unit: string) => unit === "%" ? "百分点" : unit;
export const statisticNames = { final: "期末水平", peak: "全程峰值", cumulative: "期末累计值" };
export const experimentLimits = "这些差值来自课堂规则和配对种子。范围和中位数描述所运行的模拟，不能用作现实因果效应或置信区间。";

export function conditions(lesson: Lesson, policy: number) {
  const alternative = lesson.policy.alternates?.find(item => item.value === policy);
  return {
    common: "同一种子、同一组参与者及共同生成的开局输入。处理所改变的初态以本次设置为准。",
    treatment: alternative?.label ?? lesson.policy.label,
    baseline: alternative?.baselineLabel ?? lesson.policy.labels?.[lesson.policy.baseline] ?? `${lesson.policy.baseline} ${lesson.policy.unit}`.trim(),
    comparison: alternative?.label ?? lesson.policy.labels?.[policy] ?? `${policy} ${lesson.policy.unit}`.trim(),
    mechanisms: alternative?.description ?? lesson.policy.describe ?? "改变已选规则，观察直接和后续变化。",
  };
}

export function pairedSeeds(lesson: Lesson, multi: boolean) {
  return multi && lesson.prepareSeed ? [lesson.seed, ...additionalSeeds(lesson.seed)] : [lesson.seed];
}

const kind = "ecosimedu-experiment-card/v1";
const print = (value: unknown): string => JSON.stringify(value, (_key, raw) =>
  raw && typeof raw === "object" && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b))) : raw);

export async function experimentCard(lesson: Lesson, plan: ExperimentPlan, samples: readonly Sample[], legacyDemand = false) {
  const course = lesson.casePackage;
  if (!course || samples.length !== plan.seeds.length || !samples.every(comparable)) {
    throw new Error("仍有种子未完成，先重新运行再导出。");
  }
  const metric = comparisonMetric(lesson);
  async function reference(run: Run, policy: number) {
    const envelope = await browserEnvelope(legacyDemand ? withLegacyDemandDeltas(run) : run, course!, { choices: plan.choices, policy });
    const tick = lesson.metricRoles.statistic === "peak"
      ? run.frames.find(frame => frame.metrics[metric.id] === outcome(lesson, run))?.tick
      : run.frames.at(-1)?.tick;
    const events = browserEvents(run, course!);
    const event = events.filter(event => event.frameTick === tick).at(-1);
    return { envelope, evidence: event ? evidencePointer(browserEvidence(envelope, event, run.frames.length - 1)) : null };
  }
  const pairs = await Promise.all(samples.map(async ({ seed, left, right, delta, baseline, branch }) => ({
    seed, left, right, delta, baseline: await reference(baseline, lesson.policy.baseline),
    comparison: await reference(branch, plan.policy),
  })));
  return { kind, origin: "browser_rule_engine", plan, planDigest: await sha256Text(print(plan)), metric: { id: metric.id, unit: metric.unit,
    statistic: lesson.metricRoles.statistic, label: metric.label, deltaUnit: deltaUnit(metric.unit) },
    clock: lesson.bridge?.comparisonAxis ?? course.clock.label,
    conditions: conditions(lesson, plan.policy), modelRule: lesson.bridge?.rule ?? course.modelAssumptions[0],
    limits: experimentLimits, pairs };
}

export async function reopenExperiment(lesson: Lesson, course: CourseRef, saved: unknown) {
  if (!saved || typeof saved !== "object" || !("kind" in saved) || saved.kind !== kind ||
      !("plan" in saved) || !saved.plan || typeof saved.plan !== "object") {
    throw new Error("请选择本平台导出的实验卡 JSON。");
  }
  const plan = saved.plan as ExperimentPlan;
  if (plan.course?.caseId !== course.caseId || plan.course?.market !== course.market ||
      !validChoices(lesson, plan.choices) || !legalPolicy(lesson, plan.policy) || plan.policy === lesson.policy.baseline ||
      !["up", "same", "down"].includes(plan.prediction) || !Array.isArray(plan.seeds) ||
      print(plan.seeds) !== print(pairedSeeds(lesson, plan.seeds.length > 1))) {
    throw new Error("课程、种子或计划条件无法核对。");
  }
  const input = { course, choices: plan.choices, policy: plan.policy, prediction: plan.prediction, seeds: plan.seeds };
  const samples = await runSamples(lesson, input);
  if (!samples.every(comparable)) throw new Error("其中一组运行无法重现。请保留原实验卡。");
  const serialized = print(saved);
  if (print(await experimentCard(lesson, input, samples)) !== serialized &&
      (course.caseId !== "double_auction" || !samples.some(sample => withLegacyDemandDeltas(sample.branch) !== sample.branch) ||
       print(await experimentCard(lesson, input, samples, true)) !== serialized)) {
    throw new Error("实验卡与本机重算的原运行、证据或差值不一致。");
  }
  return { plan: input, samples };
}
