import { useEffect, useState, type ReactNode } from "react";
import { api, eventHref } from "../contracts";
import type { Course } from "../lesson-types";
import { showValue } from "../lesson-view";
import { alignmentLabel, getFieldView, sourceRef, type Alignment, type FieldStudy, type PairRef } from "./flagship-study";
import type { FlagshipView } from "./flagship-types";

export function FlagshipCompare({ course, study, busy, run, forecast, capture, renderWorld }: {
  course: Course;
  study: FieldStudy;
  busy: boolean;
  run: (scenario: string) => void;
  forecast: (scenario: string, value: string) => void;
  capture: (pair: PairRef) => void;
  renderWorld: (baseline: FlagshipView | undefined, comparison: FlagshipView | undefined) => ReactNode;
}) {
  const [branch, setBranch] = useState(course.scenarios[1].id);
  const [selected, setSelected] = useState(0);
  const [alignment, setAlignment] = useState<{ key: string; data: Alignment }>();
  const [frames, setFrames] = useState<{ key: string; left?: FlagshipView; right?: FlagshipView }>();
  const [error, setError] = useState("");
  const baseId = study.runs.baseline;
  const branchId = study.runs[branch];
  const pairKey = `${baseId}/${branchId}`;
  const data = alignment?.key === pairKey ? alignment.data : undefined;
  const row = data?.rows[selected];
  const pointKey = `${pairKey}/${selected}`;
  const selectedFrames = frames?.key === pointKey ? frames : undefined;
  const scenario = course.scenarios.find(item => item.id === branch)!;
  const responseMetrics: Record<string, string> = {
    svb_run: "queued", schelling_segregation: "similarity", information_cascade: "cascade_decisions", public_goods: "net_income",
    lemons_market: "net_surplus", school_matching: "student_true_rank", beer_game: "factory_variance_ratio",
  };
  const responseMetric = responseMetrics[course.case_id];
  const forecastMetric = course.metrics.find(item => item.id === responseMetric) ?? course.metrics[0];

  useEffect(() => {
    if (!baseId || !branchId) return;
    const controller = new AbortController();
    api<Alignment>(`/runs/${baseId}/compare/${branchId}`, undefined, controller.signal)
      .then(result => setAlignment({ key: pairKey, data: result }))
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [baseId, branchId, pairKey]);

  useEffect(() => {
    if (!baseId || !branchId || !row) return;
    const controller = new AbortController();
    Promise.all([
      row.baseline ? getFieldView(baseId, row.baseline.tick, false, controller.signal) : undefined,
      row.branch ? getFieldView(branchId, row.branch.tick, false, controller.signal) : undefined,
    ]).then(([left, right]) => setFrames({ key: pointKey, left, right }))
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [baseId, branchId, row, pointKey]);

  const label = data && row ? alignmentLabel(data, row) : "";
  const left = selectedFrames?.left;
  const right = selectedFrames?.right;
  const leftEvent = left?.events[left.tick];
  const rightEvent = right?.events[right.tick];
  const pair = left && right && leftEvent && rightEvent ?
    { base: sourceRef(left, leftEvent), branch: sourceRef(right, rightEvent), label } : null;
  const captured = pair && study.comparisons.some(saved => saved.branch.run_id === pair.branch.run_id &&
    saved.branch.seq === pair.branch.seq && saved.base.seq === pair.base.seq);
  const leftValue = left?.frame.metrics[forecastMetric.id];
  const rightValue = right?.frame.metrics[forecastMetric.id];
  const difference = leftValue == null || rightValue == null ? null : rightValue - leftValue;
  const outcome = difference === null ? undefined : difference > 0 ? "increase" : difference < 0 ? "decrease" : "same";
  return <section className="field-compare">
    <div className="toolbar field-compare-controls">
      <label className="field-input">选择对照 <select aria-label="选择对照" value={branch} disabled={busy}
        onChange={event => { setBranch(event.target.value); setSelected(0); setError(""); }}>
        {course.scenarios.slice(1).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label className="field-input">预测结束时「{forecastMetric.label}」如何变化
        <select aria-label="对照预测" value={study.forecasts[branch] ?? ""} disabled={busy || !!branchId}
          onChange={event => forecast(branch, event.target.value)}>
          <option value="">作一项预测</option><option value="increase">上升</option><option value="decrease">下降</option>
          <option value="same">相同</option><option value="unknown">不确定</option>
        </select>
      </label>
      <button className="primary" disabled={busy || !!branchId || !study.forecasts[branch]}
        onClick={() => { setError(""); run(branch); }}>{branchId ? "对照已运行" : "运行对照"}</button>
    </div>
    <p>{scenario.description} 两次运行保持种子 {course.seed} 与学生行动
      「{course.action.options.find(option => option.id === study.action)?.label}」。</p>
    {error && <p role="alert" className="error">{error}</p>}
    {branchId && !data && !error && <p role="status">正在读取同步观察点…</p>}
    {row && data && <>
      <label className="field-input">{label}
        <input type="range" aria-label="同步观察点" aria-valuetext={label} min={0} max={data.rows.length - 1}
          value={selected} onChange={event => setSelected(Number(event.target.value))}/>
      </label>
      {!selectedFrames ? <p role="status">正在读取两组账本…</p> : <>
        <div className="table-scroll"><table className="field-compare-table">
          <caption>同一观察点的指标</caption>
          <thead><tr><th scope="col">指标</th><th scope="col">基准</th><th scope="col">{scenario.label}</th></tr></thead>
          <tbody>{course.metrics.map(metric => <tr key={metric.id}>
            <th scope="row">{metric.label}（{metric.unit}）</th>
            <td>{showValue(left?.frame.metrics[metric.id])}</td><td>{showValue(right?.frame.metrics[metric.id])}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="toolbar">{leftEvent && left && <a href={eventHref(course.case_id, left.run_id, leftEvent.seq)}>打开基准原事件</a>}
          {rightEvent && right && <a href={eventHref(course.case_id, right.run_id, rightEvent.seq)}>打开对照原事件</a>}</div>
        {(!left || !right) && <p>该轮次有一组运行无记录。可移动到两组都记录的时点，或查看各自结束。</p>}
        {left?.closed && right?.closed && outcome && <p>{forecastMetric.label}
          {outcome === "same" ? "在两组结束时相同。可以回到中间轮次比较轨迹或主体。" :
            `在对照组${outcome === "increase" ? "上升" : "下降"} ${showValue(Math.abs(difference!))} ${forecastMetric.unit}。`}
          {study.forecasts[branch] === "unknown" ? "可用本次数据修订判断。" :
            study.forecasts[branch] === outcome ? "与原预测一致。" : "与原预测不同。"}</p>}
        {left && right && <details><summary>核对生成根和初始状态</summary>
          <dl><dt>共同生成根</dt><dd>{left.root_hash}</dd>
            <dt>基准初态</dt><dd>{left.initial_hash}</dd><dt>对照初态</dt><dd>{right.initial_hash}</dd></dl>
        </details>}
        {pair && <button disabled={!!captured} onClick={() => capture(pair)}>{captured ? "已引用对照" : "引用此对照"}</button>}
        {renderWorld(left, right)}
      </>}
    </>}
  </section>;
}
