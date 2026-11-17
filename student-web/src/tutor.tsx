import { useRef, useState } from "react";
import { api, traceHref } from "./contracts";

type Citation =
  | { kind: "source"; label: string; url: string; supports: string }
  | { kind: "event"; label: string; run_id: string; tick: number }
  | { kind: "concept" | "lesson"; label: string };

type TutorAnswer = {
  kind: "history" | "model" | "concept" | "observation" | "insufficient";
  answer: string;
  citations: Citation[];
};

const kinds = {
  history: "背景与资料", model: "课程提示", concept: "课程概念",
  observation: "本次观察", insufficient: "证据范围",
};

export function TutorPanel({ caseId, runId, tick }: { caseId: string; runId?: string; tick?: number }) {
  const example = runId ? "当前事件发生了什么？" : "给我一个预测提示。";
  const [question, setQuestion] = useState(example);
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<TutorAnswer>();
  const [error, setError] = useState("");
  const sequence = useRef(0);

  async function ask() {
    const request = ++sequence.current;
    setPending(true);
    setError("");
    setAnswer(undefined);
    try {
      const result = await api<TutorAnswer>("/tutor", {
        case_id: caseId, question: question.trim(), run_id: runId, tick,
      });
      if (sequence.current === request) setAnswer(result);
    } catch (problem) {
      if (sequence.current === request) {
        setError(problem instanceof Error ? problem.message : "学习助手暂时不可用。");
      }
    } finally {
      if (sequence.current === request) setPending(false);
    }
  }

  return <details className="market">
    <summary>离线学习助手</summary>
    <form className="notebook" onSubmit={event => { event.preventDefault(); void ask(); }}>
      <label>课程问题
        <textarea value={question} onChange={event => setQuestion(event.target.value)}
          placeholder={example} maxLength={300} required/>
      </label>
      <div className="toolbar">
        <button className="primary" disabled={pending || !question.trim()}>查询</button>
        <button type="button" onClick={() => setQuestion(example)}>填写示例</button>
      </div>
    </form>
    {pending && <p role="status">正在查找课程证据…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <div aria-live="polite" aria-atomic="true">{answer && <section className="quiet-content">
      <h4>{kinds[answer.kind]}</h4>
      <p>{answer.answer}</p>
      {answer.citations.length > 0 && <ul>
        {answer.citations.map((citation, index) => <li key={index}>
          {citation.kind === "source" ?
            <><a href={citation.url} target="_blank" rel="noreferrer">{citation.label}</a>。{citation.supports}</> :
            citation.kind === "event" ?
              <a href={traceHref(caseId, citation.run_id, citation.tick)}>{citation.label}</a> : citation.label}
        </li>)}
      </ul>}
    </section>}</div>
  </details>;
}
