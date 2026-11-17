import { useEffect, useState } from "react";
import { catalog } from "./catalog";
import { api } from "./contracts";
import type { Course } from "./lesson-types";
import { LivePanel, type LiveCapability } from "./live-panel";

export function ModelLab({ caseId }: { caseId: string }) {
  const [status, setStatus] = useState<LiveCapability>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get("model_case") ?? caseId);
  const [choice, setChoice] = useState("");
  const courses = (catalog as Course[]).filter(course => status?.cases.includes(course.case_id));
  const course = courses.find(course => course.case_id === selected) ?? courses[0];
  const action = choice || course?.action.default;
  const returnHref = caseId === catalog[0].case_id ? "/" : `/?case=${encodeURIComponent(caseId)}`;

  useEffect(() => {
    let active = true;
    api<LiveCapability>("/live").then(result => {
      if (active) setStatus(result);
    }).catch(() => { if (active) setError("无法读取模型服务状态。请确认本地实验室已启动。"); });
    return () => { active = false; };
  }, [revision]);

  return <>
    <header className="topbar"><div className="container brand-bar">
      <a className="brand brand-link" href="/"><span className="brand-mark" aria-hidden="true"/>Civitas <em>Economica</em></a>
      <a className="topbar-link" href={returnHref}>返回课程</a>
    </div></header>
    <main className="container course-home model-lab">
      <h1>模型实验</h1>
      <p>选择案例和学生行动，观察模型为一名模拟角色作出的决策。运行后可对照本地规则的期末结果。</p>
      {error && <div role="alert"><p>{error}</p><button onClick={() => {
        setError(""); setRevision(revision + 1);
      }}>重试</button></div>}
      {!status && !error && <p role="status">正在读取模型服务状态…</p>}
      {status && !course && <p>当前服务没有开放模型实验。</p>}
      {course && status && <section className="model-settings" aria-label="实验设置">
        <div className="lab-filters model-controls">
          <label>案例<select value={course.case_id} onChange={event => {
            const selectedCase = event.target.value;
            const url = new URL(location.href);
            url.searchParams.set("model_case", selectedCase);
            history.replaceState(null, "", url);
            setSelected(selectedCase);
            setChoice("");
          }}>
            {courses.map(item => <option key={item.case_id} value={item.case_id}>{item.title}</option>)}
          </select></label>
          <label>{course.action.label}<select value={action} onChange={event => setChoice(event.target.value)}>
            {course.action.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select></label>
        </div>
        <LivePanel key={course.case_id} caseId={course.case_id} seed={course.seed} action={action} status={status}
          actionLabel={value => course.action.options.find(option => option.id === value)?.label ?? value}/>
      </section>}
    </main>
  </>;
}
