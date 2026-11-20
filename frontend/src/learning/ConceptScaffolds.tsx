import { useEffect, useRef, useState } from "react";
import { orderedOptions } from "../../../student-web/src/learning/assessment";
import { AssessmentRenderer } from "../../../student-web/src/learning/assessment-renderer";
import { evidenceLabels } from "../../../student-web/src/learning/activity-renderer";
import { isDemo } from "../../../student-web/src/learning/demo";
import type { Activity, Attempt, ConceptScaffold, Item, LearningPackage, Response, SessionState } from "../../../student-web/src/learning/education-types";
import { changeSession, emptySession, expose, markUnsavedExposure, profileId, submitAttempt } from "../../../student-web/src/learning/learner-repository";
import { loadLearningPack } from "../learning-packs.ts";
import "../teaching.css";

type Exercise = { activity: Activity; item: Item };
type Step = "example" | "worked" | "step" | "check";

export function ConceptScaffolds({ caseId }: { caseId: string }) {
  const [pack, setPack] = useState<LearningPackage>();
  const [selected, setSelected] = useState<ConceptScaffold>();
  const panel = useRef<HTMLDetailsElement>(null);
  const entry = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    void loadLearningPack(caseId).then(value => { if (active) setPack(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [caseId]);

  if (pack?.case_id !== caseId || !pack.scaffolds?.length) return null;
  const exercise = (activityId?: string) => {
    const activity = pack.activities.find(value => value.id === activityId && value.kind === "scaffold");
    const item = pack.items.find(value => value.id === activity?.content_ref);
    return activity && item ? { activity, item } : undefined;
  };
  const step = exercise(selected?.step_activity_id);
  const check = exercise(selected?.check_activity_id);
  return <details className="trace-details concept-scaffolds" ref={panel}>
    <summary ref={entry}>概念微课</summary>
    {selected && step && check ? <MicroLesson key={selected.id} pack={pack} topic={selected} step={step} check={check}
      onReturn={() => {
        setSelected(undefined);
        if (panel.current) panel.current.open = false;
        entry.current?.focus();
      }}/> : <div className="decision-actions">
      {pack.scaffolds.map(topic => <button type="button" key={topic.id} onClick={() => setSelected(topic)}>{topic.title}</button>)}
    </div>}
  </details>;
}

function MicroLesson({ pack, topic, step, check, onReturn }: {
  pack: LearningPackage; topic: ConceptScaffold; step: Exercise; check: Exercise; onReturn: () => void;
}) {
  const [phase, setPhase] = useState<Step>("example");
  const [base, setBase] = useState<SessionState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState(false);
  const [feedback, setFeedback] = useState<Attempt>();
  const heading = useRef<HTMLHeadingElement>(null);
  const { activity, item } = phase === "check" ? check : step;
  const options = base ? orderedOptions(item, base.local_profile_id) : [];

  useEffect(() => {
    let active = true;
    const demo = isDemo();
    void profileId(demo).then(profile => { if (active) setBase(emptySession(pack, profile, demo)); })
      .catch(() => { if (active) setError("暂时无法保存微课记录。可返回本课，或刷新后再试。"); });
    return () => { active = false; };
  }, [pack]);

  useEffect(() => { heading.current?.focus(); }, [phase, feedback?.id]);

  function move(next: Step) {
    setHint(false);
    setFeedback(undefined);
    setError("");
    setPhase(next);
  }

  async function help(kind: "example" | "hint") {
    if (!base) return;
    setBusy(true);
    setError("");
    try { await expose(base, item, kind); }
    catch {
      markUnsavedExposure(base, item);
      setError("帮助记录暂时无法保存，本题会保留辅助标记。");
    } finally {
      setBusy(false);
    }
    if (kind === "example") setPhase("worked");
    else setHint(true);
  }

  async function submit(response: Response) {
    if (!base) return;
    setBusy(true);
    setError("");
    try {
      const saved = await submitAttempt(base, activity, item, response, options.map(option => option.id),
        undefined, [], false, true);
      setFeedback(saved.attempt);
      window.dispatchEvent(new Event("ecosimedu-learning-update"));
    } catch { setError("微课作答未保存。可保留输入后重试。"); }
    finally { setBusy(false); }
  }

  async function skipStep() {
    if (!base) return;
    setBusy(true);
    setError("");
    try {
      await changeSession(base, current => current.activity_states[activity.id] ? current : {
        ...current,
        accessible_activity_ids: [...new Set([...current.accessible_activity_ids, activity.id])],
        activity_states: { ...current.activity_states, [activity.id]: "skipped" },
      });
      move("check");
    } catch { setError("暂时无法保存跳过状态。可重试或返回本课。"); }
    finally { setBusy(false); }
  }

  const titles = { example: "直观例子", worked: "完整示范", step: "完成一小步", check: "新情境独立题" };
  return <section className="education-task" aria-label={topic.title}>
    <h3>{topic.title}</h3>
    <h4 ref={heading} tabIndex={-1}>{feedback ? {
      correct: "核对正确", incorrect: "再核对这一步", unassessed: "已记录还不确定",
      structure_complete: "已检查作答", structure_incomplete: "请补充作答",
    }[feedback.evaluation.result] : titles[phase]}</h4>
    {error && <p role="alert">{error}</p>}
    {!base && !error && <p role="status">正在读取本机学习记录…</p>}
    {phase === "example" && <p>{topic.example}</p>}
    {phase === "worked" && <p>{topic.worked_example}</p>}
    {(phase === "step" || phase === "check") && (feedback ? <div className="education-feedback">
      <p>{item.feedback.explanation}</p>
      {phase === "check" && <p>{evidenceLabels[feedback.evidence_class]}。</p>}
    </div> : <>
      <AssessmentRenderer key={item.id} item={item} options={options} busy={busy || !base}
        onSubmit={response => void submit(response)}/>
      <p className="education-status" role="status">{hint && item.feedback.hint}</p>
    </>)}
    <div className="toolbar">
      {phase === "example" && <>
        <button type="button" className="primary" disabled={busy || !base} onClick={() => void help("example")}>看完整示范</button>
        <button type="button" disabled={busy || !base} onClick={() => move("step")}>跳过示范</button>
      </>}
      {phase === "worked" && <button type="button" className="primary" onClick={() => move("step")}>试做一小步</button>}
      {(phase === "step" || phase === "check") && !feedback && <button type="button" disabled={busy || !base}
        onClick={() => void help("hint")}>看提示</button>}
      {phase === "step" && (feedback ?
        <button type="button" className="primary" onClick={() => move("check")}>做新情境题</button> :
        <button type="button" disabled={busy || !base} onClick={() => void skipStep()}>跳到新情境题</button>)}
      <button type="button" disabled={busy} onClick={onReturn}>返回本课</button>
    </div>
  </section>;
}
