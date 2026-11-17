import { useRef, useState } from "react";
import type { DomainPanelProps, FlagshipView } from "../../learning/flagship-types";
import type { Grid, Scalar } from "../../lesson-types";
import { GridView, showValue } from "../../lesson-view";
import { coordinates, satisfied, type Counts } from "./neighborhood";
import { Neighborhood, Practice } from "./neighborhood-view";
import "./schelling.css";

const student = "A001";

function openingGrid(briefing: unknown): Grid | undefined {
  return (briefing as { grid?: Grid } | undefined)?.grid;
}
function getThreshold(value: Scalar | undefined) {
  return typeof value === "number" ? value : null;
}
function stopReason(terminal: unknown) {
  switch (terminal) {
    case "all_satisfied": return "所有居民都达到了本场阈值。";
    case "blocked": return "仍有未达阈值的居民，本轮找不到可行空位。";
    case "round_limit": return "已经走完模型规定的轮数，地图仍可能继续变化。";
    default: return "运行没有提供停止原因。";
  }
}

function OpeningMap({ grid, action, course }: { grid: Grid; action: string; course: DomainPanelProps["course"] }) {
  const current = grid.cells.indexOf(student);
  const target = grid.marked.find(index => grid.cells[index] === null);
  const threshold = getThreshold(course.scenarios.find(arm => arm.id === "baseline")?.parameters.threshold);
  if (current < 0) return <p>当前地图中没有找到 {student}。</p>;
  return <div className="schelling-world">
    <GridView grid={grid}/>
    <div>
      <Neighborhood grid={grid} cell={current} actor={student} threshold={threshold} label="A001 当前邻域"/>
      {target === undefined ? <p>这一配置没有预留空位。可留在当前位置。</p> :
        <Neighborhood grid={grid} cell={target} actor={student} threshold={threshold} excluded={current}
          label="若搬到预留空位"/>}
      <p>{action === "move" ? "你选择搬迁。开局由学生自行决定，随后居民才按阈值自动行动。" :
        "你选择留在原地。自动阶段仍可能依据当时邻域调整位置。"}</p>
    </div>
  </div>;
}

function RunMap({ view, pinned, pin, seek, cite }: DomainPanelProps & { view: FlagshipView }) {
  const grid = view.frame.grid;
  const event = view.events.find(candidate => candidate.tick === view.tick);
  const [inspected, setInspected] = useState<{ tick: number; cell: number }>();
  const pinControl = useRef<HTMLButtonElement>(null);
  const unpinControl = useRef<HTMLButtonElement>(null);
  if (!grid) return <p>这一帧没有地图记录。</p>;
  const tracked = pinned ? grid.cells.indexOf(pinned) : -1;
  const cell = inspected?.tick === view.tick ? inspected.cell : tracked >= 0 ? tracked : grid.marked[0] ?? 0;
  const actor = grid.cells[cell];
  const threshold = getThreshold(view.intervention.threshold);
  const moved = event?.event_type === "student_move" || event?.event_type === "move";
  const origin = moved && typeof event.origin === "number" ? event.origin : null;
  const destination = moved && typeof event.destination === "number" ? event.destination : null;
  const movedActor = moved && typeof event.actor_id === "string" ? event.actor_id : null;
  const changes = moved ? event.changed_neighbors ?? [] : [];
  const affected = changes.map(change => grid.cells.indexOf(change.actor)).filter(index => index >= 0);
  const before = view.previous?.grid;
  const selectCell = (index: number) => setInspected({ tick: view.tick, cell: index });
  const focusResident = (resident: string) => {
    pin(resident);
    setInspected(undefined);
  };
  const ratio = (profile: Counts) =>
    profile[1] ? `${profile.join("/")} · ${threshold === null ? "阈值缺失" :
      satisfied(profile, threshold) ? "达到阈值" : "未达阈值"}` : "周围无人 · 满意";

  return <>
    {!view.events.some(candidate => candidate.tick <= view.tick && candidate.event_type === "move") && <div className="toolbar">
      {!view.closed && <button type="button" onClick={() => seek("checkpoint")}>推进至首次自动迁居</button>}
      <p>{view.closed ? "本次运行没有自动迁居。" : "截至当前事件，尚未发生自动迁居。"}</p>
    </div>}
    <div className="schelling-world">
      <GridView grid={grid} selection={cell} onSelect={selectCell} affected={affected}/>
      <div className="schelling-tracking">
        {pinned && <div className="toolbar">
          <strong>已固定 {pinned}</strong>
          <button type="button" ref={unpinControl} className="text-button" onClick={() => {
            if (tracked >= 0) selectCell(tracked);
            pin("");
            window.requestAnimationFrame(() => pinControl.current?.focus());
          }}>取消固定 {pinned}</button>
        </div>}
        {tracked >= 0 && pinned ? <Neighborhood grid={grid} cell={tracked} actor={pinned} threshold={threshold} label="当前追踪"/> :
          pinned && <p>{pinned} 未出现在当前帧地图中。</p>}
        {actor && actor !== pinned && <div>
          <Neighborhood grid={grid} cell={cell} actor={actor} threshold={threshold} label="选中居民"/>
          <button type="button" ref={pinControl} onClick={() => {
            focusResident(actor);
            window.requestAnimationFrame(() => unpinControl.current?.focus());
          }}>固定追踪 {actor}</button>
        </div>}
        {actor === null && <p>{coordinates(cell, grid.size)} 是空位。</p>}
      </div>
    </div>
    {event?.event_type === "market_close" && <p className="callout" data-terminal={String(event.terminal)}>
      <strong>停止原因</strong> {stopReason(event.terminal)}
    </p>}
    {event && movedActor && origin !== null && destination !== null && <>
      <div className="toolbar">
        <button type="button" onClick={() => selectCell(origin)}>核对原址</button>
        <button type="button" onClick={() => selectCell(destination)}>核对新址</button>
        <button type="button" onClick={() => focusResident(movedActor)}>固定迁居者 {movedActor}</button>
      </div>
      <details className="schelling-moved"><summary>比较迁居者的前后九格</summary>
        <div className="schelling-local-compare">
          {before && <Neighborhood grid={before} cell={origin} actor={movedActor}
            threshold={threshold} label="迁出前的原址"/>}
          <Neighborhood grid={grid} cell={destination} actor={movedActor}
            threshold={threshold} label="迁入后的新址"/>
        </div>
      </details>
      <section className="schelling-changes">
        <h3>邻域受影响的居民</h3>
        {changes.length ? <>
          <p>一次搬迁可以改变邻居集合。对比前后状态，找出是否跨越阈值。</p>
          <div className="table-scroll"><table>
            <caption>事件 {event.seq} · 同组／已占邻居</caption>
            <thead><tr><th scope="col">居民</th><th scope="col">搬迁前</th><th scope="col">搬迁后</th><th scope="col">变化</th></tr></thead>
            <tbody>{changes.map(change => <tr key={change.actor}>
              <th scope="row"><button type="button" className="text-button" onClick={() => focusResident(change.actor)}>
                {change.actor}</button></th>
              <td>{ratio(change.before)}</td><td>{ratio(change.after)}</td>
              <td>{threshold === null ? "阈值缺失" : satisfied(change.before, threshold) ===
                satisfied(change.after, threshold) ? "仍在阈值同侧" : "跨越阈值"}</td>
            </tr>)}</tbody>
          </table></div>
          {pinned && changes.some(change => change.actor === pinned) &&
            <button type="button" onClick={() => cite(event.seq, pinned)}>引用 {pinned} 的邻域变化</button>}
        </> : <p>这次迁居没有其他受影响的居民。</p>}
      </section>
    </>}
  </>;
}

function CityMetrics({ view }: { view: FlagshipView }) {
  const { satisfied, similarity, remaining, moves } = view.frame.metrics;
  return <dl className="schelling-metrics">
    <div><dt>居民满意率</dt><dd>{showValue(satisfied)}{satisfied == null ? "" : "%"}<p>达到阈值的居民 ÷ 全体居民</p></dd></div>
    <div><dt>同类邻接率</dt><dd>{showValue(similarity)}{similarity == null ? "" : "%"}<p>同组占用邻接对 ÷ 全部占用邻接对</p></dd></div>
    <div><dt>搬迁与未达阈值</dt><dd>{showValue(moves)} 次 · {showValue(remaining)} 人</dd></div>
  </dl>;
}

export function SchellingPanel(props: DomainPanelProps) {
  const { stage, briefing, view, comparison, action, course, cite, pinned } = props;
  const grid = openingGrid(briefing);
  if (stage === "intro") return <Practice/>;
  if (stage === "predict") return <>
    <Practice prediction/>
    {grid && grid.cells.indexOf(student) >= 0 && <Neighborhood grid={grid} cell={grid.cells.indexOf(student)}
      actor={student} threshold={getThreshold(course.scenarios.find(arm => arm.id === "baseline")?.parameters.threshold)}
      label="模型开局的 A001"/>}
  </>;
  if (stage === "bid") return grid ? <OpeningMap grid={grid} action={action} course={course}/> : null;
  if (!view) return null;
  if (stage === "compare") return <>
    <p>种子、初始地图与学生开局选择相同。自动居民依各场阈值决定是否搬家。0% 下每位居民都满足最低条件，学生开局搬迁仍计入总数。</p>
    {comparison && <div className="schelling-local-compare">
      {([["baseline", view], ["comparison", comparison]] as const).map(([arm, current]) => {
        const local = current.frame.grid;
        const tracked = local?.cells.indexOf(pinned || student) ?? -1;
        const currentEvent = current.events.find(event => event.tick === current.tick);
        const threshold = getThreshold(current.intervention.threshold);
        const title = threshold === null ? "阈值缺失" : `${threshold}% 阈值`;
        return <section key={arm}>
          <h3>{title}</h3>
          <CityMetrics view={current}/>
          {current.closed && <p>{stopReason(currentEvent?.terminal)}</p>}
          {local && tracked >= 0 &&
            <Neighborhood grid={local} cell={tracked} actor={pinned || student} threshold={threshold} label="同一居民"/>
          }
          {currentEvent && course.evidence_types.includes(currentEvent.event_type) &&
            <button type="button" onClick={() => cite(currentEvent.seq, undefined, arm)}>引用 {title}结果</button>}
        </section>;
      })}
    </div>}
  </>;
  if (stage !== "observe" && stage !== "explain") return null;
  return <>
    {stage === "explain" && <CityMetrics view={view}/>}
    <RunMap {...props} view={view}/>
  </>;
}
