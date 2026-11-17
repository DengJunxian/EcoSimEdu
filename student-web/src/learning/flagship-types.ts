import type { ComponentType } from "react";
import type { Course, Event, Frame, LessonRun } from "../lesson-types";

export const fieldFlagships = [
  "svb_run", "schelling_segregation", "information_cascade", "public_goods", "commons_governance",
  "lemons_market", "school_matching", "beer_game", "carbon_market", "flash_crash", "gamestop",
] as const;
export type FieldFlagship = typeof fieldFlagships[number];
export function isFieldFlagship(id: string): id is FieldFlagship {
  return fieldFlagships.some(caseId => caseId === id);
}

export type Tick = number | "close" | "checkpoint";
export type FlagshipView = Pick<LessonRun, "run_id" | "case_id" | "case_version" | "result_hash" | "scenario_id" |
  "origin" | "seed" | "action" | "parent_run_id"> & {
  engine_version: string;
  root_hash: string;
  initial_hash: string;
  intervention: LessonRun["result"]["intervention"];
  tick: number;
  end: number | null;
  closed: boolean;
  clock: number | null;
  clock_label?: string;
  checkpoint_here: boolean;
  frame: Frame;
  previous: Frame | null;
  events: (Event & Record<string, unknown>)[];
  series: Pick<Frame, "metrics">[];
  details?: unknown;
};

export type DomainPanelProps = {
  stage: string;
  course: Course;
  briefing: unknown;
  action: string;
  view?: FlagshipView;
  comparison?: FlagshipView;
  tick: number;
  pinned: string;
  pin: (actor: string) => void;
  seek: (tick: Tick) => void;
  cite: (seq: number, actor?: string, arm?: "baseline" | "comparison") => void;
  review: boolean;
  record?: (key: string, value: string) => void;
  records?: Record<string, string>;
};

export type FieldLesson = { caseId: FieldFlagship; Panel: ComponentType<DomainPanelProps>; defaultActor: string };

export type SceneSelector = {
  event_type: string; actor_id?: string; fields: string[];
  equals?: Record<string, string | number | boolean | null>;
  nonempty?: string;
  metric_positive?: string;
};
export type SceneQuestion = {
  id: string; prompt: string; kind?: "concept" | "prediction"; selector?: SceneSelector;
  options: { id: string; label: string; feedback: string }[];
};
export type Scene = {
  id: string; title: string; question: string; objective: string; information: string[];
  questions: SceneQuestion[]; next_scene: string | null;
  evidence?: { selector: SceneSelector; missing: string };
  rubric?: string;
  role?: { actor_id: string; label: string; goal: string };
};
export type SceneContent = { content_version: string; engine_version: string; scenes: Scene[] };
