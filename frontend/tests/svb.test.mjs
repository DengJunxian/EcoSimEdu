import assert from "node:assert/strict";
import { test } from "node:test";
import { outcome, startLesson, transition } from "../src/lesson.ts";
import { svbLesson, simulateSvb } from "../src/svb.ts";

const input = { seed: svbLesson.seed, choices: ["withdraw_now", "at-request"], policy: 0 };

test("SVB records are deterministic and reconcile amounts, securities, and cash", () => {
  for (const action of ["withdraw_now", "withdraw_later"]) for (const policy of [0, 400]) {
    const parameters = { ...input, choices: [action, "at-payment"], policy };
    const run = simulateSvb(parameters);
    assert.deepEqual(simulateSvb(parameters), run);
    assert.equal(run.frames.length, 21);
    const opening = run.frames[0].metrics;
    const totalCash = opening.cash + opening.marketCash + opening.supportCash;
    let prior;
    for (const frame of run.frames) {
      const m = frame.metrics;
      assert.equal(frame.actors.length, 60);
      assert.equal(new Set(frame.actors.map(actor => actor.id)).size, 60);
      assert.equal(m.queued, m.requested - m.paid);
      assert.equal(m.deposits, opening.deposits - m.paid);
      assert.equal(m.equity, m.cash + m.marketValue + m.loans - m.deposits - m.borrowing);
      assert.equal(m.units + m.sold, opening.units);
      assert.equal(m.cash + m.marketCash + m.supportCash + m.paid, totalCash);
      for (const event of frame.events) {
        if (event.kind === "request") assert.equal(event.deltas.cash, undefined);
        if (event.kind === "payment") assert.equal(event.deltas.cash, event.deltas.deposits);
        for (const source of event.observed ?? []) {
          assert.ok(source.tick < frame.tick);
          assert.ok(run.frames[source.tick].events.some(origin =>
            origin.id === source.eventId && origin.actorId === source.actorId && origin.kind === "request"));
        }
        if (event.priorSignal) {
          assert.equal(event.priorSignal.tick, frame.tick - 1);
          assert.equal(event.priorSignal.value, prior.queued);
          assert.ok(prior.queued > 0);
        }
      }
      if (prior) {
        for (const metric of ["queued", "requested", "paid", "cash", "equity", "sale_loss", "price"]) {
          assert.equal(m[metric] - prior[metric],
            frame.events.reduce((sum, event) => sum + (event.deltas[metric] ?? 0), 0));
        }
      }
      prior = m;
    }
  }
});

test("SVB anchors separate positive equity, queue signal, and same-seed intervention", () => {
  const baseline = simulateSvb(input);
  const alternative = simulateSvb({ ...input, policy: 400 });
  const [baseStart, policyStart] = [baseline.frames[0].metrics, alternative.frames[0].metrics];
  assert.deepEqual(baseline.frames[0].actors, alternative.frames[0].actors);
  assert.equal(baseStart.equity, policyStart.equity);
  assert.equal(baseStart.cash + baseStart.marketValue, policyStart.cash + policyStart.marketValue);
  assert.equal(policyStart.cash - baseStart.cash, 400);
  assert.equal(baseline.frames.find(frame => frame.turningPoint).tick, 2);
  assert.equal(baseline.frames[2].metrics.queued, 107);
  assert.equal(baseline.frames[2].metrics.equity, 155);
  const request = baseline.frames[3].events.find(event => event.actorId === "D01" && event.kind === "request");
  assert.deepEqual(request.priorSignal, { metricId: "queued", tick: 2, value: 107 });
  assert.match(request.text, /其他信号已足以达到阈值/);
  assert.equal(outcome(svbLesson, baseline), 257);
  assert.equal(outcome(svbLesson, alternative), 97);
  assert.ok(alternative.frames[3].metrics.queued > baseline.frames[2].metrics.queued);
  assert.throws(() => simulateSvb({ ...input, policy: 100 }));
  assert.throws(() => simulateSvb({ ...input, seed: 0 }));
});

test("SVB bridge waits for feedback and exposes only legal policy steps", () => {
  const commands = [
    { type: "choose", option: "withdraw_now" }, { type: "choose", option: "at-request" },
    { type: "next-stage" }, { type: "select", actorId: "D01" }, { type: "step" },
    { type: "next-stage" }, { type: "play" }, { type: "step" }, { type: "step" },
  ];
  const advance = (state, command) => transition(svbLesson, state, command);
  const paused = commands.reduce(advance, startLesson(svbLesson));
  assert.equal(paused.stage, 3);
  assert.equal(paused.cursor, 2);
  assert.equal(paused.playing, false);
  assert.equal(advance(paused, { type: "next-stage" }), paused);
  assert.equal(advance(paused, { type: "locate", metricId: "queued", tick: 3 }), paused);
  const lab = [{ type: "step" }, { type: "next-stage" }].reduce(advance, paused);
  assert.equal(lab.stage, 4);
  assert.equal(advance(lab, { type: "policy", value: 100 }), lab);
  const result = [{ type: "policy", value: 400 }, { type: "predict", value: "up" },
    { type: "compare" }].reduce(advance, lab);
  assert.equal(result.comparison.prediction, "up");
  assert.equal(result.run, paused.run);
  assert.equal(result.comparison.run.seed, paused.run.seed);
});
