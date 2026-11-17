import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { catalog, caseHref, legacyCourseHref } from "../catalog";
import { ApiError, api, downloadJson } from "../contracts";
import type { Course } from "../lesson-types";
import { MetricChart } from "../lesson-view";
import { TutorPanel } from "../tutor";
import { FlagshipCompare } from "./flagship-compare";
import { FlagshipNotes } from "./flagship-notes";
import { usePlaybackFocus } from "./playback-focus";
import { eventActors, eventMatch, fieldStudyKey, getFieldView, legacyProgress, readFieldStudy, sourceRef,
  type FieldStudy, type PairRef } from "./flagship-study";
import type { FieldLesson, FlagshipView, SceneContent, SceneQuestion, Tick } from "./flagship-types";
import "./flagship.css";

const stages = ["intro", "predict", "bid", "observe", "explain", "compare", "notebook"];

function fromUrl(defaultStage: number, unlocked: number) {
  const params = new URLSearchParams(location.search);
  if (!params.has("scene")) return { stage: defaultStage, warning: "" };
  const stage = stages.indexOf(params.get("scene") ?? "");
  const warning = params.getAll("scene").length !== 1 || stage < 0 ? "场景地址无效，已打开本机进度。" :
    stage > unlocked ? "完成前面场景后可打开此链接。" : "";
  return { stage: warning ? defaultStage : stage, warning };
}

function Playback({ view, cursor, review, pending, revealed, seek, setReview, playbackRef, evidenceSelected }: {
  view: FlagshipView; cursor: Tick; review: boolean; pending: boolean; revealed: number;
  seek: (tick: Tick) => void; setReview: (review: boolean) => void;
  playbackRef: RefObject<HTMLInputElement | null>;
  evidenceSelected: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const nextAutoTick = useRef<number | null>(null);
  const clock = view.closed ? "运行结束" : view.clock == null || view.clock === 0 ? (view.tick === 0 ? "开局" : "当前事件") :
    ["svb_run", "schelling_segregation"].includes(view.case_id) ? `第 ${view.clock} 轮` :
      `${view.clock_label ?? "观察时点"} ${view.clock}`;
  useEffect(() => {
    if (!playing) return;
    if (evidenceSelected) {
      nextAutoTick.current = null;
      setPlaying(false);
      return;
    }
    if (pending) return;
    if (nextAutoTick.current !== null && nextAutoTick.current !== view.tick) {
      nextAutoTick.current = null;
      setPlaying(false);
      return;
    }
    if (view.closed || (nextAutoTick.current === view.tick && view.checkpoint_here)) {
      nextAutoTick.current = null;
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      nextAutoTick.current = view.tick + 1;
      seek(view.tick + 1);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [playing, pending, seek, view.tick, view.closed, view.checkpoint_here, evidenceSelected]);
  const jump = (tick: Tick) => { nextAutoTick.current = null; setPlaying(false); seek(tick); };
  const max = review ? view.end ?? revealed : revealed;
  const sliderTick = pending && typeof cursor === "number" ? Math.min(cursor, max) : view.tick;
  const previousUnavailable = view.tick === 0 || pending;
  const nextUnavailable = view.closed || pending;
  const playUnavailable = view.closed || (!playing && pending);
  return <section className="field-playback" aria-label="回放控制">
    <div className="field-playback-top">
      <strong>{clock} · 事件 {view.tick}</strong>
      <label><input type="checkbox" checked={review} onChange={event => {
        nextAutoTick.current = null; setPlaying(false); setReview(event.target.checked);
      }}/> 查看全程</label>
    </div>
    <label className="field-input">
      <span className="field-sr-only">回放事件</span>
      <input ref={playbackRef} type="range" aria-label="回放事件" aria-valuetext={sliderTick === view.tick
        ? `${clock}，事件 ${view.tick}` : `正在定位，目标事件为 ${sliderTick}`}
        min={0} max={Math.max(1, max)} disabled={max === 0} value={sliderTick}
        onChange={event => jump(Number(event.target.value))}/>
    </label>
    <div className="toolbar">
      <button aria-disabled={previousUnavailable} onClick={() => {
        if (!previousUnavailable) jump(view.tick - 1);
      }}>上一个事件</button>
      <button aria-disabled={nextUnavailable} onClick={() => {
        if (!nextUnavailable) jump(view.tick + 1);
      }}>下一个事件</button>
      <button aria-disabled={playUnavailable} onClick={() => {
        if (playUnavailable) return;
        nextAutoTick.current = null;
        setPlaying(!playing);
      }}>{playing ? "暂停" : "播放"}</button>
      <button className="text-button" aria-disabled={nextUnavailable} onClick={() => {
        if (!nextUnavailable) jump("close");
      }}>快进到结束</button>
    </div>
    {view.checkpoint_here && <p className="field-muted">到达观察节点，可核对当前事件后继续。</p>}
    {review && <p className="field-muted">复盘模式可查看本次运行的完整指标轨迹。</p>}
  </section>;
}

export function FlagshipLesson({ caseId, Panel, defaultActor }: FieldLesson) {
  const course = catalog.find(item => item.case_id === caseId) as Course;
  const [loaded] = useState(() => readFieldStudy(caseId));
  const [legacy] = useState(() => legacyProgress(course));
  const [content, setContent] = useState<SceneContent>();
  const [briefing, setBriefing] = useState<unknown>();
  const [study, setStudy] = useState<FieldStudy>(() => {
    const saved = loaded.study ?? {
      case_id: caseId, content_version: "", stage: 0, unlocked: 0, action: course.action.default, runs: {},
      tick: 0, revealed: 0, pinned: defaultActor, answers: {}, confidence: "",
      forecasts: {}, evidence: [], comparisons: [], explanation: "", condition: "", updatedAt: 0,
    };
    return { ...saved, stage: fromUrl(saved.stage, saved.unlocked).stage };
  });
  const [warning, setWarning] = useState(() => fromUrl(loaded.study?.stage ?? 0, loaded.study?.unlocked ?? 0).warning);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [cursor, setCursor] = useState<Tick>(study.tick);
  const [loadedView, setLoadedView] = useState<{ key: string; review: boolean; view: FlagshipView }>();
  const selected = content?.scenes[study.stage];
  const baseline = study.runs.baseline;
  const viewing = study.stage === 3 || study.stage === 4;
  const viewKey = `${baseline}/${cursor}/${review}`;
  const priorView = loadedView?.view.run_id === baseline ? loadedView?.view : undefined;
  const view = loadedView?.review === review ? priorView : undefined;
  const pending = viewing && !!baseline && !readError && viewKey !== loadedView?.key;
  const { playbackRef, focusAfterSeek, clearPlaybackFocus, evidenceSelected } =
    usePlaybackFocus(!!view && !pending && !readError && viewing);
  const heading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);
  const startId = useRef<{ signature: string; key: string } | undefined>(undefined);

  const save = useCallback((patch: Partial<FieldStudy>) => setStudy(previous => ({
    ...previous, ...patch, updatedAt: Date.now(),
  })), []);
  useEffect(() => {
    const controller = new AbortController();
    api<SceneContent>(`/cases/${caseId}/lesson`, undefined, controller.signal).then(setContent)
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message); });
    api(`/cases/${caseId}/briefing`, undefined, controller.signal).then(setBriefing)
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [caseId]);

  useEffect(() => {
    if (!content || !study.updatedAt) return;
    if (study.content_version && study.content_version !== content.content_version) return;
    try {
      localStorage.setItem(fieldStudyKey(caseId), JSON.stringify({ ...study, content_version: content.content_version }));
      setStorageError("");
    } catch {
      setStorageError("浏览器无法保存本机进度。可导出当前草稿。");
    }
  }, [caseId, study, content]);

  useEffect(() => {
    if (!new URLSearchParams(location.search).has("scene")) {
      const saved = readFieldStudy(caseId).study;
      history.replaceState({}, "", `?scene=${stages[saved?.stage ?? 0]}`);
    }
    const navigate = () => {
      const saved = readFieldStudy(caseId).study;
      const result = fromUrl(saved?.stage ?? 0, saved?.unlocked ?? 0);
      clearPlaybackFocus();
      save({ stage: result.stage });
      setWarning(result.warning);
      setReview(false);
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, [caseId, save, clearPlaybackFocus]);

  useEffect(() => {
    if (!baseline || !viewing || !content) return;
    const controller = new AbortController();
    setReadError("");
    getFieldView(baseline, cursor, review, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.case_id !== caseId || result.case_version !== course.version || result.scenario_id !== "baseline" ||
          result.action !== study.action || result.seed !== course.seed || result.engine_version !== content.engine_version) {
        throw new Error("本机运行与当前课程、行动或版本不一致。");
      }
      setLoadedView({ key: viewKey, review, view: result });
      setStudy(previous => previous.tick === result.tick && previous.revealed >= result.tick ? previous :
        { ...previous, tick: result.tick, revealed: Math.max(previous.revealed, result.tick) });
    }).catch(problem => { if (!controller.signal.aborted) setReadError(problem.message); });
    return () => controller.abort();
  }, [caseId, course.version, course.seed, study.action, content, baseline, cursor, review, viewKey, viewing]);

  useEffect(() => {
    if (moveFocus.current && heading.current) {
      heading.current.focus();
      window.scrollTo(0, 0);
      moveFocus.current = false;
    }
  }, [study.stage, selected]);

  const seek = useCallback((tick: Tick) => {
    clearPlaybackFocus();
    setCursor(tick);
  }, [clearPlaybackFocus]);
  function seekEvidence(tick: Tick) {
    seek(tick);
    focusAfterSeek();
  }
  const seekPanelEvent = viewing && caseId === "svb_run" ? seekEvidence : seek;

  function visit(stage: number) {
    if (stage === study.stage) return;
    clearPlaybackFocus();
    save({ stage, unlocked: Math.max(study.unlocked, stage), content_version: content?.content_version ?? "" });
    history.pushState({}, "", `?scene=${stages[stage]}`);
    moveFocus.current = true;
    setReview(false);
    setError("");
    setWarning("");
    setStatus("");
  }

  async function launch(scenario: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    const parent = scenario === "baseline" ? null : baseline;
    const signature = `${scenario}/${study.action}/${parent ?? ""}`;
    if (startId.current?.signature !== signature) startId.current = { signature, key: crypto.randomUUID() };
    const requestId = startId.current.key;
    try {
      await api("/runs", { case_id: caseId, scenario_id: scenario, provider_kind: "rule",
        request_id: requestId, seed: course.seed, action: study.action, parent_run_id: parent });
      const run = await api<Pick<FlagshipView, "case_id" | "scenario_id" | "action" | "run_id">>(
        `/runs/${requestId}/start?manifest_only=true`, {});
      if (run.case_id !== caseId || run.scenario_id !== scenario || run.action !== study.action || run.run_id !== requestId) {
        throw new Error("运行回执与请求不一致。请重试。");
      }
      startId.current = undefined;
      if (scenario === "baseline") {
        save({ runs: { baseline: requestId }, tick: 0, revealed: 0 });
        seek(0);
        visit(3);
      } else save({ runs: { ...study.runs, [scenario]: requestId } });
    } catch (problem) {
      if (problem instanceof ApiError && ["RUN_FAILED", "RUN_ALREADY_TERMINAL"].includes(problem.code)) startId.current = undefined;
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resumeLegacy() {
    if (!legacy?.runs.baseline || !content) return;
    setBusy(true);
    setError("");
    try {
      const runId = legacy.runs.baseline;
      const bookmark = legacy.selections[runId];
      const restored = await getFieldView(runId, bookmark?.tick ?? 0);
      if (restored.case_id !== caseId || restored.case_version !== course.version ||
          restored.engine_version !== content.engine_version || restored.scenario_id !== "baseline" ||
          restored.action !== legacy.action || restored.seed !== course.seed) throw new Error("旧基准运行无法核对。");
      save({ runs: { baseline: runId }, action: restored.action, tick: restored.tick,
        revealed: restored.tick, pinned: bookmark?.actor || defaultActor });
      seek(restored.tick);
      visit(3);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function renderWorld(mainView?: FlagshipView, branchView?: FlagshipView) {
    return <Panel stage={stages[study.stage]} course={course} briefing={briefing} action={study.action}
      view={mainView} comparison={branchView} tick={mainView?.tick ?? 0}
      pinned={study.pinned} pin={pinned => save({ pinned })} seek={seekPanelEvent} review={review}
      records={study.records} record={(key, value) => save({ records: { ...study.records, [key]: value } })}
      cite={(seq, actor, arm) => {
        const source = arm === "comparison" ? branchView : mainView;
        const event = source?.events[seq];
        if (!source || !event || event.seq !== seq || event.tick > source.tick || (actor && !eventActors(event).includes(actor))) {
          setStatus("当前时刻没有可引用的记录。");
          return;
        }
        const ref = sourceRef(source, event, actor);
        setStudy(previous => previous.evidence.length >= 200 || previous.evidence.some(item =>
          item.run_id === source.run_id && item.seq === seq && item.actor === actor) ? previous :
          { ...previous, evidence: [...previous.evidence, ref], updatedAt: Date.now() });
        setStatus(`已引用事件 ${seq}${actor ? `（${actor}）` : ""}。`);
      }}/>;
  }

  function capture(pair: PairRef) {
    if (study.comparisons.length < 100) save({ comparisons: [...study.comparisons, pair] });
  }

  function questions(stage: typeof selected, includePrediction = true) {
    return stage?.questions.filter(question => includePrediction || question.kind !== "prediction").map(question => {
      const chosen = study.answers[question.id]?.latest;
      const linked = question.selector && (view?.events ?? []).find(event =>
        event.tick <= (view?.tick ?? -1) && eventMatch(event, question.selector!, view));
      return <fieldset key={question.id} className="field-question">
        <legend>{question.prompt}</legend>
        <div className="options">{question.options.map(option => <label key={option.id}>
          <input type="radio" name={question.id} value={option.id}
            checked={study.answers[question.id]?.latest === option.id} onChange={() => answer(question, option.id)}/>
          {option.label}
        </label>)}</div>
        {chosen && <div className="field-feedback"><p role="status">
          {question.options.find(option => option.id === chosen)?.feedback}</p>
          {linked && viewing && <button className="text-button" onClick={() => seek(linked.tick)}>查看反馈依据 · 事件 {linked.seq}</button>}
          {!linked && viewing && question.selector && <p className="field-muted">当前时点还没有这类证据。</p>}
        </div>}
      </fieldset>;
    });
  }
  function answer(question: SceneQuestion, value: string) {
    const previous = study.answers[question.id];
    save({ answers: { ...study.answers, [question.id]: { first: previous?.first ?? value, latest: value, original: previous?.original } } });
  }
  function commitPrediction() {
    const checked = selected?.questions.filter(question => question.kind === "prediction") ?? [];
    if (checked.some(question => !study.answers[question.id]?.latest)) {
      setError("请选择一项预测，也可以选择不确定。");
      return;
    }
    const answers = { ...study.answers };
    for (const question of checked) {
      const response = answers[question.id];
      answers[question.id] = { ...response, original: response.original ?? response.latest };
    }
    save({ answers, originalConfidence: study.originalConfidence ?? study.confidence });
    visit(2);
  }

  if (!selected) return <main id="main" tabIndex={-1} className="container field-lesson">
    {error ? <p role="alert" className="error">{error}</p> : <p role="status">正在读取课堂…</p>}
  </main>;
  if (study.content_version && content && study.content_version !== content.content_version) return <main id="main" tabIndex={-1} className="container field-lesson">
    <h1>此笔记来自另一内容版本</h1><p>可导出当前草稿，或继续原版课堂。</p>
    <button onClick={() => downloadJson(`${caseId}-lesson-v2.json`, study)}>导出当前草稿</button>
    <p><a href={legacyCourseHref(caseId)}>打开原版课堂</a></p>
  </main>;

  const predictions = content?.scenes[1]?.questions.filter(question => question.kind === "prediction") ?? [];
  const tutorView = viewing && !readError ? view : undefined;
  const prediction = study.answers[predictions[0]?.id];
  const currentEvent = view?.events[view.tick];
  const eventPrefix = view?.events.slice(0, view.tick + 1) ?? [];
  const shownEvidence = selected.evidence && eventPrefix.filter(event => eventMatch(event, selected.evidence!.selector, view)).at(-1);
  const outcomes = view && predictions.map(question => {
    const response = study.answers[question.id];
    const match = question.selector && eventPrefix.find(event => eventMatch(event, question.selector!, view));
    const truth = match ? "yes" : view.closed ? "no" : undefined;
    return <div key={question.id}>
      <p><strong>{question.prompt}</strong></p>
      {response && <p>原预测 {question.options.find(option => option.id === (response.original ?? response.first))?.label}
        {study.originalConfidence && ` · 信心${study.originalConfidence}`}</p>}
      <p>{match ? `已在事件 ${match.seq} 发生。` : view.closed ? "运行结束，未出现匹配事件。" : "目前未出现，结果待定。"}
        {truth && response?.original && response.original !== "unknown" ?
          truth === response.original ? "与原预测一致。" : "与原预测不同。" : ""}</p>
      {match && <button className="text-button" onClick={() => seek(match.tick)}>定位预测证据</button>}
      <label className="field-input">修订预测 <select aria-label="修订预测" value={response?.latest ?? ""}
        onChange={event => answer(question, event.target.value)}>
        <option value="" disabled>选择判断</option>
        {question.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select></label>
    </div>;
  });

  return <main id="main" tabIndex={-1} className="container field-lesson">
    <nav className="field-scenes" aria-label="学习场景">
      {content?.scenes.map((scene, index) => <button key={scene.id} aria-current={index === study.stage ? "step" : undefined}
        disabled={index > study.unlocked || busy} onClick={() => visit(index)}>{scene.title}</button>)}
    </nav>
    <label className="field-scene-picker field-input">
      场景 {study.stage + 1} / {stages.length}
      <select aria-label="学习场景" disabled={busy} value={study.stage} onChange={event => visit(Number(event.target.value))}>
        {content?.scenes.map((scene, index) => <option value={index} key={scene.id} disabled={index > study.unlocked}>{scene.title}</option>)}
      </select>
    </label>
    <header className="field-title">
      <div><h1 ref={heading} tabIndex={-1}>{selected.title}</h1><p>{selected.question}</p></div>
      <a href={caseHref(caseId)}>{course.title} · 案例导入</a>
    </header>
    {[warning, error, readError, storageError].filter(Boolean).map(message => <p className="error" role="alert" key={message}>{message}</p>)}
    {loaded.bad && !study.updatedAt && <p role="alert" className="error">本机新版草稿无法读取。原版进度仍可从案例导入进入。</p>}
    {viewing && !baseline && <p role="alert">本地记录缺少对应运行。可回到行动场景生成实验。</p>}
    {(readError || storageError) && <button onClick={() => downloadJson(`${caseId}-lesson-v2.json`, study)}>导出当前草稿</button>}
    {readError && <p><a href={legacyCourseHref(caseId)}>打开原版课堂</a> · <button className="text-button" onClick={() => location.reload()}>重试读取</button></p>}
    <div className="field-workspace">
      <aside className="field-task">
        <p>{selected.objective}</p>
        {selected.role && <div><h2>{selected.role.label}</h2><p>{selected.role.goal}</p></div>}
        <details open={!viewing && study.stage < 3}><summary>任务说明</summary>
          {selected.information.map(item => <p key={item}>{item}</p>)}
        </details>
        <details><summary>来源与模型</summary>
          <p>{course.identity_label} · 课堂运行使用教学模型</p><p>{course.background}</p>
          {course.sources.map(source => <p key={source.id}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}
        </details>
      </aside>
      <div className="field-action">
        {study.stage <= 2 && renderWorld()}
        {study.stage === 0 && <>
          {questions(selected)}
          <div className="toolbar"><button className="primary" disabled={busy} onClick={() => visit(1)}>开始学习</button>
            {!baseline && legacy?.runs.baseline && <button disabled={busy} onClick={() => void resumeLegacy()}>用旧版基准运行继续</button>}</div>
        </>}
        {study.stage === 1 && <>
          {questions(selected)}
          {!!predictions.length && <label className="field-input">预测信心 <select aria-label="预测信心" value={study.confidence}
            onChange={event => save({ confidence: event.target.value })}>
            <option value="">可选</option><option>高</option><option>中</option><option>低</option>
          </select></label>}
          <button className="primary" onClick={commitPrediction}>选择行动</button>
        </>}
        {study.stage === 2 && <>
          {questions(selected)}
          {baseline ? <button className="primary" onClick={() => visit(3)}>继续观察</button> :
            <div className="toolbar field-action-choice">
              <label className="field-input">{course.action.label}
                <select aria-label={course.action.label} value={study.action} disabled={busy}
                  onChange={event => save({ action: event.target.value })}>
                  {course.action.options.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}
                </select>
              </label>
              <button className="primary" disabled={busy} onClick={() => void launch("baseline")}>运行基础实验</button>
            </div>}
        </>}
        {viewing && priorView && !readError &&
          <Playback view={priorView} cursor={cursor} review={review} pending={pending}
            revealed={study.revealed} seek={seek} setReview={setReview} playbackRef={playbackRef}
            evidenceSelected={evidenceSelected}/>}
        {viewing && pending && !view && <p role="status">正在读取运行…</p>}
        {viewing && view && !readError && <>
          {renderWorld(view)}
          <details><summary>指标图与事件</summary>
            <MetricChart course={course} frames={view.series} tick={view.tick} change={seek}/>
            {currentEvent && <p>{currentEvent.summary}</p>}
            {currentEvent && course.evidence_types.includes(currentEvent.event_type) &&
              <button onClick={() => {
                const ref = sourceRef(view, currentEvent);
                if (study.evidence.length < 200 && !study.evidence.some(item => item.run_id === ref.run_id &&
                    item.seq === ref.seq && !item.actor)) save({ evidence: [...study.evidence, ref] });
                setStatus(`已引用事件 ${ref.seq}。`);
              }}>引用当前事件</button>}
          </details>
          {study.stage === 4 && <>
            {outcomes && outcomes.length > 0 && <section className="field-outcome"><h2>回看入场预测</h2>{outcomes}</section>}
            {selected.evidence && (shownEvidence ?
              <button className="text-button" onClick={() => seek(shownEvidence.tick)}>定位场景证据 · 事件 {shownEvidence.seq}</button> :
              <p>{selected.evidence.missing}</p>)}
          </>}
          {questions(selected, false)}
          <button className="primary" disabled={pending || (study.stage === 3 && !view.closed && study.unlocked < 4)}
            onClick={() => visit(study.stage + 1)}>{study.stage === 3 ? "进入解释" : "进行对照"}</button>
          {study.stage === 3 && !view.closed && study.unlocked < 4 && <p className="field-muted">推进至结束后，回查关键节点并解释结果。</p>}
        </>}
        {study.stage === 5 && <>
          <FlagshipCompare course={course} study={study} busy={busy} run={scenario => void launch(scenario)} capture={capture}
            forecast={(scenario, value) => save({ forecasts: { ...study.forecasts, [scenario]: value } })}
            renderWorld={renderWorld}/>
          {questions(selected, false)}
          <div className="toolbar"><button className="primary" disabled={busy || !course.scenarios.every(scenario => study.runs[scenario.id])}
            onClick={() => visit(6)}>写实验笔记</button>
            <a href={`/compare?case=${encodeURIComponent(caseId)}`}>自定义参数对照</a></div>
        </>}
        {study.stage === 6 && <>
          {selected.rubric && <p>{selected.rubric}</p>}
          {questions(selected, false)}
          <FlagshipNotes study={study} content={content} title={course.title} edit={save}/>
          <button className="primary" disabled={!!storageError} onClick={() => {
            save({ content_version: content!.content_version });
            setStatus("笔记已保存在此浏览器。");
          }}>保存笔记</button>
        </>}
        <TutorPanel caseId={caseId} runId={tutorView?.run_id} tick={tutorView?.tick} revealUntil={tutorView?.tick}
          scene={{ id: selected.id, actor: tutorView ? study.pinned : defaultActor,
            prediction: prediction?.original ?? prediction?.latest, evidence: study.evidence }}
          onSeek={viewing ? seekEvidence : undefined}/>
        {busy && <p role="status">正在处理本地运行…</p>}
        {status && <p role="status">{status}</p>}
      </div>
    </div>
  </main>;
}
