import { readFileSync } from "node:fs";
import { beerLesson, carbonLesson } from "../src/models/allocation-lessons.ts";
import { commonsLesson, publicGoodsLesson } from "../src/models/cooperation-lessons.ts";
import { cascadeLesson, lemonsLesson, schoolLesson } from "../src/models/information-lessons.ts";
import { flashLesson, gameLesson } from "../src/models/markets-lessons.ts";
import { forkSchelling } from "../src/models/schelling.ts";
import { schellingLesson } from "../src/models/schelling-lesson.ts";
import { completionAnchor, explanationSource, relocationAnchor, relocationAt } from "../src/learning/tutor/schelling-evidence.ts";
import { courseEventFocus, supportsCourseEvent } from "../src/learning/tutor/course-event-evidence.ts";

export const lessons = [schoolLesson, lemonsLesson, cascadeLesson, schellingLesson, publicGoodsLesson,
  commonsLesson, carbonLesson, beerLesson, gameLesson, flashLesson];

if (process.argv[2] === "--pipe") {
  const requests = JSON.parse(readFileSync(0, "utf-8"));
  for (const { id, choices, policy, seed: requestedSeed, relocation } of requests) {
    const lesson = lessons.find(candidate => candidate.id === id);
    const seed = requestedSeed ?? lesson.seed;
    const execute = seed === lesson.seed ? lesson.run : await lesson.prepareSeed(seed);
    const original = execute({ seed, choices, policy });
    const run = relocation ? forkSchelling(original, relocation.checkpoint, relocation.destination) : original;
    const tutorAnchors = !relocation && id === schellingLesson.id && seed === schellingLesson.seed && run.scenario === "baseline"
      ? await Promise.all(run.records.filter(({ seq }) => relocationAt(run, seq))
        .map(({ seq }) => relocationAnchor(run, seq, schellingLesson.casePackage)))
      : undefined;
    const tutorClose = !relocation && id === schellingLesson.id && seed === schellingLesson.seed
      ? await completionAnchor(run, schellingLesson.casePackage) : undefined;
    const reviewSource = relocation ? await explanationSource(run, run.records.at(-1).seq, schellingLesson.casePackage) : undefined;
    const publicFocuses = !relocation && id !== schellingLesson.id && seed === lesson.seed
      ? await Promise.all(run.records.filter(({ seq }) => supportsCourseEvent(run, seq))
        .map(({ seq }) => courseEventFocus(run, seq, lesson.casePackage))) : undefined;
    console.log(JSON.stringify({ id, choices, policy, seed: run.seed, scenario: run.scenario, records: run.records,
      metrics: run.frames.map(frame => frame.metrics), tutorAnchors, tutorClose, reviewSource, publicFocuses,
      ...(id === "schelling_segregation" ? { grids: run.frames.map(frame => frame.board) } : {}) }));
  }
}
