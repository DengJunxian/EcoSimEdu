import { useState } from "react";
import { auctionCheckpoint, roundEnds, type AuctionRun } from "./auction.ts";
import { sha256Text } from "./browser-result.ts";
import { ForkPanel, ForkPrediction } from "./ForkPanel.tsx";
import { trendLabel } from "./learning-store.ts";
import { displayObservation, type Command, type Lesson, type Session, type Trend } from "./lesson.ts";
import { browserEnvelope, browserEvents, browserEvidence, evidencePointer } from "./run-evidence.ts";

function CancelDecision({ run, tick, send }: { run: AuctionRun; tick: number; send: (command: Command) => void }) {
  const [prediction, setPrediction] = useState<Trend>();
  const { order } = auctionCheckpoint(run, tick)!;
  return <form className="fork-lab-form" onSubmit={event => {
    event.preventDefault();
    if (prediction) send({ type: "fork-run", checkpoint: tick, action: "cancel-open-order", prediction });
  }}>
    <p>事件 {tick} 后，B01 的订单 {order.order_id} 仍在簿上，限价 {order.price} 代币，数量 {order.quantity} 件。</p>
    <ForkPrediction label="如果现在撤单，收盘时全市场的累计成交量会怎样变？" value={prediction} change={setPrediction}/>
    <button className="primary" disabled={!prediction}>撤回限价单并运行分支</button>
  </form>;
}

function AuctionForkResult({ lesson, parent, fork, choices }: {
  lesson: Lesson; parent: AuctionRun; fork: NonNullable<Session["fork"]>; choices: readonly string[];
}) {
  const branch = fork.run as AuctionRun;
  const cancellation = branch.frames[fork.checkpoint + 1];
  const sides = [{ label: "基线", run: parent }, { label: "分支", run: branch }];
  const rows = sides.map(({ run }) => roundEnds(run));
  const lastRow = rows[0].length - 1;
  const [index, setIndex] = useState(lastRow);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("");
  const finalDifference = branch.frames.at(-1)!.metrics.volume! - parent.frames.at(-1)!.metrics.volume!;

  async function download() {
    setExporting(true);
    setStatus("");
    try {
      const course = lesson.casePackage!;
      const runs = await Promise.all(sides.map(async ({ run }, side) => {
        const envelope = await browserEnvelope(run, course, { choices, policy: lesson.policy.baseline, market: run.market,
          ...(side ? { parentRunId: parent.id, checkpoint: fork.checkpoint, action: fork.action } : {}) });
        const events = browserEvents(run, course);
        const close = run.frames.length - 1;
        const ticks = side ? [fork.checkpoint, cancellation.tick, close] : [fork.checkpoint, close];
        return { envelope, frames: run.frames,
          bookDigest: await sha256Text(JSON.stringify(run.frames.map(frame => [frame.book, frame.accounts]))),
          sources: ticks.map(tick => evidencePointer(browserEvidence(envelope, events[tick], close))) };
      }));
      const data = { schema: "ecosimedu.auction-fork/v1", checkpoint: fork.checkpoint, action: fork.action,
        prediction: fork.prediction, baseline: runs[0], branch: runs[1] };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "EcoSimEdu-双向拍卖-中途撤单.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("已导出两组运行、订单簿和原事件。");
    } catch { setStatus("暂时无法导出这组分支。"); }
    finally { setExporting(false); }
  }

  const metricRows = [
    { label: "累计成交（件）", value: (run: AuctionRun, side: number) => rows[side][index].metrics.volume },
    { label: "B01 已成交（件）", value: (run: AuctionRun, side: number) => {
      const tick = rows[side][index].sourceTick;
      return tick === undefined ? null : run.frames[tick].accounts.B01.filled;
    } },
    { label: "最近成交价（代币）", value: (run: AuctionRun, side: number) => rows[side][index].metrics.last_price },
  ];

  return <section aria-label="撤单对照">
    <h3>撤单对照</h3>
    <p>两组保留至事件 {fork.checkpoint} 的订单簿与账户。分支事件 {cancellation.tick} 撤回 {cancellation.record.order_id}，随后按原报价顺序继续撮合。</p>
    <p>原预测为「{trendLabel[fork.prediction]}」。收盘时累计成交量相差 {displayObservation(finalDifference)} 件（分支减基线）。</p>
    <label className="actor-picker">核对时点
      <select value={index} onChange={event => setIndex(Number(event.target.value))}>
        {rows[0].map((row, point) => point > 0 && <option key={row.tick} value={point}>{row.axisLabel}</option>)}
      </select>
    </label>
    <table className="source-metrics auction-fork-table">
      <caption>{rows[0][index].axisLabel}成交对照</caption>
      <thead><tr><th scope="col">指标</th>{sides.map(({ label }) => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{metricRows.map(row => <tr key={row.label}>
        <th scope="row">{row.label}</th>
        {sides.map(({ run, label }, side) => <td key={label}>{displayObservation(row.value(run, side))}</td>)}
      </tr>)}</tbody>
    </table>
    <details className="trace-details">
      <summary>核对撤单与下一笔成交</summary>
      <p>分支事件 {cancellation.tick} · {cancellation.events[0].text}</p>
      {sides.map(({ label, run }) => {
        const trade = run.frames.find(frame => frame.tick > fork.checkpoint && frame.record.event_type === "trade");
        return <p key={label}><strong>{label}</strong> · {trade ? `事件 ${trade.tick} · ${trade.events[0].text}` : "此后无成交。"}</p>;
      })}
    </details>
    <details className="trace-details"><summary>核对两组运行编号</summary>
      {sides.map(({ label, run }) => <p key={label} className="run-identity">{label} · {run.id}</p>)}
    </details>
    <button type="button" onClick={() => void download()} disabled={exporting}>导出中途撤单证据</button>
    {status && <p role="status">{status}</p>}
  </section>;
}

export function AuctionFork({ lesson, session, send }: { lesson: Lesson; session: Session; send: (command: Command) => void }) {
  const run = session.run as AuctionRun;
  const fork = session.fork;
  return <ForkPanel lesson={lesson} session={session} send={send} title="试一次中途撤单"
    description="在撮合结束后且 B01 的限价单仍在簿上时，可以撤回这张单，观察之后的成交。"
    seekLabel={tick => `走到可撤单的事件 ${tick}`}
    decision={tick => <CancelDecision key={tick} run={run} tick={tick} send={send}/>}>
    {fork?.action === "cancel-open-order" && <AuctionForkResult key={fork.run.id} lesson={lesson} parent={run}
      fork={fork} choices={session.choices}/>}
  </ForkPanel>;
}
