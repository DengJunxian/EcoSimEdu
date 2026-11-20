import { useState, type Dispatch, type Ref } from "react";
import { evidenceKinds, missingEvidence } from "../../content/microscope.ts";
import { displayObservation, frameLabel, type Command, type Lesson, type Session } from "./lesson.ts";
import { microscope, type TraceFocus } from "./microscope.ts";
import { browserEnvelope } from "./run-evidence.ts";
import type { CourseRef } from "./learning-store.ts";

export function TraceMicroscope({ lesson, course, session, metricId, send, headingRef, announceFollow }: {
  lesson: Lesson; course: CourseRef; session: Session; metricId: string; send: Dispatch<Command>;
  headingRef: Ref<HTMLHeadingElement>; announceFollow: () => void;
}) {
  const run = session.run!;
  const perspective = session.perspective ?? "system";
  const focus = session.traceFocus?.tick === session.cursor ? session.traceFocus : { tick: session.cursor };
  const view = microscope(run, lesson, focus, session.revealed, perspective, session.selected, metricId)
    ?? microscope(run, lesson, { tick: session.cursor }, session.revealed, perspective, session.selected, metricId);
  const chosenLink = focus.relation && focus.anchor && microscope(run, lesson, focus.anchor, session.revealed,
    perspective, session.selected, metricId)?.links.find(link => link.id === focus.relation &&
      link.point.tick === focus.tick && link.point.eventId === focus.eventId);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedLinks, setExpandedLinks] = useState(false);
  const model = lesson.casePackage!;
  const neighborhood = model.caseId === "schelling_segregation";
  const banking = model.caseId === "svb_run";
  const trace = (point: TraceFocus, actorId?: string) => send({ type: "trace", focus: point, actorId });
  const follow = (point: TraceFocus, actorId?: string) => {
    announceFollow();
    trace(point, actorId);
  };
  const pointName = (point: TraceFocus) => point.eventId !== undefined ? `事件 ${point.eventId}` :
    lesson.tickUnit === "event" ? frameLabel(lesson.tickUnit, point.tick) : `第 ${point.tick} 轮末`;

  async function save() {
    if (!view) return;
    setBusy(true);
    setStatus("");
    try {
      const envelope = await browserEnvelope(run, model, { choices: session.choices, policy: lesson.policy.baseline });
      const payload = { schema: "ecosimedu.microscope/v1", caseId: model.caseId, runId: run.id,
        versions: envelope.versions, resultDigest: envelope.resultDigest, seed: run.seed,
        revealedFrame: session.revealed, selection: { actor: view.actor?.id, relation: chosenLink || undefined, metric: view.metric ? metricId : undefined },
        evidence: view };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `EcoSimEdu-${course.caseId}-证据.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("已导出正在观察的证据。");
    } catch {
      setStatus("无法核对并导出这份证据。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="trace-microscope" aria-labelledby="microscope-title">
    <h2 id="microscope-title" ref={headingRef} tabIndex={-1}>微观与宏观的证据追踪</h2>
    <fieldset className="trace-perspective">
      <legend>观察视角</legend>
      <label><input type="radio" name="trace-perspective" checked={perspective === "system"}
        onChange={() => send({ type: "perspective", perspective: "system" })}/> 系统观察者</label>
      <label><input type="radio" name="trace-perspective" checked={perspective === "role"}
        onChange={() => send({ type: "perspective", perspective: "role" })}/> 我的角色</label>
    </fieldset>
    {view && <>
      <p role="status">
        {pointName(view.point)} · {view.clock}{view.economicTime !== undefined && ` ${view.economicTime}`} ·
        已揭示至 {frameLabel(lesson.tickUnit, view.asOf)}{chosenLink && `。已定位：${chosenLink.text}`}
      </p>
      {banking && !!view.visibleRows.length && <label className="actor-picker">当前轮次的原事件
        <select aria-label="当前轮次的原事件" value={view.point.eventId ?? ""} onChange={event => trace(
          { tick: view.point.tick, eventId: event.target.value || undefined }, session.selected)}>
          <option value="">轮末账表</option>
          {view.visibleRows.map(row => <option key={row.point.eventId} value={row.point.eventId}>
            {row.point.eventId} · {row.text}
          </option>)}
        </select>
      </label>}
      <div className="microscope-lenses">
        <section aria-label="微观主体" className="edu-panel">
          <h3>微观主体</h3>
          {view.actor ? <dl>
            <dt>{view.actor.name} · {banking ? "上一轮末" : "前一事件帧"}</dt>
            <dd>{(neighborhood ? view.actorBefore?.signal : view.actorBefore?.constraint) ?? "缺少前一帧。"}</dd>
            <dt>{banking ? "本轮末状态" : "当前事件帧"}</dt>
            <dd>{neighborhood ? view.actor.signal : view.actor.constraint}</dd>
            {neighborhood ? <><dt>选择约束</dt><dd>{view.actor.constraint}</dd></> :
              <><dt>观察到的信号</dt><dd>{view.actor.signal}</dd></>}
            <dt>{banking ? "本轮申请判断" : "已记录的行动理由"}</dt><dd>{view.actor.reason}</dd>
          </dl> : <p>选择一个主体，查看状态与行动。</p>}
          {view.actorEvents.length > 0 && <details><summary>此主体已揭示的最近事件</summary>
            <ul>{view.actorEvents.map(row => <li key={row.point.eventId}>
              <button className="text-button" onClick={() => follow(row.point)}>{pointName(row.point)} · {row.text}</button>
            </li>)}</ul>
          </details>}
        </section>
        <section aria-label="主体间互动" className="edu-panel">
          <h3>主体间互动</h3>
          {view.action && <p><strong>{evidenceKinds.action}</strong> · {view.action}</p>}
          {view.links.length ? <>
            <ul>{view.links.slice(0, expandedLinks ? undefined : 8).map(link => <li key={link.id}>
              <strong>{evidenceKinds[link.kind]}</strong> · {link.text}
              <button className="text-button" aria-pressed={focus.relation === link.id}
                onClick={() => follow({ ...link.point, relation: link.id, anchor: view.point }, link.actorId)}>
                定位{pointName(link.point)}{link.actorId ? ` · ${link.actorId}` : ""}
              </button>
            </li>)}</ul>
            {view.links.length > 8 && <button type="button" onClick={() => setExpandedLinks(!expandedLinks)}>
              {expandedLinks ? "收起其余证据" : `展开其余 ${view.links.length - 8} 条证据`}
            </button>}
          </> : <p>{missingEvidence}</p>}
        </section>
        <section aria-label="宏观结果" className="edu-panel">
          <h3>宏观结果</h3>
          {view.metric ? <>
            <p>{view.metric.label}（{view.metric.unit}）</p>
            <dl>
              <dt>之前</dt><dd>{displayObservation(view.metric.before)}</dd>
              <dt>之后</dt><dd>{displayObservation(view.metric.after)}</dd>
              <dt>净变化</dt><dd>{displayObservation(view.metric.difference)}</dd>
            </dl>
            {view.metric.equation && <p><strong>{evidenceKinds.accounting}</strong> · {view.metric.equation}</p>}
            {view.metric.identity && <p>{view.metric.identity}</p>}
            {!view.metric.equation && <p>{missingEvidence}</p>}
          </> : <p>角色视角使用本角色已观察的信息。</p>}
        </section>
      </div>
      <details><summary>核对运行编号</summary><p className="run-identity">{view.runId}</p></details>
      <button type="button" onClick={() => void save()} disabled={busy}>导出当前显微镜证据</button>
      {status && <p role="status">{status}</p>}
    </>}
  </section>;
}
