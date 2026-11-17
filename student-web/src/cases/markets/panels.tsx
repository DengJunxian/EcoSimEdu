import { useId, useState } from "react";
import type { DomainPanelProps, FlagshipView } from "../../learning/flagship-types";
import "./markets.css";

type MarketEvent = FlagshipView["events"][number];
type Fact = string | number | boolean | null | undefined;

const format = (value: Fact) => typeof value === "number" ? value.toLocaleString("zh-CN") : String(value ?? "—");
const units = (value: Fact, unit: string) => value == null ? "—" : `${format(value)} ${unit}`;
const cents = (value: unknown) => typeof value === "number" ? (value / 100).toFixed(2) : "—";
const visibleEvents = (view: FlagshipView) => view.events.slice(0, view.tick + 1);
const valueAt = (view: FlagshipView, metric: string) => view.frame.metrics[metric];
const actions = {
  carbon_market: "调拨发生在发行阶段。你的选择改变 F01 和 F08 初始持有的分布，行业发行总量沿用本场上限。",
  flash_crash: "做市者在开局设置本场净增库存门槛。达到门槛后，启用库存撤单规则的情景会撤回余量。",
  gamestop: "学生首轮可下 2 股、每股 12 美元限价买单，或保留现金。是否成交由同一订单簿处理。",
};

function ActionPreview({ course, action }: DomainPanelProps) {
  return <section className="market-panel">
    <h2>本场行动</h2>
    <p>{actions[course.case_id as keyof typeof actions]}</p>
    <p>当前选择 <strong>{course.action.options.find(option => option.id === action)?.label}</strong></p>
  </section>;
}

function Facts({ values }: { values: [string, Fact][] }) {
  return <dl className="market-facts">
    {values.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{format(value)}</dd></div>)}
  </dl>;
}

function EventLinks({ events, entries, seek }: Pick<DomainPanelProps, "seek"> & {
  events: MarketEvent[]; entries: [string, string][];
}) {
  const hits = entries.flatMap(([kind, label]) => {
    const event = events.find(item => item.event_type === kind);
    return event ? [{ event, label }] : [];
  });
  return hits.length ? <div className="toolbar market-cue-row">
    {hits.map(({ event, label }) => <button key={event.seq} className="text-button"
      onClick={() => seek(event.tick)}>{label} · 事件 {event.seq}</button>)}
  </div> : null;
}

function ArmFacts({ view, comparison, facts }: {
  view: FlagshipView; comparison: FlagshipView; facts: (arm: FlagshipView) => [string, Fact][];
}) {
  return <div className="market-arms">
    <div><h3>基准</h3><Facts values={facts(view)}/></div>
    <div><h3>当前对照</h3><Facts values={facts(comparison)}/></div>
  </div>;
}

export function CarbonPanel(props: DomainPanelProps) {
  const { view, comparison, pinned, pin, seek, cite, stage } = props;
  const [tonne, setTonne] = useState(1);
  const [permit, setPermit] = useState("");
  const permitLabelId = useId();
  const firmLabelId = useId();
  if (!view) return stage === "predict" || stage === "bid" ? <ActionPreview {...props}/> : null;

  const firms = Object.keys(view.frame.entities).filter(id => id.startsWith("F"));
  const actor = firms.includes(pinned) ? pinned : firms[0];
  const entity = view.frame.entities[actor];
  const events = visibleEvents(view);
  const current = events.at(-1);
  const related = events.filter(event => ["transfer", "surrender"].includes(event.event_type) && event.actors?.includes(actor));
  const issue = events.find(event => event.event_type === "issuance");
  const planned = entity["计划减排"];
  const count = Number(entity["基准排放"]);
  const coefficient = Number(entity["成本系数"]);
  const selectedTonne = Math.min(count, tonne);
  const firmFacts = (arm: FlagshipView): [string, Fact][] => {
    const row = arm.frame.entities[actor];
    return ["免费配额", "计划减排", "方案减排成本", "配额净支付", "方案净成本"].map(key => [key, row?.[key]]);
  };
  const permitIds = current && Array.isArray(current.permits) ? current.permits as string[] : [];
  const allocation = issue?.issue as Record<string, string[]> | undefined;
  const availablePermits = allocation?.[actor] ?? [];
  const trackedPermit = availablePermits.includes(permit) ? permit : availablePermits[0];
  const permitLifecycle = trackedPermit ? events.filter(event =>
    Array.isArray(event.permits) && event.permits.includes(trackedPermit)) : [];

  return <section className="market-panel" aria-label="减排与配额登记簿">
    <header className="market-heading"><h2>减排与配额登记簿</h2>
      <div className="market-control"><label htmlFor={firmLabelId}>查看企业</label>
        <select id={firmLabelId} value={actor} onChange={event => pin(event.target.value)}>
          {firms.map(id => <option key={id}>{id}</option>)}
        </select></div>
    </header>
    <Facts values={[
      ["发行配额", units(valueAt(view, "cap"), "张")], ["计划排放", units(valueAt(view, "planned_emissions"), "吨")],
      ["已缴回配额", units(valueAt(view, "surrendered"), "张")], ["清算价", units(valueAt(view, "price"), "代币／张")],
    ]}/>
    {comparison ? <ArmFacts view={view} comparison={comparison} facts={firmFacts}/> : <>
      <EventLinks events={events} entries={[["issuance", "看发行"], ["phase_end", "看减排计划"], ["transfer", "看首次转移"], ["surrender", "看首次缴回"]]} seek={seek}/>
      <div className="market-arms">
        <div>
          <h3>{actor} 的边际减排成本</h3>
          <ol className="cost-steps" aria-hidden="true">
            {Array.from({ length: count }, (_, index) => {
              const quantity = index + 1;
              return <li key={quantity} title={`第 ${quantity} 吨：${coefficient * (quantity - 0.5)} 代币`}
                className={typeof planned === "number" && quantity <= planned ? "cost-planned" : undefined}
                style={{ blockSize: `${(quantity - 0.5) / count * 95}%` }}/>;
            })}
          </ol>
          <label className="field-input">检查第 {selectedTonne} 吨的成本
            <input type="range" min={1} max={count} value={selectedTonne} onChange={event => setTonne(Number(event.target.value))}/>
          </label>
          <p>{coefficient} × ({selectedTonne} − 0.5) = <strong>{format(coefficient * (selectedTonne - 0.5))} 代币</strong>。
            {typeof planned === "number" ? `深色部分对应本场计划减排 ${planned} 吨。` : "计划减排会在计算事件后显示。"}</p>
        </div>
        <div><h3>{actor} 的成本与配额</h3><Facts values={firmFacts(view)}/>
          {allocation?.[actor] && <details><summary>追踪一张初始配额</summary>
            {trackedPermit ? <>
              <div className="market-control"><label htmlFor={permitLabelId}>选择配额编号</label>
                <select id={permitLabelId} value={trackedPermit} onChange={event => setPermit(event.target.value)}>
                  {availablePermits.map(id => <option key={id}>{id}</option>)}
                </select></div>
              <p>发行时登记给 {actor}。</p>
              <button className="text-button" onClick={() => cite(issue!.seq, actor)}>引用原发行</button>
              {permitLifecycle.length > 0 && <ul className="market-events">{permitLifecycle.map(event => <li key={event.seq}>
                <button className="text-button" onClick={() => seek(event.tick)}>定位事件 {event.seq}</button> {event.summary}
              </li>)}</ul>}
            </> : <p>本次未发行给该企业。</p>}
          </details>}
        </div>
      </div>
      <div className="market-entry">
        <h3>当前位置的登记记录</h3><p>{current?.summary}</p>
        {permitIds.length > 0 && <p className="market-id-list">涉及编号 {permitIds.join("、")}</p>}
        {current && ["issuance", "phase_end", "transfer", "surrender"].includes(current.event_type) &&
          <button onClick={() => cite(current.seq)}>引用这条登记</button>}
      </div>
      {related.length ? <details><summary>{actor} 的配额转移与缴回（{related.length}）</summary>
        <ul className="market-events">{related.map(event => <li key={event.seq}>
          <button className="text-button" onClick={() => seek(event.tick)}>定位事件 {event.seq}</button> {event.summary}
        </li>)}</ul>
      </details> : <p className="field-muted">{view.closed ? "本企业在本次运行中没有转移或缴回记录。" : "到当前事件本企业还没有转移或缴回记录。"}</p>}
      {view.closed && valueAt(view, "permits_moved") === 0 && <p>本次未转移配额。仍可通过登记簿核对发行量、计划排放和缴回。</p>}
    </>}
  </section>;
}

function DepthLadder({ view }: { view: FlagshipView }) {
  const book = Object.entries(view.frame.entities["订单簿"] ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number");
  const max = Math.max(1, ...book.map(([, amount]) => amount));
  return <div className="market-depth" role="group" aria-label="可见的买卖档位">
    <h3>买卖深度阶梯</h3>
    {book.length ? <table><caption>当前帧各侧最优四档</caption><thead><tr>
      <th scope="col">报价（美元）</th><th scope="col">挂单（股）</th>
    </tr></thead><tbody>{book.map(([name, amount]) => <tr key={name}
      className={name.startsWith("卖") ? "ask-depth" : "bid-depth"}>
      <th scope="row">{name.replace(/ 的挂单股数$/, "")}</th>
      <td><span className="market-depth-bar"><meter max={max} value={amount} aria-hidden="true"/><span>{amount}</span></span></td>
    </tr>)}</tbody></table> : <p>此时点订单簿还没有挂单。</p>}
  </div>;
}

function TraceOrder({ orderId, events, seek }: {
  orderId: unknown; events: MarketEvent[]; seek: DomainPanelProps["seek"];
}) {
  const submitted = events.find(event => event.event_type === "order_submitted" && event.order_id === orderId);
  if (!submitted) return null;
  return <button className="text-button" onClick={() => seek(submitted.tick)}>
    {String(orderId)} · {submitted.side === "buy" ? "买" : "卖"} {cents(submitted.price_cents)} 美元 · 事件 {submitted.seq}
  </button>;
}

function MarketAccount({ view, events, pinned, pin }: {
  view: FlagshipView; events: MarketEvent[]; pinned: string; pin: DomainPanelProps["pin"];
}) {
  const id = useId();
  const actors = [...new Set([...Object.keys(view.frame.entities).filter(actor => actor !== "订单簿"),
    ...events.flatMap(event => event.actors ?? []), ...(pinned ? [pinned] : [])])];
  const actor = pinned || actors[0];
  const account = view.frame.entities[actor];
  if (!actor) return null;
  return <div className="market-account">
    <div className="market-control"><label htmlFor={id}>跟踪账户</label>
      <select id={id} value={actor} onChange={event => pin(event.target.value)}>
        {actors.map(name => <option key={name}>{name}</option>)}
      </select>
    </div>
    {account ? <Facts values={Object.entries(account)}/> : <p className="field-muted">当前事件未记录该账户余额。选择与该账户有关的事件可查看。</p>}
  </div>;
}

export function FlashCrashPanel(props: DomainPanelProps) {
  const { view, comparison, pinned, pin, seek, cite, stage } = props;
  if (!view) return stage === "predict" || stage === "bid" ? <ActionPreview {...props}/> : null;
  const events = visibleEvents(view);
  const current = events.at(-1);
  const currentIndex = view.tick;
  const pause = events.filter(event => ["pause", "resume"].includes(event.event_type)).at(-1);
  const inventory = events.filter(event => event.event_type === "inventory_limit").at(-1);
  const recentTrade = events.filter(event => event.event_type === "trade").at(-1);
  const marketFacts = (arm: FlagshipView): [string, Fact][] => [
    ["买方挂单深度", units(valueAt(arm, "bid_depth"), "股")],
    ["累计成交", units(valueAt(arm, "volume"), "股")],
    ["程序待执行", units(valueAt(arm, "program_queued"), "股")],
    ["最近成交价", units(valueAt(arm, "last_price"), "美元／股")],
  ];
  const deltas: [string, Fact][] = [
    ["买方挂单", `${format(view.previous?.metrics.bid_depth)} → ${format(valueAt(view, "bid_depth"))} 股`],
    ["累计成交", `${format(view.previous?.metrics.volume)} → ${format(valueAt(view, "volume"))} 股`],
    ["计划等待执行", `${format(view.previous?.metrics.program_queued)} → ${format(valueAt(view, "program_queued"))} 股`],
  ];

  return <section className="market-panel" aria-label="库存冲击与深度阶梯">
    <header className="market-heading"><h2>库存冲击与深度阶梯</h2>
      <p className="field-muted">模型步 {format(current?.time as Fact)} · 事件 {currentIndex}</p>
    </header>
    {comparison ? <ArmFacts view={view} comparison={comparison} facts={marketFacts}/> : <Facts values={marketFacts(view)}/>}
    <div className="market-arms">
      <DepthLadder view={view}/>
      {comparison ? <DepthLadder view={comparison}/> : <div>
        <h3>当前事件的变化</h3><p>{current?.summary}</p><Facts values={deltas}/>
        {current?.event_type === "trade" ? <p>新成交 {cents(current.price_cents)} 美元／股，共 {format(current.quantity as Fact)} 股。</p>
          : <p>{recentTrade ? `本事件无新成交。最近成交仍是事件 ${recentTrade.seq} 的 ${cents(recentTrade.price_cents)} 美元。` : "尚无成交记录，最近成交价留空。"}</p>}
        {inventory && <p>{inventory.actors?.[0]} 最近一次触发库存阈值 · 净增 {format(inventory.excess as Fact)} 股，阈值 {format(inventory.limit as Fact)} 股。
          <button className="text-button" onClick={() => seek(inventory.tick)}>定位库存事件</button></p>}
        {pause && <p className="market-pause"><strong>{pause.event_type === "pause" ? "卖出程序暂停" : "恢复撮合"}</strong>
          {" "}{pause.summary}</p>}
        {current && ["release", "trade", "cancel", "inventory_limit", "pause", "resume", "unfilled"].includes(current.event_type) &&
          <button onClick={() => cite(current.seq)}>引用此市场事件</button>}
        {current && <div className="toolbar">
          {current.event_type === "trade" && <><TraceOrder orderId={current.buy_order_id} events={events} seek={seek}/>
            <TraceOrder orderId={current.sell_order_id} events={events} seek={seek}/></>}
          {current.event_type === "cancel" && <TraceOrder orderId={current.order_id} events={events} seek={seek}/>}
        </div>}
      </div>}
    </div>
    {comparison ? <div className="market-arms">
      {([view, comparison] as const).map((arm, index) => {
        const state = visibleEvents(arm).filter(event => ["pause", "resume"].includes(event.event_type)).at(-1);
        return <p key={arm.run_id}><strong>{index === 0 ? "基准" : "对照"}</strong> · {state?.summary ?? "当前未记录程序暂停。"}</p>;
      })}
    </div> : <>
      <EventLinks events={events} entries={[["rest", "首张挂单"], ["release", "首次释放"], ["cancel", "首次撤单"], ["pause", "暂停"], ["resume", "恢复"]]} seek={seek}/>
      <MarketAccount view={view} events={events} pinned={pinned} pin={pin}/>
      {view.closed && !inventory && <p>本次未触发库存撤回。仍可用卖出计划和实际成交解释深度变化。</p>}
    </>}
  </section>;
}

function summarizePurposes(events: MarketEvent[]) {
  const groups = new Map<string, { quantity: number, recent: MarketEvent }>();
  for (const event of events) {
    if (event.event_type !== "trade" || typeof event.quantity !== "number" || !event.purpose) continue;
    groups.set(event.purpose, { quantity: (groups.get(event.purpose)?.quantity ?? 0) + event.quantity, recent: event });
  }
  return groups;
}

export function GameStopPanel(props: DomainPanelProps) {
  const { view, comparison, pinned, pin, seek, cite, stage } = props;
  const [topic, setTopic] = useState("");
  const topicId = useId();
  if (!view) return stage === "predict" || stage === "bid" ? <ActionPreview {...props}/> : null;
  const events = visibleEvents(view);
  const current = events.at(-1);
  const messages = events.filter(event => event.event_type === "message");
  const actualTopic = messages.find(event => event.message_id === topic) ?? messages[0];
  const recipients = events.filter(event => event.event_type === "forward" && event.origin_seq === actualTopic?.seq);
  const purposes = summarizePurposes(events);
  const borrower = view.frame.entities["借券账户"];
  const loan = events.find(event => ["loan", "loan_blocked"].includes(event.event_type));
  const call = events.filter(event => event.event_type === "margin_call").at(-1);
  const returned = events.filter(event => event.event_type === "return");
  const compareFacts = (arm: FlagshipView): [string, Fact][] => [
    ["话题触达", units(valueAt(arm, "reach"), "人")], ["关注买入成交", units(valueAt(arm, "social_buys"), "股")],
    ["实际强制回补", units(valueAt(arm, "forced_cover"), "股")], ["待交还", units(valueAt(arm, "short_interest"), "股")],
  ];
  return <section className="market-panel" aria-label="消息、订单与借券账">
    <header className="market-heading"><h2>消息、订单与借券账</h2>
      <p className="field-muted">模型轮次 {format(current?.time as Fact)} · 事件 {view.tick}</p>
    </header>
    {comparison ? <ArmFacts view={view} comparison={comparison} facts={compareFacts}/> : <>
      <Facts values={compareFacts(view)}/>
      <div className="market-arms">
        <div>
          <h3>话题触达</h3>
          {actualTopic ? <>
            <div className="market-control"><label htmlFor={topicId}>查看话题</label>
              <select id={topicId} value={String(actualTopic.message_id)} onChange={event => setTopic(event.target.value)}>
                {messages.map(event => <option key={event.seq}>{String(event.message_id)}</option>)}
              </select></div>
            <div className="market-topic">
              <button className="text-button" onClick={() => seek(actualTopic.tick)}>
                {actualTopic.actors?.[0]} 发布 · 事件 {actualTopic.seq}
              </button>
              <ul aria-label="收到同一话题的账户">{recipients.map(event => <li key={event.seq}>
                <button className="text-button" onClick={() => {
                  if (event.actors?.[0]) pin(event.actors[0]);
                  seek(event.tick);
                }}>
                  {event.actors?.[0]} · 第 {format(event.time as Fact)} 轮
                </button>
              </li>)}</ul>
            </div>
          </> : <p>当前帧尚未出现话题发布。</p>}
          <h3>实际成交的订单目的</h3>
          {purposes.size ? <table><thead><tr><th scope="col">成交目的</th><th scope="col">股数</th></tr></thead>
            <tbody>{[...purposes].map(([purpose, { quantity, recent }]) => <tr key={purpose}>
              <th scope="row"><button className="text-button" onClick={() => seek(recent.tick)}>{purpose}</button></th>
              <td>{quantity}</td>
            </tr>)}</tbody></table> : <p>当前还没有实际成交。</p>}
        </div>
        <div>
          <h3>借券义务</h3>
          <Facts values={[
            ["实际借入", loan ? units(loan.quantity as Fact, "股") : "—"],
            ["累计归还", units(returned.reduce((sum, event) => sum + Number(event.quantity), 0), "股")],
            ["待交还", units(valueAt(view, "short_interest"), "股")],
            ["借券账户现金（当帧）", units(borrower?.["现金（美元）"], "美元")],
          ]}/>
          {loan && <button className="text-button" onClick={() => seek(loan.tick)}>定位借券记录 · 事件 {loan.seq}</button>}
          {call && <p>最近担保检查 · 以 {cents(call.mark_cents)} 美元估值 {format(call.debt as Fact)} 股，
            抵押现金 {cents(call.collateral_cents)} 美元。
            <button className="text-button" onClick={() => seek(call.tick)}>定位担保事件</button></p>}
          {returned.length > 0 && <button className="text-button" onClick={() => seek(returned.at(-1)!.tick)}>定位实际还券</button>}
          {view.closed && returned.length === 0 && <p>本次没有还券事件。待交还股数请以实际借券账为准。</p>}
          <h3>当前事件</h3><p>{current?.summary}</p>
          {current?.event_type === "forward" && typeof current.origin_seq === "number" &&
            <button className="text-button" onClick={() => seek(current.origin_seq as number)}>回查原话题 · 事件 {current.origin_seq}</button>}
          {current && ["message", "forward", "trade", "loan", "loan_blocked", "margin_call", "return"].includes(current.event_type) &&
            <button onClick={() => cite(current.seq)}>引用此模型事件</button>}
          <MarketAccount view={view} events={events} pinned={pinned} pin={pin}/>
        </div>
      </div>
    </>}
  </section>;
}
