import { useEffect, useState } from "react";
import { api, traceHref } from "./contracts";
import { showValue } from "./lesson-view";

type Point = { tick: number; metrics: Record<string, number | null> };
type Alignment = {
  case_id: string;
  axis_label: string;
  metrics: { id: string; label: string; unit: string }[];
  rows: { phase: "opening" | "checkpoint" | "ending"; checkpoint: number | null; baseline: Point | null; branch: Point | null }[];
};

export function PairedView({ caseId, baseline, branch, title }: {
  caseId: string; baseline: string; branch: string; title: string;
}) {
  const [data, setData] = useState<Alignment>();
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(0);
  const [metricId, setMetricId] = useState("");
  useEffect(() => {
    let active = true;
    api<Alignment>(`/runs/${baseline}/compare/${branch}`).then(result => {
      if (active) { setData(result); setMetricId(result.metrics[0].id); }
    }).catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, [baseline, branch]);

  if (error) return <p role="alert" className="error">{error}</p>;
  if (!data) return <p role="status">正在读取配对观察点…</p>;
  const metric = data.metrics.find(item => item.id === metricId)!;
  const left = data.rows.map(row => row.baseline?.metrics[metricId] ?? null);
  const right = data.rows.map(row => row.branch?.metrics[metricId] ?? null);
  const values = [...left, ...right].filter((value): value is number => value !== null);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 0;
  const span = data.rows.length - 1;
  const x = (index: number) => 62 + 494 * index / Math.max(1, span);
  const y = (value: number) => 131 - (high === low ? .5 : (value - low) / (high - low)) * 94;
  const path = (series: (number | null)[]) => series.map((value, index) => value === null ? "" :
    `${index && series[index - 1] !== null && data.rows[index].phase !== "ending" ? "L" : "M"}${x(index)},${y(value)}`).join(" ");
  const isolated = (series: (number | null)[], className: string) => series.map((value, index) => {
    const terminal = data.rows[index].phase === "ending";
    const before = index > 0 && series[index - 1] !== null;
    const after = index < span && series[index + 1] !== null && data.rows[index + 1].phase !== "ending";
    return value !== null && (terminal || !(before || after)) ?
      <circle key={index} cx={x(index)} cy={y(value)} r="3.5" className={className}/> : null;
  });
  const row = data.rows[cursor];
  const label = row.phase === "ending" ? "各自结束" : row.phase === "opening" ?
    "开局" : `${data.axis_label} ${row.checkpoint}`;

  return <section className="paired-panel">
    <h3>同步比较</h3>
    <div className="toolbar"><label htmlFor="paired-metric">指标</label>
      <select id="paired-metric" value={metricId} onChange={event => setMetricId(event.target.value)}>
        {data.metrics.map(item => <option key={item.id} value={item.id}>{item.label}（{item.unit}）</option>)}
      </select>
    </div>
    <p><span className="paired-left">基准</span><span className="paired-right">{title}</span></p>
    {values.length ? <svg className="lesson-series" viewBox="0 0 595 165" role="img" aria-label={`基准与${title}的${metric.label}`}
      onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const offset = ((event.clientX - bounds.left) * 595 / bounds.width - 62) / 494;
        setCursor(Math.max(0, Math.min(span, Math.round(offset * span))));
      }}>
      <line className="gridline" x1="62" x2="556" y1="37" y2="37"/>
      <line className="gridline" x1="62" x2="556" y1="131" y2="131"/>
      <text x="56" y="41" textAnchor="end">{showValue(high)}</text>
      {low !== high && <text x="56" y="135" textAnchor="end">{showValue(low)}</text>}
      <text x="556" y="158" textAnchor="end">{data.axis_label}</text>
      <path d={path(left)} className="demand"/>
      <path d={path(right)} className="supply"/>
      {isolated(left, "chart-point")}
      {isolated(right, "selected-point")}
      <line className="gridline" x1={x(cursor)} x2={x(cursor)} y1="31" y2="138"/>
      {left[cursor] !== null && <circle cx={x(cursor)} cy={y(left[cursor]!)} r="5" className="chart-point"/>}
      {right[cursor] !== null && <circle cx={x(cursor)} cy={y(right[cursor]!)} r="5" className="selected-point"/>}
    </svg> : <p className="quiet-content">两组在这些观察点均无数值。</p>}
    <label className="timeline">{label}
      <input type="range" aria-label="同步观察点" aria-valuetext={label} min={0} max={span} value={cursor}
        onChange={event => setCursor(Number(event.target.value))}/>
    </label>
    <div className="paired-values" aria-live="polite">
      {([{ title: "基准", run: baseline, point: row.baseline },
        { title, run: branch, point: row.branch }]).map(arm => <div key={arm.run}>
          <h4>{arm.title}</h4>
          <p>{arm.point ? `${showValue(arm.point.metrics[metricId])}${arm.point.metrics[metricId] == null ? "" : ` ${metric.unit}`}` : "该观察点无记录"}</p>
          {arm.point && <a href={traceHref(caseId, arm.run, arm.point.tick)}>查看原事件 {arm.point.tick}</a>}
        </div>)}
    </div>
  </section>;
}
