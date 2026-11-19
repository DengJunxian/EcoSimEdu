import { lazy, Suspense } from "react";
import { comparisonMetric, displayNumber, displayObservation, outcome, outcomeLabel, peak, type Command, type Lesson, type Session, type Trend } from "./lesson.ts";

const MetricChart = lazy(() => import("./MetricChart"));

const predictions: Record<Trend, string> = { down: "减少", same: "不变", up: "增加" };

export function PredictionCard({ lesson, session, send }: {
  lesson: Lesson; session: Session; send: (command: Command) => void;
}) {
  const { policy } = lesson;
  const locked = !!session.comparison;
  const changed = session.policy !== policy.baseline;
  const alternate = policy.alternate;
  const alternateActive = session.policy === alternate?.value;
  return <section className="decision-card" aria-label="预测后运行">
    {alternate && <fieldset disabled={locked}>
      <legend>这次改变哪一项？</legend>
      <label className="choice"><input type="radio" name="intervention" checked={!alternateActive}
        onChange={() => send({ type: "policy", value: policy.baseline })}/> 现金组合</label>
      <label className="choice"><input type="radio" name="intervention" checked={alternateActive}
        onChange={() => send({ type: "policy", value: alternate.value })}/> {alternate.label}</label>
    </fieldset>}
    {alternateActive ? <p>{alternate?.description}</p> : <>
      <label htmlFor="policy" className="policy-label">{policy.label}<strong>{alternate
        ? `${session.policy} ${policy.unit}` : policy.labels?.[session.policy] ?? `${session.policy} ${policy.unit}`}</strong></label>
      <input id="policy" type="range" min={policy.min} max={policy.max} step={policy.step ?? 1} value={session.policy}
        aria-valuetext={alternate ? undefined : policy.labels?.[session.policy]} disabled={locked}
        onChange={event => send({ type: "policy", value: Number(event.target.value) })}/>
      <p>{policy.describe ?? `基线每轮 ${policy.baseline} ${policy.unit}，保留原有个体和你的入场决策。`}</p>
    </>}
    <fieldset disabled={!changed || locked}>
      <legend>你预计{outcomeLabel(lesson)}会怎样变？</legend>
      {(Object.keys(predictions) as Trend[]).map(value => <label className="choice" key={value}>
        <input type="radio" name="prediction" checked={session.prediction === value}
          onChange={() => send({ type: "predict", value })}/>{predictions[value]}
      </label>)}
    </fieldset>
    {!locked && <button className="primary" disabled={!session.prediction}
      onClick={() => send({ type: "compare" })}>运行并验证</button>}
    {locked && <button onClick={() => send({ type: "new-comparison" })}>再做一组对照</button>}
    <p className="small" role="status">{locked ? "已完成同种子对照。原预测保留在本次结果中。" : ""}</p>
  </section>;
}

export function ComparisonView({ lesson, session }: { lesson: Lesson; session: Session }) {
  const baseline = session.run;
  const policy = session.comparison;
  const metric = comparisonMetric(lesson);
  if (!baseline || !policy) return <section className="canvas-panel pending-comparison">
    <h2>比较相同条件下的两次运行</h2>
    <p>先调整政策条件，然后预测{outcomeLabel(lesson)}会怎样变化。</p>
  </section>;

  const baselineValue = outcome(lesson, baseline);
  const policyValue = outcome(lesson, policy.run);
  const observed = baselineValue === null || policyValue === null ? null :
    Math.abs(policyValue - baselineValue) < 1e-10 ? "same" : policyValue < baselineValue ? "down" : "up";
  const scale = Math.max(1, peak(baseline, metric.id) ?? 0, peak(policy.run, metric.id) ?? 0);
  const left = lesson.policy.project?.(baseline) ?? baseline.frames;
  const right = lesson.policy.project?.(policy.run) ?? policy.run.frames;
  return <section className="comparison" aria-label="反事实对照结果">
    <h2>同种子运行结果</h2>
    <p>原预测：{predictions[policy.prediction]}。实际：{observed ? predictions[observed] : "无法比较"}。
      {observed === null ? "至少一组没有可比较的观测值。" :
        policy.prediction === observed ? "结果与预测一致。" : "可对照两组曲线，看看差异从哪一轮开始。"}</p>
    {lesson.policy.project && <p>{lesson.bridge?.comparisonAxis ?
      `对齐口径 · ${lesson.bridge.comparisonAxis}。无对应观察值的时点留空。` : "按交易轮末对齐。横轴从开盘、各轮结束到收盘。"}</p>}
    <div className="comparison-grid">
      {[
        { name: "无干预基线", amount: lesson.policy.baseline, value: baselineValue, run: baseline, frames: left },
        { name: "引入政策", amount: policy.policy, value: policyValue, run: policy.run, frames: right },
      ].map(item => <section key={item.name}>
        <h3>{item.name}</h3>
        <p>{lesson.policy.label} · {lesson.policy.labels?.[item.amount] ?? `${item.amount} ${lesson.policy.unit}`}</p>
        <p>{outcomeLabel(lesson)} <strong>{item.value === null ? "未定义" : `${displayNumber(item.value)} ${metric.unit}`}</strong></p>
        {lesson.metricRoles.statistic === "final" && lesson.bridge?.metrics.includes("equity") &&
          <p>期末银行权益 <strong>{item.run.frames.at(-1)!.metrics.equity} {metric.unit}</strong></p>}
        <Suspense fallback={<p>正在绘制曲线…</p>}>
          <MetricChart metric={metric} frames={item.frames} maximum={scale}/>
        </Suspense>
      </section>)}
    </div>
    {lesson.metricRoles.statistic === "final" && <p>配对差异 · 种子 {baseline.seed}，保留同一组参与者与入场决策。
      {baselineValue !== null && policyValue !== null && `干预组减基线 = ${displayNumber(policyValue - baselineValue)} ${metric.unit}。`}</p>}
    <details className="trace-details">
      <summary>按{lesson.tickUnit === "event" && !lesson.policy.project ? "事件" : "轮次"}查看两组{metric.label}</summary>
      <table>
        <caption>{metric.label}（{metric.unit}）</caption>
        <thead><tr><th scope="col">{lesson.tickUnit === "event" && !lesson.policy.project ? "事件序号" : "轮次"}</th><th scope="col">无干预基线</th><th scope="col">引入政策</th></tr></thead>
        <tbody>{left.map(frame => <tr key={frame.tick}>
          <th scope="row">{lesson.policy.project && frame.tick === 0 && !lesson.bridge?.comparisonAxis ? "开盘" :
            lesson.policy.project && frame.tick === left.length - 1 && !lesson.bridge?.comparisonAxis ? "收盘" : frame.tick}</th><td>{displayObservation(frame.metrics[metric.id])}</td>
          <td>{displayObservation(right.find(item => item.tick === frame.tick)?.metrics[metric.id])}</td>
        </tr>)}</tbody>
      </table>
    </details>
  </section>;
}
