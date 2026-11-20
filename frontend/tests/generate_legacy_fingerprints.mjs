// Run against a checkout of the exact legacy source, never against the edited engine.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { browserResultDigest } from "../src/browser-result.ts";

const sourceCommit = "8fc89711edb6a43e79e8b808ffb245edfdfe127b";
const legacy = process.argv[2];
if (!legacy || execFileSync("git", ["-C", legacy, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== sourceCommit ||
    execFileSync("git", ["-C", legacy, "status", "--porcelain", "--", "frontend", "cases"], { encoding: "utf8" }).trim()) {
  throw new Error(`Use a clean checkout at ${sourceCommit}`);
}
const read = path => import(pathToFileURL(resolve(legacy, path)).href);
const { auctionLesson } = await read("frontend/src/auction.ts");
const { svbLesson } = await read("frontend/src/svb.ts");
const { lessons } = await read("frontend/tests/remaining_parity.mjs");
const fingerprints = {};
for (const lesson of [auctionLesson(false), auctionLesson(true), svbLesson, ...lessons]) {
  const first = lesson.decisions[0];
  const actions = "options" in first ? first.options.map(option => option.id) :
    Array.from({ length: first.amount.max - first.amount.min + 1 }, (_, i) => String(first.amount.min + i));
  const prediction = lesson.decisions[1].options[0].id;
  for (const action of actions) {
    for (const policy of [lesson.policy.baseline, lesson.policy.max]) {
      const run = lesson.run({ seed: lesson.seed, choices: [action, prediction], policy });
      if (Object.hasOwn(fingerprints, run.id)) throw new Error(`Duplicate legacy ID ${run.id}`);
      fingerprints[run.id] = (await browserResultDigest(run)).value;
    }
  }
}
writeFileSync(new URL("../src/data/legacy-fingerprints.json", import.meta.url),
  JSON.stringify({ sourceCommit, scope: "browser-evidence/v1", fingerprints }, null, 2) + "\n");
console.log(`${Object.keys(fingerprints).length} legacy browser results fingerprinted at ${sourceCommit}`);
