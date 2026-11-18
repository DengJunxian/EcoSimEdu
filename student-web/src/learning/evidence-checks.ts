import { isSourceRef, type SourceRef } from "./flagship-study";
import { profileId, result, transact } from "./learner-repository";

export const checkLabels = {
  reverse: "Schelling 区间反查",
  comparison: "反事实条件表达",
} as const;
export type EvidenceCheck = {
  id: string;
  version: 1;
  profile: string;
  case_id: string;
  kind: keyof typeof checkLabels;
  submitted_at: string;
  source_refs: SourceRef[];
  response: Record<string, string>;
  passed: boolean;
};

export function parseEvidenceCheck(value: Record<string, unknown>, profile: string): EvidenceCheck {
  if (typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id) || value.version !== 1 ||
      typeof value.case_id !== "string" || !/^[a-z_]{1,48}$/.test(value.case_id) ||
      (value.kind !== "reverse" && value.kind !== "comparison") ||
      typeof value.submitted_at !== "string" || !Number.isFinite(Date.parse(value.submitted_at)) ||
      typeof value.passed !== "boolean" || !Array.isArray(value.source_refs) ||
      value.source_refs.length !== (value.kind === "reverse" ? 1 : 2) || !value.source_refs.every(isSourceRef) ||
      !value.response || typeof value.response !== "object" || Array.isArray(value.response) ||
      Object.keys(value.response).length > 5 ||
      !Object.values(value.response).every(field => typeof field === "string" && field.length <= 400)) {
    throw new Error("课堂核对记录格式错误。");
  }
  return { ...value, profile } as EvidenceCheck;
}

export async function saveEvidenceCheck(check: Omit<EvidenceCheck, "id" | "profile" | "submitted_at" | "version">) {
  const profile = await profileId(false);
  const entry: EvidenceCheck = {
    ...check, id: crypto.randomUUID(), version: 1, profile, submitted_at: new Date().toISOString(),
  };
  await transact(["evidence_checks"], "readwrite", tx => result(tx.objectStore("evidence_checks").add(entry)));
}

export function readEvidenceChecks(profile: string) {
  return transact(["evidence_checks"], "readonly", async tx => {
    const checks = await result(tx.objectStore("evidence_checks").getAll()) as EvidenceCheck[];
    return checks.filter(check => check.profile === profile);
  });
}
