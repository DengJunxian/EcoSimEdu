import { useCallback, useEffect, useRef, useState } from "react";
import lesson from "../../../../cases/double_auction/case.json";
import { api, downloadJson, type Provider } from "../../contracts";
import { readStudy } from "../../study";
import { TutorPanel } from "../../tutor";
import { usePlaybackFocus } from "../../learning/playback-focus";
import { AuctionCompare } from "./auction-compare";
import { AuctionExplain } from "./auction-explain";
import { AuctionNotes } from "./auction-notes";
import { auctionStages, auctionStudyKey, auctionView, emptyAuctionStudy, readAuctionStudy,
  type AuctionEvidence, type AuctionStudy, type AuctionView, type Branch, type Mode, type Prediction } from "./auction-study";
import { MarketFloor } from "./market-floor";
import { AuctionSelection } from "./selection-context";
import "./auction.css";

type Question = {
  id: string;
  prompt: string;
  kind?: "concept" | "prediction";
  options: { id: string; label: string; feedback: string }[];
  selector?: Selector;
};
type Selector = { event_type: string; actor_id?: string; fields: string[] };
type Scene = {
  id: string;
  title: string;
  question: string;
  objective: string;
  information: string[];
  questions: Question[];
  role?: { actor_id: string; label: string; goal: string };
  evidence?: { selector: Selector; missing: string };
  rubric?: string;
  next_scene: string | null;
};
type Course = { content_version: string; scenes: Scene[] };

function matches(selector: Selector, event: AuctionView["events"][number]) {
  return event.event_type === selector.event_type &&
    (!selector.actor_id || [event.actor_id, event.buyer_id, event.seller_id].includes(selector.actor_id)) &&
    selector.fields.every(field => Object.hasOwn(event, field));
}

function resolveScene(study: AuctionStudy) {
  const requested = new URLSearchParams(window.location.search).get("scene");
  const index = requested ? auctionStages.indexOf(requested) : -1;
  if (!requested) return { scene: study.scene, warning: "" };
  if (index < 0) return { scene: study.scene, warning: "链接中的场景不存在。已打开本机保存的场景。" };
  if (index > study.unlocked) return { scene: study.scene, warning: "请先完成前面的任务，再进入链接中的场景。" };
  return { scene: requested, warning: "" };
}

export function AuctionLesson() {
  const [study, setStudy] = useState<AuctionStudy>(() => {
    const previous = readAuctionStudy() ?? emptyAuctionStudy;
    return { ...previous, scene: resolveScene(previous).scene };
  });
  const [course, setCourse] = useState<Course>();
  const [linkWarning, setLinkWarning] = useState(() => resolveScene(readAuctionStudy() ?? emptyAuctionStudy).warning);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [modeOverride, setMode] = useState<Mode>();
  const [cursor, setCursor] = useState<number | "close">(study.tick);
  const [opened, setOpened] = useState<{ key: string; mode: Mode; explaining: boolean; view: AuctionView }>();
  const [selectedActor, selectActor] = useState("");
  const [branch, setBranch] = useState<Branch>("demand");
  const [checkpoint, setCheckpoint] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusChapter = useRef(false);
  const [legacy] = useState(() => readStudy().study);
  const scene = course?.scenes.find(item => item.id === study.scene);
  const stage = auctionStages.indexOf(study.scene);
  const baseline = study.runs.baseline;
  const explaining = study.scene === "explain";
  const mode = modeOverride ?? (explaining || study.scene === "compare" ? "review" : "guided");
  const viewing = stage >= 3 && stage <= 5;
  const viewedCursor = study.scene === "compare" ? "close" : cursor;
  const viewKey = `${baseline}/${viewedCursor}/${mode}/${explaining}`;
  const view = opened && opened.view.run_id === baseline && opened.mode === mode &&
    opened.explaining === explaining ? opened.view : undefined;
  const pending = viewing && !!baseline && opened?.key !== viewKey && !readError;
  const { playbackRef, focusAfterSeek, clearPlaybackFocus, evidenceSelected } = usePlaybackFocus(
    !!view && !pending && !readError && viewing && study.scene !== "compare",
  );

  useEffect(() => {
    let active = true;
    api<Course>("/cases/double_auction/lesson").then(result => { if (active) setCourse(result); })
      .catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(auctionStudyKey, JSON.stringify(study));
      setStorageError("");
    } catch {
      setStorageError("浏览器无法保存学习记录。可以导出当前草稿。");
    }
  }, [study]);
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("scene")) {
      const saved = readAuctionStudy() ?? emptyAuctionStudy;
      window.history.replaceState({}, "", `?scene=${encodeURIComponent(saved.scene)}`);
    }
    const onHistory = () => {
      const resolved = resolveScene(readAuctionStudy() ?? emptyAuctionStudy);
      clearPlaybackFocus();
      setStudy(current => ({ ...current, scene: resolved.scene }));
      setLinkWarning(resolved.warning);
      setMode(undefined);
    };
    window.addEventListener("popstate", onHistory);
    return () => window.removeEventListener("popstate", onHistory);
  }, [clearPlaybackFocus]);
  useEffect(() => {
    if (focusChapter.current && heading.current) {
      heading.current.focus();
      focusChapter.current = false;
    }
  }, [scene]);
  useEffect(() => {
    if (!baseline || !viewing) return;
    let active = true;
    setReadError("");
    auctionView(baseline, viewedCursor, mode, explaining).then(result => {
      if (!active) return;
      setOpened({ key: viewKey, mode, explaining, view: result });
      if (viewedCursor === "close" && stage === 5) return;
      setStudy(previous => ({
        ...previous, tick: result.tick, revealed: Math.max(previous.revealed, result.tick),
      }));
    }).catch(problem => { if (active) setReadError(problem.message); });
    return () => { active = false; };
  }, [baseline, mode, viewedCursor, explaining, viewKey, stage, viewing]);

  const seek = useCallback((at: number | "close") => {
    clearPlaybackFocus();
    setCursor(at);
    selectActor("");
  }, [clearPlaybackFocus]);
  function seekEvidence(tick: number) {
    seek(tick);
    focusAfterSeek();
  }
  function save(patch: Partial<AuctionStudy>) {
    setStudy(previous => ({ ...previous, ...patch, updatedAt: Date.now() }));
  }
  function visit(id: string, unlock = false) {
    const index = auctionStages.indexOf(id);
    if (index < 0 || (!unlock && index > study.unlocked)) return;
    clearPlaybackFocus();
    setStudy(current => ({ ...current, scene: id, unlocked: Math.max(current.unlocked, index), updatedAt: Date.now() }));
    setLinkWarning("");
    setError("");
    setFeedback("");
    setMode(undefined);
    focusChapter.current = true;
    window.history.pushState({}, "", `?scene=${encodeURIComponent(id)}`);
  }
  function answer(question: Question, value: string) {
    save({ responses: { ...study.responses, [question.id]: { first: study.responses[question.id]?.first ?? value, latest: value } } });
  }
  function savePrediction(update: Partial<Prediction>) {
    const latest = { answer: "", confidence: "", maxPayment: "", ...study.prediction?.latest, ...update };
    save({ prediction: { first: study.prediction?.first ?? latest, latest } });
  }
  function finishPrediction() {
    if (!study.prediction?.latest.answer) {
      setError("请选择一个预测，也可以选择不确定。");
      return;
    }
    const first = study.unlocked >= 2 ? study.prediction.first : study.prediction.latest;
    save({ prediction: { first, latest: study.prediction.latest } });
    visit("bid", true);
  }
  async function launch(scenario: "baseline" | Branch, provider: Provider = study.provider) {
    if (busy) return;
    setError("");
    const entered = study.bid.trim();
    const bid = scenario === "baseline" ? (provider === "replay" ? lesson.preset_bid : Number(entered)) : view?.bid;
    if (bid === undefined || !Number.isInteger(bid) || bid < 1 || bid > lesson.player_value ||
        (scenario === "baseline" && provider === "rule" && !/^\d+$/.test(entered))) {
      setError(`请输入 1–${lesson.player_value} 的整数限价。高于 ${lesson.player_value} 超过本课基准市场的私人价值约束。`);
      return;
    }
    const runId = crypto.randomUUID();
    setBusy(true);
    try {
      await api("/runs", { request_id: runId, case_id: lesson.case_id, scenario_id: scenario,
        provider_kind: provider, seed: scenario === "baseline" ? lesson.seed : view?.seed, bid,
        parent_run_id: scenario === "baseline" ? null : baseline });
      await api(`/runs/${runId}/start?manifest_only=true`, {});
      if (scenario === "baseline") {
        save({ bid: String(bid), provider, runs: { baseline: runId }, tick: 0, revealed: 0 });
        seek(0);
        visit("observe", true);
      } else {
        save({ runs: { ...study.runs, [scenario]: runId } });
        setCheckpoint(0);
      }
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function cite(item: AuctionEvidence) {
    setStudy(previous => previous.evidence.some(note => note.run_id === item.run_id && note.seq === item.seq) ? previous :
      { ...previous, evidence: [...previous.evidence, item] });
  }
  async function resumeLegacy() {
    const saved = legacy.runs.baseline;
    if (!saved) return;
    setBusy(true);
    setError("");
    try {
      const original = await auctionView(saved, 0);
      const previousTick = legacy.selections[saved]?.tick ?? 0;
      const checked = previousTick === 0 ? original : await auctionView(saved, previousTick);
      save({ bid: String(original.bid), provider: original.origin === "precomputed_simulation" ? "replay" : "rule",
        runs: { baseline: saved }, tick: checked.tick, revealed: checked.tick,
        prediction: legacy.prediction ? {
          first: { answer: legacy.prediction, confidence: "", maxPayment: "" },
          latest: { answer: legacy.prediction, confidence: "", maxPayment: "" },
        } : null });
      seek(checked.tick);
      visit("observe", true);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!scene) return <main id="main" tabIndex={-1} className="container auction-lesson">
    {error ? <p role="alert" className="error">{error}</p> : <p role="status">正在加载双向拍卖课堂…</p>}
  </main>;
  const prediction = study.prediction?.latest;
  const canCheckPrediction = stage >= 3 && stage <= 4 && view && !pending;
  const originalAnswer = study.prediction?.first.answer;
  const tutorView = (stage === 3 || stage === 4) && !readError ? view : undefined;
  const revealedEvents = view?.events.filter(event => event.tick <= view.tick) ?? [];
  const firstTrade = revealedEvents.find(event => event.event_type === "trade");
  const truth = view?.student_trade !== null && view?.student_trade !== undefined ? "yes" : view?.closed ? "no" : undefined;
  const questionPanels = scene.questions.filter(question => question.kind !== "prediction").map(question => {
    const selected = study.responses[question.id]?.latest;
    const match = question.selector && revealedEvents.find(event => matches(question.selector!, event));
    return <fieldset key={question.id} className="auction-question">
      <legend>{question.prompt}</legend>
      <div className="options">{question.options.map(option =>
        <label key={option.id}><input type="radio" name={question.id} value={option.id} checked={selected === option.id}
          onChange={() => answer(question, option.id)}/>{option.label}</label>)}</div>
      {selected && <div className="auction-feedback" role="status">
        <p>{question.options.find(option => option.id === selected)?.feedback}</p>
        {question.selector && (match ? <button className="text-button" onClick={() => seekEvidence(match.tick)}>
          定位证据：事件 {match.seq}</button> : <span>当前运行尚无匹配事件，暂无法核对这个判断。</span>)}
      </div>}
    </fieldset>;
  });
  return <main id="main" tabIndex={-1} className="container auction-lesson">
    <nav className="auction-chapters" aria-label="双向拍卖场景">
      {course?.scenes.map((chapter, index) => <button key={chapter.id} onClick={() => visit(chapter.id)}
        disabled={index > study.unlocked || busy} aria-current={chapter.id === study.scene ? "step" : undefined}>
        {index + 1} {chapter.title}
      </button>)}
    </nav>
    <div className="auction-chapter-picker">
      <label htmlFor="auction-section">场景 {stage + 1} / {auctionStages.length}</label>
      <select id="auction-section" value={study.scene} disabled={busy} onChange={event => visit(event.target.value)}>
        {course?.scenes.map((chapter, index) => <option key={chapter.id} value={chapter.id}
          disabled={index > study.unlocked}>{chapter.title}</option>)}
      </select>
    </div>
    <header className="auction-title">
      <div>
        <h1 tabIndex={-1} ref={heading}>{scene.title}</h1>
        <p>{scene.question}</p>
      </div>
      <a href="/cases/double_auction">双向拍卖 · 案例导入</a>
    </header>
    <div className="auction-workspace">
      <section className="auction-task" aria-label="当前任务">
        <p>{scene.objective}</p>
        <div className={viewing ? "auction-task-expanded" : undefined}>
          {scene.information.map(item => <p key={item}>{item}</p>)}
        </div>
        {viewing && <details className="auction-task-compact"><summary>查看观察提示</summary>
          {scene.information.map(item => <p key={item}>{item}</p>)}
        </details>}
        {scene.role && <section className="auction-role">
          <h3>{scene.role.label}</h3><p>{scene.role.goal}</p>
          <dl><div><dt>价值</dt><dd>{lesson.player_value} 代币</dd></div>
            <div><dt>现金</dt><dd>{lesson.initial_cash} 代币</dd></div></dl>
        </section>}
        <details className="auction-sources"><summary>来源与模型规则</summary>
          <p>{lesson.background}</p>
          {lesson.sources.map(source => <p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}
          <p>教学内容 {course?.content_version} · {lesson.rounds} 轮自动交易</p>
        </details>
      </section>
      <section className="auction-action" aria-label="场景操作">
        {(error || linkWarning || storageError || readError) && <div className="auction-errors">
          {[linkWarning, error, readError, storageError].filter(Boolean).map(problem => <p role="alert" className="error" key={problem}>{problem}</p>)}
          {(readError || storageError) && <button onClick={() => downloadJson("double-auction-lesson-v2.json", study)}>导出当前草稿</button>}
          {readError && <button onClick={() => {
            setOpened(undefined);
            if (cursor === 0) window.location.reload();
            else seek(0);
          }}>重试读取运行</button>}
        </div>}
        {study.scene === "intro" && <>
          <div className="auction-opening" aria-label="教学情境中的买卖边界">
            <div><span>卖方最低接受</span><strong>85</strong></div>
            <div><span>可谈价格</span><strong>85–105</strong></div>
            <div><span>买方最高愿付</span><strong>105</strong></div>
          </div>
          {questionPanels}
          {legacy.runs.baseline && !baseline && <button disabled={busy} onClick={resumeLegacy}>用旧版基准运行继续</button>}
        </>}
        {study.scene === "predict" && <>
          <fieldset className="auction-question">
            <legend>{scene.questions.find(question => question.kind === "prediction")?.prompt}</legend>
            <div className="options">{scene.questions.find(question => question.kind === "prediction")?.options.map(option =>
              <label key={option.id}><input type="radio" name="prediction" value={option.id}
                checked={prediction?.answer === option.id} onChange={() => savePrediction({ answer: option.id })}/>{option.label}</label>)}</div>
            {prediction?.answer && <p role="status" className="auction-feedback">{scene.questions.find(question => question.kind === "prediction")
              ?.options.find(option => option.id === prediction.answer)?.feedback}</p>}
            <div className="toolbar">
              <label className="auction-field">信心 <select aria-label="信心" value={prediction?.confidence ?? ""} onChange={event => savePrediction({ confidence: event.target.value })}>
                <option value="">可跳过</option><option>高</option><option>中</option><option>低</option>
              </select></label>
              <label className="auction-field">最高总支出（代币）<input type="number" min={0} value={prediction?.maxPayment ?? ""}
                onChange={event => savePrediction({ maxPayment: event.target.value })}/></label>
            </div>
            {prediction?.maxPayment && <p className="auction-muted">{Number(prediction.maxPayment) === lesson.player_value ?
              "与基准场的私人价值上限一致。" : "本课以私人价值和现金中较小的一项作为无费场景的最高可接受总支出。"}</p>}
          </fieldset>
          {questionPanels}
        </>}
        {study.scene === "bid" && <>
          {baseline ? <p>当前笔记已关联开局报价 {study.bid} 代币的运行。</p> :
            <form className="auction-bid-form" noValidate onSubmit={event => {
              event.preventDefault();
              if (!new FormData(event.currentTarget).has("commit")) {
                setError("请先确认开局限价单将保留至成交或收盘。");
                return;
              }
              void launch("baseline");
            }}>
              <label className="auction-field">运行方式
                <select aria-label="运行方式" value={study.provider} onChange={event => save({ provider: event.target.value as Provider })}>
                  <option value="rule">本地规则计算</option><option value="replay">固定回放</option>
                </select>
              </label>
              <label className="auction-field">开局限价（代币／件）
                <input type="number" min={1} max={lesson.player_value} step={1}
                  value={study.provider === "replay" ? lesson.preset_bid : study.bid}
                  readOnly={study.provider === "replay"} onChange={event => save({ bid: event.target.value })}/>
              </label>
              <label className="auction-confirm"><input type="checkbox" required name="commit"/>我接受这笔单会留到成交或收盘</label>
              <button className="primary" disabled={busy}>
                {busy ? "订单正在处理…" : study.provider === "replay" ? "加载固定回放" : "提交开局报价"}
              </button>
            </form>}
          {questionPanels}
          {baseline && <button className="primary" onClick={() => visit("observe", true)}>继续观察</button>}
        </>}
        {viewing && pending && !view && <p role="status">正在查找本地运行…</p>}
        {viewing && view && !readError && <AuctionSelection.Provider value={{
          view, mode, chooseMode: setMode, revealed: study.revealed, pending, evidenceSelected,
          cursor, seek, seekEvidence, playbackRef,
          selectedActor, selectActor, pinned: study.pinned, pin: actor => save({ pinned: actor }),
          comparisonRun: study.runs[branch], checkpoint, setCheckpoint,
        }}>
          {study.scene === "compare" ? <AuctionCompare study={study} branch={branch} busy={busy || pending}
            choose={id => { setBranch(id); setCheckpoint(0); }}
            forecast={(id, value) => save({ forecasts: { ...study.forecasts, [id]: value } })}
            launch={id => { void launch(id); }}
            capture={comparison => save({ comparison })}/> : <>
            <MarketFloor cite={cite} evidence={study.evidence} explaining={explaining}/>
            {canCheckPrediction && <section className="auction-prediction-result">
              <h2>对照入场预测</h2>
              <p>{originalAnswer ? `原预测：${originalAnswer === "yes" ? "会成交" : originalAnswer === "no" ? "不会成交" : "不确定"}。` : ""}
                {" "}{truth === "yes" ? "B01 在本次运行已成交。" : truth === "no" ? "已收盘，B01 在本次运行未成交。" :
                  "B01 尚未成交，当前证据无法确定本场结果。"}
                {truth && originalAnswer && originalAnswer !== "unknown" &&
                  (originalAnswer === truth ? " 与原预测一致。" : " 与原预测不同。")}
              </p>
              {view.student_trade !== null && <button className="text-button" onClick={() => seekEvidence(view.student_trade!)}>
                定位 B01 成交</button>}
            </section>}
            {study.scene === "observe" && !pending && !firstTrade && scene.evidence && <p className="auction-muted">{scene.evidence.missing}</p>}
            {explaining && !pending && <AuctionExplain/>}
          </>}
          {questionPanels}
          {study.scene === "compare" && <a href="/compare?case=double_auction">自定义参数对照</a>}
        </AuctionSelection.Provider>}
        {study.scene === "notebook" && <>
          {scene.rubric && <p>{scene.rubric}</p>}
          <AuctionNotes value={study} edit={notes => {
            save({ notes });
            setFeedback("");
          }}/>
          <button className="primary" disabled={!!storageError} onClick={() => setFeedback("笔记已保存在此浏览器，可从「我的记录」打开。")}>保存笔记</button>
          {feedback && <p role="status">{feedback}</p>}
        </>}
        <TutorPanel caseId="double_auction" runId={tutorView?.run_id} tick={tutorView?.tick} revealUntil={tutorView?.tick}
          scene={{ id: scene.id, actor: tutorView ? selectedActor || study.pinned : lesson.player_id,
            prediction: originalAnswer ?? prediction?.answer, evidence: study.evidence }}
          onSeek={tutorView ? seekEvidence : undefined}/>
        {scene.next_scene && study.scene !== "bid" && <div className="auction-next">
          <button className="primary" disabled={
            busy || pending || (stage === 3 && !view?.closed && study.unlocked < 4) ||
              (stage === 5 && !(study.runs.demand && study.runs.fee))
          } onClick={() => {
            if (stage === 1) finishPrediction();
            else if (stage === 3 && firstTrade) { seek(firstTrade.tick); visit(scene.next_scene!, true); }
            else visit(scene.next_scene!, true);
          }}>{["领取买家身份", "去报价", "", "进入剩余解释", "比较两项制度", "写实验笔记"][stage]}</button>
          {stage === 3 && !view?.closed && study.unlocked < 4 && <p>先推进到收盘，再核对预测与全市场剩余。</p>}
          {stage === 5 && !(study.runs.demand && study.runs.fee) && <p>分别运行需求和费用对照后进入笔记。</p>}
        </div>}
      </section>
    </div>
  </main>;
}
