import { useMemo } from "react";
import { hypothesisLimit, outcomeLabel, type Command, type Lesson, type Session, type Trend } from "./lesson.ts";
import { pairedSeeds } from "./experiments.ts";
import { StudyResults, predictions } from "./ExperimentWorkbench.tsx";
import type { CourseRef } from "./learning-store.ts";

export function PredictionCard({ lesson, session, send }: {
  lesson: Lesson; session: Session; send: (command: Command) => void;
}) {
  const { policy } = lesson;
  const locked = !!session.comparison;
  const changed = session.policy !== policy.baseline;
  const alternate = policy.alternates?.find(choice => session.policy === choice.value);
  return <section className="decision-card" aria-label="预测后运行">
    {policy.alternates && <fieldset disabled={locked}>
      <legend>这次改变哪一项？</legend>
      <label className="choice"><input type="radio" name="intervention" checked={!alternate}
        onChange={() => send({ type: "policy", value: policy.baseline })}/> {policy.rangeLabel ?? policy.label}</label>
      {policy.alternates.map(choice => <label key={choice.value} className="choice">
        <input type="radio" name="intervention" checked={choice === alternate}
          onChange={() => send({ type: "policy", value: choice.value })}/> {choice.label}
      </label>)}
    </fieldset>}
    {alternate ? <p>{alternate.description}</p> : <>
      <label htmlFor="policy" className="policy-label">{policy.label}<strong>{policy.rangeLabel
        ? `${session.policy} ${policy.unit}` : policy.labels?.[session.policy] ?? `${session.policy} ${policy.unit}`}</strong></label>
      <input id="policy" type="range" min={policy.min} max={policy.max} step={policy.step ?? 1} value={session.policy}
        aria-valuetext={policy.rangeLabel ? undefined : policy.labels?.[session.policy]} disabled={locked}
        onChange={event => send({ type: "policy", value: Number(event.target.value) })}/>
      <p>{policy.describe ?? `基线每轮 ${policy.baseline} ${policy.unit}，保留原有个体和你的入场决策。`}</p>
    </>}
    {lesson.prepareSeed ? <label className="choice study-seed-choice">
      <input type="checkbox" checked={!!session.multiSeed} disabled={locked}
        onChange={event => send({ type: "seed-count", multi: event.target.checked })}/>
      同时比较另外两组种子（{pairedSeeds(lesson, true).slice(1).join("、")}）
    </label> : lesson.casePackage && <p className="small">本课使用固定需求和时滞，只运行一组种子。</p>}
    <fieldset disabled={!changed || locked}>
      <legend>{session.multiSeed ? `${outcomeLabel(lesson)}的配对差值取中位数。你预计方向是？` : `你预计${outcomeLabel(lesson)}会怎样变？`}</legend>
      {(Object.keys(predictions) as Trend[]).map(value => <label className="choice" key={value}>
        <input type="radio" name="prediction" checked={session.prediction === value}
          onChange={() => send({ type: "predict", value })}/>{predictions[value]}
      </label>)}
    </fieldset>
    {lesson.casePackage && !locked && <label className="experiment-hypothesis">实验假设（选填）
      <textarea rows={2} maxLength={hypothesisLimit} value={session.hypothesis ?? ""}
        placeholder="例如，政策会先改变哪一步，进而改变结果？"
        onChange={event => send({ type: "hypothesis", value: event.target.value })}/>
    </label>}
    {!locked && <button className="primary" disabled={!session.prediction}
      onClick={() => send({ type: "compare" })}>运行并验证</button>}
    {!locked && session.comparisonFailed && <p role="alert">这次运行未完成。原预测和参数已保留，可重新运行。</p>}
    {locked && <button onClick={() => send({ type: "new-comparison" })}>再做一组对照</button>}
    <p className="small" role="status">{locked ? "课堂种子的两组运行已完成，原预测随结果保存。" : ""}</p>
  </section>;
}

export function ComparisonView({ lesson, session, course }: { lesson: Lesson; session: Session; course?: CourseRef }) {
  const baseline = session.run;
  const comparison = session.comparison;
  const plan = useMemo(() => ({
    course: { caseId: course?.caseId ?? "demo", market: course?.market }, choices: session.choices,
    policy: comparison?.policy ?? lesson.policy.baseline, prediction: comparison?.prediction ?? "same" as const,
    seeds: pairedSeeds(lesson, !!session.multiSeed),
    ...(session.hypothesis && { hypothesis: session.hypothesis }),
  }), [course?.caseId, course?.market, session.choices, session.multiSeed, session.hypothesis, comparison, lesson]);
  const primary = useMemo(() => baseline && comparison ? { baseline, branch: comparison.run } : undefined, [baseline, comparison]);
  if (!baseline || !comparison) return <section className="canvas-panel pending-comparison">
    <h2>比较相同条件下的两次运行</h2>
    <p>先调整政策条件，然后预测{outcomeLabel(lesson)}会怎样变化。</p>
  </section>;

  return <StudyResults key={JSON.stringify([baseline.id, comparison.run.id, session.choices, comparison.prediction, session.multiSeed, session.hypothesis])}
    lesson={lesson} plan={plan} primary={primary}/>;
}
