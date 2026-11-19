import assert from "node:assert/strict";
import { test } from "node:test";
import { auctionLesson, roundEnds, simulateAuction } from "../src/auction.ts";
import { relatedActors, startLesson, transition } from "../src/lesson.ts";
import { verifyLesson } from "./lesson-contract.mjs";

const input = { seed: 1962, choices: ["96", "yes"], policy: 0 };

test("the browser auction fits the common contract and conserves cash and goods", () => {
  verifyLesson(auctionLesson(false), input.choices, 6);
  for (const [bid, fee] of [[1, 0], [96, 0], [96, 6], [108, 6]]) {
    const run = simulateAuction({ ...input, choices: [String(bid), "yes"], policy: fee });
    const sum = (frame, property) => Object.values(frame.accounts).reduce((n, actor) => n + actor[property], 0);
    for (const frame of run.frames) {
      assert.equal(sum(frame, "cash") + frame.metrics.platform_cash, sum(run.frames[0], "cash"));
      assert.equal(sum(frame, "goods"), sum(run.frames[0], "goods"));
      assert.ok(Object.values(frame.accounts).every(actor => actor.cash >= 0 && actor.goods >= 0));
    }
  }
});

test("both sides of the first trade and the later quote link to actual events", () => {
  const run = simulateAuction(input);
  const trade = run.frames[4];
  assert.equal(trade.record.price, 96);
  assert.deepEqual(relatedActors(trade, "price"), ["B01", "S02"]);
  assert.equal(trade.record.maker_order_id, "O001");
  assert.equal(run.quotes.O003.price, 78);
  assert.equal(run.frames[3].metrics.price, null);
  assert.deepEqual(run.frames[5].events[0].priorSignal, { metricId: "price", tick: 4, value: 96 });
  const treated = simulateAuction({ ...input, policy: 6 });
  assert.deepEqual(roundEnds(run).map(frame => frame.tick), roundEnds(treated).map(frame => frame.tick));
  assert.equal(roundEnds(run).at(-1).metrics.volume, 6);
  assert.equal(roundEnds(treated).at(-1).metrics.volume, 4);
  assert.equal(treated.frames.at(-1).metrics.platform_cash, 48);
  assert.equal(simulateAuction({ ...input, choices: ["108", "yes"], policy: 6 }).frames[1].record.event_type,
    "order_rejected");
});

test("no overlap leaves a null price and efficiency while returning every standing order", () => {
  for (const policy of [0, 6]) {
    const run = simulateAuction({ ...input, choices: ["35", "no"], policy }, true);
    assert.ok(run.frames.some(frame => frame.metrics.best_bid < frame.metrics.best_ask && frame.turningPoint));
    assert.ok(run.frames.every(frame => frame.metrics.volume === 0 && frame.metrics.price === null));
    const close = run.frames.at(-1);
    assert.deepEqual(close.book, []);
    assert.equal(close.metrics.efficiency, null);
    assert.equal(run.ceiling, 0);
    assert.ok(run.frames.some(frame =>
      frame.record.event_type === "order_cancelled" && frame.record.order_id === "O001" && frame.record.round === 4));
  }
});

test("the quoted amount and prediction are captured before replay", () => {
  const lesson = auctionLesson(false);
  const fresh = startLesson(lesson);
  for (const invalid of ["109", "0", "-1", "9.6", ""]) {
    assert.equal(transition(lesson, fresh, { type: "choose", option: invalid }), fresh);
  }
  const quoted = transition(lesson, fresh, { type: "choose", option: "96" });
  assert.equal(transition(lesson, quoted, { type: "next-stage" }), quoted);
  const predicted = transition(lesson, quoted, { type: "choose", option: "yes" });
  const playing = transition(lesson, predicted, { type: "next-stage" });
  assert.equal(playing.run.bid, 96);
  assert.deepEqual(playing.choices, ["96", "yes"]);
});
