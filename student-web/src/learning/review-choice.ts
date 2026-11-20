import type { Attempt, LearningPackage } from "./education-types";
import type { ReviewSchedule } from "./review-schedule";

export function reviewSignal(due: ReviewSchedule, attempts: Attempt[]) {
  const latest = attempts.find(attempt => attempt.local_profile_id === due.profile && attempt.case_id === due.case_id &&
    attempt.content_version === due.content_version && attempt.assessment_role === "independent" &&
    attempt.outcome_ids.includes(due.outcome_id) &&
    (attempt.evaluation.result === "correct" || attempt.evaluation.result === "incorrect"));
  if (!latest) return;
  return {
    result: latest.evaluation.result === "incorrect" ? "incorrect" as const : "correct" as const,
    used_hint: latest.exposure.max_hint_level > 0,
    evidence: latest.evidence_class,
  };
}

export function reviewChoices(pack: LearningPackage, due: ReviewSchedule) {
  if (pack.case_id !== due.case_id || pack.content_version !== due.content_version) return [];
  return pack.activities.flatMap(activity => {
    if (activity.kind !== "review" || !activity.outcome_ids.includes(due.outcome_id)) return [];
    const item = pack.items.find(candidate => candidate.id === activity.content_ref &&
      candidate.assessment_role === "review" && candidate.outcome_ids.includes(due.outcome_id));
    return item ? [{ activity, item }] : [];
  });
}

export function localReviewChoice(choices: ReturnType<typeof reviewChoices>, signal: ReturnType<typeof reviewSignal>) {
  if (signal && (signal.result === "incorrect" || signal.used_hint || signal.evidence !== "independent")) {
    const alternate = choices.find(({ item }) => item.id === "review-1-reinforce");
    if (alternate) return alternate;
  }
  return choices.find(({ item }) => item.id !== "review-1-reinforce") ?? choices[0];
}
