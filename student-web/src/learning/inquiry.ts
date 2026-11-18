import type { Scalar } from "../lesson-types";
import type { SourceRef } from "./flagship-study";

export type ExperimentPlan = {
  question: string; hypothesis: string; treatment_plan: string; controlled_inputs: string;
  outcome_metric_ids: string[]; falsification: string;
};
export type ComparisonConditions = {
  common_root: string; seed: number; baseline_initial_hash: string; branch_initial_hash: string;
  treatments: Record<string, { baseline: Scalar; branch: Scalar }>;
  class: "initial_treatment" | "policy_comparison";
};
export type ExperimentCard = ExperimentPlan & {
  id: string; version: 1; case_id: string; profile: string; created_at: string;
  hypothesis_revision?: string; run_ids?: { baseline: string; branch: string };
  actual_conditions?: ComparisonConditions; alignment_ref?: { clock: string; label: string; baseline_tick: number; branch_tick: number };
  source_refs?: SourceRef[]; conclusion?: string; limitations?: string; status: "planned" | "completed";
};
export const emergenceExplanationTasks = {
  schelling_segregation: "schelling-emergence-v1",
  public_goods: "public-goods-emergence-v1",
  beer_game: "beer-emergence-v1",
} as const;

export const evidenceUseLabels = {
  observed_transition: "主体怎样作出行动 · 已记录变化",
  model_rule: "主体怎样作出行动 · 模型规则",
  accounting_identity: "互动怎样形成总体结果 · 算术恒等式",
  paired_difference: "成立条件 · 配对差异",
} as const;
export type EvidenceUse = keyof typeof evidenceUseLabels;
export const evidenceKeyFor = (ref: SourceRef) => `${ref.run_id}/${ref.seq}/${ref.actor ?? ""}`;

export type ExplanationCard = {
  id: string; version: 1; case_id: string; content_version: string; profile: string; outcome_ids: string[];
  task_id?: typeof emergenceExplanationTasks[keyof typeof emergenceExplanationTasks];
  source_uses?: Record<string, EvidenceUse>;
  structure_help_used?: boolean;
  claim: string; micro: string; aggregation: string; conditions: string; alternative_explanation: string;
  source_refs: SourceRef[]; experiment_card_id?: string; updated_at?: string;
};

export function conditionMessage(conditions: ComparisonConditions) {
  const classText = conditions.class === "initial_treatment"
    ? "初始处理改变开局设备、资产或布局的指定部分。以共同生成根和种子核对其余输入。"
    : "政策对照的起始状态摘要相同。按实际参数差异和共同经济时钟解释结果。";
  return Object.keys(conditions.treatments).length > 1
    ? classText + "这组运行同时改变了多个参数，结论适用于这些处理的组合。" : classText;
}
