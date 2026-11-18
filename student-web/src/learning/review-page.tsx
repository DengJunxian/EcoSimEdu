import { useEffect, useState } from "react";
import { catalog, caseHref, paths, preferredPath } from "../catalog";
import { api } from "../contracts";
import { orderedOptions } from "./assessment";
import { AssessmentRenderer } from "./assessment-renderer";
import type { Attempt, LearningPackage, Response } from "./education-types";
import { emptySession, expose, markUnsavedExposure, profileId, result, submitAttempt, transact } from "./learner-repository";
import { futureLocalDay, isDue, type ReviewSchedule } from "./review-schedule";
import "./education.css";

async function personalLearning() {
  const profile = await profileId(false);
  return transact(["reviews", "attempts"], "readonly", async tx => {
    const reviews = (await result(tx.objectStore("reviews").getAll()) as ReviewSchedule[]).filter(entry => entry.profile === profile);
    const attempts = (await result(tx.objectStore("attempts").getAll()) as Attempt[])
      .filter(entry => entry.local_profile_id === profile)
      .sort((left, right) => right.submitted_at.localeCompare(left.submitted_at));
    return { profile, reviews, attempts };
  });
}

function usePersonalLearning() {
  const [learning, setLearning] = useState<Awaited<ReturnType<typeof personalLearning>>>();
  const [error, setError] = useState("");
  const [refreshing, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    void personalLearning().then(data => { if (active) setLearning(data); }).catch(() => {
      if (active) setError("暂时无法读取浏览器学习记录。可继续访问案例库。");
    });
    return () => { active = false; };
  }, [refreshing]);
  return { learning, error, refresh: () => refresh(value => value + 1) };
}

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

export function ReviewPage() {
  const { learning, error, refresh } = usePersonalLearning();
  const [pack, setPack] = useState<LearningPackage>();
  const [feedback, setFeedback] = useState("");
  const [hint, setHint] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [days, setDays] = useState(1);
  const now = new Date();
  const due = learning?.reviews.filter(entry => isDue(entry, now)).sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
  const queued = learning?.reviews.filter(entry => entry.status !== "completed") ?? [];
  const activity = pack?.case_id === due?.case_id && pack?.content_version === due?.content_version
    ? pack?.activities.find(entry => entry.kind === "review" && entry.outcome_ids.includes(due!.outcome_id)) : undefined;
  const item = pack?.items.find(entry => entry.id === activity?.content_ref);
  const session = pack && learning ? emptySession(pack, learning.profile) : undefined;
  const options = item && learning ? orderedOptions(item, learning.profile) : [];
  const dueCase = due?.case_id;
  useEffect(() => {
    setPack(undefined);
    setHint(undefined);
    if (!dueCase) return;
    const controller = new AbortController();
    api<LearningPackage>(`/cases/${dueCase}/lesson?schema_version=3`, undefined, controller.signal).then(setPack)
      .catch(() => { if (!controller.signal.aborted) setStatus("当前复习题暂时无法读取。"); });
    return () => controller.abort();
  }, [dueCase]);

  async function update(schedule: ReviewSchedule, status: ReviewSchedule["status"], due_at = schedule.due_at) {
    setBusy(true);
    setStatus("");
    try {
      await transact(["reviews"], "readwrite", async tx => {
        const store = tx.objectStore("reviews");
        const current = await result(store.get(schedule.id)) as ReviewSchedule | undefined;
        if (!current || current.status !== schedule.status || current.due_at !== schedule.due_at) {
          throw new Error("复习安排已在另一页面更新。");
        }
        await result(store.put({ ...current, status, due_at }));
      });
      setHint(undefined);
      setFeedback("");
      refresh();
    } catch (problem) {
      setStatus(problem instanceof Error ? problem.message : "复习安排未保存。");
      refresh();
    }
    finally { setBusy(false); }
  }

  async function submit(response: Response) {
    if (!session || !activity || !item || !due) return;
    setBusy(true);
    try {
      await submitAttempt(session, activity, item, response, options.map(option => option.id), due.id);
      setFeedback(item.feedback.explanation);
      refresh();
    } catch { setStatus("复习作答未保存。"); }
    finally { setBusy(false); }
  }

  return <main id="main" tabIndex={-1} className="container app-page app-inner">
    <h1>复习</h1>
    <p>独立练习后，次日安排一道新题。可推迟或暂停，历史学习证据随原记录保存。</p>
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {learning && !due && <p>{queued.length ? "当前没有到期的复习。" : "做过一次独立题后，可在此找下一道复习题。"}</p>}
    {due && session && activity && item && !feedback && <section className="education-task">
      <h2>{catalog.find(course => course.case_id === due.case_id)?.title}</h2>
      <AssessmentRenderer key={item.id} item={item} options={options} busy={busy} onSubmit={response => void submit(response)}/>
      {hint === due.id && <p role="status">{item.feedback.hint}</p>}
      <button type="button" disabled={busy} onClick={() => void (async () => {
        setBusy(true);
        try { await expose(session, item, "hint"); }
        catch { markUnsavedExposure(session, item); setStatus("帮助记录未能保存，本题会标记为辅助。"); }
        finally { setBusy(false); setHint(due.id); }
      })()}>看复习提示</button>
    </section>}
    {feedback && due && <button onClick={() => setFeedback("")}>继续下一道复习</button>}
    {due && pack && !item && <p>这项复习关联旧内容版本。可打开原课程记录，或暂停此项复习。</p>}
    {!!queued.length && <section><h2>复习安排</h2>
      <label>推迟天数 <select value={days} onChange={event => setDays(Number(event.target.value))}>
        <option value={1}>1 天</option><option value={7}>7 天</option><option value={21}>21 天</option>
      </select></label>
      <ul className="education-evidence">{queued.map(entry => <li key={entry.id}>
        <span>{catalog.find(course => course.case_id === entry.case_id)?.title} · {entry.due_at} ·
          {entry.status === "paused" ? "已暂停" : isDue(entry, now) ? "已到期" : "待复习"}</span>
        <div className="toolbar">
          <button disabled={busy} onClick={() => void update(entry, "scheduled", futureLocalDay(now, days))}>推迟复习</button>
          <button disabled={busy} onClick={() => void update(entry, entry.status === "paused" ? "scheduled" : "paused")}>
            {entry.status === "paused" ? "恢复复习" : "暂停复习"}
          </button>
        </div>
      </li>)}</ul>
    </section>}
    <a href="/cases">去案例库</a>
  </main>;
}
