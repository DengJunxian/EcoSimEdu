import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluate } from "../../student-web/src/learning/assessment.ts";
import { localReviewChoice, reviewChoices, reviewSignal } from "../../student-web/src/learning/review-choice.ts";

test("published parallel review questions use the latest scored local evidence without changing the due goal", () => {
  const cases = { schelling_segregation: [4, 75], svb_run: [5, 9, 11], double_auction: [8, 33] };
  for (const [case_id, response] of Object.entries(cases)) {
    const pack = JSON.parse(readFileSync(new URL(`../../cases/${case_id}/learning-v3.json`, import.meta.url)));
    const due = { case_id, content_version: pack.content_version, outcome_id: `${case_id}.1`, profile: "personal" };
    const independent = {
      case_id, content_version: due.content_version, local_profile_id: due.profile, outcome_ids: [due.outcome_id],
      assessment_role: "independent", evaluation: { result: "correct" }, exposure: { max_hint_level: 0 },
      evidence_class: "independent",
    };
    const incorrect = { ...independent, evaluation: { result: "incorrect" } };
    const assisted = { ...independent, evidence_class: "assisted", exposure: { max_hint_level: 1 } };
    const repeated = { ...independent, evidence_class: "repeated" };
    const choices = reviewChoices(pack, due);
    assert.equal(localReviewChoice(choices, reviewSignal(due, [independent, incorrect])).item.id, "review-1");
    const unrelated = [
      { ...incorrect, local_profile_id: "demo" },
      { ...incorrect, content_version: "0.9.0" },
      { ...incorrect, outcome_ids: [`${case_id}.2`] },
      { ...incorrect, assessment_role: "review" },
    ];
    assert.equal(reviewSignal(due, unrelated), undefined);
    assert.equal(localReviewChoice(choices, reviewSignal(due, unrelated)).item.id, "review-1");
    for (const entry of [incorrect, assisted, repeated]) {
      const { item } = localReviewChoice(choices, reviewSignal(due, [...unrelated, entry]));
      assert.equal(item.id, "review-1-reinforce");
      assert.equal(item.assessment_role, "review");
      assert.deepEqual(item.outcome_ids, [due.outcome_id]);
      assert.equal(evaluate(item, response).result, "correct");
      assert.equal(evaluate(item, response.map(value => value - 1)).result, "incorrect");
    }
    assert.deepEqual(reviewChoices(pack, { ...due, content_version: "0.9.0" }), []);
  }
});
