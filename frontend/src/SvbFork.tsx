import { useState } from "react";
import { ForkPanel, ForkPrediction } from "./ForkPanel.tsx";
import { trendLabel } from "./learning-store.ts";
import { displayObservation, type Command, type Session, type Trend } from "./lesson.ts";
import { browserEnvelope, browserEvents, browserEvidence, evidencePointer } from "./run-evidence.ts";
import { svbCheckpoint, svbLesson, type SvbRun } from "./svb.ts";

function DeferDecision({ run, tick, send }: { run: SvbRun; tick: number; send: (command: Command) => void }) {
  const [prediction, setPrediction] = useState<Trend>();
  const checkpoint = svbCheckpoint(run, tick)!;
  const { queued, cash } = run.frames[tick].metrics;
  return <form className="fork-lab-form" onSubmit={event => {
    event.preventDefault();
    if (prediction) send({ type: "fork-run", checkpoint: tick, action: "defer-protective", prediction });
  }}>
    <p>第 {tick} 轮末，银行待付 {queued}，现金 {cash}。按模型规则，D01 下一轮可为 {checkpoint.available} 资金单位的未保障余额提出防御性提款。</p>
    <ForkPrediction label="若 D01 暂缓一轮，下一轮末的全行待付会怎样变？" value={prediction} change={setPrediction}/>
    <button className="primary" disabled={!prediction}>暂缓一轮并运行分支</button>
  </form>;
}

const metrics = ["requested", "paid", "queued", "cash", "equity"];
const focusEvents = (run: SvbRun, tick: number) => run.frames[tick].events.filter(event =>
  event.actorId === "D01" || event.kind === "sale" || event.kind === "support");

function SvbForkResult({ parent, fork, choices }: {
  parent: SvbRun; fork: NonNullable<Session["fork"]>; choices: readonly string[];
}) {
  const branch = fork.run as SvbRun;
  const next = fork.checkpoint + 1;
  const close = parent.frames.length - 1;
  const [tick, setTick] = useState(next);
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const sides = [{ label: "基线", run: parent }, { label: "分支", run: branch }];
  const delta = branch.frames[next].metrics.queued! - parent.frames[next].metrics.queued!;

  async function download() {
    setExporting(true);
    setStatus("");
    try {
      const course = svbLesson.casePackage!;
      const runs = await Promise.all(sides.map(async ({ run }, index) => {
        const envelope = await browserEnvelope(run, course, { choices, policy: svbLesson.policy.baseline,
          ...(index === 1 ? { parentRunId: parent.id, checkpoint: fork.checkpoint, action: fork.action } : {}) });
        const events = browserEvents(run, course);
        return { envelope, frames: run.frames, observations: run.observations, network: run.network,
          sources: events.filter(event => event.frameTick === next && event.actorIds.includes("D01"))
            .map(event => evidencePointer(browserEvidence(envelope, event, close))) };
      }));
      const data = { schema: "ecosimedu.svb-fork/v1", checkpoint: fork.checkpoint, action: fork.action,
        prediction: fork.prediction, baseline: runs[0], branch: runs[1] };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "EcoSimEdu-SVB-暂缓提款.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("已导出两组轮末账本、原始流水和消息来源。");
    } catch { setStatus("暂时无法导出这组分支。"); }
    finally { setExporting(false); }
  }

  return <section aria-label="暂缓提款对照">
    <h3>暂缓提款对照</h3>
    <p>两组保留至第 {fork.checkpoint} 轮末的账本、排队顺序和消息。分支让 D01 在第 {next} 轮暂缓，随后按既有规则重新判断。</p>
    <p>原预测为「{trendLabel[fork.prediction]}」。第 {next} 轮末待付差额为 {displayObservation(delta)} 个资金单位（分支减基线）。</p>
    <label className="actor-picker">核对轮次
      <select value={tick} onChange={event => setTick(Number(event.target.value))}>
        {parent.frames.slice(fork.checkpoint).map(frame => <option key={frame.tick} value={frame.tick}>
          第 {frame.tick} 轮末{frame.tick === close ? " · 收尾" : ""}
        </option>)}
      </select>
    </label>
    <table className="source-metrics">
      <caption>第 {tick} 轮末账表（资金单位）</caption>
      <thead><tr><th scope="col">指标</th><th scope="col">基线</th><th scope="col">分支</th></tr></thead>
      <tbody>{metrics.map(id => <tr key={id}>
        <th scope="row">{svbLesson.metrics.find(metric => metric.id === id)?.label}</th>
        {sides.map(({ label, run }) => <td key={label}>{displayObservation(run.frames[tick].metrics[id])}</td>)}
      </tr>)}</tbody>
    </table>
    <details className="trace-details">
      <summary>查看本轮 D01、急售和借款流水</summary>
      {sides.map(({ label, run }) => <section key={label} aria-label={`${label}流水`}>
        <h4>{label}</h4>
        {focusEvents(run, tick).length ? <ul>{focusEvents(run, tick).map(event => <li key={event.id}>
          事件 {event.id} · {event.text}
        </li>)}</ul> : <p>该轮没有这几类流水。</p>}
      </section>)}
    </details>
    <details className="trace-details"><summary>核对两组运行编号</summary>
      {sides.map(({ label, run }) => <p key={label} className="run-identity">{label} · {run.id}</p>)}
    </details>
    <button type="button" onClick={() => void download()} disabled={exporting}>导出暂缓提款证据</button>
    {status && <p role="status">{status}</p>}
  </section>;
}

export function SvbFork({ session, send }: { session: Session; send: (command: Command) => void }) {
  const run = session.run as SvbRun;
  const fork = session.fork;
  return <ForkPanel lesson={svbLesson} session={session} send={send} title="暂缓一次防御性提款"
    description="在 D01 即将追加提款的轮末试着暂缓一轮，核对待付、实付和现金怎样变化。"
    seekLabel={tick => `走到第 ${tick} 轮末`}
    decision={tick => <DeferDecision key={tick} run={run} tick={tick} send={send}/>}>
    {fork?.action === "defer-protective" && <SvbForkResult key={fork.run.id} parent={run} fork={fork} choices={session.choices}/>}
  </ForkPanel>;
}
