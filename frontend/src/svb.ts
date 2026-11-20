import course from "../../cases/svb_run/case.json" with { type: "json" };
import opening from "./data/svb-opening.json" with { type: "json" };
import { casePackage } from "./domain-contracts.ts";
import { pairedInput } from "./seed-assets.ts";
import type { Actor, Frame, Lesson, LessonEvent, Run } from "./lesson.ts";

const { rules, player_id: playerId } = course;
const buffer = course.scenarios.find(scenario => scenario.id === "liquidity_buffer")!.parameters.cash_reallocation;
const distributed = course.scenarios.find(scenario => scenario.id === "network")!;
export const distributedPolicy = -1;
const player = opening.people.find(person => person.id === playerId)!;
const historyReview = "https://www.federalreserve.gov/publications/2023-April-SVB-Evolution-of-Silicon-Valley-Bank.htm";

type Received = NonNullable<LessonEvent["observed"]>;
export type SvbRun = Run & {
  scenario: "baseline" | "liquidity_buffer" | "network";
  network: Readonly<Record<string, readonly string[]>>;
  observations: readonly Readonly<Record<string, Received>>[];
};

type SvbInput = Omit<typeof opening, "source">;
type SvbParameters = Parameters<Lesson["run"]>[0];
type DepositorBalance = { deposit: number; pending: number; payout: number; protectiveRequested: boolean };
type Checkpoint = {
  tick: number;
  available: number;
  balances: DepositorBalance[];
  queue: { actorId: string; remaining: number }[];
  origins: Map<string, Received[number]>;
};
const checkpoints = new WeakMap<Run, { state: Checkpoint; parameters: SvbParameters; input: SvbInput }>();

export function svbCheckpoint(run: Run, tick: number) {
  const state = checkpoints.get(run)?.state;
  if (state?.tick === tick) return { tick: state.tick, available: state.available };
}

export function forkSvb(parent: SvbRun, tick: number) {
  const source = checkpoints.get(parent);
  if (!source || source.state.tick !== tick) throw new Error("这个轮末没有可暂缓的防御性提款。");
  return runSvb(source.parameters, source.input, { parent, state: source.state });
}

export function simulateSvb(parameters: SvbParameters, input: SvbInput = opening): SvbRun {
  return runSvb(parameters, input);
}

function runSvb({ seed, choices, policy }: SvbParameters, input: SvbInput,
    fork?: { parent: SvbRun; state: Checkpoint }): SvbRun {
  if (seed !== input.seed || !course.action.options.some(option => option.id === choices[0]) ||
      (policy !== 0 && policy !== buffer && policy !== distributedPolicy)) throw new Error("未知开局、行动或政策");

  const scenario = policy === distributedPolicy ? "network" : policy === buffer ? "liquidity_buffer" : "baseline";
  const cashReallocation = scenario === "liquidity_buffer" ? buffer : 0;
  const order = input.distributedOrder;
  const distributedGraph = Object.fromEntries(order.map((id, i) =>
    [id, [-1, -2, 1].map(offset => order[(i + offset + order.length) % order.length])]));
  const people = input.people.map((row, index) => ({
    ...row, neighbors: scenario === "network" ? distributedGraph[row.id] : row.neighbors,
    pending: 0, payout: 0, protectiveRequested: false,
    payrollRound: row.id === playerId ? (choices[0] === "withdraw_now" ? 1 : 2) : row.payrollRound,
    ...fork?.state.balances[index],
  }));
  const initialDeposits = input.people.reduce((sum, person) => sum + person.deposit, 0);
  const loans = initialDeposits + rules.initial_equity - rules.initial_cash - rules.securities * rules.initial_price;
  const parentFrame = fork?.parent.frames[fork.state.tick];
  const ledger = parentFrame?.metrics;
  let cash = ledger?.cash ?? rules.initial_cash + cashReallocation;
  let units = ledger?.units ?? rules.securities - cashReallocation / rules.initial_price;
  let supportCash = ledger?.supportCash ?? rules.support_reserve;
  let marketCash = ledger?.marketCash ?? rules.securities * rules.sale_price;
  let price = ledger?.price ?? rules.initial_price;
  let queued = ledger?.queued ?? 0, requested = ledger?.requested ?? 0, paid = ledger?.paid ?? 0;
  let borrowing = ledger?.borrowing ?? 0, saleLoss = ledger?.sale_loss ?? 0, sold = ledger?.sold ?? 0;
  const frames = fork ? fork.parent.frames.slice(0, fork.state.tick + 1) : [];
  const receivedByRound = fork ? fork.parent.observations.slice(0, fork.state.tick + 1) : [{}];
  let priorSale = parentFrame?.events.some(event => event.kind === "sale") ?? false;
  let queueExplained = frames.some(frame => !!frame.turningPoint);
  const queue = fork?.state.queue.map(entry => ({
    person: people.find(person => person.id === entry.actorId)!, remaining: entry.remaining,
  })) ?? [];
  const origins = new Map(fork?.state.origins);
  let checkpoint: Checkpoint | undefined;
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

  if (!fork) frames.push(snapshot(0, []));
  for (let tick = frames.length; tick <= rules.steps; tick++) {
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
    receivedByRound.push(Object.fromEntries(people.map((person, i) => [person.id, observations[i]])));
    const risk = observations.map(observed => rules.public_risk + observed.length * rules.neighbor_signal + saleTerm + queueTerm);
    const defer = fork?.state.tick === tick - 1;
    if (!fork && !checkpoint && tick > 2) {
      const index = people.findIndex(person => person.id === playerId);
      const person = people[index];
      const available = Math.max(0, person.deposit - person.pending - person.protected);
      if (!person.protectiveRequested && available && risk[index] >= person.threshold) {
        checkpoint = {
          tick: tick - 1, available,
          balances: people.map(({ deposit, pending, payout, protectiveRequested }) => ({ deposit, pending, payout, protectiveRequested })),
          queue: queue.map(({ person, remaining }) => ({ actorId: person.id, remaining })),
          origins: new Map(origins),
        };
      }
    }
    people.forEach((person, index) => {
      const observed = observations[index];
      const neighborTerm = observed.length * rules.neighbor_signal;
      const score = risk[index];
      const free = person.deposit - person.pending;
      const payroll = person.payrollRound === tick ? Math.min(person.payroll, free) : 0;
      const eligible = (person.id !== playerId || tick > 2) && !person.protectiveRequested;
      const available = Math.max(0, free - payroll - person.protected);
      const studentDeferred = defer && person.id === playerId;
      const protective = !studentDeferred && eligible && score >= person.threshold ? available : 0;
      const amount = payroll + protective;
      const signal = `邻居申请 ${observed.map(item => item.actorId).join("、") || "暂无"}；上轮待付 ${priorQueue}${priorSale ? "，发生急售" : "，无急售"}。`;
      const scoreText = `风险分 ${rules.public_risk} + ${neighborTerm} + ${saleTerm} + ${queueTerm} = ${score}，阈值 ${person.threshold}。`;
      const reason = studentDeferred ? "你选择本轮暂缓防御性提款，下一轮重新按规则判断。" : amount ? `申请 ${amount}（工资款 ${payroll}，防御性提款 ${protective}）。` :
        !eligible ? (person.id === playerId && tick <= 2 ?
          "前两轮按你的工资款时点行动，暂不追加防御性提款。" : "已提出过防御性提款，规则只允许一次。") :
        !available ? "本轮没有可再申请的未保障余额。" : "风险分未达阈值，本轮不追加提款。";
      const priorSignal = priorQueue ? { metricId: "queued", tick: tick - 1, value: priorQueue } : undefined;
      messages.set(person.id, { signal, priorSignal, reason: `${reason}${scoreText}`,
        nextDecision: "下一轮重新读取邻居、待付和急售信号。已入队金额按先到先付结算。",
      });
      if (studentDeferred) record({
        actorId: person.id, kind: "decision", text: `${person.id} ${reason} 本轮可申请 ${available} 资金单位。`, deltas: {}, observed,
        sourceEvents: [{ tick: tick - 1, label: "分支从上一轮末开始" }],
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
  const id = fork ? `${fork.parent.id}~fork-v1:${fork.state.tick}:defer-protective` :
    `svb/browser-v1/${seed}/${choices[0]}/${scenario === "network" ? "network" : policy}`;
  const run: SvbRun = { id, seed, frames, scenario,
    network: Object.fromEntries(people.map(person => [person.id, person.neighbors])), observations: receivedByRound };
  if (checkpoint) checkpoints.set(run, { state: checkpoint, parameters: { seed, choices: [...choices], policy }, input });
  return run;
}

const published = casePackage(course.case_id);

export const svbLesson: Lesson = {
  casePackage: published, metricRoles: published.browserMetricRoles,
  title: "银行有资产，工资款为什么还没到账？",
  populationTitle: "教学银行的储户",
  source: {
    kind: published.identity,
    note: "根据硅谷银行事件设计。储户、金额和轮次来自教学模型。课堂中的 20 轮、资金单位与真实的日期、美元金额分别记录。",
    references: [...course.sources.slice(0, 2), { title: "事件经过 · 美联储 2023 年复盘", url: historyReview }],
    timeline: [
      { date: "2023-03-08", text: "银行集团宣布调整资产负债表，包括已售出部分证券及拟筹集股本。", url: historyReview },
      { date: "2023-03-09", text: "美联储复盘记录，当日存款流出超过 400 亿美元。金额为历史美元。", url: historyReview },
      { date: "2023-03-10", text: "加州监管机构关闭银行，指定 FDIC 为接管人。", url: course.sources[0].url },
      { date: "2023-03-12", text: "美国财政部、美联储与 FDIC 宣布保障全部储户，储户可自 3 月 13 日动用全部存款。", url: course.sources[1].url },
    ],
  },
  role: {
    title: "你 · 初创公司财务负责人 D01",
    perspective: "2023 年 3 月 10 日，加州监管机构关闭硅谷银行。美联储复盘将利率风险、存款集中和对未保险存款的依赖列为脆弱因素。现在回到关闭前的教学情境，你需要为下一次发薪准备资金。",
    timeline: [{ label: "第一轮申请" }, { label: "第二轮申请" }, { label: "等候到账", highlighted: true }],
    facts: [{ label: "本企业存款", value: `${player.deposit} 资金单位` },
      { label: "本次工资款", value: `${player.payroll} 资金单位` },
      { label: "本模型保障额度", value: `${player.protected} 资金单位` },
      { label: "你的局部信息", value: "你看得到自身余额、已收到的邻居申请消息和上轮公开状态。申请后等银行结算。" }],
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
    { id: "requested", label: "累计申请", unit: "资金单位", color: "#26666b" },
    { id: "paid", label: "累计实付", unit: "资金单位", color: "#26666b" },
    { id: "sold", label: "累计出售证券", unit: "证券单位", color: "#46516a" },
    { id: "price", label: "证券标价", unit: "资金单位/证券单位", color: "#46516a" },
    { id: "borrowing", label: "支持借款", unit: "资金单位", color: "#46516a" },
    { id: "sale_loss", label: "累计折价损失", unit: "资金单位", color: "#46516a" },
  ],
  bridge: { minTick: 3, metrics: ["cash", "equity", "requested", "paid", "sold", "price", "borrowing"],
    closeLabel: "查看运行收尾", comparisonAxis: "开局及清结算轮末",
    prompt: "对照累计申请、实付与轮末待付。点指标回查原事件，看看银行怎样筹集现金，以及上一轮的待付如何传回储户。",
    rule: "上一轮发生急售或存在待付时，下一轮风险分分别加 14 或 20。是否追加申请还取决于个人阈值和未保障余额。" },
  priceMetric: "price",
  explanationPrompt: "现金组合实验可以引用重估、急售或实付。信息网络实验可以追踪收到消息后提出的申请。区分个体行动规则、待付的算式和两组运行的差异。",
  states: {
    held: { label: "持有存款", color: "#d7ded3" },
    queued: { label: "仍有待付", color: "#f4c16a" },
    paid: { label: "已到账且无待付", color: "#78cdc2" },
  },
  policy: { label: "冲击前改持现金的证券价值", min: 0, max: buffer, step: buffer, baseline: 0,
    unit: "资金单位",
    rangeLabel: "现金组合",
    alternates: [{ value: distributedPolicy, label: distributed.label, description: distributed.description }],
    labels: { [0]: "维持原组合与网络", [buffer]: "提高现金缓冲", [distributedPolicy]: distributed.label },
    project: run => run.frames.map(frame => ({ ...frame, sourceTick: frame.tick,
      axisLabel: frame.tick ? `第 ${frame.tick} 轮末` : "开局" })),
    describe: `将价值 ${buffer} 的证券换成现金。两组初始资产总额和权益相同。政策组可立即动用的现金更多，证券头寸减少，利率敞口也随之降低。对照同时改变开局流动性和利率敞口。比较第 ${rules.steps} 轮末的待付金额。` },
  fork: {
    checkpoint: (run, tick) => !!svbCheckpoint(run, tick),
    run: (run, tick, { action, destination }) => {
      if (action !== "defer-protective" || destination !== undefined) throw new Error("需要有效的储户行动。");
      return forkSvb(run as SvbRun, tick);
    },
  },
  seed: opening.seed,
  prepareSeed: async seed => {
    const inputs = await pairedInput("svb", opening.seed, seed);
    return request => simulateSvb(request, inputs);
  },
  run: simulateSvb,
};
