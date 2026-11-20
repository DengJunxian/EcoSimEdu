import assert from "node:assert/strict";
import { test } from "node:test";
import { auctionLesson } from "../src/auction.ts";
import { svbLesson } from "../src/svb.ts";
import { comparable, conditions, distribution, experimentCard, pairResult, pairedRows, pairedSeeds, reopenExperiment, runSamples, sharedRange } from "../src/experiments.ts";
import { comparisonMetric, outcome, startLesson, transition } from "../src/lesson.ts";
import { browserResultDigest } from "../src/browser-result.ts";
import { lessons } from "./remaining_parity.mjs";

const auction = auctionLesson(false);
const planFor = (lesson, multi = true) => ({
  course: { caseId: lesson.casePackage.caseId }, choices: lesson.decisions.map(d => d.options?.[0].id ?? String(d.amount.suggested)),
  policy: lesson.policy.max, prediction: "down", seeds: pairedSeeds(lesson, multi),
});

test("each published case declares a metric, aggregation and alignment, with matched inputs for eleven multi-seed courses", async () => {
  assert.equal(conditions(auction, -1).comparison, auction.policy.alternates[0].label);
  assert.match(conditions(auction, -1).baseline, /原买方估值/);
  const registered = [auction, svbLesson, ...lessons];
  assert.equal(registered.filter(lesson => lesson.prepareSeed).length, 11);
  for (const lesson of registered) {
    const plan = planFor(lesson);
    const id = plan.course.caseId;
    const samples = await runSamples(lesson, plan);
    assert.ok(samples.every(comparable), id);
    assert.equal(samples.length, id === "beer_game" ? 1 : 3, id);
    const metric = comparisonMetric(lesson);
    assert.equal(metric.unit, lesson.casePackage.metrics.find(row => row.id === metric.id).unit, id);
    assert.ok(["cumulative", "peak", "final"].includes(lesson.metricRoles.statistic), id);
    for (const sample of samples) {
      const { baseline, branch, seed, delta } = sample;
      assert.equal(baseline.seed, seed);
      assert.equal(branch.seed, seed);
      assert.deepEqual(baseline.frames[0].actors.map(x => x.id), branch.frames[0].actors.map(x => x.id), id);
      assert.equal(delta, sample.left === null || sample.right === null ? null : sample.right - sample.left);
      const rows = pairedRows(lesson, baseline, branch);
      assert.ok(rows.some(row => row.baseline?.sourceTick !== undefined && row.branch?.sourceTick !== undefined), id);
      if (id === "schelling_segregation") {
        assert.deepEqual(baseline.frames[0].board.cells, branch.frames[0].board.cells);
        assert.equal(baseline.frames.at(-1).board.cells.filter(Boolean).length, 340);
        assert.equal(branch.frames.at(-1).board.cells.filter(Boolean).length, 340);
      }
      if (id === "double_auction") {
        for (const run of [baseline, branch]) for (const frame of run.frames) {
          const accounts = Object.values(frame.accounts);
          const initialCash = Object.values(run.frames[0].accounts).reduce((total, entry) => total + entry.cash, 0);
          assert.equal(accounts.reduce((total, entry) => total + entry.goods, 0), 19);
          assert.equal(accounts.reduce((total, entry) => total + entry.cash, frame.metrics.platform_cash), initialCash);
        }
      }
    }
  }
});

test("pair statistics preserve missing and negative values, different time ranges, and failed samples", () => {
  const frame = (tick, value) => ({ tick, actors: [], events: [], metrics: { volume: value } });
  const a = { seed: 42, id: "a", frames: [frame(0, -5), frame(1, -3)] };
  const b = { seed: 42, id: "b", frames: [frame(0, -2), frame(1, null), frame(2, -7)] };
  const demo = { ...auction, policy: { ...auction.policy, project: undefined }, metricRoles: { ...auction.metricRoles, statistic: "peak" } };
  const rows = pairedRows(demo, a, b);
  assert.equal(rows[2].baseline, undefined);
  assert.equal(rows[1].branch.metrics.volume, null);
  assert.equal(outcome(demo, a), -3);
  assert.equal(pairResult(demo, 42, a, b).delta, 1);
  assert.throws(() => pairResult(demo, 42, a, { ...b, seed: 9 }));
  assert.throws(() => pairResult(demo, 42, a, { ...b, frames: [frame(0, Infinity)] }));
  assert.ok(sharedRange([-7, -5, null, undefined]).max < 0);
  assert.equal(sharedRange([null, undefined]), undefined);
  assert.deepEqual(distribution([pairResult(demo, 42, a, b), { seed: 81, failed: true },
    { ...pairResult(demo, 42, a, b), seed: 82, delta: null }]),
    { count: 1, failed: 1, undefinedCount: 1, minimum: 1, median: 1, maximum: 1 });
});

test("prediction gates the seed plan and a failed primary or extra run preserves the plan", async () => {
  const plan = planFor(auction);
  const broken = { ...auction, run(input) {
    if (input.policy !== auction.policy.baseline) throw new Error("test failure");
    return auction.run(input);
  } };
  const state = { ...startLesson(broken), stage: 4, ...plan,
    run: auction.run({ seed: auction.seed, choices: plan.choices, policy: 0 }) };
  const changed = transition(broken, state, { type: "seed-count", multi: true });
  assert.equal(changed.prediction, undefined);
  assert.equal(transition(broken, changed, { type: "compare" }), changed);
  const predicted = transition(broken, changed, { type: "predict", value: "down" });
  const failed = transition(broken, predicted, { type: "compare" });
  assert.equal(failed.comparison, undefined);
  assert.equal(failed.comparisonFailed, true);
  assert.equal(failed.prediction, "down");
  const extra = { ...auction, async prepareSeed(seed) {
    if (seed === auction.seed + 1) throw new Error("test seed unavailable");
    return auction.prepareSeed(seed);
  } };
  const samples = await runSamples(extra, plan);
  assert.equal(distribution(samples).failed, 1);
  await assert.rejects(experimentCard(extra, plan, samples), /仍有种子未完成/);
});

test("multi-seed reruns match the same digests and reject altered cards, including the original prediction", async () => {
  const plan = planFor(auction);
  const samples = await runSamples(auction, plan);
  const card = JSON.parse(JSON.stringify(await experimentCard(auction, plan, samples)));
  const restored = await reopenExperiment(auction, plan.course, card);
  assert.deepEqual(restored.samples.map(item => item.delta), samples.map(item => item.delta));
  assert.equal(new Set(card.pairs.map(item => item.baseline.envelope.runId)).size, 3);
  for (let index = 0; index < samples.length; index++) {
    const {baseline, branch} = samples[index];
    const expected = card.pairs[index];
    assert.deepEqual(await browserResultDigest(restored.samples[index].baseline), expected.baseline.envelope.resultDigest);
    assert.deepEqual(await browserResultDigest(branch), expected.comparison.envelope.resultDigest);
    assert.equal(expected.baseline.evidence.frameTick, baseline.frames.at(-1).tick);
  }
  for (const edit of [
    card => { card.pairs[1].delta += 1; }, card => { card.plan.prediction = "up"; },
    card => { card.pairs[1].baseline.evidence.frameTick += 1; }, card => { card.plan.seeds[1] = -1; },
  ]) {
    const forged = structuredClone(card);
    edit(forged);
    await assert.rejects(reopenExperiment(auction, plan.course, forged));
  }
});

test("auction no-overlap pairs preserve zero quantity, absent price and actual round sources", async () => {
  const lesson = auctionLesson(true);
  const plan = { ...planFor(lesson), course: { caseId: "double_auction", market: "no-overlap" } };
  for (const sample of await runSamples(lesson, plan)) {
    assert.equal(sample.delta, 0);
    const rows = pairedRows(lesson, sample.baseline, sample.branch);
    assert.ok(rows.every(row => row.baseline.metrics.last_price === null && row.branch.metrics.last_price === null));
    assert.equal(rows.at(-1).label, "收盘");
    assert.equal(rows.at(-1).baseline.sourceTick, sample.baseline.frames.at(-1).tick);
  }
});
