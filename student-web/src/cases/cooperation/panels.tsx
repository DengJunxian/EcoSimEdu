import { SignalChain } from "../../../../content/information-ui";
import { useState } from "react";
import { LedgerEvidence, TraceClaims, TraceLenses, useTrace } from "../../emergence/trace-view";
import { FeedbackExplanation } from "../../emergence/feedback-explanation";
import { MetricChart, showValue } from "../../lesson-view";
import type { DomainPanelProps, FlagshipView } from "../../learning/flagship-types";
import "./cooperation.css";

type Event = FlagshipView["events"][number];
type Amounts = Record<string, number>;
type Decision = Event & {
  turn: number; choice: string; signal?: string; private_a_after_pct?: number; visible_action_ids: string[];
  choice_if_private_a: string; choice_if_private_b: string; action_likelihood_given_a: number;
  action_likelihood_given_b: number; public_a_before_pct: number; public_a_after_pct: number;
};
type Contributions = Event & { round: number; contributions: Amounts; public_return: number };
type Settlement = Event & {
  round: number; gross: Amounts; outgoing: Amounts; fines: Amounts; net: Amounts;
  sanctions: { from: string; to: string; points: number; cost: number; fine: number }[];
};
type Withdrawal = Event & {
  period: number; start_stock: number; remaining_stock: number; allocations: Amounts;
  plans: Amounts; requests: Amounts; fines: Amounts; monitored: string[];
  monitoring_cost: number; gross_value: number; participant_net: number;
  monitor_budget_before: number; monitor_budget_after: number;
};
type Growth = Event & { period: number; remaining_stock: number; growth: number; next_stock: number };
type CascadeBriefing = { signal: string; prior: number; public_actions: { actor: string; choice: string }[] };
const percent = (value: number) => `${showValue(value)}%`;
const sum = (record: Amounts) => Object.values(record).reduce((total, value) => total + value, 0);
const text = showValue;
const actors = ["P1", "P2", "P3", "P4"];

function visible(view: FlagshipView) {
  return view.events.slice(0, view.tick + 1);
}

function Facts({ rows }: { rows: [string, string][] }) {
  return <dl className="cooperation-facts">{rows.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function CascadePanel({ stage, briefing, view, comparison, pin, pinned, seek, cite, explore }: DomainPanelProps) {
  if (stage === "predict" || stage === "bid") {
    if (!briefing || !("signal" in (briefing as object))) return <p role="status">正在读取 D03 的抽样卡…</p>;
    const role = briefing as CascadeBriefing;
    return <section className="cooperation-world" aria-label="D03 可见信息">
      <h2>你的抽样卡</h2>
      <Facts rows={[["本人私信号", role.signal], ["行动前 A 箱公共后验", percent(role.prior)]]}/>
      <p>你可以看到{role.public_actions.length ? role.public_actions.map(action => `${action.actor} 选择 ${action.choice}`).join("、") :
        "自己的线索"}。其他人的抽样与本场答案在结束时揭示。</p>
    </section>;
  }
  if (!view) return null;
  const events = visible(view);
  const decisions = events.filter(event => event.event_type === "decision") as Decision[];
  const current = events.at(-1);
  const verification = events.find(event => event.event_type === "verification");
  const selected = current?.event_type === "decision" ? current as Decision : decisions.find(event => event.actors?.[0] === pinned);
  const compare = comparison && visible(comparison).find(event => event.event_type === "decision" &&
    event.turn === selected?.turn) as Decision | undefined;
  return <section className="cooperation-world" aria-label="私人抽样与行动链">
    <h2>谁影响了这次选择？</h2>
    {!decisions.length && <p>第一位参与者还未行动。向前推进一个事件查看行动链。</p>}
    {decisions.length > 0 && <SignalChain label="已发生的行动" disabled={stage === "compare"} actions={decisions.map(event => {
      const actor = event.actors?.[0] ?? "";
      return { id: String(event.tick), actor, choice: event.choice, signal: event.signal,
        observed: selected?.visible_action_ids.includes(actor), active: selected?.seq === event.seq };
    })} choose={event => { pin(event.actor); seek(Number(event.id)); }}/>}
    {selected && <>
      <h3>{selected.actors?.[0]} 的观察与行动</h3>
      <p>{selected.visible_action_ids.length ? `观察过 ${selected.visible_action_ids.join("、")} 的公开行动。` :
        "行动前没有可见的前序行动。"}
        {Array.isArray(selected.observed_origin_ids) && selected.observed_origin_ids.length > 0 && " 本人也看到共同核验。"}
      </p>
      <Facts rows={[
        ["动作前的公共 A 箱后验", percent(selected.public_a_before_pct)],
        ["个人参考后验", selected.private_a_after_pct === undefined ? "私人抽样待揭晓" : percent(selected.private_a_after_pct)],
        ["动作后的公共 A 箱后验", percent(selected.public_a_after_pct)],
      ]}/>
      <p>抽到 A 时会选 {selected.choice_if_private_a}，抽到 B 时会选 {selected.choice_if_private_b}。
        当前行动在真实状态 A / B 下的似然分别为 {text(selected.action_likelihood_given_a)} / {text(selected.action_likelihood_given_b)}。</p>
      {compare && <p>对照同为第 {compare.turn} 位，可见前序行动 {compare.visible_action_ids.length} 条，
        A 箱公共后验 {percent(compare.public_a_before_pct)} → {percent(compare.public_a_after_pct)}。</p>}
      {stage !== "compare" && <button onClick={() => cite(selected.seq, selected.actors?.[0])}>引用这次行动</button>}
    </>}
    {verification && <>
      <p>共同核验在事件 {verification.seq} 发布一次。公共后验 {percent(Number(verification.public_a_before_pct))} →
        {" "}{percent(Number(verification.public_a_after_pct))}。</p>
      {stage !== "compare" && <button className="text-button" onClick={() => seek(verification.tick)}>查看核验事件</button>}
    </>}
    {stage !== "compare" && <CascadeTrace view={view} seek={seek} initialOpen={explore}/>}
    {view.closed && current?.event_type === "reveal" &&
      <p role="status">真实箱子为 {String(current.state)}。猜对 {String(current.correct_count)} 人。</p>}
  </section>;
}

function CascadeTrace({ view, seek, initialOpen = false }: Pick<DomainPanelProps, "seek"> & { view: FlagshipView; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [metric, setMetric] = useState("public_a_pct");
  const trace = useTrace(view, metric, "system", "", open);
  const course = { metrics: [
    { id: "public_a_pct", label: "A 箱公共后验", unit: "%" },
    { id: "public_choice_a_pct", label: "公开选择 A 的比例", unit: "%" },
  ] };
  const frames = view.series.slice(0, view.tick + 1).map((frame, index) => ({
    metrics: { ...frame.metrics, public_choice_a_pct: view.public_choice_a_pct?.[index] ?? null } as Record<string, number | null>,
  }));
  const values = frames[view.tick]?.metrics;
  return <details id="emergence-explore" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>涌现显微镜 · 从后验反查行动</summary>
    {open && <>
      <Facts rows={course.metrics.map(item => [item.label, values?.[item.id] == null ? "未公开或尚无行动" : percent(values[item.id]!)])}/>
      <p>公开选择比例数已发生的行动。公共后验按这些行动所提供的信息更新。</p>
      <MetricChart course={course} frames={frames} tick={view.tick} metricChanged={setMetric}
        change={(tick, id) => { setMetric(id); seek(tick); }}/>
      <TraceLenses trace={trace?.trace} perspective="system" seek={seek}/>
      {trace?.trace && <TraceClaims trace={trace.trace} seek={seek}/>}
      {trace?.error && <p role="alert">当前行动证据无法核对。</p>}
    </>}
  </details>;
}

function contributionAt(view: FlagshipView) {
  return visible(view).filter(event => event.event_type === "contributions").at(-1) as Contributions | undefined;
}

function settlementAt(view: FlagshipView, round: number) {
  return visible(view).find(event => event.event_type === "settlement" && event.round === round) as Settlement | undefined;
}

export function PublicGoodsPanel(props: DomainPanelProps) {
  const { stage, view, comparison, pinned, pin, seek, cite } = props;
  if (!view) return null;
  const round = contributionAt(view);
  if (!round) return <section className="cooperation-world" aria-label="公共池与小组账本">
    <h2>四笔贡献进入同一公共池</h2><p>同一轮的四份贡献会同时公布。目前尚未开放贡献记录。</p>
  </section>;
  const settlement = settlementAt(view, round.round);
  const other = comparison && contributionAt(comparison);
  const paired = other && comparison && settlementAt(comparison, other.round);
  const contribution = sum(round.contributions);
  const actor = actors.includes(pinned) ? pinned : "P1";
  const previous = visible(view).find(event => event.event_type === "contributions" &&
    event.round === round.round - 1) as Contributions | undefined;
  const previousSettlement = settlementAt(view, round.round - 1);
  return <section className="cooperation-world" aria-label="公共池与小组账本">
    <h2>第 {round.round} 轮公共池</h2>
    <p>四笔贡献合计 <strong>{contribution}</strong> 代币，每人公共回报 <strong>{text(round.public_return)}</strong> 代币。</p>
    <p>人均贡献 {text(contribution / Object.keys(round.contributions).length)} 代币，以本轮公开贡献的参与者人数为分母。</p>
    <ol className="cooperation-bars" aria-label="贡献资金流">
      {actors.map(id => <li key={id}>
        <button type="button" aria-pressed={actor === id} onClick={() => pin(id)}>{id}</button>
        <meter min="0" max="20" value={round.contributions[id]} aria-label={`${id} 投入公共池`}/>
        <span>{round.contributions[id]} / 20</span>
      </li>)}
    </ol>
    <h3>{actor} 的本轮账本</h3>
    {!settlement && <p>贡献已公开，施罚、受罚和净收益要等本轮结算。</p>}
    {settlement && <>
      <Facts rows={[
        ["惩罚前收益", text(settlement.gross[actor])],
        ["施罚成本", text(settlement.outgoing[actor])],
        ["受罚扣损", text(settlement.fines[actor])],
        ["本轮净收益", text(settlement.net[actor])],
      ]}/>
      <p>{settlement.sanctions.length ? settlement.sanctions.map(edge =>
        `${edge.from} 对 ${edge.to} 施罚 ${edge.points} 点（付 ${edge.cost}，对方扣 ${text(edge.fine)}）`).join("；") + "。" :
        "本轮结算没有定向惩罚。"}
      </p>
      <p>小组结算（代币）{text(sum(settlement.gross))} 毛收益 − {text(sum(settlement.outgoing))} 施罚成本 −
        {" "}{text(sum(settlement.fines))} 受罚扣损 = <strong>{text(sum(settlement.net))}</strong> 净收益。</p>
      {stage !== "compare" && <button onClick={() => cite(settlement.seq, actor)}>引用本轮结算</button>}
      {stage !== "compare" && view.origin === "offline_simulation" && <details>
        <summary>看投入怎样反馈到下一轮</summary>
        <p><strong>模型规则</strong> · P1、P2 的自动目标会用上一轮其他人的平均贡献调整。
          上轮被罚会抬高该主体下一轮的自动目标。每轮仍有模型扰动，学生计划可覆盖 P1 的自动值。</p>
        {previous && previousSettlement ? <>
          <p>{actor} 上轮贡献 {previous.contributions[actor]}、扣损 {text(previousSettlement.fines[actor])}，
            本轮贡献 {round.contributions[actor]} 代币。</p>
          {["P1", "P2"].includes(actor) && <p>用上轮贡献记录复算，其他人的平均贡献为 {
            text((sum(previous.contributions) - previous.contributions[actor]) /
              (Object.keys(previous.contributions).length - 1))} 代币。</p>}
          <button type="button" className="text-button" onClick={() => seek(previous.tick)}>查上轮公开贡献 · 事件 {previous.seq}</button>
          <button onClick={() => seek(previousSettlement.tick)}>查上轮结算 · 事件 {previousSettlement.seq}</button>
        </> : <p>第一轮还没有上一次结算。推进至下一轮后可检查实际反馈。</p>}
      </details>}
    </>}
    {stage !== "compare" && <div className="toolbar">
      {settlement && <button className="text-button" onClick={() => seek(round.tick)}>回看贡献公开</button>}
      <button className="text-button" onClick={() => cite(round.seq, actor)}>引用本轮贡献</button>
    </div>}
    {other && paired && <p>对照第 {other.round} 轮，公共池 {sum(other.contributions)} 代币，{actor} 贡献 {other.contributions[actor]}，
      净收益 {text(paired.net[actor])}；小组净收益 {text(sum(paired.net))}。</p>}
    {stage !== "compare" && settlement && <details><summary>从群体净收益反查结算</summary>
      <ul>{(visible(view).filter(event => event.event_type === "settlement") as Settlement[]).map(event =>
        <li key={event.seq}><button type="button" className="text-button" onClick={() => seek(event.tick)}>
          第 {event.round} 轮 · 全组净收益 {text(sum(event.net))} 代币
        </button></li>)}</ul>
    </details>}
    {stage !== "compare" && <LedgerEvidence view={view} metric="net_income" actor={actor} seek={tick => seek(tick)}
      initialOpen={props.explore}/>}
    {stage === "explain" && <FeedbackExplanation {...props} view={view} eventType="settlement"
      prompt="引用一位参与者的结算。描述贡献如何进入公共池、惩罚如何影响个人与全组净收益，并指出哪条反馈规则会进入下一轮。写出一个仍待检验的政策解释。"/>}
  </section>;
}

function withdrawalAt(view: FlagshipView) {
  return visible(view).filter(event => event.event_type === "withdrawal").at(-1) as Withdrawal | undefined;
}

export function CommonsPanel({ stage, view, comparison, pinned, pin, seek, cite }: DomainPanelProps) {
  if (!view) return null;
  const withdrawal = withdrawalAt(view);
  if (!withdrawal) return <section className="cooperation-world" aria-label="资源与管护账本">
    <h2>水域期初存量 {text(view.frame.metrics.stock)} 单位</h2><p>本期取用和自然再生均待结算。</p>
  </section>;
  const regrowth = visible(view).find(event => event.event_type === "growth" && event.period === withdrawal.period) as Growth | undefined;
  const harvested = withdrawal.start_stock - withdrawal.remaining_stock;
  const actor = Object.hasOwn(withdrawal.plans, pinned) ? pinned : "F01";
  const budgetDelta = withdrawal.monitor_budget_after - withdrawal.monitor_budget_before;
  const max = Math.max(1, withdrawal.start_stock, regrowth?.next_stock ?? 0);
  const other = comparison && withdrawalAt(comparison);
  const bars: [string, number][] = [["本期期初", withdrawal.start_stock], ["取用后余量", withdrawal.remaining_stock]];
  if (regrowth) bars.push(["下期期初", regrowth.next_stock]);
  return <section className="cooperation-world" aria-label="资源与管护账本">
    <h2>第 {withdrawal.period} 期资源流</h2>
    <ol className="cooperation-bars cooperation-stock" aria-label="水域存量变化">
      {bars.map(([label, value]) => <li key={label}>
        <span>{label}</span><meter min="0" max={max} value={value} aria-label={label}/>
        <span>{text(value)}</span>
      </li>)}
    </ol>
    <p>实际取用 {text(harvested)} 单位。{regrowth ?
      `取用后余量 ${text(withdrawal.remaining_stock)} + 再生 ${text(regrowth.growth)} = 下期期初 ${text(regrowth.next_stock)} 单位。` :
      "本期再生仍待结算。"} </p>
    <label className="cooperation-person">查看使用者 <select value={actor} aria-label="查看使用者" onChange={event => pin(event.target.value)}>
      {Object.keys(withdrawal.plans).map(id => <option key={id}>{id}</option>)}
    </select></label>
    <Facts rows={[
      ["计划取用", `${text(withdrawal.plans[actor])} 单位`],
      ["获准申请", `${text(withdrawal.requests[actor])} 单位`],
      ["实际取用", `${text(withdrawal.allocations[actor])} 单位`],
      ["本期扣缴", `${text(withdrawal.fines[actor])} 代币`],
    ]}/>
    <h3>管护账户</h3>
    <p>检查 {withdrawal.monitored.length} 人，花费 {text(withdrawal.monitoring_cost)} 代币，扣缴入账 {text(sum(withdrawal.fines))} 代币。</p>
    <p>使用者净收入 {text(withdrawal.participant_net)} 加管护账户变动 {text(budgetDelta)} =
      {" "}<strong>{text(withdrawal.gross_value - withdrawal.monitoring_cost)} 代币</strong>群体净收益。</p>
    {other && <p>对照第 {other.period} 期，{actor} 计划 / 获准 / 实取分别为 {text(other.plans[actor])} /
      {" "}{text(other.requests[actor])} / {text(other.allocations[actor])} 单位，监测花费 {text(other.monitoring_cost)} 代币。</p>}
    {stage !== "compare" && <div className="toolbar">
      <button className="text-button" onClick={() => seek(withdrawal.tick)}>回看取用</button>
      <button onClick={() => cite(withdrawal.seq)}>引用取用账本</button>
      {regrowth && <button onClick={() => cite(regrowth.seq, "水域")}>引用再生记录</button>}
    </div>}
  </section>;
}
