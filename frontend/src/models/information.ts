import opening from "../data/classroom-inputs.json" with { type: "json" };
import { Recorder, ids, profiles, recordOf, shown, sum, type Metrics } from "./record.ts";

export function lemons(seed: number, action: string, scenario: string, fee: number, input = opening) {
  const sellers = ids("S", input.qualities.length);
  const people = [...sellers, "B01"];
  const quality = recordOf(sellers, (_, i) => input.qualities[i]);
  const stock = sellers.filter(id => id !== "S01" || action === "list");
  const visible = stock.filter(id => scenario === "certified" && quality[id] >= 5 * fee);
  const certified = new Set(visible);
  let pool = stock.filter(id => !certified.has(id));
  const log = new Recorder(people, profiles(people, "卖方底价为其质量，买方最高愿付为质量的 1.2 倍",
    "卖方在报价覆盖卖方底价和核验费时愿售"));
  const metrics: Metrics = { quoted_pool_price: null, willing_quality: null, willing_supply: stock.length,
    traded: 0, certification_cost: 0, net_surplus: null };
  const entities = (willing: string[], expose: boolean, settled = false) => ({
    ...recordOf(sellers, id => ({ 挂牌: stock.includes(id), 当前愿售: willing.includes(id),
      ...(expose && certified.has(id) ? { 核验质量: quality[id], 个别报价: 6 * quality[id] / 5 } : {}),
      ...(settled ? { 复盘质量: quality[id], 实际成交: willing.includes(id) } : {}),
    })),
    B01: { 已知挂牌数: stock.length, 可见单件质量数: expose ? visible.length : 0 },
  });
  log.emit("market_open", `30 位卖家各持一件商品，${stock.length} 位挂牌。`, metrics,
    { actors: ["S01", "B01"], entities: entities(stock, false), data: { listed: stock.length } });
  if (visible.length) {
    metrics.certification_cost = visible.length * fee;
    log.emit("certification", `${visible.length} 件通过核验并离开混合池，费用合计 ${metrics.certification_cost} 代币。`, metrics,
      { actors: visible, entities: entities(stock, true), data: { certified: visible, fee } });
  }
  let price: number | null = null;
  let iteration = 0;
  while (true) {
    const total = sum(pool.map(id => quality[id]));
    price = pool.length ? 6 * total / (5 * pool.length) : null;
    const next = pool.filter(id => quality[id] * 5 * pool.length <= 6 * total);
    const exits = pool.filter(id => !next.includes(id));
    const willing = [...visible, ...next];
    const previousQuote = metrics.quoted_pool_price;
    const source = log.frames.length - 1;
    Object.assign(metrics, { quoted_pool_price: price, willing_quality: willing.length ? sum(willing.map(id => quality[id])) / willing.length : null,
      willing_supply: willing.length });
    log.emit("offer_iteration", price === null ? "混合池无商品，此轮只有核验报价。" :
      `混合池按上轮可报价集合的平均质量计算暂定价 ${shown(price)}，${next.length} 件愿售，${exits.length} 件退出。`, metrics, {
      actors: exits.length ? exits : ["B01"], entities: entities(willing, true),
      sourceEvents: typeof previousQuote === "number" ? [{ tick: source, label: "回查上轮愿售集合" }] : undefined,
      turningPoint: iteration++ === 0 ? "混合池首次更新报价与愿售集合" : undefined,
      evidence: exits.map(id => ({ actorId: id, text: `${id} 的保留价 ${quality[id]} 高于本轮报价 ${shown(price!)}，退出。`,
        deltas: { willing_supply: -1 } })),
      data: { quote: price, exited: exits, willing_pool: next },
    });
    pool = next;
    if (!exits.length) break;
  }
  const sold = [...visible, ...pool];
  const transactions = sold.map(id => {
    const paid = certified.has(id) ? 6 * quality[id] / 5 : price!;
    const cost = certified.has(id) ? fee : 0;
    return { seller: id, buyer: "B01", quality_revealed_for_review: quality[id], price: paid,
      seller_gain: paid - quality[id] - cost, buyer_gain: 6 * quality[id] / 5 - paid, certification_cost: cost };
  });
  Object.assign(metrics, { traded: sold.length, net_surplus: sum(sold.map(id => quality[id])) / 5 - (metrics.certification_cost ?? 0) });
  log.emit("settlement", `一次性交割 ${sold.length} 件，扣除核验费后的净剩余 ${shown(metrics.net_surplus!)} 代币。`, metrics,
    { actors: sold, entities: entities(sold, true, true), data: { transactions },
      evidence: transactions.map(row => ({ actorId: row.seller, counterpartyId: "B01", text: `${row.seller} 实际交割，支付价 ${shown(row.price)} 代币。`,
        deltas: { traded: 1 } })) });
  return { ...log.run("lemons_market", seed, action, scenario), marketInput: { quality, stock } };
}

const probability = (power: number) => Math.round(1e6 * 2 ** power / (1 + 2 ** power)) / 1e4;
const positive = (signal: string) => signal === "A" ? 1 : -1;

export function cascade(seed: number, action: string, scenario: string, observed: boolean, input = opening) {
  const people = ids("D", 12);
  const log = new Recorder(people, profiles(people, "抽样准确率 2/3，贝叶斯策略在平局时跟随私信号",
    "轮到自己时才收到私信号"));
  let oddsPower = 0, cascadeCount = 0, revealing = 0, start: number | null = null, correct = 0;
  const metrics = (score: number | null = null) => ({
    public_a_pct: probability(oddsPower), cascade_decisions: cascadeCount,
    cascade_start: start, revealing_decisions: revealing, correct_pct: score,
  });
  log.emit("experiment_open", "A、B 两箱的开局先验各为 50%。", metrics());
  for (const [index, actor] of people.entries()) {
    const signal = input.cascade.signals[index];
    const policy = index === 2 ? action : "bayes";
    const choose = (draw: string) => {
      if (policy === "private_signal") return draw;
      if (policy === "force_a" || policy === "force_b") return policy === "force_a" ? "A" : "B";
      const power = oddsPower + positive(draw);
      return power === 0 ? draw : power > 0 ? "A" : "B";
    };
    const a = choose("A"), b = choose("B"), choice = choose(signal);
    const before = probability(oddsPower);
    const privateAfter = probability(oddsPower + positive(signal));
    const isCascade = policy === "bayes" && a === b;
    if (isCascade) {
      cascadeCount++;
      start ??= index + 1;
    }
    if (observed && a !== b) {
      oddsPower += positive(signal);
      revealing++;
    }
    if (choice === input.cascade.state) correct++;
    const after = probability(oddsPower);
    const text = `${actor} 选择 ${choice}。${!observed ? "本次选择不公开。" :
      a === b ? "两种私信号给出同一选择，公开后验保持不变。" : `公开的 A 箱概率更新为 ${after}%。`}`;
    log.emit("decision", text, metrics(), {
      actors: [actor],
      entities: { [actor]: { 私人抽样: signal, 策略: policy, 行动: choice, 私有后验: privateAfter,
        若收到A: a, 若收到B: b, 行动前公开A概率: before, 行动后公开A概率: after } },
      signal: policy === "bayes" ? { metricId: "public_a_pct", tick: index, value: before } : undefined,
      turningPoint: start === index + 1 ? "第一次出现信息级联" : undefined,
      data: { signal, choice, policy, choice_if_private_a: a, choice_if_private_b: b, public_a_before_pct: before,
        public_a_after_pct: after, private_a_after_pct: privateAfter, cascade: isCascade, information_added: before !== after },
    });
  }
  log.emit("reveal", `真实箱子为 ${input.cascade.state}，12 人中 ${correct} 人猜对。`,
    metrics(Math.round(correct / 12 * 1e6) / 1e4), { data: { state: input.cascade.state, correct_count: correct } });
  return { ...log.run("information_cascade", seed, action, scenario), publishedActions: observed };
}

export function matching(seed: number, action: string, scenario: string, immediate: boolean, additionalA: number, input = opening) {
  const { preferences, priorities } = input.schools;
  const students = Object.keys(preferences);
  const schools = ["A", "B", "C"];
  const capacity = { A: 4 + additionalA, B: 4, C: 4 } as Record<string, number>;
  const submitted = { ...preferences, ...(action === "safe_first" ? { S01: ["B", "A", "C"] } : {}) } as Record<string, string[]>;
  const truePreferences = preferences as Record<string, string[]>;
  const ranks = priorities as Record<string, string[]>;
  const next = recordOf(students, () => 0);
  const held = recordOf(schools, (): string[] => []);
  const assigned = () => Object.fromEntries(schools.flatMap(school => held[school].map(id => [id, school])));
  const people = [...students, ...schools];
  const rules = profiles(people, "每校按自身优先序及剩余容量处理依序提交的申请",
    immediate ? "已经确认的录取席位不再重排" : "新申请者与暂留者一起重排");
  for (const school of schools) rules[school].state = "institution";
  const log = new Recorder(people, rules);
  const metrics: Metrics = { applications: 0, rejections: 0, first_true_choice: null, student_true_rank: null,
    submitted_blocking_pairs: null, true_blocking_pairs: null };
  function entities() {
    const placements = assigned();
    return { ...recordOf(students, id => ({ 提交志愿: submitted[id].join(" > "), 真实偏好: truePreferences[id].join(" > "),
      当前席位: placements[id] ?? "尚未匹配" })),
      ...recordOf(schools, id => ({ 容量: capacity[id], 席位名单: held[id].join("、") || "空", 优先序: ranks[id].join(" > ") })) };
  }
  log.emit("admissions_open", "12 位学生和 3 所学校提交志愿与优先序。", metrics, { actors: ["S01"], entities: entities(),
    period: 0, data: { submitted, capacities: capacity } });
  const application = new Map<string, number>();
  let round = 1;
  for (;; round++) {
    const placements = assigned();
    const applying = students.filter(id => !placements[id] && next[id] < submitted[id].length);
    if (!applying.length) break;
    const proposals = recordOf(applying, id => submitted[id][next[id]++]);
    metrics.applications! += applying.length;
    for (const id of applying) application.set(`${id}|${proposals[id]}`, log.frames.length);
    log.emit("round_proposals", `第 ${round} 轮收到 ${applying.length} 份申请。`, metrics, {
      actors: applying, period: round, entities: entities(), data: { proposals },
      evidence: applying.map(id => ({ actorId: id, counterpartyId: proposals[id], text: `${id} 向 ${proposals[id]} 申请。`,
        deltas: { applications: 1 } })),
    });
    const rejected: { student: string; school: string; priority_rank: number; was_held: boolean; cutoff: number[] }[] = [];
    for (const school of schools) {
      const before = held[school];
      const kept = immediate ? before : [];
      const ordered = [...applying.filter(id => proposals[id] === school), ...(immediate ? [] : before)]
        .sort((a, b) => ranks[school].indexOf(a) - ranks[school].indexOf(b));
      const available = capacity[school] - kept.length;
      held[school] = [...kept, ...ordered.slice(0, available)];
      for (const id of ordered.slice(available)) rejected.push({ student: id, school, priority_rank: ranks[school].indexOf(id) + 1,
        was_held: before.includes(id), cutoff: held[school].map(other => ranks[school].indexOf(other) + 1) });
    }
    metrics.rejections! += rejected.length;
    log.emit("round_resolution", `第 ${round} 轮处理后，${Object.keys(assigned()).length} 人获席位，本轮 ${rejected.length} 份申请被拒绝。`, metrics,
      { actors: rejected.map(row => row.student), period: round, entities: entities(), data: { held: { ...held }, rejected },
        turningPoint: round === 1 ? "首轮申请完成排序" : undefined,
        evidence: rejected.map(row => ({ actorId: row.student, counterpartyId: row.school, text:
          `${row.school} 拒绝 ${row.student}，该生名次 ${row.priority_rank}，席位所占名次 ${row.cutoff.join("、")}。`, deltas: { rejections: 1 },
          sourceEvents: [{ tick: application.get(`${row.student}|${row.school}`)!, label: `回查 ${row.student} 的申请` }] })),
      });
  }
  const placements = assigned();
  function blocking(preferences: Record<string, string[]>) {
    return students.flatMap(student => {
      const current = preferences[student].indexOf(placements[student]);
      const preferred = current < 0 ? preferences[student] : preferences[student].slice(0, current);
      return preferred.filter(school => held[school].length < capacity[school] ||
        held[school].some(other => ranks[school].indexOf(other) > ranks[school].indexOf(student)))
        .map(school => ({ student, school }));
    });
  }
  const submittedBlocks = blocking(submitted), trueBlocks = blocking(truePreferences);
  const firsts = students.filter(id => placements[id] === truePreferences[id][0]);
  Object.assign(metrics, { first_true_choice: firsts.length, student_true_rank: placements.S01 ? truePreferences.S01.indexOf(placements.S01) + 1 : null,
    submitted_blocking_pairs: submittedBlocks.length, true_blocking_pairs: trueBlocks.length });
  log.emit("final_assignment", `${Object.keys(placements).length} 人分到学校，${firsts.length} 人到真实第一志愿；S01 到 ${placements.S01 ?? "未分配"}。`, metrics, {
    actors: firsts, period: round, entities: entities(), data: { assignments: placements, submitted_blocking: submittedBlocks, true_blocking: trueBlocks },
    evidence: firsts.map(id => ({ actorId: id, counterpartyId: placements[id], focusMetrics: ["first_true_choice"], deltas: {},
      text: `${id} 获真实第一志愿 ${placements[id]}。` })),
  });
  return { ...log.run("school_matching", seed, action, scenario), matchingInput: { truePreferences, submitted, ranks, capacity } };
}
