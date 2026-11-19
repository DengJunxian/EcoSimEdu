import type { ReactNode } from "react";
import { auctionLesson, type AuctionFrame, type AuctionRun } from "./auction.ts";
import { displayObservation, type Command, type Session } from "./lesson.ts";
import { TransferAfterEvidence } from "./FlagshipTransfer.tsx";
import { Studio } from "./Studio";

function exportRun(session: Session) {
  const blob = new Blob([JSON.stringify({
    schema: "ecosimedu-auction/browser-v1", choices: session.choices,
    baseline: session.run, comparison: session.comparison,
  })], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "双向拍卖运行记录.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function OrderBook({ frame, locate }: { frame: AuctionFrame; locate?: (id: string, actorId: string) => void }) {
  const { record } = frame;
  const submitted = record.event_type === "order_submitted";
  const rejected = record.event_type === "order_rejected";
  const cancelled = record.event_type === "order_cancelled";
  return <details className="trace-details flagship-evidence">
    <summary>查看当前订单簿 · {frame.book.length} 张挂单</summary>
    {record.order_id && <p>{record.order_id} · {record.actor_id}。
      {submitted ? `提交${record.side === "buy" ? "买单" : "卖单"}，限价 ${record.price} 代币。` : rejected ?
        `限价 ${record.price} 代币，订单未通过报价约束。` : cancelled ? "剩余委托已撤回。这笔撤回没有成交。" : ""}
      {locate && cancelled && <button type="button" className="text-button"
        onClick={() => locate(record.order_id!, record.actor_id!)}>查看被撤委托 {record.order_id}</button>}
    </p>}
    <p>事件 {frame.tick} 后的在簿委托。同价按提交先后排列。</p>
    <div className="order-book">
      {(["buy", "sell"] as const).map(side => {
        const orders = frame.book.filter(order => order.side === side)
          .sort((left, right) => side === "buy" ? right.price - left.price : left.price - right.price);
        return <table key={side} className="flagship-table">
          <caption>{side === "buy" ? "买单，高价优先" : "卖单，低价优先"}</caption>
          <thead><tr><th scope="col">委托</th><th scope="col">参与者</th>
            <th scope="col">限价</th><th scope="col">件数</th></tr></thead>
          <tbody>{orders.map(order => <tr key={order.order_id}>
            <th scope="row">{locate ? <button type="button" className="text-button"
              onClick={() => locate(order.order_id, order.actor_id)} aria-label={`查看挂单 ${order.order_id} 原报价`}>{order.order_id}</button> :
              order.order_id}</th><td>{order.actor_id}</td><td>{order.price}</td><td>{order.quantity}</td>
          </tr>)}
          {!orders.length && <tr><td colSpan={4}>暂无挂单</td></tr>}</tbody>
        </table>;
      })}
    </div>
  </details>;
}

function TradeSettlement({ run, label }: { run: AuctionRun; label: string }) {
  const trades = run.frames.filter(frame => frame.record.event_type === "trade");
  return <details className="trace-details">
    <summary>核算{label}逐笔成交剩余</summary>
    <p>成交价来自撮合。买方剩余是价值减成交价和买方费用，卖方剩余是成交价减成本和卖方费用。
      这项模型中的手续费转进平台账户，未消耗资源。</p>
    {trades.map(frame => {
      const trade = frame.record;
      const price = trade.price!, buyer = trade.buyer_surplus!, seller = trade.seller_surplus!;
      const value = buyer + price + run.fee, cost = price - run.fee - seller;
      return <div className="settlement-row" key={frame.tick}>
        <h3>事件 {frame.tick} · {trade.buyer_id} 与 {trade.seller_id}</h3>
        <p>在簿委托 {trade.maker_order_id} 定价 {price} 代币。每方缴费 {run.fee}。</p>
        <ul>
          <li>买方价值 {value}，买方剩余 {value} − {price} − {run.fee} = {buyer}。</li>
          <li>卖方成本 {cost}，卖方剩余 {price} − {cost} − {run.fee} = {seller}。</li>
          <li>买方与卖方剩余 + 平台收费 = {buyer} + {seller} + {trade.platform_fee} = {value - cost}。</li>
        </ul>
      </div>;
    })}
    {!trades.length && <p>没有成交，因而没有可核算的成交价或逐笔剩余。</p>}
  </details>;
}

function AuctionEvidence({ session, send, nextAction }: {
  session: Session; send: (command: Command) => void; nextAction?: ReactNode;
}) {
  const run = session.run as AuctionRun | undefined;
  if (!run || session.stage === 1) return null;
  const frame = run.frames[session.cursor];
  const decision = session.choices[1];
  const prediction = decision === "yes" ? "会成交" : decision === "no" ? "不会成交" : "还不确定";

  if (session.stage === 4) {
    if (!session.comparison) return null;
    const close = run.frames.at(-1)!;
    const lastTrade = run.frames.filter(item => item.record.event_type === "trade").at(-1);
    const result = session.comparison.run as AuctionRun;
    const summary = [run, result].map(item => {
      const metrics = item.frames.at(-1)!.metrics;
      const price = item.frames.filter(frame => frame.record.event_type === "trade").at(-1)?.metrics.price;
      return [metrics.volume, price, metrics.participant_surplus, metrics.platform_cash,
        metrics.surplus, item.ceiling, metrics.efficiency === null ? null : `${(metrics.efficiency! * 100).toFixed(1)}%`];
    });
    const labels = ["成交量（件）", "末笔成交价", "买卖双方剩余", "平台收入", "总剩余", "可实现剩余上界", "配置效率"];
    return <section className="auction-evidence" aria-label="成交、费用与效率">
      <h2>收盘核对</h2>
      <p>基准成交 {close.metrics.volume} 件 · 最后成交价 {lastTrade?.metrics.price ?? "未定义"}</p>
      <p>可实现剩余上界 {run.ceiling} 代币 · 基准效率 {close.metrics.efficiency === null ?
        "未定义" : `${(close.metrics.efficiency * 100).toFixed(1)}%`}</p>
      <p>种子 {run.seed}，两次都提交原限价 {run.bid} 代币。{run.demandShift === result.demandShift ?
        `保留买方价值和卖方成本，每方每件费用从 ${run.fee} 变为 ${result.fee}。` :
        `每单位买方价值增加 ${result.demandShift - run.demandShift}，卖方成本不变，两组交易费均为 0。`}</p>
      <table className="source-metrics flagship-table">
        <caption>收盘核算，价和剩余以代币计</caption>
        <thead><tr><th scope="col">指标</th><th scope="col">基线</th><th scope="col">干预</th></tr></thead>
        <tbody>{labels.map((label, index) => <tr key={label}><th scope="row">{label}</th>
          {summary.map((side, i) => <td key={i}>{typeof side[index] === "string" ? side[index] : displayObservation(side[index] as number | null | undefined)}</td>)}
        </tr>)}</tbody>
      </table>
      <p>{run.ceiling === 0 ? "开局的最高买方价值低于最低卖方成本。可实现剩余上界为 0，所以配置效率未定义。" :
        "配置效率用实际总剩余除以可实现上界。成交价影响剩余在双方的分配，配置效率还取决于哪些价值和成本真正配对。"}
        {run.ceiling !== result.ceiling && "买方估值变动也改变了可实现上界，两组效率各用自己的分母。"}</p>
      {!!close.metrics.volume && !run.frames.some(frame => frame.record.buyer_id === "B01") &&
        <p>B01 的委托到收盘仍未成交，市场里的其他配对仍创造了 {close.metrics.surplus} 代币总剩余。</p>}
      <TradeSettlement run={run} label="基线"/>
      <TradeSettlement run={result} label="干预"/>
      <div className="auction-actions">
        <button onClick={() => exportRun(session)}>导出本次运行</button>
        <a href={run.market === "boundary" ? "?lesson=double_auction" : "?lesson=double_auction&market=no-overlap"}>
          {run.market === "boundary" ? "回到基准市场" : "试一试供需无交叠"}
        </a>
      </div>
    </section>;
  }

  const trace = frame.record;
  const seen = run.frames.slice(0, session.cursor + 1);
  const myTrade = seen.find(item => item.record.buyer_id === "B01");
  const canLocate = session.stage === 3;
  const trade = trace.event_type === "trade";
  const orderIds = [trace.buy_order_id, trace.sell_order_id];
  const bestBid = frame.book.filter(order => order.side === "buy").sort((a, b) => b.price - a.price)[0];
  const bestAsk = frame.book.filter(order => order.side === "sell").sort((a, b) => a.price - b.price)[0];
  const signal = frame.events[0]?.priorSignal;
  const locateOrder = (id: string, actorId: string) =>
    send({ type: "locate", tick: Number(id.slice(1)), metricId: "price", actorId });
  const latestShownTrade = run.frames.slice(0, session.revealed + 1).filter(item => item.record.event_type === "trade").at(-1);
  return <section className="auction-evidence" aria-label="订单与成交证据">
    <h2>{trade ? "哪张订单决定成交价？" : "核对你的报价"}</h2>
    <p>你报了 {run.bid} 代币，预测「{prediction}」。{trace.event_type === "market_close" && !myTrade ?
      "收盘时 B01 的订单未成交。" : myTrade ? `B01 在事件 ${myTrade.tick} 以 ${myTrade.metrics.price} 成交。` :
      "截至当前事件，B01 尚未成交。"} </p>
    {!trade && (bestBid || bestAsk) && <p>
      当前最高买价 {bestBid ? `${bestBid.price}（${bestBid.order_id}）` : "无"}，
      最低卖价 {bestAsk ? `${bestAsk.price}（${bestAsk.order_id}）` : "无"}。
    </p>}
    {trade && <p>结算价 {trace.price} 代币来自在簿订单 {trace.maker_order_id}。</p>}
    {nextAction}
    {!trade && bestBid && bestAsk && <p>{bestBid.price < bestAsk.price ?
      "当前买卖限价没有交叉，这两张委托继续等待。后续价格和成交仍取决于新委托或撤单。" :
      "这一步的买卖限价已交叉。当前事件记录提交，实际成交请看随后的撮合记录。"}</p>}
    {signal && <p>{trace.actor_id} 的 {trace.order_id} 参考了事件 {signal.tick} 的成交价 {signal.value} 代币。</p>}
    {trade && <>
      <ul className="auction-orders">
        {orderIds.map(id => {
          const order = run.quotes[id!];
          return <li key={order.order_id}>{order.side === "buy" ? "买单" : "卖单"} {order.order_id}
            {" "}{order.actor_id} 报 {order.price} 代币{order.order_id === trace.maker_order_id ? " · 先在簿" : " · 后到达"}
            {canLocate && <button className="text-button" onClick={() => locateOrder(order.order_id, order.actor_id)}>
              查看 {order.order_id} 原报价</button>}
          </li>;
        })}
      </ul>
    </>}
    {canLocate && !trade && latestShownTrade && <button className="text-button"
      onClick={() => send({ type: "locate", tick: latestShownTrade.tick, metricId: "price" })}>回到已观察到的成交</button>}
    {trace.event_type === "market_close" && frame.metrics.volume === 0 &&
      <p>收盘统计 · 成交量 0，成交价未定义{run.ceiling === 0 ? "，可实现剩余上界为 0，效率未定义。" : "。"}</p>}
    <OrderBook frame={frame} locate={canLocate ? locateOrder : undefined}/>
  </section>;
}

const boundary = new URLSearchParams(location.search).get("market") === "no-overlap";
const lesson = auctionLesson(boundary);

export default function AuctionClassroom() {
  return <Studio lesson={lesson} reviewByTimeline
    review={(session, send, nextAction) => <AuctionEvidence session={session} send={send} nextAction={nextAction}/>}
    afterInvestigation={session => <TransferAfterEvidence caseId="double_auction" session={session}/>}/>;
}
