import { useEffect, useRef, useState } from "react";
import { orderedOptions } from "../../student-web/src/learning/assessment";
import type { Attempt } from "../../student-web/src/learning/education-types";
import { submitAttempt } from "../../student-web/src/learning/learner-repository";
import { flagshipStudy, readFlagshipTransfer, type FlagshipCase } from "./flagship-study.ts";
import { allNotes } from "./learning-store.ts";
import type { Session } from "./lesson.ts";

export function TransferAfterEvidence({ caseId, session, policy }: { caseId: FlagshipCase; session: Session; policy?: number }) {
  const saved = (() => {
    try {
      return allNotes(localStorage).some(note => note.baselineId === session.run?.id &&
        (policy === undefined || note.policy === policy) && note.evidence?.baseline && note.evidence.comparison &&
        note.choices.join("|") === session.choices.join("|"));
    } catch { return false; }
  })();
  if (saved) return <FlagshipTransfer caseId={caseId}/>;
  return <p className="edu-status">保存{policy === 50 ? " 30% 与 50% 配对的" : "一组"}原事件和解释，即可开启迁移题。</p>;
}

export function FlagshipTransfer({ caseId, recordOnly = false }: { caseId: FlagshipCase; recordOnly?: boolean }) {
  const { item, activity, label, question } = flagshipStudy(caseId);
  const [work, setWork] = useState<Awaited<ReturnType<typeof readFlagshipTransfer>>>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [choice, setChoice] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    readFlagshipTransfer(caseId).then(result => { if (active) setWork(result); })
      .catch(() => { if (active) setError("暂时无法读取浏览器中的迁移作答。"); });
    return () => { active = false; };
  }, [caseId]);
  if (recordOnly && !work?.attempts.length) return error ? <p role="status">{error}</p> : null;

  const options = work ? orderedOptions(item, work.base.local_profile_id) : [];
  const labels: Record<Attempt["evidence_class"], string> = {
    independent: "独立作答", repeated: "重复作答", assisted: "有帮助的作答",
  };

  return <section aria-label={`${label}独立迁移`} className="edu-panel svb-course-evidence">
    <h2>{recordOnly ? `${label} · 迁移作答记录` : `独立迁移 · ${label}`}</h2>
    <p>{item.prompt}</p>
    {!recordOnly && work && <form onSubmit={async event => {
      event.preventDefault();
      if (pending.current || !options.some(option => option.id === choice)) return;
      pending.current = true;
      setSubmitting(true);
      setError("");
      try {
        const { attempt } = await submitAttempt(work.base, activity, item, choice,
          options.map(option => option.id), undefined, [], false, true);
        setWork({ ...work, attempts: [...work.attempts, attempt] });
        setChoice("");
      } catch {
        setError("作答无法保存。你的选择仍在，可以再次提交。");
      } finally {
        pending.current = false;
        setSubmitting(false);
      }
    }}>
      <fieldset disabled={submitting}>
        <legend>{question}</legend>
        {options.map(option => <label className="choice" key={option.id}>
          <input type="radio" name={item.id} value={option.id} checked={choice === option.id}
            onChange={() => setChoice(option.id)}/> {option.label}
        </label>)}
      </fieldset>
      <button type="submit" className="primary" disabled={!choice || submitting}>提交迁移作答</button>
    </form>}
    {!work && !error && <p role="status">正在打开迁移作答…</p>}
    {error && <p role="alert">{error}</p>}
    {!!work?.attempts.length && <>
      <ol aria-label="迁移作答记录">{work.attempts.map(attempt => <li key={attempt.id}>
        <time dateTime={attempt.submitted_at}>{new Date(attempt.submitted_at).toLocaleString()}</time>
        {" · "}{labels[attempt.evidence_class]} · {attempt.evaluation.result === "correct" ? "正确" : "需要复核"}。
        {item.response_schema.options?.find(option => option.id === attempt.response)?.label}
      </li>)}</ol>
      <p role="status">{item.feedback.explanation}</p>
    </>}
  </section>;
}
