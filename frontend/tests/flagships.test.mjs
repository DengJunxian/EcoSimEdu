import assert from "node:assert/strict";
import { test } from "node:test";
import { auctionLesson, demandPolicy } from "../src/auction.ts";
import { browserResultDigest } from "../src/browser-result.ts";
import fromOriginal from "../src/data/legacy-fingerprints.json" with { type: "json" };
import { residentOptions } from "../src/models/schelling.ts";
import { schellingLesson as schelling } from "../src/models/schelling-lesson.ts";

test("Schelling grids keep all resident identities and explain actual feasible and blocked moves", async () => {
  for (const policy of [0, 30, 50, 100]) {
    const choice = policy === 0 || policy === 100 ? "stay" : "move";
    const run = schelling.run({ seed: schelling.seed, choices: [choice, "prediction-0"], policy });
    const initial = run.frames[0].board.cells;
    const population = initial.filter(Boolean).sort();
    assert.equal(population.length, 340);
    assert.equal(population.filter(id => id[0] === "A").length, 170);
    assert.equal(population.filter(id => id[0] === "B").length, 170);
    for (const frame of run.frames) {
      const { cells } = frame.board;
      assert.deepEqual(cells.filter(Boolean).sort(), population);
      assert.equal(cells.filter(cell => cell === null).length, 60);
      const event = run.records[frame.tick];
      if (event.event_type !== "move" && event.event_type !== "student_move") continue;
      const { actor_id, origin, destination, before, after } = event.data;
      const previous = run.frames[frame.tick - 1].board.cells;
      assert.equal(previous[origin], actor_id);
      assert.equal(previous[destination], null);
      assert.equal(cells[origin], null);
      assert.equal(cells[destination], actor_id);
      assert.equal(cells.filter((cell, i) => cell !== previous[i]).length, 2);
      const options = residentOptions(previous, actor_id, policy);
      assert.deepEqual(options.home, before);
      if (event.event_type === "move") {
        assert.equal(options.satisfied, false);
        assert.deepEqual(options.legal.find(entry => entry.cell === destination).local, after);
      }
    }
    const final = run.frames.at(-1);
    if (policy === 0) {
      assert.equal(final.metrics.moves, 0);
      assert.deepEqual(final.board.cells, initial);
    } else if (policy === 100) {
      const remaining = population.map(id => residentOptions(final.board.cells, id, policy)).filter(option => !option.satisfied);
      assert.equal(run.records.at(-1).data.terminal, "blocked");
      assert.equal(remaining.length, final.metrics.remaining);
      assert.ok(remaining.length && remaining.every(option => option.legal.length === 0));
    } else {
      assert.equal((await browserResultDigest(run)).value, fromOriginal.fingerprints[run.id]);
    }
  }
});

test("auction retains old digests and separates volume, price, fees and total surplus under the demand change", async () => {
  const lesson = auctionLesson(false);
  const run = policy => lesson.run({ seed: lesson.seed, choices: ["96", "no"], policy });
  const [base, fee, demand] = [0, 6, demandPolicy].map(run);
  for (const old of [base, fee]) assert.equal((await browserResultDigest(old)).value, fromOriginal.fingerprints[old.id]);
  assert.equal(demand.demandShift, 12);
  assert.equal(demand.bid, base.bid);
  assert.equal(demand.fee, 0);
  for (const variant of [base, fee, demand]) {
    const first = variant.frames[0];
    const last = variant.frames.at(-1);
    for (const frame of variant.frames) {
      const cash = frame => Object.values(frame.accounts).reduce((sum, person) => sum + person.cash, 0) + frame.metrics.platform_cash;
      const goods = frame => Object.values(frame.accounts).reduce((sum, person) => sum + person.goods, 0);
      assert.equal(cash(frame), cash(first));
      assert.equal(goods(frame), goods(first));
      if (frame.record.event_type !== "trade") assert.equal(frame.metrics.price, null);
    }
    assert.equal(last.metrics.participant_surplus + last.metrics.platform_cash, last.metrics.surplus);
    assert.equal(last.metrics.efficiency, last.metrics.surplus / variant.ceiling);
  }
  // The first trade clears at the same price in all three runs; its distribution and aggregate outcomes differ.
  assert.deepEqual([base, fee, demand].map(r => r.frames[4].record.price), [96, 96, 96]);
  assert.deepEqual([base, fee, demand].map(r => r.frames.at(-1).metrics.surplus), [180, 137, 272]);
  assert.deepEqual([base, fee, demand].map(r => r.ceiling), [291, 291, 439]);
});
