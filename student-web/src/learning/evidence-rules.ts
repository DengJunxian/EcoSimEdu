import type { Attempt, Outcome } from "./education-types";

export function outcomeEvidence(outcome: Outcome, attempts: Attempt[]) {
  const forGoal = attempts.filter(attempt => attempt.outcome_ids.includes(outcome.id));
  const objective = forGoal.filter(attempt => ["correct", "incorrect"].includes(attempt.evaluation.result));
  const passes = (attempt: Attempt) => attempt.evidence_class === "independent" && attempt.evaluation.result === "correct";
  const supporting = objective.filter(attempt => attempt.assessment_role === "independent" && passes(attempt));
  const transfers = objective.filter(attempt => attempt.assessment_role === "transfer");
  const latest = objective.reduce<Attempt | undefined>((previous, current) =>
    !previous || previous.submitted_at < current.submitted_at ? current : previous, undefined);
  const evidence_state = supporting.length ? "independent_evidence" : forGoal.length ? "practicing" : "not_attempted";
  const transfer_status = transfers.some(passes) ? "evidenced" : transfers.length ? "needs_more_evidence" : "not_assessed";
  return {
    outcome_id: outcome.id, rule_version: 1,
    evidence_state,
    supporting_attempt_ids: supporting.map(attempt => attempt.id),
    evidence_dates: supporting.map(attempt => attempt.submitted_at),
    transfer_status,
    unresolved_misconception_codes: latest?.evaluation.misconception_code ? [latest.evaluation.misconception_code] : [],
    updated_at: latest?.submitted_at,
  } as const;
}
