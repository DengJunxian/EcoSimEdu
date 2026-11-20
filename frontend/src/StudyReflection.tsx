import { useState } from "react";
import { originalLessonHref } from "../../content/student-navigation.ts";
import type { EventEnvelope } from "./domain-contracts.ts";
import { sourceLink, type StudentNote } from "./learning-store.ts";
import "./teaching.css";
import { readTeaching, reflectionOptions, saveTeaching, type TeachingRecord } from "./teaching-records.ts";
import { localStudyAI, pagesDemo } from "./deployment.ts";
import { ExplanationReview, supportsExplanationReview } from "./learning/tutor/ExplanationReview.tsx";

function reflection<K extends TeachingRecord["kind"]>(note: StudentNote, kind: K) {
  try { return readTeaching(localStorage, note.course.caseId, note.id, kind); }
  catch { return undefined; }
}

const sameEvent = (left?: { runId: string; eventId: string }, right?: { runId: string; eventId: string }) =>
  !!left && !!right && left.eventId === right.eventId && left.runId === right.runId;

export function StudyReflection({ note, event, comparisonEvent }: {
  note: StudentNote; event?: EventEnvelope; comparisonEvent?: EventEnvelope;
}) {
  const [self, setSelf] = useState(() => reflection(note, "self_assessment")?.answer ?? "");
  const [coach, setCoach] = useState(() => reflection(note, "coach_advice"));
  const [message, setMessage] = useState("");
  const evidence = note.evidence?.baseline;
  const alternate = note.evidence?.comparison;
  const canReview = localStudyAI && supportsExplanationReview(note.course.caseId) && evidence && alternate;
  const verified = sameEvent(coach, evidence) && (!note.fork || sameEvent(coach?.comparison, alternate));
  const canCoach = sameEvent(event, evidence) && (!note.fork || sameEvent(comparisonEvent, alternate));
  const context = () => ({ caseId: note.course.caseId, reference: note.id, savedAt: new Date().toISOString() });

  function saveSelf(value: string) {
    if (!Object.hasOwn(reflectionOptions, value)) return;
    try {
      const answer = value as keyof typeof reflectionOptions;
      saveTeaching(localStorage, { ...context(), kind: "self_assessment", answer });
      setSelf(answer);
      setMessage("自评已保存，独立证据按原作答记录计算。");
    } catch { setMessage("无法保存自评，请重试。"); }
  }

  function askCoach() {
    if (!canCoach || !event || !evidence) return;
    const summary = (event.summary ?? event.kind).slice(0, 180);
    const comparison = note.fork && comparisonEvent && alternate ?
      { runId: alternate.runId, eventId: alternate.eventId } : undefined;
    const record = { ...context(), kind: "coach_advice" as const, eventId: evidence.eventId, runId: evidence.runId,
      ...(comparison && { comparison }),
      advice: comparison && comparisonEvent ?
        `比较基线事件 ${event.eventId}「${summary}」和分支事件 ${comparison.eventId}「${(comparisonEvent.summary ?? comparisonEvent.kind).slice(0, 180)}」。先写出它们各自支持的那部分主张，再核对时点、口径和另一种解释。` :
        `从原事件 ${event.eventId}「${summary}」出发。指出这条记录支持论断的哪一部分，再说说改变哪个条件会使推论失效。` };
    try {
      saveTeaching(localStorage, record);
      setCoach(record);
      setMessage("已保存离线导师建议。");
    } catch { setMessage("导师建议无法保存，请重试。"); }
  }

  return <section className="study-reflection" aria-label="自评与导师建议">
    <h3>自评与导师追问</h3>
    <label>你对这张解释卡的自评
      <select value={self} onChange={event => saveSelf(event.target.value)}>
        <option value="" disabled>选择当前体会</option>
        {Object.entries(reflectionOptions).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
    </label>
    {canCoach && <button type="button" onClick={askCoach}>{note.fork ? "用两条原证据生成自查" : "用原事件生成离线建议"}</button>}
    {verified && coach && <p>{coach.advice} <a href={sourceLink(note, "baseline")}>核对建议的原事件</a>
      {coach.comparison && <> <a href={sourceLink(note, "comparison")}>核对建议的分支事件</a></>}</p>}
    {canReview && <ExplanationReview note={note}/>}
    {!canReview && event && !note.fork && !pagesDemo && <details><summary>可选在线导师</summary>
      <p>原实验室的在线导师可在启用后，从服务器已核对的运行证据中选择追问。课堂作答由原评估器核对。</p>
      <a href={originalLessonHref(note.course.caseId)}>打开原实验室的学习助手</a>
    </details>}
    {message && <p role="status">{message}</p>}
  </section>;
}
