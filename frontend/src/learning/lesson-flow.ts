import type { Session } from "../lesson.ts";
import catalog from "../../../cases/catalog.json" with { type: "json" };

export const flowQuery = { flow: "v3" };
export const flowSteps = ["预备", "故事", "预测与决策", "仿真观察", "机制与涌现", "反事实实验", "独立解释", "迁移与复习"] as const;
export const flowLevels = ["新手", "标准", "进阶"] as const;
export type FlowLevel = typeof flowLevels[number];

export const hasLessonFlow = (id: string) => catalog.includes(id);

export type LessonFlow = {
  version: 1;
  chapter: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  level: FlowLevel;
  prediction?: { option: string; at: number };
  actionAt?: number;
  comparisonId?: string;
  observation?: { tick: number; actor?: string };
};

export const initialFlow: LessonFlow = { version: 1, chapter: 0, level: "标准" };

const index = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function validLessonFlow(value: unknown): value is LessonFlow {
  if (!value || typeof value !== "object") return false;
  const flow = value as LessonFlow;
  return flow.version === 1 && index(flow.chapter) && flow.chapter <= 7 &&
    flowLevels.includes(flow.level) &&
    (flow.prediction === undefined || !!flow.prediction && typeof flow.prediction.option === "string" &&
      index(flow.prediction.at)) &&
    (flow.actionAt === undefined || index(flow.actionAt)) &&
    (flow.comparisonId === undefined || typeof flow.comparisonId === "string") &&
    (flow.observation === undefined || !!flow.observation && index(flow.observation.tick) &&
      (flow.observation.actor === undefined || typeof flow.observation.actor === "string"));
}

export function flowChapter({ chapter, comparisonId }: LessonFlow, session: Session): LessonFlow["chapter"] {
  if (session.stage === 1) return session.choices.length || chapter > 2 ? 2 : chapter;
  if (session.stage === 2) return 3;
  if (session.stage === 3) return 4;
  return comparisonId && (session.comparison?.run.id === comparisonId || session.fork?.run.id === comparisonId) &&
    (chapter === 6 || chapter === 7)
    ? chapter : 5;
}
