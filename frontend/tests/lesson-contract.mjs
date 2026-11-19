import assert from "node:assert/strict";
import { legalChoice, outcome } from "../src/lesson.ts";
import { bankEventDeltas } from "../src/run-evidence.ts";

export function verifyLesson(lesson, choices, policy) {
  assert.ok(lesson.decisions.length >= 2 && lesson.decisions.length <= 3);
  assert.equal(choices.length, lesson.decisions.length);
  assert.ok(choices.every((choice, index) => legalChoice(lesson.decisions[index], choice)));
  assert.ok(policy !== lesson.policy.baseline && policy >= lesson.policy.min && policy <= lesson.policy.max);
  assert.equal((policy - lesson.policy.min) % (lesson.policy.step ?? 1), 0);

  const input = { seed: lesson.seed, choices };
  const baseline = lesson.run({ ...input, policy: lesson.policy.baseline });
  const treatment = lesson.run({ ...input, policy });
  assert.notEqual(baseline.id, treatment.id);
  const paired = lesson.policy.project ?? (run => run.frames);
  assert.deepEqual(paired(baseline).map(frame => frame.tick), paired(treatment).map(frame => frame.tick));
  assert.ok(baseline.frames.length >= 3);
  const actors = baseline.frames[0].actors.map(actor => actor.id);
  assert.ok(actors.length > 0);
  const uniqueActors = new Set(actors);
  assert.equal(uniqueActors.size, actors.length);

  for (const [run, value] of [[baseline, lesson.policy.baseline], [treatment, policy]]) {
    assert.equal(run.seed, input.seed);
    assert.deepEqual(run, lesson.run({ ...input, policy: value }));
    const events = new Map();
    for (const [tick, frame] of run.frames.entries()) {
      assert.equal(frame.tick, tick);
      assert.deepEqual(frame.actors.map(actor => actor.id), actors);
      assert.ok(frame.actors.every(actor => Object.hasOwn(lesson.states, actor.state)));
      for (const metric of lesson.metrics) {
        const reading = frame.metrics[metric.id];
        assert.ok(reading === null || Number.isFinite(reading), metric.id);
        const prior = run.frames[tick - 1]?.metrics[metric.id];
        if (typeof prior === "number" && typeof reading === "number") {
          const net = frame.events.reduce((sum, event) => sum + (bankEventDeltas(frame, run.frames[tick - 1], event)[metric.id] ?? 0), 0);
          assert.ok(Math.abs(reading - prior - net) < 1e-8, `${metric.id} in round ${tick}`);
        }
      }
      for (const event of frame.events) {
        assert.ok(!events.has(event.id));
        assert.ok(!event.actorId || uniqueActors.has(event.actorId));
        assert.ok(!event.counterpartyId || uniqueActors.has(event.counterpartyId));
        if (event.priorSignal) {
          const { tick: ref, metricId, value } = event.priorSignal;
          assert.ok(ref < tick);
          assert.equal(run.frames[ref].metrics[metricId], value);
        }
        for (const source of event.observed ?? []) {
          const original = events.get(source.eventId);
          assert.ok(source.tick < tick);
          assert.deepEqual(original, { tick: source.tick, actorId: source.actorId });
        }
        events.set(event.id, { tick, actorId: event.actorId });
      }
    }
    assert.notEqual(outcome(lesson, run), null, "choose a defined outcome for policy predictions");
  }
}
