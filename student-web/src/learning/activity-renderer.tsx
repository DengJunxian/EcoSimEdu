import { useEffect, useRef, useState } from "react";
import published from "../../../cases/catalog.json";
import { api } from "../contracts";
import { orderedOptions } from "./assessment";
import { AssessmentRenderer } from "./assessment-renderer";
import { phaseActivities, visitActivity } from "./activity-runtime";
import { outcomeEvidence } from "./evidence-rules";
import type { Activity, Attempt, Item, LearningPackage, Phase, Response, SessionState } from "./education-types";
import { changeSession, emptySession, expose, markUnsavedExposure, profileId, readSession, submitAttempt } from "./learner-repository";
import { isDemo } from "./demo";
import { worksheetLabels } from "./worksheet-attempt";
import { migrateLegacy } from "./migration";
import "./education.css";

export function hasLearningPackage(caseId: string) {
  return published.includes(caseId);
}

const roleLabels = { independent: "独立应用", practice: "练习", transfer: "新情境应用", review: "复习" };
export const evidenceLabels = { independent: "首次无本题帮助", assisted: "有帮助或暴露未知", repeated: "已见同题反馈" };
const stateLabels = { not_attempted: "未尝试", practicing: "练习中", independent_evidence: "有独立应用证据" };

export function useLearningPackage(caseId: string) {
  const [pack, setPack] = useState<LearningPackage>();
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!hasLearningPackage(caseId)) return;
    const controller = new AbortController();
    api<LearningPackage>(`/cases/${encodeURIComponent(caseId)}/lesson?schema_version=3`, undefined, controller.signal)
      .then(setPack).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [caseId]);
  return { pack: pack?.case_id === caseId ? pack : undefined, loadError };
}

export function LearningActivities({ pack, loadError, phase, offline = false }: {
  pack?: LearningPackage; loadError: boolean; phase: Phase; offline?: boolean;
}) {
  if (loadError && ["explain", "notebook"].includes(phase)) return <p role="alert">学习任务暂时无法读取。刷新可重试。</p>;
  if (!pack) return null;
  return <ActivityRenderer key={pack.case_id + pack.content_version} pack={pack} phase={phase} offline={offline}/>;
}

function ActivityRenderer({ pack, phase, offline }: { pack: LearningPackage; phase: Phase; offline: boolean }) {
  const { activities, first } = phaseActivities(pack, phase);
  const [session, setSession] = useState<SessionState>();
  const [demo] = useState(isDemo);
  const [fallback, setFallback] = useState(() => emptySession(pack, "storage-unavailable", demo));
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shownHelp, setShownHelp] = useState<{ id: string; text: string }>();
  const [showFeedback, setShowFeedback] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const submitFocus = useRef<Element | null>(null);
  const requestedFocus = useRef<{ origin: Element | null } | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const base = emptySession(pack, await profileId(demo), demo);
      if (!demo) {
        try { await migrateLegacy(base); } catch { if (active) setError("旧课堂记录尚未备份，原记录可继续打开。"); }
      }
      const saved = await readSession(base);
      if (active) { setSession(saved.session); setAttempts(saved.attempts); }
    }
    const refresh = () => void load().catch(() => { if (active) setError("浏览器学习存储不可用。可以继续课堂并在存储恢复后刷新。"); });
    refresh();
    window.addEventListener("ecosimedu-worksheet-saved", refresh);
    return () => { active = false; window.removeEventListener("ecosimedu-worksheet-saved", refresh); };
  }, [pack, demo]);

  const cursor = (session ?? fallback).phase_cursor[phase];
  const activity = activities.find(row => row.id === cursor) ?? first;
  const item = pack.items.find(row => row.id === activity?.content_ref);
  const feedback = showFeedback ? attempts.find(attempt => attempt.id === showFeedback && attempt.activity_id === activity?.id) : undefined;
  const options = item ? orderedOptions(item, session?.local_profile_id ?? "storage-unavailable") : [];

  useEffect(() => {
    const request = requestedFocus.current;
    if (!request) return;
    // Let the new heading enter the accessibility tree before moving focus.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (requestedFocus.current !== request) return;
        requestedFocus.current = null;
        const active = document.activeElement;
        if (active === request.origin || active === document.body) heading.current?.focus();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activity?.id, cursor]);

  useEffect(() => {
    if (!feedback?.id) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active === submitFocus.current || active === document.body) feedbackHeading.current?.focus();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [feedback?.id]);

  async function move(target: Activity | undefined, previous?: Parameters<typeof visitActivity>[3], help?: Item) {
    if (!session && !activity) return;
    const origin = document.activeElement;
    setBusy(true);
    setError("");
    setShowFeedback(undefined);
    setShownHelp(undefined);
    try {
      if (help) {
        try { await expose(session ?? fallback, help, "example"); }
        catch {
          markUnsavedExposure(session ?? fallback, help);
          setError("帮助记录保存失败，本题下次提交会保留辅助标记。");
        }
      }
      requestedFocus.current = { origin };
      const change = (value: SessionState) => visitActivity(value, target, phase, previous);
      if (session) setSession(await changeSession(session, change));
      else setFallback(change);
    } catch {
      setError("活动位置保存失败。重试即可继续。");
      requestedFocus.current = null;
    } finally { setBusy(false); }
  }

  async function hint(level: 1 | 2 | 3) {
    if (!item || !activity) return;
    setBusy(true);
    setShownHelp(undefined);
    const kind = level === 3 ? "answer" : "hint";
    let text = level === 3 ? item.feedback.explanation : item.feedback.hint;
    try { await expose(session ?? fallback, item, kind, level === 2 ? 2 : 1); }
    catch {
      markUnsavedExposure(session ?? fallback, item);
      setError("帮助记录保存失败，本题下次提交会保留辅助标记。");
    }
    if (offline) {
      if (level === 2) {
        const fields = item.response_schema.fields?.map(field => field.label).join("、");
        const steps = fields ? `分别核对${fields}，再检查单位。` : item.kind === "ordering" ?
          "找出每个动作需要的输入，再判断哪一步必须先发生。" : "逐一用题干条件检验选项，圈出最先违背条件的那一步。";
        text = `${text} ${steps}`;
      }
    } else {
      try {
        const previous = attempts.filter(attempt => attempt.item_id === item.id).at(-1)?.response;
        const reply = await api<{ claim?: string; unsupported_scope?: string }>("/tutor", {
          case_id: pack.case_id, question: "给我本题提示", scene: phase, hint_level: level,
          learning_context: { activity_id: activity.id, item_id: item.id, item_version: item.version,
            response: Array.isArray(previous) || typeof previous === "string" ? previous : null },
        });
        if (reply.unsupported_scope === "authored_exercise" && reply.claim) text = reply.claim;
      } catch { /* Course content provides a local fallback. */ }
    }
    setShownHelp({ id: item.id, text });
    setBusy(false);
  }

  async function submit(response: Response) {
    if (!session || !activity || !item) return;
    requestedFocus.current = null;
    submitFocus.current = document.activeElement;
    setBusy(true);
    setError("");
    setShowFeedback(undefined);
    try {
      const saved = await submitAttempt(session, activity, item, response, options.map(option => option.id));
      setSession(saved.session);
      setAttempts(previous => [...previous, saved.attempt]);
      setShowFeedback(saved.attempt.id);
      if (offline) window.dispatchEvent(new Event("ecosimedu-learning-update"));
    } catch {
      setError("作答未保存。请保留输入并重试。");
    } finally { setBusy(false); }
  }

  if (!first) return null;
  const status = activity ? session?.activity_states[activity.id] : undefined;
  const previous = activity ? { id: activity.id, state: feedback || status === "submitted" || status === "completed" ?
    "completed" as const : "skipped" as const } : undefined;
  const example = activities.find(row => row.id === activity?.remediation_activity_id);
  const activeAttempt = [...attempts].reverse().find(attempt => attempt.activity_id === activity?.id);
  const completed = cursor === "done";
  const state = session?.activity_states[activity?.id ?? ""];
  const next = activities.find(row => row.id === activity?.next_activity_id && !row.id.startsWith("em-"));
  const emergence = activities.find(row => row.id.startsWith("em-") && !session?.activity_states[row.id]);
  const currentTitle = completed ? "本阶段练习记录" : activity?.kind === "example" ? "看一个完整例题" :
    item ? roleLabels[item.assessment_role] : "课堂练习";

  return <section className="education-task" aria-label="课堂练习">
    <h2 key={completed ? "done" : activity?.id} ref={heading} tabIndex={-1}>{currentTitle}</h2>
    {error && <p role="alert" className="error">{error}</p>}
    {!session && !error && <p role="status">正在读取本地学习记录…</p>}
    {demo && <p>演示会话</p>}
    {!completed && activity?.kind === "example" && <>
      <p>独立教学练习 · 自编数据</p>
      <p>{activity.text}</p>
      <button type="button" className="primary" disabled={busy}
        onClick={() => void move(activities.find(row => row.id === activity.return_activity_id),
          { id: activity.id, state: "completed" })}>返回原题</button>
    </>}
    {!completed && item && <>
      <p>{item.id.startsWith("em-") ? "跨尺度机制推理" : "独立教学练习 · 自编数据"}</p>
      {session ? <AssessmentRenderer key={item.id} item={item} options={options} busy={busy} onSubmit={response => void submit(response)}/> :
        <p>{item.prompt}</p>}
      {feedback && <div className="education-feedback">
        <h3 ref={feedbackHeading} tabIndex={-1}>
          {feedback.evaluation.result === "correct" ? "核对正确" : feedback.evaluation.result === "incorrect" ? "再核对这一步" :
            feedback.evaluation.result === "unassessed" ? "已记录还不确定" : "已检查解释结构"}
        </h3>
        {feedback.evaluation.field_results && <ul>{feedback.evaluation.field_results.map((correct, index) =>
          <li key={index}>{item.response_schema.fields?.[index]?.label ?? `第 ${index + 1} 步`} · {correct ? "正确" : "待核对"}</li>)}</ul>}
        <p>{item.feedback.explanation}</p>
        <p>{evidenceLabels[feedback.evidence_class]}。</p>
      </div>}
      <p className="education-status" role="status">{shownHelp?.id === item.id ? shownHelp.text : undefined}</p>
      {!feedback && activeAttempt && <p>上次作答已保存 · {evidenceLabels[activeAttempt.evidence_class]}</p>}
      <div className="toolbar">
        <button type="button" disabled={busy} onClick={() => void hint(1)}>看提示</button>
        {offline && <button type="button" disabled={busy} onClick={() => void hint(2)}>看比较步骤</button>}
        <button type="button" disabled={busy} onClick={() => void hint(3)}>看参考解</button>
        {example && <button type="button" disabled={busy} onClick={() => void move(example, undefined, item)}>看完整例题</button>}
        <button type="button" disabled={busy} onClick={() => void move(next, previous)}>
          {state === "submitted" || feedback ? (next ? "下一练习" : "完成本阶段练习") : (next ? "跳过本题" : "跳过并返回课堂")}</button>
      </div>
    </>}
    {(phase === "notebook" || completed) && <ul className="education-evidence">
      {pack.outcomes.map(outcome => {
        const evidence = outcomeEvidence(outcome, attempts);
        return <li key={outcome.id}><span>{outcome.performance}</span><strong>{stateLabels[evidence.evidence_state]}</strong>
          {evidence.evidence_dates.length > 0 && <time dateTime={evidence.evidence_dates.at(-1)}>
            最近独立达标 · {new Date(evidence.evidence_dates.at(-1)!).toLocaleDateString()}
          </time>}
          {!!evidence.unresolved_misconception_codes.length && <span>最近答案有一处待核对，可回看本课尝试。</span>}
          {evidence.transfer_status === "evidenced" && <span>已有迁移证据</span>}
          {evidence.transfer_status === "needs_more_evidence" && <span>建议再练迁移</span>}
        </li>;
      })}
    </ul>}
    {completed && <button type="button" onClick={() => void move(first)}>重看本阶段练习</button>}
    {completed && emergence && <button type="button" onClick={() => void move(emergence)}>继续涌现练习</button>}
    {!!attempts.length && <details><summary>查看本课尝试（{attempts.length}）</summary>
      <ol>{attempts.map(attempt => <li key={attempt.id}>
        {pack.items.find(row => row.id === attempt.item_id)?.prompt ?? worksheetLabels[attempt.item_id] ?? attempt.item_id}
        {" · "}{evidenceLabels[attempt.evidence_class]} · {new Date(attempt.submitted_at).toLocaleString()}
      </li>)}</ol>
    </details>}
  </section>;
}
