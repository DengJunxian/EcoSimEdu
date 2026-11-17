import { Fragment, useEffect, useRef, useState } from "react";
import { ApiError, api, downloadJson } from "./contracts";
import { catalog, CourseLinks } from "./catalog";
import { checkStudy, newStudy, noteKeys, noteNames, restoreRuns, runLesson, storageKey } from "./lesson-types";
import type { Course, Event, Grid, LessonRun, Question, Study } from "./lesson-types";
import { GridView, MetricValues, showValue, TraceView } from "./lesson-view";
import { PairedView } from "./paired-view";
import { LivePanel, liveCourses } from "./live-panel";
import { TutorPanel } from "./tutor";
import { LabTools, teacherEnabled } from "./lab-tools";
import { BoundaryLink } from "./boundary";
import { AppHeader } from "./app/shell";

function Options({ question, value, onChange }: {
  question: Question; value: string; onChange: (id: string) => void;
}) {
  return <fieldset><legend>{question.prompt}</legend><div className="options">
    {Object.entries(question.options).map(([id, label]) => <label key={id}>
      <input type="radio" name={question.prompt} value={id} checked={value === id} onChange={() => onChange(id)}/>{label}
    </label>)}
  </div></fieldset>;
}

function Sources({ course }: { course: Course }) {
  return <details className="sources"><summary>来源与概念</summary>
    {course.sources.map(source => <p key={source.id}>{source.supports} <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}
    <dl>{course.glossary.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.definition}</dd></div>)}</dl>
  </details>;
}

function initial(course: Course) {
  try {
    const saved = localStorage.getItem(storageKey(course));
    if (saved) return { study: checkStudy(course, JSON.parse(saved)), error: "" };
    const earlier = Object.keys(localStorage).some(key =>
      key.startsWith(`civitas/${course.case_id}/`) && key !== storageKey(course));
    return { study: newStudy(course), error: earlier ? "课程版本已更新。旧版草稿保留，可重新开始本版实验。" : "" };
  } catch {
    return { study: newStudy(course), error: "本地草稿无法恢复，可导入其他记录或重新开始。" };
  }
}

function Compare({ course, runs }: { course: Course; runs: Record<string, LessonRun> }) {
  return <div className="table-scroll"><table className="comparison">
    <caption>共享生成根与学生行动的实验对照</caption>
    <thead><tr><th>情景</th>{course.metrics.map(metric => <th key={metric.id}>{metric.label}（{metric.unit}）</th>)}</tr></thead>
    <tbody>{course.scenarios.map(scenario => {
      const result = runs[scenario.id]?.result;
      return <tr key={scenario.id}><th scope="row">{scenario.label}</th>
        {result ? course.metrics.map(metric => <td key={metric.id}>
          <span className="mobile-metric">{metric.label}（{metric.unit}）</span>{showValue(result.metrics[metric.id])}
        </td>) : <td colSpan={course.metrics.length}>待运行</td>}
      </tr>;
    })}</tbody>
  </table></div>;
}

export function LessonApp({ caseId }: { caseId: string }) {
  const course = catalog.find(entry => entry.case_id === caseId) as Course;
  const [loaded] = useState(() => initial(course));
  const [study, setStudy] = useState(loaded.study);
  const [runs, setRuns] = useState<Record<string, LessonRun>>({});
  const [comparison, setComparison] = useState("baseline");
  const [fullReview, setFullReview] = useState(false);
  const [pending, setPending] = useState(!!Object.keys(loaded.study.runs).length);
  const [error, setError] = useState(loaded.error);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<Grid>();
  const head = useRef<HTMLHeadingElement>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const current = course.lessons[study.stage];
  const base = runs.baseline;
  const active = runs[comparison] ?? base;
  const canFinish = !study.reviewRequired && course.scenarios.every(s => runs[s.id]) &&
    study.evidence.length >= course.minimum_evidence && noteKeys.every(key => study.notes[key].trim());
  const update = (patch: Partial<Study>) => setStudy(state => ({ ...state, ...patch }));

  useEffect(() => {
    let activeEffect = true;
    if (Object.keys(loaded.study.runs).length) {
      restoreRuns(course, loaded.study).then(result => { if (activeEffect) setRuns(result); })
        .catch(problem => { if (activeEffect) setError(problem.message); })
        .finally(() => { if (activeEffect) setPending(false); });
    }
    return () => { activeEffect = false; };
  }, [course, loaded]);

  useEffect(() => {
    if (current.id !== "bid" || course.case_id !== "schelling_segregation") return;
    let activeEffect = true;
    api<{ grid: Grid }>(`/cases/${course.case_id}/briefing`).then(result => {
      if (activeEffect) setPreview(result.grid);
    }).catch(problem => { if (activeEffect) setError(problem.message); });
    return () => { activeEffect = false; };
  }, [course, current.id]);

  useEffect(() => {
    if (loaded.error && study === loaded.study) return;
    try { localStorage.setItem(storageKey(course), JSON.stringify(study)); }
    catch { setNotice("浏览器无法储存学习草稿，请导出记录备份。"); }
  }, [course, study, loaded]);

  function visit(stage: number) {
    setError("");
    setStudy(value => ({ ...value, stage, unlocked: Math.max(value.unlocked, stage) }));
    requestAnimationFrame(() => { head.current?.focus(); window.scrollTo(0, 0); });
  }

  async function run(scenario: string) {
    setPending(true);
    setError("");
    const action = scenario === "baseline" ? study.action : base.action;
    const parent = scenario === "baseline" ? undefined : base.run_id;
    const signature = `${scenario}/${action}/${parent ?? ""}`;
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await runLesson(course, scenario, action, request.current.id, parent);
      request.current = null;
      setComparison(scenario);
      if (scenario === "baseline") {
        setRuns({ baseline: result });
        setFullReview(false);
        update({ runs: { baseline: result.run_id }, selections: {}, evidence: [],
          explanation: "", complete: false, stage: 3, unlocked: 3,
          reviewRequired: noteKeys.some(key => Boolean(study.notes[key].trim())) });
        requestAnimationFrame(() => { head.current?.focus(); window.scrollTo(0, 0); });
      } else {
        setRuns(prev => ({ ...prev, [scenario]: result }));
        update({ runs: { ...study.runs, [scenario]: result.run_id } });
      }
    } catch (problem) {
      if (problem instanceof ApiError && ["RUN_FAILED", "RUN_ALREADY_TERMINAL"].includes(problem.code)) {
        request.current = null;
      }
      setError(problem instanceof Error ? problem.message : "运行失败");
    } finally { setPending(false); }
  }

  async function importStudy(file?: File) {
    if (!file) return;
    setPending(true);
    setError("");
    try {
      if (file.size > 512 * 1024) throw new Error("学习记录文件超过 512 KB。");
      const saved = checkStudy(course, JSON.parse(await file.text()));
      setRuns(await restoreRuns(course, saved));
      setStudy(saved);
      setComparison("baseline");
      setNotice("已恢复学习记录。");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "无法导入学习记录");
    } finally { setPending(false); }
  }

  function cite(run: LessonRun, event: Event) {
    setStudy(prev => {
      if (prev.evidence.length >= 200 || prev.evidence.some(item => item.run_id === run.run_id && item.seq === event.seq)) {
        return prev;
      }
      return { ...prev, evidence: [...prev.evidence, { run_id: run.run_id, seq: event.seq }] };
    });
  }

  const trace = (run: LessonRun) => {
    const selection = study.selections[run.run_id] ?? { tick: 0, actor: "" };
    const guided = current.id === "observe";
    return <Fragment key={run.run_id}><TraceView course={course} run={run} {...selection}
      review={guided ? { active: fullReview, change: setFullReview } : undefined}
      select={(tick, actor) => setStudy(prev => ({ ...prev, selections: { ...prev.selections, [run.run_id]: { tick, actor } } }))}
      cite={event => cite(run, event)}
      cited={study.evidence.some(item => item.run_id === run.run_id && item.seq === selection.tick)}/>
      <TutorPanel caseId={caseId} runId={run.run_id} tick={selection.tick}
        revealUntil={guided && !fullReview ? selection.tick : undefined}/>
    </Fragment>;
  };

  return <>
    <AppHeader resetLesson={() => visit(0)} modelCaseId={caseId}/>
    <div className="container">
      <main id="main" tabIndex={-1}>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="callout" role="status">{notice}</p>}
        {pending && <p className="callout" role="status">正在处理本地实验…</p>}
        {current.id === "intro" ? <section className="course-home">
          <div className="identity-row"><span className="identity">{course.identity_label}</span><span>{course.minutes}</span></div>
          <h1 tabIndex={-1} ref={head}>{course.title}</h1>
          <h2>{course.subtitle}</h2>
          <p>{course.intro}</p>
          <button className="primary" disabled={pending} onClick={() => visit(study.unlocked || 1)}>
            {study.unlocked ? "继续学习" : "开始实验"}</button>
          <BoundaryLink caseId={caseId}/>
          <LabTools caseId={caseId}/>
          <section className="intro-grid">
            <div><h2>实验缘起</h2><p>{course.background}</p><Sources course={course}/></div>
            <div><h2>这节课会做什么</h2><ul>{course.goals.map(goal => <li key={goal}>{goal}</li>)}</ul>
              <label className="import">导入学习记录 <input type="file" accept=".json,application/json"
                disabled={pending} onChange={e => { void importStudy(e.target.files?.[0]); e.target.value = ""; }}/></label></div>
          </section>
        </section> : <div className="workspace">
          <aside className="steps"><nav aria-label="学习阶段"><ol>
            {course.lessons.map((item, index) => <li key={item.id}>
              <button disabled={index > study.unlocked || pending} aria-current={index === study.stage ? "step" : undefined}
                onClick={() => visit(index)}><span>{String(index + 1).padStart(2, "0")}</span>{item.title}</button>
            </li>)}
          </ol></nav></aside>
          <article className="lesson">
            <div className="lesson-heading"><p className="lesson-name">{course.title}</p>
              <h1 tabIndex={-1} ref={head}>{current.title}</h1><p>{current.prompt}</p></div>
            {current.id === "predict" && <>
              <Options question={course.questions.prediction} value={study.prediction}
                onChange={prediction => update({ prediction, complete: false })}/>
              <button className="primary" disabled={!study.prediction} onClick={() => visit(2)}>选择行动</button>
              <TutorPanel caseId={caseId}/>
            </>}
            {current.id === "bid" && <>
              {preview && <GridView grid={preview}/>}
              <div className="bid-label"><label htmlFor="lesson-action">{course.action.label}</label>
                <select id="lesson-action" disabled={pending} value={study.action} onChange={e => update({ action: e.target.value })}>
                  {course.action.options.map(action => <option key={action.id} value={action.id}>{action.label}</option>)}
                </select></div>
              <button className="primary" disabled={pending || (caseId === "schelling_segregation" && !preview)}
                onClick={() => run("baseline")}>运行实验</button>
              {liveCourses.includes(caseId) && <LivePanel caseId={caseId} seed={course.seed} action={study.action}
                actionLabel={value => course.action.options.find(choice => choice.id === value)?.label ?? value}/>}
            </>}
            {["observe", "explain", "compare", "notebook"].includes(current.id) && !base && !pending &&
              <button className="primary" onClick={() => visit(2)}>返回并创建实验</button>}
            {current.id === "observe" && base && <>
              {trace(base)}
              <button className="primary" onClick={() => visit(4)}>解释结果</button>
            </>}
            {current.id === "explain" && base && <>
              <p className="callout">你的预测 · {course.questions.prediction.options[study.prediction]}</p>
              <MetricValues course={course} metrics={base.result.metrics}/>
              <p>{base.result.events.at(-1)?.summary}</p>
              {base.result.snapshots[0].grid && base.result.snapshots.at(-1)?.grid && <div className="interventions">
                <section><h3>开局</h3><GridView grid={base.result.snapshots[0].grid}/></section>
                <section><h3>结束</h3><GridView grid={base.result.snapshots.at(-1)!.grid!}/></section>
              </div>}
              <Options question={course.questions.explain} value={study.explanation}
                onChange={explanation => update({ explanation, complete: false })}/>
              {teacherEnabled() && <details><summary>查看参考答案</summary>
                <p>{(course.questions.explain.options as Record<string, string>)[course.questions.explain.answer]}。{course.questions.explain.feedback}</p>
              </details>}
              {study.explanation && <p className="callout">{course.questions.explain.feedback}</p>}
              <button className="primary" disabled={!study.explanation} onClick={() => visit(5)}>比较反事实</button>
            </>}
            {current.id === "compare" && base && <>
              <p>配对种子 {base.seed} · 共同生成根 {base.result.root_hash.slice(0, 12)}</p>
              <div className="interventions">
                {course.scenarios.filter(scenario => scenario.id !== "baseline").map(scenario =>
                  <div key={scenario.id}><h3>{scenario.label}</h3><p>{scenario.description}</p>
                    <button disabled={pending} onClick={() => runs[scenario.id] ? setComparison(scenario.id) : run(scenario.id)}>
                      {runs[scenario.id] ? "查看结果" : "运行对照"}</button></div>)}
              </div>
              <Compare course={course} runs={runs}/>
              {active && <>
                <label>查看运行 <select value={comparison} onChange={e => setComparison(e.target.value)}>
                  {course.scenarios.filter(scenario => runs[scenario.id]).map(scenario =>
                    <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}
                </select></label>
                {active !== base && <>
                  <PairedView key={`paired/${active.run_id}`} caseId={caseId} baseline={base.run_id} branch={active.run_id}
                    title={course.scenarios.find(s => s.id === active.scenario_id)!.label}/>
                  <p>初态摘要 {base.result.initial_hash.slice(0, 12)} → {active.result.initial_hash.slice(0, 12)}。
                    {base.result.initial_hash === active.result.initial_hash ? " 初态相同。" : " 干预改变了开局状态。"}</p>
                  <details><summary>查看实际参数差异</summary>
                    <ul>{Array.from(new Set([...Object.keys(base.result.intervention), ...Object.keys(active.result.intervention)]))
                      .filter(key => base.result.intervention[key] !== active.result.intervention[key])
                      .map(key => <li key={key}>{key} · {showValue(base.result.intervention[key])} → {showValue(active.result.intervention[key])}</li>)}</ul>
                  </details>
                </>}
                {trace(active)}
              </>}
              <button className="primary" disabled={pending || !course.scenarios.every(s => runs[s.id])}
                onClick={() => visit(6)}>写实验笔记</button>
            </>}
            {current.id === "notebook" && base && <div className="notebook">
              <h3>证据引用</h3><p>至少引用 {course.minimum_evidence} 条运行证据。已引用 {study.evidence.length} 条。</p>
              {!!study.evidence.length && <ul>{study.evidence.map(item => {
                const source = Object.values(runs).find(run => run.run_id === item.run_id);
                const event = source?.result.events[item.seq];
                return <li key={`${item.run_id}/${item.seq}`}>{course.scenarios.find(s => s.id === source?.scenario_id)?.label}
                  · 事件 {item.seq} · {event?.summary}
                  <button className="text-button" onClick={() => update({
                    evidence: study.evidence.filter(e => e !== item), complete: false,
                  })}>移除</button></li>;
              })}</ul>}
              <label>从运行中选取证据 <select value="" onChange={e => {
                const [id, seq] = e.target.value.split("/");
                const source = runs[id];
                if (source) cite(source, source.result.events[Number(seq)]);
              }}>
                <option value="">选择事件</option>
                {Object.values(runs).map(run => <optgroup key={run.scenario_id}
                  label={course.scenarios.find(s => s.id === run.scenario_id)?.label}>
                  {run.result.events.filter(event => course.evidence_types.includes(event.event_type)).map(event =>
                    <option key={event.seq} value={`${run.scenario_id}/${event.seq}`}>事件 {event.seq} · {event.summary}</option>)}
                </optgroup>)}
              </select></label>
              {noteKeys.map(key => <label key={key}>{noteNames[key]}
                {key === "transfer" && <span>{course.questions.transfer.prompt}</span>}
                <textarea maxLength={5000} value={study.notes[key]}
                  onChange={e => update({ notes: { ...study.notes, [key]: e.target.value }, complete: false })}/>
              </label>)}
              {study.reviewRequired && <p className="callout">基准运行已更新。请用新证据核对保留的笔记。
                <button onClick={() => update({ reviewRequired: false })}>已核对笔记</button>
              </p>}
              <details><summary>离线自评</summary><p>{course.questions.transfer.rubric}</p></details>
              <div className="toolbar">
                <button className="primary" disabled={!canFinish || study.complete} onClick={() => update({ complete: true })}>
                  {study.complete ? "已完成学习" : "完成学习"}</button>
                <button onClick={() => downloadJson(`${course.title}-实验笔记.json`, study)}>导出实验笔记</button>
              </div>
            </div>}
            <Sources course={course}/>
          </article>
        </div>}
      </main>
      {study.stage !== 0 && <CourseLinks current={caseId}/>}
      <footer><span>Civitas Economica</span><span>{course.title} · v{course.version}</span></footer>
    </div>
  </>;
}
