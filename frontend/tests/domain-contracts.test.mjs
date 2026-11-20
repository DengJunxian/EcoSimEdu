import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "../../tests/fixtures/progressive-note-8fc8971.json" with { type: "json" };
import catalog from "../../cases/catalog.json" with { type: "json" };
import fingerprints from "../src/data/legacy-fingerprints.json" with { type: "json" };
import { auctionLesson } from "../src/auction.ts";
import { casePackages } from "../src/domain-contracts.ts";
import { browserResultDigest } from "../src/browser-result.ts";
import { readNote, sourceRun } from "../src/learning-store.ts";
import { chartMetric, comparisonMetric, outcome } from "../src/lesson.ts";
import { browserEnvelope, browserEvents, browserEvidence, evidencePointer } from "../src/run-evidence.ts";
import { distributedPolicy, svbLesson } from "../src/svb.ts";
import { lessons } from "./remaining_parity.mjs";

const auction = auctionLesson(false);
const legacyNote = () => readNote({ getItem: key => key === fixture.storageKey ? fixture.storedValue : null },
  fixture.storageKey.split("explanation:v1:")[1]);
const input = (lesson, choices, policy = lesson.policy.baseline) => ({ seed: lesson.seed, choices, policy });

test("the twelve explicit metric roles and original case identities survive order changes", () => {
  assert.deepEqual([...casePackages.keys()], catalog);
  for (const lesson of [auction, svbLesson, ...lessons]) {
    const p = lesson.casePackage;
    assert.equal(lesson.source.kind, p.identity);
    assert.ok(p.sourceReferences.length && p.rights.length && p.modelAssumptions.length);
    assert.ok(p.learningOutcomes.length);
    assert.ok(p.metrics.every(m => m.definition && m.undefinedReason));
    assert.equal(chartMetric(lesson).id, p.browserMetricRoles.observation);
    assert.equal(comparisonMetric({ ...lesson, metrics: lesson.metrics.toReversed() }).id, p.browserMetricRoles.comparison);
    const choices = lesson.decisions.map(d => d.options?.[0].id ?? String(d.amount.suggested));
    const run = lesson.run(input(lesson, choices));
    assert.equal(outcome(lesson, run), run.frames.at(-1).metrics[p.browserMetricRoles.comparison] ?? null);
  }
  assert.equal(casePackages.get("double_auction").identity, "academic_experiment");
  assert.equal(casePackages.get("schelling_segregation").identity, "theoretical_model");
  assert.equal(casePackages.get("svb_run").identity, "historical_event");
});

test("actual 8fc8971 notes resolve both exact trades and reject a replay under the same ID with changed content", async () => {
  const note = legacyNote();
  assert.equal(fixture.sourceCommit, fingerprints.sourceCommit);
  assert.equal(Object.keys(fingerprints.fingerprints).length, 358);
  assert.equal(note.evidence, undefined);
  for (const side of ["baseline", "comparison"]) {
    const read = await sourceRun(auction, note, side);
    assert.equal(read.verification, "legacy");
    assert.equal(read.event.eventId, String(fixture.comparisonTrade.seq));
    assert.deepEqual(read.event.actorIds, [fixture.comparisonTrade.buyer_id, fixture.comparisonTrade.seller_id]);
    assert.equal(read.event.record.price, fixture.comparisonTrade.price);
    assert.equal(read.event.sourceEvents.length, 2);
  }

  for (const alter of [
    frame => ({ ...frame, metrics: { ...frame.metrics, price: 91 } }),
    frame => ({ ...frame, record: { ...frame.record, seller_id: "S07" } }),
  ]) {
    const altered = { ...auction, run(args) {
      const run = auction.run(args);
      return { ...run, frames: run.frames.map(frame => frame.tick === 4 ? alter(frame) : frame) };
    } };
    for (const side of ["baseline", "comparison"]) assert.equal(await sourceRun(altered, note, side), undefined);
  }
});

test("new pointers check both case and content versions, event and digest before resolving", async () => {
  const note = legacyNote();
  const run = auction.run(input(auction, note.choices));
  const envelope = await browserEnvelope(run, auction.casePackage, { choices: note.choices });
  assert.deepEqual(await browserResultDigest(auction.run(input(auction, note.choices))), envelope.resultDigest);
  const events = browserEvents(run, auction.casePackage, 4);
  assert.ok(events.every(event => event.frameTick <= 4));
  const event = events.at(-1);
  assert.throws(() => browserEvidence(envelope, event, 3));
  assert.throws(() => browserEvidence(envelope, { ...event, runId: "another-run" }, 4));
  const baseline = evidencePointer(browserEvidence(envelope, event, 4));
  assert.equal((await sourceRun(auction, { ...note, evidence: { baseline } }, "baseline")).verification, "saved");
  for (const versions of [{ ...baseline.versions, content: "other" }, { ...baseline.versions, engine: "other" }]) {
    assert.equal(await sourceRun(auction, { ...note, evidence: { baseline: { ...baseline, versions } } }, "baseline"), undefined);
  }
  assert.equal(await sourceRun(auction, { ...note, evidence: { baseline: { ...baseline,
    resultDigest: { ...baseline.resultDigest, value: "0".repeat(64) },
  } } }, "baseline"), undefined);
});

test("SVB round time and actual application and payment IDs stay distinct", () => {
  const run = svbLesson.run(input(svbLesson, ["withdraw_now", "at-payment"]));
  const events = browserEvents(run, svbLesson.casePackage, 1);
  const application = events.find(event => event.kind === "request" && event.actorIds.includes("D01"));
  const payment = events.find(event => event.kind === "payment" && event.actorIds.includes("D01"));
  assert.notEqual(application.eventId, payment.eventId);
  assert.equal(payment.sequence, null);
  assert.equal(payment.economicTime.value, 1);
  assert.equal(application.record.deltas.cash, undefined);
  assert.equal(payment.record.deltas.cash, -19);
  assert.deepEqual(payment.sourceEvents, []);
});

test("SVB keeps the old run digests and verifies the original event of a network comparison", async () => {
  const choices = ["withdraw_now", "at-payment"];
  const old = [0, svbLesson.policy.max].map(policy => svbLesson.run(input(svbLesson, choices, policy)));
  for (const run of old) assert.equal((await browserResultDigest(run)).value, fingerprints.fingerprints[run.id]);
  const branch = svbLesson.run(input(svbLesson, choices, distributedPolicy));
  const course = svbLesson.casePackage;
  const event = browserEvents(branch, course, 1).find(row => row.kind === "payment");
  const envelope = await browserEnvelope(branch, course, { choices, policy: distributedPolicy });
  const note = { choices, baselineId: old[0].id, comparisonId: branch.id, comparisonEvent: event.frameTick,
    policy: distributedPolicy, evidence: { comparison: evidencePointer(browserEvidence(envelope, event, 1)) } };
  assert.equal((await sourceRun(svbLesson, note, "comparison")).event.eventId, event.eventId);
  assert.equal(await sourceRun(svbLesson, { ...note, policy: 1 }, "comparison"), undefined);
});
