import assert from "node:assert/strict";
import { test } from "node:test";
import { browserResultDigest } from "../src/browser-result.ts";
import { exportProgressArchive, restoreProgressArchive, resumeProgress, saveProgress } from "../src/learning-store.ts";
import { startLesson, transition } from "../src/lesson.ts";
import { schellingLesson as lesson } from "../src/models/schelling-lesson.ts";
import { forkSchelling, residentOptions, schellingCheckpoint } from "../src/models/schelling.ts";

const choices = ["move", "prediction-0"];
const course = { caseId: "schelling_segregation" };

function storage() {
  return {
    getItem(key) { return this[key] ?? null; },
    setItem(key, value) { this[key] = value; },
  };
}

test("a Schelling fork leaves the parent intact and recomputes from the exact round-end state", async () => {
  const parent = lesson.run({ seed: lesson.seed, choices, policy: 30 });
  const original = await browserResultDigest(parent);
  const checkpoint = parent.frames.find(frame => schellingCheckpoint(parent, frame.tick));
  const { tick, board } = checkpoint;
  const { origin, legal } = residentOptions(board.cells, "A001", 30);
  const { cell } = legal[0];
  const child = forkSchelling(parent, tick, cell);
  assert.equal(tick, 73);
  assert.notEqual(child.id, parent.id);
  assert.equal(child.seed, parent.seed);
  assert.deepEqual(child.frames.slice(0, tick + 1), parent.frames.slice(0, tick + 1));
  assert.deepEqual(child.records.slice(0, tick + 1), parent.records.slice(0, tick + 1));
  assert.equal(child.records[tick + 1].data.checkpoint_event, tick);
  assert.equal(child.frames[tick + 1].board.cells[origin], null);
  assert.equal(child.frames[tick + 1].board.cells[cell], "A001");
  assert.equal(child.frames[tick + 1].metrics.moves, parent.frames[tick].metrics.moves + 1);
  assert.notDeepEqual(child.records[tick + 2].data, parent.records[tick + 1].data);
  assert.equal(child.frames.at(-1).metrics.similarity, 86.94);
  assert.equal(parent.frames.at(-1).metrics.similarity, 84.55);
  const population = [...board.cells].sort();
  for (const frame of child.frames) assert.deepEqual([...frame.board.cells].sort(), population);
  assert.deepEqual(await browserResultDigest(parent), original);
  assert.deepEqual(await browserResultDigest(child), await browserResultDigest(forkSchelling(parent, tick, cell)));
  const ineligible = board.cells.findIndex((occupant, index) => occupant === null && !legal.some(option => option.cell === index));
  assert.ok(ineligible >= 0);
  assert.throws(() => forkSchelling(parent, tick, ineligible), /不可用于/);
  assert.throws(() => forkSchelling(parent, tick, origin), /不可用于/);
  assert.throws(() => forkSchelling(parent, tick, -1), /不可用于/);
  assert.throws(() => forkSchelling(parent, 1, cell), /不可用于/);
  assert.throws(() => forkSchelling(parent, parent.frames.length - 2, cell), /不可用于/);
  assert.throws(() => forkSchelling(child, tick, cell), /不可用于/);
});

test("the reducer gates the branch and a backup restores the original prediction and both run identities", () => {
  const run = lesson.run({ seed: lesson.seed, choices, policy: 30 });
  const { tick, board } = run.frames.find(frame => schellingCheckpoint(run, frame.tick));
  const { legal } = residentOptions(board.cells, "A001", 30);
  const stage = { ...startLesson(lesson), stage: 3, run, choices };
  const request = { type: "fork-run", checkpoint: tick, destination: legal[0].cell, prediction: "up" };
  assert.equal(transition(lesson, stage, request), stage);
  const role = { ...stage, perspective: "role" };
  assert.equal(transition(lesson, role, { type: "seek-checkpoint", tick }), role);
  const paused = transition(lesson, stage, { type: "seek-checkpoint", tick });
  assert.equal(paused.cursor, tick);
  assert.equal(paused.revealed, tick);
  assert.ok(!paused.playing);
  const compared = transition(lesson, paused, request);
  assert.equal(compared.revealed, tick);
  assert.equal(compared.run, run);
  assert.equal(compared.fork.prediction, "up");
  const first = storage();
  const saved = saveProgress(first, course, compared);
  assert.equal(JSON.parse(saved).fork.run, undefined);
  const second = storage();
  restoreProgressArchive(second, exportProgressArchive(first));
  const reopened = resumeProgress(second, course, lesson);
  assert.equal(reopened.run.id, run.id);
  assert.equal(reopened.revealed, tick);
  assert.equal(reopened.fork.run.id, compared.fork.run.id);
  assert.deepEqual(reopened.fork.run.frames.at(-1).metrics, compared.fork.run.frames.at(-1).metrics);
  assert.equal(reopened.fork.prediction, "up");
  const invalid = JSON.parse(saved);
  invalid.fork.runId = "another-run";
  first.setItem("ecosimedu:progressive:progress:v1:schelling_segregation", JSON.stringify(invalid));
  const parentOnly = resumeProgress(first, course, lesson);
  assert.equal(parentOnly.run.id, run.id);
  assert.equal(parentOnly.fork, undefined);
});
