import assert from "node:assert/strict";
import { test } from "node:test";
import { nextStageReady, peak, relatedActors, startLesson, transition } from "../src/lesson.ts";
import { toolLibrary as lesson } from "../src/tool-library.ts";

function advance(state, ...commands) {
  return commands.reduce((current, command) => transition(lesson, current, command), state);
}

const nextStage = { type: "next-stage" };
const step = { type: "step" };

function enterInspector() {
  return advance(startLesson(lesson),
    { type: "choose", option: "late" }, { type: "choose", option: "short" }, nextStage);
}

function enterBridge() {
  return advance(enterInspector(), { type: "select", actorId: "N01" }, step, nextStage);
}

test("only the current lesson stage can disclose another view", () => {
  const fresh = startLesson(lesson);
  assert.equal(advance(fresh, nextStage, step, { type: "policy", value: 4 }), fresh);
  assert.equal(advance(fresh, { type: "choose", option: "short" }), fresh);
  const inspected = enterInspector();
  assert.equal(inspected.stage, 2);
  assert.equal(inspected.cursor, 0);
  assert.equal(inspected.run.frames[0].actors.length, 24);
  assert.equal(advance(inspected, step, nextStage).stage, 2);
  assert.equal(advance(inspected, { type: "select", actorId: "absent" }).selected, undefined);
  const bridge = enterBridge();
  assert.equal(bridge.stage, 3);
  assert.equal(bridge.revealed, 0);
  assert.equal(advance(bridge, { type: "locate", tick: 7, metricId: "waiting" }), bridge);
  assert.equal(advance(bridge, step, nextStage).stage, 3);
  assert.equal(advance(bridge, step, step, nextStage).stage, 4);
});

test("replay pauses at a threshold crossing, links to contributors and rewinds exact frames", () => {
  const bridge = enterBridge();
  const paused = advance(bridge, { type: "play" }, step);
  assert.ok(paused.run.frames[1].turningPoint);
  assert.equal(paused.playing, false);
  assert.equal(paused.focusedMetric, "waiting");
  const revealed = advance(paused, step);
  const found = advance(revealed, { type: "locate", tick: 1, metricId: "waiting" });
  assert.equal(found.cursor, 1);
  assert.ok(relatedActors(found.run.frames[1], "waiting").includes(found.selected));
  assert.equal(advance(found, { type: "back" }).cursor, 0);
  const reset = advance(found, { type: "reset" });
  assert.equal(reset.cursor, 0);
  assert.equal(reset.revealed, revealed.revealed);
  assert.equal(reset.run, paused.run);
  assert.equal(advance(reset, step).run.frames[1], paused.run.frames[1]);
});

test("an intervention requires an updated prediction and runs with the same seed and decisions", () => {
  const lab = advance(enterBridge(), step, step, nextStage);
  assert.equal(nextStageReady(lesson, lab), false);
  assert.equal(advance(lab, { type: "predict", value: "down" }).prediction, undefined);
  const configured = advance(lab, { type: "policy", value: 4 });
  assert.equal(advance(configured, { type: "compare" }), configured);
  const changed = advance(configured, { type: "predict", value: "down" }, { type: "policy", value: 3 });
  assert.equal(changed.prediction, undefined);
  const result = advance(changed, { type: "predict", value: "up" }, { type: "compare" });
  assert.equal(result.run, lab.run);
  assert.deepEqual(result.comparison.run, lesson.run({ seed: lab.run.seed, choices: lab.choices, policy: 3 }));
  assert.equal(result.comparison.prediction, "up");
  assert.equal(advance(result, { type: "predict", value: "down" }), result);
  const retry = advance(result, { type: "new-comparison" });
  assert.equal(retry.prediction, undefined);
  assert.equal(retry.comparison, undefined);
  assert.equal(retry.run, lab.run);
});

test("seeded simulation preserves headcounts and each claimed local signal has a real prior frame", () => {
  for (const seed of [0, lesson.seed, 7919]) {
    for (const arrival of ["early", "late"]) for (const patience of ["short", "long"]) {
      const choices = [arrival, patience];
      const input = { seed, choices, policy: 2 };
      const baseline = lesson.run(input);
      assert.deepEqual(lesson.run(input), baseline);
      const branch = lesson.run({ ...input, policy: 4 });
      assert.deepEqual(branch.frames[0].actors, baseline.frames[0].actors);
      for (const run of [baseline, branch]) {
        for (const [index, frame] of run.frames.entries()) {
          assert.equal(frame.tick, index);
          assert.equal(new Set(frame.actors.map(actor => actor.id)).size, 24);
          assert.equal(frame.metrics.waiting, frame.actors.filter(actor => actor.state === "waiting").length);
          if (!index) continue;
          assert.equal(frame.metrics.waiting - run.frames[index - 1].metrics.waiting,
            frame.events.reduce((sum, event) => sum + event.deltas.waiting, 0));
          for (const event of frame.events) {
            assert.ok(frame.actors.some(actor => actor.id === event.actorId));
            if (event.priorSignal) {
              assert.equal(event.priorSignal.tick, index - 1);
              assert.equal(event.priorSignal.value, run.frames[index - 1].metrics[event.priorSignal.metricId]);
            }
          }
        }
      }
    }
  }
  const choices = ["late", "short"];
  assert.equal(peak(lesson.run({ seed: lesson.seed, choices, policy: 2 }), "waiting"), 7);
  assert.equal(peak(lesson.run({ seed: lesson.seed, choices, policy: 4 }), "waiting"), 5);
});
