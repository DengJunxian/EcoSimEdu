import type { Attempt } from "./education-types";

export type ReviewSchedule = {
  id: string; outcome_id: string; rule_version: 1; due_at: string; based_on_attempt_ids: string[];
  profile: string; case_id: string; content_version: string; status: "scheduled" | "completed" | "paused";
};

export function localDay(at: Date) {
  return [at.getFullYear(), at.getMonth() + 1, at.getDate()].map(value => String(value).padStart(2, "0")).join("-");
}

export function futureLocalDay(at: Date, days: number) {
  const next = new Date(at);
  next.setDate(next.getDate() + days);
  return localDay(next);
}

export function scheduleFromAttempt(attempt: Attempt, days = 1): ReviewSchedule[] {
  if (attempt.assessment_role !== "independent" ||
      !["correct", "incorrect"].includes(attempt.evaluation.result)) return [];
  return attempt.outcome_ids.map(outcome_id => ({
    id: JSON.stringify([attempt.local_profile_id, attempt.content_version, outcome_id]), outcome_id,
    rule_version: 1, due_at: futureLocalDay(new Date(attempt.submitted_at), days),
    based_on_attempt_ids: [attempt.id], profile: attempt.local_profile_id, case_id: attempt.case_id,
    content_version: attempt.content_version, status: "scheduled",
  }));
}

export function isDue(schedule: ReviewSchedule, now: Date) {
  return schedule.status === "scheduled" && schedule.due_at <= localDay(now);
}
