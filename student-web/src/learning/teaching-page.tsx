import { useEffect, useState } from "react";
import { catalog, caseHref } from "../catalog";
import { api, downloadJson } from "../contracts";
import { exploreLessonHref } from "../../../content/student-navigation";
import type { LearningPackage } from "./education-types";
import type { SceneContent } from "./flagship-types";
import "./education.css";

type Presets = {
  case_id: string;
  case_version: string;
  seed: number;
  provider_kind: "rule";
  student_choice: { bid: number } | { action: string };
  presets: { id: string; label: string }[];
};

const durations = [10, 20, 40] as const;

export function TeachingPage({ caseId }: { caseId: string }) {
  const course = catalog.find(row => row.case_id === caseId) ?? catalog[0];
  const [duration, setDuration] = useState<number>(20);
  const [coursePack, setCoursePack] = useState<LearningPackage>();
  const [scenes, setScenes] = useState<SceneContent>();
  const [error, setError] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
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
  const agenda = scenes?.scenes.filter(scene => targetPhase.includes(scene.id));
  async function exportPreset() {
    if (!agenda) return;
    setStatus("");
    setBusy(true);
    try {
      const preset = await api<Presets>(`/cases/${course.case_id}/presets`);
      if (preset.case_id !== course.case_id || preset.case_version !== course.version ||
          preset.provider_kind !== "rule" || preset.seed !== course.seed || !Array.isArray(preset.presets)) {
        throw new Error("Preset identity mismatch");
      }
      downloadJson(`${course.case_id}-教学预设.json`, { ...preset,
        classroom: { duration_minutes: duration, phases: agenda.map(scene => scene.id),
          display_href: `/learn/${course.case_id}?demo=1`, solution_initially_hidden: true } });
      setStatus("已导出课堂预设。");
    } catch {
      setStatus("暂时无法生成预设。请刷新课件后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <main id="main" tabIndex={-1} className="container app-page app-inner education-teacher">
    <a href={caseHref(course.case_id)}>返回案例资料</a>
    <h1>{course.title}教学活动</h1>
    <form action="/teach" method="get" className="toolbar education-no-print" aria-label="切换教学案例">
      <label>教学案例 <select name="case" defaultValue={course.case_id}>
        {catalog.map(item => <option key={item.case_id} value={item.case_id}>{item.title}</option>)}</select></label>
      <button type="submit">打开教学案例</button>
    </form>
    <div className="toolbar education-no-print">
      <label>展示时长 <select value={duration} onChange={event => setDuration(Number(event.target.value))}>
        {durations.map(value => <option key={value} value={value}>{value} 分钟</option>)}</select></label>
      <a className="app-button" href={`/learn/${course.case_id}?demo=1`}>打开隔离展示课堂</a>
      <button onClick={() => window.print()}>打印活动页</button>
      <a href={`${exploreLessonHref(course.case_id)}&view=teacher-work`}>查看学生解释作品</a>
      {(course.case_id === "svb_run" || course.case_id === "flash_crash") && <a href="/practice?review=svb-flash">复核跨课作答</a>}
      <button type="button" disabled={busy || !agenda} onClick={() => void exportPreset()}>导出教学预设</button>
    </div>
    <p role="status">{status}</p>
    {error && <p role="alert">暂时无法读取课程材料，可回案例页重试。</p>}
    <h2>学习目标</h2><ul>{(coursePack?.outcomes.map(row => row.performance) ?? course.goals).map(goal => <li key={goal}>{goal}</li>)}</ul>
    <h2>{duration} 分钟展示安排</h2>
    <ol>{agenda?.map(scene => <li key={scene.id}>
      <h3>{scene.title}</h3><p>{scene.question}</p>
      {scene.id === "observe" && <p>暂停在第一个可用观察点，请学生复述当时可见信息。</p>}
    </li>)}</ol>
    {worked && <section className="education-no-print">
      <button type="button" aria-expanded={revealed} aria-controls="teacher-example"
        onClick={() => setRevealed(value => !value)}>{revealed ? "收起示范解" : "揭示示范解"}</button>
      <div id="teacher-example" hidden={!revealed}>{revealed && <p>{worked.text}</p>}</div>
    </section>}
    <h2>资料与数据身份</h2>
    <p>{course.identity_label} · 课件 {coursePack?.content_version ?? course.version}</p>
    <ul>{course.sources.map(source => <li key={source.id}>{source.title} · {source.supports}</li>)}</ul>
  </main>;
}
