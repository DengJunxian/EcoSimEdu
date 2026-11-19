import data from "../../cases/svb_run/learning-v3.json" with { type: "json" };
import type { Attempt, LearningPackage } from "../../student-web/src/learning/education-types";
import { emptySession, profileId, readSession } from "../../student-web/src/learning/learner-repository";

const pack = data as LearningPackage;
const transferId = "svb-v2-harbor-bank";
export const transferItem = pack.items.find(item => item.id === transferId)!;
export const transferActivity = pack.activities.find(activity => activity.id === transferId)!;

export async function readSvbTransfer() {
  const base = emptySession(pack, await profileId(false));
  const { attempts } = await readSession(base);
  return { base, attempts: attempts.filter(attempt => attempt.item_id === transferId) };
}

export async function restoreSvbTransfer(attempts: unknown) {
  if (!Array.isArray(attempts) || !attempts.every((entry: Partial<Attempt> | null) => entry?.case_id === pack.case_id &&
    entry.content_version === pack.content_version && entry.item_id === transferId && entry.activity_id === transferId)) {
    throw new Error("青湾银行迁移题的版本或作答记录无法核对。");
  }
  if (attempts.length === 0) return 0;
  const { restoreLearning } = await import("../../student-web/src/learning/learning-archive");
  const result = await restoreLearning(await profileId(false), {
    kind: "ecosimedu-learning-export", schema_version: 1, attempts,
  }, async () => pack);
  return result.restored;
}
