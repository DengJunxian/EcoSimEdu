import { Fragment, lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { EvidenceCard, PageTitle, StatusNotice } from "../../content/student-ui.tsx";
import { comparable, conditions, deltaUnit, distribution, experimentCard, experimentLimits, pairResult, pairedRows, reopenExperiment,
  runSamples, sharedRange, statisticNames, type ExperimentPlan, type Pair, type Sample } from "./experiments.ts";
import { courseLink, type CourseRef } from "./learning-store.ts";
import { comparisonMetric, displayNumber, displayObservation, outcomeLabel, type Frame, type Lesson, type Metric, type Run, type Trend } from "./lesson.ts";
import { StudentHeader } from "./StudentHeader.tsx";
import { browserEvents } from "./run-evidence.ts";
import "./experiments.css";

const MetricChart = lazy(() => import("./MetricChart.tsx"));
const rowsPerPage = 24;
export const predictions: Record<Trend, string> = { down: "减少", same: "不变", up: "增加" };

type Focus = { run: Run; tick: number; checkpoint: number; side: "基线" | "干预" };

function OriginalEvent({ lesson, focus }: { lesson: Lesson; focus: Focus }) {
  const frame = focus.run.frames[focus.tick];
  const records = lesson.casePackage && browserEvents(focus.run, lesson.casePackage, focus.tick).filter(event => event.frameTick === focus.tick);
  return <EvidenceCard label="原事件证据">
    <h3>{focus.side}原记录 · 种子 {focus.run.seed}</h3>
    <p className="run-identity">运行编号 <code>{focus.run.id}</code></p>
    <ul>{records?.length ? records.map(event => <li key={event.eventId}>原事件 {event.eventId} · {event.summary ?? event.kind}</li>) :
      frame.events.map(event => <li key={event.id}>原事件 {event.id} · {event.text}</li>)}</ul>
  </EvidenceCard>;
}

function PairDetails({ lesson, treatment, pair }: { lesson: Lesson; treatment: ReturnType<typeof conditions>; pair: Pair }) {
  const primary = comparisonMetric(lesson);
  const secondary = useMemo(() => {
    if (lesson.casePackage?.caseId === "svb_run") return lesson.metrics.find(metric => metric.id === "equity");
    if (lesson.casePackage?.caseId === "double_auction")
      return { id: "last_price", label: "最近成交价", unit: "代币/件", color: primary.color };
  }, [lesson, primary.color]);
  const [viewMetric, setViewMetric] = useState(primary.id);
  const [focus, setFocus] = useState<Focus>();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [page, setPage] = useState(0);
  const evidenceId = useId();
  const previousPage = useRef<HTMLButtonElement>(null);
  const nextPage = useRef<HTMLButtonElement>(null);
  const metric: Metric = secondary?.id === viewMetric ? secondary : primary;
  const id = metric.id;
  const rows = useMemo(() => pairedRows(lesson, pair.baseline, pair.branch), [lesson, pair]);
  const labels = useMemo(() => rows.map(row => row.label), [rows]);
  const charts = useMemo(() => {
    const frames = (side: "baseline" | "branch"): Frame[] =>
      rows.map(row => ({ tick: row.tick, actors: [], events: [], metrics: row[side]?.metrics ?? {} }));
    return { baseline: frames("baseline"), branch: frames("branch") };
  }, [rows]);
  const bounds = useMemo(() => sharedRange(rows.flatMap(row => [row.baseline?.metrics[id], row.branch?.metrics[id]])), [rows, id]);
  const lastPage = Math.max(0, Math.ceil(rows.length / rowsPerPage) - 1);

  function turnPage(target: number) {
    setPage(target);
    setFocus(undefined);
    if (target === 0 || target === lastPage) {
      requestAnimationFrame(() => (target === 0 ? nextPage : previousPage).current?.focus());
    }
  }

  const sides = [{ side: "基线" as const, name: "无干预基线", amount: treatment.baseline, value: pair.left, key: "baseline" as const, run: pair.baseline },
    { side: "干预" as const, name: "引入政策", amount: treatment.comparison, value: pair.right, key: "branch" as const, run: pair.branch }];
  return <>
    {secondary && <label className="study-curve-choice">对照曲线指标 <select value={viewMetric} onChange={event => setViewMetric(event.target.value)}>
      <option value={primary.id}>{primary.label}</option><option value={secondary.id}>{secondary.label}</option>
    </select></label>}
    {bounds ? <p className="small">两图共用纵轴 {displayNumber(bounds.min)} 至 {displayNumber(bounds.max)} {metric.unit}。</p> :
      <StatusNotice>两组在所选时点均无数值可绘制。</StatusNotice>}
    <div className="comparison-grid">
      {sides.map(item => <section key={item.name}>
        <h3>{item.name}</h3><p>{item.amount}</p>
        <p>{outcomeLabel(lesson)} <strong>{withUnit(item.value, primary.unit)}</strong></p>
        {lesson.casePackage?.caseId === "svb_run" &&
          <p>期末银行权益 <strong>{item.run.frames.at(-1)?.metrics.equity} {primary.unit}</strong></p>}
        {bounds && <Suspense fallback={<p>正在绘制曲线…</p>}>
          <MetricChart metric={metric} frames={charts[item.key]} bounds={bounds} labels={labels}
            financial={metric.id === lesson.priceMetric || metric.id === "last_price"}/>
        </Suspense>}
      </section>)}
    </div>
    <details className="trace-details" onToggle={event => setEvidenceOpen(event.currentTarget.open)}>
      <summary>按经济时点查看两组{metric.label}与原事件</summary>
      {evidenceOpen && <>
        {lastPage > 0 && <div className="decision-actions trace-pages" role="group" aria-label="对照证据分页">
          <button type="button" ref={previousPage} disabled={page === 0}
            onClick={() => turnPage(page - 1)}>上一页</button>
          <span role="status">第 {page + 1} / {lastPage + 1} 页</span>
          <button type="button" ref={nextPage} disabled={page === lastPage}
            onClick={() => turnPage(page + 1)}>下一页</button>
        </div>}
        <div className="study-table">
          <table>
            <caption>{metric.label}{metric.unit && `（${metric.unit}）`}</caption>
            <thead><tr><th scope="col">经济时点</th><th scope="col">基线</th><th scope="col">干预</th></tr></thead>
            <tbody>{rows.slice(page * rowsPerPage, (page + 1) * rowsPerPage).map(row => <Fragment key={row.tick}>
              <tr><th scope="row">{row.label}</th>
                {sides.map(({ key, side, run }) => {
                  const point = row[key];
                  const sourceTick = point?.sourceTick;
                  const expanded = focus?.checkpoint === row.tick && focus.side === side;
                  return <td key={key}>{displayObservation(point?.metrics[id])}
                    {sourceTick !== undefined && <button type="button" className="text-button" aria-label={`查${side}原记录 ${sourceTick}`} aria-expanded={expanded}
                      aria-controls={expanded ? evidenceId : undefined}
                      onClick={() => setFocus(expanded ? undefined : { run, tick: sourceTick, checkpoint: row.tick, side })}>
                      记录 {sourceTick}</button>}</td>;
                })}
              </tr>
              {focus?.checkpoint === row.tick && <tr id={evidenceId}><td colSpan={3}><OriginalEvent lesson={lesson} focus={focus}/></td></tr>}
            </Fragment>)}</tbody>
          </table>
        </div>
      </>}
    </details>
  </>;
}

const withUnit = (value: number | null, unit: string) => value === null ? "未定义" : `${displayNumber(value)}${unit ? ` ${unit}` : ""}`;

export function StudyResults({ lesson, plan, primary, restored }: {
  lesson: Lesson; plan: ExperimentPlan; primary?: { baseline: Run; branch: Run }; restored?: Sample[];
}) {
  const first = useMemo(() => primary && pairResult(lesson, lesson.seed, primary.baseline, primary.branch), [lesson, primary]);
  const [samples, setSamples] = useState<Sample[] | undefined>(() => restored ?? (first && plan.seeds.length === 1 ? [first] : undefined));
  const [selectedSeed, selectSeed] = useState(plan.seeds[0]);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (restored || !first || plan.seeds.length < 2) return;
    let active = true;
    void runSamples(lesson, plan, first).then(result => { if (active) setSamples(result); });
    return () => { active = false; };
  }, [retry, lesson, plan, first, restored]);
  const rows = samples ?? (first ? [first] : []);
  const stat = distribution(rows);
  const pair = rows.filter(comparable).find(item => item.seed === selectedSeed);
  const metric = comparisonMetric(lesson);
  const treatment = conditions(lesson, plan.policy);
  const changeUnit = deltaUnit(metric.unit);
  const multi = plan.seeds.length > 1;
  const observed = samples && stat.count === plan.seeds.length && stat.median !== undefined ?
    Math.abs(stat.median) < 1e-10 ? "same" : stat.median < 0 ? "down" : "up" : undefined;
  const choice = lesson.decisions[0];
  const action = "options" in choice ? choice.options.find(option => option.id === plan.choices[0])?.label :
    `${choice.amount.label} ${plan.choices[0]} ${choice.amount.unit}`;

  async function download() {
    if (!samples || exporting) return;
    setExporting(true);
    setStatus("");
    try {
      const card = await experimentCard(lesson, plan, samples);
      const url = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `EcoSimEdu-${plan.course.caseId}-实验卡.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("实验卡已导出，可在此课恢复并核对。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "实验卡暂时无法导出。"); }
    finally { setExporting(false); }
  }

  return <section className="comparison study-results" aria-label="反事实对照结果">
    <h2>{multi ? "多种子配对结果" : "同种子运行结果"}</h2>
    <p>原预测：{predictions[plan.prediction]}。实际：{observed ? predictions[observed] : samples ? stat.count > 0 ? "部分可比较" : "无法比较" : "正在运行"}。
      {observed && (plan.prediction === observed ? "结果与预测一致。" : "可沿对齐的时点回查差异。")}</p>
    <dl className="study-method">
      {plan.hypothesis && <div><dt>原假设</dt><dd className="study-hypothesis">{plan.hypothesis}</dd></div>}
      <div><dt>指标、单位与口径</dt><dd>{metric.label}{metric.unit && `（${metric.unit}）`} · {statisticNames[lesson.metricRoles.statistic]}</dd></div>
      <div><dt>本次处理</dt><dd>{treatment.treatment} · {treatment.baseline} → {treatment.comparison}。{treatment.mechanisms}</dd></div>
      <div><dt>各对共同条件</dt><dd>{treatment.common} 入场动作保持为「{action}」。</dd></div>
      <div><dt>对齐口径</dt><dd>{lesson.bridge?.comparisonAxis ?? lesson.casePackage?.clock.label ?? "同一轮次"}。缺少对应观察时留空。</dd></div>
    </dl>
    {multi && <section aria-label="逐种子差异">
      <h3>逐种子差异</h3>
      <p>{experimentLimits}</p>
      {!samples && <StatusNotice>正在运行另外两组种子…</StatusNotice>}
      {samples && <>
        <p>共 {plan.seeds.length} 对，可比较 {stat.count} 对，未定义 {stat.undefinedCount} 对，失败 {stat.failed} 对。</p>
        {stat.count > 0 && <p>最小 {displayNumber(stat.minimum)} · 中位数 {displayNumber(stat.median)} · 最大 {displayNumber(stat.maximum)} {changeUnit}</p>}
        <div className="study-table">
          <table><caption>逐种子配对值</caption>
            <thead><tr><th scope="col">种子</th><th scope="col">基线{metric.unit && `（${metric.unit}）`}</th>
              <th scope="col">干预{metric.unit && `（${metric.unit}）`}</th><th scope="col">差值{changeUnit && `（${changeUnit}）`}</th></tr></thead>
            <tbody>{samples.map(sample => <tr key={sample.seed}><th scope="row">{sample.seed}</th>
              {comparable(sample) ? <><td>{displayNumber(sample.left)}</td><td>{displayNumber(sample.right)}</td><td>{displayNumber(sample.delta)}</td></> :
                <td colSpan={3}>运行未完成</td>}</tr>)}</tbody></table>
        </div>
        {!!stat.failed && <div className="decision-actions">
          <button type="button" onClick={() => { setSamples(undefined); setRetry(value => value + 1); }}>重新运行附加种子</button>
          <a href={courseLink(plan.course)}>重新载入本课</a>
        </div>}
      </>}
      <label className="study-curve-choice">查看种子的原曲线与事件 <select value={selectedSeed} onChange={event => selectSeed(Number(event.target.value))}>
        {rows.filter(comparable).map(item => <option key={item.seed} value={item.seed}>{item.seed}</option>)}
      </select></label>
    </section>}
    {pair && <PairDetails key={pair.seed} lesson={lesson} treatment={treatment} pair={pair}/>}
    {!multi && pair && pair.delta !== null && <p>配对差异 · 种子 {pair.seed}。干预组减基线 = {withUnit(pair.delta, changeUnit)}。</p>}
    {lesson.casePackage && <details className="trace-details">
      <summary>实验卡与结论边界</summary>
      <p>来源 · 浏览器规则引擎。模型费用回执不适用。</p>
      <p>{lesson.bridge?.rule ?? lesson.casePackage.modelAssumptions[0]}</p>
      {!multi && <p>{experimentLimits}</p>}
      <div className="decision-actions">
        <button type="button" onClick={() => void download()} disabled={!samples || !!stat.failed || exporting}>导出实验卡</button>
        {!restored && <a href={courseLink(plan.course, { experiment: "1" })}>恢复实验卡</a>}
      </div>
      {status && <p role="status">{status}</p>}
    </details>}
  </section>;
}

export function ExperimentArchive({ lesson, course }: { lesson: Lesson; course: CourseRef }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState<Awaited<ReturnType<typeof reopenExperiment>>>();

  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const file = new FormData(event.currentTarget).get("experiment");
    if (!(file instanceof File) || !file.size || file.size > 1_000_000) {
      setStatus("请选择不超过 1 MB 的实验卡 JSON。");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const restored = await reopenExperiment(lesson, course, JSON.parse(await file.text()));
      setRestored(restored);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof SyntaxError ? "文件格式有误。请选择本平台的实验卡 JSON。" :
        error instanceof Error ? error.message : "实验卡无法恢复。");
    } finally { setBusy(false); }
  }

  return <><StudentHeader caseId={course.caseId}/><main id="main" tabIndex={-1} className="shell lesson-shell experiment-archive">
    <PageTitle>恢复实验卡</PageTitle>
    <p>{lesson.title}</p>
    <p>选取本课导出的实验卡。本机会用原种子和输入重算，并核对两组运行及证据摘要。</p>
    <form onSubmit={open} className="decision-actions">
      <label>本课实验卡 <input type="file" name="experiment" accept=".json,application/json" required disabled={busy}/></label>
      <button type="submit" disabled={busy}>核对并恢复</button>
    </form>
    {busy && <p role="status">正在重算两组运行…</p>}
    {status && <p role="alert">{status}</p>}
    {restored && <><p role="status">{status ? "继续显示上一份已核对的实验卡。" : "已核对运行、原预测和证据。"}</p>
      <StudyResults key={JSON.stringify(restored.plan)} lesson={lesson} plan={restored.plan} restored={restored.samples}/></>}
    <a href={courseLink(course)}>返回课堂</a>
  </main></>;
}
