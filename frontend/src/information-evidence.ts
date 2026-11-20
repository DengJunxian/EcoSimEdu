import { displayNumber, type Frame, type Run } from "./lesson.ts";
import type { cascade, lemons, matching } from "./models/information.ts";
import type { ModelRun } from "./models/record.ts";

export type SchoolRun = ReturnType<typeof matching>;
export type MarketRun = ReturnType<typeof lemons>;
export type CascadeRun = ReturnType<typeof cascade>;
export type InformationRun = SchoolRun | MarketRun | CascadeRun;
type RecordRow = ModelRun["records"][number];

export type Refusal = { student: string; school: string; priority_rank: number; was_held: boolean; cutoff: number[] };
type Assignments = Record<string, string>;
export type MatchEnd = { assignments: Assignments; submitted_blocking: { student: string; school: string }[];
  true_blocking: { student: string; school: string }[] };
export type Offer = { quote: number | null; exited: string[]; willing_pool: string[] };
type Transaction = { seller: string; buyer: string; quality_revealed_for_review: number; price: number;
  seller_gain: number; buyer_gain: number; certification_cost: number };
export type Decision = { signal: string; choice: string; policy: string; choice_if_private_a: string; choice_if_private_b: string;
  public_a_before_pct: number; public_a_after_pct: number; private_a_after_pct: number; cascade: boolean; information_added: boolean };
type WithData<T> = Omit<RecordRow, "data"> & { data: T };

function records<T>(run: ModelRun, tick: number, kind: string) {
  return run.records.slice(0, tick + 1).filter(row => row.event_type === kind) as WithData<T>[];
}

export function schoolsAt(run: SchoolRun, tick: number) {
  const applications = records<{ proposals: Assignments }>(run, tick, "round_proposals");
  const resolves = records<{ held: Record<string, string[]>; rejected: Refusal[] }>(run, tick, "round_resolution");
  const latest = resolves.at(-1);
  const final = records<MatchEnd>(run, tick, "final_assignment").at(-1)?.data;
  const schools = Object.keys(run.matchingInput.capacity).map(id => ({
    id, held: latest?.data.held[id] ?? [], status: final ? "录取" : run.scenario === "immediate" ? "确认" : "暂留",
    capacity: run.matchingInput.capacity[id], ranks: run.matchingInput.ranks[id],
  }));
  const refusals = resolves.flatMap(row => row.data.rejected.map(rejection => ({
    ...rejection, tick: row.seq, round: row.period,
    application: applications.filter(item => item.seq < row.seq && item.data.proposals[rejection.student] === rejection.school).at(-1),
  })));
  return { schools, applications, refusals, final, latestApplications: applications.at(-1), current: run.records[tick] };
}

export function marketAt(run: MarketRun, tick: number) {
  const { quality, stock } = run.marketInput;
  const offers = records<Offer>(run, tick, "offer_iteration");
  const exits = new Map(offers.flatMap(row => row.data.exited.map(seller => [seller, row] as const)));
  const verified = new Set(records<{ certified: string[] }>(run, tick, "certification").flatMap(row => row.data.certified));
  const settlement = records<{ transactions: Transaction[] }>(run, tick, "settlement").at(-1);
  const distribution = Object.fromEntries([1, 2, 3, 4, 5].map(level => [level, stock.filter(seller => quality[seller] === level).length]));
  const transactions = new Map(settlement?.data.transactions.map(trade => [trade.seller, trade]));
  const sellers = Object.keys(quality).map(id => ({
    id, exit: exits.get(id), quality: id === "S01" || verified.has(id) || !!settlement ? quality[id] : undefined,
    transaction: transactions.get(id),
    state: !stock.includes(id) ? "未挂牌" : exits.has(id) ? "已退出" :
      settlement ? transactions.has(id) ? "已交割" : "未成交" : verified.has(id) ? "已核验" : offers.length ? "当前愿售" : "等待报价",
  }));
  return { offers, distribution, sellers, verified, settlement, current: run.records[tick] };
}

export function actionsAt(run: CascadeRun, tick: number) {
  const decisions = records<Decision>(run, tick, "decision");
  const reveal = records<{ state: string; correct_count: number }>(run, tick, "reveal").at(-1)?.data;
  return { decisions, reveal, published: run.publishedActions };
}

export function informationFrame(run: Run, frame: Frame): Frame {
  if ("matchingInput" in run && (run as SchoolRun).records[frame.tick].event_type !== "final_assignment") {
    return { ...frame, actors: frame.actors.map(actor => actor.id.startsWith("S") && actor.id !== "S01"
      ? { ...actor, signal: "可回查已发生的申请与席位变化。完整志愿与真实偏好在复盘时展示。" } : actor) };
  }
  if ("publishedActions" in run) {
    const published = (run as CascadeRun).publishedActions;
    if (!frame.tick || (run as CascadeRun).records[frame.tick].event_type === "reveal") return frame;
    const { decisions } = actionsAt(run as CascadeRun, frame.tick);
    const visible = new Map(decisions.map(row => [row.actors[0], row]));
    const hide = !published && decisions.at(-1)?.actors[0] !== "D03";
    const text = (actor: string) => `${actor} 已行动，选择未公开。`;
    return { ...frame,
      actors: frame.actors.map(actor => {
        const playback = visible.get(actor.id);
        return actor.id === "D03" ? actor : { ...actor,
          signal: playback ? published ? `公开选择 ${playback.data.choice} · 私人抽样待揭晓` : "行动与私人抽样待揭晓" : "尚未行动",
          reason: published || !playback ? actor.reason : text(actor.id) };
      }),
      events: hide ? frame.events.map(event => ({ ...event, text: text(event.actorId ?? "参与者") })) : frame.events,
    };
  }
  if ("marketInput" in run) {
    const current = (run as MarketRun).records[frame.tick];
    if (current.event_type !== "offer_iteration") return frame;
    const offer = current.data as Offer;
    const hidden = (id?: string) => !!id && id !== "S01" && offer.exited.includes(id);
    const exit = (id: string) => `${id} 的保留价高于本轮公开报价，退出混合池。`;
    return { ...frame, actors: frame.actors.map(actor => hidden(actor.id) ? { ...actor, reason: exit(actor.id) } : actor),
      events: frame.events.map(event => event.id !== String(frame.tick) && hidden(event.actorId)
        ? { ...event, text: exit(event.actorId!) } : event) };
  }
  return frame;
}

export type SourceQuestion = {
  tick: number; metric: string; summary: string; prompt: string;
  options: readonly { tick: number; label: string }[]; actor: string; reason: string; hint: string;
};

export function sourceQuestion(run: InformationRun, asOf: number): SourceQuestion | undefined {
  if ("matchingInput" in run) {
    const { refusals } = schoolsAt(run, asOf);
    const rejection = refusals[0];
    if (!rejection?.application) return;
    const { student, school, tick, application, priority_rank, cutoff } = rejection;
    return { tick, metric: "rejections", actor: student,
      summary: `累计拒绝 ${run.frames[tick - 1].metrics.rejections} → ${run.frames[tick].metrics.rejections} 份。`,
      prompt: `哪条记录能解释 ${student} 在 ${school} 校为何计入累计拒绝？`,
      options: [{ tick: application.seq, label: `事件 ${application.seq} · ${student} 递交申请` },
        { tick, label: `事件 ${tick} · ${school} 校排序` }],
      reason: `${student} 的优先名次是 ${priority_rank}，该校留下的名次为 ${cutoff.join("、")}。此条拒绝计入累计数。`,
      hint: "提交申请更新了申请数。要解释拒绝数，找实际比较了优先序和席位容量的记录。" };
  }
  if ("marketInput" in run) {
    const { offers } = marketAt(run, asOf);
    const pivot = offers.find(row => row.data.exited.length);
    if (!pivot) return;
    const { seq: tick, data } = pivot;
    const actor = data.exited.includes("S01") ? "S01" : data.exited[0];
    return { tick, metric: "willing_supply", actor,
      summary: `愿售数量 ${run.frames[tick - 1].metrics.willing_supply} → ${run.frames[tick].metrics.willing_supply} 件。`,
      prompt: `哪条记录解释 ${actor} 为何从愿售集合退出？`,
      options: [{ tick: 0, label: "事件 0 · 开盘挂牌" },
        { tick, label: `事件 ${tick} · 混合池更新暂定报价` }],
      reason: `混合报价为 ${displayNumber(data.quote)} 代币。${actor} 的保留价超过报价，退出记入本轮愿售数量，实际交割仍为 0 件。`,
      hint: "挂牌只把商品放入可以报价的集合。找报价与卖家是否愿意接受的比较。" };
  }
  const { decisions } = actionsAt(run, asOf);
  const pivot = decisions.find(row => row.data.cascade);
  const previous = pivot && decisions.find(row => row.seq === pivot.seq - 1);
  if (!pivot || !previous) return;
  const { seq: tick, data, actors: [actor] } = pivot;
  return { tick, metric: "public_a_pct", actor,
    summary: `公开 A 箱后验 ${displayNumber(data.public_a_before_pct)}% → ${displayNumber(data.public_a_after_pct)}%，级联决定计数增加。`,
    prompt: `哪条行动记录能解释为何 ${actor} 的选择未继续更新公共后验？`,
    options: [{ tick: previous.seq, label: `事件 ${previous.seq} · 前一人 ${previous.actors[0]} 的行动` },
      { tick, label: `事件 ${tick} · ${actor} 的两种私信号判断` }],
    reason: `抽到 A 和抽到 B 时，${actor} 都会选 ${data.choice}。该公开行动不区分这两种信号，公共后验保持原值。`,
    hint: "比较同一个人在两种私信号下的选择。前一人的行动可以进入公共信念，但不直接解释这一人的行动是否新增证据。" };
}
