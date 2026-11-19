import { visibleTick, type evidenceKinds, type ObservationPerspective } from "../../content/microscope.ts";
import type { AuctionRun } from "./auction.ts";
import type { CasePackage, EventEnvelope } from "./domain-contracts.ts";
import type { Frame, Lesson, Run } from "./lesson.ts";
import { browserEvents } from "./run-evidence.ts";

const roles = new Map([["double_auction", "B01"], ["svb_run", "D01"], ["schelling_segregation", "A001"]]);
export const microscopeRole = (lesson: Lesson) => roles.get(lesson.casePackage?.caseId ?? "");

export type TracePoint = { tick: number; eventId?: string };
export type TraceFocus = TracePoint & { relation?: string; anchor?: TracePoint };
type EvidenceKind = keyof typeof evidenceKinds;
export type TraceLink = { id: string; kind: EvidenceKind; text: string; point: TracePoint; actorId?: string };

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
  return { auction, bank, events, byTick, byActor, links, feedback, roundFeedback };
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
  const references = event ? (index.links.get(event.eventId) ?? []).filter(exposed) : [];
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
  let before = known(prior?.metrics[metricId]), after = known(frame.metrics[metricId]);
  let verified = !index.bank || !event;
  if (index.bank && event && before !== null && after !== null) {
    const valueAt = (item: EventEnvelope) => (item.record as { deltas: Record<string, number> }).deltas[metricId] ?? 0;
    if (stable(before + local.reduce((sum, item) => sum + valueAt(item), 0)) === stable(after)) {
      const offset = local.indexOf(event);
      before = stable(before + local.slice(0, offset).reduce((sum, item) => sum + valueAt(item), 0));
      after = stable(before + valueAt(event));
      verified = true;
    }
  }
  const difference = !role && verified && before !== null && after !== null ? stable(after - before) : null;
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
  const visibleEvent = (row: EventEnvelope) => ({ point: pointOf(row), kind: row.kind, text: row.summary ?? row.kind });
  return {
    runId: run.id, asOf, perspective, point: event ? pointOf(event) : { tick },
    eventType: event?.kind, action: event?.summary, clock: course.clock.label,
    economicTime: event ? event.economicTime?.value : index.bank ? tick : undefined,
    actor, actorBefore, actorEvents: actorEvents.map(visibleEvent), visibleRows: visibleRows.map(visibleEvent),
    links: [...references.filter(link => link.kind !== "relation"), ...feedback, ...references.filter(link => link.kind === "relation")],
    metric: role ? undefined : { label: metric.label, unit: metric.unit, before: verified ? before : null,
      after: verified ? after : null, difference, equation, identity },
  };
}
