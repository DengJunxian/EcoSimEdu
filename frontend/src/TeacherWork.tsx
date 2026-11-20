import { useEffect, useRef, useState, type FormEvent } from "react";
import { EvidenceCard, PageTitle, StatusNotice } from "../../content/student-ui.tsx";
import { auctionLesson } from "./auction.ts";
import type { Evidence, RunEnvelope } from "./domain-contracts.ts";
import { chartMetric, displayObservation, frameLabel, legalPolicy, type Lesson } from "./lesson.ts";
import { sourceRun, trendLabel, type CourseRef, type Explanation, type StudentNote } from "./learning-store.ts";
import { evidencePointer } from "./run-evidence.ts";
import { StudentHeader } from "./StudentHeader.tsx";

const fields = [["claim", "主张"], ["rule", "模型规则"], ["calculation", "算术核对"],
  ["comparison", "配对差异"], ["hypothesis", "现实假设"]] as const;

type Imported = {
  schema?: unknown;
  caseId?: unknown;
  origin?: unknown;
  choices: StudentNote["choices"];
  policyPrediction: StudentNote["prediction"];
  explanation: Explanation;
  runEnvelopes: RunEnvelope[];
  sourceEvidence: Evidence[];
};

async function verifyWork(lesson: Lesson, course: CourseRef, file: File) {
  if (!file.size || file.size > 40 * 1024 * 1024) throw new Error("File size outside supported range");
  const work = JSON.parse(await file.text()) as Imported;
  if (!work || work.schema !== "ecosimedu.progressive.work/v1" || work.origin !== "browser_rule_engine" ||
      work.caseId !== course.caseId || !work.explanation ||
      !Array.isArray(work.sourceEvidence) || work.sourceEvidence.length !== 2 ||
      !Array.isArray(work.runEnvelopes) || work.runEnvelopes.length !== 2 ||
      !Object.hasOwn(trendLabel, work.policyPrediction) ||
      !fields.every(([key]) => key === "claim" && work.explanation[key] === undefined ||
        typeof work.explanation[key] === "string" && work.explanation[key]!.trim().length > 0 &&
        work.explanation[key]!.length <= 1000)) throw new Error("Unsupported work");
  const [base, comparison] = work.sourceEvidence.map(evidencePointer);
  if (work.runEnvelopes[0]?.runId !== base.runId || work.runEnvelopes[1]?.runId !== comparison.runId) {
    throw new Error("Inconsistent run references");
  }
  const policy = work.runEnvelopes[1]?.inputs?.policy;
  const model = course.caseId === "double_auction" && base.runId?.split("/")[3] === "boundary"
    ? auctionLesson(true) : lesson;
  if (typeof policy !== "number" || !legalPolicy(model, policy)) throw new Error("Illegal policy");
  const note: StudentNote = { ...work.explanation, id: "teacher-import", course, savedAt: "",
    choices: work.choices, prediction: work.policyPrediction, policy,
    baselineId: base.runId, comparisonId: comparison.runId, evidence: { baseline: base, comparison } };
  const sides = await Promise.all([sourceRun(model, note, "baseline"), sourceRun(model, note, "comparison")]);
  if (!sides[0]?.event || !sides[1]?.event) throw new Error("Unverified sources");
  return { note, sides: [{ ...sides[0], event: sides[0].event }, { ...sides[1], event: sides[1].event }] };
}

export function TeacherWork({ lesson, course }: { lesson: Lesson; course: CourseRef }) {
  const metric = chartMetric(lesson);
  const [result, setResult] = useState<Awaited<ReturnType<typeof verifyWork>>>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);
  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const file = new FormData(event.currentTarget).get("work");
    if (!(file instanceof File)) return;
    setError(false);
    setBusy(true);
    try {
      setResult(await verifyWork(lesson, course, file));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return <><StudentHeader caseId={course.caseId}/>
    <main className="shell lesson-shell student-notes" id="main" tabIndex={-1}>
      <a href={`/teach?case=${course.caseId}`}>返回教师工作台</a>
      <PageTitle>{lesson.casePackage?.title} · 查看学生解释作品</PageTitle>
      <p>选择学生通过「导出含解释的结果」下载的 JSON。本页会在当前浏览器复算两组运行并核对引用。</p>
      <form onSubmit={open} className="progress-backup">
        <label>学生解释作品<input type="file" name="work" accept=".json,application/json" required/></label>
        <button type="submit" className="primary" disabled={busy}>核对并查看作品</button>
      </form>
      {busy && <StatusNotice>正在复算两组运行…</StatusNotice>}
      {error && <StatusNotice tone="error">无法核对这份作品及两条来源。请选择本课导出的解释 JSON。</StatusNotice>}
      {result && <>
        <h2 ref={resultHeading} tabIndex={-1}>已核对两条运行来源</h2>
        <p>原政策预测 {trendLabel[result.note.prediction]}</p>
        <dl className="note-text">{fields.map(([key, label]) => result.note[key] &&
          <div key={key}><dt>{label}</dt><dd>{result.note[key]}</dd></div>)}</dl>
        {result.sides.map(({ run, tick, event }, index) =>
          <EvidenceCard key={run.id} label={index ? "政策组原事件" : "基线原事件"}>
            <h3>{index ? "政策组" : "基线"} · {frameLabel(lesson.tickUnit, tick)} · {event.eventId}</h3>
            <p className="run-identity">运行编号 <code>{run.id}</code></p>
            <p>{event.summary}</p>
            <p>{lesson.tickUnit === "event" ? "事件" : "轮次"}前后 · {metric.label} · {displayObservation(run.frames[tick - 1]?.metrics[metric.id])} → {
              displayObservation(run.frames[tick].metrics[metric.id])}</p>
          </EvidenceCard>)}
      </>}
    </main>
  </>;
}
