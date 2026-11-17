import { useEffect, useState } from "react";
import { catalog } from "../catalog";
import { api, downloadJson } from "../contracts";
import type { Course } from "../lesson-types";
import { alignmentLabel, type Alignment } from "../learning/flagship-study";
import "../learning/flagship.css";
import "./parameter-lab.css";

type Capability = { cases: Record<string, number>; available: boolean; wall_seconds: number;
  providers: { provider: string; model: string; currency: string; max_run_cost: number }[] };
type Attempt = { decision_id: string; attempt: number; currency: string; cost_micros: number | null;
  reason: string | null; actual_model?: string;
  usage?: { input_tokens: number; output_tokens: number; cached_input_tokens: number } | null };
type Decision = { decision_id: string; actor_id: string; step: number; source: string;
  action: string; rule_default: string; event_seq: number };
type Status = { run_id: string; case_id: string; action: string; mode: "rule" | "live";
  state: string; completeness: string; termination_reason: string | null; committed_step: number;
  actual_mode: string; coverage: { planned: number; reached: number; model_committed: number;
    fallback: number; attempts: number; actors: string[]; steps: number[] };
  attempts: Attempt[]; decisions: Decision[]; last_event?: { summary: string } | null };
type Metrics = Record<string, number | null>;
type Pair = Omit<Alignment, "rows"> & {
  metrics: { id: string; label: string; unit: string }[];
  rows: (Omit<Alignment["rows"][number], "baseline" | "branch"> & {
    baseline: { tick: number; metrics: Metrics } | null;
    branch: { tick: number; metrics: Metrics } | null;
  })[];
};
const active = ["running", "pause_requested", "paused", "cancel_requested"];
const phases: Record<string, string> = { created: "待启动", running: "运行中", pause_requested: "等待轮末暂停",
  paused: "已暂停", cancel_requested: "正在取消", cancelled: "已取消", completed: "已完成", failed: "失败", interrupted: "已中断" };
const modes: Record<string, string> = { model: "模型行动", hybrid: "模型与规则混合", rule: "规则" };
const reasons: Record<string, string> = { prefix_changed: "结果与已提交前缀不一致", cancelled: "用户取消", worker_exited: "工作进程结束", budget_limit: "达到预算",
  unknown_usage: "供应商用量未知", wall_limit: "达到运行时限", settlement_failed: "结算验证失败",
  provider_unavailable: "供应商不可用", usage_bound_exceeded: "供应商回执超过预留上界" };
const prefix = "/v2/model-lab/runs";

export function MultiRolePage() {
  const [capability, setCapability] = useState<Capability>();
  const [selected, setSelected] = useState("public_goods");
  const [action, setAction] = useState("");
  const [budget, setBudget] = useState("");
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Status>();
  const [pair, setPair] = useState<Pair>();
  const [cursor, setCursor] = useState(0);
  const [event, setEvent] = useState<{ seq: number; text: string }>();
  const course = catalog.find(item => item.case_id === selected) as Course;
  const initialKey = useState(() => new URLSearchParams(location.search).get("run"))[0];

  useEffect(() => {
    const controller = new AbortController();
    api<Capability>("/v2/model-lab", undefined, controller.signal).then(setCapability)
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message); });
    if (initialKey) api<Status>(`${prefix}/${encodeURIComponent(initialKey)}`, undefined, controller.signal)
      .then(result => { setRun(result); setSelected(result.case_id); setAction(result.action); })
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [initialKey]);
  const runId = run?.run_id;
  const state = run?.state;
  useEffect(() => {
    if (!runId || !state || !active.includes(state)) return;
    const controller = new AbortController();
    const poll = window.setInterval(() => {
      api<Status>(`${prefix}/${runId}`, undefined, controller.signal).then(setRun).catch(problem => {
        if (!controller.signal.aborted) setError(problem.message);
      });
    }, 450);
    return () => { controller.abort(); window.clearInterval(poll); };
  }, [runId, state]);
  useEffect(() => {
    if (!runId || !state || !run?.committed_step) return;
    const controller = new AbortController();
    api<Pair>(`${prefix}/${runId}/compare`, undefined, controller.signal).then(setPair)
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [runId, state, run?.committed_step]);
  const working = busy || !!(state && active.includes(state));
  const provider = capability?.providers[0];
  const budgetMicros = budget === "" ? undefined : Math.round(Number(budget) * 1_000_000);
  const validBudget = budgetMicros === undefined || (!!provider && /^\d+(\.\d{1,6})?$/.test(budget)
    && budgetMicros > 0 && budgetMicros <= Math.round(provider.max_run_cost * 1_000_000));
  async function launch(mode: "rule" | "live") {
    setBusy(true); setError(""); setPair(undefined); setCursor(0); setEvent(undefined); setApproved(false);
    try {
      const request_id = crypto.randomUUID();
      const result = await api<Status>(prefix, { request_id, case_id: selected, seed: course.seed,
        action: action || course.action.default, mode, budget_micros: mode === "live" ? budgetMicros : undefined });
      setRun(result);
      history.replaceState({}, "", `?run=${result.run_id}`);
      setRun(await api<Status>(`${prefix}/${result.run_id}/start`, {}));
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }
  async function control(choice: string) {
    if (!runId) return;
    setError("");
    try { setRun(await api<Status>(`${prefix}/${runId}/${choice}`, {})); }
    catch (problem) { setError((problem as Error).message); }
  }
  async function original(seq: number) {
    if (!runId) return;
    try {
      const result = await api<{ prefix: { events: { seq: number; summary: string }[] } }>(`${prefix}/${runId}/export`);
      const source = result.prefix.events.find(item => item.seq === seq);
      if (source) setEvent({ seq, text: source.summary });
    } catch (problem) { setError((problem as Error).message); }
  }
  const row = pair?.rows[Math.min(cursor, pair.rows.length - 1)];
  return <main id="main" tabIndex={-1} className="container field-lesson">
    <h1>多角色模型实验</h1>
    <p>选择固定行动并运行同条件规则参考，或在配置供应商和预算后加入多角色模型决策。</p>
    <p><a href="/experiments">打开原版单角色实验</a></p>
    {error && <p role="alert" className="error">{error}</p>}
    {!capability && !error && <p role="status">正在读取实验能力…</p>}
    {capability && <>
      <div className="toolbar field-action-choice">
        <label className="field-input">课程 <select aria-label="课程" value={selected} disabled={working}
          onChange={change => { setSelected(change.target.value); setAction(""); }}>
          {Object.entries(capability.cases).map(([id]) =>
            <option key={id} value={id}>{catalog.find(item => item.case_id === id)?.title}</option>)}
        </select></label>
        <label className="field-input">{course.action.label}
          <select aria-label="学生行动" value={action || course.action.default} disabled={working}
            onChange={change => setAction(change.target.value)}>
            {course.action.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select></label>
        <button className="primary" disabled={working} onClick={() => void launch("rule")}>运行规则参考</button>
      </div>
      <p>{selected === "public_goods" ? "四人六轮，学生 P1 保持规则策略，模型可控制 P2–P4 的贡献。"
        : selected === "svb_run" ? "60 名教学储户，前五轮 D02–D07 是预定参与者，轮末统一结算。"
          : selected === "information_cascade" ? "第 1、2、4 名决策者依次声明政策，内核再代入各自私信号。"
            : "三名关注投资者在模型期 1、4、8 各有一次合法动作机会，原订单簿负责撮合。"}</p>
      <details><summary>启用供应商实验</summary>
        {provider ? <>
          <p>{provider.provider} · {provider.model} · 每次运行服务端上限 {provider.max_run_cost} {provider.currency}</p>
          <label className="field-input">本次运行限额（{provider.currency}，可留空）
            <input type="number" inputMode="decimal" min="0.000001" max={provider.max_run_cost} step="0.000001"
              value={budget} disabled={working} onChange={change => { setBudget(change.target.value); setApproved(false); }}
              aria-invalid={!validBudget}/>
          </label>
          <label><input type="checkbox" checked={approved} onChange={change => setApproved(change.target.checked)}/>同意本次调用供应商并使用所选限额</label>
          <button disabled={!approved || !validBudget || working} onClick={() => void launch("live")}>启动多角色 Live</button>
        </> : <p>本机尚未启用多角色供应商和金额限额。可运行规则参考。</p>}
      </details>
    </>}
    {run && <section className="parameter-result" aria-label="多角色运行状态">
      <h2>{catalog.find(item => item.case_id === run.case_id)?.title} · {phases[run.state] ?? run.state}</h2>
      <p>{modes[run.actual_mode]} · 已提交经济时点 {run.committed_step} · {
        run.completeness === "complete" ? "完整" : run.completeness === "prefix" ? "已提交前缀" : "尚无提交"}</p>
      {run.termination_reason && <p>{reasons[run.termination_reason] ?? run.termination_reason}</p>}
      {run.mode === "live" && <>
        <p>计划 {run.coverage.planned}，已到达 {run.coverage.reached}，模型已提交 {run.coverage.model_committed}，
          回退 {run.coverage.fallback}，外部尝试 {run.coverage.attempts}。</p>
        {run.coverage.actors.length > 0 && <p>模型角色 {run.coverage.actors.join("、")} · 时点 {run.coverage.steps.join("、")}</p>}
      </>}
      {run.last_event && <p>{run.last_event.summary}</p>}
      <div className="toolbar">
        {run.state === "created" && <button onClick={() => void control("start")}>启动已创建运行</button>}
        {run.state === "running" && run.mode === "live" && <button onClick={() => void control("pause")}>在结算后暂停</button>}
        {["paused", "pause_requested"].includes(run.state) && <button onClick={() => void control("resume")}>继续执行</button>}
        {["created", "running", "pause_requested", "paused"].includes(run.state) &&
          <button onClick={() => void control("cancel")}>取消并保留已提交记录</button>}
        <button onClick={() => api(`${prefix}/${runId}/export`).then(data => downloadJson(`${run.case_id}-多角色实验.json`, data))
          .catch(problem => setError(problem.message))}>导出运行和回执</button>
      </div>
      {run.decisions.length > 0 && <details><summary>已结算的角色动作</summary><ul>
        {run.decisions.map(decision => <li key={decision.decision_id}>
          {decision.step} · {decision.actor_id} · {decision.action} · {decision.source === "model" ? "模型" : "规则"}
          <button className="text-button" onClick={() => void original(decision.event_seq)}>打开事件 {decision.event_seq}</button>
        </li>)}</ul>{event && <p role="status">事件 {event.seq} · {event.text}</p>}</details>}
      {run.attempts.length > 0 && <details><summary>供应商用量与费用回执</summary><ul>
        {run.attempts.map(attempt => <li key={`${attempt.decision_id}/${attempt.attempt}`}>
          {attempt.decision_id} · {attempt.actual_model ?? "模型未确认"} · {
            attempt.cost_micros === null ? "费用未知" : `${attempt.cost_micros / 1_000_000} ${attempt.currency}`}
          {attempt.usage && ` · 输入 ${attempt.usage.input_tokens}、输出 ${attempt.usage.output_tokens}、缓存 ${attempt.usage.cached_input_tokens} tokens`}
          {attempt.reason && ` · ${reasons[attempt.reason] ?? attempt.reason}`}
        </li>)}</ul></details>}
      {pair && row && <section aria-label="同条件规则对照">
        <h3>同条件规则对照</h3>
        <label className="field-input">{alignmentLabel(pair, row)}
          <input type="range" aria-label="同步观察点" aria-valuetext={alignmentLabel(pair, row)}
            min={0} max={pair.rows.length - 1} value={Math.min(cursor, pair.rows.length - 1)}
            onChange={change => setCursor(Number(change.target.value))}/>
        </label>
        <div className="table-scroll"><table className="parameter-table">
          <thead><tr><th>指标</th><th>规则参考</th><th>当前运行</th></tr></thead>
          <tbody>{pair.metrics.map(metric => <tr key={metric.id}><th scope="row">{metric.label}（{metric.unit}）</th>
            <td>{row.baseline?.metrics[metric.id] ?? "缺失"}</td><td>{row.branch?.metrics[metric.id] ?? "缺失"}</td>
          </tr>)}</tbody>
        </table></div>
        {row.branch && <button className="text-button" onClick={() => void original(row.branch!.tick)}>打开当前原事件 {row.branch.tick}</button>}
        {event && <p role="status">事件 {event.seq} · {event.text}</p>}
      </section>}
    </section>}
  </main>;
}
