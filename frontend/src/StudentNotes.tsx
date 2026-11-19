import { useState } from "react";
import { courseById } from "./curriculum.ts";
import { displayNumber, frameLabel, type Lesson } from "./lesson.ts";
import { allNotes, notesLink, readNote, sourceLink, sourceRun, trendLabel } from "./learning-store.ts";
import type { AuctionRun } from "./auction.ts";
import { seedEvidence } from "./run-evidence.ts";

export function StudentNotes({ legacyOrigin, id }: { legacyOrigin: string; id: string | null }) {
  const [notes] = useState(() => {
    try { return allNotes(localStorage).filter(note => Object.hasOwn(courseById, note.course.caseId)); }
    catch { return []; }
  });
  const opened = notes.find(note => note.id === id);
  return <>
    <header className="site-header"><div className="shell">
      <a className="brand" href="./">EcoSimEdu</a><a href="./#paths">学习路径</a>
    </div></header>
    <main className="shell lesson-shell student-notes">
      <h1>实验笔记</h1>
      <nav className="note-links" aria-label="笔记入口">
        {id && <a href={notesLink()}>全部解释</a>}
        <a href={`${legacyOrigin}/notes`}>原版实验笔记与学习记录</a>
      </nav>
      {id && !opened && <p role="status">这份解释在当前浏览器中不可用。可回到全部解释查找。</p>}
      {!id && !notes.length && <p>在课堂完成政策对照并保存解释后，可在这里回查。<a href="./#paths">去选一门课</a></p>}
      <ol className="note-list">{(opened ? [opened] : notes).map(note => (
        <li key={note.id}>
          <h2>{courseById[note.course.caseId].title}</h2>
          <p><time dateTime={note.savedAt}>{new Date(note.savedAt).toLocaleString()}</time> · 原政策预测：{trendLabel[note.prediction]}</p>
          {opened ? <dl className="note-text">
            <dt>模型规则</dt><dd>{note.rule}</dd>
            <dt>算术核对</dt><dd>{note.calculation}</dd>
            <dt>配对差异</dt><dd>{note.comparison}</dd>
            <dt>现实假设</dt><dd>{note.hypothesis}</dd>
          </dl> : <p><a href={notesLink(note.id)}>打开已保存的解释</a></p>}
          <div className="note-links">
            <a href={sourceLink(note, "baseline")}>查看基线原事件 {note.baselineEvent}</a>
            <a href={sourceLink(note, "comparison")}>查看政策组原事件 {note.comparisonEvent}</a>
          </div>
        </li>
      ))}</ol>
    </main>
  </>;
}

export function SavedSource({ lesson, id, side, caseId, market }: {
  lesson: Lesson; id: string; side: "baseline" | "comparison"; caseId: string; market?: "no-overlap";
}) {
  const [source] = useState(() => {
    try {
      const note = readNote(localStorage, id);
      return note?.course.caseId === caseId && note.course.market === market ? sourceRun(lesson, note, side) : undefined;
    } catch { return undefined; }
  });
  if (!source) return <main className="shell lesson-shell student-notes">
    <h1>暂时无法核对原事件</h1>
    <p>当前浏览器缺少对应解释，或者课堂版本与保存时不同。</p>
    <a href={notesLink(id)}>返回已保存的解释</a>
  </main>;
  const { run, tick } = source;
  const frame = run.frames[tick];
  const evidence = seedEvidence(run, tick);
  const auction = "quotes" in run ? run as AuctionRun : undefined;
  const trade = auction?.frames[tick].record;
  const orders = [trade?.buy_order_id, trade?.sell_order_id].flatMap(id => id && auction?.quotes[id] ? [auction.quotes[id]] : []);
  return <>
    <header className="site-header"><div className="shell">
      <a className="brand" href="./">EcoSimEdu</a><a href={notesLink(id)}>返回已保存的解释</a>
    </div></header>
    <main className="shell lesson-shell student-notes">
      <h1>{side === "baseline" ? "基线" : "政策组"}原事件 · {frameLabel(lesson.tickUnit, tick)}</h1>
      <p>{courseById[caseId]?.title} · 种子 {run.seed}</p>
      <p className="run-identity">运行编号 <code>{evidence.runId}</code></p>
      <h2>原始记录</h2>
      <p>{frame.events[0]?.text ?? evidence.event.summary}</p>
      {orders.length > 0 && <ul>
        {orders.map(order => <li key={order.order_id}>{order.order_id} · {order.actor_id} 报 {order.price} 代币
          {order.order_id === trade?.maker_order_id && " · 在簿定价"}</li>)}
      </ul>}
      {frame.events.length > 1 && <details className="trace-details">
        <summary>查看同一时点的主体与关系记录</summary>
        <ul>{frame.events.slice(1).map(event => <li key={event.id}>{event.text}</li>)}</ul>
      </details>}
      {frame.equations && <ul>{frame.equations.map(equation => <li key={equation}>{equation}</li>)}</ul>}
      <table className="source-metrics">
        <caption>原事件前后数值</caption>
        <thead><tr><th scope="col">指标</th><th scope="col">之前</th><th scope="col">之后</th></tr></thead>
        <tbody>{lesson.metrics.map(metric => <tr key={metric.id}>
          <th scope="row">{metric.label}{metric.unit ? `（${metric.unit}）` : ""}</th>
          <td>{displayNumber(evidence.before?.[metric.id])}</td><td>{displayNumber(evidence.after[metric.id])}</td>
        </tr>)}</tbody>
      </table>
    </main>
  </>;
}
