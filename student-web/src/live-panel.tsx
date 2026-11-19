import { useEffect, useState } from "react";
import { api, downloadJson, traceHref } from "./contracts";
import { showValue } from "./lesson-view";

export const liveCourses = ["svb_run", "information_cascade", "public_goods", "gamestop"];

type Provider = { provider: string; model: string; currency: string; max_per_attempt: number; model_session_id?: string };
export type LiveCapability = { available: boolean; cases: string[]; providers: Provider[];
  test_limits: Record<string, number>; attempts_per_run: number };
type Attempt = {
  model: string | null; requested_model: string; provider: string; currency: string; cost: number | null;
  pricing_basis: string; reason: string | null; usage: null | { input_tokens: number; output_tokens: number };
};
export type LiveResult = {
  selected_by_model: number;
  rule_fallbacks: number;
  external_attempts: number;
  decisions: { actor_id: string; event_seq: number; action: string; source: string; changed_from_rule: boolean;
    reason: string | null; allowed: Record<string, string>; attempts: Attempt[] }[];
};
type Receipt = { run_id: string; case_id: string; action: string; execution_status: string; model_session_id?: string; result?: { live?: LiveResult } };
type Reference = { case_id: string; run_id: string; action: string; seed: number;
  metrics: { id: string; label: string; unit: string; rule: number | null; advanced: number | null }[] };

const reasons: Record<string, string> = {
  auth_failed: "供应商身份验证失败", access_denied: "账号无访问权限", model_unavailable: "模型不可用",
  payment_required: "供应商账户计费异常", rate_limited: "供应商限流", timeout: "请求超时",
  network_error: "网络异常", provider_error: "供应商错误", action_out_of_bounds: "动作超出允许范围",
  invalid_model_output: "结构化动作无效", incomplete_or_refused: "响应不完整或拒绝",
  invalid_provider_response: "供应商响应格式异常", budget_limit: "预算不足", cancelled: "用户已取消",
  usage_bound_exceeded: "供应商用量超过预留上界", missing_key: "密钥已清除或更新", observation_too_large: "观测超过请求上限",
};

export function LiveReceipt({ caseId, runId, result, cancelled = false }: {
  caseId: string; runId: string; result: LiveResult; cancelled?: boolean;
}) {
  return <section className="live-receipt">
    <h4>{cancelled ? "已取消 · 保存的运行记录" : result.selected_by_model ? "已保存模型决策" : "高级实验使用规则回退"}</h4>
    <p>模型动作 {result.selected_by_model} · 规则回退 {result.rule_fallbacks} · 请求尝试 {result.external_attempts}</p>
    {result.decisions.map(decision => <div key={decision.event_seq}>
      <p>{decision.actor_id} · {decision.allowed[decision.action] ?? decision.action}
        {decision.changed_from_rule ? " · 与规则默认动作不同" : ""}
        {decision.reason ? ` · ${reasons[decision.reason] ?? decision.reason}` : ""}
      </p>
      <a href={traceHref(caseId, runId, decision.event_seq)}>查看执行事件 {decision.event_seq}</a>
      {decision.attempts.length > 0 && <ul>{decision.attempts.map((attempt, index) =>
        <li key={index}>{attempt.model ?? attempt.requested_model}
          {attempt.reason ? ` · ${reasons[attempt.reason] ?? attempt.reason}` : ""}
          {attempt.usage ? ` · 输入 ${attempt.usage.input_tokens} / 输出 ${attempt.usage.output_tokens} tokens` : " · 用量未知"}
          {attempt.cost === null ? " · 计费未知" :
            ` · ${attempt.pricing_basis === "user_configured_ceiling" ? "按设定费率估算" :
              attempt.pricing_basis === "published_peak_ceiling" ? "峰时价上估" : "公布费率估算"} ${attempt.currency} ${attempt.cost}`}
        </li>)}</ul>}
    </div>)}
  </section>;
}

function RuleReference({ runId, actionLabel }: { runId: string; actionLabel?: (action: string) => string }) {
  const [reference, setReference] = useState<Reference>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<Reference>(`/runs/${runId}/rule-reference`).then(result => {
      if (active) setReference(result);
    }).catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, [runId]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!reference) return <p role="status">正在计算本地规则对照…</p>;
  return <section className="rule-reference" aria-label="结果对照">
    <h2>规则与高级实验的结果</h2>
    <p>两组使用相同设置。学生行动为「{actionLabel?.(reference.action) ?? reference.action}」，种子为 {reference.seed}。</p>
    <div className="table-scroll"><table aria-label="期末指标对照">
      <thead><tr><th scope="col">期末指标</th><th scope="col">本地规则</th><th scope="col">高级实验</th></tr></thead>
      <tbody>{reference.metrics.map(metric => <tr key={metric.id}>
        <th scope="row">{metric.label}<small>{metric.unit}</small></th>
        <td>{showValue(metric.rule)}</td><td>{metric.rule === metric.advanced
          ? showValue(metric.advanced) : <strong>{showValue(metric.advanced)}</strong>}</td>
      </tr>)}</tbody>
    </table></div>
    <button className="text-button" onClick={() => downloadJson(`comparison-${runId}.json`, reference)}>导出结果对照</button>
  </section>;
}

export function LivePanel({ caseId, seed, action, status, actionLabel }: {
  caseId: string; seed: number; action: string; status?: LiveCapability; actionLabel?: (action: string) => string;
}) {
  const key = `civitas/live/${caseId}`;
  const [capability, setCapability] = useState<LiveCapability>();
  const [pending, setPending] = useState(false);
  const [approvedSession, setApprovedSession] = useState<string>();
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt>();
  const [runId, setRunId] = useState(() => {
    try {
      const saved = localStorage.getItem(key) ?? "";
      return /^[a-f0-9-]{36}$/.test(saved) ? saved : "";
    } catch { return ""; }
  });
  const phase = receipt?.execution_status;
  const inFlight = phase === "running" || phase === "cancel_requested";
  const cancelled = phase === "cancelled";
  const resetting = Boolean(runId && !receipt && !error);
  const canCancel = Boolean(runId && (phase === "created" || phase === "running"));
  const connection = status ?? capability;
  const modelSession = connection?.providers[0]?.model_session_id;
  const resumeCreated = phase === "created" && receipt?.action === action && receipt.model_session_id === modelSession;

  useEffect(() => {
    if (status) return;
    let active = true;
    api<LiveCapability>("/live").then(state => { if (active) setCapability(state); })
      .catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, [status]);

  useEffect(() => {
    if (!runId) return;
    let active = true;
    let timer: number | undefined;
    async function refresh() {
      try {
        const result = await api<Receipt>(`/runs/${runId}`);
        if (!active) return;
        if (result.case_id !== caseId) {
          setRunId("");
          return;
        }
        setReceipt(result);
        if (["running", "cancel_requested", "created"].includes(result.execution_status)) {
          timer = window.setTimeout(refresh, 1000);
        }
      } catch (problem) {
        if (active) {
          setError(problem instanceof Error ? problem.message : "无法读取本地运行。");
          setRunId("");
        }
      }
    }
    void refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [caseId, runId]);

  async function run() {
    setError("");
    setPending(true);
    setApprovedSession(undefined);
    let id = resumeCreated && receipt ? receipt.run_id : "";
    try {
      if (!id) {
        id = crypto.randomUUID();
        const created = await api<Receipt>("/runs", { request_id: id, case_id: caseId, action, seed,
          scenario_id: "baseline", provider_kind: "live", model_session_id: modelSession });
        try { localStorage.setItem(key, id); } catch { /* The current receipt remains visible. */ }
        setRunId(id);
        setReceipt(created);
      }
      setReceipt(await api<Receipt>(`/runs/${id}/start`, {}));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "高级实验暂时不可用。");
    } finally {
      setPending(false);
    }
  }

  const controls = <div className="model-setup">
    {!connection && !error && <p role="status">正在读取模型服务状态…</p>}
    {connection?.available ? <>
      <p>一名模拟角色由 {connection.providers.map(provider => provider.model).join("、")} 提议动作，
        每次实验最多 {connection.attempts_per_run} 次请求。</p>
      <p>测试预算上限 {Object.entries(connection.test_limits).map(([currency, amount]) => `${currency} ${amount}`).join(" / ")}。
        单次实验预留不超过 {
          connection.providers.map(provider => `${provider.currency} ${Number((provider.max_per_attempt * connection.attempts_per_run).toFixed(6))}`).join(" / ")
        }。</p>
      {modelSession && <p><label><input type="checkbox" checked={approvedSession === modelSession}
        disabled={pending || inFlight} onChange={event => setApprovedSession(event.target.checked ? modelSession : undefined)}/>
        同意本次调用供应商并承担费用</label></p>}
      <button className={status ? "primary" : undefined}
        disabled={pending || inFlight || resetting || (!!modelSession && approvedSession !== modelSession)} onClick={run}>
        {pending || inFlight ? "等待高级实验…" : resumeCreated ? "继续已创建的实验" : "运行高级实验"}
      </button>
    </> : connection && <p className="edu-status" data-tone="warning">本机尚未启用模型服务。
      <a href="/#model-api">在首页配置模型 API</a>，或继续使用基础实验和离线学习助手。</p>}
    {canCancel && <button onClick={async () => {
      try { setReceipt(await api<Receipt>(`/runs/${runId}/cancel`, {})); }
      catch (problem) { setError(problem instanceof Error ? problem.message : "取消失败。"); }
    }}>取消</button>}
    {phase === "cancel_requested" && <p role="status">已请求取消，等待已开始的请求结束。</p>}
    {cancelled && !receipt?.result && <p role="status">实验已取消。</p>}
    {phase === "interrupted" && <p role="status">实验已中断。可创建新实验。</p>}
    {phase === "failed" && <p role="status">本次实验失败。可创建新实验。</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
  const result = receipt?.result?.live && <div className="model-results">
    {phase === "completed" && <RuleReference key={receipt.run_id} runId={receipt.run_id} actionLabel={actionLabel}/>}
    <LiveReceipt caseId={caseId} runId={receipt.run_id} result={receipt.result.live} cancelled={cancelled}/>
  </div>;
  return status ? <>{controls}{result}</> : <details><summary>高级实验 · 模型决策</summary>{controls}{result}</details>;
}
