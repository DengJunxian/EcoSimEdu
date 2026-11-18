import { useState } from "react";
import { FeedbackExplanation } from "../../emergence/feedback-explanation";
import { LedgerEvidence } from "../../emergence/trace-view";
import { showValue } from "../../lesson-view";
import type { DomainPanelProps, FlagshipView } from "../../learning/flagship-types";
import type { Scalar } from "../../lesson-types";
import "./panels.css";

type RunEvent = FlagshipView["events"][number];
const earlier = (view: FlagshipView) => view.events.slice(0, view.tick + 1);
const current = (view: FlagshipView) => view.events[view.tick];
const value = (item: Scalar | undefined) => typeof item === "number" ? showValue(item) : (item ?? "—").toString();

function Facts({ rows }: { rows: [string, Scalar | undefined][] }) {
  return <dl className="allocation-facts">
    {rows.map(([label, number]) => <div key={label}><dt>{label}</dt><dd>{value(number)}</dd></div>)}
  </dl>;
}

type LemonTrade = {
  seller: string; quality_revealed_for_review: number; price: number;
  seller_gain: number; buyer_gain: number; certification_cost: number;
};

export function LemonsPanel({ stage, action, view, comparison, pinned, pin, seek, cite }: DomainPanelProps) {
  if (!view) {
    if (stage !== "predict" && stage !== "bid") return null;
    return <section className="allocation-panel" aria-label="S01 的商品">
      <h2>S01 的商品</h2>
      <Facts rows={[[ "商品质量", 5 ], [ "卖家保留价（代币）", 5 ]]}/>
      <p>买方开盘只看到挂牌商品的整体质量分布。当前选择为{action === "keep" ? "保留商品" : "挂牌"}。</p>
    </section>;
  }
  const events = earlier(view);
  const opening = events[0];
  const active = current(view);
  const distribution = opening.listed_quality_distribution as Record<string, number>;
  const sellers = Object.entries(view.frame.entities).filter(([id]) => id.startsWith("S"));
  const selected = view.frame.entities[pinned];
  const seller = selected && pinned.startsWith("S") ? pinned : "S01";
  const state = view.frame.entities[seller];
  const exitEvents = events.filter(event => event.event_type === "offer_iteration" && (event.exited as string[]).length);
  const exiting = active.event_type === "offer_iteration" ? active.exited as string[] : [];
  const sellerExit = exitEvents.find(event => (event.exited as string[]).includes(seller));
  const transactions = active.event_type === "settlement" ? active.transactions as LemonTrade[] : [];
  const transaction = transactions.find(trade => trade.seller === seller);
  const currentPrice = view.frame.metrics.quoted_pool_price;
  if (stage === "compare" && comparison) return <section className="allocation-panel" aria-label="同步交割账本">
    <h2>同一观察点的交易账本</h2>
    <Facts rows={[[ "基准交割（件）", view.frame.metrics.traded ], [ "对照交割（件）", comparison.frame.metrics.traded ],
      [ "基准成交净剩余（代币）", view.frame.metrics.net_surplus ],
      [ "对照成交净剩余（代币）", comparison.frame.metrics.net_surplus ],
      [ "对照认证成本（代币）", comparison.frame.metrics.certification_cost ]]}/>
  </section>;
  if (stage === "compare") return null;
  const status = !state?.["挂牌"] ? "开盘未挂牌" : sellerExit ? "已因报价退出" :
    active.event_type === "settlement" ? transaction ? "已交割" : "未成交" :
      state["当前愿售"] ? "当前愿售" : "当前未愿售";

  return <section className="allocation-panel" aria-label="商品质量与交易">
    <h2>商品质量与交易</h2>
    <div className="allocation-split">
      <section>
        <h3>开盘挂牌分布</h3>
        <ul className="lemon-quality">
          {Object.entries(distribution).map(([quality, count]) => <li key={quality} aria-label={`质量 ${quality}，${count} 件`}>
            <span>质量 {quality}</span><meter min={0} max={Math.max(...Object.values(distribution), 1)} value={count}
              aria-label={`质量 ${quality} 的挂牌数量`}/><strong>{count}</strong>
          </li>)}
        </ul>
        <Facts rows={[[ "当前混合报价（代币）", currentPrice ?? "暂无" ],
          [ "当前愿售（件）", view.frame.metrics.willing_supply ], [ "实际交割（件）", view.frame.metrics.traded ]]}/>
      </section>
      <section>
        <h3>按卖家查看</h3>
        <label>固定卖家 <select aria-label="固定卖家" value={seller} onChange={event => pin(event.target.value)}>
          {sellers.map(([id]) => <option key={id}>{id}</option>)}
        </select></label>
        <p className="allocation-selection">{seller} · {status}</p>
        <Facts rows={[[ "买方可见的核验质量", state?.["买方可见的核验质量"] ?? "未公开" ],
          [ "个别报价（代币）", state?.["个别报价"] ]]}/>
        {sellerExit && <button className="text-button" onClick={() => seek(sellerExit.tick)}>定位 {seller} 退出 · 事件 {sellerExit.seq}</button>}
        {state?.["复盘质量"] !== undefined && <p>结算供核账的商品质量为 {value(state["复盘质量"])}。</p>}
        {transaction && <Facts rows={[[ "实付价格", transaction.price ], [ "买家剩余", transaction.buyer_gain ],
          [ "卖家剩余", transaction.seller_gain ], [ "认证成本", transaction.certification_cost ]]}/>}
      </section>
    </div>
    {active.event_type === "offer_iteration" && <div className="allocation-event">
      <h3>第 {String(active.iteration)} 轮报价</h3>
      {exiting.length ? <details><summary>{exiting.length} 件因报价退出 · 查看卖家</summary>
        <div className="toolbar">{exiting.map(id => <button key={id} aria-pressed={id === seller} onClick={() => pin(id)}>{id}</button>)}</div>
      </details> : <p>本轮没有报价后退出。</p>}
      <button onClick={() => cite(active.seq)}>引用本轮报价</button>
    </div>}
    {exitEvents.length > 0 && <div className="toolbar">
      <button className="text-button" onClick={() => seek(exitEvents[0].tick)}>定位首次报价后退出 · 事件 {exitEvents[0].seq}</button>
    </div>}
    {active.event_type === "settlement" && <div className="allocation-event">
      <h3>{transactions.length ? "交割账本" : "本次没有交割"}</h3>
      {transactions.length > 0 && <details><summary>查看成交卖家与交割值</summary>
        <div className="table-scroll"><table><caption>交割明细（价格与收益单位为代币）</caption>
          <thead><tr><th scope="col">卖家</th><th scope="col">质量</th><th scope="col">价格</th>
            <th scope="col">买家剩余</th><th scope="col">卖家剩余</th></tr></thead>
          <tbody>{transactions.map(row => <tr key={row.seller}><th scope="row">
            <button className="text-button" onClick={() => pin(row.seller)}>{row.seller}</button></th>
            <td>{row.quality_revealed_for_review}</td><td>{value(row.price)}</td>
            <td>{value(row.buyer_gain)}</td><td>{value(row.seller_gain)}</td></tr>)}</tbody>
        </table></div>
      </details>}
      <button onClick={() => cite(active.seq)}>引用本次交割</button>
    </div>}
  </section>;
}

type MatchingBrief = { true_preference?: string[]; priority_positions?: Record<string, number>; capacities?: Record<string, number> };
type Rejection = { student: string; school: string; priority_rank: number; was_held: boolean; cutoff: number[]; previous_commitments: string[] };
type Block = { student: string; school: string; lower_priority: string[]; empty_seat: boolean };

export function MatchingPanel({ stage, action, briefing, view, comparison, pinned, pin, seek, cite }: DomainPanelProps) {
  const [openSchool, setOpenSchool] = useState("A");
  if (!view) {
    if (stage !== "predict" && stage !== "bid") return null;
    const profile = briefing as MatchingBrief | null;
    return <section className="allocation-panel" aria-label="S01 的志愿单">
      <h2>S01 的志愿单</h2>
      <Facts rows={[[ "真实偏好", profile?.true_preference?.join(" → ") ?? "A → B → C" ],
        [ "当前申报", action === "safe_first" ? "B → A → C" : "A → B → C" ]]}/>
      {profile?.priority_positions && <Facts rows={Object.entries(profile.priority_positions).map(([school, rank]) =>
        [`${school} 校优先名次`, rank])}/>}
    </section>;
  }
  const events = earlier(view);
  const active = current(view);
  const roles = Object.keys(view.frame.entities).filter(id => /^S\d/.test(id));
  const student = roles.includes(pinned) ? pinned : "S01";
  const choice = view.frame.entities[student];
  const seats = ["A", "B", "C"];
  const applied = events.filter(event => event.event_type === "round_proposals" &&
    (event.proposals as Record<string, string>)[student]);
  const rejected = events.flatMap(event => event.event_type === "round_resolution" ?
    (event.rejected as Rejection[]).filter(row => row.student === student).map(row => ({ event, row })) : []);
  const currentRejections = active.event_type === "round_resolution" ? active.rejected as Rejection[] : [];
  const currentProposals = active.event_type === "round_proposals" ? active.proposals as Record<string, string> : {};
  const latestApplication = applied.at(-1);
  const seatStatus = active.event_type === "final_assignment" ? "录取" :
    view.intervention.mechanism === "immediate" ? "已确认" : "暂留";
  const blocks = (field: "submitted_blocking" | "true_blocking") => active[field] as Block[];
  const evidenceFor = (event: RunEvent, actor?: string) => cite(event.seq, event.actors?.includes(actor ?? "") ? actor : undefined);
  const chooseStudent = <label>申请人 <select value={student} aria-label="固定申请人" onChange={event => pin(event.target.value)}>
    {roles.map(id => <option key={id}>{id}</option>)}
  </select></label>;
  const selectedSeat = (scenario: FlagshipView) => {
    const person = scenario.frame.entities[student];
    return person?.["最终入学"] ?? person?.["已确认学校"] ?? person?.["暂留学校"] ?? "无";
  };
  if (stage === "compare" && comparison) return <section className="allocation-panel" aria-label="同一申请人对照">
    <h2>同步查看 {student}</h2>
    {chooseStudent}
    <Facts rows={[[ "基准席位", selectedSeat(view) ], [ "对照席位", selectedSeat(comparison) ],
      [ "基准按真实偏好的阻挡对", view.frame.metrics.true_blocking_pairs ],
      [ "对照按真实偏好的阻挡对", comparison.frame.metrics.true_blocking_pairs ]]}/>
  </section>;
  if (stage === "compare") return null;

  return <section className="allocation-panel" aria-label="志愿与席位">
    <h2>志愿与席位</h2>
    <div className="matching-seats" role="group" aria-label="三所学校席位">
      {seats.map(school => {
        const state = view.frame.entities[school];
        const held = String(state["席位名单"] || "").split("、").filter(Boolean);
        return <button type="button" key={school} aria-pressed={school === openSchool}
          onClick={() => setOpenSchool(school)}>
          <strong>{school} 校</strong><span>{seatStatus} {held.length} / {String(state["容量"])}</span>
        </button>;
      })}
    </div>
    <p><strong>{openSchool} 校席位</strong> · {view.frame.entities[openSchool]["席位名单"] || "当前无占位"}</p>
    <details><summary>{openSchool} 校优先顺序</summary>
      <p>{String(view.frame.entities[openSchool]["学校优先序"]).replaceAll(" > ", " → ")}</p>
    </details>
    <div className="allocation-split">
      <section>
        <h3>固定申请人</h3>
        {chooseStudent}
        <Facts rows={[[ "真实偏好", choice?.["真实偏好"] ], [ "提交志愿", choice?.["提交志愿"] ],
          [ active.event_type === "final_assignment" ? "最终入学" : "当前席位",
            selectedSeat(view) ]]}/>
      </section>
      <section>
        <h3>{student} 的申请记录</h3>
        {applied.length ? <ul className="allocation-events">{applied.map(event => <li key={event.seq}>
          <button className="text-button" onClick={() => seek(event.tick)}>
            第 {String(event.round)} 轮申请 {(event.proposals as Record<string, string>)[student]} 校 · 事件 {event.seq}
          </button></li>)}</ul> : <p>当前阶段还没有申请记录。</p>}
        {rejected.map(({ event, row }) => <button className="text-button" key={event.seq} onClick={() => seek(event.tick)}>
          打开 {row.school} 校拒绝 · 事件 {event.seq}
        </button>)}
        {latestApplication && <button onClick={() => evidenceFor(latestApplication, student)}>引用最近申请</button>}
      </section>
    </div>
    {active.event_type === "round_proposals" && <div className="allocation-event">
      <h3>第 {String(active.round)} 轮申请</h3>
      <p>{currentProposals[student] ? `${student} 向 ${currentProposals[student]} 校申请。` : `${student} 本轮没有新增申请。`}</p>
    </div>}
    {active.event_type === "round_resolution" && <div className="allocation-event">
      <h3>第 {String(active.round)} 轮处理结果</h3>
      {currentRejections.length ? <ul className="allocation-events">{currentRejections.map(row => {
        const origin = view.frame.relations?.find(edge => edge.from === row.school && edge.to === row.student &&
          edge.label.startsWith("拒绝"))?.origin_seq;
        return <li key={`${row.school}/${row.student}`}>
          <p>{row.student} 的 {row.school} 校申请被拒{row.was_held ? "（此前曾暂留）" : ""}，优先名次 {row.priority_rank}。
            {row.previous_commitments.length > 0 && `先前锁定 ${row.previous_commitments.join("、")}。`}</p>
          <div className="toolbar">
            {origin !== undefined && <button className="text-button" onClick={() => { pin(row.student); seek(origin); }}>
              回查 {row.student} 的原申请 · 事件 {origin}
            </button>}
            <button className="text-button" onClick={() => evidenceFor(active, row.student)}>引用 {row.student} 的拒绝</button>
          </div>
        </li>;
      })}</ul> : <p>本轮没有拒绝记录。</p>}
    </div>}
    {active.event_type === "final_assignment" && <div className="allocation-event">
      <h3>最终分配</h3>
      <Facts rows={[[ "真实首选人数", view.frame.metrics.first_true_choice ], [ "S01 的真实志愿名次", view.frame.metrics.student_true_rank ]]}/>
      {([["submitted_blocking", "按提交志愿"], ["true_blocking", "按真实偏好"]] as const).map(([key, title]) => <details key={key}>
        <summary>{title}的阻挡对 · {blocks(key).length} 对</summary>
        {blocks(key).length > 0 ? <ul>{blocks(key).map(row => <li key={`${row.student}/${row.school}`}>
          {row.student} 更偏好 {row.school} 校，{row.empty_seat ? "该校有空位" : `该生优先于 ${row.lower_priority.join("、")}`}。
        </li>)}</ul> : <p>按这份排序检查，未发现阻挡对。</p>}
      </details>)}
      <button onClick={() => evidenceFor(active, student)}>引用最终分配</button>
    </div>}
  </section>;
}

const chain = ["零售商", "批发商", "分销商", "工厂"];
type Batch = { sender: string; receiver: string; amount: number; sent: number; due: number; origin_seq?: number };

function variance(values: number[]) {
  if (values.length < 2 || values.some(x => !Number.isFinite(x))) return null;
  const average = values.reduce((total, item) => total + item, 0) / values.length;
  return values.reduce((total, item) => total + (item - average) ** 2, 0) / values.length;
}

export function BeerPanel(props: DomainPanelProps) {
  const { stage, action, view, comparison, pinned, pin, seek, cite } = props;
  if (!view) {
    if (stage !== "intro" && stage !== "predict" && stage !== "bid") return null;
    return <section className="allocation-panel" aria-label="四级供应链的开局">
      <h2>四级供应链</h2>
      <ol className="beer-chain">{chain.map(role => <li key={role}><strong>{role}</strong><span>库存 12 件</span></li>)}</ol>
      <p>订单从零售传向工厂，货物从上游返回。第 5 周终端需求从 4 件升到 8 件。当前第 5 周零售订单为 {action} 件。</p>
    </section>;
  }
  const active = current(view);
  const role = chain.includes(pinned) ? pinned : "零售商";
  const state = view.frame.entities[role];
  if (stage === "compare" && comparison) return <section className="allocation-panel" aria-label="同一供应链环节对照">
    <h2>同一周的 {role}</h2>
    <label>供应链环节 <select value={role} onChange={event => pin(event.target.value)}>
      {chain.map(name => <option key={name}>{name}</option>)}
    </select></label>
    <Facts rows={[[ "基准到货（件）", state["本周到货"] ],
      [ "对照到货（件）", comparison.frame.entities[role]?.["本周到货"] ],
      [ "基准积压（件）", state["期末积压"] ],
      [ "对照积压（件）", comparison.frame.entities[role]?.["期末积压"] ]]}/>
  </section>;
  if (stage === "compare") return null;
  const prior = view.previous?.entities[role];
  const week = Number(active.week);
  const batches = (active.in_transit_batches ?? []) as Batch[];
  const arrivals = ((active.arrivals ?? []) as Batch[]).filter(row => row.receiver === role);
  const dispatches = ((active.dispatches ?? []) as Batch[]).filter(row => row.sender === role || (role === "工厂" && row.sender === "生产"));
  const physical = batches.filter(row => row.receiver === role).reduce((total, batch) => total + batch.amount, 0);
  const inPipeline = Number(state["全部已订未到"]);
  const quantity = (row: Batch) => `${row.amount} 件，计划第 ${row.due} 周到货`;
  const source = (batch: Batch) => batch.origin_seq === undefined ?
    <span>开局已发出的批次</span> :
    <button className="text-button" onClick={() => seek(batch.origin_seq!)}>回查第 {batch.sent} 周发货 · 事件 {batch.origin_seq}</button>;
  const visibleEvents = earlier(view);
  const studentWeek = visibleEvents.find(event => event.week === 5);
  const receiveWeek = visibleEvents.find(event => event.week === 6 && event.demand_received);
  const weeks = visibleEvents.filter(event => event.event_type === "week_end");
  const demandVariance = variance(weeks.map(event => (event.demand_received as Record<string, number>)?.["零售商"]));
  const shipped = role === "零售商" ? Number(active.delivered) - Number(visibleEvents.at(-2)?.delivered) :
    dispatches.filter(batch => batch.sender === role).reduce((total, batch) => total + batch.amount, 0);
  const stock = Number(prior?.["期末库存"]), arrivalsTotal = Number(state["本周到货"]);
  const verified = !!prior && stock + arrivalsTotal - shipped === state["期末库存"];

  return <section className="allocation-panel" aria-label="订单与实物在途">
    <h2>订单与实物在途</h2>
    <div className="beer-direction"><strong>从零售向工厂提交订单</strong><span>上游发货，向下游到达</span></div>
    <ol className="beer-chain">{chain.map(name => {
      const item = view.frame.entities[name];
      return <li key={name}><button type="button" aria-pressed={name === role} onClick={() => pin(name)}>
        <strong>{name}</strong><span>库存 {value(item["期末库存"])} · 积压 {value(item["期末积压"])}</span>
      </button></li>;
    })}</ol>
    <div className="allocation-split">
      <section aria-label={`${role} 的周账本`}>
        <h3>{role} · {week ? `第 ${week} 周` : "开局"}</h3>
        <Facts rows={[[ "周初库存", prior?.["期末库存"] ], [ "实际到货", state["本周到货"] ], [ "本周需求", state["本周需求"] ],
          [ "周末库存", state["期末库存"] ], [ "周末积压", state["期末积压"] ], [ "本周下单", state["本周下单"] ]]}/>
        <p>库存位置 {value(state["库存位置"])} ＝ 库存 {value(state["期末库存"])} ＋ 已订未到 {inPipeline}
          − 积压 {value(state["期末积压"])}。</p>
        <p>其中实物在途 {physical} 件，已订待发 {inPipeline - physical} 件。</p>
        {verified && <p><strong>算术恒等式</strong> · 期末库存 {stock}（期初）＋ {arrivalsTotal}（到货）
          − {shipped}（实际发货）＝ {state["期末库存"]} 件。</p>}
        <p><strong>模型规则</strong> · 需求预期、库存位置和积压进入本场自动订货。学生订单计划可以覆盖零售环节的自动值。</p>
      </section>
      <section>
        <h3>实际物流批次</h3>
        {arrivals.length ? <ul className="allocation-events">{arrivals.map((batch, index) =>
          <li key={index}><p>{batch.sender} 到 {batch.receiver}，实际到货 {batch.amount} 件。</p>{source(batch)}</li>
        )}</ul> : <p>{role} 本周无到货记录。</p>}
        {dispatches.length > 0 && <details><summary>本周发出的批次</summary>
          <ul>{dispatches.map((batch, index) => <li key={index}>{batch.sender} 到 {batch.receiver}，{quantity(batch)}。</li>)}</ul>
        </details>}
        {active.event_type === "week_end" && <button onClick={() => cite(active.seq, role)}>引用这一周</button>}
      </section>
    </div>
    <div className="toolbar">
      {studentWeek && <button className="text-button" onClick={() => { pin("零售商"); seek(studentWeek.tick); }}>定位第 5 周零售订单</button>}
      {receiveWeek && <button className="text-button" onClick={() => { pin("批发商"); seek(receiveWeek.tick); }}>定位第 6 周批发收到订单</button>}
    </div>
    <details>
      <summary>核对各环节的订单放大</summary>
      <p>使用截至当前的 {weeks.length} 个已完成周。每层订单的周度总体方差除以同周终端需求的总体方差。</p>
      {!demandVariance ? <p>终端需求方差为零或周数不足，放大比无法计算。</p> :
        <Facts rows={chain.map(name => {
          const orders = variance(weeks.map(event => (event.orders as Record<string, number>)?.[name]));
          return [name, orders == null ? "缺周记录" : value(orders / demandVariance)];
        })}/>}
      {weeks.length > 0 && <details><summary>反查 {role} 的订单样本</summary>
        <ul>{weeks.map(event => <li key={event.seq}><button type="button" className="text-button" onClick={() => seek(event.tick)}>
          第 {String(event.week)} 周 · {role}下单 {value((event.orders as Record<string, number> | null)?.[role])} 件
        </button></li>)}</ul>
      </details>}
    </details>
    <LedgerEvidence view={view} metric="retail_stock" actor={role} seek={tick => seek(tick)} initialOpen={props.explore}/>
    {stage === "explain" && <FeedbackExplanation {...props} view={view} eventType="week_end"
      prompt="用一个有周账本证据的环节说明：哪些订单尚未收到、实际发货怎样改变库存或积压、这种状态怎样反馈到后续订单？给出一份能检验另一种解释的对照。"/>}
  </section>;
}
