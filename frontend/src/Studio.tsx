import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { ComparisonView, PredictionCard } from "./Counterfactual";
import { ExperimentArchive } from "./ExperimentWorkbench.tsx";
import { chartMetric, displayNumber, displayObservation, frameLabel, matchesMetric, nextStageReady, relatedActors, startLesson, transition, type Command, type Frame, type Lesson, type Run, type Session } from "./lesson.ts";
import { courseRef, courseLink, progressSnapshot, resumeProgress, saveProgress, stageNames, type CourseRef } from "./learning-store.ts";
import { SavedSource } from "./StudentNotes";
import { Investigation } from "./Investigation";
import { StudentHeader } from "./StudentHeader.tsx";
import { Inspector, MicroBoard, RoleView, Timeline } from "./visuals";
import { bankEventDeltas } from "./run-evidence.ts";
import { ActionPanel, Breadcrumb, EvidenceCard, MetricCard, PageTitle, ProgressStepper, StatusNotice } from "../../content/student-ui.tsx";
import { Workbench, workbenchMedia, type WorkbenchView } from "./Workbench.tsx";
import { microscopeRole } from "./microscope.ts";
import { TraceMicroscope } from "./TraceMicroscope.tsx";
import { ForecastReview } from "./ForecastReview.tsx";
import { hasSavedExplanation, LearningJourney, LearningObjectives } from "./ProgressiveLearning.tsx";
import "./workbench.css";

const MetricChart = lazy(() => import("./MetricChart"));
const TeacherWork = lazy(() => import("./TeacherWork").then(module => ({ default: module.TeacherWork })));

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

function MetricEvidenceTable({ lesson, metric, data, locate }: {
  lesson: Lesson; metric: Lesson["metrics"][number]; data: NonNullable<Session["run"]>["frames"]; locate: (tick: number, id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const size = 24;
  const last = Math.max(0, Math.ceil(data.length / size) - 1);
  const active = Math.min(last, page);
  return <details className="trace-details" id="metric-evidence" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>从指标数值反查事件</summary>
    {open && <>
      {last > 0 && <div className="decision-actions trace-pages" role="group" aria-label="事件表分页">
        <button type="button" disabled={!active} onClick={() => setPage(active - 1)}>上一页事件</button>
        <span>第 {active + 1} / {last + 1} 页</span>
        <button type="button" disabled={active === last} onClick={() => setPage(active + 1)}>下一页事件</button>
      </div>}
      <table>
        <caption>{metric.label}（{metric.unit}）</caption>
        <thead><tr><th scope="col">{lesson.tickUnit === "event" ? "事件序号" : "轮次"}</th><th scope="col">数值</th><th scope="col">定位原事件</th></tr></thead>
        <tbody>{data.slice(active * size, (active + 1) * size).map(item => <tr key={item.tick}>
          <th scope="row">{item.tick}</th><td>{displayObservation(item.metrics[metric.id])}</td>
          <td><button className="text-button" onClick={() => locate(item.tick, metric.id)}>
            定位{frameLabel(lesson.tickUnit, item.tick)}
          </button></td>
        </tr>)}</tbody>
      </table>
    </>}
  </details>;
}

function BridgeEvidence({ lesson, session, data, locate, selectActor }: {
  lesson: Lesson; session: Session; data: NonNullable<Session["run"]>["frames"];
  locate: (tick: number, metric: string, actorId?: string, eventId?: string) => void; selectActor: (id: string) => void;
}) {
  const run = session.run!;
  const frame = data[session.cursor];
  const metric = lesson.metrics.find(item => item.id === session.focusedMetric) ?? chartMetric(lesson);
  const prior = run.frames[frame.tick - 1];
  const deltas = relatedActors(frame, metric.id);
  const bank = lesson.casePackage?.caseId === "svb_run";
  const contributors = frame.events.filter(event => matchesMetric(event, metric.id) ||
    (bank && (bankEventDeltas(frame, prior, event)[metric.id] ?? 0) !== 0));
  const observedSignals = frame.events.filter(event => event.priorSignal);
  const evaluatedSignals = frame.actors.filter(actor => actor.priorSignal);
  let changeText = "运行开始后，可逐步追踪指标变化。";
  const current = frame.metrics[metric.id], previous = prior?.metrics[metric.id];
  if (lesson.casePackage?.caseId === "double_auction" && metric.id === "price") {
    changeText = typeof current === "number" ? `此事件的成交价是 ${current} ${metric.unit}。` : "此事件没有成交，价格曲线只标记实际成交。";
  } else if (typeof current === "number" && typeof previous === "number") {
    const difference = current - previous;
    changeText = `${metric.label}从 ${displayNumber(previous)} 变为 ${displayNumber(current)} ${metric.unit}，本步净变化 ${displayNumber(difference)} ${metric.unit === "%" ? "个百分点" : metric.unit}。`;
  } else if (typeof current === "number" && prior) {
    changeText = `${metric.label}在本步首次可比较，观察值为 ${displayNumber(current)} ${metric.unit}。`;
  } else if (prior) {
    changeText = `${metric.label}在相邻轮次中有缺值，净变化未定义。`;
  }
  return <EvidenceCard className="bridge-evidence" label="宏微观证据">
    <h2>从结果回查事件</h2>
    {(lesson.originalId || microscopeRole(lesson)) && <label className="metric-lookup">追踪指标
      <select aria-label="追踪指标" value={metric.id} onChange={event => locate(frame.tick, event.target.value)}>{lesson.metrics.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    </label>}
    <p>{changeText}</p>
    {bank && evaluatedSignals.length > 0 ? <p>本轮 {evaluatedSignals.length} 位储户的评分计入了上轮待付，
      其中 {observedSignals.length} 位提交了防御性提款。查看个体的评分与阈值，判断这一项是否改变决定。</p> :
      (observedSignals.length > 0 || evaluatedSignals.length > 0) && <p>{lesson.originalId ?
        "本步有个体使用了已记录的信号。选择个体可回查该时点。" : lesson.tickUnit === "event" ? "当前报价引用了已成交的价格。" :
        `本轮 ${observedSignals.length} 次个体决策引用了上轮公示。`}选择个体可回查该时点。</p>}
    {frame.tick > 0 && <details className="trace-details">
      <summary>查看{lesson.tickUnit === "event" ? "当前事件的" : "本轮 "} {deltas.length} 位贡献个体及事件</summary>
      {contributors.length ? <ul className="trace-list">{contributors
        .map(event => {
          const actorId = event.actorId;
          const delta = (bank ? bankEventDeltas(frame, prior, event) : event.deltas)[metric.id];
          const text = typeof delta === "number" ? `${event.text}（${delta > 0 ? "+" : ""}${displayNumber(delta)}）` : event.text;
          return <li key={event.id}>{bank ?
            <button className="text-button" onClick={() => locate(frame.tick, metric.id, actorId, event.id)}>
              {event.id} · {text}
            </button> : actorId ?
            <button className="text-button" onClick={() => selectActor(actorId)}>{text}</button> : text}</li>;
        })}</ul> :
        <p>本步没有改变这项指标的个体事件。</p>}
      {lesson.originalId && frame.events[0] && <p>原事件 {frame.tick} · {frame.events[0].text}</p>}
    </details>}
    {frame.equations && <details className="trace-details">
      <summary>核对本轮银行账表</summary>
      <ul>{frame.equations.map(equation => <li key={equation}>{equation}</li>)}</ul>
      {lesson.bridge && <p>模型规则 · {lesson.bridge.rule}</p>}
      <ul>{frame.events.filter(event => event.kind === "sale" || event.kind === "support" || event.kind === "revaluation")
        .map(event => <li key={event.id}><button className="text-button" onClick={() =>
          locate(frame.tick, event.kind === "support" ? "borrowing" : "equity", undefined, event.id)}>
          {event.id} · {event.text}
        </button></li>)}</ul>
    </details>}
    {lesson.originalId && <details className="trace-details">
      <summary>核对模型规则</summary><p>{lesson.bridge?.rule}</p>
    </details>}
    {lesson.rangeLookup && <IntervalLookup data={data} locate={tick => locate(tick, "moves")}/>}
    <MetricEvidenceTable lesson={lesson} data={data} metric={metric} locate={locate}/>
  </EvidenceCard>;
}

function IntervalLookup({ data, locate }: { data: NonNullable<Session["run"]>["frames"]; locate: (tick: number) => void }) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState<number>();
  const [page, setPage] = useState(0);
  const last = data.length - 1;
  const stop = end ?? last;
  const events = useMemo(() => data.slice(start + 1, stop + 1).filter(frame => (frame.events[0]?.deltas.moves ?? 0) > 0),
    [data, start, stop]);
  const lastPage = Math.max(0, Math.ceil(events.length / 12) - 1);
  const activePage = Math.min(page, lastPage);
  return <details className="trace-details">
    <summary>从区间反查搬迁</summary>
    <p>已揭示事件 0 至 {last}。查询包含终点，起点之后才计入。</p>
    <div className="range-fields">
      <label>起点事件<input type="number" min={0} max={stop} value={start}
        onChange={event => { setPage(0); setStart(Math.max(0, Math.min(stop, Math.trunc(event.target.valueAsNumber || 0)))); }} /></label>
      <label>终点事件<input type="number" min={start} max={last} value={stop}
        onChange={event => { setPage(0); setEnd(Math.max(start, Math.min(last, Math.trunc(event.target.valueAsNumber || 0)))); }} /></label>
    </div>
    <p role="status" aria-atomic="true" tabIndex={0}>
      {events.length ? `区间 (${start}, ${stop}] 共有 ${events.length} 次搬迁。` : "这个区间没有搬迁记录。"}
    </p>
    {!!events.length && <ol className="range-entries">{events.slice(activePage * 12, (activePage + 1) * 12).map(frame => <li key={frame.tick}>
      <button type="button" className="text-button" onClick={() => locate(frame.tick)}>定位搬迁 {frame.tick}</button>
      <span>{frame.events[0].text}</span>
    </li>)}</ol>}
    {lastPage > 0 && <div className="decision-actions trace-pages" role="group" aria-label="搬迁结果分页">
      <button type="button" onClick={() => setPage(activePage - 1)} disabled={!activePage}>上一页搬迁</button>
      <span>第 {activePage + 1} / {lastPage + 1} 页</span>
      <button type="button" onClick={() => setPage(activePage + 1)} disabled={activePage === lastPage}>下一页搬迁</button>
    </div>}
  </details>;
}

type StudioProps = {
  lesson: Lesson;
  review?: (session: Session, send: (command: Command) => void, nextAction?: ReactNode, openActor?: (id: string) => void) => ReactNode;
  reviewByTimeline?: boolean;
  observationFrame?: (run: Run, frame: Frame) => Frame;
  world?: (session: Session, select: (id: string) => void) => ReactNode;
  actorDetail?: (session: Session, select: (id: string) => void,
    locate: (tick: number, metric: string, actorId?: string, eventId?: string) => void) => ReactNode;
  afterInvestigation?: (session: Session) => ReactNode;
};

export function Studio(props: StudioProps) {
  const query = new URLSearchParams(location.search);
  const course = courseRef(query);
  const source = query.get("source");
  const side = query.get("side");
  if (course && query.get("view") === "teacher-work") return <Suspense fallback={<p role="status">正在打开作品核对…</p>}>
    <TeacherWork lesson={props.lesson} course={course}/>
  </Suspense>;
  if (course && query.get("experiment") === "1") return <ExperimentArchive lesson={props.lesson} course={course}/>;
  if (course && source && (side === "baseline" || side === "comparison")) {
    return <SavedSource lesson={props.lesson} id={source} side={side} {...course}/>;
  }
  return <LessonStudio {...props} course={course} fresh={query.get("fresh") === "1"}/>;
}

function LessonStudio({ lesson, review, reviewByTimeline, observationFrame, world, actorDetail, afterInvestigation, course, fresh }: StudioProps & { course?: CourseRef; fresh: boolean }) {
  const [{ initial, restoreFailed, opened }] = useState(() => {
    const initial = startLesson(lesson);
    if (!course) return { initial, restoreFailed: false, opened: null };
    try {
      const opened = progressSnapshot(localStorage, course);
      const saved = fresh ? undefined : resumeProgress(localStorage, course, lesson);
      return { initial: saved ?? initial, restoreFailed: !fresh && !saved && opened !== null, opened };
    } catch { return { initial, restoreFailed: true, opened: null }; }
  });
  const [session, send] = useReducer((state: Session, command: Command) => transition(lesson, state, command), initial);
  const lastSaved = useRef(session);
  const savedSnapshot = useRef(opened);
  const [saveConflict, setSaveConflict] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [, noteSaved] = useReducer((revision: number) => revision + 1, 0);
  useLayoutEffect(() => {
    if (session === lastSaved.current || !course || !session.choices.length || restoreFailed) return;
    try {
      const checkpoint = saveProgress(localStorage, course, session, savedSnapshot.current);
      if (checkpoint === undefined) {
        setSaveConflict(true);
        return;
      }
      savedSnapshot.current = checkpoint;
      if (fresh) history.replaceState(history.state, "", courseLink(course));
      lastSaved.current = session;
      setSaveFailed(false);
    } catch { setSaveFailed(true); }
  }, [course?.caseId, course?.market, fresh, restoreFailed, session]);

  const pauseReview = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const stageAction = useRef<HTMLButtonElement>(null);
  const actorPicker = useRef<HTMLSelectElement>(null);
  const focusActor = useRef(false);
  const [panel, setPanel] = useState<WorkbenchView>("world");
  const [traceOpen, setTraceOpen] = useState(!!session.traceFocus || session.perspective === "role");
  const traceHeading = useRef<HTMLHeadingElement>(null);
  const focusTrace = useRef(false);
  const previousStage = useRef(session.stage);
  const { stage, run } = session;
  const asOf = session.revealed;
  const visibleFrames = useMemo(() => {
    const frames = run?.frames.slice(0, asOf + 1) ?? [];
    return run && observationFrame ? frames.map(frame => observationFrame(run, frame)) : frames;
  }, [run, asOf, observationFrame]);
  const explained = stage === 4 && hasSavedExplanation(session);
  const roleView = stage === 3 && session.perspective === "role";
  const canTrace = !!course && !!microscopeRole(lesson) && stage === 3;
  const frame = visibleFrames[session.cursor];
  const actor = frame?.actors.find(entry => entry.id === session.selected);
  const event = frame?.events[0];
  const actorsInEvent = frame?.actors.filter(item => event?.participants?.includes(item.id) ||
    item.id === event?.actorId || item.id === event?.counterpartyId) ?? [];
  const metric = chartMetric(lesson);
  const activeMetric = session.focusedMetric
    ? lesson.metrics.find(item => item.id === session.focusedMetric) ?? metric : metric;
  const nextTurning = run?.frames.some(item => item.tick > session.cursor && item.turningPoint);
  const pauseTick = !roleView && reviewByTimeline && stage === 3 && frame?.turningPoint && !session.playing ? frame.tick : undefined;
  useEffect(() => {
    if (pauseTick === undefined || traceOpen || !window.matchMedia(workbenchMedia).matches) return;
    pauseReview.current?.focus({ preventScroll: true });
    pauseReview.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [pauseTick, traceOpen]);
  useLayoutEffect(() => {
    if (!focusActor.current) return;
    focusActor.current = false;
    actorPicker.current?.focus({ preventScroll: true });
    actorPicker.current?.scrollIntoView({ block: "nearest" });
  }, [panel, actor?.id]);
  useLayoutEffect(() => {
    if (traceOpen && focusTrace.current && traceHeading.current) {
      focusTrace.current = false;
      traceHeading.current.focus({ preventScroll: true });
      traceHeading.current.scrollIntoView({ block: "nearest" });
    }
  }, [traceOpen, session.cursor, session.traceFocus, activeMetric.id]);

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

  const turnNotice = !roleView && stage === 3 && frame?.turningPoint && <p className="turning-point" role="status">
    {frame.turningPoint}。{relatedActors(frame, metric.id).length > 0 && "画布高亮相关个体。"}
  </p>;
  const locate = (tick: number, metricId = metric.id, actorId?: string) =>
    send({ type: "locate", tick, metricId, actorId });
  function locateMetric(tick: number, metricId: string, actorId?: string, eventId?: string) {
    locate(tick, metricId, actorId);
    if (canTrace) {
      if (!traceOpen || tick !== session.cursor || activeMetric.id !== metricId || eventId) focusTrace.current = true;
      setTraceOpen(true);
      if (eventId) send({ type: "trace", focus: { tick, eventId }, actorId });
    }
  }
  function selectActor(actorId: string) {
    send({ type: "select", actorId });
    if (window.matchMedia(workbenchMedia).matches) {
      if (panel === "actors" && actorId === actor?.id) {
        actorPicker.current?.focus();
      } else {
        focusActor.current = true;
        setPanel("actors");
      }
    }
  }
  const replaying = !!run && !!frame && (stage === 2 || stage === 3);
  const title = stage === 1 ? lesson.title : stageNames[stage - 1];
  const nextStage = () => send({ type: "next-stage" });
  const ordinaryAdvance = stage < 4 && !(reviewByTimeline && stage === 3 && !roleView);
  const nextButton = ordinaryAdvance && <button className="primary stage-action" ref={stageAction}
    disabled={!ready} onClick={nextStage}>{nextLabels[stage - 1]}</button>;

  return <>
    <StudentHeader caseId={course?.caseId}/>
    <main className="shell lesson-shell studio" id="main" tabIndex={-1}>
      <Breadcrumb links={[{ href: "./#paths", label: "课程地图" }]} current={lesson.casePackage?.title ?? lesson.populationTitle}/>
      <ProgressStepper steps={stageNames} current={stage}/>
      {course && <LearningObjectives lesson={lesson} session={session} explained={explained}/>}
      {restoreFailed && <StatusNotice tone="error">这份进度无法恢复。本页的操作会保留原记录。
        {course && <a href={courseLink(course, { fresh: "1" })}>开始并保存新练习</a>}
      </StatusNotice>}
      {saveConflict && <StatusNotice tone="warning">另一标签已经更新进度。本页可继续操作。续学检查点保留另一标签保存的版本。
        <button type="button" onClick={() => location.reload()}>载入最新进度</button>
      </StatusNotice>}
      {saveFailed && <StatusNotice tone="warning">当前浏览器无法保存进度。可以继续学习，完成后导出结果。</StatusNotice>}
      <div className="studio-opening" data-replay={replaying}>
        <ActionPanel label="当前学习任务">
          <PageTitle headingRef={heading} description={stage === 1 ? undefined :
            stage === 3 ? lesson.bridge?.prompt ?? prompts[2] : prompts[stage - 1]}>{title}</PageTitle>
          {stage === 1 && <RoleDecisions lesson={lesson} session={session} send={send}/>}
          {stage === 1 && nextButton}
          {stage === 1 && <p className="source-note">{lesson.casePackage && <strong>{lesson.casePackage.identityLabel} · </strong>}
            {lesson.source.note}</p>}
          {stage === 1 && lesson.source.references && <details className="trace-details">
            <summary>{lesson.source.kind === "historical_event" ? "查看历史来源" : "查看案例资料与模型假设"}</summary>
            {lesson.casePackage && <>
              <p>{lesson.casePackage.syntheticPopulation.description}</p>
              {lesson.casePackage.modelAssumptions.map(item => <p key={item}>{item}</p>)}
            </>}
            {lesson.source.timeline && <ol className="history-timeline">{lesson.source.timeline.map(item => <li key={item.date}>
              <strong><time dateTime={item.date}>{item.date}</time></strong> · {item.text}
              <a href={item.url} target="_blank" rel="noreferrer" aria-label={`查阅 ${item.date} 史料`}>查阅史料</a>
            </li>)}</ol>}
            <ul>{lesson.source.references.map(source => <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            </li>)}</ul>
          </details>}
          {stage === 4 && <PredictionCard lesson={lesson} session={session} send={send}/>}
        </ActionPanel>
        {stage === 1 && <RoleView role={lesson.role}/>}
        {stage === 4 && <ComparisonView lesson={lesson} session={session} course={course}/>}
      </div>

      {replaying && <div className="studio-replay">
        <div className="studio-runbar" aria-label="共用回放控制" role="region">
          <p><strong>{frameLabel(lesson.tickUnit, frame.tick)}</strong> · {session.playing ? "播放中" : "已暂停"}</p>
          <Timeline session={session} send={send}/>
          <div className="studio-jumps">
            <button className="text-button" disabled={session.cursor === 0} onClick={() => send({ type: "back" })}>后退一步</button>
            {stage === 3 && !roleView && lesson.originalId && nextTurning && <button className="text-button" onClick={() => send({ type: "go-to-turn" })}>前往下一关键事件</button>}
            {stage === 3 && !roleView && lesson.bridge?.closeLabel && <button className="text-button" disabled={session.cursor === run.frames.length - 1}
              onClick={() => send({ type: "go-to-close" })}>{lesson.bridge.closeLabel}</button>}
          </div>
          {nextButton}
        </div>
        {!roleView && <Workbench active={panel} change={setPanel}
          world={<div className="canvas-panel">
            {world ? world(session, selectActor) : <MicroBoard lesson={lesson} frame={frame} prior={run.frames[session.cursor - 1]} selected={actor?.id} metricId={session.focusedMetric}
              select={selectActor}/>}
          </div>}
          actors={<EvidenceCard label="主体与关系">
            <h2>主体与关系</h2>
            <label className="actor-picker">选择个体<select ref={actorPicker} value={actor?.id ?? ""}
              onChange={event => send({ type: "select", actorId: event.target.value })}>
              <option value="" disabled>选择一位个体</option>
              {frame.actors.map(item => <option key={item.id} value={item.id}>{item.name} · {lesson.states[item.state].label}</option>)}
            </select></label>
            {actorsInEvent.length > 1 && <div className="event-parties" role="group" aria-label="当前事件涉及的主体">
              {actorsInEvent.map(item => <button key={item.id} className="text-button" onClick={() => selectActor(item.id)}
                aria-pressed={item.id === actor?.id}>{item.name}</button>)}
            </div>}
            {actor ? <Inspector actor={actor} stateName={lesson.states[actor.state].label}
              frame={frame} tickUnit={lesson.tickUnit} metricId={activeMetric.id} locate={stage === 3 ? locateMetric : undefined}/> :
              <p>从画布或名单选一位个体，查看这一时点的状态、约束和关联事件。</p>}
            {actor && actorDetail?.(session, selectActor, locateMetric)}
          </EvidenceCard>}
          system={stage === 3 ? <EvidenceCard label="宏观指标曲线" className="macro-view">
              <MetricCard label={activeMetric.label} value={typeof frame.metrics[activeMetric.id] === "number"
                ? `${displayNumber(frame.metrics[activeMetric.id])} ${activeMetric.unit}`
                : displayObservation(frame.metrics[activeMetric.id])}/>
              {lesson.bridge && <dl className="bank-readout">{lesson.bridge.metrics.filter(id => id !== activeMetric.id).map(id => {
                const context = lesson.metrics.find(item => item.id === id);
                if (!context) return null;
                const value = frame.metrics[id];
                const baseline = run.frames[0].metrics[id];
                const difference = typeof value === "number" && typeof baseline === "number" ? value - baseline : null;
                const banking = lesson.casePackage?.caseId === "svb_run";
                return <div key={id}><dt>{canTrace ? <button className="text-button" type="button"
                  onClick={() => locate(frame.tick, id)} aria-label={`追踪${context.label}`}>{context.label}</button> : context.label}</dt>
                  <dd>{displayNumber(value)}{(banking || lesson.originalId) && value != null && context.unit ? ` ${context.unit}` : ""}
                  {id === lesson.priceMetric && difference !== null && difference !== 0 && <span data-financial-move={difference > 0 ? "up" : "down"}>
                    {difference > 0 ? "+" : ""}{displayNumber(difference)}
                  </span>}</dd></div>;
              })}</dl>}
              <Suspense fallback={<StatusNotice>正在绘制曲线…</StatusNotice>}>
                <MetricChart metric={activeMetric} financial={activeMetric.id === lesson.priceMetric}
                  frames={visibleFrames} cursor={session.cursor}
                  onSelect={tick => locateMetric(tick, activeMetric.id)}/>
              </Suspense>
              {!visibleFrames.some(item => typeof item.metrics[activeMetric.id] === "number") &&
                <p className="small">已揭示的记录里还没有这项指标的数值。</p>}
              <a className="chart-evidence-link" href="#metric-evidence" onClick={() => {
                const table = document.querySelector<HTMLDetailsElement>("#metric-evidence");
                if (table) { table.open = true; table.querySelector("summary")?.focus({ preventScroll: true }); }
              }}>按表格查原事件</a>
            </EvidenceCard> : undefined}/>}
        {canTrace && <details className="edu-panel microscope-wrap" id="microscope" open={traceOpen}
          onToggle={event => setTraceOpen(event.currentTarget.open)}>
          <summary>涌现显微镜</summary>
          {traceOpen && <TraceMicroscope lesson={lesson} session={session} metricId={activeMetric.id}
            course={course} send={send} headingRef={traceHeading} announceFollow={() => { focusTrace.current = true; }}/>}
        </details>}
        {!roleView && <div className="studio-evidence" id="run-evidence" tabIndex={-1}>
          {!reviewByTimeline && turnNotice}
          {reviewByTimeline && stage === 3 ? <section ref={pauseReview} tabIndex={-1}
            className="replay-review edu-panel" aria-label="当前成交证据与下一步">
            {turnNotice}
            {review?.(session, send, <button className="primary stage-action" ref={stageAction} disabled={!ready && pauseTick === undefined}
              onClick={() => send({ type: ready ? "next-stage" : "step" })}>
              {!ready && pauseTick !== undefined ? "下一步 · 查看后续报价" : "试一项政策"}
            </button>)}
          </section> : review?.(session, send, undefined, selectActor)}
          {stage === 3 && <ForecastReview lesson={lesson} session={session} locate={locateMetric}/>}
          {stage === 3 && <BridgeEvidence lesson={lesson} session={session} data={visibleFrames} locate={locateMetric} selectActor={selectActor}/>}
        </div>}
      </div>}
      {stage === 4 && (session.comparison || afterInvestigation) && <div className="studio-results">
        {session.comparison && <>
          {review?.(session, send)}
          {course && <Investigation key={session.comparison.run.id} course={course} lesson={lesson} session={session}
            onSaved={noteSaved}/>}
        </>}
        {afterInvestigation?.(session)}
        {course && explained && <LearningJourney caseId={course.caseId}/>}
      </div>}
      {course && stage === 1 && <p><a href={courseLink(course, { experiment: "1" })}>恢复本课实验卡</a></p>}
      {course && session.choices.length > 0 && <a className="restart-link" href={courseLink(course, { fresh: "1" })}>从头再练</a>}
    </main>
  </>;
}
