import course from "../../cases/svb_run/case.json" with { type: "json" };
import opening from "./data/svb-opening.json" with { type: "json" };
import { casePackage } from "./domain-contracts.ts";
import type { Actor, Frame, Lesson, LessonEvent, Run } from "./lesson.ts";

const { rules, player_id: playerId } = course;
const buffer = course.scenarios.find(scenario => scenario.id === "liquidity_buffer")!.parameters.cash_reallocation;
const player = opening.people.find(person => person.id === playerId)!;

export function simulateSvb({ seed, choices, policy }: Parameters<Lesson["run"]>[0]): Run {
  if (seed !== opening.seed || !course.action.options.some(option => option.id === choices[0]) ||
      (policy !== 0 && policy !== buffer)) throw new Error("未知开局、行动或政策");

  const people = opening.people.map(row => ({
    ...row, pending: 0, payout: 0, protectiveRequested: false,
    payrollRound: row.id === playerId ? (choices[0] === "withdraw_now" ? 1 : 2) : row.payrollRound,
  }));
  const initialDeposits = people.reduce((sum, person) => sum + person.deposit, 0);
  const loans = initialDeposits + rules.initial_equity - rules.initial_cash - rules.securities * rules.initial_price;
  let cash = rules.initial_cash + policy;
  let units = rules.securities - policy / rules.initial_price;
  let supportCash = rules.support_reserve;
  let marketCash = rules.securities * rules.sale_price;
  let price = rules.initial_price;
  let queued = 0, requested = 0, paid = 0, borrowing = 0, saleLoss = 0, sold = 0;
  let priorSale = false, queueExplained = false;
  const queue: { person: typeof people[number]; remaining: number }[] = [];
  const origins = new Map<string, NonNullable<LessonEvent["observed"]>[number]>();
  const frames: Frame[] = [];
  const messages = new Map<string, Pick<Actor, "signal" | "reason" | "nextDecision" | "priorSignal">>();

  function snapshot(tick: number, events: readonly LessonEvent[], turningPoint?: string) {
    const deposits = initialDeposits - paid;
    const marketValue = units * price;
    const equity = cash + marketValue + loans - deposits - borrowing;
    const actors: Actor[] = people.map(person => {
      const state = person.pending ? "queued" : person.payout ? "paid" : "held";
      return {
        id: person.id, marker: person.id === playerId ? "你" : person.id.slice(1),
        name: person.id === playerId ? "你 · D01 企业" : `储户 ${person.id}`, state,
        constraint: `存款 ${person.deposit}，保障额度 ${person.protected}，待付 ${person.pending}，已到账 ${person.payout}。`,
        ...(messages.get(person.id) ?? {
          signal: "尚未收到本轮消息。", reason: person.id === playerId ?
            `已选择第 ${person.payrollRound} 轮提交工资款。` : `${person.group}，尚未提交申请。`,
          nextDecision: "到工资款到期轮次提交，并在下一轮按当时的局部信号判断是否追加提款。",
        }),
      };
    });
    return { tick, actors, events, turningPoint, metrics: {
      cash, queued, paid, requested, equity, price, deposits, borrowing, loans, units, sold,
      marketValue, marketCash, supportCash, sale_loss: saleLoss,
    }, equations: [
      `权益 = 现金 ${cash} + 证券市值 ${marketValue} + 贷款 ${loans} − 存款 ${deposits} − 借款 ${borrowing} = ${equity}。`,
      `待付 = 累计申请 ${requested} − 累计实付 ${paid} = ${queued}。`,
    ] };
  }

  frames.push(snapshot(0, []));
  for (let tick = 1; tick <= rules.steps; tick++) {
    const events: LessonEvent[] = [];
    function record(event: Omit<LessonEvent, "id">) {
      const item = { ...event, id: `${tick}/${events.length + 1}` };
      events.push(item);
      return item;
    }
    if (tick === 1) {
      const delta = rules.shocked_price - price;
      price = rules.shocked_price;
      record({ kind: "revaluation", text: `证券标价从 ${rules.initial_price} 降到 ${price}，现金没有变化。`,
        deltas: { price: delta, equity: delta * units } });
    }

    const priorQueue = queued;
    const queueTerm = priorQueue ? rules.queue_signal : 0;
    const saleTerm = priorSale ? rules.sale_signal : 0;
    // Freeze information before this round's first applications.
    const observations = people.map(person => person.neighbors.flatMap(id => {
      const origin = origins.get(id);
      return origin ? [origin] : [];
    }));
    people.forEach((person, index) => {
      const observed = observations[index];
      const neighborTerm = observed.length * rules.neighbor_signal;
      const score = rules.public_risk + neighborTerm + saleTerm + queueTerm;
      const free = person.deposit - person.pending;
      const payroll = person.payrollRound === tick ? Math.min(person.payroll, free) : 0;
      const eligible = (person.id !== playerId || tick > 2) && !person.protectiveRequested;
      const available = Math.max(0, free - payroll - person.protected);
      const protective = eligible && score >= person.threshold ? available : 0;
      const amount = payroll + protective;
      const signal = `邻居申请 ${observed.map(item => item.actorId).join("、") || "暂无"}；上轮待付 ${priorQueue}${priorSale ? "，发生急售" : "，无急售"}。`;
      const scoreText = `风险分 ${rules.public_risk} + ${neighborTerm} + ${saleTerm} + ${queueTerm} = ${score}，阈值 ${person.threshold}。`;
      const reason = amount ? `申请 ${amount}（工资款 ${payroll}，防御性提款 ${protective}）。` :
        !eligible ? (person.id === playerId && tick <= 2 ?
          "前两轮按你的工资款时点行动，暂不追加防御性提款。" : "已提出过防御性提款，规则只允许一次。") :
        !available ? "本轮没有可再申请的未保障余额。" : "风险分未达阈值，本轮不追加提款。";
      const priorSignal = priorQueue ? { metricId: "queued", tick: tick - 1, value: priorQueue } : undefined;
      messages.set(person.id, { signal, priorSignal, reason: `${reason}${scoreText}`,
        nextDecision: "下一轮重新读取邻居、待付和急售信号。已入队金额按先到先付结算。",
      });
      if (!amount) return;
      person.protectiveRequested ||= protective > 0;
      person.pending += amount;
      queued += amount;
      requested += amount;
      queue.push({ person, remaining: amount });
      const effect = protective && queueTerm ?
        (score - queueTerm < person.threshold ? ` 去掉上轮待付项便低于阈值（${score - queueTerm} < ${person.threshold}）。` :
          " 上轮待付计入分数，其他信号已足以达到阈值。") : "";
      const neighborEffect = protective && neighborTerm && score - neighborTerm < person.threshold ?
        ` 去掉已见邻居项便低于阈值（${score - neighborTerm} < ${person.threshold}）。` : "";
      const event = record({
        actorId: person.id, kind: "request", text: `${person.id} ${reason}${scoreText}${effect}${neighborEffect}`,
        deltas: { requested: amount, queued: amount }, observed,
        ...(protective && priorSignal ? { priorSignal } : {}),
      });
      if (!origins.has(person.id)) origins.set(person.id, { actorId: person.id, tick, eventId: event.id });
    });

    if (tick >= rules.support_start_round && queued > cash && supportCash) {
      const draw = Math.min(queued - cash, supportCash);
      cash += draw;
      supportCash -= draw;
      borrowing += draw;
      record({ kind: "support", text: `支持机构借出 ${draw}，现金与借款负债同增，权益不变。`,
        deltas: { cash: draw, borrowing: draw } });
    }

    priorSale = queued > cash && units > 0;
    if (priorSale) {
      const sale = Math.min(units, rules.max_sale_units_per_round, Math.ceil((queued - cash) / rules.sale_price));
      const proceeds = sale * rules.sale_price;
      const loss = sale * (price - rules.sale_price);
      units -= sale;
      sold += sale;
      cash += proceeds;
      marketCash -= proceeds;
      saleLoss += loss;
      record({ kind: "sale", text: `以 ${rules.sale_price} 急售 ${sale} 单位证券，收到 ${proceeds}，权益因折价减少 ${loss}。`,
        deltas: { cash: proceeds, equity: -loss, sale_loss: loss } });
    }
    while (queue.length && cash) {
      const entry = queue[0];
      const amount = Math.min(cash, entry.remaining);
      entry.remaining -= amount;
      entry.person.pending -= amount;
      entry.person.deposit -= amount;
      entry.person.payout += amount;
      cash -= amount;
      paid += amount;
      queued -= amount;
      record({ actorId: entry.person.id, kind: "payment", text: `${entry.person.id} 到账 ${amount}，现金与存款负债同减。`,
        deltas: { cash: -amount, deposits: -amount, paid: amount, queued: -amount } });
      if (!entry.remaining) queue.shift();
    }

    const frame = snapshot(tick, events);
    if (queued && !queueExplained) {
      frame.turningPoint = `首次出现轮末待付 ${queued}。银行现金为 ${cash}，权益为 ${frame.metrics.equity}` +
        (frame.metrics.equity > 0 ? "，此时权益仍为正" : "");
      queueExplained = true;
    }
    frames.push(frame);
  }
  return { id: `svb/browser-v1/${seed}/${choices[0]}/${policy}`, seed, frames };
}

const published = casePackage(course.case_id);

export const svbLesson: Lesson = {
  casePackage: published, metricRoles: published.browserMetricRoles,
  title: "银行有资产，工资款为什么还没到账？",
  populationTitle: "教学银行的储户",
  source: {
    kind: published.identity,
    note: "根据硅谷银行事件设计。储户、金额和轮次来自教学模型。",
    references: course.sources.slice(0, 2),
  },
  role: {
    title: "你 · 初创公司财务负责人 D01",
    perspective: "2023 年 3 月 10 日，加州监管机构关闭硅谷银行。美联储复盘将利率风险、存款集中和对未保险存款的依赖列为脆弱因素。现在回到关闭前的教学情境，你需要为下一次发薪准备资金。",
    timeline: [{ label: "第一轮申请" }, { label: "第二轮申请" }, { label: "等候到账", highlighted: true }],
    facts: [{ label: "本企业存款", value: `${player.deposit} 资金单位` },
      { label: "本次工资款", value: `${player.payroll} 资金单位` }],
  },
  decisions: [
    { prompt: "你会在哪一轮申请工资款？", options: course.action.options.map((option, index) => ({
      ...option, response: `本企业会在第 ${index + 1} 轮提交 ${player.payroll} 资金单位的工资款申请。`,
    })) },
    { prompt: "就这笔工资款，你预计银行现金什么时候减少？", options: [
      { id: "at-request", label: "提交申请时", response: "已记录预测。下一阶段对比申请和实付事件。" },
      { id: "at-payment", label: "实际支付时", response: "已记录预测。下一阶段对比申请和实付事件。" },
    ] },
  ],
  metrics: [
    { id: "queued", label: "待付金额", unit: "资金单位", color: "#26666b" },
    { id: "cash", label: "银行现金", unit: "资金单位", color: "#26666b" },
    { id: "equity", label: "银行权益", unit: "资金单位", color: "#46516a" },
    { id: "price", label: "证券标价", unit: "每单位", color: "#46516a" },
  ],
  bridge: { minTick: 3, metrics: ["cash", "equity", "price"],
    rule: "上一轮发生急售或存在待付时，下一轮风险分分别加 14 或 20。是否追加申请还取决于个人阈值和未保障余额。" },
  priceMetric: "price",
  states: {
    held: { label: "持有存款", color: "#d7ded3" },
    queued: { label: "仍有待付", color: "#f4c16a" },
    paid: { label: "已到账且无待付", color: "#78cdc2" },
  },
  policy: { label: "冲击前改持现金的证券价值", min: 0, max: buffer, step: buffer, baseline: 0,
    unit: "资金单位",
    describe: `将价值 ${buffer} 的证券换成现金。两组初始资产总额和权益相同。政策组可立即动用的现金更多，承受重估的证券更少。比较第 ${rules.steps} 轮末的待付金额。` },
  seed: opening.seed,
  run: simulateSvb,
};
