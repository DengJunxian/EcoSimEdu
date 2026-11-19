import course from "../../cases/double_auction/case.json" with { type: "json" };
import boundaries from "../../cases/boundaries.json" with { type: "json" };
import opening from "./data/auction-opening.json" with { type: "json" };
import { casePackage } from "./domain-contracts.ts";
import type { Actor, Frame, Lesson, LessonEvent, Run } from "./lesson.ts";

type Side = "buy" | "sell";
type Account = { side: Side; marginals: number[]; cash: number; goods: number; filled: number };
type Order = { order_id: string; actor_id: string; side: Side; price: number; quantity: 1 };
type RecordEvent = {
  seq: number; tick: number; event_type: string; round?: number; actor_id?: string; order_id?: string;
  side?: Side; price?: number; quantity?: 1; source?: "student" | "rule"; reference_price?: number | null;
  buyer_id?: string; seller_id?: string; buy_order_id?: string; sell_order_id?: string; maker_order_id?: string;
  buyer_surplus?: number; seller_surplus?: number; platform_fee?: number;
};
export type AuctionFrame = Frame & {
  record: RecordEvent;
  book: readonly Order[];
  accounts: Readonly<Record<string, Pick<Account, "cash" | "goods" | "filled">>>;
};
export type AuctionRun = Omit<Run, "frames"> & {
  frames: readonly AuctionFrame[];
  market: "base" | "boundary";
  bid: number;
  fee: number;
  demandShift: number;
  ceiling: number;
  quotes: Readonly<Record<string, Order>>;
};

export const boundarySpec = boundaries.double_auction;
const paidFee = course.scenarios.find(row => row.id === "fee")!.fee;
const demandScenario = course.scenarios.find(row => row.id === "demand")!;
export const demandPolicy = -1;

export function simulateAuction({ seed, choices, policy }: Parameters<Lesson["run"]>[0], boundary = false): AuctionRun {
  const bid = Number(choices[0]);
  const baseShift = boundary ? boundarySpec.parameters.demand_shift : 0;
  const higherDemand = !boundary && policy === demandPolicy;
  if (seed !== opening.seed || !Number.isInteger(bid) || bid < 1 || bid > course.player_value + baseShift ||
      (policy !== 0 && policy !== paidFee && !higherDemand)) throw new Error("未知开局、限价或费用");
  const shift = higherDemand ? demandScenario.demand_shift : baseShift;
  const fee = higherDemand ? 0 : policy;

  const agents: Record<string, Account> = Object.fromEntries(Object.entries(opening.accounts).map(([id, data]) => {
    const side = data.side as Side;
    return [id, { ...data, side, marginals: data.marginals.map(value => value + (side === "buy" ? shift : 0)) }];
  }));
  const demand = Object.values(agents).filter(actor => actor.side === "buy").flatMap(actor => actor.marginals)
    .sort((a, b) => b - a);
  const supply = Object.values(agents).filter(actor => actor.side === "sell").flatMap(actor => actor.marginals)
    .sort((a, b) => a - b);
  const ceiling = demand.reduce((total, value, index) => total + Math.max(0, value - (supply[index] ?? value)), 0);
  const standing = new Map<string, Order>();
  const active = new Map<string, Order>();
  const entered = new Set<string>();
  const quotes: Record<string, Order> = {};
  const states: Record<string, Pick<Actor, "signal" | "reason" | "priorSignal">> = {};
  const frames: AuctionFrame[] = [];
  let last: { price: number; tick: number } | undefined;
  let volume = 0, surplus = 0, platform = 0;
  let observedBook = false;

  function emit(event: Omit<RecordEvent, "seq" | "tick">, detail: Omit<LessonEvent, "id">, tradedPrice: number | null = null) {
    const tick = frames.length;
    const book = [...standing.values()];
    const bids = book.filter(order => order.side === "buy");
    const asks = book.filter(order => order.side === "sell");
    const bestBid = bids.length ? Math.max(...bids.map(order => order.price)) : null;
    const bestAsk = asks.length ? Math.min(...asks.map(order => order.price)) : null;
    const prior = frames.at(-1)?.metrics;
    const deltas = { ...detail.deltas };
    if (bestBid !== null && typeof prior?.best_bid === "number") deltas.best_bid = bestBid - prior.best_bid;
    if (bestAsk !== null && typeof prior?.best_ask === "number") deltas.best_ask = bestAsk - prior.best_ask;
    let turningPoint: string | undefined;
    if (event.event_type === "trade" && volume === 1) turningPoint = `首次成交 ${tradedPrice} 代币，找到买卖两张订单`;
    if (boundary && !observedBook && bestBid !== null && bestAsk !== null && bestBid < bestAsk) {
      turningPoint = `最高买价 ${bestBid} 低于最低卖价 ${bestAsk}，两边都挂单但没有成交`;
      observedBook = true;
    }
    frames.push({
      tick, record: { ...event, seq: tick, tick }, book,
      accounts: Object.fromEntries(Object.entries(agents).map(([id, { cash, goods, filled }]) => [id, { cash, goods, filled }])),
      actors: Object.entries(agents).map(([id, actor]) => ({
        id, name: id === course.player_id ? "你 · 买家 B01" : `${actor.side === "buy" ? "买家" : "卖家"} ${id}`,
        marker: id === course.player_id ? "你" : id,
        state: active.has(id) ? "standing" : actor.filled ? "filled" : "ready",
        constraint: `现金 ${actor.cash} 代币，持有 ${actor.goods} 件，已成交 ${actor.filled} 件。`,
        ...(states[id] ?? { signal: "尚无成交价可参照。", reason: "等待本方提交报价。" }),
        nextDecision: id === course.player_id ? "这张限价单会留到成交或收盘。" :
          "轮到自己时按可交易数量、下一件的价值或成本，以及最近成交价决定报价。",
      })),
      metrics: {
        volume, price: tradedPrice, best_bid: bestBid, best_ask: bestAsk, surplus,
        platform_cash: platform, participant_surplus: surplus - platform, efficiency: ceiling ? surplus / ceiling : null,
      },
      events: [{ ...detail, deltas, id: String(tick) }],
      turningPoint,
    });
  }

  function cancel(order: Order, round: number) {
    standing.delete(order.order_id);
    active.delete(order.actor_id);
    states[order.actor_id] = { signal: `原限价 ${order.price} 代币。`,
      reason: round === course.rounds ? "收到收盘撤单通知，本单未成交。" : "轮到重新报价，撤销先前留在簿上的订单。" };
    emit({ event_type: "order_cancelled", actor_id: order.actor_id, order_id: order.order_id, round },
      { actorId: order.actor_id, kind: "cancel", text: `${order.actor_id} 撤回 ${order.order_id}。`, deltas: {} });
  }

  function quote(actorId: string, price: number, source: "student" | "rule", round: number) {
    const actor = agents[actorId];
    const reference = source === "rule" ? last : undefined;
    const marginal = actor.marginals[actor.filled];
    const orderId = `O${String(frames.length).padStart(3, "0")}`;
    const legal = actor.side === "buy" ? price > 0 && price + fee <= Math.min(marginal, actor.cash) :
      price - fee >= marginal && actor.goods > 0;
    const record: RecordEvent = { seq: 0, tick: 0, event_type: legal ? "order_submitted" : "order_rejected",
      actor_id: actorId, order_id: orderId, side: actor.side, price, quantity: 1, source, round,
      reference_price: reference?.price ?? null };
    const priorSignal = reference ? { metricId: "price", tick: reference.tick, value: reference.price } : undefined;
    const verb = actor.side === "buy" ? "买入" : "卖出";
    const reason = legal ? `提交一件的${verb}限价 ${price} 代币。` :
      price <= 0 ? "规则报价不是正数，订单被拒绝。" :
        `限价 ${price} 代币与费用不符合本角色的报价约束，订单被拒绝。`;
    const signal = reference ? `最近成交价 ${reference.price} 代币，来自事件 ${reference.tick}。` :
      "本次报价没有先前成交价输入。";
    states[actorId] = { signal, reason, priorSignal };

    const order: Order = { order_id: orderId, actor_id: actorId, side: actor.side, price, quantity: 1 };
    if (legal) {
      entered.add(actorId);
      quotes[orderId] = order;
      standing.set(orderId, order);
      active.set(actorId, order);
    }
    emit(record, { actorId, kind: legal ? "quote" : "reject", text: `${actorId} ${reason}`, deltas: {}, priorSignal });
    if (!legal) return;

    const candidates = [...standing.values()].filter(maker => maker.side !== order.side &&
      (order.side === "buy" ? maker.price <= order.price : maker.price >= order.price));
    candidates.sort((a, b) => order.side === "buy" ? a.price - b.price : b.price - a.price);
    const maker = candidates[0];
    if (!maker) return;
    const [buy, sell] = order.side === "buy" ? [order, maker] : [maker, order];
    const paid = maker.price;
    const buyer = agents[buy.actor_id], seller = agents[sell.actor_id];
    const buyerSurplus = buyer.marginals[buyer.filled] - paid - fee;
    const sellerSurplus = paid - fee - seller.marginals[seller.filled];
    const delta = buyerSurplus + sellerSurplus + 2 * fee;
    buyer.cash -= paid + fee;
    seller.cash += paid - fee;
    buyer.goods++;
    seller.goods--;
    buyer.filled++;
    seller.filled++;
    for (const item of [buy, sell]) {
      standing.delete(item.order_id);
      active.delete(item.actor_id);
      states[item.actor_id] = { signal: `收到成交回报。`,
        reason: `${item.order_id} 以 ${paid} 成交。在簿订单 ${maker.order_id} 给出结算价。` };
    }
    volume++;
    surplus += delta;
    platform += 2 * fee;
    last = { price: paid, tick: frames.length };
    emit({ event_type: "trade", round, buyer_id: buy.actor_id, seller_id: sell.actor_id,
      buy_order_id: buy.order_id, sell_order_id: sell.order_id, maker_order_id: maker.order_id, price: paid, quantity: 1,
      buyer_surplus: buyerSurplus, seller_surplus: sellerSurplus, platform_fee: 2 * fee },
    { actorId: buy.actor_id, counterpartyId: sell.actor_id, focusMetrics: ["price"], kind: "trade",
      text: `${buy.order_id} 与 ${sell.order_id} 按在簿单 ${maker.order_id} 的 ${paid} 代币成交。`,
      deltas: { volume: 1, surplus: delta, platform_cash: 2 * policy, participant_surplus: delta - 2 * policy } }, paid);
  }

  emit({ event_type: "market_open" }, { text: "市场开盘，当前订单簿为空。", deltas: {} });
  quote(course.player_id, bid, "student", 0);
  opening.rounds.forEach((turn, round) => {
    for (const [id, noise] of turn as [string, number][]) {
      const actor = agents[id];
      if (actor.filled === actor.marginals.length) continue;
      const previous = active.get(id);
      if (previous) cancel(previous, round);
      const marginal = actor.marginals[actor.filled];
      const shade = Math.floor(noise / (round + 1));
      const boundary = actor.side === "buy" ? Math.min(marginal, actor.cash) - fee : marginal + fee;
      const refPrice = last?.price ?? boundary;
      const price = actor.side === "buy" ? Math.min(boundary, refPrice + 2) - shade : Math.max(boundary, refPrice - 2) + shade;
      quote(id, price, "rule", round);
    }
  });
  for (const actorId of entered) {
    const order = active.get(actorId);
    if (order) cancel(order, course.rounds);
  }
  emit({ event_type: "market_close" }, { text: "市场收盘，尚未成交的订单全部撤回。", deltas: {} });

  const market = boundary ? "boundary" : "base";
  return { id: `double-auction/browser-v1/${seed}/${market}/${bid}/${higherDemand ? "demand" : policy}`,
    seed, frames, market, bid, fee, demandShift: shift, ceiling, quotes };
}

export function roundEnds(run: Run): readonly Frame[] {
  const frames = (run as AuctionRun).frames;
  const aligned = [frames[0]];
  for (let round = 0; round < course.rounds; round++) {
    const last = frames.filter(frame => frame.record.round === round).at(-1) ?? aligned.at(-1)!;
    aligned.push({ ...last, tick: round + 1 });
  }
  aligned.push({ ...frames.at(-1)!, tick: course.rounds + 1 });
  return aligned;
}

export function auctionLesson(boundary: boolean): Lesson {
  const published = casePackage(course.case_id);
  const value = course.player_value + (boundary ? boundarySpec.parameters.demand_shift : 0);
  return {
    title: boundary ? "买卖两边都报价，为什么没有成交？" : "你的报价会以什么价格成交？",
    populationTitle: "二手教材市场的买家与卖家",
    role: {
      title: "你 · 二手教材买家 B01",
      perspective: "你只买一本教材。报出你愿意接受的最高成交价。这张单会保留到成交或收盘。",
      facts: [{ label: "这本书对你的价值", value: `${value} 代币` },
        { label: "你手里的现金", value: `${course.initial_cash} 代币` }],
      timeline: [{ label: "提交限价" }, { label: "等待或成交", highlighted: true }, { label: "收盘撤单" }],
    },
    casePackage: published, metricRoles: published.browserMetricRoles,
    source: { kind: published.identity, note: "Vernon L. Smith 的原实验让参与者依据私人价值或成本反复公开竞价。这里使用教学买家 B01、规则报价和浏览器生成的撮合记录。",
      references: course.sources },
    decisions: [
      { prompt: "你愿意报出多少？", amount: { label: "开局限价", min: 1, max: value,
        suggested: boundary ? boundarySpec.bid : course.preset_bid, unit: "代币" } },
      { prompt: "按你提交的这个限价，你会在收盘前买到书吗？", options: [
        { id: "yes", label: "会成交", response: "已记录预测，回放时找你的买单。" },
        { id: "no", label: "不会成交", response: "已记录预测，回放时查看买单停在哪里。" },
        { id: "unknown", label: "还不确定", response: "已记录预测，先观察其他人的报价。" },
      ] },
    ],
    metrics: [
      { id: "volume", label: "成交量", unit: "件", color: "#26666b" },
      { id: "price", label: "成交价", unit: "代币/件", color: "#26666b" },
      { id: "best_bid", label: "最高买价", unit: "代币", color: "#46516a" },
      { id: "best_ask", label: "最低卖价", unit: "代币", color: "#46516a" },
    ],
    states: {
      ready: { label: "没有在簿单", color: "#d7ded3" },
      standing: { label: "有在簿单", color: "#f4c16a" },
      filled: { label: "已有成交", color: "#78cdc2" },
    },
    bridge: { minTick: 3, metrics: ["best_bid", "best_ask", "volume"],
      rule: "价格优先，同价先到优先。交叉时用已经在簿的订单定价。",
      prompt: "播放到关键事件，核对造成变化的报价。成交以后，下一张自动报价可以引用刚成交的价格。",
      closeLabel: "快进到收盘" },
    tickUnit: "event",
    policy: { label: "每件成交时每方缴费", min: 0, max: paidFee, step: paidFee, baseline: 0, unit: "代币",
      rangeLabel: "成交收费",
      alternates: boundary ? undefined : [{ value: demandPolicy, label: demandScenario.label,
        description: `买方各单位估值增加 ${demandScenario.demand_shift} 代币。卖方成本、种子和你的原始限价保持相同，交易费为 0。` }],
      project: roundEnds, describe: "保留同一种子和你的原始限价。收费改变买家的总支出和卖家的净收入，费用转入平台。" },
    seed: opening.seed,
    run: input => simulateAuction(input, boundary),
  };
}
