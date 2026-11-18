import { useEffect, useId, useRef, useState } from "react";
import { eventHref } from "../../contracts";
import { TraceLenses, useTrace, type Perspective } from "../../emergence/trace-view";
import { ExplanationEditor } from "../../learning/explanation-card";
import { sourceRef, type SourceRef } from "../../learning/flagship-study";
import { saveEvidenceCheck } from "../../learning/evidence-checks";
import type { DomainPanelProps, FlagshipView } from "../../learning/flagship-types";
import type { Event } from "../../lesson-types";
import { MetricChart, showValue } from "../../lesson-view";
import { LayoutCounterfactual } from "./layout-counterfactual";
import { coordinates } from "./neighborhood";

const isMove = (event: Event) => event.event_type === "student_move" || event.event_type === "move";
const sameSource = (a: SourceRef, b: SourceRef) =>
  a.run_id === b.run_id && a.result_hash === b.result_hash && a.seq === b.seq && a.actor === b.actor;
const metrics = ["similarity", "satisfied"] as const;

const predictions = ["最终大体混居", "最终会出现空间分化", "暂时无法判断"];

export function EmergencePrediction({ records, record, hasRun }: DomainPanelProps) {
  const prediction = records?.emergencePrediction ?? "";
  return <fieldset className="field-question">
    <legend>如果每个人只要求至少 30% 同组邻居，最后会形成怎样的社区？</legend>
    <label>社区格局预测 <select disabled={hasRun} value={prediction}
      onChange={event => record?.("emergencePrediction", event.target.value)}>
      <option value="">选择一项判断</option>
      {predictions.map(item => <option key={item}>{item}</option>)}
    </select></label>
    <label className="field-input">预测依据 <textarea disabled={hasRun} maxLength={300}
      value={records?.emergenceReason ?? ""} onChange={event => record?.("emergenceReason", event.target.value)}/></label>
  </fieldset>;
}

export function EmergenceMicroscope({ view, course, pinned, seek, cite, evidence = [], comparisons = [], capture,
  contentVersion, demo, reviewUnlocked, records, review, explore, perspective = "system", changePerspective }:
  DomainPanelProps & { view: FlagshipView }) {
  const [open, setOpen] = useState(!!explore);
  const [selectedMetric, setMetric] = useState<string>(metrics[0]);
  const [reverse, setReverse] = useState<{ tick: number; metric: string; interval?: readonly [number, number] }>();
  const [check, setCheck] = useState<{ key: string; message: string }>();
  const [checking, setChecking] = useState(false);
  const [bounds, setBounds] = useState<[string, string]>();
  const [picking, setPicking] = useState<{ start?: number }>();
  const refocus = useRef(false);
  const eventPanel = useRef<HTMLHeadingElement>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const checkHeading = useRef<HTMLHeadingElement>(null);
  const intervalHelp = useId();
  const intervalStatus = useId();
  const { run_id: runId, result_hash: hash, tick } = view;
  const series = review ? view.series : view.series.slice(0, tick + 1);
  const limit = series.length - 1;
  const [startText, endText] = bounds ?? [String(Math.max(0, limit - 5)), String(limit)];
  const start = Number(startText), end = Number(endText);
  const interval = startText !== "" && endText !== "" && Number.isInteger(start) && Number.isInteger(end) &&
    start >= 0 && start <= end && end <= limit ? [start, end] as const : undefined;
  const intervalMoves = interval ? view.events.filter(row => row.tick > start && row.tick <= end && isMove(row)) : [];
  const intervalSummary = !interval ? `请输入从 0 到 ${limit} 的有效区间，起点可等于终点。` :
    intervalMoves.length ? `区间内有 ${intervalMoves.length} 次搬迁。` : "这个区间没有搬迁记录。";
  const moves = view.events.slice(0, tick + 1).filter(isMove);
  const event = view.events[tick];
  const moving = event && isMove(event);
  const residentMoves = moves.filter(row => row.actor_id === pinned);
  const response = useTrace(view, selectedMetric, perspective, pinned, open);
  const { trace: existingTrace, error } = response ?? {};
  const pairs = comparisons.filter(pair => pair.kind === "initial_layout" && pair.base.run_id === runId &&
    pair.base.result_hash === hash);
  const moveRefs = evidence.filter(item => item.run_id === runId && item.result_hash === hash &&
    (item.event_type === "move" || item.event_type === "student_move"));
  const sources = [...moveRefs, ...pairs.flatMap(pair => [pair.base, pair.branch])]
    .filter((item, index, all) => all.findIndex(candidate => sameSource(candidate, item)) === index);
  const metricCourse = { metrics: course.metrics.filter(metric => metrics.some(id => id === metric.id)).reverse() };

  useEffect(() => {
    if (reverse?.tick === tick && refocus.current) {
      refocus.current = false;
      eventPanel.current?.focus();
    }
  }, [tick, reverse]);

  const size = view.frame.grid?.size;
  const matchedNeighbor = moving && event.changed_neighbors?.some(change => change.actor === pinned) ? pinned : undefined;
  const atClose = view.closed || reviewUnlocked;
  const rule = existingTrace?.edges.find(edge => edge.kind === "model_rule" ||
    (event?.event_type === "student_move" && edge.kind === "observed_transition"));

  const checkKey = `${runId}/${tick}/${pinned}/${reverse?.interval?.join("-")}`;
  useEffect(() => {
    if (check?.key === checkKey && document.activeElement === checkButton.current) checkHeading.current?.focus();
  }, [check, checkKey]);

  function locate(target: number, metric: string, selected?: readonly [number, number]) {
    setMetric(metric);
    refocus.current = true;
    setReverse({ tick: target, metric, interval: selected });
    seek(target);
  }

  return <details id="emergence-explore" className="emergence-studio" open={open}
    onToggle={toggle => setOpen(toggle.currentTarget.open)}>
    <summary>涌现显微镜</summary>
    {open && <>
      <label>证据视角 <select value={perspective} onChange={event => changePerspective?.(event.target.value as Perspective)}>
        <option value="system">模型观察者</option><option value="role">居民 A001</option>
      </select></label>
      {error && <p role="alert">当前事件证据未能核对。{error}</p>}
      {perspective === "role" && <p>当前只显示 A001 的位置和本地邻域。</p>}
      <TraceLenses trace={existingTrace} perspective={perspective} seek={seek}/>
      {perspective === "system" && <>
      <section className="emergence-section" aria-labelledby="emergence-observation">
        <h3 id="emergence-observation" tabIndex={-1} ref={eventPanel}>搬迁与邻域 · 事件 {tick}</h3>
        {records?.emergencePrediction && <p>原预测为「{records.emergencePrediction}」。{records.emergenceReason}</p>}
        {pinned && <p>已固定 {pinned}。{residentMoves.length ?
          `截至此处记录了 ${residentMoves.length} 次本人搬迁。` : "截至此处没有该居民本人的搬迁记录。"}</p>}
        {residentMoves.length > 0 && <button type="button" onClick={() => seek(residentMoves[0].tick)}>
          定位 {pinned} 的首次搬迁
        </button>}
        {moving && size && typeof event.origin === "number" && typeof event.destination === "number" &&
          typeof event.actor_id === "string" && Array.isArray(event.before) && Array.isArray(event.after) ? <>
          <p>{event.actor_id} 从{coordinates(event.origin, size)}搬到{coordinates(event.destination, size)}。
            同组／已占邻居从 {event.before?.join("/")} 变为 {event.after?.join("/")}。</p>
          <p>{event.changed_neighbors?.length ?? 0} 位邻居的关系受到影响。
            {!!event.changed_neighbors?.length && <a href="#schelling-neighbors">在邻域表选一位继续追踪</a>}</p>
          {rule && <p><strong>{rule.kind === "model_rule" ? "模型规则" : "已记录的学生行动"}</strong> · {rule.label}</p>}
          <div className="toolbar">
            <button type="button" onClick={() => cite(event.seq, matchedNeighbor)}>引用此搬迁{matchedNeighbor ? `与 ${matchedNeighbor} 的邻域` : ""}</button>
            {atClose && <a href={eventHref(view.case_id, runId, event.seq)}>打开事件来源</a>}
          </div>
          {reverse?.tick === tick && reverse.interval && !!event.changed_neighbors?.length && <div>
            <p>在邻域表固定一位住户，再核对这次区间反查。</p>
            <button type="button" ref={checkButton} disabled={!pinned} aria-disabled={checking} onClick={async () => {
              if (checking) return;
              setChecking(true);
              try {
                if (!demo) await saveEvidenceCheck({
                  case_id: view.case_id, kind: "reverse", passed: !!matchedNeighbor,
                  source_refs: [sourceRef(view, event)],
                  response: { 区间: reverse.interval!.join("–"), 住户: pinned, 指标: selectedMetric },
                });
                setCheck({ key: checkKey, message: matchedNeighbor ? "反查成立。所选住户在这次搬迁的受影响邻居中。" :
                  "所选住户未出现在这次搬迁的受影响邻居中。请用邻域记录复核。" });
              } catch { setCheck({ key: checkKey, message: "本机未能保存本次核对。请重试。" }); }
              finally { setChecking(false); }
            }}>核对我的区间反查</button>
            <div className="education-status" role="status">{check?.key === checkKey &&
              <h4 tabIndex={-1} ref={checkHeading}>{check.message}</h4>}</div>
          </div>}
        </> : <p>这个系统观察点没有记录搬迁。继续推进，或从下方曲线反查已揭示的事件。</p>}
        {moves.length > 0 && <label>已揭示的搬迁 <select value={moving ? tick : ""} onChange={e => seek(Number(e.target.value))}>
          <option value="" disabled>选择事件</option>
          {moves.map(row => <option key={row.seq} value={row.tick}>事件 {row.seq} · {String(row.actor_id)}</option>)}
        </select></label>}
      </section>

      <section className="emergence-section" aria-labelledby="emergence-macro">
        <h3 id="emergence-macro">全图指标</h3>
        <div className="table-scroll"><table>
          <caption>{moving ? "该次搬迁前后" : "当前观察点"}</caption>
          <thead><tr><th scope="col">指标</th>{moving && <th scope="col">之前</th>}<th scope="col">当前</th>
            {moving && <th scope="col">变化</th>}</tr></thead>
          <tbody>{metrics.map(metric => {
            const before = view.previous?.metrics[metric];
            const after = view.frame.metrics[metric];
            return <tr key={metric}><th scope="row">{metric === "similarity" ? "同类邻接率" : "居民满意率"}</th>
              {moving && <td>{before == null ? "缺失" : `${showValue(before)}%`}</td>}
              <td>{after == null ? "缺失" : `${showValue(after)}%`}</td>
              {moving && <td>{before == null || after == null ? "缺失" : before === after ? "未变" :
                `${showValue(Number((after - before).toFixed(2)))} 个百分点`}</td>}
            </tr>;
          })}</tbody>
        </table></div>
        <p>同类邻接率以全部占用邻接对为分母，满意率以全体居民为分母。</p>
        {moving && !error && <p role="status">{!existingTrace ? "正在核对网格指标…" : existingTrace.evidence_level === "exact_identity" ?
          "算术恒等式 · 已从前后网格独立复算两项比例。" : existingTrace.notes.join(" ")}</p>}
        <MetricChart course={metricCourse} frames={series} tick={tick} interval={bounds ? interval : undefined} metricChanged={setMetric}
          change={(target, metric) => {
            if (!picking) { locate(target, metric); return; }
            if (picking.start === undefined || picking.start > limit) {
              setPicking({ start: target });
              setBounds([String(target), String(target)]);
            } else {
              setBounds([String(Math.min(target, picking.start)), String(Math.max(target, picking.start))]);
              setPicking(undefined);
            }
          }}/>
        {reverse?.tick === tick && <p role="status">已从{reverse.metric === "similarity" ? "同类邻接率" : "居民满意率"}定位事件 {tick}。
          {moving ? "该点对应上方记录的实际搬迁。" : "该点无搬迁记录。"}</p>}
        <details><summary>按区间反查搬迁</summary>
          <div className="toolbar">
            <label className="field-input">起点事件 <input type="number" min={0} max={limit}
              aria-describedby={`${intervalStatus} ${intervalHelp}`}
              value={startText} onChange={e => { setPicking(undefined); setBounds([e.target.value, endText]); }}/></label>
            <label className="field-input">终点事件 <input type="number" min={0} max={limit}
              aria-describedby={`${intervalStatus} ${intervalHelp}`}
              value={endText} onChange={e => { setPicking(undefined); setBounds([startText, e.target.value]); }}/></label>
            <button type="button" aria-pressed={!!picking} onClick={() => setPicking(picking ? undefined : {})}>
              在曲线上选区间
            </button>
          </div>
          {picking && <p role="status">{picking.start === undefined ? "选择曲线上的第一个端点。" : "再选一个端点。"}</p>}
          <p id={intervalHelp}>已揭示事件 0 至 {limit}。结果包含起点之后、截至终点的搬迁。</p>
          <div role="status">
            {/* Safari can retain the previous heading name after the text changes. */}
            <h4 key={intervalSummary} id={intervalStatus} tabIndex={0}>{intervalSummary}</h4>
          </div>
          {!!intervalMoves.length && <div className="table-scroll"><table>
              <caption>区间内的搬迁</caption>
              <thead><tr><th scope="col">事件与迁居者</th><th scope="col">同组／已占邻居</th><th scope="col">受影响邻居</th></tr></thead>
              <tbody>{intervalMoves.map(row => <tr key={row.seq}>
                <th scope="row"><button type="button" className="text-button"
                  onClick={() => locate(row.tick, selectedMetric, interval)}>事件 {row.seq} · {String(row.actor_id ?? "缺失")}</button></th>
                <td>{Array.isArray(row.before) ? row.before.join("/") : "缺失"} →{" "}
                  {Array.isArray(row.after) ? row.after.join("/") : "缺失"}</td>
                <td>{row.changed_neighbors?.length ?? "缺失"}</td>
              </tr>)}</tbody>
            </table></div>}
        </details>
      </section>

      {!atClose && <p>完成基准回放后，即可改变初始布局并提交解释。</p>}
      {atClose && <>
        <LayoutCounterfactual key={runId} view={view} capture={capture} comparisons={pairs}/>
        <p><a href="/compare?case=schelling_segregation&exercise=threshold">只改阈值，比较同一开局如何演化</a></p>
        {contentVersion && <section className="emergence-section" aria-labelledby="emergence-explain">
          <h3 id="emergence-explain">用本次运行解释格局</h3>
          <p>从上方各引用一次搬迁和一个成对观察点。</p>
          <ExplanationEditor caseId={view.case_id} version={contentVersion} demo={demo} sources={sources}
            task={{
              id: "schelling-emergence-v1",
              prompt: "选择一位受影响却没在这一步搬家的居民。根据记录判断其是否越过阈值，解释为何两个全图比例可能有不同变化。用初态对照写明结论的条件，再提出一项尚待检验的解释假设。",
              evidenceMet: refs => moveRefs.some(move => refs.some(ref => sameSource(move, ref))) &&
                pairs.some(pair => [pair.base, pair.branch].every(source => refs.some(ref => sameSource(source, ref)))),
            }}/>
        </section>}
      </>}
      </>}
    </>}
  </details>;
}
