export type ObservationPerspective = "role" | "system";

export const evidenceKinds = {
  action: "直接行动",
  accounting: "指标核算",
  signal: "接收到的信号",
  rule: "规则触发",
  feedback: "后续反馈",
  relation: "邻域变化",
} as const;

export const missingEvidence = "当前模型未提供这类证据。";

export function visibleTick(tick: number, asOf: number) {
  return Number.isSafeInteger(tick) && tick >= 0 && tick <= asOf;
}
