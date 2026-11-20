import assert from "node:assert/strict";
import { test } from "node:test";
import { browserResultDigest } from "../src/browser-result.ts";
import { domainView } from "../src/domain-view.ts";
import { lessons } from "./remaining_parity.mjs";

// Evidence digests captured from the browser models at 48b0ad8.
const samples = [
  ["public_goods", "0", 2,
    "82d700059d51f0b6464441b117a21d8c4787cbe9b7473e0955329ad9637ba15c",
    "bbb8c67ab612177af856f19c28bac641d433c69bd1b425b8ce6a986b733eb150"],
  ["commons_governance", "0", 2,
    "8d08008b39acd6caa38ddb5444b70862fe67a020c25fea5391cbc76462958f93",
    "7f1eba89fb038f0c7f7723028a96d94edc4c1a8b5d72ea301929dcb38d003e2c"],
  ["carbon_market", "0", 2,
    "100c067ad5d62ce15a4e535d71e8ac411119ea8d10423193723b658bf4e19f60",
    "bce945427c14353c0cb42bcd906c41787457f5e46c4c62a1f20dd5d416ed8bab"],
  ["beer_game", "8", 6,
    "a079a6162d365e054fc03fd3356dd24d7ccfcd45a24796b1d993f94c358c92b5",
    "8b1c9953032b9928b84b0e56acc77ac6f7fc1b2e9ece77ef60a384aaf9af92dc"],
  ["gamestop", "buy", 34,
    "2d5df1a56bf2402998fafed4dca20d29404734bae1965ca68a49a4572063fb91",
    "116fcc806ad1f8e0f387303bd3b2b403d7fbc20ec2c4f617d38284e26892b5c9"],
  ["flash_crash", "tight", 150,
    "7f7faf9b2e72d3672727af555e12c435f80259a7835fd7e535c5256f58762cac",
    "d405cc2ec0f38ae385942b41d453555cf8220f13a9ebb0bb2899de286b003a7c"],
];

for (const [id, action, tick, original, paired] of samples) {
  test(`${id} panel stops at the cursor and both saved run digests still match`, async () => {
    const lesson = lessons.find(lesson => lesson.id === id);
    const input = { seed: lesson.seed, choices: [action, "prediction-0"], policy: lesson.policy.baseline };
    const run = lesson.run(input);
    const view = domainView(run, tick);
    assert.equal(view.run_id, run.id);
    assert.equal(view.origin, "browser_rule_engine");
    assert.equal(view.closed, false);
    assert.deepEqual(view.events.map(event => [event.seq, event.event_type, event.summary]),
      run.records.slice(0, tick + 1).map(row => [row.seq, row.event_type, row.summary]));
    assert.deepEqual(view.previous.metrics, run.frames[tick - 1].metrics);
    assert.ok(domainView(run, tick - 1).events.every(event => event.seq < tick));
    assert.equal((await browserResultDigest(run)).value, original);
    assert.equal((await browserResultDigest(lesson.run({ ...input, policy: lesson.policy.max }))).value, paired);
  });
}
