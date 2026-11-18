import { useEffect, useState } from "react";
import { catalog, caseHref } from "../catalog";
import { api } from "../contracts";
import type { LearningPackage } from "./education-types";
import type { SceneContent } from "./flagship-types";
import "./education.css";

const durations = [10, 20, 40] as const;

export function TeachingPage({ caseId }: { caseId: string }) {
  const course = catalog.find(row => row.case_id === caseId) ?? catalog[0];
  const [duration, setDuration] = useState<number>(20);
  const [coursePack, setCoursePack] = useState<LearningPackage>();
  const [scenes, setScenes] = useState<SceneContent>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const base = `/cases/${course.case_id}/lesson`;
    Promise.all([api<SceneContent>(base, undefined, controller.signal),
      api<LearningPackage>(base + "?schema_version=3", undefined, controller.signal)])
      .then(([original, current]) => { setScenes(original); setCoursePack(current); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [course.case_id]);
  const worked = coursePack?.activities.find(row => row.kind === "example");
  const targetPhase = duration === 10 ? ["intro", "predict", "observe"] :
    duration === 20 ? ["intro", "predict", "bid", "observe", "explain"] :
      ["intro", "predict", "bid", "observe", "explain", "compare", "notebook"];
  return <main id="main" tabIndex={-1} className="container app-page app-inner education-teacher">
    <a href={caseHref(course.case_id)}>返回案例资料</a>
    <h1>{course.title}教学活动</h1>
    <div className="toolbar education-no-print">
      <label>展示时长 <select value={duration} onChange={event => setDuration(Number(event.target.value))}>
        {durations.map(value => <option key={value} value={value}>{value} 分钟</option>)}</select></label>
      <a className="app-button" href={`/learn/${course.case_id}?demo=1`}>打开隔离展示课堂</a>
      <button onClick={() => window.print()}>打印活动页</button>
      {(caseId === "svb_run" || caseId === "flash_crash") && <a href="/practice?review=svb-flash">复核跨课作答</a>}
      <button onClick={() => void (async () => {
        try {
          const preset = await api(`/cases/${course.case_id}/presets`);
          const { downloadJson } = await import("../contracts");
          downloadJson(`${course.case_id}-教学预设.json`, preset);
        } catch { setError(true); }
      })()}>导出教学预设</button>
    </div>
    {error && <p role="alert">暂时无法读取课程材料，可回案例页重试。</p>}
    <h2>学习目标</h2><ul>{(coursePack?.outcomes.map(row => row.performance) ?? course.goals).map(goal => <li key={goal}>{goal}</li>)}</ul>
    <h2>{duration} 分钟展示安排</h2>
    <ol>{scenes?.scenes.filter(scene => targetPhase.includes(scene.id)).map(scene => <li key={scene.id}>
      <h3>{scene.title}</h3><p>{scene.question}</p>
      {scene.id === "observe" && <p>暂停在第一个可用观察点，请学生复述当时可见信息。</p>}
    </li>)}</ol>
    {worked && <details className="education-no-print"><summary>独立练习参考解</summary><p>{worked.text}</p></details>}
    <h2>资料与数据身份</h2>
    <p>{course.identity_label} · 课件 {coursePack?.content_version ?? course.version}</p>
    <ul>{course.sources.map(source => <li key={source.id}>{source.title} · {source.supports}</li>)}</ul>
  </main>;
}
