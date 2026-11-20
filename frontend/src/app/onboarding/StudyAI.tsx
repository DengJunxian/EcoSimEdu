import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageTitle, StatusNotice } from "../../../../content/student-ui.tsx";
import { courseLink } from "../../learning-store.ts";
import { flowQuery } from "../../learning/lesson-flow.ts";
import { StudentHeader } from "../../StudentHeader.tsx";
import "./study-ai.css";

const seenKey = "ecosimedu:study-ai-intro/1";
export const studyAIHref = "./?view=ai";

function rememberChoice() {
  try { localStorage.setItem(seenKey, "1"); } catch { /* The course still works in private mode. */ }
}

export function StudyAIStart() {
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(seenKey) === "1"; } catch { return false; }
  });
  if (seen) return null;
  return <section className="study-ai-intro" aria-labelledby="study-ai-intro-title">
    <div>
      <h2 id="study-ai-intro-title">AI 导师连接</h2>
      <p>设置本机模型，或直接开始离线课程。</p>
    </div>
    <div className="study-ai-actions">
      <a className="map-action" href={studyAIHref}>连接 AI</a>
      <button className="text-button" type="button" onClick={() => {
        rememberChoice();
        setSeen(true);
        document.querySelector<HTMLAnchorElement>(".map-start .map-action")?.focus();
      }}>暂用离线</button>
    </div>
  </section>;
}

type Provider = { provider: string; label: string; model: string };
type Usage = { input_tokens: number; output_tokens: number };
type Status = {
  active: null | { provider: string; model: string; reason: string | null; usage: Usage | null };
  tests_remaining: number;
};

const messages: Record<string, string> = {
  STUDY_AI_LOCAL_ONLY: "请在本机教学服务的回环地址打开此页。",
  STUDY_AI_INVALID_TEST: "请检查密钥格式，再发送连接测试。",
  STUDY_AI_TEST_IN_PROGRESS: "本会话正在测试。请稍后重试。",
  STUDY_AI_WAIT_BEFORE_RETRY: "请等待几秒后再试。",
  STUDY_AI_SESSION_LIMIT: "本会话的连接测试次数已用完。",
  STUDY_AI_SERVICE_LIMIT: "本机服务已达到连接测试上限，请稍后再试。",
  STUDY_AI_SESSION_ENDED: "本次连接已清除或过期。可以重新连接。",
  auth_failed: "供应商拒绝了密钥。请核对后重新输入。",
  access_denied: "此凭证没有使用该模型的权限。",
  model_unavailable: "供应商未提供此型号，或当前账户无权使用。",
  payment_required: "供应商提示需要充值或开通计费。",
  rate_limited: "供应商限制了请求频率或配额。请检查账户后重试。",
  timeout: "供应商响应超时。可以稍后重试。",
  network_error: "本机服务未能连接供应商。请检查网络后重试。",
  invalid_model_output: "模型回复未通过连接验证。可以稍后重试。",
  incomplete_or_refused: "模型未完成连接验证。可以稍后重试。",
};

async function call<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const reply = await fetch(`/api/ai/${endpoint}`, { ...options, cache: "no-store" });
  const data = await reply.json();
  if (!reply.ok) throw new Error(typeof data.detail === "string" ? data.detail : "unavailable");
  return data;
}

export default function StudyAI() {
  const [providers, setProviders] = useState<Provider[]>();
  const [status, setStatus] = useState<Status>();
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const key = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    Promise.all([call<Provider[]>("providers", options), call<Status>("status", options)])
      .then(([available, current]) => {
        if (controller.signal.aborted) return;
        setProviders(available);
        setStatus(current);
        setSelected(current.active?.provider ?? available[0]?.provider ?? "");
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("无法读取连接配置。请用本机教学服务打开，或直接进入离线课程。");
      });
    return () => controller.abort();
  }, [refresh]);

  const provider = providers?.find(item => item.provider === selected);
  const active = status?.active;
  const activeLabel = providers?.find(item => item.provider === active?.provider)?.label;

  async function update(test: boolean, event?: FormEvent) {
    event?.preventDefault();
    const input = key.current;
    if (pending || !input || (test && (!provider || !status?.tests_remaining))) return;
    const body = test ? JSON.stringify({ provider: selected, api_key: input.value.trim(), confirm: true }) : undefined;
    input.value = "";
    setPending(true);
    setError("");
    try {
      setStatus(test ? await call<Status>("test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }) : await call<Status>("session", { method: "DELETE" }));
      rememberChoice();
    } catch (problem) {
      const code = problem instanceof Error ? problem.message : "";
      setError(messages[code] ?? "无法完成操作。可以重试，或继续离线课程。");
    } finally {
      setPending(false);
      if (!test) requestAnimationFrame(() => key.current?.focus());
    }
  }

  return <>
    <StudentHeader/>
    <main className="shell lesson-shell study-ai" id="main" tabIndex={-1}>
      <PageTitle description="连接你已有的模型账户。也可以直接开始离线课程。">AI 导师连接</PageTitle>
      {!providers && !error && <StatusNotice>正在读取本机配置…</StatusNotice>}
      {error && <StatusNotice tone="error">{error}</StatusNotice>}
      {!providers && error && <button type="button" onClick={() => { setError(""); setRefresh(value => value + 1); }}>
        重试读取配置
      </button>}
      {provider && status && <form className="study-ai-form" autoComplete="off" onSubmit={event => void update(true, event)}>
        <div className="study-ai-fields">
          <label>供应商
            <select value={selected} onChange={event => {
              if (key.current) key.current.value = "";
              setSelected(event.target.value);
            }} disabled={pending}>
              {providers?.map(item => <option key={item.provider} value={item.provider}>{item.label}</option>)}
            </select>
          </label>
          <div><span>模型</span><strong className="study-ai-model">{provider.model}</strong></div>
        </div>
        <label className="study-ai-key">API 密钥
          <input ref={key} type="password" autoComplete="off" spellCheck={false}
            autoCapitalize="none" aria-describedby="study-ai-key-note" minLength={8} maxLength={1024} disabled={pending} required/>
        </label>
        <p id="study-ai-key-note">通过验证的密钥由本机服务按会话暂存。清除或会话到期后需要重新输入。</p>
        <p id="study-ai-test-note">测试会向供应商发送一次短请求，可能产生费用。此会话还可测试 {status.tests_remaining} 次。</p>
        <div className="study-ai-actions">
          <button className="primary" type="submit" aria-describedby="study-ai-test-note"
            disabled={pending || !status.tests_remaining}
          >{pending ? "正在处理…" : "发送一次连接测试"}</button>
          {active && <button type="button" disabled={pending} onClick={() => void update(false)}>清除本次连接</button>}
        </div>
        {active && <StatusNotice tone={active.reason ? "warning" : "info"}>
          <strong>{activeLabel} · {active.model} · {active.reason ? "测试未通过" : "连接测试通过"}</strong>
          {active.reason ? <p>{messages[active.reason] ?? "供应商未返回可验证结果。请稍后重试。"}</p> :
            <p>{active.usage ? `供应商报告输入 ${active.usage.input_tokens} token、输出 ${active.usage.output_tokens} token。实际费用以账单为准。`
              : "供应商本次未返回用量。实际费用以账单为准。"}</p>}
        </StatusNotice>}
      </form>}
      <div className="study-ai-actions study-ai-course-links">
        <a className="map-action" onClick={rememberChoice} href={courseLink({ caseId: "schelling_segregation" }, flowQuery)}>开始居住隔离课程</a>
        <a className="text-button" onClick={rememberChoice} href="./">返回课程地图</a>
      </div>
    </main>
  </>;
}
