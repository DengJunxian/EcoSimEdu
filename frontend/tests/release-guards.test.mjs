import assert from "node:assert/strict";
import { test } from "node:test";
import { auctionLesson, demandPolicy } from "../src/auction.ts";
import { actionsAt, informationFrame, marketAt, schoolsAt, sourceQuestion } from "../src/information-evidence.ts";
import { cascadeLesson, lemonsLesson, schoolLesson } from "../src/models/information-lessons.ts";
import { progressSnapshot, resumeProgress, saveProgress, sourceRun } from "../src/learning-store.ts";
import { browserResultDigest, withLegacyDemandDeltas } from "../src/browser-result.ts";
import { experimentCard, pairedSeeds, reopenExperiment, runSamples } from "../src/experiments.ts";
import { startLesson, transition } from "../src/lesson.ts";

test("a stale tab cannot replace a later checkpoint", () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const course = { caseId: "double_auction" };
  const lesson = auctionLesson(false);
  const initial = startLesson(lesson);
  const one = transition(lesson, initial, { type: "choose", option: "96" });
  const two = transition(lesson, one, { type: "choose", option: "no" });
  saveProgress(storage, course, one, null);
  const seen = progressSnapshot(storage, course);
  const saved = saveProgress(storage, course, two, seen);
  assert.equal(saveProgress(storage, course, one, seen), undefined);
  assert.deepEqual(resumeProgress(storage, course, lesson).choices, ["96", "no"]);
  assert.equal(progressSnapshot(storage, course), saved);
});

test("auction demand treatment does not charge a fee in any trade event", () => {
  const lesson = auctionLesson(false);
  const policy = demandPolicy;
  const run = lesson.run({ seed: lesson.seed, choices: ["96", "no"], policy });
  const trades = run.frames.filter(frame => frame.record.event_type === "trade");
  assert.ok(trades.length > 0);
  for (const frame of trades) {
    for (const metric of ["platform_cash", "participant_surplus", "surplus"]) {
      assert.equal(frame.events[0].deltas[metric], frame.metrics[metric] - run.frames[frame.tick - 1].metrics[metric]);
    }
    assert.equal(frame.events[0].deltas.platform_cash, 0);
  }
});

test("information classrooms use real source events and withhold private inputs until review", () => {
  const school = schoolLesson.run({ seed: schoolLesson.seed, choices: ["truthful", "prediction-0"], policy: schoolLesson.policy.baseline });
  assert.equal(sourceQuestion(school, 1), undefined);
  const schoolQuestion = sourceQuestion(school, 2);
  assert.equal(schoolQuestion.tick, 2);
  assert.equal(schoolsAt(school, 2).refusals[0].application.seq, 1);
  assert.match(informationFrame(school, school.frames[0]).actors.find(actor => actor.id === "S02").signal, /复盘时展示/);
  assert.match(informationFrame(school, school.frames.at(-1)).actors.find(actor => actor.id === "S02").signal, /真实偏好 [ABC]/);

  const market = lemonsLesson.run({ seed: lemonsLesson.seed, choices: ["list", "prediction-0"], policy: lemonsLesson.policy.baseline });
  const first = marketAt(market, 1);
  assert.equal(first.offers[0].data.quote, 3.6);
  assert.equal(first.offers[0].data.willing_pool.length, 18);
  assert.equal(first.sellers.find(row => row.id === "S01").quality, 5);
  assert.equal(first.sellers.find(row => row.id === "S02").quality, undefined);
  assert.ok(informationFrame(market, market.frames[1]).events
    .filter(event => event.actorId !== "S01").every(event => !/保留价 \d/.test(event.text)));
  const close = marketAt(market, market.frames.length - 1);
  assert.equal(close.sellers.filter(row => row.state === "已交割").length, 6);
  assert.equal(close.settlement.data.transactions.length, 6);

  const cascade = cascadeLesson.run({ seed: cascadeLesson.seed, choices: ["bayes", "prediction-0"], policy: cascadeLesson.policy.baseline });
  assert.equal(sourceQuestion(cascade, 2), undefined);
  assert.equal(sourceQuestion(cascade, 3).tick, 3);
  const role = informationFrame(cascade, cascade.frames[3]);
  assert.doesNotMatch(role.actors.find(actor => actor.id === "D01").signal, /私人抽样 [AB]/);
  assert.match(role.actors.find(actor => actor.id === "D03").signal, /私人抽样 A/);
  assert.equal(actionsAt(cascade, 3).reveal, undefined);
  assert.ok(actionsAt(cascade, cascade.frames.length - 1).reveal?.state);
  const hidden = cascadeLesson.run({ seed: cascadeLesson.seed, choices: ["bayes", "prediction-0"], policy: cascadeLesson.policy.max });
  assert.doesNotMatch(informationFrame(hidden, hidden.frames[1]).events[0].text, /选择 [AB]/);
  assert.equal(hidden.records[1].data.signal, cascade.records[1].data.signal);
});

test("old demand receipts reopen with the corrected working view and their original digest", async () => {
  const lesson = auctionLesson(false);
  const course = { caseId: "double_auction" };
  const plan = { course, choices: ["96", "no"], seeds: pairedSeeds(lesson, false), policy: demandPolicy, prediction: "up" };
  const samples = await runSamples(lesson, plan);
  const legacy = await experimentCard(lesson, plan, samples, true);
  const current = await experimentCard(lesson, plan, samples);
  assert.notEqual(legacy.pairs[0].comparison.envelope.resultDigest.value,
    current.pairs[0].comparison.envelope.resultDigest.value);
  const restored = await reopenExperiment(lesson, course, legacy);
  assert.equal(restored.samples[0].branch.frames.find(frame => frame.record.event_type === "trade").events[0].deltas.platform_cash, 0);
  const original = legacy.pairs[0].comparison.evidence;
  const note = { course, choices: plan.choices, policy: demandPolicy, comparisonId: original.runId,
    comparisonEvent: original.frameTick, evidence: { comparison: original } };
  const source = await sourceRun(lesson, note, "comparison");
  assert.equal((await browserResultDigest(withLegacyDemandDeltas(source.run))).value, original.resultDigest.value);
  await assert.rejects(reopenExperiment(lesson, course, { ...legacy, planDigest: "wrong" }));
});
