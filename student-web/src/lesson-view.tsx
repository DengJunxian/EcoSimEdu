import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Course, Event, Frame, Grid, LessonRun, Scalar } from "./lesson-types";
import { downloadJson, traceHref } from "./contracts";
import { boundaries } from "./boundary";
import { localCells, occupiedNeighbors } from "./cases/schelling/neighborhood";

const numbers = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 });
export const showValue = (value: Scalar | undefined) =>
  value == null ? "—" : typeof value === "number" ? numbers.format(value) :
    typeof value === "boolean" ? (value ? "是" : "否") : value;

export function GridView({ grid, selection, onSelect, affected = [] }: {
  grid: Grid; selection?: number; onSelect?: (cell: number) => void; affected?: number[];
}) {
  const [localCell, setLocalCell] = useState(grid.marked[0] ?? 0);
  const cell = selection ?? localCell;
  const setCell = onSelect ?? setLocalCell;
  const [announcePick, setAnnouncePick] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const resident = grid.cells[cell];
  const row = Math.floor(cell / grid.size);
  const col = cell % grid.size;
  const coordinates = Array.from({ length: grid.size }, (_, i) => <option key={i} value={i}>{i + 1}</option>);
  const around = localCells(grid, cell);
  const near = new Set(around.filter(item => !item.center).map(item => item.index));
  const neighbors = occupiedNeighbors(around);
  const own = neighbors.filter(value => value[0] === resident?.[0]).length;
  const summary = `${resident ?? "空位"} · 第 ${row + 1} 行第 ${col + 1} 列。${resident
    ? (neighbors.length ? `同组邻居 ${own}/${neighbors.length}。` : "周围没有已占邻居。") : ""}`;
  useEffect(() => {
    if (!announcePick) return;
    // Let the native select menu finish closing before the screen reader receives the new cell.
    const timer = window.setTimeout(() => { setAnnouncement(summary); setAnnouncePick(false); }, 400);
    return () => window.clearTimeout(timer);
  }, [announcePick, summary]);

  const pickCoordinate = (next: number) => {
    setCell(next);
    setAnnouncement("");
    setAnnouncePick(true);
  };
  return <figure className="lesson-grid">
    <figcaption>社区地图 <span>A 方块 · B 圆点 · 空格未居住 · 金框标记事件位置
      {affected.length > 0 && " · 虚框标记受影响的居民"}</span>
      <span className="grid-pan-note"> · 可横向查看全部列</span></figcaption>
    <div className="grid-map-scroll"><div className="grid-map" style={{
      "--grid-size": grid.size, gridTemplateColumns: `repeat(${grid.size}, minmax(0, 1fr))`,
    } as CSSProperties}
      role="group" aria-label="社区地图，用方向键选择相邻位置">
      {grid.cells.map((occupant, i) => <button type="button" key={i}
        ref={el => { cells.current[i] = el; }}
        className={[occupant?.[0] === "A" ? "group-a" : occupant ? "group-b" : "vacancy",
          i === cell ? "picked" : near.has(i) ? "nearby" : "", grid.marked.includes(i) ? "marked" : "",
          affected.includes(i) ? "grid-affected" : ""].join(" ")}
        tabIndex={i === cell ? 0 : -1}
        aria-label={`第 ${Math.floor(i / grid.size) + 1} 行第 ${i % grid.size + 1} 列，${occupant ?? "空位"}${affected.includes(i) ? "，邻域受影响" : ""}`}
        aria-pressed={i === cell} onClick={() => setCell(i)}
        onKeyDown={event => {
          const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: grid.size, ArrowUp: -grid.size };
          if (offsets[event.key] === undefined) return;
          event.preventDefault();
          const next = i + offsets[event.key];
          const crossesEdge = (event.key === "ArrowLeft" && i % grid.size === 0) ||
            (event.key === "ArrowRight" && i % grid.size === grid.size - 1);
          if (!crossesEdge && next >= 0 && next < grid.cells.length) {
            setCell(next);
            cells.current[next]?.focus();
          }
        }}><span/></button>)}
    </div></div>
    <details><summary>按行列选格</summary>
      <div className="toolbar grid-coordinates" role="group" aria-label="按坐标选择社区格子">
        <label>行 <select value={row} onChange={event => pickCoordinate(Number(event.target.value) * grid.size + col)}>{coordinates}</select></label>
        <label>列 <select value={col} onChange={event => pickCoordinate(row * grid.size + Number(event.target.value))}>{coordinates}</select></label>
      </div>
    </details>
    <p>{summary}</p>
    <span className="screen-reader-only" aria-live="polite" aria-atomic="true">{announcement}</span>
    <details><summary aria-label={`查看选中格的邻居列表。${summary}`}>查看选中格的邻居列表</summary>
      <p>{neighbors.length ? neighbors.join("、") : "没有已占邻居"}</p>
    </details>
  </figure>;
}

export function MetricChart({ course, frames, tick, change }: {
  course: Course; frames: Pick<Frame, "metrics">[]; tick: number; change: (tick: number) => void;
}) {
  const [metricId, setMetricId] = useState(course.metrics[0].id);
  const metric = course.metrics.find(m => m.id === metricId)!;
  const values = frames.map(f => f.metrics[metricId]);
  const finite = values.filter((v): v is number => typeof v === "number");
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 0;
  const end = frames.length - 1;
  const from = Math.max(0, tick - 2);
  const at = (index: number) => 52 + 510 * index / Math.max(1, end);
  const y = (number: number) => 137 - (max === min ? .5 : (number - min) / (max - min)) * 106;
  const d = values.map((v, i) =>
    v == null ? "" : `${i > 0 && values[i - 1] != null ? "L" : "M"}${at(i)},${y(v)}`).join(" ");
  return <figure>
    <label>图表指标 <select aria-label="图表指标" value={metricId} onChange={e => setMetricId(e.target.value)}>
      {course.metrics.map(item => <option key={item.id} value={item.id}>{item.label}（{item.unit}）</option>)}
    </select></label>
    {finite.length ? <><svg className="lesson-series" viewBox="0 0 595 171" role="img"
      aria-label={`${metric.label}随事件变化，当前值 ${showValue(values[tick])} ${metric.unit}`}
      onClick={e => {
        const bounds = e.currentTarget.getBoundingClientRect();
        const offset = ((e.clientX - bounds.left) / bounds.width * 595 - 52) / 510;
        change(Math.max(0, Math.min(end, Math.round(offset * end))));
      }}>
      <line className="gridline" x1="52" x2="562" y1="137" y2="137"/>
      <line className="gridline" x1="52" x2="562" y1="31" y2="31"/>
      <text x="46" y="34" textAnchor="end">{showValue(max)}</text>
      {min !== max && <text x="46" y="141" textAnchor="end">{showValue(min)}</text>}
      <text x="562" y="162" textAnchor="end">事件 {end}</text>
      <path className="demand" d={d}/>
      <line className="gridline" x1={at(tick)} x2={at(tick)} y1="24" y2="143"/>
      {values[tick] != null && <circle className="selected-point" cx={at(tick)} cy={y(values[tick]!)} r="5"/>}
    </svg>
    <details><summary>查看指标数据</summary>
      <table><caption>{metric.label}（{metric.unit}）</caption>
        <thead><tr><th scope="col">事件序号</th><th scope="col">数值</th></tr></thead>
        <tbody>{values.slice(from, tick + 3).map((value, offset) => {
          const position = from + offset;
          return <tr key={position}><th scope="row"><button className="text-button"
            aria-current={position === tick ? "step" : undefined} onClick={() => change(position)}>事件 {position}</button></th>
            <td>{value == null ? "缺失" : showValue(value)}</td></tr>;
        })}</tbody>
      </table>
    </details></> : <p className="quiet-content">此指标在当前情景无数值。可继续选择其他指标。</p>}
  </figure>;
}

function RelationshipView({ frame, actor, choose, jump }: {
  frame: Frame; actor: string; choose: (actor: string) => void; jump: (tick: number) => void;
}) {
  const relations = frame.relations ?? [];
  const visible = (actor ? relations.filter(edge => edge.from === actor || edge.to === actor) : relations).slice(0, 8);
  const endpoint = (id: string) => Object.hasOwn(frame.entities, id)
    ? <button type="button" className="relation-node" aria-pressed={id === actor} onClick={() => choose(id)}>{id}</button>
    : <span className="relation-node">{id}</span>;
  return <details><summary>主体关系</summary>
    {visible.length ? <div className="relation-flow" role="group" aria-label="选中主体的关系">
      {visible.map((edge, index) => <div className="relation-flow-row" key={index}>
        {endpoint(edge.from)}<span className="relation-label">{edge.label}</span>{endpoint(edge.to)}
      </div>)}
    </div> : <p>当前事件没有该主体的直接关系。</p>}
    <ul className="relation-tape" aria-label="当前事件的全部关系">
      {relations.map((edge, index) => <li key={index}>{edge.from} → {edge.to} · {edge.label}
        {edge.origin_seq !== undefined && edge.origin_seq >= 0 && edge.origin_seq < frame.tick &&
          <button className="text-button" onClick={() => jump(edge.origin_seq!)}>来源事件 {edge.origin_seq}</button>}
      </li>)}
    </ul>
  </details>;
}

export function TraceView({ course, run, tick, actor, select, cite, cited, review }: {
  course: Course; run: LessonRun; tick: number; actor: string;
  select: (tick: number, actor: string) => void; cite?: (event: Event) => void; cited?: boolean;
  review?: { active: boolean; change: (active: boolean) => void };
}) {
  const [playing, setPlaying] = useState(false);
  const [pausedAtCheckpoint, setCheckpoint] = useState(false);
  const [pinnedActor, setPinnedActor] = useState("");
  const timeline = useRef<HTMLInputElement>(null);
  const frames = run.result.snapshots;
  const end = frames.length - 1;
  const position = Math.min(tick, end);
  const frame = frames[position];
  const event = run.result.events[position];
  const firstCheckpoint = run.result.events.findIndex(e => e.event_type === course.checkpoint.event_type);
  const fullReview = review?.active ?? true;
  const focusedActor = actor || pinnedActor;
  const pinCandidate = actor === pinnedActor ? "" : actor;
  const focus = frame.entities[focusedActor];
  const actors = Object.keys(frame.entities);
  if (focusedActor && !Object.hasOwn(frame.entities, focusedActor)) actors.unshift(focusedActor);
  const citedEvent = course.evidence_types.includes(event.event_type);
  const nextEvidence = run.result.events.find(e => e.tick > position && course.evidence_types.includes(e.event_type));
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      const next = Math.min(end, position + 1);
      select(next, "");
      if (next === end || next === firstCheckpoint) {
        setPlaying(false);
        setCheckpoint(next === firstCheckpoint);
      }
    }, 125);
    return () => window.clearTimeout(timer);
  }, [playing, position, end, select, firstCheckpoint]);

  const jump = (at: number) => { setCheckpoint(false); setPlaying(false); select(at, ""); };
  const jumpFromEvidence = (at: number) => { jump(at); timeline.current?.focus(); };
  return <section className="market">
    <div className="section-line"><h3>{run.scenario_id === "boundary" ? boundaries[course.case_id]?.label
      : course.scenarios.find(s => s.id === run.scenario_id)?.label}</h3>
      <span className="identity">{run.origin === "live_simulation" ?
      (run.result.live?.selected_by_model ? "保存的模型运行" : "保存的高级运行 · 规则回退") : "本次离线计算"}</span></div>
    {review && <div className="toolbar"><button type="button" onClick={() => review.change(!fullReview)}>
      {fullReview ? "返回引导播放" : "查看全程"}</button></div>}
    <MetricChart course={course} frames={fullReview ? frames : frames.slice(0, position + 1)} tick={position} change={jump}/>
    <div className="toolbar">
      <button className="primary" onClick={() => {
        if (position === end) select(0, "");
        setCheckpoint(false);
        setPlaying(!playing);
      }}>{playing ? "暂停播放" : "播放实验"}</button>
      <button aria-disabled={position === 0} onClick={() => { if (position > 0) jump(position - 1); }}>上一步</button>
      <button aria-disabled={position === end} onClick={() => { if (position < end) jump(position + 1); }}>下一步</button>
      <button aria-disabled={!nextEvidence} onClick={() => { if (nextEvidence) jump(nextEvidence.tick); }}>跳到下一条证据</button>
    </div>
    <label className="timeline"><span>事件时间轴 <span aria-hidden="true">{fullReview ? `${position} / ${end}` : position}</span></span>
      <input ref={timeline} type="range" min="0" max={end} aria-valuetext={fullReview ? `事件 ${position}，末条为 ${end}` : `事件 ${position}`}
      value={position} onChange={e => jump(Number(e.target.value))}/></label>
    {pausedAtCheckpoint && <p role="status" className="callout">{course.checkpoint.message}</p>}
    <MetricValues course={course} metrics={frame.metrics}/>
    {frame.grid && <GridView grid={frame.grid}/>}
    <section className="evidence-panel">
      <h4>事件 {event.seq}</h4><p>{event.summary}</p>
      {event.time !== undefined && <p>模型步 {event.time}{event.purpose ? ` · ${event.purpose}` : ""}</p>}
      {event.event_type === "trade" && <div className="toolbar">
        {([["买单", event.buy_order_id], ["卖单", event.sell_order_id]] as const).map(([side, orderId]) => {
          const original = run.result.events.find(candidate => candidate.seq < event.seq &&
            candidate.event_type === "order_submitted" && candidate.order_id === orderId);
          return original && <button key={side} className="text-button" onClick={() => jumpFromEvidence(original.tick)}>
            原始{side} {orderId}
          </button>;
        })}
      </div>}
      <div className="toolbar">
        {citedEvent && cite && <button disabled={cited} onClick={() => cite(event)}>{cited ? "已引用" : "引用此事件"}</button>}
        <a href={traceHref(run.case_id, run.run_id, position)}>事件链接</a>
      </div>
      {actors.length > 0 && <div className="toolbar"><label>观察主体 <select aria-label="观察主体" value={focusedActor}
        onChange={e => select(position, e.target.value)}>
        <option value="">选择主体</option>
        {actors.map(key => <option key={key}>{key}</option>)}
      </select></label>
        {focusedActor && <button type="button" onClick={() => {
          setPinnedActor(pinCandidate);
          if (!pinCandidate && !actor) timeline.current?.focus();
        }}>{pinCandidate ? `固定 ${pinCandidate}` : `取消固定 ${pinnedActor}`}</button>}
        {pinCandidate && pinnedActor && <button type="button" onClick={() => {
          setPinnedActor("");
          timeline.current?.focus();
        }}>取消固定 {pinnedActor}</button>}
      </div>}
      {focusedActor && !focus && <p className="quiet-content">{focusedActor} 在当前事件没有状态记录。</p>}
      {focus && <dl className="entity-facts">{Object.entries(focus).map(([key, value]) => {
        const before = frames[position - 1]?.entities[focusedActor]?.[key];
        return <div key={key}><dt>{key}</dt><dd>{before !== undefined && before !== value ?
          `${showValue(before)} → ${showValue(value)}` : showValue(value)}</dd></div>;
      })}</dl>}
      {event.choice_if_private_a !== undefined && <details>
        <summary>信号、行动与似然</summary>
        <dl className="entity-facts">
          <div><dt>收到 A 信号时的选择</dt><dd>{event.choice_if_private_a}</dd></div>
          <div><dt>收到 B 信号时的选择</dt><dd>{event.choice_if_private_b}</dd></div>
          <div><dt>真状态为 A 时出现当前行动的概率</dt><dd>{showValue(event.action_likelihood_given_a)}</dd></div>
          <div><dt>真状态为 B 时出现当前行动的概率</dt><dd>{showValue(event.action_likelihood_given_b)}</dd></div>
        </dl>
      </details>}
      {event.changed_neighbors && event.changed_neighbors.length > 0 && <details>
        <summary>邻居迁移前后的比例</summary>
        <div className="table-scroll"><table><thead><tr><th>居民</th><th>搬迁前</th><th>搬迁后</th></tr></thead>
          <tbody>{event.changed_neighbors.map(change => <tr key={change.actor}><td>{change.actor}</td>
            <td>{change.before.join("/")}</td><td>{change.after.join("/")}</td></tr>)}</tbody></table></div>
      </details>}
      {frame.relations?.length ? <RelationshipView frame={frame} actor={focusedActor}
        choose={person => select(position, person === actor ? "" : person)} jump={jumpFromEvidence}/> : null}
    </section>
    {fullReview && <button className="text-button" onClick={() => downloadJson(`run-${run.run_id}.json`, run)}>导出运行记录</button>}
  </section>;
}

export function MetricValues({ course, metrics }: { course: Course; metrics: Frame["metrics"] }) {
  return <div className="stats lesson-stats">{course.metrics.map(metric =>
    <div key={metric.id}><span>{metric.label}</span>
      <strong>{showValue(metrics[metric.id])} {metrics[metric.id] == null ? "" : metric.unit}</strong></div>)}</div>;
}
