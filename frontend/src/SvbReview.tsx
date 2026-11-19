import definition from "../../cases/svb_run/case.json" with { type: "json" };
import { allNotes, notesLink } from "./learning-store.ts";
import { displayObservation, type Frame, type Session } from "./lesson.ts";
import { distributedPolicy, svbLesson, type SvbRun } from "./svb.ts";
import { SvbTransfer } from "./SvbTransfer.tsx";

export function SvbRelationships({ session, select, locate }: {
  session: Session;
  select: (id: string) => void;
  locate: (tick: number, metric: string, id?: string, eventId?: string) => void;
}) {
  const run = session.run as SvbRun;
  const id = session.selected!;
  const observed = run.observations[session.cursor][id] ?? [];
  return <details className="trace-details">
    <summary>{id} 观察的三名储户</summary>
    <p>只有邻居在更早轮次发出的首次申请，才进入这一轮的局部信息。</p>
    <ul>{run.network[id].map(neighbor => {
      const message = observed.find(item => item.actorId === neighbor);
      return <li key={neighbor}>
        <button type="button" className="text-button" onClick={() => select(neighbor)}>选择 {neighbor}</button>
        {message ? session.stage === 3 ?
          <button type="button" className="text-button" onClick={() => locate(message.tick, "requested", neighbor, message.eventId)}>
            回查 {neighbor} 首次申请 {message.eventId}
          </button> : <span> · 第 {message.tick} 轮的首次申请 {message.eventId}</span> : <span> · 本轮尚未收到申请消息</span>}
      </li>;
    })}</ul>
  </details>;
}

const assets = ({ metrics }: Frame) => metrics.cash! + metrics.marketValue! + metrics.loans!;
const endMetrics = ["cash", "sold", "requested", "paid", "queued", "equity", "sale_loss"] as const;

function SvbComparison({ session }: { session: Session }) {
  const baseline = session.run as SvbRun;
  const policy = session.comparison!.run as SvbRun;
  const opening = baseline.frames[0];
  const openingPolicy = policy.frames[0];
  const final = baseline.frames.at(-1)!;
  const finalPolicy = policy.frames.at(-1)!;
  const label = definition.scenarios.find(scenario => scenario.id === policy.scenario)!;
  const changedNetwork = policy.scenario === "network";
  const firstWait = (run: SvbRun) => run.frames.find(frame => frame.metrics.queued! > 0);
  const baselineWait = firstWait(baseline);
  const policyWait = firstWait(policy);
  return <section className="edu-panel svb-course-evidence" aria-label="制度对照的账表与共同条件">
    <h2>{label.label}的配对证据</h2>
    <p>两组使用种子 {baseline.seed}、相同的 {opening.actors.length} 位储户、相同的 D01 工资申请时点、
      相同的初始存款 {opening.metrics.deposits}、初始总资产 {assets(opening)} 和初始净资产 {opening.metrics.equity}。
      两组经历相同的证券标价冲击，结算与借款规则也相同。金额均为教学资金单位。</p>
    <p>{changedNetwork ? <>
      只改变观察关系。每人仍观察三位邻居，总边数仍为 {Object.values(policy.network).flat().length}。
      例如 D01 的消息源从 {baseline.network.D01.join("、")} 改为 {policy.network.D01.join("、")}。
      两组的初始现金、证券和贷款相同。
    </> : <>
      冲击前按原标价换持等值现金。初始现金 {opening.metrics.cash} → {openingPolicy.metrics.cash}，
      持有证券 {opening.metrics.units} → {openingPolicy.metrics.units} 单位。
      能立即动用的现金增加，暴露于这次重估的证券减少。两组沿用同一信息网络。
    </>}</p>
    {baselineWait && policyWait && <p>首次轮末待付。基线第 {baselineWait.tick} 轮为 {baselineWait.metrics.queued}，
      干预组第 {policyWait.tick} 轮为 {policyWait.metrics.queued}。这是各自首次出现待付的轮次。按同期比较请看上方曲线。</p>}
    <table className="source-metrics">
      <caption>第 {final.tick} 轮比较，差额为干预组减基线。金额以资金单位计，出售数量以证券单位计。</caption>
      <thead><tr><th scope="col">指标</th><th scope="col">基线</th><th scope="col">干预</th><th scope="col">差额</th></tr></thead>
      <tbody>{endMetrics.map(id => {
        const metric = svbLesson.metrics.find(item => item.id === id)!;
        const change = finalPolicy.metrics[id]! - final.metrics[id]!;
        return <tr key={id}><th scope="row">{id === "equity" ? "净资产" : metric.label}</th>
          <td>{displayObservation(final.metrics[id])}</td><td>{displayObservation(finalPolicy.metrics[id])}</td>
          <td>{change > 0 && "+"}{displayObservation(change)}</td></tr>;
      })}</tbody>
    </table>
    <p>{changedNetwork ? "用申请和实付的差额解释待付为何变化，再看资金与证券路径是否也改变。" :
      "同时核对支付与急售损失，给出资产组合调整如何影响两者的解释。"}
      这组结论来自当前教学种子、行为阈值和折价规则，现实银行须另行核对融资能力和储户行为。</p>
  </section>;
}

export function SvbLab({ session }: { session: Session }) {
  const policies = [svbLesson.policy.max, distributedPolicy];
  const notes = (() => { try { return allNotes(localStorage); } catch { return []; } })();
  const saved = policies.map(policy => notes.find(note => note.baselineId === session.run?.id &&
    note.policy === policy && note.evidence?.baseline && note.evidence.comparison &&
    JSON.stringify(note.choices) === JSON.stringify(session.choices)));
  return <>
    <section className="edu-panel svb-course-evidence" aria-label="SVB 学习记录">
      <h2>两组制度实验</h2>
      <ul>{policies.map((policy, i) => <li key={policy}>
        {saved[i] ? <a href={notesLink(saved[i]!.id)}>打开{svbLesson.policy.labels?.[policy]}的解释与原事件</a> :
          <span>{svbLesson.policy.labels?.[policy]} · 待保存证据</span>}
      </li>)}</ul>
      {!saved.every(Boolean) && <p>分别完成两项干预，各保存一次带原事件的解释，即可做迁移题。</p>}
    </section>
    {saved.every(Boolean) && <SvbTransfer/>}
  </>;
}

export function SvbReview({ session }: { session: Session }) {
  if (!session.run) return null;
  if (session.stage === 4 && session.comparison) return <SvbComparison session={session}/>;
  if (session.stage === 3 && session.cursor > 0) {
    const run = session.run as SvbRun;
    const { cursor } = session;
    const { metrics: before } = run.frames[cursor - 1];
    const { metrics: after, events } = run.frames[cursor];
    const deliveries = Object.values(run.observations[cursor]).flat().filter(message => message.tick === cursor - 1).length;
    return <details className="edu-panel trace-details">
      <summary>第 {cursor} 轮怎样形成待付与账表变化</summary>
      <ol>
        <li><strong>消息。</strong>本轮初首次收到 {deliveries} 条邻居申请消息。上一轮待付为 {before.queued}。
          同轮的新申请从下一轮起才会被邻居看见。</li>
        <li><strong>申请。</strong>本轮新增 {after.requested! - before.requested!}，进入队列。申请本身保留银行现金和存款负债。</li>
        <li><strong>结算。</strong>按原入队顺序实际支付 {after.paid! - before.paid!}，剩余待付 {after.queued}。
          见「从结果回查事件」的逐笔来源。</li>
      </ol>
      <dl>
        <dt>到期可用现金与净资产</dt>
        <dd>轮末现金 {after.cash} 可用于即时结算。轮末净资产 {after.equity} 是当期资产减负债，证券和贷款也计入资产。</dd>
        <dt>证券重估与急售折价</dt>
        <dd>{events.find(item => item.kind === "revaluation")?.text ?? "本轮没有新重估。"}
          {events.find(item => item.kind === "sale")?.text ?? "本轮没有急售。"}重估变动计入证券市值，急售额外损失按实售价与当期标价之差计算。</dd>
        <dt>借款与偿付</dt>
        <dd>{events.find(item => item.kind === "support")?.text ?? "本轮没有新增支持借款。"}
          轮末借款负债 {after.borrowing}。实付使银行现金和存款负债等额减少。</dd>
      </dl>
      <p>金额均为教学资金单位。</p>
    </details>;
  }
  if (session.stage !== 2) return null;
  const frames = session.run.frames.slice(0, session.cursor + 1);
  const application = frames.find(frame => frame.events.some(event => event.actorId === "D01" && event.kind === "request"));
  if (!application) return null;
  const payment = frames.find(frame => frame.events.some(event => event.actorId === "D01" && event.kind === "payment"));
  return <section className="prediction-review" aria-label="核对入场预测">
    <h2>申请与到账</h2>
    <p>你原先选了「{session.choices[1] === "at-request" ? "提交申请时" : "实际支付时"}」。</p>
    <p>D01 在第 {application.tick} 轮提出申请。申请事件增加待付额。
      {payment ? `在第 ${payment.tick} 轮实际支付时，这笔款项才使银行现金和存款负债同减。` :
        "已揭示的记录里暂未出现 D01 到账事件，可以继续播放。"}
    </p>
  </section>;
}
