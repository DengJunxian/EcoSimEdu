import { useEffect, useId, useState } from "react";
import { orderedOptions } from "./assessment";
import { AssessmentRenderer } from "./assessment-renderer";
import type { Attempt, LearningPackage, Response } from "./education-types";
import { emptySession, expose, markUnsavedExposure, profileId, result, submitAttempt, transact } from "./learner-repository";
import { localReviewChoice, reviewChoices, reviewSignal } from "./review-choice";
import { futureLocalDay, isDue, type ReviewSchedule } from "./review-schedule";
import "./education.css";

export async function personalLearning() {
  const profile = await profileId(false);
  return transact(["reviews", "attempts"], "readonly", async tx => {
    const reviews = (await result(tx.objectStore("reviews").getAll()) as ReviewSchedule[]).filter(entry => entry.profile === profile);
    const attempts = (await result(tx.objectStore("attempts").getAll()) as Attempt[])
      .filter(entry => entry.local_profile_id === profile)
      .sort((left, right) => right.submitted_at.localeCompare(left.submitted_at));
    return { profile, reviews, attempts };
  });
}

export function usePersonalLearning() {
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

export function ReviewPanel({ loadPack, className, courseTitle, catalogHref, allowModel = false }: {
  loadPack: (caseId: string, signal: AbortSignal) => Promise<LearningPackage>;
  className: string;
  courseTitle: (caseId: string) => string | undefined;
  catalogHref: string;
  allowModel?: boolean;
}) {
  const { learning, error, refresh } = usePersonalLearning();
  const [pack, setPack] = useState<LearningPackage>();
  const [feedback, setFeedback] = useState("");
  const [hint, setHint] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [days, setDays] = useState(1);
  const [selection, setSelection] = useState<{ key: string; itemId: string }>();
  const [modelMessage, setModelMessage] = useState<{ key: string; text: string }>();
  const consentId = useId();
  const now = new Date();
  const due = learning?.reviews.filter(entry => isDue(entry, now)).sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
  const queued = learning?.reviews.filter(entry => entry.status !== "completed") ?? [];
  const choices = pack && due ? reviewChoices(pack, due) : [];
  const signal = due && learning ? reviewSignal(due, learning.attempts) : undefined;
  const reviewKey = due ? JSON.stringify([due.id, due.due_at]) : "";
  const chosen = selection?.key === reviewKey ? choices.find(({ item }) => item.id === selection.itemId) : undefined;
  const selected = chosen ?? localReviewChoice(choices, signal);
  const { activity, item } = selected ?? {};
  const hintKey = item && JSON.stringify([reviewKey, item.id]);
  const session = pack && learning ? emptySession(pack, learning.profile) : undefined;
  const options = item && learning ? orderedOptions(item, learning.profile) : [];
  const dueCase = due?.case_id;
  useEffect(() => {
    setPack(undefined);
    setHint(undefined);
    if (!dueCase) return;
    const controller = new AbortController();
    loadPack(dueCase, controller.signal).then(value => { if (!controller.signal.aborted) setPack(value); })
      .catch(() => { if (!controller.signal.aborted) setStatus("当前复习题暂时无法读取。"); });
    return () => controller.abort();
  }, [dueCase, loadPack]);

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
      setSelection(undefined);
      setModelMessage(undefined);
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
      await submitAttempt(session, activity, item, response, options.map(option => option.id), due);
      setFeedback(item.feedback.explanation);
      refresh();
    } catch {
      setStatus("复习作答未保存，请核对当前安排。");
      refresh();
    }
    finally { setBusy(false); }
  }

  async function recommend() {
    if (!due || !signal || choices.length < 2) return;
    const report = (text: string) => setModelMessage({ key: reviewKey, text });
    setBusy(true);
    report("正在请求推荐。");
    try {
      const response = await fetch("/api/ai/review/recommendation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, case_id: due.case_id, content_version: due.content_version,
          outcome_id: due.outcome_id, signal }),
      });
      if (!response.ok) throw new Error("Recommendation unavailable");
      const answer = await response.json();
      if (answer.mode !== "ai" || !choices.some(({ item }) => item.id === answer.item_id)) {
        report(answer.reason === "not_connected" ? "可先连接 AI，或继续当前复习题。" : "AI 推荐暂不可用，可继续当前复习题。");
        return;
      }
      setSelection({ key: reviewKey, itemId: answer.item_id });
      report(answer.item_id === item?.id ? "AI 推荐做当前这道题。" : "已切换到 AI 推荐的题目。");
    } catch { report("AI 推荐暂不可用，可继续当前复习题。"); }
    finally { setBusy(false); }
  }

  return <main id="main" tabIndex={-1} className={className}>
    <h1>复习</h1>
    <p>独立练习后，次日安排一道新题。可推迟或暂停，历史学习证据随原记录保存。</p>
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {learning && !due && <p>{queued.length ? "当前没有到期的复习。" : "做过一次独立题后，可在此找下一道复习题。"}</p>}
    {due && session && activity && item && !feedback && <section className="education-task">
      <h2>{courseTitle(due.case_id)}</h2>
      {!chosen && item.id === "review-1-reinforce" && <p>{
        signal?.result === "incorrect" ? "上次作答有待核对。" : signal?.used_hint ? "上次作答用过提示。" :
          signal?.evidence === "repeated" ? "上次是同题重做。" : "上次作答的独立性待确认。"
      }用一道平行题再练同一目标。</p>}
      {allowModel && signal && choices.length > 1 && <details>
        <summary>AI 推荐复习题</summary>
        <p id={consentId}>请求会发送学习目标、上次作答正误及帮助使用情况，可能产生费用。</p>
        <button type="button" aria-describedby={consentId} disabled={busy || hint === hintKey}
          onClick={() => void recommend()}>请 AI 选题</button>
        <p role="status">{modelMessage?.key === reviewKey && modelMessage.text}</p>
      </details>}
      <AssessmentRenderer key={hintKey} item={item} options={options} busy={busy} onSubmit={response => void submit(response)}/>
      {hint === hintKey && <p role="status">{item.feedback.hint}</p>}
      <button type="button" disabled={busy} onClick={() => void (async () => {
        setBusy(true);
        try { await expose(session, item, "hint"); }
        catch { markUnsavedExposure(session, item); setStatus("帮助记录未能保存，本题会标记为辅助。"); }
        finally { setBusy(false); setHint(hintKey); }
      })()}>看复习提示</button>
    </section>}
    {feedback && due && <button onClick={() => setFeedback("")}>继续下一道复习</button>}
    {due && pack && !item && <p>这项复习关联旧内容版本。可打开原课程记录，或暂停此项复习。</p>}
    {!!queued.length && <section><h2>复习安排</h2>
      <label>推迟天数 <select value={days} onChange={event => setDays(Number(event.target.value))}>
        <option value={1}>1 天</option><option value={7}>7 天</option><option value={21}>21 天</option>
      </select></label>
      <ul className="education-evidence">{queued.map(entry => <li key={entry.id}>
        <span>{courseTitle(entry.case_id)} · {entry.due_at} ·
          {entry.status === "paused" ? "已暂停" : isDue(entry, now) ? "已到期" : "待复习"}</span>
        <div className="toolbar">
          <button disabled={busy} onClick={() => void update(entry, "scheduled", futureLocalDay(now, days))}>推迟复习</button>
          <button disabled={busy} onClick={() => void update(entry, entry.status === "paused" ? "scheduled" : "paused")}>
            {entry.status === "paused" ? "恢复复习" : "暂停复习"}
          </button>
        </div>
      </li>)}</ul>
    </section>}
    <a href={catalogHref}>去案例库</a>
  </main>;
}
