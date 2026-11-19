import { lazy, Suspense, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { ComparisonView, PredictionCard } from "./Counterfactual";
import { chartMetric, displayNumber, frameLabel, matchesMetric, nextStageReady, relatedActors, startLesson, transition, type Command, type Lesson, type Session } from "./lesson.ts";
import { courseRef, courseLink, resumeProgress, saveProgress, stageNames, type CourseRef } from "./learning-store.ts";
import { SavedSource } from "./StudentNotes";
import { Investigation } from "./Investigation";
import { StudentHeader } from "./StudentHeader.tsx";
import { Inspector, MicroBoard, RoleView, Timeline } from "./visuals";

const MetricChart = lazy(() => import("./MetricChart"));

const prompts = [
  "",
  "点选一位个体，再单步前进一次。比较行动前后的状态和理由。",
  "播放到关键时点，再看指标变化来自哪些个体。下一轮可追踪谁接收了这一变化。",
  "改动一个政策条件，先预测结果，再运行验证。",
];
const nextLabels = ["观察个体决策", "观察群体变化", "试一项政策"];

function RoleDecisions({ lesson, session, send }: { lesson: Lesson; session: Session; send: (value: Command) => void }) {
  const current = lesson.decisions[session.choices.length];
  const prompt = useRef<HTMLLegendElement>(null);
  useEffect(() => {
    if (session.choices.length && current) prompt.current?.focus();
  }, [current, session.choices.length]);
  return <>
    <p>{lesson.role.perspective}</p>
    <dl className="fact-list role-facts" aria-label="你掌握的信息">
      {lesson.role.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl>
    {!!session.choices.length && <div role="status"><ol className="decisions-made" aria-label="你的决定">
      {session.choices.map((choice, index) => {
        const decision = lesson.decisions[index];
        if ("amount" in decision) return <li key={index}>
          <strong>{decision.amount.label} {choice} {decision.amount.unit}</strong>
        </li>;
        const option = decision.options.find(item => item.id === choice);
        return <li key={index}><strong>{option?.label}</strong><span>{option?.response}</span></li>;
      })}
    </ol></div>}
    {current && ("amount" in current ? <form className="decision-card amount-decision" onSubmit={event => {
      event.preventDefault();
      const value = new FormData(event.currentTarget).get("choice");
      if (typeof value === "string") send({ type: "choose", option: value });
    }}>
      <p>{current.prompt}</p>
      <label htmlFor="choice-amount">{current.amount.label}（{current.amount.unit}）</label>
      <input id="choice-amount" name="choice" type="number" min={current.amount.min} max={current.amount.max}
        step={1} defaultValue={current.amount.suggested} inputMode="numeric" required/>
      <button type="submit" className="primary">确认限价</button>
    </form> : <fieldset className="decision-card">
      <legend ref={prompt} tabIndex={-1}>{current.prompt}</legend>
      <div className="decision-actions">{current.options.map(option => <button key={option.id} onClick={() =>
        send({ type: "choose", option: option.id })}>{option.label}</button>)}</div>
    </fieldset>)}
  </>;
}

function BridgeEvidence({ lesson, session, send }: { lesson: Lesson; session: Session; send: (value: Command) => void }) {
  const run = session.run!;
  const frame = run.frames[session.cursor];
  const metric = lesson.metrics.find(item => item.id === session.focusedMetric) ?? chartMetric(lesson);
  const prior = run.frames[frame.tick - 1];
  const data = run.frames.slice(0, session.revealed + 1);
  const deltas = relatedActors(frame, metric.id);
  const observedSignals = frame.events.filter(event => event.priorSignal);
  const evaluatedSignals = frame.actors.filter(actor => actor.priorSignal);
  let changeText = "运行开始后，可逐步追踪指标变化。";
  const current = frame.metrics[metric.id], previous = prior?.metrics[metric.id];
  if (lesson.tickUnit === "event" && !lesson.originalId) {
    changeText = typeof current === "number" ? `此事件的成交价是 ${current} ${metric.unit}。` : "此事件没有成交，价格曲线只标记实际成交。";
  } else if (typeof current === "number" && typeof previous === "number") {
    const difference = current - previous;
    changeText = `${metric.label}从 ${displayNumber(previous)} 变为 ${displayNumber(current)} ${metric.unit}，本步净变化 ${displayNumber(difference)} ${metric.unit}。`;
  } else if (typeof current === "number" && prior) {
    changeText = `${metric.label}在本步首次可比较，观察值为 ${displayNumber(current)} ${metric.unit}。`;
  } else if (prior) {
    changeText = `${metric.label}在相邻轮次中有缺值，净变化未定义。`;
  }
  return <section className="bridge-evidence" aria-label="宏微观证据">
    {lesson.originalId && <label className="metric-lookup">追踪指标
      <select value={metric.id} onChange={event => send({ type: "locate", tick: frame.tick, metricId: event.target.value })}>{lesson.metrics.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    </label>}
    <p>{changeText}</p>
    {!lesson.originalId && evaluatedSignals.length > 0 ? <p>本轮 {evaluatedSignals.length} 位储户的评分计入了上轮待付，
      其中 {observedSignals.length} 位提交了防御性提款。查看个体的评分与阈值，判断这一项是否改变决定。</p> :
      (observedSignals.length > 0 || evaluatedSignals.length > 0) && <p>{lesson.originalId ?
        "本步有个体使用了已记录的信号。选择个体可回查该时点。" : lesson.tickUnit === "event" ? "当前报价引用了已成交的价格。" :
        `本轮 ${observedSignals.length} 次个体决策引用了上轮公示。`}选择个体可回查该时点。</p>}
    {frame.tick > 0 && <details className="trace-details">
      <summary>查看{lesson.tickUnit === "event" ? "当前事件的" : "本轮 "} {deltas.length} 位贡献个体及事件</summary>
      {deltas.length ? <ul className="trace-list">{frame.events.filter(event => matchesMetric(event, metric.id))
        .map(event => {
          const actorId = event.actorId;
          const delta = event.deltas[metric.id];
          const text = typeof delta === "number" ? `${event.text}（${delta > 0 ? "+" : ""}${displayNumber(delta)}）` : event.text;
          return <li key={event.id}>{actorId ?
            <button className="text-button" onClick={() => send({ type: "select", actorId })}>{text}</button> : text}</li>;
        })}</ul> :
        <p>本步没有改变这项指标的个体事件。</p>}
      {lesson.originalId && frame.events[0] && <p>原事件 {frame.tick} · {frame.events[0].text}</p>}
    </details>}
    {frame.equations && <details className="trace-details">
      <summary>核对本轮银行账表</summary>
      <ul>{frame.equations.map(equation => <li key={equation}>{equation}</li>)}</ul>
      {lesson.bridge && <p>模型规则 · {lesson.bridge.rule}</p>}
      <ul>{frame.events.filter(event => event.kind === "sale" || event.kind === "support" || event.kind === "revaluation")
        .map(event => <li key={event.id}>{event.text}</li>)}</ul>
    </details>}
    {lesson.originalId && <details className="trace-details">
      <summary>核对模型规则</summary><p>{lesson.bridge?.rule}</p>
    </details>}
    {lesson.rangeLookup && <IntervalLookup data={data} locate={tick => send({ type: "locate", tick, metricId: "moves" })}/>}
    <details className="trace-details">
      <summary>从指标数值反查事件</summary>
      <table>
        <caption>{metric.label}（{metric.unit}）</caption>
        <thead><tr><th scope="col">{lesson.tickUnit === "event" ? "事件序号" : "轮次"}</th><th scope="col">数值</th><th scope="col">定位原事件</th></tr></thead>
        <tbody>{data.map(item => <tr key={item.tick}>
          <th scope="row">{item.tick}</th><td>{displayNumber(item.metrics[metric.id])}</td>
          <td><button className="text-button" onClick={() => send({ type: "locate", tick: item.tick, metricId: metric.id })}>
            定位{frameLabel(lesson.tickUnit, item.tick)}
          </button></td>
        </tr>)}</tbody>
      </table>
    </details>
  </section>;
}

function IntervalLookup({ data, locate }: { data: NonNullable<Session["run"]>["frames"]; locate: (tick: number) => void }) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState<number>();
  const last = data.length - 1;
  const stop = end ?? last;
  const events = data.slice(start + 1, stop + 1).filter(frame => (frame.events[0]?.deltas.moves ?? 0) > 0);
  return <details className="trace-details">
    <summary>从区间反查搬迁</summary>
    <p>已揭示事件 0 至 {last}。查询包含终点，起点之后才计入。</p>
    <div className="range-fields">
      <label>起点事件<input type="number" min={0} max={stop} value={start}
        onChange={event => setStart(Math.max(0, Math.min(stop, Math.trunc(event.target.valueAsNumber || 0))))} /></label>
      <label>终点事件<input type="number" min={start} max={last} value={stop}
        onChange={event => setEnd(Math.max(start, Math.min(last, Math.trunc(event.target.valueAsNumber || 0))))} /></label>
    </div>
    <p role="status" aria-atomic="true" tabIndex={0}>
      {events.length ? `区间 (${start}, ${stop}] 共有 ${events.length} 次搬迁。` : "这个区间没有搬迁记录。"}
    </p>
    {!!events.length && <ol className="range-entries">{events.map(frame => <li key={frame.tick}>
      <button type="button" className="text-button" onClick={() => locate(frame.tick)}>定位搬迁 {frame.tick}</button>
      <span>{frame.events[0].text}</span>
    </li>)}</ol>}
  </details>;
}

type StudioProps = {
  lesson: Lesson;
  review?: (session: Session, send: (command: Command) => void, nextAction?: ReactNode) => ReactNode;
  reviewByTimeline?: boolean;
};

export function Studio(props: StudioProps) {
  const query = new URLSearchParams(location.search);
  const course = courseRef(query);
  const source = query.get("source");
  const side = query.get("side");
  if (course && source && (side === "baseline" || side === "comparison")) {
    return <SavedSource lesson={props.lesson} id={source} side={side} {...course}/>;
  }
  return <LessonStudio {...props} course={course} fresh={query.get("fresh") === "1"}/>;
}

function LessonStudio({ lesson, review, reviewByTimeline, course, fresh }: StudioProps & { course?: CourseRef; fresh: boolean }) {
  const [session, send] = useReducer((state: Session, command: Command) => transition(lesson, state, command), lesson, model => {
    try { return !fresh && course ? resumeProgress(localStorage, course, model) ?? startLesson(model) : startLesson(model); }
    catch { return startLesson(model); }
  });
  const lastSaved = useRef(session);
  const [saveFailed, setSaveFailed] = useState(false);
  useLayoutEffect(() => {
    if (session === lastSaved.current || !course || !session.choices.length) return;
    try {
      saveProgress(localStorage, course, session);
      if (fresh) history.replaceState(history.state, "", courseLink(course));
      lastSaved.current = session;
      setSaveFailed(false);
    } catch { setSaveFailed(true); }
  }, [course?.caseId, course?.market, fresh, session]);

  const pauseReview = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const stageAction = useRef<HTMLButtonElement>(null);
  const previousStage = useRef(session.stage);
  const { stage, run } = session;
  const frame = run?.frames[session.cursor];
  const actor = frame?.actors.find(entry => entry.id === session.selected);
  const metric = chartMetric(lesson);
  const activeMetric = lesson.originalId && session.focusedMetric
    ? lesson.metrics.find(item => item.id === session.focusedMetric) ?? metric : metric;
  const nextTurning = run?.frames.some(item => item.tick > session.cursor && item.turningPoint);
  const pauseTick = reviewByTimeline && stage === 3 && frame?.turningPoint && !session.playing ? frame.tick : undefined;
  useEffect(() => {
    if (pauseTick === undefined || !window.matchMedia("(max-width: 760px)").matches) return;
    pauseReview.current?.focus({ preventScroll: true });
    pauseReview.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [pauseTick]);

  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [stage]);
  const ready = nextStageReady(lesson, session);
  useEffect(() => {
    if (stage === 1 && ready) stageAction.current?.focus();
  }, [stage, ready]);
  useEffect(() => {
    if (!session.playing) return;
    const timer = window.setInterval(() => send({ type: "step" }), 850);
    return () => window.clearInterval(timer);
  }, [session.playing]);

  const turnNotice = stage === 3 && frame?.turningPoint && <p className="turning-point" role="status">
    {frame.turningPoint}。{relatedActors(frame, metric.id).length > 0 && "画布高亮相关个体。"}
  </p>;
  const locate = (tick: number, metricId = metric.id, actorId?: string) =>
    send({ type: "locate", tick, metricId, actorId });
  return <>
    <StudentHeader caseId={course?.caseId}/>
    <main className="shell lesson-shell" id="main" tabIndex={-1}>
      <nav aria-label="课堂进度">
        <ol className="stepper grid grid-cols-2 md:grid-cols-4">
          {stageNames.map((label, index) => <li key={label} aria-current={stage === index + 1 ? "step" : undefined}
            data-completed={stage > index + 1}><span className="step-number">{index + 1}</span>{label}</li>)}
        </ol>
      </nav>
      <div className="lesson-layout">
        <div className="narrative">
          <h1 tabIndex={-1} ref={heading}>{stage === 1 ? lesson.title : stageNames[stage - 1]}</h1>
          {stage === 1 ? <RoleDecisions lesson={lesson} session={session} send={send}/> : <p>{stage === 3 ? lesson.bridge?.prompt ?? prompts[2] : prompts[stage - 1]}</p>}
          {stage === 1 && <p className="source-note">{lesson.casePackage && <strong>{lesson.casePackage.identityLabel} · </strong>}
            {lesson.source.note}</p>}
          {stage === 1 && lesson.source.references && <details className="trace-details">
            <summary>{lesson.source.kind === "historical_event" ? "查看历史来源" : "查看案例资料与模型假设"}</summary>
            {lesson.casePackage && <>
              <p>{lesson.casePackage.syntheticPopulation.description}</p>
              {lesson.casePackage.modelAssumptions.map(item => <p key={item}>{item}</p>)}
            </>}
            <ul>{lesson.source.references.map(source => <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            </li>)}</ul>
          </details>}
          {frame && (stage === 2 || stage === 3) && <>
            <button className="text-button back-button" disabled={session.cursor === 0} onClick={() => send({ type: "back" })}>后退一步</button>
            {stage === 3 && lesson.originalId && nextTurning && <button className="text-button" onClick={() => send({ type: "go-to-turn" })}>前往下一关键事件</button>}
            {stage === 3 && lesson.bridge?.closeLabel && <button className="text-button" disabled={session.cursor === run!.frames.length - 1}
              onClick={() => send({ type: "go-to-close" })}>{lesson.bridge.closeLabel}</button>}
          </>}
          {stage === 4 && <PredictionCard lesson={lesson} session={session} send={send}/>}
          {saveFailed && <p role="status">当前浏览器无法保存进度。可以继续学习，完成后导出结果。</p>}
          {course && session.choices.length > 0 && <a className="restart-link" href={courseLink(course, { fresh: "1" })}>从头再练</a>}
          {!(reviewByTimeline && stage === 3) && review?.(session, send)}
          {course && stage === 4 && session.comparison && <Investigation key={session.comparison.run.id}
            course={course} lesson={lesson} session={session}/>}
        </div>
        <div className="visual-column">
          {stage === 1 && <RoleView role={lesson.role}/>}
          {run && frame && (stage === 2 || stage === 3) && <div className="canvas-panel">
            <MicroBoard lesson={lesson} frame={frame} selected={actor?.id} metricId={session.focusedMetric}
              select={actorId => send({ type: "select", actorId })}/>
            {stage === 3 && <section className="macro-view" aria-label="宏观指标曲线">
              <div className="canvas-heading"><h2>{activeMetric.label}</h2><span>{typeof frame.metrics[activeMetric.id] === "number" ?
                `${displayNumber(frame.metrics[activeMetric.id])} ${activeMetric.unit}` : "未定义"}</span></div>
              {lesson.bridge && <dl className="bank-readout">{lesson.bridge.metrics.filter(id => id !== activeMetric.id).map(id => {
                const context = lesson.metrics.find(item => item.id === id);
                if (!context) return null;
                const value = frame.metrics[id];
                const baseline = run.frames[0].metrics[id];
                const difference = typeof value === "number" && typeof baseline === "number" ? value - baseline : null;
                return <div key={id}><dt>{context.label}</dt><dd>{displayNumber(value)}{lesson.originalId && value != null && context.unit ? ` ${context.unit}` : ""}
                  {id === lesson.priceMetric && difference !== null && difference !== 0 && <span data-financial-move={difference > 0 ? "up" : "down"}>
                    {difference > 0 ? "+" : ""}{displayNumber(difference)}
                  </span>}</dd></div>;
              })}</dl>}
              <Suspense fallback={<p>正在绘制曲线…</p>}>
                <MetricChart metric={activeMetric} financial={activeMetric.id === lesson.priceMetric}
                  frames={run.frames.slice(0, session.revealed + 1)} cursor={session.cursor}
                  onSelect={tick => locate(tick, activeMetric.id)}/>
              </Suspense>
            </section>}
            <Timeline session={session} send={send}/>
            {!reviewByTimeline && turnNotice}
            {reviewByTimeline && stage === 3 && <section ref={pauseReview} tabIndex={-1}
              className="replay-review" aria-label="当前成交证据与下一步">
              {turnNotice}
              {review?.(session, send, <button className="primary stage-action" ref={stageAction} disabled={!ready && pauseTick === undefined}
                onClick={() => send({ type: ready ? "next-stage" : "step" })}>
                {!ready && pauseTick !== undefined ? "下一步 · 查看后续报价" : "试一项政策"}
              </button>)}
            </section>}
            {actor && <Inspector actor={actor} stateName={lesson.states[actor.state].label}
              frame={frame} tickUnit={lesson.tickUnit} metricId={activeMetric.id} locate={stage === 3 ? locate : undefined}/>}
          </div>}
          {stage === 4 && <ComparisonView lesson={lesson} session={session}/>}
        </div>
        {stage === 3 && <BridgeEvidence lesson={lesson} session={session} send={send}/>}
        {stage < 4 && !(reviewByTimeline && stage === 3) && <div className="lesson-next">
          <button className="primary stage-action" ref={stageAction} disabled={!ready}
            onClick={() => send({ type: "next-stage" })}>{nextLabels[stage - 1]}</button>
        </div>}
      </div>
    </main>
  </>;
}
