import { useEffect, useState, type ReactNode } from "react";
import { api } from "../contracts";
import type { SourceRef } from "../learning/flagship-study";
import type { FlagshipView } from "../learning/flagship-types";
import { showValue } from "../lesson-view";
import { missingEvidence, visibleTick, type ObservationPerspective } from "../../../content/microscope";
import "./studio.css";

export type Perspective = ObservationPerspective;
type Node = {
  id: string; kind: string; label: string; value: number | null; unit: string | null;
  source_refs: SourceRef[];
};
type Trace = {
  case_id: string; run_id: string; result_hash: string; as_of_seq: number; perspective: Perspective;
  focus: { event_seq: number; metric_id: string; clock: string; economic_time: number | null };
  evidence_level: "exact_identity" | "rule_trace" | "partial" | "hypothesis";
  notes: string[]; nodes: Node[];
  edges: { kind: string; label: string; source_refs: SourceRef[] }[];
};

type TraceFocus = Pick<FlagshipView, "case_id" | "run_id" | "result_hash" | "tick">;

export function useTrace(view: TraceFocus, metric: string, perspective: Perspective, actor: string, enabled: boolean) {
  const { run_id: runId, case_id: caseId, result_hash: hash, tick } = view;
  const params = new URLSearchParams({ seq: String(tick), as_of_seq: String(tick), metric_id: metric, perspective });
  if (perspective === "system" && actor) params.set("actor_id", actor);
  const path = `/emergence/runs/${runId}/trace?${params}`;
  const [response, setResponse] = useState<{ path: string; trace?: Trace; error?: string }>();
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    api<Trace>(path, undefined, abort.signal).then(trace => {
      if (abort.signal.aborted) return;
      if (trace.case_id !== caseId || trace.run_id !== runId || trace.result_hash !== hash || trace.as_of_seq !== tick ||
          trace.focus.event_seq !== tick || trace.focus.metric_id !== metric || trace.perspective !== perspective ||
          [...trace.nodes, ...trace.edges].some(item => item.source_refs.some(ref =>
            ref.run_id !== runId || ref.result_hash !== hash || !visibleTick(ref.seq, tick)))) {
        throw new Error("事件证据与当前运行焦点不一致。");
      }
      setResponse({ path, trace });
    }).catch(problem => {
      if (!abort.signal.aborted) setResponse({ path, error: problem.message });
    });
    return () => abort.abort();
  }, [path, enabled, caseId, runId, hash, tick, metric, perspective]);
  return response?.path === path && (!response.trace || response.trace.result_hash === hash) ? response : undefined;
}

const lenses = { micro: "主体状态", meso: "互动关系", macro: "系统指标" };
type Lens = keyof typeof lenses;
const nodeLens = { actor_state: "micro", relation: "meso", group_metric: "meso", system_metric: "macro" } as Record<string, Lens>;
const claimLabels: Record<string, string> = {
  accounting_identity: "算术恒等式", model_rule: "模型规则", paired_difference: "配对差异",
  interpretive_hypothesis: "解释假设", observed_transition: "已记录的变化",
};

export function TraceClaims({ trace, seek }: { trace: Trace; seek: (tick: number) => void }) {
  return <>
    <ul>{trace.edges.filter(edge => edge.kind !== "observed_transition").map((edge, index) =>
      <li key={index}><strong>{claimLabels[edge.kind]}</strong> · {edge.label}{" "}
        {edge.source_refs.map((ref, i) => <button key={i} type="button" className="text-button"
          onClick={() => seek(ref.tick)}>事件 {ref.seq}</button>)}
      </li>)}</ul>
    {trace.notes.map(note => <p key={note}>{note}</p>)}
  </>;
}

export function TraceLenses({ trace, perspective, seek, only }: { trace?: Trace; perspective: Perspective;
  seek: (tick: number) => void; only?: Lens }) {
  const [lens, setLens] = useState<Lens>("micro");
  const activeLens = perspective === "role" ? "micro" : only ?? lens;
  const nodes = trace?.nodes.filter(node => nodeLens[node.kind] === activeLens) ?? [];
  const visible = nodes.slice(0, 8);
  function ledger(rows: Node[]) {
    return <ul>{rows.map(node => {
      const source = node.source_refs[0];
      return <li key={node.id}>{node.label}{node.unit && ` ${showValue(node.value)}${node.value == null ? "" : node.unit}`}
        {" · "}{perspective === "system" ?
          <button type="button" className="text-button" onClick={() => seek(source.tick)}>事件 {source.seq}</button> :
          `观察点 ${source.seq}`}</li>;
    })}</ul>;
  }
  return <section className="emergence-section" aria-label="三个证据镜头">
    {perspective === "system" && !only && <label>证据镜头 <select value={activeLens} onChange={e => setLens(e.target.value as Lens)}>
      {(Object.keys(lenses) as Lens[]).map(key => <option key={key} value={key}>{lenses[key]}</option>)}
    </select></label>}
    {trace && <>
      <p>事件 {trace.focus.event_seq}{trace.focus.economic_time != null &&
        (trace.focus.economic_time === 0 ? " · 开局" : ` · 第 ${trace.focus.economic_time} ${
          ({ round: "轮", week: "周", turn: "位" } as Record<string, string>)[trace.focus.clock] ?? "观察点"}`)}</p>
      {visible.length ? ledger(visible) : <p>{missingEvidence}</p>}
      {nodes.length > visible.length && <details><summary>查看其余 {nodes.length - visible.length} 条记录</summary>
        {ledger(nodes.slice(visible.length))}
      </details>}
      <details><summary>核对证据身份</summary>
        <dl className="emergence-identities">
          <dt>运行</dt><dd>{trace.run_id}</dd>
          <dt>结果摘要</dt><dd>{trace.result_hash}</dd>
          <dt>证据上限</dt><dd>事件 {trace.as_of_seq}</dd>
        </dl>
      </details>
    </>}
  </section>;
}

export const coreMetrics: Record<string, string> = {
  schelling_segregation: "similarity", svb_run: "cash", information_cascade: "public_a_pct",
  double_auction: "last_price", public_goods: "net_income", beer_game: "retail_stock",
};

const compactLabels = { world: "经济世界", micro: "主体", macro: "系统结果" } as const;
type CompactPane = keyof typeof compactLabels;

export function CompactViews({ view, actor, seek, children }: {
  view: TraceFocus; actor: string; seek: (tick: number) => void; children: ReactNode;
}) {
  const [pane, setPane] = useState<CompactPane>("world");
  const [compact, setCompact] = useState(() => matchMedia("(max-width: 680px)").matches);
  useEffect(() => {
    const query = matchMedia("(max-width: 680px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const response = useTrace(view, coreMetrics[view.case_id], "system", actor, compact && pane !== "world");
  return <div className="emergence-compact">
    {compact && <nav className="toolbar" aria-label="窄屏探究视图">
      {(Object.keys(compactLabels) as CompactPane[]).map(key => <button key={key} type="button" aria-pressed={pane === key}
        onClick={() => setPane(key)}>{compactLabels[key]}</button>)}
    </nav>}
    <div hidden={compact && pane !== "world"}>{children}</div>
    {compact && pane !== "world" && <section aria-label={compactLabels[pane]}>
      {response?.trace ? <>
        <TraceLenses trace={response.trace} perspective="system" seek={seek} only={pane}/>
        {pane === "macro" && <TraceClaims trace={response.trace} seek={seek}/>}
      </> : response?.error ? <p role="alert">当前时点的证据未能核对。</p> : <p role="status">正在读取当前事件…</p>}
    </section>}
  </div>;
}

export function LedgerEvidence({ view, metric, actor, seek, initialOpen = false }: {
  view: TraceFocus; metric: string; actor: string; seek: (tick: number) => void; initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const result = useTrace(view, metric, "system", actor, open);
  return <details id="emergence-explore" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>涌现显微镜</summary>
    {open && <>
      <TraceLenses trace={result?.trace} perspective="system" seek={seek}/>
      {result?.trace && <TraceClaims trace={result.trace} seek={seek}/>}
      {result?.error && <p role="alert">无法核对当前观察点的证据。请切换事件再试。</p>}
    </>}
  </details>;
}
