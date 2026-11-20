import type { SourceRef } from "./flagship-study";

export type Phase = "intro" | "predict" | "bid" | "observe" | "explain" | "compare" | "notebook";
export type Role = "practice" | "independent" | "transfer" | "review";
export type Outcome = {
  id: string; version: number; concept_ids: string[]; performance: string; evidence_requirement: string;
  phase: Phase; task: string; transfer: string;
};
type Option = { id: string; label: string };
export type Item = {
  id: string; version: number; variant_id: string; family_id: string; outcome_ids: string[];
  kind: "numeric" | "single_choice" | "ordering" | "structured_explanation";
  prompt: string; context: { kind: "authored_model_exercise" | "completed_run" }; assessment_role: Role;
  response_schema: { fields?: (Option & { unit: string })[]; options?: Option[] };
  evaluator: { id: "numeric_v1" | "choice_v1" | "ordering_v1" | "structure_v1"; version: 1;
    answers?: number[]; answer?: string | string[] };
  feedback: { hint: string; explanation: string; misconception_code: string };
};
export type Activity = {
  id: string; phase: Phase; kind: "assessment" | "example" | "review" | "scaffold"; content_ref: string;
  outcome_ids: string[]; assessment_item_ids: string[]; next_activity_id: string | null;
  completion_rule: "submit_or_skip" | "read_or_skip";
  remediation_activity_id?: string; return_activity_id?: string; text?: string;
};
export type ConceptScaffold = {
  id: string; title: string; example: string; worked_example: string;
  step_activity_id: string; check_activity_id: string;
};
export type LearningPackage = {
  schema_version: 3; case_id: string; case_version: string; content_version: string;
  source_ids: string[]; required_comparisons: string[]; activities: Activity[]; outcomes: Outcome[]; items: Item[];
  scaffolds?: ConceptScaffold[];
};

export type Response = number[] | string[] | string | { [key: string]: string } | null;
export type Evaluation = {
  evaluator: Item["evaluator"]["id"]; version: number;
  result: "correct" | "incorrect" | "unassessed" | "structure_complete" | "structure_incomplete";
  field_results?: boolean[]; misconception_code?: string;
};
export type Exposure = {
  max_hint_level: number; answer_seen: boolean; exemplar_seen: boolean;
  prior_feedback_for_variant: boolean; solution_seen_at?: string; exposure_unknown: boolean;
};
export type Attempt = {
  id: string; schema_version: 1; local_profile_id: string; session_id: string;
  case_id: string; content_version: string; activity_id: string;
  item_id: string; item_version: number; variant_id: string; family_id: string;
  outcome_ids: string[]; assessment_role: Role; presented_order: string[]; response: Response;
  submitted_at: string; exposure: Exposure; evidence_class: "independent" | "assisted" | "repeated";
  evaluation: Evaluation; source_refs: SourceRef[];
};
export type ActivityState = "available" | "in_progress" | "submitted" | "completed" | "skipped";
export type SessionState = {
  demo?: true;
  id: string; schema_version: 1; local_profile_id: string; case_id: string; content_version: string;
  current_activity_id?: string; accessible_activity_ids: string[];
  activity_states: Record<string, ActivityState>; return_stack: string[];
  phase_cursor: Partial<Record<Phase, string>>;
};
