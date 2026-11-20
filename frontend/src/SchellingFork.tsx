import { useMemo, useState } from "react";
import { ForkPanel, ForkPrediction } from "./ForkPanel.tsx";
import { sha256Text } from "./browser-result.ts";
import { displayObservation, type Command, type Session, type Trend } from "./lesson.ts";
import { trendLabel } from "./learning-store.ts";
import { schellingLesson as lesson } from "./models/schelling-lesson.ts";
import { coordinates, residentOptions } from "./models/schelling.ts";
import type { ModelRun } from "./models/record.ts";
import { browserEnvelope, browserEvents, browserEvidence, evidencePointer } from "./run-evidence.ts";

function ForkDecision({ run, tick, send }: { run: ModelRun; tick: number; send: (command: Command) => void }) {
  const options = useMemo(() => {
    const threshold = (run.intervention as { threshold: number }).threshold;
    return residentOptions(run.frames[tick].board!.cells, "A001", threshold);
  }, [run, tick]);
  const [destination, setDestination] = useState("");
  const [prediction, setPrediction] = useState<Trend>();
  if (!options.legal.length) return <p>此时没有符合迁入阈值的空格。可以继续原运行。</p>;
  return <form className="fork-lab-form" onSubmit={event => {
    event.preventDefault();
    if (destination && prediction)
      send({ type: "fork-run", checkpoint: tick, destination: Number(destination), prediction });
  }}>
    <p>A001 在{coordinates(options.origin)}，同组／已占邻格为 {options.home.join("/")}。</p>
    <label className="actor-picker">迁入空格
      <select value={destination} required onChange={event => setDestination(event.target.value)}>
        <option value="" disabled>选择符合阈值的空格</option>
        {options.legal.map(option => <option key={option.cell} value={option.cell}>
          {coordinates(option.cell)} · 同组／已占 {option.local.join("/")}
        </option>)}
      </select>
    </label>
    <ForkPrediction label="你预计分支的期末同组邻接比例会怎样变？" value={prediction} change={setPrediction}/>
    <button className="primary" disabled={!destination || !prediction}>运行分支并核对</button>
  </form>;
}

function ForkResult({ parent, fork, choices }: {
  parent: ModelRun; fork: Extract<NonNullable<Session["fork"]>, { destination: number }>; choices: readonly string[];
}) {
  const branch = fork.run as ModelRun;
  const checkpoint = parent.records[fork.checkpoint];
  const sides = [{ label: "基线", run: parent }, { label: "分支", run: branch }];
  const records = sides.map(({ run }) => new Map(run.records.filter(row =>
    row.seq >= checkpoint.seq && row.event_type === "round_end").map(row => [row.period, row.seq])));
  const rounds = [...new Set(records.flatMap(rows => [...rows.keys()]))].sort((a, b) => a - b);
  const ends = sides.map(({ run }) => run.records.at(-1)!.seq);
  const [focus, setFocus] = useState({ side: 1, tick: fork.checkpoint + 1 });
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("");
  const current = sides[focus.side];
  const event = current.run.records[focus.tick];
  const difference = branch.frames.at(-1)!.metrics.similarity! - parent.frames.at(-1)!.metrics.similarity!;

  async function download() {
    setExporting(true);
    setStatus("");
    try {
      const course = lesson.casePackage!;
      const runs = await Promise.all(sides.map(async ({ run }, index) => {
        const envelope = await browserEnvelope(run, course, { choices, policy: lesson.policy.baseline,
          ...(index ? { parentRunId: parent.id, checkpoint: fork.checkpoint, destination: fork.destination } : {}) });
        const events = browserEvents(run, course);
        const ticks = index ? [checkpoint.seq, checkpoint.seq + 1, ends[index]] : [checkpoint.seq, ends[index]];
        const frames = run.frames.map(({ tick, board, metrics }) => ({ tick, board, metrics }));
        return {
          envelope,
          sources: ticks.map(tick => evidencePointer(browserEvidence(envelope, events[tick], ends[index]))),
          records: run.records,
          frames,
          gridDigest: await sha256Text(JSON.stringify(frames.map(frame => frame.board))),
        };
      }));
      const raw = { schema: "ecosimedu.schelling-fork/v1", checkpoint: fork.checkpoint, destination: fork.destination,
        prediction: fork.prediction, baseline: runs[0], branch: runs[1] };
      const url = URL.createObjectURL(new Blob([JSON.stringify(raw)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "EcoSimEdu-居住隔离-轮间迁居.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("已导出检查点、两组运行和原事件。");
    } catch {
      setStatus("暂时无法导出这组分支。");
    } finally { setExporting(false); }
  }

  return <section aria-label="轮间迁居对照">
    <h3>轮间迁居对照</h3>
    <p>两组共用种子 {parent.seed}，保留至第 {checkpoint.period} 轮末的事件 {checkpoint.seq}。
      分支在下一轮开始前让 A001 迁入{coordinates(fork.destination)}。</p>
    <p>原预测为「{trendLabel[fork.prediction]}」。期末同组邻接比例相差 {displayObservation(Number(difference.toFixed(2)))} 个百分点（分支减基线）。</p>
    <table className="source-metrics">
      <caption>同组邻接比例（%）</caption>
      <thead><tr><th scope="col">观察点</th>{sides.map(side => <th key={side.label} scope="col">{side.label}</th>)}</tr></thead>
      <tbody>{[...rounds.map(round => ({ label: `第 ${round} 轮末`, ticks: records.map(rows => rows.get(round)) })),
        { label: "收尾", ticks: ends }].map(row => <tr key={row.label}>
        <th scope="row">{row.label}</th>
        {row.ticks.map((tick, side) => <td key={sides[side].label}>
          {displayObservation(tick === undefined ? null : sides[side].run.frames[tick].metrics.similarity)}
          {tick !== undefined && <div><button type="button" className="text-button"
            onClick={() => setFocus({ side, tick })}>{sides[side].label}事件 {tick}</button></div>}
        </td>)}
      </tr>)}</tbody>
    </table>
    <button type="button" className="text-button" onClick={() => setFocus({ side: 1, tick: checkpoint.seq + 1 })}>查看分支的迁居事件</button>
    <section aria-label="分支原事件" aria-live="polite">
      <h4>{current.label} · 事件 {event.seq}</h4>
      <p>{event.summary}</p>
    </section>
    <details className="trace-details"><summary>核对两组运行编号</summary>
      {sides.map(({ label, run }) => <p key={label} className="run-identity">{label} · {run.id}</p>)}
    </details>
    <button type="button" onClick={() => void download()} disabled={exporting}>导出轮间迁居证据</button>
    {status && <p role="status">{status}</p>}
  </section>;
}

export function SchellingFork({ session, send }: { session: Session; send: (command: Command) => void }) {
  const run = session.run as ModelRun;
  const fork = session.fork;
  return <ForkPanel lesson={lesson} session={session} send={send} title="在轮末再搬一次"
    description="在下一轮开始前，让 A001 试一次符合阈值的迁居，看看后续邻域怎样变化。"
    seekLabel={tick => `走到第 ${run.records[tick].period} 轮末`}
    decision={tick => <ForkDecision key={tick} run={run} tick={tick} send={send}/>}>
    {fork?.destination !== undefined && <ForkResult key={fork.run.id} parent={run} fork={fork} choices={session.choices}/>}
  </ForkPanel>;
}
