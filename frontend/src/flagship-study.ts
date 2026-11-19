import svb from "../../cases/svb_run/learning-v3.json" with { type: "json" };
import auction from "../../cases/double_auction/learning-v3.json" with { type: "json" };
import schelling from "../../cases/schelling_segregation/learning-v3.json" with { type: "json" };
import type { Attempt, LearningPackage } from "../../student-web/src/learning/education-types";
import { emptySession, profileId, readSession } from "../../student-web/src/learning/learner-repository";

const studies = {
  svb_run: { pack: svb as LearningPackage, itemId: "svb-v2-harbor-bank", label: "青湾银行", question: "选择能解释今天支付风险的一项" },
  schelling_segregation: { pack: schelling as LearningPackage, itemId: "sch-club", label: "校园社团", question: "选择最能区分两种机制的一项" },
  double_auction: { pack: auction as LearningPackage, itemId: "auc-fee-range", label: "旧书交易", question: "选择符合双方条件的价格区间" },
};
export type FlagshipCase = keyof typeof studies;

export function flagshipStudy(caseId: FlagshipCase) {
  const study = studies[caseId];
  return { ...study, item: study.pack.items.find(item => item.id === study.itemId)!,
    activity: study.pack.activities.find(activity => activity.content_ref === study.itemId)! };
}

export async function readFlagshipTransfer(caseId: FlagshipCase) {
  const { pack, item } = flagshipStudy(caseId);
  const base = emptySession(pack, await profileId(false));
  const { attempts } = await readSession(base);
  return { base, attempts: attempts.filter(attempt => attempt.item_id === item.id) };
}

export async function restoreFlagshipTransfers(attempts: unknown, allowed: readonly FlagshipCase[]) {
  if (!Array.isArray(attempts) || !attempts.every((entry: Partial<Attempt> | null) => {
    const caseId = allowed.find(id => id === entry?.case_id);
    if (!caseId || !entry) return false;
    const { pack, item, activity } = flagshipStudy(caseId);
    return entry.content_version === pack.content_version && entry.item_id === item.id && entry.activity_id === activity.id;
  })) throw new Error("迁移题的版本或作答记录无法核对。");

  if (attempts.length === 0) return 0;
  const { restoreLearning } = await import("../../student-web/src/learning/learning-archive");
  const result = await restoreLearning(await profileId(false), {
    kind: "ecosimedu-learning-export", schema_version: 1, attempts,
  }, async caseId => flagshipStudy(caseId as FlagshipCase).pack);
  return result.restored;
}
