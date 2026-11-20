import type { ReactNode } from "react";
import guides from "../../../cases/classroom-guides-v3.json" with { type: "json" };
import { chartMetric, displayObservation, frameLabel, type Frame, type Lesson, type Run, type Session } from "../lesson.ts";
import { flowLevels, flowSteps, type FlowLevel, type LessonFlow } from "./lesson-flow.ts";

type Chapter = LessonFlow["chapter"];

export function FlowStepper({ chapter, recap, navigate }: {
  chapter: Chapter; recap: Chapter | undefined; navigate: (chapter: Chapter) => void;
}) {
  return <nav aria-label="八阶段学习进度"><ol className="stepper flow-stepper">
    {flowSteps.map((label, index) => {
      const step = index as Chapter;
      return <li key={label} aria-current={(recap ?? chapter) === step ? "step" : undefined}
        data-completed={step < chapter}>
        {step <= chapter ? <button type="button" className="text-button" onClick={() => navigate(step)}>
          <span className="step-number">{step + 1}</span>{label}
        </button> : <><span className="step-number">{step + 1}</span>{label}</>}
      </li>;
    })}
  </ol></nav>;
}

export function FlowLevelPicker({ level, change }: { level: FlowLevel; change: (value: FlowLevel) => void }) {
  return <fieldset className="decision-actions study-phase"><legend>讲解深度</legend>
    {flowLevels.map(item => <label key={item}>
      <input type="radio" name="flow-level" checked={item === level} onChange={() => change(item)}/> {item}
    </label>)}
  </fieldset>;
}

const introductions = {
  schelling_segregation: {
    新手: "数同组邻居时，只数有人住的格子。三格有住户、其中两格同组，同组比例就是 2/3。",
    标准: "练习区分一个住户的同组邻居比例和全图的同组邻接比例。",
    进阶: "留意开局地图、行动轮序和空格约束。配对实验固定开局和学生决定，每次只改阈值。",
  },
  svb_run: {
    新手: "一份提款申请先进入队列。等银行实际付出这笔钱时，银行手头的现金才减少。",
    标准: "练习区分申请、实付和排队，追踪大额提款如何传到不同企业。",
    进阶: "沿原始流水核对现金流和待付金额，再比较相同开局下的政策干预。",
  },
  double_auction: {
    新手: "买家最多愿付 8 元，卖家最少肯收 6 元。双方可以在 6 到 8 元之间成交。",
    标准: "练习用报价、接单和成交三类记录解释价格和交易剩余。",
    进阶: "追踪限价、清算和未成交报价，再用同种子配对分辨费用与需求条件的影响。",
  },
};

export function FlowPreparation({ caseId, level }: { caseId: string; level: FlowLevel }) {
  const guide = introductions[caseId as keyof typeof introductions];
  const published = guides[caseId as keyof typeof guides];
  const field = { 新手: "starter", 标准: "observation", 进阶: "comparison" } as const;
  const text = guide?.[level] ?? published?.[field[level]];
  return text && <p>{text}</p>;
}

function choiceLabel(decision: Lesson["decisions"][number], choice?: string) {
  if (choice === undefined) return undefined;
  return "options" in decision ? decision.options.find(option => option.id === choice)?.label :
    `${decision.amount.label} ${choice} ${decision.amount.unit}`;
}

export function FlowRecap({ step, flow, lesson, session, experiment, explanation, observationFrame }: {
  step: Chapter; flow: LessonFlow; lesson: Lesson; session: Session;
  experiment: ReactNode; explanation: ReactNode;
  observationFrame?: (run: Run, frame: Frame) => Frame;
}) {
  const course = lesson.casePackage!;
  const [action, prediction] = lesson.decisions;
  const replayTick = step === 3 ? flow.observation?.tick : session.revealed;
  const source = replayTick === undefined || (step === 4 && session.perspective === "role")
    ? undefined : session.run?.frames[replayTick];
  const frame = source && (observationFrame?.(session.run!, source) ?? source);
  const metric = chartMetric(lesson);
  return <>
    {step === 0 && <FlowPreparation caseId={course.caseId} level={flow.level}/>}
    {step === 1 && <><p>{lesson.role.perspective}</p><p className="source-note">{lesson.source.note}</p></>}
    {step === 2 && <dl className="fact-list">
      <div><dt>原始预测</dt><dd>{choiceLabel(prediction, session.choices[1] ?? flow.prediction?.option) ?? "待完成"}</dd></div>
      <div><dt>原始决定</dt><dd>{choiceLabel(action, session.choices[0]) ?? "待完成"}</dd></div>
    </dl>}
    {step === 3 && <>
      {frame ? <>
        {flow.observation?.actor && <p>观察对象 · {frame.actors.find(actor => actor.id === flow.observation?.actor)?.name ?? "未记录"}</p>}
        <p>{frameLabel(lesson.tickUnit, frame.tick)} · {frame.events[0]?.text ?? "这一帧没有新事件。"}</p>
      </> : <p>从场景中选一个主体，单步前进，核对它的状态和约束。</p>}
    </>}
    {step === 4 && <>
      <p>{lesson.bridge?.rule}</p>
      {frame && <p>{frameLabel(lesson.tickUnit, frame.tick)} · {metric.label} {displayObservation(frame.metrics[metric.id])}</p>}
    </>}
    {step === 5 && experiment}
    {step === 6 && explanation}
  </>;
}
