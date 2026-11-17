import { useEffect, useState } from "react";
import { catalog, selectedCourse } from "./catalog";
import { api, eventHref, traceHref } from "./contracts";

type EventRecord = {
  run_id: string;
  case_id: string;
  case_version: string;
  event_count: number;
  event: { seq: number; tick: number; event_type: string; summary?: string };
  snapshot_tick: number | null;
};

export function EventLookup({ runId, requested }: { runId: string; requested: string }) {
  const course = catalog.find(row => row.case_id === selectedCourse);
  const seq = Number(requested);
  const valid = /^\d+$/.test(requested) && Number.isSafeInteger(seq);
  const [record, setRecord] = useState<EventRecord>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!valid || !course) return;
    let alive = true;
    api<EventRecord>(`/runs/${encodeURIComponent(runId)}/events/${seq}`).then(result => {
      if (result.run_id !== runId.toLowerCase() || result.case_id !== course.case_id ||
          result.case_version !== course.version || result.event.seq !== seq) {
        throw new Error("链接中的事件与当前课程或版本不符。");
      }
      if (alive) setRecord(result);
    }).catch(problem => { if (alive) setError(problem.message); });
    return () => { alive = false; };
  }, [runId, seq, valid, course]);

  const courseHref = `/?${new URLSearchParams({ case: selectedCourse })}`;
  return <main className="container course-home">
    <a href={courseHref}>返回课程</a>
    <h1>{course?.title ?? "运行证据"}</h1>
    <form className="toolbar" method="get" action="/">
      <input type="hidden" name="case" value={selectedCourse}/>
      <input type="hidden" name="run" value={runId}/>
      <label htmlFor="event-seq">事件序号</label>
      <input id="event-seq" type="number" name="event" min={0} max={record && record.event_count - 1}
        step={1} defaultValue={valid ? seq : ""} required/>
      <button type="submit">前往事件</button>
    </form>
    {(!course || !valid || error) && <p role="alert" className="error">
      {!course ? "此课程尚未发布。" : !valid ? "请输入从 0 开始的整数事件序号。" : error}</p>}
    {course && valid && !record && !error && <p role="status">读取原始事件…</p>}
    {record && <section className="market">
      <h2>事件 {record.event.seq}</h2>
      <p>{record.event.summary ?? record.event.event_type} · 共 {record.event_count.toLocaleString("zh-CN")} 条</p>
      <nav className="toolbar" aria-label="事件浏览">
        {seq > 0 && <a href={eventHref(record.case_id, runId, seq - 1)}>上一条事件</a>}
        {seq + 1 < record.event_count && <a href={eventHref(record.case_id, runId, seq + 1)}>下一条事件</a>}
        {record.snapshot_tick !== null && <a href={traceHref(record.case_id, runId, record.snapshot_tick)}>
          查看关联快照 {record.snapshot_tick}</a>}
      </nav>
      {record.snapshot_tick === null && <p>事件记录未关联可用快照。</p>}
      <details><summary>原始事件字段</summary>
        <pre className="event-fields">{JSON.stringify(record.event, null, 2)}</pre>
      </details>
    </section>}
  </main>;
}
