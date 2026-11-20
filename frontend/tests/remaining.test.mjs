import assert from "node:assert/strict";
import { test } from "node:test";
import { transition, startLesson } from "../src/lesson.ts";
import { lessons } from "./remaining_parity.mjs";
import { verifyLesson } from "./lesson-contract.mjs";

for (const lesson of lessons) {
  test(`${lesson.id} replays deterministic evidence and compares at matched decision periods`, () => {
    const choice = lesson.decisions[0].options[0].id;
    const input = { seed: lesson.seed, choices: [choice, "prediction-0"], policy: lesson.policy.baseline };
    verifyLesson(lesson, input.choices, lesson.policy.max);
    assert.throws(() => lesson.run({ ...input, seed: lesson.seed + 1 }));
    assert.throws(() => lesson.run({ ...input, choices: ["unavailable", "prediction-0"] }));
    const run = lesson.run(input);
    for (const frame of run.frames) {
      for (const event of frame.events) {
        for (const source of event.sourceEvents ?? []) {
          assert.ok(run.records[source.tick] && source.tick < frame.tick);
        }
      }
    }
  });
}

test("range and metric lookup cannot disclose future evidence", () => {
  const lesson = lessons.find(entry => entry.id === "schelling_segregation");
  let session = startLesson(lesson);
  for (const command of [{ type: "choose", option: "move" }, { type: "choose", option: "prediction-0" },
    { type: "next-stage" }, { type: "select", actorId: "A001" }, { type: "step" }, { type: "next-stage" }]) {
    session = transition(lesson, session, command);
  }
  const before = session;
  assert.equal(session.revealed, 0);
  assert.equal(transition(lesson, session, { type: "locate", tick: 1, metricId: "similarity" }), before);
  session = transition(lesson, session, { type: "go-to-turn" });
  const record = session.run.records[session.cursor];
  assert.equal(record.event_type, "student_move");
  assert.equal(record.data.actor_id, "A001");
  assert.ok(record.data.changed_neighbors.length > 0);
  assert.equal(session.selected, "A001");
  assert.equal(session.revealed, session.cursor);
  assert.equal(transition(lesson, session, { type: "locate", tick: 2, metricId: "similarity" }), session);
});
