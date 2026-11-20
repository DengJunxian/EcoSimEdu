import assert from "node:assert/strict";
import { test } from "node:test";
import { auctionLesson, boundarySpec } from "../src/auction.ts";
import { microscope } from "../src/microscope.ts";
import { startLesson, transition } from "../src/lesson.ts";
import { svbLesson } from "../src/svb.ts";
import { schellingLesson } from "../src/models/schelling-lesson.ts";

const auction = auctionLesson(false);
const raw = (lesson, choices, policy = lesson.policy.baseline) => lesson.run({ seed: lesson.seed, choices, policy });
const trade = { tick: 4, eventId: "4" };

test("the auction links two actual orders, maker price, exact volume and only revealed feedback", () => {
  const run = raw(auction, ["96", "no"]);
  const atTrade = microscope(run, auction, trade, 4, "system", "B01", "volume");
  assert.equal(atTrade.metric.equation, "1 − 0 = +1 件");
  assert.deepEqual(atTrade.contributions.map(source => source.point), [trade]);
  assert.match(atTrade.aggregation.explanation, /累计成交 0 → 1 件/);
  assert.ok(atTrade.aggregation.sources.every(source => source.point.tick < trade.tick));
  assert.deepEqual(atTrade.links.filter(link => link.kind === "action").map(link => link.point.eventId), ["1", "3"]);
  assert.match(atTrade.links.find(link => link.kind === "rule").text, /O001.*96/);
  assert.ok(atTrade.links.every(link => link.point.tick <= 4));
  assert.equal(microscope(run, auction, trade, 3, "system", "B01", "volume"), undefined);
  const later = microscope(run, auction, trade, 5, "system", "B01", "price");
  assert.equal(later.metric.before, null);
  assert.equal(later.metric.after, 96);
  assert.equal(later.metric.difference, null);
  assert.equal(later.links.find(link => link.kind === "feedback").point.eventId, "5");
  assert.equal(microscope(run, auction, trade, 5, "system", "B01", "surplus"), undefined);
  const own = microscope(run, auction, trade, 5, "role", "S02", "volume");
  assert.equal(own.actor.id, "B01");
  assert.equal(own.metric, undefined);
  assert.equal(own.aggregation, undefined);
  assert.deepEqual(own.contributions, []);
  assert.ok(own.links.every(link => link.actorId === "B01"));
  assert.doesNotMatch(JSON.stringify(own), /buyer_surplus|seller_surplus|剩余|后续报价/);
});

test("an SVB payment locates its actual FIFO request and reconciles individual cash independently from the round", () => {
  const run = raw(svbLesson, ["withdraw_now", "at-payment"]);
  const request = { tick: 1, eventId: "1/2" };
  const pay = { tick: 1, eventId: "1/4" };
  const evidence = microscope(run, svbLesson, pay, 1, "system", "D01", "cash");
  assert.deepEqual([evidence.metric.before, evidence.metric.after, evidence.metric.difference], [100, 81, -19]);
  assert.deepEqual(evidence.links.find(link => link.kind === "rule").point, request);
  const ledger = view => view.aggregation.rows.map(row => [row.before, row.after]);
  assert.deepEqual(ledger(evidence), [[32, 32], [0, 19], [32, 13], [100, 81]]);
  assert.ok(evidence.contributions.every(row => row.point.tick === 1));
  assert.ok(evidence.contributions.some(row => row.point.eventId === pay.eventId));
  assert.ok(!evidence.contributions.some(row => row.point.eventId === request.eventId));
  const submission = microscope(run, svbLesson, request, 1, "system", "D01", "queued");
  assert.equal(submission.metric.difference, 19);
  assert.deepEqual(ledger(submission), [[0, 19], [0, 0], [0, 19], [100, 100]]);
  assert.deepEqual(submission.links.find(link => link.kind === "feedback").point, pay);
  assert.ok(!submission.links.some(link => link.point.tick > 1));
  assert.equal(microscope(run, svbLesson, { tick: 2, eventId: pay.eventId }, 2, "system", "D01", "cash"), undefined);
  const own = microscope(run, svbLesson, pay, 1, "role", "D02", "cash");
  assert.ok(own.visibleRows.every(row => row.text.startsWith("D01 ")));
  assert.equal(own.metric, undefined);
});

test("Schelling re-counts the actual board and limits later decisions to the revealed prefix", () => {
  const run = raw(schellingLesson, ["move", "prediction-0"]);
  const first = { tick: 1, eventId: "1" };
  assert.equal(run.frames[1].actors.length, 340);
  const projection = microscope(run, schellingLesson, first, 1, "system", "A001", "similarity");
  assert.equal(projection.metric.identity, "同组／已占无向邻接对 529/1051 → 527/1051，各乘 100%。");
  assert.equal(projection.metric.difference, -0.19);
  assert.deepEqual(projection.aggregation.rows.map(row => [row.before, row.after]), [[5, 3], [7, 7], [529, 527], [1051, 1051]]);
  assert.deepEqual(projection.contributions.map(row => row.point), [first]);
  assert.equal(projection.links.filter(link => link.kind === "relation").length, 14);
  assert.ok(!projection.links.some(link => link.kind === "feedback"));
  const later = microscope(run, schellingLesson, first, 11, "system", "A001", "similarity");
  assert.equal(later.links.find(link => link.kind === "feedback")?.point.eventId, "11");
  const subsequent = microscope(run, schellingLesson, { tick: 11, eventId: "11" }, 11, "system", "B062", "similarity");
  assert.equal(subsequent.links.find(link => link.kind === "signal")?.point.eventId, "1");
});

test("every recorded relocation reconciles with the full board at the four supported thresholds", () => {
  const policies = [schellingLesson.policy.baseline, schellingLesson.policy.max,
    ...schellingLesson.policy.alternates.map(policy => policy.value)];
  for (const policy of policies) {
    for (const action of ["move", "stay"]) {
      const run = raw(schellingLesson, [action, "prediction-0"], policy);
      for (const row of run.records) {
        const trace = microscope(run, schellingLesson, { tick: row.seq }, row.seq, "system", undefined, "similarity");
        const isMove = row.event_type === "move" || row.event_type === "student_move";
        assert.equal(!!trace.aggregation, isMove, run.id + ":" + row.seq);
        if (isMove) assert.match(trace.aggregation.explanation, /与全图重新计数的结果一致/);
      }
    }
  }
});

test("standing quotes in a no-overlap auction link to submissions without producing a trade price", () => {
  const lesson = auctionLesson(true);
  const run = raw(lesson, [String(boundarySpec.bid), "no"]);
  const gap = run.frames.find(frame => frame.turningPoint);
  const trace = microscope(run, lesson, { tick: gap.tick }, gap.tick, "system", "B01", "price");
  assert.match(trace.aggregation.explanation, /没有成交。最高买价低于最低卖价/);
  assert.equal(trace.metric.after, null);
  assert.deepEqual(trace.contributions, []);
  assert.equal(trace.aggregation.sources.length, 2);
  assert.ok(trace.aggregation.sources.every(source => source.point.tick <= gap.tick &&
    run.frames[source.point.tick].record.event_type === "order_submitted"));
  const bidTrace = microscope(run, lesson, { tick: 1 }, 1, "system", "B01", "best_bid");
  assert.deepEqual(bidTrace.contributions.map(source => source.point), [{ tick: 1, eventId: "1" }]);
});

test("shared state rejects future focus, mismatched child events and other actors in the role view", () => {
  const run = raw(svbLesson, ["withdraw_now", "at-payment"]);
  const initial = { ...startLesson(svbLesson), stage: 3, run, cursor: 1, revealed: 1, selected: "D01" };
  assert.equal(transition(svbLesson, initial, { type: "trace", focus: { tick: 2 } }), initial);
  assert.equal(transition(svbLesson, initial, { type: "trace", focus: { tick: 1, eventId: "2/1" } }), initial);
  const role = transition(svbLesson, initial, { type: "perspective", perspective: "role" });
  assert.equal(transition(svbLesson, role, { type: "trace", focus: { tick: 1, eventId: "1/1" } }), role);
  const valid = transition(svbLesson, role, { type: "trace", focus: { tick: 1, eventId: "1/4" } });
  assert.equal(valid.traceFocus.eventId, "1/4");
  assert.equal(valid.selected, "D01");
});
