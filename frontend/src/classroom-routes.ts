import { createElement } from "react";
import { originalLessonHref } from "../../content/student-navigation.ts";
import type { MigratedLesson } from "./models/course-lesson.ts";

function loadCourse(load: () => Promise<MigratedLesson>) {
  return async () => {
    const [{ ModelClassroom }, lesson] = await Promise.all([import("./ModelClassroom.tsx"), load()]);
    return { default: () => createElement(ModelClassroom, { lesson }) };
  };
}

export const classrooms = {
  double_auction: () => import("./AuctionClassroom.tsx"),
  svb_run: () => import("./SvbClassroom.tsx"),
  school_matching: loadCourse(() => import("./models/information-lessons.ts").then(module => module.schoolLesson)),
  lemons_market: loadCourse(() => import("./models/information-lessons.ts").then(module => module.lemonsLesson)),
  information_cascade: loadCourse(() => import("./models/information-lessons.ts").then(module => module.cascadeLesson)),
  schelling_segregation: loadCourse(() => import("./models/schelling-lesson.ts").then(module => module.schellingLesson)),
  public_goods: loadCourse(() => import("./models/cooperation-lessons.ts").then(module => module.publicGoodsLesson)),
  commons_governance: loadCourse(() => import("./models/cooperation-lessons.ts").then(module => module.commonsLesson)),
  carbon_market: loadCourse(() => import("./models/allocation-lessons.ts").then(module => module.carbonLesson)),
  beer_game: loadCourse(() => import("./models/allocation-lessons.ts").then(module => module.beerLesson)),
  gamestop: loadCourse(() => import("./models/markets-lessons.ts").then(module => module.gameLesson)),
  flash_crash: loadCourse(() => import("./models/markets-lessons.ts").then(module => module.flashLesson)),
  demo: () => import("./DemoClassroom.tsx"),
};

export function hasClassroom(id: string | null): id is keyof typeof classrooms {
  return id !== null && Object.hasOwn(classrooms, id);
}

export function classroomHref(caseId: string): string {
  return hasClassroom(caseId) ? `?${new URLSearchParams({ lesson: caseId })}` : originalLessonHref(caseId);
}
