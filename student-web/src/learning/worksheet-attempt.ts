import { api } from "../contracts";
import { isDemo } from "./demo";
import type { Activity, Item, LearningPackage } from "./education-types";
import type { SourceRef } from "./flagship-study";
import { emptySession, profileId, submitAttempt } from "./learner-repository";

export const worksheetLabels: Record<string, string> = {
  "worksheet-auction": "实际成交结算", "worksheet-svb": "实际银行权益", "worksheet-schelling": "九格邻居计数",
};

export async function recordWorksheet(
  caseId: string, activityId: string, response: number[], expected: number[], source?: SourceRef,
) {
  const pack = await api<LearningPackage>(`/cases/${caseId}/lesson?schema_version=3`);
  const base = emptySession(pack, await profileId(isDemo()));
  const outcome_ids = [`${caseId}.1`];
  const activity: Activity = {
    id: activityId, phase: caseId === "schelling_segregation" ? "intro" : "explain", kind: "assessment",
    outcome_ids, content_ref: activityId, assessment_item_ids: [activityId],
    completion_rule: "submit_or_skip", next_activity_id: null,
  };
  const item: Item = {
    id: activityId, version: 1, variant_id: source ? `${activityId}-${source.result_hash}-${source.seq}` : activityId,
    family_id: outcome_ids[0], outcome_ids, kind: "numeric", prompt: worksheetLabels[activityId],
    context: { kind: source ? "completed_run" : "authored_model_exercise" }, assessment_role: "practice",
    response_schema: {}, evaluator: { id: "numeric_v1", version: 1, answers: expected },
    feedback: { hint: "", explanation: "", misconception_code: caseId === "double_auction" ? "price_is_surplus" :
      caseId === "svb_run" ? "liquidity_is_equity" : "empty_as_neighbor" },
  };
  await submitAttempt(base, activity, item, response, [], undefined, source ? [source] : [], true);
  window.dispatchEvent(new Event("ecosimedu-worksheet-saved"));
}
