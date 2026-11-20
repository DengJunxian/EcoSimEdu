import { readFileSync } from "node:fs";
import { beerLesson, carbonLesson } from "../src/models/allocation-lessons.ts";
import { commonsLesson, publicGoodsLesson } from "../src/models/cooperation-lessons.ts";
import { cascadeLesson, lemonsLesson, schoolLesson } from "../src/models/information-lessons.ts";
import { flashLesson, gameLesson } from "../src/models/markets-lessons.ts";
import { schellingLesson } from "../src/models/schelling-lesson.ts";

export const lessons = [schoolLesson, lemonsLesson, cascadeLesson, schellingLesson, publicGoodsLesson,
  commonsLesson, carbonLesson, beerLesson, gameLesson, flashLesson];

if (process.argv[2] === "--pipe") {
  const requests = JSON.parse(readFileSync(0, "utf-8"));
  for (const { id, choices, policy, seed: requestedSeed } of requests) {
    const lesson = lessons.find(candidate => candidate.id === id);
    const seed = requestedSeed ?? lesson.seed;
    const execute = seed === lesson.seed ? lesson.run : await lesson.prepareSeed(seed);
    const run = execute({ seed, choices, policy });
    console.log(JSON.stringify({ id, choices, policy, seed: run.seed, scenario: run.scenario, records: run.records,
      metrics: run.frames.map(frame => frame.metrics),
      ...(id === "schelling_segregation" ? { grids: run.frames.map(frame => frame.board) } : {}) }));
  }
}
