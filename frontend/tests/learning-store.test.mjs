import assert from "node:assert/strict";
import { test } from "node:test";
import { auctionLesson } from "../src/auction.ts";
import { schellingLesson } from "../src/models/schelling-lesson.ts";
import { startLesson, transition } from "../src/lesson.ts";
import { allNotes, exportProgressArchive, latestProgress, restoreProgressArchive, resumeProgress, saveProgress, sourceLink, sourceRun } from "../src/learning-store.ts";

const storage = () => ({
  getItem(key) { return this[key] ?? null; },
  setItem(key, value) { this[key] = value; },
});
const auction = {caseId: "double_auction"};
const boundary = { ...auction, market: "no-overlap" };
const beforeTrade = [
  { type: "choose", option: "96" }, { type: "choose", option: "no" },
  { type: "next-stage" }, { type: "select", actorId: "B01" },
  { type: "step" }, { type: "next-stage" },
];
const step = { type: "step" };
const perform = (lesson, from, commands) => commands.reduce((state, command) => transition(lesson, state, command), from);

test("saved checkpoints retain legal choices, actor, cursor and reveal limit without storing or starting the run", () => {
  const disk = storage();
  const lesson = auctionLesson(false);
  for (const count of [1, 4, 6]) {
    const learning = perform(lesson, startLesson(lesson), beforeTrade.slice(0, count));
    saveProgress(disk, auction, learning);
    assert.deepEqual(resumeProgress(disk, auction, lesson), learning.run
      ? { ...learning, selected: learning.selected, focusedMetric: learning.focusedMetric } : learning);
  }
  const learning = perform(lesson, startLesson(lesson), [...beforeTrade, step, step, step, step, { type: "play" }, { type: "back" }]);
  assert.equal(learning.cursor, 3);
  assert.equal(learning.revealed, 4);
  saveProgress(disk, auction, { ...learning, playing: true });
  const tomorrow = resumeProgress(disk, auction, lesson);
  assert.deepEqual(tomorrow, learning);
  assert.equal(transition(lesson, tomorrow, { type: "locate", tick: 5, metricId: "price" }), tomorrow);
  assert.ok(Object.values(disk).every(value => typeof value !== "string" || !value.includes('"frames"')));
  assert.equal(resumeProgress(disk, boundary, auctionLesson(true)), undefined);
  assert.equal(latestProgress(disk, id => id === auction.caseId).stage, 3);
});

test("a completed comparison survives reopening and stale run IDs fail safely", () => {
  const disk = storage();
  const lesson = auctionLesson(false);
  const learning = perform(lesson, startLesson(lesson), [...beforeTrade, step, step, step, step, step,
    { type: "next-stage" }, { type: "policy", value: 6 }, { type: "predict", value: "down" }, { type: "compare" }]);
  saveProgress(disk, auction, learning);
  assert.equal(learning.stage, 4);
  assert.deepEqual(resumeProgress(disk, auction, lesson), learning);
  const key = Object.keys(disk).find(key => key.endsWith(auction.caseId));
  const saved = JSON.parse(disk[key]);
  disk[key] = JSON.stringify({ ...saved, comparisonId: "stale" });
  assert.equal(resumeProgress(disk, auction, lesson), undefined);
  disk[key] = JSON.stringify({ ...saved, choices: [109, "no"] });
  assert.equal(resumeProgress(disk, auction, lesson), undefined);
});

test("existing v1 explanations open both original Schelling source events without a rewrite", () => {
  const disk = storage();
  const lesson = schellingLesson;
  const choices = ["move", "prediction-0"];
  const left = lesson.run({ seed: lesson.seed, choices, policy: lesson.policy.baseline });
  const right = lesson.run({ seed: lesson.seed, choices, policy: lesson.policy.max });
  const savedAt = "2026-11-19T12:00:00.000Z";
  const key = `ecosimedu:progressive:explanation:v1:${left.id}|higher|${savedAt}|original-identifier`;
  const old = JSON.stringify({ baselineEvent: 1, comparisonEvent: 2, rule: "threshold", calculation: "adjacency",
    comparison: "same-seed", hypothesis: "limits", choices, savedAt, baselineId: left.id, comparisonId: right.id, prediction: "up" });
  disk.setItem(key, old);
  disk.setItem("civitas/schelling_segregation/lesson-v2", "old learner record");
  const [note] = allNotes(disk);
  assert.equal(note.course.caseId, "schelling_segregation");
  assert.equal(sourceRun(lesson, note, "baseline").run.id, left.id);
  assert.equal(sourceRun(lesson, note, "comparison").tick, 2);
  assert.match(sourceLink(note, "comparison"), /lesson=schelling_segregation/);
  assert.equal(disk.getItem(key), old);
  assert.equal(disk.getItem("civitas/schelling_segregation/lesson-v2"), "old learner record");
  assert.equal(sourceRun(lesson, { ...note, comparisonEvent: 10000 }, "comparison"), undefined);
});

test("a four-stage backup preserves the original keys and skips conflicting records", () => {
  const source = storage(), target = storage();
  const lesson = auctionLesson(false);
  const initial = perform(lesson, startLesson(lesson), beforeTrade);
  saveProgress(source, auction, initial);
  saveProgress(target, auction, perform(lesson, initial, [step]));
  source.setItem("civitas/double_auction/lesson-v2", "original classroom");
  const note = {
    baselineEvent: 1, comparisonEvent: 2, choices: ["96", "no"], prediction: "down",
    rule: "standing quote", calculation: "1 trade", comparison: "paired test", hypothesis: "costs",
    savedAt: "2026-11-19T12:00:00.000Z", baselineId: initial.run.id, comparisonId: "branch",
  };
  const noteKey = `ecosimedu:progressive:explanation:v1:${note.baselineId}|original`;
  source.setItem(noteKey, JSON.stringify(note, null, 2));
  const archive = exportProgressArchive(source);
  assert.equal(archive.entries.length, 2);
  assert.deepEqual(restoreProgressArchive(target, archive), { restored: 1, existing: 0, conflicts: 1, failed: 0 });
  assert.deepEqual(restoreProgressArchive(target, archive), { restored: 0, existing: 1, conflicts: 1, failed: 0 });
  assert.equal(resumeProgress(target, auction, lesson).cursor, 1);
  assert.equal(target.getItem(noteKey), source.getItem(noteKey));
  assert.equal(source.getItem("civitas/double_auction/lesson-v2"), "original classroom");
});

test("a malformed backup makes no writes and a storage failure can be retried", () => {
  const source = storage(), target = storage();
  const lesson = auctionLesson(false);
  saveProgress(source, auction, perform(lesson, startLesson(lesson), beforeTrade));
  const archive = exportProgressArchive(source);
  assert.throws(() => restoreProgressArchive(target, { ...archive,
    entries: [...archive.entries, ["civitas/double_auction/lesson-v2", "{}"]] }));
  assert.throws(() => restoreProgressArchive(target, { ...archive, entries: [...archive.entries, ...archive.entries] }));
  assert.deepEqual(exportProgressArchive(target).entries, []);
  assert.deepEqual(restoreProgressArchive({ ...target, setItem() { throw new Error("quota"); } }, archive),
    { restored: 0, existing: 0, conflicts: 0, failed: 1 });
  assert.equal(restoreProgressArchive(target, archive).restored, 1);
});
