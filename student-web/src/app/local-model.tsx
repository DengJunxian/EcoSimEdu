import { useEffect, useState, type FormEvent } from "react";
import { api } from "../contracts";

type LocalModel = { provider: string; model: string; currency: string };
type Options = {
  active: LocalModel | null;
  options: (LocalModel & { label: string; needs_rates: boolean })[];
};

export function LocalModelSettings() {
  const [config, setConfig] = useState<Options>();
  const [provider, setProvider] = useState("openai");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<Options>("/local-model", undefined, controller.signal).then(result => {
      setConfig(result);
      if (result.active) setProvider(result.active.provider);
    }).catch(() => { /* Static and older offline servers can still show the home page. */ });
    return () => controller.abort();
  }, []);
  const ready = config !== undefined;
  useEffect(() => {
    if (ready && location.hash === "#model-api") document.getElementById("model-api")?.scrollIntoView();
  }, [ready]);
  const option = config?.options.find(item => item.provider === provider);
  if (!config || !option) return null;

  async function update(payload: object) {
    setPending(true);
    setNotice("");
    setError("");
    try {
      const result = await api<Options>("/local-model", payload);
      setConfig(result);
      setNotice(result.active ? "" : "已清除本次配置。");
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const api_key = String(fields.get("api_key") ?? "").trim();
    const keyInput = form.elements.namedItem("api_key") as HTMLInputElement;
    keyInput.value = "";
    void update({
      provider, api_key, workspace: fields.get("workspace") ?? undefined,
      input_rate: fields.get("input_rate") ?? undefined,
      output_rate: fields.get("output_rate") ?? undefined,
    });
  }

  return <details className="app-local-model" id="model-api" open={location.hash === "#model-api" || undefined}>
    <summary>配置模型 API</summary>
    <p>密钥仅在本机服务运行期间保留。确认启动在线实验后，模型供应商会收到仿真观测和可选动作，并可能计费。</p>
    <form method="post" onSubmit={save} autoComplete="off">
      <div className="app-local-model-fields">
        <label>供应商
          <select value={provider} onChange={event => setProvider(event.target.value)} disabled={pending}>
            {config.options.map(item => <option key={item.provider} value={item.provider}>{item.label}</option>)}
          </select>
        </label>
        <label>API 密钥
          <input type="password" name="api_key" required minLength={8} maxLength={1024} disabled={pending}
            autoComplete="off" spellCheck={false} autoCapitalize="off"/>
        </label>
      </div>
      <p>实验模型 <strong>{option.model}</strong></p>
      {provider === "qwen" && <label>北京工作空间 ID（工作空间专属密钥填写）
        <input type="text" name="workspace" placeholder="ws-…" pattern="ws-[a-z0-9]{1,60}" maxLength={63} disabled={pending}/>
      </label>}
      {option.needs_rates && <div className="app-local-model-fields" key={provider}>
        <label>输入费率（{option.currency} / 百万 tokens）
          <input type="number" name="input_rate" min="0" max="1000" step="0.000001" required disabled={pending}/>
        </label>
        <label>输出费率（{option.currency} / 百万 tokens）
          <input type="number" name="output_rate" min="0" max="1000" step="0.000001" required disabled={pending}/>
        </label>
      </div>}
      {option.needs_rates && <p><a href={provider === "kimi" ? "https://platform.kimi.ai/docs/pricing/chat" : "https://bigmodel.cn/pricing"}
        target="_blank" rel="noreferrer">查看供应商费率（新标签页）</a></p>}
      <div className="app-actions">
        <button className="primary" type="submit" disabled={pending}>{pending ? "正在更新…" : "应用配置"}</button>
        {config.active && <button type="button" disabled={pending} onClick={event => { event.currentTarget.form?.reset(); void update({}); }}>清除密钥</button>}
      </div>
    </form>
    <p role="status">{config.active ? `已配置 ${config.active.model}。首次实验时验证密钥。` : notice}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {config.active && <div className="app-actions">
      <a href="/experiments">打开单角色实验</a>
      <a href="/experiments/multi-role">打开多角色实验</a>
    </div>}
  </details>;
}
