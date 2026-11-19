import opening from "../data/classroom-inputs.json" with { type: "json" };
import { Recorder, ids, profiles, recordOf, sum } from "./record.ts";

type Account = { cash: number; shares: number; debt?: number };
type Side = "buy" | "sell";
type Order = { actor: string; side: Side; price: number; quantity: number; seq: number; id: string };

class TradeTape {
  readonly log;
  readonly orders = new Map<string, Order>();
  time = 0;
  last: number | null = null;
  low: number | null = null;
  high: number | null = null;
  volume = 0;
  readonly accounts;
  readonly extra;
  readonly notes;

  constructor(accounts: Record<string, Account>, extra: () => Record<string, number>,
    constraints: Record<string, string>, notes: Record<string, string> = {}) {
    this.accounts = accounts;
    this.extra = extra;
    this.notes = notes;
    const participants = Object.keys(accounts);
    const people = profiles(participants, "限价买单须有足够现金，卖单须有已到账股票", "按价格优先、时间优先与在簿价格撮合");
    for (const actor of Object.keys(constraints)) people[actor].constraint = constraints[actor];
    this.log = new Recorder(participants, people);
  }

  best(side: Side) {
    let result: Order | undefined;
    for (const order of this.orders.values()) {
      if (order.side === side && (!result || (side === "buy" ? order.price > result.price : order.price < result.price))) result = order;
    }
    return result;
  }

  free(actor: string, side: Side) {
    let available = side === "buy" ? this.accounts[actor].cash : this.accounts[actor].shares;
    for (const order of this.orders.values()) {
      if (order.actor === actor && order.side === side) available -= side === "buy" ? order.quantity * order.price : order.quantity;
    }
    return available;
  }

  emit(kind: string, text: string, actors: string[], data?: object, turningPoint?: string,
    signal?: NonNullable<Parameters<Recorder["emit"]>[3]>["signal"]) {
    const record = data as { buy_order_id?: string; sell_order_id?: string; origin_seq?: number } | undefined;
    const sourceEvents = [record?.buy_order_id, record?.sell_order_id].flatMap(order =>
      order ? [{ tick: Number(order.slice(1)), label: `回查原订单 ${order}` }] : []);
    if (record?.origin_seq !== undefined) sourceEvents.push({ tick: record.origin_seq, label: `回查源事件 ${record.origin_seq}` });
    const bid = this.best("buy"), ask = this.best("sell");
    const orders = [...this.orders.values()];
    return this.log.emit(kind, text, {
      last_price: this.last === null ? null : this.last / 100,
      low_price: this.low === null ? null : this.low / 100, high_price: this.high === null ? null : this.high / 100,
      volume: this.volume, bid_depth: sum(orders.filter(order => order.side === "buy").map(order => order.quantity)),
      ask_depth: sum(orders.filter(order => order.side === "sell").map(order => order.quantity)),
      spread: ask && bid ? (ask.price - bid.price) / 100 : null, ...this.extra(),
    }, { period: this.time, actors, data, turningPoint, signal, sourceEvents,
      evidence: kind === "inventory_limit" || kind === "margin_call" ?
        [{ actorId: actors[0], focusMetrics: [kind === "inventory_limit" ? "bid_depth" : "last_price"], text, deltas: {} }] : undefined,
      entities: recordOf(Object.keys(this.accounts), actor => ({
        现金美元: this.accounts[actor].cash / 100, 现有股数: this.accounts[actor].shares,
        买单占用美元: (this.accounts[actor].cash - this.free(actor, "buy")) / 100,
        卖单占用股数: this.accounts[actor].shares - this.free(actor, "sell"),
        ...(this.accounts[actor].debt === undefined ? {} : { 借券交还义务: this.accounts[actor].debt! }),
        ...(this.notes[actor] ? { 已知信息: this.notes[actor] } : {}),
      })),
    });
  }

  cancel(id: string) {
    const order = this.orders.get(id)!;
    this.orders.delete(id);
    this.emit("cancel", `${order.actor} 达到库存限制，撤回 ${order.quantity} 股买单。`, [order.actor],
      { order_id: id, quantity: order.quantity, origin_seq: order.seq });
  }

  submit(actor: string, side: Side, price: number, quantity: number, purpose: string,
    immediate = false, filled?: (quantity: number) => void) {
    const other = side === "buy" ? "sell" : "buy";
    const crosses = (resting: Order) => side === "buy" ? price >= resting.price : price <= resting.price;
    const context = { quantity, side, price_cents: price, purpose };
    if ((side === "buy" ? quantity * price : quantity) > this.free(actor, side)) {
      this.emit("reject", `${actor} 的订单超过可用资金或股票。`, [actor], context);
      return 0;
    }
    if ([...this.orders.values()].some(order => order.actor === actor && order.side === other && crosses(order))) {
      this.emit("reject", `${actor} 的订单会触及自身挂单。`, [actor], context);
      return 0;
    }
    const sequence = this.log.frames.length;
    const id = `O${sequence}`;
    this.emit("order_submitted", `${actor} 提交${side === "buy" ? "买" : "卖"}单 ${quantity} 股，限价 ${(price / 100).toFixed(2)} 美元，${purpose}。`, [actor],
      { order_id: id, ...context });
    let remainder = quantity;
    for (let maker = this.best(other); remainder && maker && crosses(maker); maker = this.best(other)) {
      const amount = Math.min(remainder, maker.quantity), value = amount * maker.price;
      const buyer = side === "buy" ? actor : maker.actor, seller = side === "sell" ? actor : maker.actor;
      this.accounts[buyer].cash -= value;
      this.accounts[buyer].shares += amount;
      this.accounts[seller].cash += value;
      this.accounts[seller].shares -= amount;
      remainder -= amount;
      maker.quantity -= amount;
      if (!maker.quantity) this.orders.delete(maker.id);
      const mark = maker.price;
      this.last = mark;
      this.low = Math.min(this.low ?? mark, mark);
      this.high = Math.max(this.high ?? mark, mark);
      this.volume += amount;
      filled?.(amount);
      this.emit("trade", `${buyer} 向 ${seller} 买入 ${amount} 股，按在簿单 ${maker.id} 的 ${(mark / 100).toFixed(2)} 美元成交。`, [buyer, seller], {
        price_cents: mark, quantity: amount, buyer, seller, maker_id: maker.id,
        buy_order_id: side === "buy" ? id : maker.id, sell_order_id: side === "sell" ? id : maker.id, purpose,
      });
    }
    if (remainder) {
      if (immediate) this.emit("unfilled", `${actor} 有 ${remainder} 股未成交，立即撤销余量。`, [actor],
        { order_id: id, quantity: remainder, purpose });
      else {
        this.orders.set(id, { id, actor, side, price, quantity: remainder, seq: sequence });
        this.emit("rest", `${actor} 的 ${remainder} 股挂在订单簿上。`, [actor], { order_id: id, quantity: remainder });
      }
    }
    return quantity - remainder;
  }
}

export const maker = "做市者 0（学生）";
const makers = [maker, "做市者 1", "做市者 2", "做市者 3", "做市者 4"];

export function flashCrash(seed: number, action: string, scenario: string, withdraw: boolean, input = opening) {
  const buyers = ids("被动买家 ", 17, 0);
  const sellers = ids("被动卖家 ", 17, 0);
  const program = "卖出程序";
  const accounts = recordOf([...makers, ...buyers, ...sellers], () => ({ cash: 250_000, shares: 55 }));
  accounts[program] = { cash: 0, shares: sum(input.flashCrash) };
  const limits = recordOf(makers, (_, i) => i === 0 ? action === "tight" ? 12 : 30 : 16);
  const notes: Record<string, string> = {};
  const constraints = recordOf(makers, id => withdraw ? `净增库存达到 ${limits[id]} 股后撤回剩余买量` : "本实验取消达到库存阈值后的撤单");
  let executed = 0, queued = 0;
  const tape = new TradeTape(accounts, () => ({ program_filled: executed, program_queued: queued }), constraints, notes);
  tape.emit("opening", `卖出程序已经获得本场计划释放的 ${accounts[program].shares} 股。`, [program, maker],
    { plan_shares: accounts[program].shares });
  for (const [index, actor] of makers.entries()) {
    for (const price of [998 - index * 2, 978 - index * 2]) tape.submit(actor, "buy", price, 18, "做市买量");
  }
  for (const [i, actor] of buyers.entries()) {
    tape.submit(actor, "buy", 959 - 5 * i, 6, "被动买量");
    tape.submit(sellers[i], "sell", 1002 + i * 2, 4, "被动卖量");
  }
  tape.submit(buyers[0], "buy", 1002, 1, "冲击前成交", true);
  const withdrawn = new Set<string>();
  for (let time = 1; time <= 200; time++) {
    tape.time = time;
    const amount = (time - 55) % 4 === 0 ? input.flashCrash[(time - 55) / 4] : undefined;
    if (amount) {
      queued += amount;
      tape.emit("release", `程序在第 ${time} 步释放 ${amount} 股卖出计划。`, [program], { quantity: amount },
        time === 55 ? "集中卖出开始，买方深度即将被消耗" : undefined);
    }
    if (queued) {
      const executable = queued;
      queued = 0;
      tape.submit(program, "sell", 100, executable, "固定卖出程序", true, amount => { executed += amount; });
      if (withdraw) {
        for (const id of makers) {
          const excess = accounts[id].shares - 55;
          if (excess < limits[id] || withdrawn.has(id)) continue;
          withdrawn.add(id);
          const orders = [...tape.orders.values()].filter(order => order.actor === id).map(order => order.id);
          notes[id] = `净增库存 ${excess} 股，已触发撤单`;
          tape.emit("inventory_limit", `${id} 净增 ${excess} 股已达 ${limits[id]} 股阈值，撤回剩余买量。`, [id],
            { excess, limit: limits[id], active_orders: orders },
            withdrawn.size === 1 ? "首个做市者触及库存阈值" : undefined);
          for (const order of orders) tape.cancel(order);
        }
      }
    }
    if (time === 160) {
      for (const id of buyers.slice(-4)) tape.submit(id, "buy", 982, 5, "恢复阶段被动买量");
      tape.submit(sellers.at(-1)!, "sell", 970, 2, "恢复阶段试成交", true);
    }
    tape.emit("period_end", `模型步 ${time} 结束。`, [program, maker]);
  }
  return tape.log.run("flash_crash", seed, action, scenario);
}

const dealers = ids("报价者 ", 4, 1, 1);
const values = ids("估值投资者 ", 4, 1, 1);
const momentum = ids("趋势投资者 ", 4, 1, 1);
const followers = ids("关注投资者 ", 5, 1, 1);
const retail = "学生投资者", borrower = "借券账户", lender = "出借账户";

export function gamestop(seed: number, action: string, scenario: string, socialWeight: number, input = opening) {
  const accounts: Record<string, Account> = recordOf([...dealers, ...values, ...momentum, ...followers, retail], actor =>
    ({ cash: 16_000, shares: dealers.includes(actor) ? 28 : 4 }));
  accounts[borrower] = { cash: 14_000, shares: 0, debt: 0 };
  accounts[lender] = { cash: 0, shares: 18 };
  const { network, storyActors } = input.gamestop;
  const successor = recordOf(network, (_, i) => network[(i + 1) % network.length]);
  const stories = [1, 4, 8].map((time, index) =>
    ({ time, tone: index < 2 ? 1 : -1, actor: storyActors[index], message_id: `N${time}` }));
  const seen = recordOf(followers, (): Record<string, number> => ({}));
  const notes: Record<string, string> = {};
  let covers = 0, buys = 0, social = 0;
  const tape = new TradeTape(accounts, () => ({ short_interest: accounts[borrower].debt!, forced_cover: covers,
    discretionary_buys: buys, social_buys: social, reach: followers.filter(id => Object.keys(seen[id]).length).length }),
    { [borrower]: "成交价估值，抵押现金低于 170% 维持要求时回补",
      ...recordOf(followers, () => socialWeight ? "净正面关注度决定买量，最多 2 股" : "取消消息对下单的权重") }, notes);
  function buy(actor: string, quantity: number, limit: number, purpose: string) {
    const funded = Math.min(quantity, Math.floor(tape.free(actor, "buy") / limit));
    if (funded) tape.submit(actor, "buy", limit, funded, purpose, true, amount => {
      buys += amount;
      if (purpose === "转发关注") social += amount;
    });
  }
  const short = accounts[borrower], custodian = accounts[lender];
  tape.emit("opening", "共 20 个账户。现金、在手股票、借券义务分别记账。", [borrower, lender, retail]);
  for (const [index, actor] of dealers.entries()) tape.submit(actor, "buy", 998 - 3 * index, 8, "盘初被动买量");
  [1002, 1045, 1090, 1145, 1210, 1290, 1380, 1490, 1620, 1780].forEach((price, index) =>
    tape.submit(dealers[index % dealers.length], "sell", price, 4, "盘初被动卖量"));
  short.shares += 10;
  short.debt = 10;
  custodian.shares -= 10;
  tape.emit("loan", "出借账户交付 10 股，借券账户登记等量交还义务。", [lender, borrower], { quantity: 10, debt: 10 });
  const remainder = 10 - tape.submit(borrower, "sell", 100, 10, "借券卖出", true);
  function returnShares(amount: number) {
    if (!amount) return;
    short.shares -= amount;
    short.debt! -= amount;
    custodian.shares += amount;
    tape.emit("return", `借券账户交还 ${amount} 股，义务剩余 ${short.debt} 股。`, [borrower, lender],
      { quantity: amount, remaining_debt: short.debt });
  }
  returnShares(remainder);
  type Notice = { story: typeof stories[number]; actor: string; origin: number };
  let pending: Notice[] = [];
  let close = tape.last ?? 1000, change = 0, priceSource: number | undefined;
  for (let time = 1; time <= 10; time++) {
    tape.time = time;
    for (const story of stories.filter(story => story.time === time)) {
      const origin = tape.emit("message", `${story.message_id} 是本轮公开的教学话题。`, [story.actor],
        { message_id: story.message_id, tone: story.tone });
      pending.push({ story, actor: story.actor, origin });
    }
    const notices = pending;
    pending = [];
    for (const notice of notices) {
      const { story, actor, origin } = notice;
      const key = story.message_id;
      if (key in seen[actor]) continue;
      seen[actor][key] = story.tone;
      notes[actor] = Object.keys(seen[actor]).join("、");
      tape.emit("forward", `${actor} 收到 ${key}，来源为事件 ${origin}。`, [actor],
        { message_id: key, origin_seq: origin, tone: story.tone });
      pending.push({ story, actor: successor[actor], origin });
    }
    if (time === 1) {
      tape.emit("student", action === "buy" ? "你选择提交小额买单。" : "你选择保留现金。", [retail], { action });
      if (action === "buy") buy(retail, 2, 1200, "学生自主买入");
    }
    for (const id of values) {
      const ask = tape.best("sell");
      if (ask && ask.price <= 1020) buy(id, 1, 1020, "估值买入");
    }
    for (const id of momentum) {
      notes[id] = `上一轮成交价净变动 ${change} 美分，35 美分才触发跟进`;
      if (change >= 35) buy(id, 1, 2000, "价格趋势买入");
    }
    for (const id of followers) {
      const attention = sum(Object.values(seen[id])) * socialWeight;
      if (attention > 0) buy(id, Math.min(attention, 2), 2000, "转发关注");
    }
    const mark = tape.last ?? 1000;
    const debt = short.debt!;
    if (debt && short.cash * 100 < 170 * debt * mark) {
      const prior = tape.log.frames.at(-1)!;
      const value = prior.metrics.last_price;
      tape.emit("margin_call", `成交价为 ${mark / 100} 美元时，${debt} 股的交还义务触发担保要求。`, [borrower, lender],
        { mark_cents: mark, debt, collateral_cents: short.cash }, covers === 0 ? "成交价格触发回补要求" : undefined,
        typeof value === "number" ? { metricId: "last_price", tick: prior.tick, value } : undefined);
      const limit = Math.min(19900, Math.floor(short.cash / debt));
      if (limit < 100) tape.emit("cover_blocked", "抵押现金不足以提交覆盖全部义务的限价买单。", [borrower, lender],
        { debt, collateral_cents: short.cash });
      else returnShares(tape.submit(borrower, "buy", limit, debt, "强制回补", true, amount => { covers += amount; }));
    }
    const nextClose = tape.last ?? 1000;
    change = nextClose - close;
    close = nextClose;
    tape.emit("period_end", `第 ${time} 轮结束，最近成交 ${nextClose / 100} 美元。`, [borrower, lender, retail],
      { change, priceSource });
    priceSource = tape.log.frames.length - 1;
  }
  return tape.log.run("gamestop", seed, action, scenario);
}
