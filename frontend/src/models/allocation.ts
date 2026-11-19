import opening from "../data/classroom-inputs.json" with { type: "json" };
import { Recorder, ids, profiles, recordOf, roundEven, shown, sum } from "./record.ts";

export function carbon(seed: number, action: string, scenario: string, cap: number, input = opening) {
  const firms = ids("F", input.firms.length);
  const registry = "登记簿";
  const participants = [...firms, registry];
  const people = profiles(participants, "每张配额覆盖 1 吨排放，须按登记簿中的持有量缴回",
    "按最低边际成本选减排，正短缺者转入配额");
  people[registry].state = "institution";
  const log = new Recorder(participants, people);
  const e0 = recordOf(firms, (_, i) => input.firms[i][0]);
  const intensity = recordOf(firms, (_, i) => input.firms[i][1]);
  const baseline = sum(Object.values(e0));
  const required = Math.max(0, baseline - cap);
  const marginal = firms.flatMap(firm => Array.from({ length: e0[firm] }, (_, i) =>
    ({ cost: intensity[firm] * (2 * i + 1), firm }))).sort((a, b) => a.cost - b.cost || a.firm.localeCompare(b.firm));
  const plan = recordOf(firms, () => 0);
  for (const row of marginal.slice(0, required)) plan[row.firm]++;
  const price = required ? marginal[required - 1].cost / 2 : 0;
  const emissions = recordOf(firms, firm => e0[firm] - plan[firm]);
  const cost = recordOf(firms, firm => intensity[firm] * plan[firm] ** 2 / 2);
  const allot = recordOf(firms, firm => Math.floor(cap * e0[firm] / baseline));
  const ranked = [...firms].sort((a, b) => cap * e0[b] % baseline - cap * e0[a] % baseline || a.localeCompare(b));
  for (const firm of ranked.slice(0, cap - sum(Object.values(allot)))) allot[firm]++;
  const shifted = Math.min(+action, allot.F08);
  allot.F01 += shifted;
  allot.F08 -= shifted;
  let permitIndex = 1;
  const permits = recordOf(firms, firm => {
    const owned = ids("A", allot[firm], permitIndex, 4);
    permitIndex += owned.length;
    return owned;
  });
  const paid = recordOf(firms, () => 0);
  const surrendered = recordOf(firms, (): string[] => []);
  let moved = 0, phase = 0;
  function record(event: string, text: string, actors: string[], data: object = {},
    evidence?: NonNullable<Parameters<Recorder["emit"]>[3]>["evidence"], turningPoint?: string) {
    log.emit(event, text, {
      cap, planned_emissions: phase ? sum(Object.values(emissions)) : null,
      abatement_cost: phase ? sum(Object.values(cost)) : null, price: phase >= 2 ? price : null,
      permits_moved: moved, surrendered: sum(firms.map(firm => surrendered[firm].length)),
    }, { actors, period: phase, data, evidence, turningPoint, entities: {
      ...recordOf(firms, firm => ({ 基准排放: e0[firm], 成本系数: intensity[firm], 免费配额: allot[firm],
        计划减排: phase ? plan[firm] : null, 计划排放: phase ? emissions[firm] : null, 方案减排成本: phase ? cost[firm] : null,
        持有配额: permits[firm].length, 已缴回配额: surrendered[firm].length, 配额净支付: paid[firm] })),
      [registry]: { 发行: cap, 待缴回配额: sum(firms.map(firm => permits[firm].length)),
        已缴回: sum(firms.map(firm => surrendered[firm].length)) },
    } });
  }
  record("issuance", `登记簿发行 ${cap} 张，依你的选择从 F08 向 F01 调整 ${shifted} 张。`, firms,
    { issue: recordOf(firms, firm => [...permits[firm]]) });
  phase = 1;
  record("phase_end", `各企业实际计划共减排 ${required} 吨，计划排放 ${cap} 吨。`, firms, { abatement: plan, emissions },
    firms.map(firm => ({ actorId: firm, focusMetrics: ["planned_emissions", "abatement_cost"], deltas: {},
      text: `${firm} 计划减排 ${plan[firm]} 吨，剩余排放 ${emissions[firm]} 吨，成本 ${cost[firm]} 代币。` })),
    "企业完成减排安排");
  phase = 2;
  const sellers = firms.filter(firm => permits[firm].length > emissions[firm]);
  for (const buyer of firms) {
    for (const seller of sellers) {
      const quantity = Math.min(emissions[buyer] - permits[buyer].length, permits[seller].length - emissions[seller]);
      if (quantity <= 0) continue;
      const transferred = permits[seller].splice(-quantity);
      permits[buyer].push(...transferred);
      const payment = price * quantity;
      paid[buyer] += payment;
      paid[seller] -= payment;
      moved += quantity;
      record("transfer", `${seller} 转给 ${buyer} ${quantity} 张，净付 ${payment} 代币。`, [buyer, seller],
        { buyer, seller, permits: transferred, payment });
    }
  }
  record("phase_end", `累计转移 ${moved} 张，清算价为 ${price} 代币每张。`, [registry]);
  phase = 3;
  for (const firm of firms) {
    const quantity = emissions[firm];
    if (permits[firm].length < quantity) throw new Error("Insufficient permits to settle");
    surrendered[firm] = permits[firm].splice(0, quantity);
    record("surrender", `${firm} 缴回 ${quantity} 张，覆盖同量实际排放。`, [firm, registry],
      { firm, emissions: quantity, permits: surrendered[firm] });
  }
  record("phase_end", `办理缴回，${shown(cap - sum(Object.values(emissions)))} 张未使用。`, [registry]);
  return log.run("carbon_market", seed, action, scenario);
}

const roles = ["零售商", "批发商", "分销商", "工厂"];
const variance = (series: number[]) => {
  const mean = sum(series) / series.length;
  return sum(series.map(value => (value - mean) ** 2)) / series.length;
};

type Batch = { sender: string; receiver: string; amount: number; sent: number; due: number; origin_seq?: number };

export function beer(seed: number, action: string, scenario: string, shared: boolean) {
  const demand = Array.from({ length: 40 }, (_, i) => i < 4 ? 4 : 8);
  const stock = recordOf(roles, () => 12), backlog = recordOf(roles, () => 0);
  const forecast = recordOf(roles, () => 4), outstanding = recordOf(roles, (_, i) => i < 3 ? 12 : 8);
  let batches: Batch[] = roles.flatMap((role, i) => [1, 2].map(week =>
    ({ sender: roles[i + 1] ?? "生产", receiver: role, amount: 4, sent: week - 2, due: week })));
  let pending = [4, 4, 4], delivered = 0, produced = 0, cost = 0;
  const orderHistory: number[] = [];
  const log = new Recorder(roles, profiles(roles, "运输与生产需两周，下单后下一周才传到上游",
    shared ? "订单公式读取共同终端需求及本环节库存" : "订单公式读取本环节收到的需求及库存"));
  log.emit("opening", "四个环节各有 12 件库存，在途货物和已下订单按不同的时钟到达。", {
    retail_stock: 12, retail_backlog: 0, factory_order: null, in_transit: 32, total_cost: 0, factory_variance_ratio: null,
  }, { period: 0, entities: recordOf(roles, role => ({ 期初库存: stock[role], 已订未到: outstanding[role] })),
    data: { initial_batches: batches, arrivals: [], dispatches: [], orders: null, demand_received: null,
      production: null, in_transit_batches: batches, delivered: 0, produced: 0 } });
  for (const [index, consumer] of demand.entries()) {
    const week = index + 1;
    const receipts = batches.filter(batch => batch.due === week);
    batches = batches.filter(batch => batch.due > week);
    const arrivals = recordOf(roles, role => sum(receipts.filter(batch => batch.receiver === role).map(batch => batch.amount)));
    const received = [consumer, ...pending];
    const outgoing: Batch[] = [];
    for (const [i, role] of roles.entries()) {
      const available = stock[role] + arrivals[role];
      const due = backlog[role] + received[i];
      const ship = Math.min(available, due);
      stock[role] = available - ship;
      backlog[role] = due - ship;
      if (i === 0) delivered += ship;
      else if (ship) outgoing.push({ sender: role, receiver: roles[i - 1], amount: ship, sent: week, due: week + 2, origin_seq: week });
    }
    const ordered = recordOf(roles, (role, i) => {
      const signal = shared ? consumer : received[i];
      forecast[role] = .35 * signal + .65 * forecast[role];
      outstanding[role] -= arrivals[role];
      const lag = role === "工厂" ? 2 : 3;
      let units = Math.max(0, roundEven(forecast[role] + .55 * (12 - (stock[role] - backlog[role])) +
        .15 * (forecast[role] * (lag - 1) - outstanding[role])));
      if (i === 0 && week === 5) units = +action;
      if (role === "工厂") units = Math.min(units, 20);
      outstanding[role] += units;
      return units;
    });
    const product = ordered["工厂"];
    orderHistory.push(product);
    produced += product;
    if (product) outgoing.push({ sender: "生产", receiver: "工厂", amount: product, sent: week, due: week + 2, origin_seq: week });
    batches.push(...outgoing);
    pending = roles.slice(0, 3).map(role => ordered[role]);
    const costs = sum(Object.values(stock)) + 2 * sum(Object.values(backlog));
    cost += costs;
    const external = variance(demand.slice(0, week));
    log.emit("week_end", `第 ${week} 周终端需求 ${consumer} 件，零售下单 ${ordered["零售商"]} 件，工厂投产 ${product} 件。`, {
      retail_stock: stock["零售商"], retail_backlog: backlog["零售商"], factory_order: product,
      in_transit: sum(batches.map(batch => batch.amount)), total_cost: cost / 2,
      factory_variance_ratio: external ? variance(orderHistory) / external : null,
    }, { period: week, actors: roles, turningPoint: week === 5 ? "终端需求由 4 件增至 8 件" : undefined,
      entities: recordOf(roles, (role, i) => ({ 期末库存: stock[role], 期末积压: backlog[role], 已订未到: outstanding[role],
        本周到货: arrivals[role], 本周下单: ordered[role], 本周实际需求: received[i],
        下单采用需求信号: shared ? consumer : received[i], 需求预测: shown(forecast[role]) })),
      evidence: roles.map((role, i) => ({ actorId: role, ...(i < 3 ? { counterpartyId: roles[i + 1] } : {}),
        deltas: { total_cost: (stock[role] + 2 * backlog[role]) / 2 },
        sourceEvents: receipts.filter(batch => batch.receiver === role && batch.origin_seq !== undefined)
          .map(batch => ({ tick: batch.origin_seq!, label: `回查 ${batch.sender} 先前发出 ${batch.amount} 件` })),
        text: `${role} 本周需求 ${received[i]} 件、实际到货 ${arrivals[role]} 件、本周下单 ${ordered[role]} 件，期末积压 ${backlog[role]} 件。` })),
      data: { arrivals: receipts, dispatches: outgoing, orders: ordered, production: product,
        demand_received: recordOf(roles, (_, i) => received[i]), delivered, produced, in_transit_batches: [...batches] },
    });
  }
  return log.run("beer_game", seed, action, scenario);
}
