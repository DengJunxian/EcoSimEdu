import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import published from "../../cases/catalog.json" with { type: "json" };
import { classroomHref, classrooms, hasClassroom } from "../src/classroom-routes.ts";
import { concepts, courseById, pathways } from "../src/curriculum.ts";
import { outcome, peak } from "../src/lesson.ts";
import { svbLesson } from "../src/svb.ts";
import { toolLibrary } from "../src/tool-library.ts";
import { verifyLesson } from "./lesson-contract.mjs";

test("all twelve registered cases appear once under four ordered paths", () => {
  assert.equal(pathways.length, 4);
  const all = pathways.flatMap(path => path.courses);
  assert.deepEqual(all.map(course => course.id).sort(), [...published].sort());
  for (const path of pathways) {
    const seen = new Set();
    for (const course of path.courses) {
      const entry = JSON.parse(readFileSync(new URL(`../../cases/${course.id}/case.json`, import.meta.url)));
      assert.equal(course.title, entry.title);
      assert.ok(course.concepts.length && course.concepts.every(id => Object.hasOwn(concepts, id)));
      assert.ok((course.after ?? []).every(id => seen.has(id)));
      seen.add(course.id);
    }
  }
  assert.deepEqual(courseById.carbon_market.after, ["public_goods", "commons_governance"]);
  assert.deepEqual(courseById.gamestop.after, courseById.flash_crash.after);
});

test("published classrooms and original pages use same-origin routes", () => {
  assert.deepEqual(published.filter(hasClassroom), published);
  assert.ok(Object.keys(classrooms).includes("demo"));
  assert.equal(classroomHref("not/a/case"), "/learn/not%2Fa%2Fcase");
  for (const id of published) assert.equal(classroomHref(id), `?lesson=${id}`);
});

test("both existing lesson adapters satisfy the migration contract", () => {
  verifyLesson(toolLibrary, ["late", "short"], 4);
  verifyLesson(svbLesson, ["withdraw_now", "at-request"], 400);
});

test("an unavailable metric stays undefined and does not create a zero-valued peak", () => {
  const run = { id: "empty", seed: 0, frames: [
    { tick: 0, actors: [], metrics: { price: null }, events: [] },
    { tick: 1, actors: [], metrics: { price: null }, events: [] },
  ] };
  assert.equal(peak(run, "price"), null);
  assert.equal(outcome({ ...svbLesson, metricRoles: { ...svbLesson.metricRoles, comparison: "price" }, metrics: [{ id: "price" }] }, run), null);
  assert.equal(peak({ ...run, frames: [...run.frames, { metrics: { price: -2 } }] }, "price"), -2);
});
