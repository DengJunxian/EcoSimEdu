import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { courseById } from "./curriculum.ts";
import { displayObservation, frameLabel, type Lesson } from "./lesson.ts";
import { allNotes, exportProgressArchive, notesLink, readNote, sourceLink, sourceRun, trendLabel } from "./learning-store.ts";
import type { AuctionRun } from "./auction.ts";
import { bankEventValues, seedEvidence } from "./run-evidence.ts";
import { studentRoutes } from "../../content/student-navigation.ts";
import { StudentHeader } from "./StudentHeader.tsx";
import { EvidenceCard, PageTitle, StatusNotice } from "../../content/student-ui.tsx";
import { StudyReflection } from "./StudyReflection.tsx";
import { profileId } from "../../student-web/src/learning/learner-repository";

const archiveModule = () => import("./study-archive.ts");

const TransferRecord = lazy(() => import("./FlagshipTransfer.tsx").then(module => ({ default: module.FlagshipTransfer })));
const otherFlagships = ["schelling_segregation", "double_auction"] as const;

function listNotes() {
  try { return allNotes(localStorage).filter(note => Object.hasOwn(courseById, note.course.caseId)); }
  catch { return []; }
}

function ProgressBackup({ onRestore }: { onRestore: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function downloadFile(raw: string, name: string) {
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function download(kind: "progressive" | "full" | "recovery") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (kind !== "progressive") {
        const profile = await profileId(false);
        const { exportStudy, latestRecovery } = await archiveModule();
        if (kind === "recovery") {
          const snapshot = await latestRecovery(profile);
          if (!snapshot) throw new Error("此浏览器还没有导入前快照。");
          downloadFile(snapshot.raw, "ecosimedu-导入前快照.json");
        } else {
          downloadFile(JSON.stringify(await exportStudy(localStorage, profile)), "ecosimedu-完整学习档案.json");
        }
        setMessage("学习档案已导出。");
        return;
      }
      const archive = exportProgressArchive(localStorage);
      const { readFlagshipTransfer } = await import("./flagship-study.ts");
      const results = await Promise.allSettled((["svb_run", ...otherFlagships] as const).map(readFlagshipTransfer));
      if (results.some(entry => entry.status === "rejected"))
        setError("部分迁移作答无法读取。续学位置和解释仍会导出。");
      const attempts = results.map(entry => entry.status === "fulfilled" ? entry.value.attempts : []);
      const svbTransfer = attempts[0].length ? attempts[0] : undefined;
      const flagshipTransfers = attempts.slice(1).flat();
      downloadFile(JSON.stringify({
        ...archive, svbTransfer, ...(flagshipTransfers.length ? { flagshipTransfers } : {}),
      }), "ecosimedu-四阶学习备份.json");
      setMessage(`已导出 ${archive.entries.length} 条四阶记录。`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "无法读取本浏览器的学习档案。");
    } finally { setBusy(false); }
  }

  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    const form = event.currentTarget;
    const file = new FormData(form).get("archive");
    let backedUp = false;
    try {
      if (!(file instanceof File) || !file.size || file.size > 20_000_000) {
        throw new Error("请选择不超过 20 MB 的 EcoSimEdu 学习档案。");
      }
      const profile = await profileId(false);
      const { snapshotBeforeImport, isStudyBundle, isIndexedArchive, restoreStudy, restoreWithProgress } = await archiveModule();
      const before = await snapshotBeforeImport(localStorage, profile);
      backedUp = true;
      let data: unknown;
      try { data = JSON.parse(await file.text()); }
      catch { throw new Error("文件无法读取。请选择 EcoSimEdu 学习档案 JSON。"); }
      if (isStudyBundle(data) || isIndexedArchive(data)) {
        const restored = await restoreStudy(localStorage, profile, data);
        const { indexed, progressive, teaching } = restored;
        const conflicts = (progressive?.conflicts ?? 0) + (teaching?.conflicts ?? 0);
        setMessage(`档案已导入：${indexed?.restored ?? 0} 次作答、${indexed?.restoredRecords ?? 0} 条活动或复习、${(progressive?.restored ?? 0) + (teaching?.restored ?? 0)} 条进度或反馈。` +
          (indexed?.preservedVersions ? ` 已归档 ${indexed.preservedVersions} 次旧版作答。` : "") +
          (conflicts ? ` ${conflicts} 条记录有冲突，已保留本地原记录。` : ""));
      } else {
        const svb = data && typeof data === "object" && "svbTransfer" in data ? data.svbTransfer : undefined;
        const others = data && typeof data === "object" && "flagshipTransfers" in data ? data.flagshipTransfers : undefined;
        const { verifiedFlagshipTransfers } = await import("./flagship-study.ts");
        const bank = svb === undefined ? [] : verifiedFlagshipTransfers(svb, ["svb_run"]);
        const remaining = others === undefined ? [] : verifiedFlagshipTransfers(others, otherFlagships);
        const attempts = [...bank, ...remaining];
        const { progressive } = await restoreWithProgress(localStorage, profile, data, attempts.length ? {
          kind: "ecosimedu-learning-export", schema_version: 1, attempts,
        } : undefined);
        const priorIds = new Set(before.attempts.map(attempt => attempt.id));
        const bankAdded = bank.filter(attempt => !priorIds.has(attempt.id)).length;
        const otherAdded = remaining.filter(attempt => !priorIds.has(attempt.id)).length;
        setMessage(`已导入 ${progressive.restored} 条，已有 ${progressive.existing} 条。` +
          (progressive.conflicts ? ` ${progressive.conflicts} 条与本地记录不同，已保留本地记录。` : "") +
          (bankAdded ? ` 青湾银行新增 ${bankAdded} 次作答。` : "") +
          (otherAdded ? ` 拍卖与居住隔离新增 ${otherAdded} 次作答。` : ""));
      }
      onRestore();
      form.reset();
    } catch (problem) {
      setError((problem instanceof Error ? problem.message : "导入失败，请保留源文件。") +
        (backedUp ? " 可下载导入前快照。" : ""));
    } finally {
      setBusy(false);
    }
  }

  return <details className="trace-details progress-backup">
    <summary>备份与导入四阶学习</summary>
    <p>完整档案包含四阶进度、解释、原实验室作答、复习和帮助记录。导入先保存本机快照。</p>
    <div className="decision-actions">
      <button type="button" onClick={() => void download("full")} disabled={busy}>导出完整学习档案</button>
      <button type="button" onClick={() => void download("progressive")} disabled={busy}>导出四阶学习备份</button>
      <button type="button" onClick={() => void download("recovery")} disabled={busy}>导出导入前快照</button>
    </div>
    <form onSubmit={restore}>
      <label>四阶学习备份 <input type="file" name="archive" accept=".json,application/json" required disabled={busy}/></label>
      <button disabled={busy}>导入四阶学习备份</button>
    </form>
    <p role="status">{message}</p>
    {error && <p role="alert">{error}</p>}
  </details>;
}

export function StudentNotes({ id }: { id: string | null }) {
  const [notes, setNotes] = useState(listNotes);
  const [revision, setRevision] = useState(0);
  const opened = notes.find(note => note.id === id);
  return <>
    <StudentHeader/>
    <main className="shell lesson-shell student-notes" id="main" tabIndex={-1}>
      <PageTitle>实验笔记</PageTitle>
      <nav className="note-links" aria-label="笔记入口">
        {id && <a href={notesLink()}>全部解释</a>}
        <a href={studentRoutes.notes}>原版实验笔记与学习记录</a>
      </nav>
      {!id && <ProgressBackup onRestore={() => { setNotes(listNotes()); setRevision(value => value + 1); }}/>}
      {id && !opened && <StatusNotice tone="warning">这份解释在当前浏览器中不可用。可回到全部解释查找。</StatusNotice>}
      {!id && !notes.length && <p className="edu-status">在课堂完成政策对照并保存解释后，可在这里回查。<a href="./#paths">去选一门课</a></p>}
      <ol className="note-list">{(opened ? [opened] : notes).map(note => (
        <li key={note.id}>
          <h2>{courseById[note.course.caseId].title}
            {note.course.caseId === "svb_run" && (note.comparisonId.endsWith("/network") ? " · 分散信息来源" : " · 提高现金缓冲")}</h2>
          <p><time dateTime={note.savedAt}>{new Date(note.savedAt).toLocaleString()}</time> · 原政策预测：{trendLabel[note.prediction]}</p>
          {opened ? <dl className="note-text">
            <dt>我的主张</dt><dd>{note.claim ?? note.comparison}</dd>
            <dt>模型规则</dt><dd>{note.rule}</dd>
            <dt>算术核对</dt><dd>{note.calculation}</dd>
            {note.claim && note.claim !== note.comparison && <><dt>配对差异</dt><dd>{note.comparison}</dd></>}
            <dt>现实假设</dt><dd>{note.hypothesis}</dd>
          </dl> : <p><a href={notesLink(note.id)}>打开已保存的解释</a></p>}
          <div className="note-links">
            <a href={sourceLink(note, "baseline")}>查看基线原事件 {note.evidence?.baseline?.eventId ?? note.baselineEvent}</a>
            <a href={sourceLink(note, "comparison")}>查看政策组原事件 {note.evidence?.comparison?.eventId ?? note.comparisonEvent}</a>
          </div>
          {opened && <StudyReflection key={note.id} note={note}/>}
        </li>
      ))}</ol>
      {!id && <Suspense fallback={null}><div key={revision} className="flagship-records">
        <TransferRecord caseId="svb_run" recordOnly/>
        {otherFlagships.map(caseId => <TransferRecord caseId={caseId} key={caseId} recordOnly/>)}
      </div></Suspense>}
    </main>
  </>;
}

export function SavedSource({ lesson, id, side, caseId, market }: {
  lesson: Lesson; id: string; side: "baseline" | "comparison"; caseId: string; market?: "no-overlap";
}) {
  const [source, setSource] = useState<Awaited<ReturnType<typeof sourceRun>> | null>(null);
  useEffect(() => {
    let current = true;
    async function restore() {
      try {
        const note = readNote(localStorage, id);
        const result = note?.course.caseId === caseId && note.course.market === market
          ? await sourceRun(lesson, note, side) : undefined;
        if (current) setSource(result);
      } catch {
        if (current) setSource(undefined);
      }
    }
    void restore();
    return () => { current = false; };
  }, [lesson, id, side, caseId, market]);

  if (!source) return <><StudentHeader caseId={caseId}/>
    <main className="shell lesson-shell student-notes" id="main" tabIndex={-1}>
      {source === null ? <StatusNotice>正在核对原运行与事件…</StatusNotice> : <>
        <PageTitle>原证据不可验证</PageTitle>
        <StatusNotice tone="warning">此浏览器缺少对应解释，或当前运行的版本、事件或结果摘要与原记录不匹配。</StatusNotice>
        <a href={notesLink(id)}>返回已保存的解释</a>
      </>}
    </main>
  </>;
  const { run, tick, event } = source;
  const frame = run.frames[tick];
  const evidence = seedEvidence(run, tick);
  const auction = "quotes" in run ? run as AuctionRun : undefined;
  const trade = auction?.frames[tick].record;
  const selected = caseId === "svb_run" && event ? frame.events.find(item => item.id === event.eventId) : undefined;
  const orders = [trade?.buy_order_id, trade?.sell_order_id].flatMap(id => id && auction?.quotes[id] ? [auction.quotes[id]] : []);
  return <>
    <StudentHeader caseId={caseId}/>
    <main className="shell lesson-shell student-notes" id="main" tabIndex={-1}>
      <a href={notesLink(id)}>返回已保存的解释</a>
      <PageTitle>{side === "baseline" ? "基线" : "政策组"}{event ? "原事件" : "原轮次"} · {
        selected ? `${frameLabel(lesson.tickUnit, tick)} · ${selected.id}` : frameLabel(lesson.tickUnit, tick)}</PageTitle>
      <p>{courseById[caseId]?.title} · 种子 {run.seed}</p>
      <p className="run-identity">运行编号 <code>{evidence.runId}</code></p>
      <p>{source.verification === "legacy" ? "与基线版本的运行摘要一致" : "已核对保存的版本与运行摘要"}</p>
      <EvidenceCard label="原始记录">
      <h2>原始记录</h2>
      <p>{selected?.text ?? frame.events[0]?.text ?? evidence.event.summary}</p>
      {!!event?.actorIds.length && <p>涉及主体 {event.actorIds.join("、")}</p>}
      {!!event?.sourceEvents.length && <p>原来源事件 {event.sourceEvents.map(ref => ref.eventId).join("、")}</p>}
      {!event && <p>旧笔记引用这一轮。轮内具体子事件没有保存在原引用中。</p>}
      {selected && Object.entries(selected.deltas).map(([key, value]) => <p key={key}>本事件变化 · {
        lesson.casePackage?.metrics.find(metric => metric.id === key)?.label ?? key} {displayObservation(value)}</p>)}
      {orders.length > 0 && <ul>
        {orders.map(order => <li key={order.order_id}>{order.order_id} · {order.actor_id} 报 {order.price} 代币
          {order.order_id === trade?.maker_order_id && " · 在簿定价"}</li>)}
      </ul>}
      {frame.events.length > 1 && <details className="trace-details">
        <summary>查看同一时点的主体与关系记录</summary>
        <ul>{frame.events.slice(1).map(event => <li key={event.id}>{event.text}</li>)}</ul>
      </details>}
      {frame.equations && <ul>{frame.equations.map(equation => <li key={equation}>{equation}</li>)}</ul>}
      </EvidenceCard>
      <table className="source-metrics">
        <caption>{caseId === "svb_run" && !selected ? "该轮开始与结束的数值" : "原事件前后数值"}</caption>
        <thead><tr><th scope="col">指标</th><th scope="col">之前</th><th scope="col">之后</th></tr></thead>
        <tbody>{lesson.metrics.map(metric => {
          const values = selected ? bankEventValues(frame, run.frames[tick - 1], selected.id, metric.id) :
            { before: evidence.before?.[metric.id], after: evidence.after[metric.id] };
          return <tr key={metric.id}>
            <th scope="row">{metric.label}{metric.unit ? `（${metric.unit}）` : ""}</th>
            <td>{displayObservation(values?.before)}</td><td>{displayObservation(values?.after)}</td>
          </tr>;
        })}</tbody>
      </table>
    </main>
  </>;
}
