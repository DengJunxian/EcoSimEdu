import { useId, useState } from "react";
import { eventHref } from "../../contracts";
import type { DomainPanelProps, FlagshipView } from "../../learning/flagship-types";
import type { Event } from "../../lesson-types";
import "./svb.css";

type FlowKind = "messages" | "requests" | "payments";
type Metric = "cash" | "queued" | "equity";
type Point = Record<Metric, number> & { tick: number; round: number };
type Request = {
  request_id: string; person: string; requested: number; paid: number; remaining: number;
  payroll: number; protective: number; risk_score: number; observation_seqs: number[];
};
type Delivery = { from: string; to: string; origin_seq: number };
type BankEvent = Event & {
  round: number; requests?: Request[]; pending?: Request[];
  payments?: (Request & { amount: number })[]; messages?: Delivery[];
  draw?: number; units?: number; realized_loss?: number; mark_loss?: number; old_price?: number; new_price?: number;
};
type BankDetails = { checkpoint: number | null; network: Record<string, string[]>; series: Point[] };
type Briefing = {
  actor_id: string; group: string; deposit: number; payroll: number; protected: number; neighbors: string[];
  steps: number; old_price: number; new_price: number;
};

const flowLabels: Record<FlowKind, string> = { messages: "消息", requests: "申请", payments: "实付" };
const metricLabels: Record<Metric, string> = { cash: "银行现金", queued: "待付金额", equity: "银行净资产" };
const isFlow = (kind: string): kind is FlowKind => Object.hasOwn(flowLabels, kind);
const metric = (view: FlagshipView, id: string) => view.frame.metrics[id] ?? "—";
const ledgerFields = ["现金", "证券市值", "贷款", "存款负债", "支持借款负债"] as const;

const visibleEvents = (view: FlagshipView) => (view.events as BankEvent[]).filter(event => event.tick <= view.tick);
const roundAt = (point: Pick<Point, "round">) => point.round === 0 ? "开局" : `第 ${point.round} 轮`;
const visibleDetails = (view: FlagshipView) => view.details as BankDetails | undefined;

export function SvbPanel(props: DomainPanelProps) {
  const { stage, briefing, action, view, comparison } = props;
  const role = briefing as Briefing | null | undefined;
  if (stage === "intro" && role?.actor_id) {
    return <section className="svb-model-summary" aria-label="教学模型设置">
      <h2>教学银行怎样运行</h2>
      <dl className="svb-metrics">
        <div><dt>教学时长</dt><dd>{role.steps} 轮</dd></div>
        <div><dt>证券标价冲击</dt><dd>{role.old_price} → {role.new_price}</dd></div>
      </dl>
      <p>在银行完成支付前，工资款仍留在待付队列和存款负债中。</p>
    </section>;
  }
  if ((stage === "predict" || stage === "bid") && role?.actor_id) {
    return <section className="svb-role" aria-label="D01 开局简报">
      <h2>财务负责人 {role.actor_id}</h2>
      <p>{role.group}。金额用模拟资金单位。</p>
      <dl className="svb-metrics">
        <div><dt>存款余额</dt><dd>{role.deposit}</dd></div>
        <div><dt>本次工资款</dt><dd>{role.payroll}</dd></div>
        <div><dt>模型保障额度</dt><dd>{role.protected} <small>／{role.deposit}</small></dd></div>
      </dl>
      <p>消息来源 {role.neighbors.join("、") || "无"}。开局还没有邻居的提款消息。</p>
      {stage === "bid" && <p role="status">当前方案在第 {action === "withdraw_later" ? 2 : 1} 轮提交 {role.payroll} 单位工资款申请。</p>}
    </section>;
  }
  if (!view) return null;
  if (stage === "compare" && comparison) return <Comparison {...props} view={view} comparison={comparison}/>;
  if (stage === "observe" || stage === "explain") {
    return <div className="svb-domain">
      {stage === "explain" && <Ledger {...props} view={view}/>}
      <BankWorld {...props} view={view}/>
    </div>;
  }
  return null;
}

function BalanceChart({ view, seek }: Pick<DomainPanelProps, "seek"> & { view: FlagshipView }) {
  const [metricId, setMetricId] = useState<Metric>("cash");
  const points = visibleDetails(view)?.series ?? [];
  if (!points.length) return null;
  const min = Math.min(0, ...points.map(point => point[metricId]));
  const max = Math.max(0, ...points.map(point => point[metricId]));
  const px = (index: number) => points.length === 1 ? 36 : 36 + 522 * index / (points.length - 1);
  const py = (value: number) => 110 - 86 * (max === min ? .5 : (value - min) / (max - min));
  const cashDrops = points.filter((point, i) => i > 0 && point.cash < points[i - 1].cash);
  const pay = cashDrops.at(-1);
  return <section className="svb-chart" aria-label="已揭示银行指标">
    <label>银行指标 <select aria-label="银行指标" value={metricId} onChange={event => setMetricId(event.target.value as Metric)}>
      {Object.entries(metricLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    <svg viewBox="0 0 594 150" role="img" aria-label={`${metricLabels[metricId]}，共 ${points.length} 个已揭示事件点`}>
      <line x1="36" y1={py(0)} x2="558" y2={py(0)} stroke="#becac1"/>
      <text x="3" y="20">{max}</text>{min < 0 && <text x="3" y="117">{min}</text>}
      <polyline points={points.map((point, index) => `${px(index)},${py(point[metricId])}`).join(" ")}/>
      {metricId === "cash" && cashDrops.map(point =>
        <circle key={point.tick} className="svb-drop" r="4" cx={px(points.indexOf(point))} cy={py(point.cash)}
          onClick={() => seek(point.tick)} aria-hidden="true"/>)}
      <circle r="5" cx={px(points.length - 1)} cy={py(points[points.length - 1][metricId])}/>
      <text x="36" y="141">开局</text>
      {view.tick > 0 && <text x="558" y="141" textAnchor="end">事件 {view.tick}</text>}
    </svg>
    {metricId === "cash" && pay && <button className="text-button" onClick={() => seek(pay.tick)}>
      定位最近现金下跌 · 事件 {pay.tick}
    </button>}
    <details><summary>展开已揭示指标与事件</summary>
      <ul className="svb-series-list">
        {points.slice().reverse().map(point => <li key={point.tick}>
          <button className="text-button" onClick={() => seek(point.tick)}>
            {roundAt(point)} · 事件 {point.tick} · {metricLabels[metricId]} {point[metricId]}
          </button>
        </li>)}
      </ul>
    </details>
  </section>;
}

type Edge = { id: string; from: string; to: string; text: string; origin?: number };
function evidenceEdges(event: BankEvent | undefined): Edge[] {
  if (event?.event_type === "messages") return event.messages?.map(row =>
    ({ id: row.from + row.to, from: row.from, to: row.to, text: "观察申请", origin: row.origin_seq })) ?? [];
  if (event?.event_type === "requests") return event.requests?.map(row =>
    ({ id: row.request_id, from: row.person, to: "BANK", text: `${row.request_id} 申请 ${row.requested}` })) ?? [];
  if (event?.event_type === "payments") return event.payments?.map(row =>
    ({ id: row.request_id, from: "BANK", to: row.person, text: `${row.request_id} 到账 ${row.amount}` })) ?? [];
  return [];
}

const placements = [[106, 63], [514, 63], [106, 227], [514, 227]] as const;
function BankGraph({ event, edges, total, pinned, pin, cash, queued }: {
  event?: BankEvent; edges: Edge[]; total: number; pinned: string; pin: DomainPanelProps["pin"]; cash: number | string; queued: number | string;
}) {
  const marker = useId();
  const actors = [...new Set([pinned, ...edges.flatMap(edge => [edge.from, edge.to])])]
    .filter(id => id && id !== "BANK").slice(0, placements.length);
  const positions = new Map<string, readonly [number, number]>([["BANK", [310, 145]],
    ...actors.map((actor, i) => [actor, placements[i]] as const)]);
  const kind = event && isFlow(event.event_type) ? event.event_type : undefined;
  const shown = edges.filter(edge => positions.has(edge.from) && positions.has(edge.to));
  return <figure className={`svb-graph ${kind ?? ""}`}>
    <svg viewBox="0 0 620 290" role="img" aria-label={`教学银行和当前储户关系，事件明细见下方列表`}>
      <defs><marker id={marker} markerWidth="9" markerHeight="9" refX="7" refY="4"
        orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L8 4L0 8Z"/></marker></defs>
      {shown.map(edge => {
        const [x1, y1] = positions.get(edge.from)!;
        const [x2, y2] = positions.get(edge.to)!;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const from = edge.from === "BANK" ? .43 : .13;
        const to = edge.to === "BANK" ? .57 : .86;
        return <path className="svb-edge" key={edge.id}
          d={kind === "messages" ?
            `M ${x1} ${y1} Q 310 ${y1 === y2 ? y1 - 38 : y2} ${x1 + dx * to} ${y1 + dy * to}` :
            `M ${x1 + dx * from} ${y1 + dy * from} L ${x1 + dx * to} ${y1 + dy * to}`}
          markerEnd={`url(#${marker})`}/>;
      })}
      <rect className="svb-bank-node" x="215" y="96" width="190" height="98" rx="13"/>
      <text className="svb-bank-text" x="310" y="124" textAnchor="middle">教学银行</text>
      <text className="svb-bank-values" x="310" y="152" textAnchor="middle">现金 {cash}</text>
      <text className="svb-bank-values" x="310" y="176" textAnchor="middle">待付 {queued}</text>
      {actors.map(actor => {
        const [x, y] = positions.get(actor)!;
        return <g className={`svb-depositor-node ${actor === pinned ? "active" : ""}`} key={actor} onClick={() => pin(actor)}>
          <rect x={x - 44} y={y - 19} width="88" height="38" rx="10"/>
          <text x={x} y={y + 6} textAnchor="middle">{actor}</text>
        </g>;
      })}
    </svg>
    <figcaption>{kind && event ? `${roundAt(event)} · 事件 ${event.seq} · ${flowLabels[kind]}（图中 ${shown.length}／${total} 条）` : "选择一个已发生的消息、申请或实付事件查看关系。"}</figcaption>
  </figure>;
}

function BankWorld({ view, pinned, pin, seek, cite }: Pick<DomainPanelProps, "pinned" | "pin" | "seek" | "cite"> & { view: FlagshipView }) {
  const [layer, setLayer] = useState<FlowKind | "current">("current");
  const [requestId, setRequestId] = useState("");
  const events = visibleEvents(view);
  const present = events.at(-1);
  const requestedFlow = layer === "current" ? present : events.filter(event => event.event_type === layer).at(-1);
  const flow = requestedFlow?.event_type && isFlow(requestedFlow.event_type) ? requestedFlow : undefined;
  const edges = evidenceEdges(flow);
  const focused = edges.filter(edge => [edge.from, edge.to].includes(pinned));
  const actor = view.frame.entities[pinned];
  const network = visibleDetails(view)?.network ?? {};
  const roleOptions = Object.keys(network).sort();
  const actorRequests = events.flatMap(event => (event.requests ?? []).filter(row => row.person === pinned)
    .map(row => ({ event, row })));
  const traced = actorRequests.find(item => item.row.request_id === requestId) ?? actorRequests[0];
  const payments = traced ? events.flatMap(event => (event.payments ?? []).filter(row => row.request_id === traced.row.request_id)
    .map(row => ({ event, row }))) : [];
  const amountPaid = payments.reduce((sum, item) => sum + item.row.amount, 0);
  const priorRisk = view.previous?.entities[pinned]?.["风险评分"];
  const incoming = events.flatMap(event => (event.messages ?? []).filter(row => row.to === pinned)
    .map(row => ({ event, row })));

  return <section className="svb-world" aria-label="银行与储户">
    <header className="svb-world-title"><h2>银行与储户</h2><span>模拟资金单位</span></header>
    <dl className="svb-metrics svb-world-metrics">
      <div><dt>银行现金</dt><dd>{metric(view, "cash")}</dd></div>
      <div><dt>待付</dt><dd>{metric(view, "queued")}</dd></div>
      <div><dt>净资产</dt><dd>{metric(view, "equity")}</dd></div>
    </dl>
    <div className="svb-world-body">
      <div>
        <div className="toolbar svb-layers" role="group" aria-label="消息与资金关系">
          {[["current", "当前事件"], ...Object.entries(flowLabels)].map(([id, label]) =>
            <button key={id} aria-pressed={layer === id} onClick={() => setLayer(id as typeof layer)}>{label}</button>)}
        </div>
        <BankGraph event={flow} edges={focused.length ? focused : edges} total={edges.length}
          pinned={pinned} pin={pin} cash={metric(view, "cash")} queued={metric(view, "queued")}/>
        {flow && <details>
          <summary>展开 {flowLabels[flow.event_type as FlowKind]}关系</summary>
          <ul className="svb-edge-list">
            {edges.map(edge => <li key={edge.id}>
              <span>{edge.from === "BANK" ? "银行" : edge.from} → {edge.to === "BANK" ? "银行" : edge.to} · {edge.text}</span>
              {edge.to !== "BANK" && <button className="text-button" onClick={() => pin(edge.to)}>追踪 {edge.to}</button>}
              {edge.from !== "BANK" && edge.to === "BANK" && <button className="text-button" onClick={() => pin(edge.from)}>追踪 {edge.from}</button>}
              {edge.origin !== undefined && <button className="text-button" onClick={() => seek(edge.origin!)}>来源事件 {edge.origin}</button>}
            </li>)}
          </ul>
        </details>}
        <div className="svb-event">
          <h3>当前事件</h3>
          <p>{present?.summary}</p>
          {(present?.event_type === "requests" || present?.event_type === "payments") && view.previous &&
            <p>银行现金 {view.previous.metrics.cash} → {metric(view, "cash")}，存款负债 {view.previous.entities.BANK["存款负债"]} → {view.frame.entities.BANK["存款负债"]}。</p>}
          {present && isFlow(present.event_type) &&
            <button className="text-button" onClick={() => cite(present.seq)}>引用当前{flowLabels[present.event_type]}</button>}
        </div>
      </div>
      <aside className="svb-inspector">
        <label>固定储户 <select aria-label="固定储户" value={pinned} onChange={event => { pin(event.target.value); setRequestId(""); }}>
          {roleOptions.map(id => <option key={id}>{id}</option>)}
        </select></label>
        {actor ? <>
          <h3>{pinned} · {actor["类型"]}</h3>
          <dl className="svb-inspector-values">
            {["存款余额", "工资款", "已保障额度", "外部现金", "等待支付", "风险评分", "行动阈值"].map(key =>
              <div key={key}><dt>{key}</dt><dd>{actor[key] ?? "—"}</dd></div>)}
          </dl>
          {present?.event_type === "messages" && priorRisk != null && priorRisk !== actor["风险评分"] &&
            <p>相邻事件之间，{pinned} 的风险分 {priorRisk} → {actor["风险评分"]}。</p>}
          <details open={incoming.length > 0}>
            <summary>收到的邻居消息（{incoming.length}）</summary>
            {!incoming.length && <p>此时还没有收到消息。观察对象为 {network[pinned]?.join("、") || "无"}。</p>}
            <ul className="svb-edge-list">{incoming.map(({ event, row }) => <li key={row.from}>
              <button className="text-button" onClick={() => seek(event.tick)}>{row.from} · {roundAt(event)}送达</button>
              <button className="text-button" onClick={() => seek(row.origin_seq)}>打开来源事件 {row.origin_seq}</button>
              <button className="text-button" onClick={() => cite(event.seq, pinned)}>引用这条消息记录</button>
            </li>)}</ul>
          </details>
          <details open={!!traced}>
            <summary>申请与支付链（{actorRequests.length} 笔申请）</summary>
            {!traced && <p>当前没有这位储户的申请记录。</p>}
            {traced && <>
              <label>申请编号 <select aria-label="申请编号" value={traced.row.request_id} onChange={event => setRequestId(event.target.value)}>
                {actorRequests.map(({ row }) => <option key={row.request_id}>{row.request_id}</option>)}
              </select></label>
              <p>申请 {traced.row.requested}，工资款 {traced.row.payroll}，防御性提款 {traced.row.protective}，当时风险评分 {traced.row.risk_score}。</p>
              {!!traced.row.observation_seqs.length && <p>随申请记录的消息来源 {traced.row.observation_seqs.join("、")}。</p>}
              <p>累计实付 {amountPaid}，待付 {traced.row.requested - amountPaid}。</p>
              <button className="text-button" onClick={() => seek(traced.event.tick)}>原申请 · 事件 {traced.event.seq}</button>
              {payments.map(({ event, row }) => <button key={event.seq} className="text-button" onClick={() => seek(event.tick)}>
                到账 {row.amount} · 事件 {event.seq}
              </button>)}
              <button className="text-button" onClick={() => cite(traced.event.seq, pinned)}>引用此申请</button>
            </>}
          </details>
        </> : <p>在当前帧中找不到这位储户。</p>}
      </aside>
    </div>
    <BalanceChart view={view} seek={seek}/>
  </section>;
}

function Ledger({ view, pinned, pin, seek, cite, record, records }:
  Pick<DomainPanelProps, "pinned" | "pin" | "seek" | "cite" | "record" | "records"> & { view: FlagshipView }) {
  const [attempt, setAttempt] = useState<{ tick: number; feedback: string }>();
  const [classification, setClassification] = useState("");
  const events = visibleEvents(view);
  const event = events.at(-1);
  const bank = view.frame.entities.BANK;
  const recordKey = `权益计算 · ${view.run_id} · 事件 ${view.tick}`;
  const equation = `${bank["现金"]} + ${bank["证券市值"]} + ${bank["贷款"]} − ${bank["存款负债"]} − ${bank["支持借款负债"]} = ${bank["净资产"]}`;
  const previousAttempt = attempt?.tick === view.tick ? attempt.feedback : records?.[recordKey];
  const target = visibleDetails(view)?.checkpoint;
  const rows = event?.pending ?? [];
  const row = rows.find(item => item.person === pinned);
  const lastSupport = events.filter(item => item.event_type === "support").at(-1);
  const lastSale = events.filter(item => item.event_type === "sale").at(-1);
  const revaluation = events.find(item => item.event_type === "revaluation");
  return <section className="svb-ledger" aria-label="流动性与权益对账">
    <header className="svb-world-title"><h2>银行账表</h2>
      <button onClick={() => seek("checkpoint")}>定位正权益待付</button></header>
    {event?.event_type === "queue" && Number(bank["净资产"]) > 0 && <p role="status">
      {roundAt(event)}结算后，现金 {bank["现金"]}，待付 {metric(view, "queued")}，权益 {bank["净资产"]}。
    </p>}
    {view.closed && target == null && <p role="status">本次未出现正权益与轮末待付同时成立。仍可根据最终账表核对实际结果。</p>}
    <dl className="svb-ledger-values">
      {ledgerFields.map((key, index) => <div key={key}>
        <dt>{index === 0 ? "资产 · " : index === 3 ? "负债 · " : ""}{key}</dt>
        <dd>{bank[key]}</dd></div>)}
    </dl>
    <div className="toolbar svb-ledger-actions">
      {revaluation && <button className="text-button" onClick={() => seek(revaluation.tick)}>核看共同重估</button>}
      {lastSupport && <button className="text-button" onClick={() => seek(lastSupport.tick)}>核看支持借款</button>}
      {lastSale && <button className="text-button" onClick={() => seek(lastSale.tick)}>核看急售折价</button>}
      {event?.event_type === "queue" && <button className="text-button" onClick={() => cite(event.seq)}>引用轮末待付</button>}
    </div>
    {event?.event_type === "support" &&
      <p>本次借入 {event.draw}，现金和支持借款负债同时增加。权益 {view.previous?.metrics.equity} → {metric(view, "equity")}。</p>}
    {event?.event_type === "sale" &&
      <p>出售 {event.units} 单位证券，相对当前标价形成折价损失 {event.realized_loss}。权益 {view.previous?.metrics.equity} → {metric(view, "equity")}。</p>}
    {event?.event_type === "revaluation" &&
      <p>持仓按 {event.old_price} → {event.new_price} 重估，权益减少 {event.mark_loss}，银行现金没有发生变化。</p>}
    <fieldset className="svb-classification"><legend>支持借款余额记在哪一边？</legend><div className="options">
      <label><input type="radio" name="svb-classification" checked={classification === "asset"} onChange={() => setClassification("asset")}/>资产</label>
      <label><input type="radio" name="svb-classification" checked={classification === "liability"} onChange={() => setClassification("liability")}/>负债</label>
    </div>{classification && <p role="status">{classification === "liability" ?
      "借款余额在负债一侧，借入的现金在资产一侧。" : "借入的现金可用来付款，尚欠支持机构的借款余额记在负债一侧。"}</p>}</fieldset>
    <form className="svb-ledger-form" onSubmit={form => {
      form.preventDefault();
      const answer = new FormData(form.currentTarget).get("equity");
      if (typeof answer !== "string" || !answer.trim()) return;
      const correct = Number(answer) === bank["净资产"];
      const feedback = `作答 ${answer}。${correct ? "核对正确。" : "重查借款和存款负债，再相减。"} ${equation}。`;
      setAttempt({ tick: view.tick, feedback });
      record?.(recordKey, feedback);
    }}>
      <label>你算出的权益 <input key={view.tick} type="number" name="equity" required/></label>
      <button>核对权益</button>
    </form>
    {previousAttempt && <p role="status">{previousAttempt}</p>}
    {!!rows.length && <details open>
      <summary>轮末待付清单（合计 {rows.reduce((sum, item) => sum + item.remaining, 0)}）</summary>
      <ul className="svb-pending">{rows.map(item => <li key={item.request_id}>
        <button aria-pressed={pinned === item.person} onClick={() => pin(item.person)}>
          {item.person} · {item.request_id} · 待付 {item.remaining}
        </button>
      </li>)}</ul>
      {row && <p>{row.person}：申请 {row.requested} − 已付 {row.paid} = 待付 {row.remaining}。</p>}
    </details>}
  </section>;
}

function Comparison({ view, comparison, pinned, pin, cite }: Pick<DomainPanelProps, "pinned" | "pin" | "cite"> &
  { view: FlagshipView; comparison: FlagshipView }) {
  const base = view.frame.entities[pinned];
  const compare = comparison.frame.entities[pinned];
  const points = (item: FlagshipView) => new Map((visibleDetails(item)?.series ?? []).map(point => [point.round, point]));
  const rightByRound = points(comparison);
  const firstDifference = [...points(view).values()].find(left => {
    const right = rightByRound.get(left.round);
    if (!right) return false;
    return left.cash !== right.cash || left.queued !== right.queued || left.equity !== right.equity;
  });
  const network = visibleDetails(view)?.network ?? {};
  return <section className="svb-ledger" aria-label="同一储户对照">
    <h2>沿同一位储户比较</h2>
    <label>固定储户 <select aria-label="固定储户" value={pinned} onChange={event => pin(event.target.value)}>
      {Object.keys(network).sort().map(id => <option key={id}>{id}</option>)}
    </select></label>
    <div className="svb-compare-arms">
      {([[view, base, "基准"], [comparison, compare, "对照"]] as const).map(([arm, values, name]) =>
        <div key={name}>
          <h3>{name} · {pinned}</h3>
          <p>到账 {values?.["外部现金"] ?? "—"}，待付 {values?.["等待支付"] ?? "—"}，已观察 {values?.["已观察储户数"] ?? "—"} 名储户。</p>
          <p>观察对象 {visibleDetails(arm)?.network[pinned]?.join("、") || "无"}。</p>
          <button className="text-button" onClick={() => cite(arm.tick, undefined, name === "基准" ? "baseline" : "comparison")}>
            引用{name}事件 {arm.tick}
          </button>
        </div>)}
    </div>
    {firstDifference && <p>同步观察点中，最早的银行指标差异出现在{roundAt(firstDifference)}。
      <a href={eventHref(view.case_id, view.run_id, firstDifference.tick)}>基准事件 {firstDifference.tick}</a>、
      <a href={eventHref(comparison.case_id, comparison.run_id, rightByRound.get(firstDifference.round)!.tick)}>
        对照事件 {rightByRound.get(firstDifference.round)!.tick}</a>。</p>}
    {view.closed && comparison.closed && base && compare &&
      base["外部现金"] === compare["外部现金"] && base["等待支付"] === compare["等待支付"] &&
      <p>{pinned} 的期末实付和待付相同。切换到较早的同步点，检查消息到达时间和中途支付。</p>}
  </section>;
}
