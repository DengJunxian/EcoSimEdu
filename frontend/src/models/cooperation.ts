import opening from "../data/classroom-inputs.json" with { type: "json" };
import { Recorder, ids, profiles, recordOf, roundEven, shown, sum, type Entity, type Metrics } from "./record.ts";

export function publicGoods(seed: number, action: string, scenario: string, cost: number | null, input = opening) {
  const players = ids("P", 4, 1, 1);
  const pool = "公共池";
  const participants = [...players, pool];
  const roles = ["学生", "条件合作者", "自利策略", "规范维护者"];
  const people = profiles(participants, "每轮 20 代币，公共池每增加 1 代币，每人获得 0.4", "按策略及上一轮观察选择贡献");
  people[pool].state = "institution";
  const log = new Recorder(participants, people, true);
  const metrics = { contributions: 0, total_contributions: 0, net_income: 0, sanction_cost: 0 };
  const balance = recordOf(players, () => 0);
  let fines = recordOf(players, () => 0);
  let prior: Record<string, number> | undefined;
  const displayed: Entity = recordOf(players, (_, i) => ({ 策略: roles[i], 累计净收益: 0 }));
  log.emit("start", "四位参与者入组，每人每轮有 20 代币。", metrics, { entities: displayed, period: 0 });
  for (const [index, noise] of input.publicGoods.noise.entries()) {
    const round = index + 1;
    const contributions = recordOf(players, (actor, i) => {
      if (!index && !i) return +action;
      let target = input.publicGoods.targets[i];
      if (prior) {
        const peers = (sum(Object.values(prior)) - prior[actor]) / 3;
        if (i < 2) target = roundEven((target + peers) / 2);
        if (fines[actor] > 0) target += 3;
      }
      return Math.max(0, Math.min(20, target + noise[i]));
    });
    const total = sum(Object.values(contributions));
    const previous = metrics.contributions;
    metrics.contributions = total;
    metrics.total_contributions += total;
    for (const player of players) displayed[player] = { ...displayed[player], 本轮贡献: contributions[player] };
    displayed[pool] = { 本轮收到: total, 累计收到: metrics.total_contributions, 每人公共回报: total * 2 / 5 };
    log.emit("contributions", `第 ${round} 轮同时公开：公共池收到 ${total} 代币，每人获得 ${total * 2 / 5}。`, metrics, {
      period: round, actors: players, entities: displayed, data: { contributions, public_return: total * 2 / 5 },
      evidence: players.map(id => ({ actorId: id, counterpartyId: pool, text: `${id} 投入 ${contributions[id]} 代币。`,
        deltas: { total_contributions: contributions[id], contributions: contributions[id] - (prior?.[id] ?? 0) },
        priorSignal: index && (id === "P1" || id === "P2") ? { metricId: "contributions", tick: log.frames.length - 1, value: previous } : undefined })),
    });
    const sanctionable = cost === null ? [] : players.slice(0, 3).filter(actor => contributions[actor] < 8);
    const points = cost ? Math.min(2, Math.floor(4 / cost)) : 0;
    const outgoing = recordOf(players, actor => actor === "P4" ? sanctionable.length * points * (cost ?? 0) : 0);
    const gross = recordOf(players, actor => (20 - contributions[actor]) * 5 + total * 2);
    fines = recordOf(players, actor => sanctionable.includes(actor) ? Math.min(points * 15, gross[actor] - outgoing[actor] * 5) : 0);
    const net = recordOf(players, actor => gross[actor] - outgoing[actor] * 5 - fines[actor]);
    for (const actor of players) {
      balance[actor] += net[actor];
      displayed[actor] = { ...displayed[actor], 惩罚前收益: gross[actor] / 5, 施罚成本: outgoing[actor],
        受罚扣损: fines[actor] / 5, 本轮净收益: net[actor] / 5, 累计净收益: balance[actor] / 5 };
    }
    metrics.net_income = sum(Object.values(balance)) / 5;
    metrics.sanction_cost += sum(Object.values(outgoing)) + sum(Object.values(fines)) / 5;
    log.emit("settlement", `第 ${round} 轮群体净收益 ${sum(Object.values(net)) / 5} 代币，定向惩罚 ${sanctionable.length} 笔。`, metrics, {
      actors: players, period: round, entities: displayed,
      turningPoint: round === 1 ? "首轮个体贡献汇入公共池并结算" : undefined,
      data: { net: recordOf(players, actor => net[actor] / 5), outgoing,
        fines: recordOf(players, actor => fines[actor] / 5) },
      panelData: { gross: recordOf(players, actor => gross[actor] / 5),
        sanctions: sanctionable.map(actor => ({ from: "P4", to: actor, points, cost: points * (cost ?? 0),
          fine: fines[actor] / 5 })) },
      evidence: players.map(id => ({ actorId: id, text: `${id} 保留收入加公共回报，再扣施罚及受罚损失，得 ${net[id] / 5} 代币。`,
        deltas: { net_income: net[id] / 5, sanction_cost: outgoing[id] + fines[id] / 5 } })),
    });
    prior = contributions;
  }
  return log.run("public_goods", seed, action, scenario);
}

export function commons(seed: number, action: string, scenario: string, limited: boolean, input = opening) {
  const users = ids("F", 24);
  const stockId = "水域";
  const participants = [...users, stockId];
  const people = profiles(participants, limited ? "统一限额每期每人 1 单位" : "取用量受可取库存约束",
    "常规计划按期初库存与取用能力计算");
  people[stockId].state = "institution";
  const log = new Recorder(participants, people, true);
  let stock = 180, income = 0;
  const metrics: Metrics = { stock, harvest: null, growth: null, income, monitoring_cost: 0 };
  const displayed: Entity = recordOf(users, (_, i) => ({ 取用能力: input.commons.users[i][0], 初始规则信任: input.commons.users[i][1] }));
  log.emit("start", "水域初始存量 180 单位，24 位使用者共享，承载量 240。", metrics, {
    period: 0, entities: { ...displayed, [stockId]: { 存量: stock, 承载量: 240 } },
  });
  for (let period = 1; period <= 12; period++) {
    const before = stock;
    const previousFrame = log.frames.length - 1;
    const plans = recordOf(users, (_, i) => period === 1 && !i ? +action :
      Math.max(1, roundEven(input.commons.users[i][0] * before / 180)));
    const requests = recordOf(users, actor => limited ? Math.min(1, plans[actor]) : plans[actor]);
    const demand = sum(Object.values(requests));
    const share = demand ? Math.min(before / demand, 1) : 0;
    const allocations = recordOf(users, actor => requests[actor] * share);
    const harvest = Math.min(before, sum(Object.values(allocations)));
    const remaining = before - harvest;
    const growth = 0.55 * remaining * (1 - remaining / 240);
    income += harvest * 2;
    for (const actor of users) displayed[actor] = { ...displayed[actor], 期初库存: before,
      计划取用: plans[actor], 获准申请: requests[actor], 实际取用: allocations[actor], 本期净收入: allocations[actor] * 2 };
    Object.assign(metrics, { stock: remaining, harvest, growth: null, income });
    log.emit("withdrawal", `第 ${period} 期取用 ${shown(harvest)} 单位，取用后剩 ${shown(remaining)}。`, metrics, {
      period, actors: users, turningPoint: period === 1 ? "个体取用汇总为资源下降" : undefined,
      entities: { ...displayed, [stockId]: { 存量: remaining, 承载量: 240 } },
      evidence: users.map(id => ({ actorId: id, counterpartyId: stockId, text:
        `${id} 申请 ${requests[id]} 单位，实际取得 ${shown(allocations[id])} 单位。`,
        deltas: { stock: -allocations[id], income: 2 * allocations[id] },
        priorSignal: { tick: previousFrame, metricId: "stock", value: before } })),
      data: { start_stock: before, remaining_stock: remaining, allocations, requests, plans },
    });
    stock = remaining + growth;
    Object.assign(metrics, { stock, growth });
    log.emit("growth", `剩余 ${shown(remaining)} 单位再生 ${shown(growth)}，下期初存量 ${shown(stock)}。`, metrics, {
      period, actors: [stockId], entities: { [stockId]: { 存量: stock, 承载量: 240, 当期再生: growth } },
      data: { remaining_stock: remaining, growth, next_stock: stock },
    });
  }
  return log.run("commons_governance", seed, action, scenario);
}
