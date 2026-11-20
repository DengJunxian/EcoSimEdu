import { useRef, useState } from "react";
import { api, traceHref } from "./contracts";

type Citation =
  | { kind: "source"; label: string; url: string; supports: string }
  | { kind: "event"; label: string; run_id: string; tick: number }
  | { kind: "concept" | "lesson"; label: string };

type Evidence = { run_id: string; seq: number; tick: number };
type SceneContext = {
  id: string; actor?: string; prediction?: string; evidence?: Evidence[];
};

type TutorAnswer = {
  kind: "history" | "model" | "concept" | "observation" | "insufficient";
  answer: string;
  citations: Citation[];
  next_action?: string;
  delivery?: "offline" | "online" | "offline_fallback";
  online_available?: boolean;
  ordering?: "observation_first" | "inspection_first";
};

const kinds = {
  history: "背景与资料", model: "课程提示", concept: "课程概念",
  observation: "本次观察", insufficient: "证据范围",
};

const hints = [
  { value: 1, label: "看哪里" },
  { value: 2, label: "比较什么" },
  { value: 3, label: "机制推导" },
];

export function TutorPanel({ caseId, runId, tick, revealUntil, scene, onSeek, waitingForEvidence = false }: {
  caseId: string; runId?: string; tick?: number; revealUntil?: number;
  waitingForEvidence?: boolean;
  scene?: SceneContext; onSeek?: (tick: number) => void;
}) {
  const example = runId ? "当前事件发生了什么？" :
    scene?.id === "intro" ? "我的角色是什么？" :
    scene?.id === "compare" ? "对照时应该比较什么？" :
    scene?.id === "notebook" ? "怎样自评实验笔记？" : "给我一个预测提示。";
  const [question, setQuestion] = useState(example);
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<{ scope: string; question: string; hintLevel: number; answer: TutorAnswer }>();
  const [hintLevel, setHintLevel] = useState(1);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const scope = scene ? JSON.stringify([caseId, scene.id, runId, tick, scene.actor, scene.prediction]) : "";
  const answer = response?.scope === scope ? response.answer : undefined;
  const visibleAnswer = revealUntil !== undefined &&
    answer?.citations.some(citation => citation.kind === "event" && citation.tick > revealUntil) ? undefined : answer;
  const canRequestOnline = visibleAnswer?.online_available && visibleAnswer.delivery === "offline" &&
    response?.question === question.trim() && response.hintLevel === hintLevel;

  async function ask(online = false) {
    if (waitingForEvidence) return;
    const request = ++sequence.current;
    setPending(true);
    setError("");
    setResponse(undefined);
    const submitted = question.trim();
    try {
      const prediction = ["yes", "no", "unknown"].includes(scene?.prediction ?? "") ? scene?.prediction : undefined;
      const evidence = scene?.evidence?.filter(item => item.run_id === runId && tick !== undefined && item.tick <= tick)
        .slice(-8).map(({ run_id, seq }) => ({ run_id, seq }));
      const result = await api<TutorAnswer>("/tutor", {
        case_id: caseId, question: submitted, run_id: runId, tick, reveal_until: revealUntil,
        ...(scene && { scene: scene.id, actor: scene.actor || undefined, prediction, hint_level: hintLevel, evidence }),
        ...(online && { online_request_id: crypto.randomUUID() }),
      });
      if (sequence.current === request) setResponse({ scope, question: submitted, hintLevel, answer: result });
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
      {scene && <label>提示程度
        <select value={hintLevel} onChange={event => setHintLevel(Number(event.target.value))}>
          {hints.map(hint => <option key={hint.value} value={hint.value}>{hint.label}</option>)}
        </select>
      </label>}
      <div className="toolbar">
        <button className="primary" disabled={waitingForEvidence || pending || !question.trim()}>查询</button>
        <button type="button" onClick={() => setQuestion(example)}>填写示例</button>
      </div>
    </form>
    {waitingForEvidence ? <p role="status">正在载入当前事件…</p> : pending && <p role="status">正在查找课程证据…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <div aria-live="polite" aria-atomic="true">{visibleAnswer && <section className="quiet-content">
      <h4>{kinds[visibleAnswer.kind]}</h4>
      {visibleAnswer.ordering === "inspection_first" && <p>{visibleAnswer.next_action}</p>}
      <p>{visibleAnswer.answer}</p>
      {visibleAnswer.ordering !== "inspection_first" && visibleAnswer.next_action &&
        visibleAnswer.next_action !== visibleAnswer.answer && <p>{visibleAnswer.next_action}</p>}
      {visibleAnswer.delivery === "online" && <p>在线组织了这条已核对的解释。</p>}
      {visibleAnswer.delivery === "offline_fallback" && <p>已用本地证据返回提示。</p>}
      {visibleAnswer.citations.length > 0 && <ul>
        {visibleAnswer.citations.map((citation, index) => <li key={index}>
          {citation.kind === "source" ?
            <><a href={citation.url} target="_blank" rel="noreferrer">{citation.label}</a>。{citation.supports}</> :
            citation.kind === "event" ?
              onSeek && citation.run_id === runId ?
                <button type="button" className="text-button" onClick={() => onSeek(citation.tick)}>{citation.label}</button> :
                <a href={traceHref(caseId, citation.run_id, citation.tick)}>{citation.label}</a> : citation.label}
        </li>)}
      </ul>}
      {canRequestOnline && !waitingForEvidence && <button type="button" onClick={() => void ask(true)}>在线组织解释</button>}
    </section>}</div>
  </details>;
}
