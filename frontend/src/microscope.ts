import { visibleTick, type evidenceKinds, type ObservationPerspective } from "../../content/microscope.ts";
import type { AuctionFrame, AuctionRun } from "./auction.ts";
import type { CasePackage, EventEnvelope } from "./domain-contracts.ts";
import type { Frame, Lesson, Run } from "./lesson.ts";
import { bankEventDeltas, bankEventValues, browserEvents } from "./run-evidence.ts";
import type { SvbRun } from "./svb.ts";

const roles = new Map([["double_auction", "B01"], ["svb_run", "D01"], ["schelling_segregation", "A001"]]);
export const microscopeRole = (lesson: Lesson) => roles.get(lesson.casePackage?.caseId ?? "");

export type TracePoint = { tick: number; eventId?: string };
export type TraceFocus = TracePoint & { relation?: string; anchor?: TracePoint };
type EvidenceKind = keyof typeof evidenceKinds;
export type TraceLink = { id: string; kind: EvidenceKind; text: string; point: TracePoint; actorId?: string };

type TraceSource = { point: TracePoint; text: string; actorId?: string };
type LocalAggregation = {
  label: string;
  rows: { label: string; before: number | null; after: number | null }[];
  explanation: string;
  sources?: TraceSource[];
};

type Move = {
  actor_id: string;
  origin: number;
  destination: number;
  before: readonly number[];
  after: readonly number[];
  changed_neighbors: readonly { actor: string; before: readonly number[]; after: readonly number[] }[];
  source: "student" | "rule";
};

const pointOf = (event: EventEnvelope): TracePoint => ({ tick: event.frameTick!, eventId: event.eventId });
const previousRound = (tick: number): TracePoint => ({ tick });
const signed = (value: number) => value > 0 ? `+${value}` : String(value);
const stable = (value: number) => Number(value.toFixed(8));

function moveRecord(event: EventEnvelope): Move | undefined {
  return event.kind === "move" || event.kind === "student_move" ? (event.record as { data: Move }).data : undefined;
}

const pairsByFrame = new WeakMap<Frame, { same: number; all: number }>();
function edges(frame: Frame) {
  const existing = pairsByFrame.get(frame);
  if (existing) return existing;
  const board = frame.board;
  if (!board) return;
  let same = 0, all = 0;
  const { cells, size } = board;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    const x = i % size;
    for (const [dx, dy] of [[1, 0], [-1, 1], [0, 1], [1, 1]]) {
      if (x + dx < 0 || x + dx >= size) continue;
      const neighbor = cells[i + dx + dy * size];
      if (!neighbor) continue;
      all++;
      same += Number(cells[i]![0] === neighbor[0]);
    }
  }
  const result = { same, all };
  pairsByFrame.set(frame, result);
  return result;
}

function neighborhoodAggregation(move: Move, prior: Frame, frame: Frame): LocalAggregation | undefined {
  const previous = edges(prior), current = edges(frame);
  if (!previous || !current) return;
  const affected = [move, ...move.changed_neighbors];
  const doubledChange = [0, 1].map(i => affected.reduce((sum, row) => sum + row.after[i] - row.before[i], 0));
  if (doubledChange[0] !== 2 * (current.same - previous.same) ||
      doubledChange[1] !== 2 * (current.all - previous.all)) return;
  return {
    label: "两处邻域和全图",
    rows: [
      { label: "搬迁者同组邻接对", before: move.before[0], after: move.after[0] },
      { label: "搬迁者已占邻接对", before: move.before[1], after: move.after[1] },
      { label: "全图同组邻接对", before: previous.same, after: current.same },
      { label: "全图已占邻接对", before: previous.all, after: current.all },
    ],
    explanation: `搬迁者与 ${move.changed_neighbors.length} 户邻居的计数变化合计 ${signed(doubledChange[0])} 条同组邻接、${signed(doubledChange[1])} 条已占邻接。每对在两端各计一次，除以 2 后与全图重新计数的结果一致。`,
  };
}

function queueAggregation(frame: Frame, prior: Frame | undefined, event?: EventEnvelope): LocalAggregation | undefined {
  const rows = [
    ["requested", "累计申请"], ["paid", "累计实付"], ["queued", "待付金额"], ["cash", "银行现金"],
  ].flatMap(([key, label]) => {
    const values = event ? bankEventValues(frame, prior, event.eventId, key) :
      { before: prior?.metrics[key], after: frame.metrics[key] };
    return typeof values?.before === "number" && typeof values.after === "number"
      ? [{ label, before: values.before, after: values.after }] : [];
  });
  if (rows.length !== 4 || rows[0].before - rows[1].before !== rows[2].before ||
      rows[0].after - rows[1].after !== rows[2].after) return;
  return {
    label: event ? "这笔事件前后的队列与现金" : "本轮队列与现金",
    rows,
    explanation: `待付 = 累计申请 − 累计实付。当前核算 ${rows[0].after} − ${rows[1].after} = ${rows[2].after}。银行现金单列，单位均为资金单位。`,
  };
}

function bookAggregation(frame: AuctionFrame, prior: AuctionFrame | undefined,
  orderEvents: Map<string, EventEnvelope>): LocalAggregation {
  const orders = frame.book;
  const { best_bid: bid, best_ask: ask, volume } = frame.metrics;
  const trade = frame.record.event_type === "trade";
  const bestOrders = [
    orders.find(order => order.side === "buy" && order.price === bid),
    orders.find(order => order.side === "sell" && order.price === ask),
  ];
  const sources = bestOrders.flatMap((order, index) => {
    const event = order && orderEvents.get(order.order_id);
    return order && event && event.frameTick! <= frame.tick ? [{
      point: pointOf(event), actorId: order.actor_id,
      text: `${index === 0 ? "最高买价" : "最低卖价"} · ${order.order_id} · ${order.price} 代币`,
    }] : [];
  });
  return {
    label: "在簿订单",
    rows: [
      { label: "在簿买单（张）", before: prior?.book.filter(order => order.side === "buy").length ?? null,
        after: orders.filter(order => order.side === "buy").length },
      { label: "在簿卖单（张）", before: prior?.book.filter(order => order.side === "sell").length ?? null,
        after: orders.filter(order => order.side === "sell").length },
      { label: "最高买价（代币）", before: prior?.metrics.best_bid ?? null, after: bid },
      { label: "最低卖价（代币）", before: prior?.metrics.best_ask ?? null, after: ask },
    ],
    explanation: trade
      ? `成交事件记录 ${frame.record.quantity} 件，累计成交 ${prior?.metrics.volume} → ${volume} 件。表中是成交后仍在簿的限价。`
      : `此事件没有成交。${typeof bid === "number" && typeof ask === "number" && bid < ask ?
        `最高买价低于最低卖价 ${ask - bid} 代币。` : ""}`,
    sources,
  };
}

function visibleEnd<T extends { frameTick: number | null }>(rows: readonly T[], asOf: number) {
  let lower = 0, upper = rows.length;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    if (rows[middle].frameTick! <= asOf) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function buildIndex(run: Run, course: CasePackage) {
  const auction = course.caseId === "double_auction" ? run as AuctionRun : undefined;
  const bank = course.caseId === "svb_run";
  const rows = browserEvents(run, course);
  const events = new Map(rows.map(event => [event.eventId, event]));
  const byTick = new Map<number, EventEnvelope[]>();
  const byActor = new Map<string, EventEnvelope[]>();
  const orderEvents = new Map<string, EventEnvelope>();
  const links = new Map<string, TraceLink[]>();
  const feedback = new Map<string, EventEnvelope[]>();
  const pending: { event: EventEnvelope; actorId: string; remaining: number }[] = [];
  let head = 0;
  const lastNeighborhood = new Map<string, { event: EventEnvelope; after: readonly number[] }>();
  const roundFeedback = new Map<string, EventEnvelope[]>();

  function append<K, V>(index: Map<K, V[]>, key: K, value: V) {
    const list = index.get(key);
    if (list) list.push(value);
    else index.set(key, [value]);
  }
  function relate(event: EventEnvelope, kind: EvidenceKind, text: string, source: TracePoint, actorId?: string) {
    append(links, event.eventId, { id: `${event.eventId}/${links.get(event.eventId)?.length ?? 0}`,
      kind, text, actorId, point: source });
  }
  function received(event: EventEnvelope, source: EventEnvelope, text: string, actorId?: string) {
    relate(event, "signal", text, pointOf(source), actorId);
    append(feedback, source.eventId, event);
  }

  for (const event of rows) {
    const tick = event.frameTick!;
    append(byTick, tick, event);
    for (const actor of event.actorIds) append(byActor, actor, event);
    const detail = run.frames[tick].events.find(item => item.id === event.eventId);

    const orderId = auction?.frames[tick].record.order_id;
    if (orderId && event.kind === "order_submitted") orderEvents.set(orderId, event);
    if (auction && event.kind === "trade") {
      const record = auction.frames[tick].record;
      for (const ref of event.sourceEvents) {
        if (ref.frameTick === null || ref.frameTick >= tick) continue;
        const order = auction.frames[ref.frameTick].record;
        relate(event, "action", `${order.order_id} · ${order.actor_id} 报价 ${order.price} 代币`,
          { tick: ref.frameTick, eventId: ref.eventId }, order.actor_id);
      }
      const maker = record.maker_order_id && auction.quotes[record.maker_order_id];
      if (maker && maker.price === record.price) {
        relate(event, "rule", `在簿订单 ${maker.order_id} 决定成交价 ${record.price} 代币。`, pointOf(event));
      }
    }
    if (detail?.priorSignal) {
      const signal = detail.priorSignal;
      const frame = run.frames[signal.tick];
      if (signal.tick < tick && frame?.metrics[signal.metricId] === signal.value) {
        const source = auction ? events.get(String(signal.tick)) : undefined;
        const label = course.metrics.find(metric => metric.id === signal.metricId)?.label ?? signal.metricId;
        const text = `本次决策记录了${label} ${signal.value}。`;
        if (source) received(event, source, text, detail.actorId);
        else if (bank) {
          relate(event, "signal", text, previousRound(signal.tick), detail.actorId);
          append(roundFeedback, `${signal.tick}:${signal.metricId}`, event);
        }
      }
    }
    if (bank && detail?.actorId) {
      const actorId = detail.actorId;
      for (const observed of detail.observed ?? []) {
        const source = events.get(observed.eventId);
        if (source?.kind === "request" && source.frameTick === observed.tick && observed.tick < tick &&
            source.actorIds.includes(observed.actorId)) {
          received(event, source, `${actorId} 收到 ${observed.actorId} 的申请信号。`, actorId);
        }
      }
      if (detail.kind === "request" && (detail.deltas.requested ?? 0) > 0) {
        pending.push({ event, actorId, remaining: detail.deltas.requested! });
      } else if (detail.kind === "payment") {
        const source = pending[head];
        const paid = detail.deltas.paid;
        if (source?.actorId === actorId && typeof paid === "number" && paid > 0 && paid <= source.remaining) {
          relate(event, "rule", `${actorId} 的 ${paid} 资金单位按原入队申请结算。`, pointOf(source.event), actorId);
          append(feedback, source.event.eventId, event);
          source.remaining -= paid;
          if (!source.remaining) head++;
        }
      }
    }
    const move = moveRecord(event);
    if (move) {
      const prior = lastNeighborhood.get(move.actor_id);
      if (prior && prior.after[0] === move.before[0] && prior.after[1] === move.before[1]) {
        received(event, prior.event, `搬迁前的邻居计数 ${move.before.join("/")} 可回查至这次记录的邻域变化。`, move.actor_id);
      }
      relate(event, "rule", move.source === "student" ? "学生选择迁入预留空位。" :
        "原址未达阈值，住户迁入满足规则的空位。", pointOf(event), move.actor_id);
      lastNeighborhood.delete(move.actor_id);
      for (const change of move.changed_neighbors) {
        relate(event, "relation", `${change.actor} 的同组／已占邻居 ${change.before.join("/")} → ${change.after.join("/")}`,
          pointOf(event), change.actor);
        lastNeighborhood.set(change.actor, { event, after: change.after });
      }
    }
  }
  return { auction, bank, events, byTick, byActor, links, feedback, roundFeedback, orderEvents };
}

const cached = new WeakMap<Run, ReturnType<typeof buildIndex>>();

export function microscope(run: Run, lesson: Lesson, focus: TracePoint, asOf: number, perspective: ObservationPerspective,
  selected: string | undefined, metricId: string) {
  const course = lesson.casePackage;
  const own = microscopeRole(lesson);
  const metric = lesson.metrics.find(item => item.id === metricId);
  if (!course || !own || !metric || !visibleTick(focus.tick, asOf) || !run.frames[asOf]) return;
  let index = cached.get(run);
  if (!index) {
    index = buildIndex(run, course);
    cached.set(run, index);
  }
  const { tick } = focus;
  const frame = run.frames[tick];
  const prior = run.frames[tick - 1];
  const actorId = perspective === "role" ? own : selected;
  const role = perspective === "role";
  const available = (event: EventEnvelope) => visibleTick(event.frameTick!, asOf) &&
    (!role || (index.bank ? event.actorIds.includes(own) :
      ((event.record as { actor_id?: string }).actor_id === own || event.actorIds[0] === own ||
        index.auction && event.kind === "trade" && event.actorIds.includes(own))));
  const local = index.byTick.get(tick) ?? [];
  const explicit = focus.eventId === undefined ? undefined : index.events.get(focus.eventId);
  if (focus.eventId !== undefined && (!explicit || explicit.frameTick !== tick || !available(explicit))) return;
  const event = explicit ?? (!index.bank ? local.find(available) : undefined);
  const visibleRows = local.filter(available);
  const history = actorId ? index.byActor.get(actorId) ?? [] : [];
  const ceiling = visibleEnd(history, asOf);
  const actorEvents = history.slice(Math.max(0, ceiling - 8), ceiling).filter(available);
  const actor = actorId ? frame.actors.find(item => item.id === actorId) : undefined;
  const actorBefore = actorId ? prior?.actors.find(item => item.id === actorId) : undefined;
  const exposed = (link: TraceLink) => visibleTick(link.point.tick, asOf) &&
    (!role || link.actorId === own && link.point.eventId !== undefined && !!index.events.get(link.point.eventId) &&
      available(index.events.get(link.point.eventId)!));
  const receivedNow = index.bank && !role && !event && actorId
    ? (run as SvbRun).observations?.[tick]?.[actorId] ?? [] : [];
  const references = event ? (index.links.get(event.eventId) ?? []).filter(exposed) : receivedNow.map(item => ({
    id: `message:${item.eventId}`, kind: "signal" as const, text: `${actorId} 看到 ${item.actorId} 的首次申请。`,
    point: { tick: item.tick, eventId: item.eventId }, actorId: item.actorId,
  })).filter(exposed);
  const upcoming = event ? index.feedback.get(event.eventId) :
    index.roundFeedback.get(`${tick}:${metricId}`);
  const feedback = role ? [] : (upcoming ?? []).filter(available).map(next => ({
    id: `feedback:${next.eventId}`, kind: "feedback" as const,
    text: next.kind === "payment" ? "这笔申请后来按队列实付。" :
      moveRecord(next) ? "后续搬迁前的邻居计数与本次邻域变化衔接。" :
      `后续${next.kind === "order_submitted" ? "报价" : "行动"}记录了来自本处的信号。`,
    point: pointOf(next), actorId: next.actorIds[0],
  }));

  const known = (value: number | null | undefined) => typeof value === "number" ? value : null;
  const values = index.bank && event ? bankEventValues(frame, prior, event.eventId, metricId) :
    { before: known(prior?.metrics[metricId]), after: known(frame.metrics[metricId]) };
  const before = values?.before ?? null, after = values?.after ?? null;
  const difference = !role && before !== null && after !== null ? stable(after - before) : null;
  const deltaUnit = metric.unit === "%" ? "个百分点" : metric.unit;
  const equation = difference === null ? undefined : `${after} − ${before} = ${signed(difference)} ${deltaUnit}`;
  const move = event && moveRecord(event);
  const previous = !role && move && metricId === "similarity" && prior ? edges(prior) : undefined;
  const current = previous && edges(frame);
  const identity = previous?.all && current?.all && before !== null && after !== null &&
    Math.abs(previous.same * 100 / previous.all - before) <= .005001 &&
    Math.abs(current.same * 100 / current.all - after) <= .005001
    ? `同组／已占无向邻接对 ${previous.same}/${previous.all} → ${current.same}/${current.all}，各乘 100%。`
    : undefined;
  let aggregation: LocalAggregation | undefined;
  let contributions: TraceSource[] = [];
  if (!role) {
    if (move && prior) aggregation = neighborhoodAggregation(move, prior, frame);
    if (index.bank) {
      aggregation = queueAggregation(frame, prior, event);
      const start = prior?.metrics[metricId], end = frame.metrics[metricId];
      if (typeof start === "number" && typeof end === "number") {
        const postings = frame.events.map(item => ({ item, delta: bankEventDeltas(frame, prior, item)[metricId] ?? 0 }));
        if (start + postings.reduce((sum, entry) => sum + entry.delta, 0) === end) {
          contributions = postings.flatMap(({ item, delta }) => delta ? [{
            point: { tick, eventId: item.id }, actorId: item.actorId,
            text: `${item.text}（${signed(delta)} ${deltaUnit}）`,
          }] : []);
        }
      }
    }
    if (index.auction) {
      aggregation = bookAggregation(index.auction.frames[tick], index.auction.frames[tick - 1], index.orderEvents);
    }
    const bookChange = index.auction && (metricId === "best_bid" || metricId === "best_ask") && before !== after;
    if (!index.bank && event && (difference || bookChange || index.auction && metricId === "price" && event.kind === "trade")) {
      contributions = [{ point: pointOf(event), text: event.summary ?? event.kind, actorId: event.actorIds[0] }];
    }
  }

  const visibleEvent = (row: EventEnvelope) => ({ point: pointOf(row), kind: row.kind, text: row.summary ?? row.kind });
  return {
    runId: run.id, asOf, perspective, point: event ? pointOf(event) : { tick },
    eventType: event?.kind, action: event?.summary, clock: course.clock.label,
    economicTime: event ? event.economicTime?.value : index.bank ? tick : undefined,
    actor, actorBefore, actorEvents: actorEvents.map(visibleEvent), visibleRows: visibleRows.map(visibleEvent),
    aggregation, contributions,
    links: [...references.filter(link => link.kind !== "relation"), ...feedback, ...references.filter(link => link.kind === "relation")],
    metric: role ? undefined : { label: metric.label, unit: metric.unit, before, after, difference, equation, identity },
  };
}
