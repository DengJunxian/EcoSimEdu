import { auctionLesson, type AuctionRun } from "./auction.ts";
import type { Command, Session } from "./lesson.ts";
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

function AuctionEvidence({ session, send }: { session: Session; send: (command: Command) => void }) {
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
    return <section className="auction-evidence" aria-label="成交、费用与效率">
      <h2>收盘核对</h2>
      <p>基准成交 {close.metrics.volume} 件 · 最后成交价 {lastTrade?.metrics.price ?? "未定义"}</p>
      <p>可实现剩余上界 {run.ceiling} 代币 · 基准效率 {close.metrics.efficiency === null ?
        "未定义" : `${(close.metrics.efficiency * 100).toFixed(1)}%`}</p>
      <p>收费组平台收入 {result.frames.at(-1)!.metrics.platform_cash} 代币。平台收入是参与者向平台的支付转移。</p>
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
    {trade && <>
      <ul className="auction-orders">
        {orderIds.map(id => {
          const order = run.quotes[id!];
          const tick = Number(order.order_id.slice(1));
          return <li key={order.order_id}>{order.side === "buy" ? "买单" : "卖单"} {order.order_id}
            {" "}{order.actor_id} 报 {order.price} 代币{order.order_id === trace.maker_order_id ? " · 先在簿" : " · 后到达"}
            {canLocate && <button className="text-button" onClick={() => send({
              type: "locate", tick, metricId: "price", actorId: order.actor_id,
            })}>查看 {order.order_id} 原报价</button>}
          </li>;
        })}
      </ul>
      <p>结算价 {trace.price} 代币来自在簿订单 {trace.maker_order_id}。</p>
      <details className="trace-details">
        <summary>核对成交剩余</summary>
        <p>买方剩余 {trace.buyer_surplus} + 卖方剩余 {trace.seller_surplus} +
          平台收入 {trace.platform_fee} = 总剩余 {frame.events[0].deltas.surplus}。</p>
      </details>
    </>}
    {canLocate && !trade && latestShownTrade && <button className="text-button"
      onClick={() => send({ type: "locate", tick: latestShownTrade.tick, metricId: "price" })}>回到已观察到的成交</button>}
    {trace.event_type === "market_close" && frame.metrics.volume === 0 &&
      <p>收盘统计 · 成交量 0，成交价未定义{run.ceiling === 0 ? "，可实现剩余上界为 0，效率未定义。" : "。"}</p>}
  </section>;
}

const boundary = new URLSearchParams(location.search).get("market") === "no-overlap";
const lesson = auctionLesson(boundary);

export default function AuctionClassroom() {
  return <Studio lesson={lesson} reviewByTimeline review={(session, send) => <AuctionEvidence session={session} send={send}/>}/>;
}
