import { useEffect, useState, type ReactNode } from "react";
import type { LearningPackage } from "../../student-web/src/learning/education-types";
import { LearningActivities } from "../../student-web/src/learning/activity-renderer";
import { outcomeEvidence } from "../../student-web/src/learning/evidence-rules";
import { personalLearning, ReviewPanel } from "../../student-web/src/learning/review-panel";
import { isDue } from "../../student-web/src/learning/review-schedule";
import { originalLessonHref } from "../../content/student-navigation.ts";
import { localStudyAI, pagesDemo } from "./deployment.ts";
import { StudentHeader } from "./StudentHeader.tsx";
import { courseById, pathways } from "./curriculum.ts";
import { allNotes, courseLink, latestProgress } from "./learning-store.ts";
import { loadLearningPack } from "./learning-packs.ts";
import { ConceptScaffolds } from "./learning/ConceptScaffolds.tsx";
import { flowQuery } from "./learning/lesson-flow.ts";
import type { Lesson, Session } from "./lesson.ts";
import "./teaching.css";

export function hasSavedExplanation(session: Session, comparison = session.comparison?.run) {
  if (!session.run || !comparison) return false;
  try {
    return allNotes(localStorage, session.run.id, comparison.id).some(note =>
      note.evidence?.baseline && note.evidence.comparison && note.choices.join("|") === session.choices.join("|"));
  } catch { return false; }
}

export function LearningObjectives({ lesson, session, explained, compact }: { lesson: Lesson; session: Session; explained: boolean; compact?: boolean }) {
  if (!lesson.casePackage) return null;
  const goals = lesson.casePackage.learningOutcomes;
  const action = session.stage === 1 ? (session.choices.length ? 1 : 0) :
    session.stage === 2 ? 2 : session.stage === 3 ? (session.cursor > 0 ? 4 : 3) : explained ? 6 : session.comparison ? 4 : 5;
  return <details className="trace-details learning-objectives">
    <summary>{compact ? "学习目标" : "学习目标与七个学习动作"}</summary>
    {!compact && <ol className="learning-actions" aria-label="学习动作">
      {["情境", "预测", "行动", "观察", "解释", "反事实", "迁移"].map((label, index) =>
        <li key={label} aria-current={index === action ? "step" : undefined}>{label}</li>)}
    </ol>}
    <ul className="learning-goals">{goals.map(goal => <li key={goal.id}>
      <strong>{goal.performance}</strong><p>{goal.evidence_requirement}</p>
    </li>)}</ul>
  </details>;
}

function useStudyHistory() {
  const [history, setHistory] = useState<Awaited<ReturnType<typeof personalLearning>>>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () => void personalLearning().then(value => {
      if (active) { setHistory(value); setError(false); }
    }).catch(() => { if (active) setError(true); });
    update();
    window.addEventListener("pageshow", update);
    window.addEventListener("ecosimedu-learning-update", update);
    return () => {
      active = false;
      window.removeEventListener("pageshow", update);
      window.removeEventListener("ecosimedu-learning-update", update);
    };
  }, []);
  return { history, error };
}

export function LearningJourney({ caseId, fixedPhase, next }: {
  caseId: string; fixedPhase?: "explain" | "notebook"; next?: ReactNode;
}) {
  const [pack, setPack] = useState<LearningPackage>();
  const [loadError, setLoadError] = useState(false);
  const [phase, setPhase] = useState<"explain" | "notebook">("explain");
  const { history, error } = useStudyHistory();
  useEffect(() => {
    let active = true;
    loadLearningPack(caseId).then(value => { if (active) setPack(value); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [caseId]);

  const attempts = history?.attempts.filter(attempt => attempt.case_id === caseId &&
    attempt.content_version === pack?.content_version) ?? [];
  return <section id="classroom-practice" tabIndex={-1} className="edu-panel teaching-card teaching-journey"
    aria-label="独立练习与学习证据">
    <h2>{fixedPhase === "notebook" ? "在新情境中应用" : "用新题检验你的解释"}</h2>
    <p>练习使用自编情境。看过本题提示或反馈会保留原记录，之后可用另一道平行题提供独立证据。</p>
    {!fixedPhase && <fieldset className="decision-actions study-phase"><legend>学习任务</legend>
      <label><input type="radio" name="journey-phase" checked={phase === "explain"} onChange={() => setPhase("explain")}/> 机制练习与独立应用</label>
      <label><input type="radio" name="journey-phase" checked={phase === "notebook"} onChange={() => setPhase("notebook")}/> 迁移到新情境</label>
    </fieldset>}
    {!pack && !loadError && <p role="status">正在读取本地学习包…</p>}
    {fixedPhase && <ConceptScaffolds caseId={caseId}/>}
    <LearningActivities pack={pack} loadError={loadError} phase={fixedPhase ?? phase} offline/>
    {error && <p role="alert">本地学习证据暂时无法读取。</p>}
    {pack && history && <details className="trace-details" open>
      <summary>本课学习证据</summary>
      <ul className="learning-goals">{pack.outcomes.map(goal => {
        const evidence = outcomeEvidence(goal, attempts);
        const due = history.reviews.find(review => review.outcome_id === goal.id && review.status === "scheduled");
        return <li key={goal.id}><strong>{goal.performance}</strong><p>{
          evidence.evidence_state === "independent_evidence" ? "有独立应用证据" :
            evidence.evidence_state === "practicing" ? "已有练习记录" : "还没有该目标的作答"
        }{evidence.transfer_status === "evidenced" && " · 有独立迁移证据"}{due &&
          (isDue(due, new Date()) ? ` · 待复习，${due.due_at} 到期` : ` · 复习安排在 ${due.due_at}`)}</p>
        {!!evidence.unresolved_misconception_codes.length && <p>最近一次核对有待修正，可回到对应题目或用新题复核。</p>}</li>;
      })}</ul>
    </details>}
    <a href="?view=review">查看本机复习安排</a>
    {next && <div className="decision-actions">{attempts.some(attempt => attempt.assessment_role === "independent") ? next :
      <p>提交一道独立应用题后，可以继续迁移。</p>}</div>}
  </section>;
}

export function HomeStudyActions() {
  const { history, error } = useStudyHistory();
  const checkpoint = (() => {
    try { return latestProgress(localStorage, id => Object.hasOwn(courseById, id)); }
    catch { return undefined; }
  })();
  const recent = history?.attempts.find(attempt => Object.hasOwn(courseById, attempt.case_id));
  const active = checkpoint?.course.caseId ?? recent?.case_id;
  const order = pathways.flatMap(path => path.courses);
  const index = order.findIndex(course => course.id === active);
  const next = index < 0 ? undefined : order[index + 1];
  const due = history?.reviews.filter(review => isDue(review, new Date()))
    .sort((a, b) => a.due_at.localeCompare(b.due_at))[0];

  return <section className="home-study" aria-label="你的学习建议">
    {due && <div className="edu-panel"><h2>复习一道短题</h2><p>{courseById[due.case_id]?.title ?? "已有课程"} · {due.due_at} 到期</p>
      <a href="?view=review">打开复习</a></div>}
    {!checkpoint && recent && <div className="edu-panel"><h2>{pagesDemo ? "继续学习" : "继续原课堂"}</h2><p>{courseById[recent.case_id].title}</p>
      <a href={pagesDemo ? courseLink({ caseId: recent.case_id }) : originalLessonHref(recent.case_id)}>
        {pagesDemo ? "打开四阶课堂" : "打开原进度与作答"}</a></div>}
    {next && <div className="edu-panel"><h2>下一门课程</h2><p>{next.title}</p>
      <a href={courseLink({ caseId: next.id }, checkpoint?.flow ? flowQuery : undefined)}>打开下一课</a></div>}
    <div className="edu-panel"><h2>自由探索</h2><p>按想弄懂的机制选课。</p><a href="#paths">查看所有学习路径</a></div>
    {error && <p role="status">上次作答和复习暂时无法读取，课程仍可正常打开。</p>}
  </section>;
}

const titleForCourse = (caseId: string) => Object.hasOwn(courseById, caseId) ? courseById[caseId].title : undefined;

export function ProgressiveReviewPage() {
  return <><StudentHeader/><ReviewPanel loadPack={loadLearningPack} className="shell lesson-shell teaching-review"
    courseTitle={titleForCourse} catalogHref="./#paths" allowModel={localStudyAI}/></>;
}
