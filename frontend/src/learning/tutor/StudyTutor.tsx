import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { StatusNotice } from "../../../../content/student-ui.tsx";
import type { StudyFocus } from "./schelling-evidence.ts";
import "./study-tutor.css";

const panels = {
  story: {
    summary: "先了解角色与规则",
    label: "故事学习助手",
    intents: { explain: "了解我的角色", hint: "我该怎样观察", formula: "读懂搬迁阈值" },
    verified: "已核对课程材料",
    checking: "课程材料",
    fallback: "可以继续使用本页的故事与模型规则",
    example: "例如：空格需要计入邻居比例吗？",
  },
  briefing: {
    summary: "先了解角色与规则",
    label: "故事学习助手",
    intents: { explain: "了解我的角色", hint: "找观察线索", formula: "核对制度口径" },
    verified: "已核对课程材料",
    checking: "课程材料",
    fallback: "可以继续使用本页的故事与模型规则",
    example: "",
  },
  event: {
    summary: "讲解当前事件",
    label: "课堂事件学习助手",
    intents: { explain: "解释当前记录", hint: "给我回查线索", formula: "核对前后读数" },
    verified: "已核对当前事件",
    checking: "事件",
    fallback: "可以继续核对本页的原事件与指标",
    example: "例如，这一步前后哪些读数变了？",
  },
  relocation: {
    summary: "讲解这次搬迁",
    label: "搬迁学习助手",
    intents: { explain: "解释搬迁影响", hint: "给我观察提示", formula: "核对指标公式" },
    verified: "已核对事件",
    checking: "事件",
    fallback: "可以继续使用上方的原事件和作者讲解",
    example: "例如：这个住户为什么搬家？",
  },
  pair: {
    summary: "讲解课堂种子的对照",
    label: "对照学习助手",
    intents: { explain: "解释两组差异", hint: "引导我核对结果", formula: "核对差值口径" },
    verified: "已核对两组收尾记录",
    checking: "两组收尾记录",
    fallback: "可以继续核对上方的对照结果和原预测",
    example: "例如：两组运行分别为什么停止？",
  },
} as const;

type Intent = keyof typeof panels.relocation.intents | "question";
type Source = { side: string; run_id: string; event_seq: number };
type TutorStep = { text: string; event_seqs: number[]; source_refs?: Source[] };
type Answer = {
  anchor: Record<string, string | number>;
  mode: "author" | "ai";
  reason: string | null;
  steps: TutorStep[];
  question: string;
  usage: { input_tokens: number; output_tokens: number } | null;
  cached: boolean;
  requests_remaining: number | null;
};

function matchesFocus(answer: Answer, focus: StudyFocus) {
  if (!Object.entries(focus).every(([key, value]) => answer.anchor[key] === value)) return false;
  if (focus.stage === 1) return answer.steps.every(step => !step.event_seqs.length && !step.source_refs?.length);
  if (focus.stage === 4) {
    return answer.steps.every(({ event_seqs, source_refs }) => {
      if (event_seqs.length || source_refs?.length !== 2) return false;
      const [baseline, comparison] = source_refs;
      return baseline.side === "baseline" && baseline.run_id === focus.run_id && baseline.event_seq === focus.event_seq &&
        comparison.side === "comparison" && comparison.run_id === focus.comparison_run_id &&
        comparison.event_seq === focus.comparison_event_seq;
    });
  }
  const seq = focus.event_seq;
  return answer.anchor.revealed_until === seq && answer.steps.every(step => !step.source_refs?.length &&
    step.event_seqs.every(event => event === seq || event === seq - 1));
}

type TutorStreamEvent =
  | { type: "progress" }
  | { type: "begin"; answer: Answer; count: number }
  | { type: "step"; step: TutorStep }
  | { type: "done" }
  | { type: "error"; code: string };

async function* streamEvents(response: Response): AsyncGenerator<TutorStreamEvent> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("unavailable");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 16384) throw new Error("unavailable");
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        yield JSON.parse(buffer.slice(0, newline)) as TutorStreamEvent;
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

const fallbackMessages: Record<string, string> = {
  not_connected: "当前没有有效的模型连接。",
  busy: "该会话正在处理另一个模型请求。",
  session_limit: "本次会话的 AI 讲解次数已用完。",
  service_limit: "本机服务暂时达到供应商调用上限。",
  auth_failed: "供应商拒绝了当前密钥。",
  access_denied: "当前账户没有此模型的使用权限。",
  payment_required: "供应商要求开通计费或充值。",
  rate_limited: "供应商限制了请求或配额。",
  timeout: "模型响应超时。",
  invalid_model_output: "模型回复未通过证据校验。",
  question_outside_scope: "当前材料不足以回答这个问题。",
};

export function StudyTutor({ kind, focus: readFocus, sources }: {
  kind: keyof typeof panels; focus: () => StudyFocus | Promise<StudyFocus>; sources: ReactNode;
}) {
  const panel = panels[kind];
  const costNote = useId();
  const privacyNote = useId();
  const [intent, setIntent] = useState<Intent>("explain");
  const [status, setStatus] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer>();
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  const askButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => request.current?.abort(), []);

  function stop() {
    if (!request.current) return;
    request.current.abort();
    request.current = null;
    setAnswer(undefined);
    setPending(false);
    setStatus("已停止接收讲解。");
  }

  async function ask() {
    const text = question.trim();
    if (request.current || (intent === "question" && !text)) return;
    const controller = new AbortController();
    request.current = controller;
    setAnswer(undefined);
    setPending(true);
    setStatus(`正在核对${panel.checking}并请求讲解…`);
    try {
      const focus = await readFocus();
      if (controller.signal.aborted) return;
      const config: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
      };
      const scope = await fetch("/api/ai/tutor/scope", { ...config, body: JSON.stringify(focus) });
      if (!scope.ok) throw new Error(scope.status === 409 ? "evidence" : "unavailable");
      const { grant } = await scope.json() as { grant: string };
      if (controller.signal.aborted) return;
      const response = await fetch("/api/ai/tutor/stream", {
        ...config,
        body: JSON.stringify({ ...focus, grant, intent, confirm: true, ...(intent === "question" && { question: text }) }),
      });
      if (!response.ok) throw new Error(response.status === 409 ? "evidence" : "unavailable");
      let result: Answer | undefined;
      let count = 0;
      for await (const event of streamEvents(response)) {
        if (controller.signal.aborted) return;
        if (event.type === "progress" && !result) {
          setStatus("已核对证据范围，正在准备讲解…");
        } else if (event.type === "begin" && !result && Number.isInteger(event.count) &&
                   event.count >= 0 && event.count <= 3 && !event.answer.steps.length) {
          if (!matchesFocus(event.answer, focus)) throw new Error("evidence");
          count = event.count;
          result = event.answer;
          setStatus("正在接收已核对的讲解…");
        } else if (event.type === "step" && result && result.steps.length < count) {
          result = { ...result, steps: [...result.steps, event.step] };
          if (!matchesFocus(result, focus)) throw new Error("evidence");
          setAnswer(result);
        } else if (event.type === "done" && result && result.steps.length === count) {
          setAnswer(result);
          setStatus(result.mode === "ai" ? (result.cached ? "AI 辅导 · 会话内已缓存" : `AI 辅导 · ${panel.verified}`) :
            `作者讲解 · ${fallbackMessages[result.reason ?? ""] ?? "本次供应商讲解暂不可用。"}`);
          return;
        } else {
          throw new Error(event.type === "error" ? "evidence" : "unavailable");
        }
      }
      throw new Error("unavailable");
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnswer(undefined);
      setStatus(error instanceof Error && error.message === "evidence"
        ? `本机服务未能核对当前证据。${panel.fallback}。`
        : `暂时无法请求讲解。${panel.fallback}。`);
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  }

  const actions = <>
    <button type="button" ref={askButton} className="primary"
      disabled={pending || (intent === "question" && !question.trim())}
      onClick={() => void ask()} aria-describedby={costNote}>请求 AI 讲解</button>
    {pending && <button type="button" onClick={() => {
      stop();
      requestAnimationFrame(() => askButton.current?.focus());
    }}>停止接收</button>}
  </>;

  return <details className={`trace-details edu-panel study-tutor ${kind}-tutor`} aria-label={panel.label}
    onToggle={event => { if (!event.currentTarget.open) stop(); }}>
    <summary>{panel.summary}</summary>
    <div className="decision-actions tutor-controls">
      <label className="actor-picker">讲解方式
        <select value={intent} disabled={pending} onChange={event => {
          setIntent(event.target.value as Intent);
          setAnswer(undefined);
          setStatus("");
        }}>
          {Object.entries(panel.intents).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          {panel.example && <option value="question">自由提问</option>}
        </select>
      </label>
      {intent !== "question" && actions}
    </div>
    {intent === "question" && <>
      <label className="tutor-question">关于当前材料的问题
        <textarea rows={2} maxLength={160} value={question} disabled={pending}
          onChange={event => setQuestion(event.target.value)} placeholder={panel.example} aria-describedby={privacyNote}/>
      </label>
      <p id={privacyNote} className="small">问题原文在本机识别主题，供应商收到主题和相关证据。</p>
      <div className="decision-actions">{actions}</div>
    </>}
    <p id={costNote} className="small">已连接时，请求模型可能产生费用。</p>
    <p role="status">{status}</p>
    {!!answer?.steps.length && <ol className="tutor-steps">
      {answer.steps.map(step => <li key={step.text}>{step.text}</li>)}
    </ol>}
    {answer && !pending && <>
      <p>{answer.question}</p>
      {!!answer.steps.length && <div className="decision-actions">{sources}</div>}
      {answer.reason === "not_connected" && <StatusNotice>
        <a href="./?view=ai">连接或切换 AI 模型</a>
      </StatusNotice>}
      {answer.requests_remaining !== null && <p className="small">
        本会话剩余 {answer.requests_remaining} 次讲解。
        {answer.usage && ` ${answer.cached ? "原请求" : "本次"}回执含输入 ${answer.usage.input_tokens}、输出 ${answer.usage.output_tokens} token。`}
      </p>}
    </>}
  </details>;
}
