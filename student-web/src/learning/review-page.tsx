import { catalog, caseHref, paths, preferredPath } from "../catalog";
import { api } from "../contracts";
import type { LearningPackage } from "./education-types";
import { ReviewPanel, usePersonalLearning } from "./review-panel";
import { isDue } from "./review-schedule";

export function HomeLearningActions() {
  const { learning, error } = usePersonalLearning();
  const chosen = preferredPath();
  const last = chosen ? learning?.attempts.find(item => chosen.cases.includes(item.case_id)) : learning?.attempts[0];
  if (error) return <p className="callout">{error}</p>;
  if (!learning || (!last && !chosen && !learning.reviews.length)) return null;
  const due = learning.reviews.find(entry => isDue(entry, new Date()));
  const path = chosen ?? (last && paths.find(path => path.cases.includes(last.case_id)));
  const index = last && path ? path.cases.indexOf(last.case_id) : -1;
  const next = path && catalog.find(course => course.case_id === path.cases[index + 1]);
  return <>
    {due && <section className="app-resume"><div><h2>复习一道短题</h2>
      <p>{catalog.find(course => course.case_id === due.case_id)?.title} · 上次作答后安排，{due.due_at} 到期</p></div>
      <a className="app-button" href="/review">打开复习</a></section>}
    {next && <section className="app-resume"><div><h2>沿学习路径继续</h2>
      <p>{next.title} · {chosen ? "你选择了" : "你最近练习的课程属于"}「{path!.title}」</p></div>
      <a className="app-button" href={caseHref(next.case_id)}>查看下一课</a></section>}
  </>;
}

const fetchReviewPack = (caseId: string, signal: AbortSignal) =>
  api<LearningPackage>(`/cases/${caseId}/lesson?schema_version=3`, undefined, signal);

const courseTitle = (caseId: string) => catalog.find(course => course.case_id === caseId)?.title;

export function ReviewPage() {
  return <ReviewPanel loadPack={fetchReviewPack} className="container app-page app-inner"
    courseTitle={courseTitle} catalogHref="/cases"/>;
}
