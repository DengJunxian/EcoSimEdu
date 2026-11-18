import { useState } from "react";
import { api, eventHref } from "../../contracts";
import { alignmentLabel, getFieldView, sourceRef, type Alignment, type PairRef } from "../../learning/flagship-study";
import type { FlagshipView } from "../../learning/flagship-types";
import type { ComparisonConditions } from "../../learning/inquiry";
import { showValue } from "../../lesson-view";

const layouts = { seeded: "种子布局", mixed: "交错布局", segregated: "分区布局" };
const metrics = { similarity: "同类邻接率", satisfied: "居民满意率" };
type Metric = keyof typeof metrics;
type Point = { tick: number; metrics: Record<Metric, number | null> };
type Comparison = Omit<Alignment, "rows"> & {
  rows: (Alignment["rows"][number] & { baseline: Point | null; branch: Point | null })[];
  conditions: ComparisonConditions;
};

export function LayoutCounterfactual({ view, capture, comparisons }: {
  view: FlagshipView; capture?: (pair: PairRef) => void; comparisons: PairRef[];
}) {
  const [layout, setLayout] = useState<"mixed" | "segregated">("mixed");
  const [pair, setPair] = useState<{ data: Comparison; branch: FlagshipView }>();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const data = pair?.data;
  const row = data?.rows[index];
  const selected = row && comparisons.some(ref => ref.base.run_id === view.run_id &&
    ref.branch.run_id === pair?.branch.run_id && ref.base.tick === row.baseline?.tick && ref.branch.tick === row.branch?.tick);

  async function run() {
    setBusy(true);
    setError("");
    setPair(undefined);
    try {
      const branch = crypto.randomUUID();
      await api("/runs", {
        schema_version: 2, case_id: view.case_id, scenario_id: "baseline", provider_kind: "rule",
        request_id: branch, seed: view.seed, action: view.action, parent_run_id: view.run_id,
        parameter_patch: { initial_layout: layout },
      });
      await api(`/runs/${branch}/start?manifest_only=true`, {});
      const [data, source] = await Promise.all([
        api<Comparison>(`/runs/${view.run_id}/compare/${branch}`), getFieldView(branch, 0),
      ]);
      const actual = data.conditions;
      if (Object.keys(actual.treatments).length !== 1 ||
          actual.treatments.initial_layout?.baseline !== "seeded" ||
          actual.treatments.initial_layout.branch !== layout ||
          actual.common_root !== view.root_hash || source.root_hash !== view.root_hash ||
          actual.seed !== view.seed || actual.baseline_initial_hash !== view.initial_hash ||
          actual.branch_initial_hash !== source.initial_hash || source.intervention.threshold !== view.intervention.threshold) {
        throw new Error("两次运行的实际条件与所选布局对照不符。");
      }
      setPair({ data, branch: source });
      setIndex(data.rows.length - 1);
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }

  async function cite() {
    if (!row?.baseline || !row.branch || !pair || !capture) return;
    setBusy(true);
    setError("");
    try {
      const [base, branch] = await Promise.all([
        getFieldView(view.run_id, row.baseline.tick), getFieldView(pair.branch.run_id, row.branch.tick),
      ]);
      if (base.result_hash !== view.result_hash || branch.result_hash !== pair.branch.result_hash) {
        throw new Error("对照来源和当前运行不一致。");
      }
      capture({ kind: "initial_layout", label: `初态对照 · ${alignmentLabel(pair.data, row)}`,
        base: sourceRef(base, base.events[base.tick]), branch: sourceRef(branch, branch.events[branch.tick]) });
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="emergence-section" aria-labelledby="emergence-counterfactual">
    <h3 id="emergence-counterfactual">反事实 · 只改变开局布局</h3>
    <div className="toolbar">
      <label>备选布局 <select value={layout} disabled={busy}
        onChange={event => setLayout(event.target.value as typeof layout)}>
        <option value="mixed">{layouts.mixed}</option>
        <option value="segregated">{layouts.segregated}</option>
      </select></label>
      <button type="button" disabled={busy} onClick={() => void run()}>运行初态对照</button>
    </div>
    {busy && <p role="status">正在读取对照证据…</p>}
    {error && <p role="alert">{error}</p>}
    {pair && data && row && <>
      <p>种子 {data.conditions.seed}，阈值 {view.intervention.threshold}%，A001 的开局行动相同。每场最多八轮。</p>
      <p>处理为从种子布局改为 {layouts[data.conditions.treatments.initial_layout.branch as keyof typeof layouts]}。
        共同生成根相同，各自初始地图不同。两场均使用同一套顺序迁居规则。</p>
      <details className="emergence-identities"><summary>核对两次运行身份</summary>
        <dl>
          <dt>共同生成根</dt><dd>{data.conditions.common_root}</dd>
          <dt>基准运行 · {view.engine_version}</dt><dd>{view.run_id}</dd>
          <dt>基准初态摘要</dt><dd>{data.conditions.baseline_initial_hash}</dd>
          <dt>分支运行 · {pair.branch.engine_version}</dt><dd>{pair.branch.run_id}</dd>
          <dt>分支初态摘要</dt><dd>{data.conditions.branch_initial_hash}</dd>
        </dl>
      </details>
      <label>对照观察点 <select value={index} disabled={busy} onChange={event => setIndex(Number(event.target.value))}>
        {data.rows.map((point, i) => <option key={i} value={i}>{alignmentLabel(data, point)}</option>)}
      </select></label>
      <div className="table-scroll"><table>
        <caption>配对差异 · {alignmentLabel(data, row)}</caption>
        <thead><tr><th scope="col">指标</th><th scope="col">基准</th><th scope="col">分支</th><th scope="col">差值（百分点）</th></tr></thead>
        <tbody>{(Object.keys(metrics) as Metric[]).map(metric => {
          const left = row.baseline?.metrics[metric];
          const right = row.branch?.metrics[metric];
          return <tr key={metric}><th scope="row">{metrics[metric]}</th>
            <td>{left == null ? "无对应记录" : `${showValue(left)}%`}</td>
            <td>{right == null ? "无对应记录" : `${showValue(right)}%`}</td>
            <td>{left == null || right == null ? "无法配对" : left === right ? "无差异" : showValue(Number((right - left).toFixed(2)))}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {row.phase === "ending" && <p>此行比较各自停止时的状态，运行轮数可以不同。</p>}
      <div className="toolbar">
        {row.baseline && <a href={eventHref(view.case_id, view.run_id, row.baseline.tick)}>基准事件 {row.baseline.tick}</a>}
        {row.branch && <a href={eventHref(view.case_id, pair.branch.run_id, row.branch.tick)}>分支事件 {row.branch.tick}</a>}
        <button type="button" disabled={busy || selected || !row.baseline || !row.branch} onClick={() => void cite()}>
          {selected ? "已引用初态对照" : "引用此初态对照"}
        </button>
      </div>
    </>}
    {!pair && comparisons.length > 0 && <p role="status">此运行已有引用的初态对照。</p>}
  </section>;
}
