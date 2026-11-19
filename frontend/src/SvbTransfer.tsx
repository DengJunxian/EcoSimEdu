import { useEffect, useRef, useState } from "react";
import { orderedOptions } from "../../student-web/src/learning/assessment";
import type { Attempt } from "../../student-web/src/learning/education-types";
import { submitAttempt } from "../../student-web/src/learning/learner-repository";
import { readSvbTransfer, transferActivity, transferItem } from "./svb-study.ts";

export function SvbTransfer({ recordOnly = false }: { recordOnly?: boolean }) {
  const [work, setWork] = useState<Awaited<ReturnType<typeof readSvbTransfer>>>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [choice, setChoice] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    readSvbTransfer().then(result => { if (active) setWork(result); })
      .catch(() => { if (active) setError("暂时无法读取浏览器中的迁移作答。"); });
    return () => { active = false; };
  }, []);
  if (recordOnly && !work?.attempts.length) return error ? <p role="status">{error}</p> : null;

  const options = work ? orderedOptions(transferItem, work.base.local_profile_id) : [];
  const labels: Record<Attempt["evidence_class"], string> = {
    independent: "独立作答", repeated: "重复作答", assisted: "有帮助的作答",
  };

  return <section aria-label="青湾银行独立迁移" className="edu-panel svb-course-evidence">
    <h2>{recordOnly ? "青湾银行 · 迁移作答记录" : "独立迁移 · 青湾银行"}</h2>
    <p>{transferItem.prompt}</p>
    {!recordOnly && work && <form onSubmit={async event => {
      event.preventDefault();
      if (pending.current || !options.some(option => option.id === choice)) return;
      pending.current = true;
      setSubmitting(true);
      setError("");
      try {
        const { attempt } = await submitAttempt(work.base, transferActivity, transferItem, choice,
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
        <legend>选择能解释今天支付风险的一项</legend>
        {options.map(option => <label className="choice" key={option.id}>
          <input type="radio" name="harbor-bank" value={option.id} checked={choice === option.id}
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
        {transferItem.response_schema.options?.find(option => option.id === attempt.response)?.label}
      </li>)}</ol>
      <p role="status">{transferItem.feedback.explanation}</p>
    </>}
  </section>;
}
