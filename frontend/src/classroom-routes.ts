import type { BrowserPanelProps } from "../../content/domain-panel.ts";
import { createElement, type ComponentType } from "react";
import { originalLessonHref } from "../../content/student-navigation.ts";
import type { MigratedLesson } from "./models/course-lesson.ts";

function loadCourse(load: () => Promise<MigratedLesson>, panel?: () => Promise<ComponentType<BrowserPanelProps>>) {
  return async () => {
    const [{ ModelClassroom }, lesson, Panel] = await Promise.all([import("./ModelClassroom.tsx"), load(), panel?.()]);
    return { default: () => createElement(ModelClassroom, { lesson, Panel }) };
  };
}

function loadInformation(load: () => Promise<MigratedLesson>) {
  return async () => {
    const [{ InformationClassroom }, lesson] = await Promise.all([import("./InformationClassroom.tsx"), load()]);
    return { default: () => createElement(InformationClassroom, { lesson }) };
  };
}

export const classrooms = {
  double_auction: () => import("./AuctionClassroom.tsx"),
  svb_run: () => import("./SvbClassroom.tsx"),
  school_matching: loadInformation(() => import("./models/information-lessons.ts").then(module => module.schoolLesson)),
  lemons_market: loadInformation(() => import("./models/information-lessons.ts").then(module => module.lemonsLesson)),
  information_cascade: loadInformation(() => import("./models/information-lessons.ts").then(module => module.cascadeLesson)),
  schelling_segregation: () => import("./SchellingClassroom.tsx"),
  public_goods: loadCourse(() => import("./models/cooperation-lessons.ts").then(module => module.publicGoodsLesson),
    () => import("../../student-web/src/cases/cooperation/panels.tsx").then(module => module.PublicGoodsPanel)),
  commons_governance: loadCourse(() => import("./models/cooperation-lessons.ts").then(module => module.commonsLesson),
    () => import("../../student-web/src/cases/cooperation/panels.tsx").then(module => module.CommonsPanel)),
  carbon_market: loadCourse(() => import("./models/allocation-lessons.ts").then(module => module.carbonLesson),
    () => import("../../student-web/src/cases/markets/panels.tsx").then(module => module.CarbonPanel)),
  beer_game: loadCourse(() => import("./models/allocation-lessons.ts").then(module => module.beerLesson),
    () => import("../../student-web/src/cases/allocation/panels.tsx").then(module => module.BeerPanel)),
  gamestop: loadCourse(() => import("./models/markets-lessons.ts").then(module => module.gameLesson),
    () => import("../../student-web/src/cases/markets/panels.tsx").then(module => module.GameStopPanel)),
  flash_crash: loadCourse(() => import("./models/markets-lessons.ts").then(module => module.flashLesson),
    () => import("../../student-web/src/cases/markets/panels.tsx").then(module => module.FlashCrashPanel)),
  demo: () => import("./DemoClassroom.tsx"),
};

export function hasClassroom(id: string | null): id is keyof typeof classrooms {
  return id !== null && Object.hasOwn(classrooms, id);
}

export function classroomHref(caseId: string): string {
  return hasClassroom(caseId) ? `?${new URLSearchParams({ lesson: caseId })}` : originalLessonHref(caseId);
}
