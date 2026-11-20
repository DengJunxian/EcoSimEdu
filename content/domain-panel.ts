import type { Course, Event, Frame } from "../student-web/src/lesson-types";

export type DomainEvent = Event & Record<string, unknown>;
type DomainFrame = Pick<Frame, "tick" | "entities"> & { metrics: Readonly<Frame["metrics"]> };

export type BrowserPanelView = {
  run_id: string;
  origin: "browser_rule_engine" | "offline_simulation" | "live_simulation";
  tick: number;
  closed: boolean;
  frame: DomainFrame;
  previous: DomainFrame | null;
  events: readonly DomainEvent[];
};

export type BrowserPanelProps = {
  stage: string;
  course?: Pick<Course, "case_id"> & { action: { options: readonly { id: string; label: string }[] } };
  action: string;
  view?: BrowserPanelView;
  comparison?: BrowserPanelView;
  pinned: string;
  pin: (actor: string) => void;
  seek: (tick: number) => void;
  cite?: (seq: number, actor?: string) => void;
};
