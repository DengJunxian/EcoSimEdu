import { useState } from "react";
import { InspectorPanel } from "../../content/student-ui.tsx";
import type { Actor, Command, Frame, Lesson, Session } from "./lesson.ts";
import { frameLabel, relatedActors } from "./lesson.ts";

export function RoleView({ role }: Pick<Lesson, "role">) {
  return <section className="role-view canvas-panel">
    <h2>{role.title}</h2>
    <svg viewBox="0 0 360 134" role="img" aria-label={role.timeline.map(item => item.label).join("，")}>
      <path d="M56 58H304" fill="none" stroke="#85a298" strokeWidth="2"/>
      {role.timeline.map((item, index) => <g key={item.label} transform={`translate(${56 + index * 248 / Math.max(1, role.timeline.length - 1)} 58)`}>
        <circle r="16" fill={item.highlighted ? "#f4c16a" : "#15413b"} stroke="#a7c6ba" strokeWidth="2"/>
        <text y="5" textAnchor="middle" fill={item.highlighted ? "#132e2b" : "#f7f6ef"} fontSize="14">{index + 1}</text>
        <text y="42" textAnchor="middle" fill="#e1ede5" fontSize="13">{item.label}</text>
      </g>)}
    </svg>
  </section>;
}

export function MicroBoard({ lesson, frame, selected, metricId, select }: {
  lesson: Lesson; frame: Frame; selected?: string; metricId?: string; select: (id: string) => void;
}) {
  const focused = metricId ? relatedActors(frame, metricId) : lesson.originalId && frame.tick ? relatedActors(frame) : [];
  const [view, setView] = useState<{ page: number; selected?: string }>({ page: 0 });
  const pageSize = 30;
  const pages = Math.ceil(frame.actors.length / pageSize);
  const selectedIndex = frame.actors.findIndex(actor => actor.id === selected);
  const page = selected !== view.selected && selectedIndex >= 0 ? Math.floor(selectedIndex / pageSize) : view.page;
  const actors = frame.actors.slice(page * pageSize, (page + 1) * pageSize);
  const columns = Math.min(8, Math.ceil(Math.sqrt(actors.length * 1.5)));
  const rows = Math.ceil(actors.length / columns);
  const states = Object.entries(lesson.states);
  return <section className="micro-view" aria-label="微观个体画布">
    <div className="canvas-heading"><h2>{lesson.populationTitle}</h2><span>{frameLabel(lesson.tickUnit, frame.tick)}</span></div>
    {frame.board && <NeighborhoodMap board={frame.board} lesson={lesson} selected={selected} focused={focused} select={select}/>}
    {!frame.board && pages > 1 && <div className="population-pages" role="group" aria-label="个体画布分组">
      {Array.from({ length: pages }, (_, index) => <button key={index} aria-pressed={index === page}
        onClick={() => setView({ page: index, selected })}>
        第 {index * pageSize + 1}–{Math.min((index + 1) * pageSize, frame.actors.length)} 位
        {actors.length && focused.length > 0 && ` · ${frame.actors.slice(index * pageSize, (index + 1) * pageSize)
          .filter(actor => focused.includes(actor.id)).length} 位相关`}
      </button>)}
    </div>}
    {frame.board ? <div className="resident-picker">
      <button type="button" onClick={() => select(frame.actors[0].id)}>查看 {frame.actors[0].id}</button>
      <label>按编号选择居民 <select value={selected ?? ""} onChange={event => select(event.target.value)}>
        <option value="" disabled>选择住户</option>
        {frame.actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name} · {lesson.states[actor.state].label}
          {focused.includes(actor.id) ? " · 当前事件相关" : ""}</option>)}
      </select></label>
    </div> : <svg viewBox={`0 0 600 ${rows * 68 + 16}`} role="group" aria-label="选择任一位个体查看决策">
      {actors.map((actor, index) => {
        const state = lesson.states[actor.state];
        const spacing = 600 / columns;
        return <g key={actor.id} role="button" tabIndex={0} aria-label={`${actor.name}，${state.label}`}
          aria-pressed={actor.id === selected}
          className={`actor-node${focused.includes(actor.id) ? " actor-contributor" : ""}`}
          transform={`translate(${(index % columns + .5) * spacing} ${42 + Math.floor(index / columns) * 68})`}
          onClick={() => { setView({ page, selected: actor.id }); select(actor.id); }}
          onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setView({ page, selected: actor.id });
              select(actor.id);
            }
          }}>
          <title>{actor.name} · {state.label}</title>
          <circle className="actor-ring" r="27" fill="none" strokeWidth="2"/>
          <rect className="actor-fill" data-symbol={states.findIndex(([id]) => id === actor.state)}
            x="-21" y="-21" width="42" height="42" fill={state.color}/>
          <text y="5" textAnchor="middle" fill="#18302c" fontSize="13">{actor.marker}</text>
        </g>;
      })}
    </svg>}
    <ul className="canvas-legend" aria-label="个体状态图例">
      {states.map(([id, state], index) => <li key={id}>
        <span data-symbol={index} style={{ backgroundColor: state.color }} aria-hidden="true"/>{state.label}
      </li>)}
      {!!focused.length && <li><span className="highlight-key" aria-hidden="true"/>{metricId ? "指标变化相关个体" : "当前事件相关个体"}</li>}
    </ul>
  </section>;
}

function NeighborhoodMap({ board, lesson, selected, focused, select }: {
  board: NonNullable<Frame["board"]>; lesson: Lesson; selected?: string; focused: string[]; select: (id: string) => void;
}) {
  const { size, cells, marked } = board;
  const people = cells.flatMap((id, cell) => id ? [{ id, cell }] : []).sort((a, b) => a.id.localeCompare(b.id));
  return <svg className="neighborhood-map" aria-hidden="true" viewBox={`0 0 ${size * 20} ${size * 20}`}>
    <defs><pattern id="house-plot" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M0 20V0H20" fill="none" stroke="#6a9083" strokeWidth="1"/>
    </pattern></defs>
    <rect width="100%" height="100%" fill="url(#house-plot)"/>
    {people.map(({ id, cell }) => <rect key={id} className="resident-tile" width="14" height="14" x="3" y="3" rx={id.startsWith("A") ? 7 : 2}
      style={{ transform: `translate(${cell % size * 20}px, ${Math.floor(cell / size) * 20}px)` }}
      stroke={id === selected ? "#fffef2" : focused.includes(id) ? "#ffaf37" : "none"} strokeWidth="2"
      fill={lesson.states[id[0]].color} onClick={() => select(id)}><title>{id}</title></rect>)}
    {marked.map(cell => <rect key={cell} x={cell % size * 20 + 1} y={Math.floor(cell / size) * 20 + 1}
      width="18" height="18" rx="3" fill="none" stroke="#fffef2" strokeDasharray="3 2" pointerEvents="none"/>)}
  </svg>;
}

export function Inspector({ actor, stateName, frame, tickUnit, metricId, locate }: {
  actor: Actor; stateName: string; frame: Frame; tickUnit?: Lesson["tickUnit"]; metricId?: string; locate?: (tick: number, metricId: string, actorId?: string) => void;
}) {
  const actorEvents = frame.events.filter(event => event.actorId === actor.id || event.counterpartyId === actor.id ||
    event.participants?.includes(actor.id));
  const prior = actorEvents.find(event => event.priorSignal)?.priorSignal ?? actor.priorSignal;
  const origins = actorEvents.find(event => event.observed?.length)?.observed ?? [];
  const generic = !!frame.events[0]?.participants;
  const sources = [...new Map(actorEvents.flatMap(event => event.sourceEvents ?? [])
    .map(source => [source.tick, source])).values()];
  return <InspectorPanel>
    <h2>{actor.name}</h2>
    <dl className="fact-list">
      <div><dt>当前状态</dt><dd>{stateName}</dd></div>
      <div><dt>约束</dt><dd>{actor.constraint}</dd></div>
      <div><dt>局部信号</dt><dd>{actor.signal}</dd></div>
      <div><dt>为何这样行动</dt><dd>{actor.reason}</dd></div>
      {actor.nextDecision && <div className="inspector-next"><dt>下一步如何决定</dt><dd>{actor.nextDecision}</dd></div>}
    </dl>
    {!!actorEvents.length && frame.tick > 0 && <ul className="actor-events">
      {actorEvents.map(event => <li key={event.id}>{event.kind && <span className="event-index">事件 {event.id} · </span>}{event.text}</li>)}
    </ul>}
    {prior && locate && <button className="text-button" onClick={() => locate(prior.tick, prior.metricId)}>
      {generic ? `回查源事件 ${prior.tick}` : tickUnit === "event" ? `查看作为参考的成交事件 ${prior.tick}` :
        `查看影响决策的${frameLabel(tickUnit, prior.tick)}指标`}
    </button>}
    {locate && sources.length > 0 && <ul className="signal-links" aria-label="关联原始事件">
      {sources.map(source => <li key={source.tick}><button className="text-button"
        onClick={() => locate(source.tick, metricId ?? "", actor.id)}>{source.label}</button></li>)}
    </ul>}
    {locate && origins.length > 0 && <ul className="signal-links" aria-label="邻居信号的来源">
      {origins.map(origin => <li key={origin.eventId}><button className="text-button"
        onClick={() => locate(origin.tick, "queued", origin.actorId)}>
        查看 {origin.actorId} 的第 {origin.tick} 轮申请
      </button></li>)}
    </ul>}
  </InspectorPanel>;
}

export function Timeline({ session, send }: { session: Session; send: (command: Command) => void }) {
  const finished = session.cursor >= (session.run?.frames.length ?? 1) - 1;
  return <div className="timeline" role="group" aria-label="时间轴">
    <button onClick={() => send({ type: "play" })} disabled={session.playing || finished}>播放</button>
    <button onClick={() => send({ type: "pause" })} disabled={!session.playing}>暂停</button>
    <button onClick={() => send({ type: "step" })} disabled={finished}>单步前进</button>
    <button onClick={() => send({ type: "reset" })} disabled={session.cursor === 0 && !session.playing}>重置</button>
  </div>;
}
