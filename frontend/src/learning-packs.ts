import type { LearningPackage } from "../../student-web/src/learning/education-types";

const packs = import.meta.glob<{ default: LearningPackage }>("../../cases/*/learning-v3.json");

export async function loadLearningPack(caseId: string): Promise<LearningPackage> {
  const read = packs[`../../cases/${caseId}/learning-v3.json`];
  if (!read) throw new Error("没有该课程的本地学习包。");
  const { default: pack } = await read();
  if (pack.case_id !== caseId || pack.schema_version !== 3) throw new Error("课程学习包版本不符。");
  return pack;
}
