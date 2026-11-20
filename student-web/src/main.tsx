import { lazy, Suspense } from "react";
import { isFieldFlagship, type FieldFlagship, type FieldLesson } from "./learning/flagship-types";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import lesson from "../../cases/double_auction/case.json";
import { ApiError, api, downloadJson, eventHref, launch, traceHref } from "./contracts";
import type { MarketEvent, Provider, Run, ScenarioId } from "./contracts";
import { emptyStudy, fields, readStudy, studyKey, validateRuns, validateStudy } from "./study";
import type { Study } from "./study";
import { PriceChart, SupplyDemand } from "./charts";
import { catalog, CourseLinks, legacyCourseHref, selectedCourse } from "./catalog";
import { LessonApp } from "./lesson";
import type { Course, LessonRun } from "./lesson-types";
import { TraceView } from "./lesson-view";
import { PairedView } from "./paired-view";
import { LiveReceipt } from "./live-panel";
import { TutorPanel } from "./tutor";
import { LabTools, teacherEnabled } from "./lab-tools";
import { EventLookup } from "./event-lookup";
import { boundaries, BoundaryApp, BoundaryLink } from "./boundary";
import { ModelLab } from "./model-lab";
import { AppHeader } from "./app/shell";
import { auctionStudyKey } from "./cases/auction/auction-study";
import { CasePage, CasesPage, HomePage, NotesPage, PathsPage } from "./app/pages";
import "./style.css";
import { studentBrand } from "../../content/student-navigation";

const scenarios = lesson.scenarios as (typeof lesson.scenarios[number] & { id: ScenarioId })[];
const scenarioName = (id: ScenarioId) => id === "boundary" ? boundaries[lesson.case_id]!.label : scenarios.find(s => s.id === id)!.label;
const resultOrigin = (run: Run) => run.origin === "precomputed_simulation" ? "预计算仿真" : "本次离线计算";
const noteLabels = { observation: "观察", mechanism: "机制解释", condition: "成立条件", transfer: "迁移" };
const priceRange = (low: number | null, high: number | null) => low === null ? "无成交" : low === high ? String(low) : `${low}–${high}`;
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;

function SwitchQuestion({ prompt, options, value, change }: {
  prompt: string; options: Record<string, string>; value: string; change: (value: string) => void;
}) {
  return <fieldset><legend>{prompt}</legend><div className="options">
    {Object.entries(options).map(([key, label]) => <label key={key}>
      <input type="radio" name={prompt} value={key} checked={value === key} onChange={() => change(key)}/>{label}
    </label>)}
  </div></fieldset>;
}

function Market({ run, selection, select, cite, cited }: {
  run: Run;
  selection?: { tick: number; actor: string };
  select: (tick: number, actor: string) => void;
  cite?: (event: MarketEvent) => void;
  cited?: boolean;
}) {
  const { events, snapshots, initial } = run.result;
  const limit = snapshots.length - 1;
  const tick = Math.min(limit, selection?.tick ?? 0);
  const actor = selection?.actor ?? "";
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [checkpoint, setCheckpoint] = useState<string | null>(null);
  const firstTrade = events.find(e => e.event_type === lesson.checkpoints[0].event_type);
  const event = events[tick];
  const snapshot = snapshots[tick];
  const trades = events.filter(e => e.event_type === "trade" && e.tick <= tick);
  const role = actor ? snapshot.accounts[actor] : null;
  const orders = (side: string) => snapshot.orders.filter(o => o.side === side)
    .sort((a, b) => side === "buy" ? b.price - a.price : a.price - b.price);

  useEffect(() => {
    if (!playing || tick === limit) return;
    const timer = window.setTimeout(() => {
      select(tick + 1, actor);
      if (tick + 1 === firstTrade?.tick) {
        setCheckpoint(lesson.checkpoints[0].message);
        setPlaying(false);
      }
      if (tick + 1 === limit) setPlaying(false);
    }, 180 / speed);
    return () => clearTimeout(timer);
  }, [playing, speed, tick, actor, limit, firstTrade?.tick, select]);

  function jump(at: number) {
    setPlaying(false);
    setCheckpoint(null);
    select(at, actor);
  }

  const nextTrade = events.find(event => event.event_type === "trade" && event.tick > tick);
  return <section className="market">
    <div className="section-line"><h3>{scenarioName(run.scenario_id)}</h3><span className="identity">{resultOrigin(run)}</span></div>
    <PriceChart events={events} tick={tick} choose={jump}/>
    <div className="transport">
      <div className="toolbar">
        <button className="primary" onClick={() => {
          if (tick === limit) select(0, actor);
          setCheckpoint(null);
          setPlaying(!playing);
        }}>{playing ? "暂停播放" : tick === limit ? "重新播放" : "播放实验"}</button>
        <button aria-disabled={tick === 0} onClick={() => { if (tick > 0) jump(tick - 1); }}>上一步</button>
        <button aria-disabled={tick === limit} onClick={() => { if (tick < limit) jump(tick + 1); }}>下一步</button>
        <button onClick={() => { if (nextTrade) jump(nextTrade.tick); }}
          aria-disabled={!nextTrade}>跳到下一笔成交</button>
        <label>倍速 <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
          <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
        </select></label>
      </div>
      <label className="timeline"><span>事件时间轴 <span aria-hidden="true">{tick} / {limit}</span></span>
        <input type="range" min={0} max={limit} value={tick}
          aria-valuetext={`事件 ${tick}，末条为 ${limit}`} onChange={e => jump(Number(e.target.value))}/></label>
    </div>
    {checkpoint && <p className="callout" role="status">{checkpoint}</p>}
    <div className="stats"><div><span>最高买价</span><strong>{snapshot.best_bid ?? "—"}</strong></div>
      <div><span>最低卖价</span><strong>{snapshot.best_ask ?? "—"}</strong></div>
      <div><span>累计成交</span><strong>{snapshot.volume} 件</strong></div>
      <div><span>累计总剩余</span><strong>{snapshot.surplus} 代币</strong></div></div>
    <div className="evidence-panel">
      <div className="section-line"><h4>事件 {event.seq}</h4>
        <span>{event.event_type === "trade" ? "成交" : ({
          market_open: "市场开启", market_close: "市场结束", order_cancelled: "撤单",
          order_submitted: "提交订单", order_rejected: "订单超过预算或价值边界",
        } as Record<string, string>)[event.event_type]}</span>
      </div>
      {event.event_type === "trade" ? <>
        <p>买家 <button className="text-button" onClick={() => select(tick, event.buyer_id!)}>{event.buyer_id}</button>（{event.buy_order_id}）
          与卖家 <button className="text-button" onClick={() => select(tick, event.seller_id!)}>{event.seller_id}</button>（{event.sell_order_id}）
          以 <strong>{event.price} 代币</strong>成交 1 件。在簿订单为 {event.maker_order_id}。</p>
        <p>买方剩余 {event.buyer_surplus} · 卖方剩余 {event.seller_surplus} · 平台收入 {event.platform_fee}（代币）</p>
        {cite && <button onClick={() => cite(event)} disabled={cited}>{cited ? "已引用" : "引用此笔成交"}</button>}
        <details><summary>查看两张原始订单</summary>
          {[event.buy_order_id, event.sell_order_id].map(orderId => {
            const order = events.find(e => e.event_type === "order_submitted" && e.order_id === orderId);
            return <p key={orderId}>{order?.order_id} · {order?.actor_id} · {order?.side === "buy" ? "买" : "卖"}价 {order?.price} 代币/件 · 事件 {order?.seq}</p>;
          })}
        </details>
      </> : event.actor_id && <p>{event.actor_id} · {event.order_id}{event.price !== undefined ? ` · 限价 ${event.price} 代币/件` : ""}
          {event.reference_price != null ? ` · 参考上次成交价 ${event.reference_price}` : ""}</p>}
      <p><a href={traceHref(run.case_id, run.run_id, tick)}>事件链接</a></p>
      <label className="role-select">观察角色 <select value={actor} onChange={e => select(tick, e.target.value)}>
        <option value="">全市场</option>
        {Object.keys(initial).map(id => <option key={id}>{id}</option>)}
      </select></label>
      {role && <p>{actor} · 现金 {role.cash} 代币 · 持有 {role.goods} 件 · 已成交 {role.filled} 件</p>}
    </div>
    <details><summary>订单簿与成交关系</summary>
      <div className="book">
        {(["buy", "sell"] as const).map(side => <div key={side}><h4>{side === "buy" ? "买单" : "卖单"}</h4>
          {orders(side).length ? <ul>{orders(side).map(order =>
            <li key={order.order_id}>{order.actor_id} · {order.order_id} · {order.price}</li>)}</ul> : <p>无挂单</p>}
        </div>)}
      </div>
      <p>成交关系按 {actor || "全部角色"} 显示。</p>
      <ul className="trade-list">{trades.filter(e => !actor || e.buyer_id === actor || e.seller_id === actor).map(e =>
        <li key={e.seq}><button onClick={() => jump(e.tick)}>{e.buyer_id} 与 {e.seller_id} · {e.price} 代币 · 事件 {e.seq}</button></li>
      )}</ul>
    </details>
    <button className="text-button" onClick={() => downloadJson(`run-${run.run_id}.json`, run)}>导出运行记录</button>
  </section>;
}

function App() {
  const [loaded] = useState(readStudy);
  const [study, setStudy] = useState<Study>(loaded.study);
  const [runs, setRuns] = useState<Partial<Record<ScenarioId, Run>>>({});
  const [loading, setLoading] = useState(Object.keys(loaded.study.runs).length > 0);
  const [error, setError] = useState(loaded.error);
  const [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<ScenarioId>("baseline");
  const [restoreNotice, setRestoreNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const [startingId, setStartingId] = useState("");
  const startCancelled = useRef(false);
  const step = lesson.lessons[study.stage];
  const base = runs.baseline;
  const currentRun = runs[comparison] ?? base;
  const player = lesson.player_id;
  const bid = Number(study.bid);
  const validBid = /^\d+$/.test(study.bid) && bid >= 1 && bid <= lesson.player_value;

  function save(patch: Partial<Study>) { setStudy(previous => ({ ...previous, ...patch })); }
  function visit(stage: number) {
    setError("");
    setStudy(previous => ({ ...previous, stage, unlocked: Math.max(previous.unlocked, stage) }));
    requestAnimationFrame(() => { heading.current?.focus(); window.scrollTo(0, 0); });
  }
  async function retrieve(value: Study) {
    const received = await Promise.all(Object.values(value.runs).map(id => api<Run>(`/runs/${id}`)));
    validateRuns(value, received);
    return Object.fromEntries(received.map(run => [run.scenario_id, run]));
  }
  useEffect(() => {
    let active = true;
    if (Object.keys(loaded.study.runs).length) {
      retrieve(loaded.study).then(value => { if (active) setRuns(value); })
        .catch(problem => { if (active) setError(problem.message); })
        .finally(() => { if (active) setLoading(false); });
    }
    try {
      const prior = Object.keys(localStorage).some(key => key.startsWith(`civitas/${lesson.case_id}/`) && key !== studyKey && key !== auctionStudyKey);
      if (prior) setRestoreNotice("此案例版本已更新。旧版本笔记保留在原存储项，请重新确认本版实验。");
    } catch { setStorageError(true); }
    return () => { active = false; };
  }, [loaded]);
  useEffect(() => {
    if (loaded.error && study === loaded.study) return;
    try { localStorage.setItem(studyKey, JSON.stringify(study)); }
    catch { setStorageError(true); }
  }, [study, loaded]);

  async function experiment(id: ScenarioId, provider: Provider) {
    setError("");
    setBusy(true);
    startCancelled.current = false;
    const amount = id === "baseline" ? (provider === "replay" ? lesson.preset_bid : bid) : base!.bid;
    const parent = id === "baseline" ? undefined : base!.run_id;
    const signature = [id, provider, amount, parent].join("/");
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    setStartingId(request.current.id);
    try {
      const run = await launch(id, provider, lesson.seed, amount, request.current.id, parent);
      request.current = null;
      if (!run || startCancelled.current) {
        setError("已取消创建。可重新运行实验。");
        return;
      }
      if (id === "baseline") {
        setRuns({ baseline: run });
        setComparison("baseline");
        save({ bid: String(amount), runs: { baseline: run.run_id }, selections: {}, evidence: [],
          complete: false, unlocked: 3, explanation: "" });
        visit(3);
      } else {
        setRuns(previous => ({ ...previous, [id]: run }));
        save({ runs: { ...study.runs, [id]: run.run_id } });
        setComparison(id);
      }
    } catch (problem) {
      if (problem instanceof ApiError && ["RUN_FAILED", "RUN_ALREADY_TERMINAL"].includes(problem.code)) {
        request.current = null;
      }
      setError(problem instanceof Error ? problem.message : "运行失败");
    } finally {
      setBusy(false);
      setStartingId("");
    }
  }
  async function cancelRun() {
    try {
      await api(`/runs/${startingId}/cancel`, {});
      startCancelled.current = true;
    } catch {
      setError("计算已提交或仍在创建，稍后查看运行结果。");
    }
  }
  function select(run: Run, tick: number, actor: string) {
    setStudy(previous => ({ ...previous, selections: { ...previous.selections, [run.run_id]: { tick, actor } } }));
  }
  function cite(run: Run, event: MarketEvent) {
    setStudy(previous => previous.evidence.some(e => e.run_id === run.run_id && e.seq === event.seq) ? previous : ({
      ...previous, evidence: [...previous.evidence, { run_id: run.run_id, seq: event.seq }],
    }));
  }
  async function importStudy(file?: File) {
    if (!file) return;
    setError("");
    setRestoreNotice("");
    setBusy(true);
    try {
      if (file.size > 512 * 1024) throw new Error("学习记录文件超过 512 KB。");
      const imported = validateStudy(JSON.parse(await file.text()));
      setRuns(await retrieve(imported));
      setStudy(imported);
      setComparison("baseline");
      setRestoreNotice("已恢复学习记录。");
      requestAnimationFrame(() => heading.current?.focus());
    } catch (problem) { setError(problem instanceof Error ? problem.message : "无法读取笔记"); }
    finally { setBusy(false); }
  }
  const market = (run: Run) => <Market key={run.run_id} run={run} selection={study.selections[run.run_id]}
    select={(tick, actor) => select(run, tick, actor)} cite={event => cite(run, event)}
    cited={study.evidence.some(e => e.run_id === run.run_id && e.seq === study.selections[run.run_id]?.tick)}/>;
  const evidenceRuns = Object.values(runs);
  const notebookReady = Boolean(base && runs.demand && runs.fee && study.evidence.length >= lesson.minimum_evidence && fields.every(field => study.notes[field].trim()));

  return <>
    <AppHeader resetLesson={() => visit(0)} modelCaseId={lesson.case_id}/>
    <div className="container">
      <main id="main" tabIndex={-1}>
        {error && <div className="error" role="alert">{error} <button onClick={() => setError("")}>关闭</button></div>}
        {storageError && <p className="callout" role="status">浏览器无法保存草稿。请导出学习记录以备份。</p>}
        {restoreNotice && <p className="callout" role="status">{restoreNotice}</p>}
        {loading && <p role="status">正在读取本地实验记录…</p>}
        {study.stage === 0 ? <section className="landing">
          <div className="hero">
            <div className="hero-copy">
              <div className="identity-row"><span className="identity">{lesson.identity_label}</span><span>{lesson.minutes}</span></div>
              <h1 tabIndex={-1} ref={heading}>{lesson.title}<span>{lesson.subtitle}</span></h1>
              <p>{lesson.intro}</p>
              <button className="primary" disabled={loading || busy} onClick={() => visit(study.unlocked || 1)}>{study.unlocked > 0 ? "继续学习" : "开始实验"}</button>
              <BoundaryLink caseId={lesson.case_id}/>
            </div>
            <div className="hero-graphic" aria-label="供需阶梯机制示意">
              <svg viewBox="0 0 490 310" role="img" aria-label="阶梯状买方价值与卖方成本相交">
                <path className="hero-axis" d="M58 34 V260 H448 M58 84 H448 M58 142 H448 M58 200 H448"/>
                <path className="hero-demand" d="M59 73 H132 V95 H207 V133 H282 V166 H357 V196 H438"/>
                <path className="hero-supply" d="M59 220 H132 V196 H207 V166 H244 V133 H282 V108 H357 V78 H438"/>
                <circle cx="244" cy="133" r="6" fill="#ffe0a3"/>
                <text x="58" y="25">价值 / 成本</text><text x="443" y="288" textAnchor="end">商品数量</text>
              </svg>
              <div className="hero-legend"><span>买方价值</span><span>卖方成本</span><small>机制示意</small></div>
            </div>
          </div>
          <LabTools caseId={lesson.case_id}/>
          <section className="intro-grid">
            <div><h2>实验缘起</h2><p>{lesson.background}</p><Sources/></div>
            <div><h2>这节课会做什么</h2><ul>{lesson.goals.map(goal => <li key={goal}>{goal}</li>)}</ul>
              <label className="import">导入学习记录 <input type="file" accept=".json,application/json" disabled={busy || loading} onChange={e => {
                void importStudy(e.target.files?.[0]); e.target.value = "";
              }}/></label>
            </div>
          </section>
        </section> : <div className="workspace">
          <aside className="steps"><nav aria-label="学习阶段"><ol>{lesson.lessons.map((item, index) => <li key={item.id}>
            <button disabled={index > study.unlocked || busy} aria-current={index === study.stage ? "step" : undefined} onClick={() => visit(index)}>
              <span>{String(index + 1).padStart(2, "0")}</span>{item.title}</button>
          </li>)}</ol></nav></aside>
          <article className="lesson">
            <div className="lesson-heading"><p className="lesson-name">{lesson.title}</p><h1 tabIndex={-1} ref={heading}>{step.title}</h1><p>{step.prompt}</p></div>
            {step.id === "predict" && <>
              <div className="role-card"><div><h3>买家 {player}</h3><span>最多买 1 件</span></div><div><strong>{lesson.player_value}</strong><span>私人价值 · 代币</span></div></div>
              <SwitchQuestion {...lesson.questions.prediction} value={study.prediction} change={prediction => save({ prediction, complete: false })}/>
              <button className="primary" disabled={!study.prediction} onClick={() => visit(2)}>去报价</button>
              <TutorPanel caseId={lesson.case_id}/>
            </>}
            {step.id === "bid" && <>
              <form onSubmit={e => { e.preventDefault(); void experiment("baseline", "rule"); }}>
                <label className="bid-label">买入限价（代币/件）
                  <input type="number" min="1" max={lesson.player_value} step="1" required value={study.bid} disabled={busy}
                    onChange={e => save({ bid: e.target.value.slice(0, 32) })}/>
                </label>
                <p>可用现金 {lesson.initial_cash} 代币，私人价值 {lesson.player_value} 代币。</p>
                <div className="toolbar"><button className="primary" disabled={busy || !validBid}>运行实验</button>
                  <button type="button" disabled={busy} onClick={() => experiment("baseline", "replay")}>播放预设（报价 {lesson.preset_bid}）</button>
                </div>
              </form>
              <details><summary>模式与市场规则</summary><p>基础模式可本地计算或播放固定轨迹。高级模式尚未接入。</p><Sources/></details>
            </>}
            {busy && <div className="callout" role="status">正在处理本地记录… {startingId && <button onClick={cancelRun}>取消创建</button>}</div>}
            {["observe", "explain", "compare", "notebook"].includes(step.id) && !base && !loading &&
              <button className="primary" onClick={() => visit(2)}>返回报价并创建实验</button>}
            {step.id === "observe" && base && <>
              {market(base)}
              <button className="primary" onClick={() => visit(4)}>揭示全市场价值</button>
            </>}
            {step.id === "explain" && base && <>
              <p className="callout">买家 {player} {base.result.snapshots.at(-1)!.accounts[player].filled ? "成交了 1 件" : "未成交"}。
                {study.prediction === "unknown" ? "你的回答是不确定。" : `你预测${lesson.questions.prediction.options[study.prediction as "yes" | "no"] ?? "待填写"}。`}</p>
              <div className="section-line"><span className="identity">{resultOrigin(base)}</span></div>
              <SupplyDemand run={base}/>
              <p>成交价 {priceRange(base.result.metrics.price_min, base.result.metrics.price_max)} 代币/件。
                竞争价格参考区间 {base.result.metrics.price_band?.join("–") ?? "—"} 代币/件。
                实际总剩余 {base.result.metrics.surplus}，排序配对上界 {base.result.metrics.ceiling}（代币）。</p>
              <SwitchQuestion {...lesson.questions.explain} value={study.explanation} change={explanation => save({ explanation, complete: false })}/>
              {teacherEnabled() && <details><summary>查看参考答案</summary>
                <p>{(lesson.questions.explain.options as Record<string, string>)[lesson.questions.explain.answer]}。{lesson.questions.explain.feedback}</p>
              </details>}
              {study.explanation && <p className="callout">{lesson.questions.explain.feedback}</p>}
              <button className="primary" disabled={!study.explanation} onClick={() => visit(5)}>比较反事实</button>
            </>}
            {step.id === "compare" && base && <>
              <p>配对种子 {base.seed} · 原始报价 {base.bid} 代币/件</p>
              <div className="interventions">{scenarios.slice(1).map(s => <div key={s.id}>
                <h3>{s.label}</h3><p>{s.description}</p>
                <button disabled={busy} onClick={() => runs[s.id] ? setComparison(s.id) : experiment(s.id, base.provider_kind)}>
                  {runs[s.id] ? "查看结果" : base.provider_kind === "replay" ? "载入预计算对照" : "运行对照"}</button>
              </div>)}</div>
              <Comparison runs={runs}/>
              {comparison !== "baseline" && runs[comparison] && <PairedView key={`paired/${runs[comparison].run_id}`}
                caseId={lesson.case_id} baseline={base.run_id} branch={runs[comparison].run_id} title={scenarioName(comparison)}/>}
              <div className="toolbar">
                <label>查看运行 <select value={comparison} onChange={e => setComparison(e.target.value as ScenarioId)}>
                  {scenarios.filter(s => runs[s.id]).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select></label>
              </div>
              {currentRun && market(currentRun)}
              <button className="primary" disabled={busy || !(runs.demand && runs.fee)} onClick={() => visit(6)}>写实验笔记</button>
            </>}
            {step.id === "notebook" && base && <>
              <div className="notebook">
                <h3>证据引用</h3>
                <p>至少引用 {lesson.minimum_evidence} 笔成交。已引用 {study.evidence.length} 笔。</p>
                {study.evidence.length > 0 && <ul>{study.evidence.map(e => {
                  const run = evidenceRuns.find(run => run.run_id === e.run_id);
                  const trade = run?.result.events[e.seq];
                  return <li key={`${e.run_id}/${e.seq}`}>{run && scenarioName(run.scenario_id)} · 事件 {e.seq} ·
                    {trade?.buyer_id} 与 {trade?.seller_id} · {trade?.price} 代币
                    <button className="text-button" onClick={() => save({ evidence: study.evidence.filter(item => item !== e), complete: false })}>移除</button></li>;
                })}</ul>}
                <label>从运行中选取成交 <select value="" onChange={e => {
                  const [id, seq] = e.target.value.split("/");
                  const run = evidenceRuns.find(item => item.run_id === id);
                  const trade = run?.result.events[Number(seq)];
                  if (run && trade?.event_type === "trade") cite(run, trade);
                }}>
                  <option value="">选择成交</option>
                  {evidenceRuns.map(run => <optgroup key={run.run_id} label={scenarioName(run.scenario_id)}>
                    {run.result.events.filter(e => e.event_type === "trade").map(e => <option key={e.seq} value={`${run.run_id}/${e.seq}`}>
                      事件 {e.seq} · {e.buyer_id} 与 {e.seller_id} · {e.price} 代币</option>)}
                  </optgroup>)}
                </select></label>
                {fields.map(field => <label key={field}>{noteLabels[field]}
                  {field === "transfer" && <span>{lesson.questions.transfer.prompt}</span>}
                  <textarea value={study.notes[field]} maxLength={5000}
                    onChange={e => save({ notes: { ...study.notes, [field]: e.target.value }, complete: false })}/>
                </label>)}
                <details><summary>离线自评</summary><p>{lesson.questions.transfer.rubric}</p></details>
                <div className="toolbar">
                  <button className="primary" disabled={!notebookReady || study.complete} onClick={() => save({ complete: true })}>
                    {study.complete ? "已完成学习" : "完成学习"}
                  </button>
                  <button onClick={() => downloadJson("双向拍卖-实验笔记.json", study)}>导出实验笔记</button>
                </div>
              </div>
            </>}
            {step.id !== "bid" && <Sources/>}
          </article>
        </div>}
      </main>
      {study.stage !== 0 && <CourseLinks current={lesson.case_id}/>}
      <footer><span>Civitas Economica</span><span>双向拍卖 · v{lesson.version}</span></footer>
    </div>
  </>;
}

function Comparison({ runs }: { runs: Partial<Record<ScenarioId, Run>> }) {
  const reference = runs.baseline?.result.metrics;
  const valueDelta = (value: number) => value > 0 ? `+${value}` : String(value);
  return <div className="table-scroll"><table className="comparison">
    <caption>同一初始根状态下的实验对照</caption>
    <thead><tr><th>实验</th><th>成交量（件）</th><th>价格（代币/件）</th><th>总剩余（代币）</th><th>效率</th><th>平台收入（代币）</th></tr></thead>
    <tbody>{scenarios.map(s => {
      const run = runs[s.id];
      const m = run?.result.metrics;
      const baseline = s.id === "baseline" ? undefined : reference;
      return <tr key={s.id}><th scope="row">{s.label}{run && <small>{resultOrigin(run)}</small>}</th>
        {m ? <>
          <td><span className="mobile-metric">成交量（件）</span>{m.volume}
            {baseline && <small>较基准 {valueDelta(m.volume - baseline.volume)}</small>}</td>
          <td><span className="mobile-metric">价格（代币/件）</span>{priceRange(m.price_min, m.price_max)}
            {baseline && m.price_min === baseline.price_min && m.price_max === baseline.price_max && <small>区间相同</small>}</td>
          <td><span className="mobile-metric">总剩余（代币）</span>{m.surplus}
            {baseline && <small>较基准 {valueDelta(m.surplus - baseline.surplus)}</small>}</td>
          <td><span className="mobile-metric">效率</span>{percent(m.efficiency)}</td>
          <td><span className="mobile-metric">平台收入（代币）</span>{m.platform_cash}</td>
        </> : <td colSpan={5}>待运行</td>}
      </tr>;
    })}</tbody>
  </table></div>;
}

function Sources() {
  return <details className="sources"><summary>来源与概念</summary>
    {lesson.sources.map(source => <p key={source.id}>{source.supports} <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}
    <dl>{lesson.glossary.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.definition}</dd></div>)}</dl>
  </details>;
}

function SharedTrace({ id, initialTick }: { id: string; initialTick: number }) {
  const [run, setRun] = useState<Run | LessonRun>();
  const [tick, setTick] = useState(initialTick);
  const [actor, setActor] = useState("");
  const [error, setError] = useState("");
  const course = catalog.find(course => course.case_id === selectedCourse);
  const courseHref = legacyCourseHref(selectedCourse);
  useEffect(() => {
    let alive = true;
    api<Run | LessonRun>(`/runs/${id}`).then(result => {
      if (result.case_id !== selectedCourse || result.case_version !== course?.version ||
          !["completed", "cancelled"].includes(result.execution_status) ||
          !result.result || !Number.isInteger(initialTick) ||
          initialTick < 0 || initialTick >= result.result.snapshots.length) {
        throw new Error("链接中的课程、运行或事件无法核对。");
      }
      if (alive) setRun(result);
    }).catch(problem => { if (alive) setError(problem.message); });
    return () => { alive = false; };
  }, [id, initialTick, course?.version]);

  const select = (next: number, person: string) => { setTick(next); setActor(person); };
  const boundary = run?.scenario_id === "boundary" ? boundaries[run.case_id] : undefined;
  const auctionBoundary = boundary && run?.case_id === lesson.case_id ? run as Run : undefined;
  return <main id="main" tabIndex={-1} className="container course-home">
    <div className="toolbar"><a href={courseHref}>返回课程</a>
      {boundary && <BoundaryLink caseId={selectedCourse}/>}</div>
    <h1>{course?.title ?? "运行证据"}</h1>
    {boundary && <section>
      <h2>{boundary.label}</h2><p>{boundary.description}</p>
      {run && <p><a href={traceHref(run.case_id, run.run_id, run.result.snapshots.length - 1)}>查看末条事件</a></p>}
      {auctionBoundary && <>
        <dl className="entity-facts">
          <div><dt>成交量</dt><dd>{auctionBoundary.result.metrics.volume} 件</dd></div>
          <div><dt>成交价</dt><dd>{auctionBoundary.result.metrics.price_min === null ? "未定义" : priceRange(auctionBoundary.result.metrics.price_min, auctionBoundary.result.metrics.price_max)}</dd></div>
          <div><dt>可实现总剩余上界</dt><dd>{auctionBoundary.result.metrics.ceiling} 代币</dd></div>
          <div><dt>效率</dt><dd>{auctionBoundary.result.metrics.efficiency === null ? "未定义" : percent(auctionBoundary.result.metrics.efficiency)}</dd></div>
        </dl>
        <details><summary>查看边界供需曲线</summary><SupplyDemand run={auctionBoundary}/></details>
      </>}
    </section>}
    {error && <div role="alert" className="error">
      <p>{error}</p><p>请核对运行链接和本机运行数据库。可从<a href="/notes">实验笔记</a>导出已保存的学习记录。</p>
    </div>}
    {!run && !error && <p role="status">读取运行证据…</p>}
    {run && <p><a href={eventHref(run.case_id, run.run_id, run.result.events[tick].seq)}>按事件序号查看</a></p>}
    {run?.case_id === lesson.case_id && <Market run={run as Run} selection={{ tick, actor }} select={select}/>}
    {run && run.case_id !== lesson.case_id && course && <>
      {(run as LessonRun).result.live && <LiveReceipt caseId={run.case_id} runId={run.run_id}
        result={(run as LessonRun).result.live!} cancelled={run.execution_status === "cancelled"}/>}
      <TraceView course={course as Course} run={run as LessonRun} tick={tick} actor={actor} select={select}/>
    </>}
    {run && <TutorPanel caseId={run.case_id} runId={run.run_id} tick={tick}/>}
  </main>;
}

const query = new URLSearchParams(location.search);
const path = location.pathname.replace(/\/$/, "") || "/";
const linkedRun = query.get("run");
const linkedEvent = query.get("event");
const activeCourse = catalog.find(course => course.case_id === selectedCourse);
const importCourse = catalog.find(course => path === `/cases/${course.case_id}`);
const fieldCase = path.startsWith("/learn/") ? path.slice(7) : "";
const AuctionLesson = lazy(() => import("./cases/auction/auction-lesson").then(module => ({ default: module.AuctionLesson })));
const FlagshipLesson = lazy(() => import("./learning/flagship-lesson").then(module => ({ default: module.FlagshipLesson })));
const MultiRolePage = lazy(() => import("./experiments/multi-role").then(module => ({ default: module.MultiRolePage })));
const ParameterLab = lazy(() => import("./experiments/parameter-lab").then(module => ({ default: module.ParameterLab })));
const SvbPanel = lazy(() => import("./cases/svb/svb-panel").then(module => ({ default: module.SvbPanel })));
const SchellingPanel = lazy(() => import("./cases/schelling/schelling-panel").then(module => ({ default: module.SchellingPanel })));
const CascadePanel = lazy(() => import("./cases/cooperation/panels").then(module => ({ default: module.CascadePanel })));
const PublicGoodsPanel = lazy(() => import("./cases/cooperation/panels").then(module => ({ default: module.PublicGoodsPanel })));
const CommonsPanel = lazy(() => import("./cases/cooperation/panels").then(module => ({ default: module.CommonsPanel })));
const LemonsPanel = lazy(() => import("./cases/allocation/panels").then(module => ({ default: module.LemonsPanel })));
const MatchingPanel = lazy(() => import("./cases/allocation/panels").then(module => ({ default: module.MatchingPanel })));
const BeerPanel = lazy(() => import("./cases/allocation/panels").then(module => ({ default: module.BeerPanel })));
const CarbonPanel = lazy(() => import("./cases/markets/panels").then(module => ({ default: module.CarbonPanel })));
const FlashCrashPanel = lazy(() => import("./cases/markets/panels").then(module => ({ default: module.FlashCrashPanel })));
const GameStopPanel = lazy(() => import("./cases/markets/panels").then(module => ({ default: module.GameStopPanel })));
const classroomPanels: Record<FieldFlagship, Omit<FieldLesson, "caseId">> = {
  svb_run: { Panel: SvbPanel, defaultActor: "D01" },
  schelling_segregation: { Panel: SchellingPanel, defaultActor: "A001" },
  information_cascade: { Panel: CascadePanel, defaultActor: "D03" },
  public_goods: { Panel: PublicGoodsPanel, defaultActor: "P1" },
  commons_governance: { Panel: CommonsPanel, defaultActor: "F01" },
  lemons_market: { Panel: LemonsPanel, defaultActor: "S01" },
  school_matching: { Panel: MatchingPanel, defaultActor: "S01" },
  beer_game: { Panel: BeerPanel, defaultActor: "零售商" },
  carbon_market: { Panel: CarbonPanel, defaultActor: "F01" },
  flash_crash: { Panel: FlashCrashPanel, defaultActor: "做市者 0（学生）" },
  gamestop: { Panel: GameStopPanel, defaultActor: "学生投资者" },
};
const fieldCourse = isFieldFlagship(fieldCase) ? catalog.find(course => course.case_id === fieldCase) : undefined;
const boundaryPage = query.get("boundary") === "1" && boundaries[selectedCourse];
const modelPage = path === "/experiments" || query.get("view") === "model";
const knownQuery = ["case", "run", "event", "tick", "boundary", "view", "model_case"];
const hasLegacyQuery = knownQuery.some(key => query.has(key));
const invalidQuery = knownQuery.some(key => query.getAll(key).length > 1) ||
  ((query.has("event") || query.has("tick")) && !linkedRun) ||
  (linkedEvent !== null && query.has("tick")) ||
  (linkedRun !== null && (!linkedRun || modelPage || boundaryPage)) ||
  (query.has("tick") && !/^\d+$/.test(query.get("tick") ?? "")) ||
  (query.has("view") && query.get("view") !== "model") ||
  (query.has("model_case") && !modelPage) ||
  (query.has("boundary") && (!boundaryPage || modelPage));

function InvalidLink({ error }: { error: string }) {
  return <><AppHeader/><main id="main" tabIndex={-1} className="container course-home">
    <h1>{error}</h1>
    <p>请核对链接中的课程或运行参数，或从案例库重新进入。</p><a href="/cases">返回案例库</a>
  </main></>;
}

const BridgePractice = lazy(() => import("./learning/bridge-practice").then(module => ({ default: module.BridgePractice })));
const TeachingPage = lazy(() => import("./learning/teaching-page").then(module => ({ default: module.TeachingPage })));
const ReviewPage = lazy(() => import("./learning/review-page").then(module => ({ default: module.ReviewPage })));
const ConceptPage = lazy(() => import("./learning/concept-page").then(module => ({ default: module.ConceptPage })));
const StudioPage = lazy(() => import("./emergence/studio-page").then(module => ({ default: module.StudioPage })));

function Page() {
  if ((path === "/" && hasLegacyQuery) || path === "/experiments") {
    if (!activeCourse) return <InvalidLink error="课程不可用"/>;
    if (invalidQuery) return <InvalidLink error="链接参数无效"/>;
    if (linkedRun) return <><AppHeader/>{linkedEvent !== null ?
      <EventLookup runId={linkedRun} requested={linkedEvent}/> :
      <SharedTrace id={encodeURIComponent(linkedRun)} initialTick={Number(query.get("tick") ?? "0")}/>}</>;
    if (boundaryPage) return <><AppHeader/><BoundaryApp course={activeCourse}/></>;
    if (modelPage) return <ModelLab caseId={selectedCourse}/>;
    return selectedCourse === lesson.case_id ? <App/> : <LessonApp caseId={selectedCourse}/>;
  }
  return <>
    <AppHeader/>
    {path === "/" ? <HomePage/>
      : path === "/cases" ? <CasesPage/>
      : path === "/compare" ? <ParameterLab initialCase={query.get("case")}/>
      : path === "/experiments/multi-role" ? <MultiRolePage/>
      : path === "/paths" ? <PathsPage/>
      : path === "/emergence" ? <StudioPage/>
      : path === "/notes" ? <NotesPage/>
      : path === "/review" ? <ReviewPage/>
      : path === "/practice" ? <BridgePractice/>
      : path === "/teach" ? <TeachingPage caseId={query.get("case") ?? ""}/>
      : path === "/concepts" || path.startsWith("/concepts/") ? <ConceptPage conceptId={path.split("/")[2] ?? ""}/>
      : importCourse ? <CasePage course={importCourse}/>
      : path === "/learn/double_auction" ? <AuctionLesson/>
      : isFieldFlagship(fieldCase) ? <FlagshipLesson caseId={fieldCase} {...classroomPanels[fieldCase]}/>
      : <main id="main" tabIndex={-1} className="container course-home"><h1>页面不可用</h1><a href="/cases">返回案例库</a></main>}
  </>;
}

const pageTitle = modelPage ? "模型实验" : path === "/" && hasLegacyQuery ? activeCourse?.title :
  importCourse?.title ?? fieldCourse?.title ?? ({
    "/cases": "案例库", "/compare": "参数对照", "/paths": "学习路径", "/notes": "实验笔记",
    "/review": "复习队列", "/practice": "跨课练习", "/concepts": "概念索引", "/emergence": "从微观到宏观",
    "/teach": `${(activeCourse ?? catalog[0]).title}教学活动`,
    "/experiments": "模型实验", "/experiments/multi-role": "多角色模型实验", "/learn/double_auction": lesson.title,
  } as Record<string, string>)[path.startsWith("/concepts/") ? "/concepts" : path];
const legacyView = linkedRun ? (linkedEvent !== null ? "运行事件" : "实验回放")
  : boundaryPage ? "边界实验" : modelPage ? "模型实验" : null;
document.title = (path === "/" && hasLegacyQuery
  ? [modelPage ? null : activeCourse?.title ?? "课程不可用", legacyView, "Civitas Economica"]
  : pageTitle ? [pageTitle, studentBrand, "Civitas Economica"] : [studentBrand, "学生实验室"]).filter(Boolean).join(" · ");
createRoot(document.getElementById("root")!).render(
  <StrictMode><Suspense fallback={<p className="container" role="status">正在打开课堂…</p>}><Page/></Suspense></StrictMode>,
);
