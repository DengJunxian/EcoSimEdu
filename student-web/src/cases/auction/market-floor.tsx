import { useEffect, useRef, useState } from "react";
import lesson from "../../../../cases/double_auction/case.json";
import { PriceChart } from "../../charts";
import { eventHref } from "../../contracts";
import type { AuctionEvidence } from "./auction-study";
import { useAuctionSelection } from "./selection-context";
import { CompactViews, LedgerEvidence } from "../../emergence/trace-view";
import { AuctionStructureTask } from "./structure-task";

const eventNames: Record<string, string> = {
  market_open: "市场开盘", market_close: "市场收盘", order_submitted: "报价入簿",
  order_rejected: "报价被拒绝", order_cancelled: "撤销未成交订单", trade: "成交结算",
};

function PlaybackController() {
  const { view, mode, chooseMode, revealed, pending, cursor, playbackRef, seek, evidenceSelected } = useAuctionSelection();
  const [playing, setPlaying] = useState(false);
  const current = view.events[view.tick];
  const stop = view.closed || current?.event_type === "trade";
  useEffect(() => {
    if (!playing) return;
    if (evidenceSelected || (!pending && stop)) {
      setPlaying(false);
      return;
    }
    if (pending) return;
    const timer = window.setTimeout(() => seek(view.tick + 1), 170);
    return () => window.clearTimeout(timer);
  }, [playing, pending, stop, seek, view.tick, evidenceSelected]);
  const step = (tick: number | "close") => { setPlaying(false); seek(tick); };
  const max = mode === "guided" ? revealed : view.end ?? revealed;
  const sliderTick = pending && typeof cursor === "number" ? Math.min(cursor, max) : view.tick;
  const clock = view.closed ? "收盘" : view.round == null || current?.source === "student" ? "开局" :
    view.round === lesson.rounds ? "收盘清单" : `第 ${view.round + 1} 轮`;
  const eventName = eventNames[current?.event_type] ?? "事件";
  const previousUnavailable = view.tick === 0 || pending;
  const nextUnavailable = view.closed || pending;
  return <section className="auction-playback" aria-label="市场时间">
    <div className="auction-heading-row">
      <strong>{clock} · 事件 {view.tick} · {eventName}</strong>
      <label>查看方式 <select aria-label="查看方式" value={mode} onChange={event => {
        setPlaying(false);
        chooseMode(event.target.value as typeof mode);
      }}><option value="guided">引导</option><option value="review">复盘</option>
        <option value="explore">自由探索</option></select></label>
    </div>
    <label className="auction-slider">回放事件
      <input ref={playbackRef} type="range" min={0} max={Math.max(1, max)} value={sliderTick} disabled={max === 0}
        aria-valuetext={sliderTick === view.tick ? `事件 ${view.tick}，${clock}，${eventName}` : `正在定位，目标事件为 ${sliderTick}`}
        onChange={event => step(Number(event.target.value))}/>
    </label>
    <div className="toolbar">
      <button aria-disabled={previousUnavailable} onClick={() => {
        if (!previousUnavailable) step(view.tick - 1);
      }}>上一步</button>
      <button aria-disabled={nextUnavailable} onClick={() => {
        if (!nextUnavailable) step(view.tick + 1);
      }}>下一步</button>
      {playing ? <button onClick={() => setPlaying(false)}>暂停</button> :
        <button aria-disabled={nextUnavailable} onClick={() => {
          if (nextUnavailable) return;
          if (current?.event_type === "trade") seek(view.tick + 1);
          setPlaying(true);
        }}>播放至成交</button>}
      <button className="text-button" aria-disabled={nextUnavailable} onClick={() => {
        if (!nextUnavailable) step("close");
      }}>快进到收盘</button>
    </div>
    {mode !== "guided" && <p className="auction-muted">成交图包含整场结果，可选中任意已完成的成交。</p>}
  </section>;
}

export function MarketFloor({ cite, evidence, explaining, explore }: {
  cite: (evidence: AuctionEvidence) => void; evidence: AuctionEvidence[]; explaining: boolean;
  explore?: boolean;
}) {
  const { view, mode, seekEvidence, pinned, pin, selectedActor, selectActor } = useAuctionSelection();
  const actorPicker = useRef<HTMLSelectElement>(null);
  const focusActorPicker = () => requestAnimationFrame(() => actorPicker.current?.focus());
  const { frame, settlement, student_order: studentOrder, student_trade: studentTrade, student_close: studentClose } = view;
  const actor = selectedActor || pinned;
  const account = frame.accounts[actor];
  const sides = [
    { id: "buy", title: "买单", orders: frame.orders.filter(order => order.side === "buy").sort((a, b) => b.price - a.price) },
    { id: "sell", title: "卖单", orders: frame.orders.filter(order => order.side === "sell").sort((a, b) => a.price - b.price) },
  ];
  const lowestSellQuote = view.events.reduce<number | null>((lowest, event) => {
    if (event.event_type !== "order_submitted" || event.side !== "sell" || event.price === undefined ||
        event.seq > view.tick) return lowest;
    return lowest === null ? event.price : Math.min(lowest, event.price);
  }, null);
  const captured = view.evidence && evidence.some(item => item.run_id === view.run_id && item.seq === view.evidence?.seq);
  const focus = { run_id: view.run_id, result_hash: view.result_hash, tick: view.tick, case_id: "double_auction" };
  const world = <>
    <div className="auction-floor-grid">
      <section className="auction-tape">
        <div className="auction-heading-row">
          <h2>交易大厅</h2><span className="auction-muted">{view.origin === "precomputed_simulation" ? "预计算仿真" : "本次离线计算"}</span>
        </div>
        <dl className="auction-totals">
          <div><dt>最高买价</dt><dd>{frame.best_bid ?? "—"}</dd></div>
          <div><dt>最低卖价</dt><dd>{frame.best_ask ?? "—"}</dd></div>
          <div><dt>最近成交价</dt><dd>{frame.last_price ?? "—"}</dd></div>
          <div><dt>累计成交</dt><dd>{frame.volume} 件</dd></div>
        </dl>
        <div className="auction-book">
          {sides.map(side => <section key={side.id} className={`auction-side auction-side-${side.id}`}>
            <h3>{side.title} <small>代币／件</small></h3>
            {side.orders.length ? <ol>
              {side.orders.map(order => <li key={order.order_id}><button aria-pressed={actor === order.actor_id}
                onClick={() => selectActor(order.actor_id)}>
                <span>{order.actor_id} <small>{order.order_id}</small></span><strong>{order.price}</strong>
              </button></li>)}
            </ol> : <p className="auction-muted">当前无挂单</p>}
          </section>)}
        </div>
        <PriceChart events={view.events} tick={view.tick} choose={seekEvidence}
          closed={view.closed || mode !== "guided"} revealUntil={mode === "guided" ? view.tick : view.end ?? view.tick}/>
      </section>
      <aside className="auction-actors" aria-label="订单关系与主体">
        <h2>订单与主体</h2>
        {studentOrder && <p className="auction-order-state">
          B01 · {studentOrder.price} 代币限价 · {
            studentOrder.event_type === "order_rejected" ? "拒单" : studentTrade !== null ? "已成交" :
              studentClose !== null && view.tick >= studentClose ? "收盘未成交" : "已入簿，尚未成交"}
        </p>}
        {studentClose !== null && view.tick >= studentClose && studentOrder?.price !== undefined &&
          <p>这笔买单没有配对成交，收盘时撤销。{lowestSellQuote === null ? "场内没有卖单入簿。" :
            lowestSellQuote > studentOrder.price ? `入簿卖单最低报 ${lowestSellQuote}，仍高于 B01 的 ${studentOrder.price}。` :
              `入簿卖单最低报 ${lowestSellQuote}。查入簿时间和价格优先级，确认它是否曾与 B01 同时在簿。`}
            <button className="text-button" onClick={() => seekEvidence(studentClose)}>查看收盘撤单</button></p>}
        {settlement && <section className="auction-settlement">
          <h3>{frame.last_price} 代币成交</h3>
          <ul>
            {[settlement.buy, settlement.sell].map((order, index) => <li key={order.order_id}>
              <button onClick={() => selectActor(order.actor_id!)} aria-pressed={actor === order.actor_id}>
                <span>{index === 0 ? "买单" : "卖单"} {order.order_id} · {order.actor_id}
                  {order.order_id === settlement.maker_order_id && <small>先到在簿</small>}</span>
                <strong>{order.price}</strong>
              </button>
              <button className="text-button" onClick={() => { seekEvidence(order.tick); selectActor(order.actor_id!); }}>
                定位{index === 0 ? "买" : "卖"}单原报价 · 事件 {order.tick}
              </button>
            </li>)}
          </ul>
          <p>买方增加 1 件，卖方减少 1 件。选一方可查看账户变化。</p>
        </section>}
        <label className="auction-field">查看主体
          <select ref={actorPicker} aria-label="查看主体" value={actor} onChange={event => selectActor(event.target.value)}>
            {!actor && <option value="">选择主体</option>}
            {Object.keys(frame.accounts).sort().map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        {actor && <div className="auction-account">
          <button className="text-button" aria-pressed={actor === pinned} onClick={() => {
            pin(actor === pinned ? "" : actor);
            if (actor === pinned && !selectedActor) focusActorPicker();
          }}>
            {actor === pinned ? `取消固定 ${actor}` : `固定 ${actor}`}
          </button>
          {account ? <dl>
            {(["cash", "goods", "filled"] as const).map((key, index) => <div key={key}>
              <dt>{["现金 · 代币", "持有 · 件", "已成交 · 件"][index]}</dt>
              <dd>{settlement?.before[actor] && `${settlement.before[actor][key]} → `}{account[key]}</dd>
            </div>)}
          </dl> : <p>此时没有可查证的账户数据。</p>}
        </div>}
        {pinned && pinned !== actor &&
          <button className="text-button" onClick={() => {
            selectActor("");
            focusActorPicker();
          }}>返回已固定主体 {pinned}</button>}
        {view.evidence && <div className="auction-citation">
          <button onClick={() => cite(view.evidence!)} disabled={captured || undefined}>
            {captured ? "已加入笔记" : view.evidence.kind === "trade" ? "引用此笔成交" : "引用收盘未成交"}
          </button>
          <details><summary>证据详情</summary>
            <p>{view.evidence.actor_id} · 事件 {view.evidence.seq} · {view.evidence.value} {view.evidence.unit}</p>
            <p>{view.evidence.engine_version} · 案例 {view.evidence.case_version}</p>
            {explaining && <a href={eventHref(lesson.case_id, view.run_id, view.evidence.seq)}>打开原始事件</a>}
          </details>
        </div>}
      </aside>
    </div>
    <LedgerEvidence view={focus} metric="last_price" actor={actor} seek={seekEvidence} initialOpen={explore}/>
    {explaining && <AuctionStructureTask/>}
  </>;
  return <section className="auction-floor" aria-label="双向拍卖交易大厅">
    <PlaybackController/>
    {explore ? <CompactViews view={focus} actor={actor} seek={seekEvidence}>{world}</CompactViews> : world}
  </section>;
}
