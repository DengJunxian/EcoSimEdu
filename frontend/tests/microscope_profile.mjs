import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { microscope } from "../src/microscope.ts";
import { schellingLesson as lesson } from "../src/models/schelling-lesson.ts";
import { flashLesson } from "../src/models/markets-lessons.ts";

const profile = [30, 50].map(policy => {
  const run = lesson.run({ seed: lesson.seed, choices: ["move", "prediction-0"], policy });
  const asOf = run.frames.length - 1;
  const sample = tick => microscope(run, lesson, { tick }, asOf, "system", "A001", "similarity");
  const start = performance.now();
  assert.ok(sample(1).metric.identity);
  const firstMs = performance.now() - start;
  const timings = [];
  for (let index = 0; index < 400; index++) {
    const tick = (index * 7 + 1) % run.frames.length;
    const start = performance.now();
    const evidence = sample(tick);
    timings.push(performance.now() - start);
    assert.equal(evidence.point.tick, tick);
    assert.ok(evidence.links.every(link => link.point.tick <= asOf));
  }
  timings.sort((a, b) => a - b);
  return { policy, actors: run.frames[0].actors.length, frameCount: run.frames.length,
    firstMs, seeks: timings.length, medianMs: timings[200], p95Ms: timings[380] };
});
const flash = flashLesson.run({ seed: flashLesson.seed,
  choices: ["tight", "prediction-0"], policy: flashLesson.policy.baseline });
const denseClock = [...new Set(flash.records.map(event => event.period))];
console.log(JSON.stringify({ platform: process.platform, arch: process.arch, profile,
  dense: { frames: flash.frames.length, clock: flashLesson.casePackage.clock.label,
    first: Math.min(...denseClock), last: Math.max(...denseClock), distinct: denseClock.length } }, null, 2));
