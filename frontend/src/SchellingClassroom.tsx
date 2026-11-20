import { Studio } from "./Studio";
import { TransferAfterEvidence } from "./FlagshipTransfer.tsx";
import { schellingLesson as lesson } from "./models/schelling-lesson.ts";
import { coordinates, residentOptions } from "./models/schelling.ts";
import type { ModelRun } from "./models/record.ts";
import { displayObservation, type Session } from "./lesson.ts";

type Relocation = { actor_id: string; origin: number; destination: number; source: "student" | "rule";
  before: readonly number[]; after: readonly number[];
  changed_neighbors: readonly { actor: string; before: readonly number[]; after: readonly number[] }[] };

const movesAt = (run: ModelRun, tick: number) => {
  const event = run.records[tick];
  return event.event_type === "student_move" || event.event_type === "move" ? event.data as Relocation : undefined;
};
const countLabel = (counts: readonly number[]) => counts[1] ? counts.join(" / ") : "0 / 0（无已占邻格，按规则达标）";

function ResidentDecision({ session }: { session: Session }) {
  const run = session.run as ModelRun;
  const id = session.selected!;
  const move = movesAt(run, session.cursor);
  const moved = move?.actor_id === id;
  const board = run.frames[moved ? session.cursor - 1 : session.cursor].board!;
  const threshold = (run.intervention as { threshold: number }).threshold;
  const { origin, home, satisfied, legal } = residentOptions(board.cells, id, threshold);
  const candidate = legal[0];

  return <section aria-label="住户阈值与候选空格" className="flagship-evidence">
    <h3>{id} 的邻域决策</h3>
    <p>{moved ? "搬迁前" : "当前"}在{coordinates(origin)}。同组 / 已占邻格 {countLabel(home)}，最低阈值 {threshold}%。</p>
    {moved ? <p>本次实际迁入{coordinates(move.destination)}，迁入后同组 / 已占邻格 {countLabel(move.after)}。
      {move.source === "student" ?
        `这是你的预留空格选择。按本组阈值，迁入后${legal.some(option => option.cell === move.destination) ? "达标" : "仍未达标"}。` :
        "自动规则在原址未达阈值时搜索满足阈值的空格。"}
    </p> : <p>{satisfied ? "现址达标，自动规则会留在原地。" : candidate ?
      `现址未达阈值。按这一帧，有 ${legal.length} 处空格搬入后达标，例如${coordinates(candidate.cell)}（${countLabel(candidate.local)}）。` :
      "现址未达阈值。这一帧没有搬入后能达标的空格，住户只能留在原地。"}
      {!satisfied && candidate && "这是当前可行条件，下一次实际动作还取决于轮序和当时的空位。"}
    </p>}
  </section>;
}

function SchellingReview({ session }: { session: Session }) {
  if (!session.run) return null;
  const run = session.run as ModelRun;
  if (session.stage === 4 && session.comparison) {
    const treatment = session.comparison.run as ModelRun;
    const final = run.frames.at(-1)!.metrics;
    const treated = treatment.frames.at(-1)!.metrics;
    const threshold = (treatment.intervention as { threshold: number }).threshold;
    const end = treatment.records.at(-1)!.data as { terminal: string };
    const opening = run.frames[0].actors;
    const groupA = opening.filter(actor => actor.state === "A").length;
    return <section className="edu-panel flagship-evidence" aria-label="阈值配对与停止条件">
      <h2>把阈值和空间格局分开看</h2>
      <p>同种子 {run.seed}，两组从同一地图出发，保留 {run.frames[0].actors.length} 位居民和你的 A001 决定。
        最低阈值 30% → {threshold}%。满足条件的空位和后续行动依次由当时的地图决定。</p>
      <table className="source-metrics flagship-table">
        <caption>最终地图指标。两组分别按各自阈值计算达标比例。</caption>
        <thead><tr><th scope="col">指标</th><th scope="col">30%</th><th scope="col">{threshold}%</th></tr></thead>
        <tbody>{lesson.metrics.map(metric => <tr key={metric.id}>
          <th scope="row">{metric.label}（{metric.unit}）</th><td>{displayObservation(final[metric.id])}</td>
          <td>{displayObservation(treated[metric.id])}</td>
        </tr>)}</tbody>
      </table>
      {end.terminal === "blocked" && <p>最后一轮没有可行搬迁，仍有 {treated.remaining} 户未达阈值。
        停止源于找不到合格空格，未达阈值的住户仍留在原地。</p>}
      {end.terminal === "round_limit" && <p>运行到了轮数上限，最后仍有 {treated.remaining} 户未达阈值。表里是截至该轮的观测。</p>}
      {end.terminal === "all_satisfied" && <p>干预组结束时所有住户达到该组阈值。
        {treated.moves === 0 && "本次没有搬迁，开局的空间格局得以保留。"}</p>}
      {final.satisfied === treated.satisfied && final.similarity !== treated.similarity &&
        <p>两组达标比例同为 {final.satisfied}%，但同组邻接比例不同。达标按住户计，空间分化按邻接对计。</p>}
      <p>每次搬迁改写两处邻域，改变下一批住户的决策条件。A 组 {groupA} 户、B 组 {opening.length - groupA} 户。
        搬迁改变位置，两组人口比例始终保持开局水平。</p>
    </section>;
  }
  if (session.stage !== 2 && session.stage !== 3) return null;
  const move = movesAt(run, session.cursor);
  const prior = run.frames[session.cursor - 1];
  const frame = run.frames[session.cursor];
  const summary = run.records[session.cursor];
  return <>
    {move && prior && <section className="edu-panel flagship-evidence" aria-label="这次搬迁和全局变化">
      <h2>{move.actor_id} 的搬迁如何改变邻里</h2>
      <p>事件 {frame.tick}，从{coordinates(move.origin)}迁入{coordinates(move.destination)}。
        迁居前后自身同组 / 已占邻格 {countLabel(move.before)} → {countLabel(move.after)}。</p>
      <p>影响 {move.changed_neighbors.length} 户的邻居集合。
        全图同组邻接比例 {prior.metrics.similarity}% → {frame.metrics.similarity}%，
        达到阈值的比例 {prior.metrics.satisfied}% → {frame.metrics.satisfied}%。</p>
      {prior.metrics.satisfied === frame.metrics.satisfied && <p>这次全图达标比例相同，仍可逐户核对邻居的变化。</p>}
      <details className="trace-details">
        <summary>查看受影响的邻居</summary>
        <table className="source-metrics flagship-table">
          <caption>同组 / 已占邻格</caption>
          <thead><tr><th scope="col">居民</th><th scope="col">搬迁前</th><th scope="col">搬迁后</th></tr></thead>
          <tbody>{move.changed_neighbors.map(change => <tr key={change.actor}>
            <th scope="row">{change.actor}</th><td>{change.before.join("/")}</td><td>{change.after.join("/")}</td>
          </tr>)}</tbody>
        </table>
      </details>
    </section>}
    {!move && (summary.event_type === "round_end" || summary.event_type === "market_close") &&
      <p>事件 {frame.tick} · {summary.summary}</p>}
    <details className="trace-details"><summary>回看你的决定与预测</summary>
      <p>{session.choices[0] === "move" ? "搬到标记的空格" : "留在原地"}。
        原预测是「{session.choices[1] === "prediction-0" ? "原址周围和新址周围的住户" : "只有搬家的住户"}」。</p>
      <p>核对规则 · {lesson.teaching.rule}</p>
    </details>
  </>;
}

export default function SchellingClassroom() {
  return <Studio lesson={lesson} review={session => <SchellingReview session={session}/>}
    actorDetail={session => <ResidentDecision session={session}/>}
    afterInvestigation={session => <TransferAfterEvidence caseId="schelling_segregation" session={session} policy={50}/>}/>;
}
