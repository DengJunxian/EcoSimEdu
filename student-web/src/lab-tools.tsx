import { useId, useState } from "react";
import curriculum from "../../docs/curriculum/knowledge-map.json";
import { catalog, legacyCourseHref } from "./catalog";
import { api, downloadJson, traceHref } from "./contracts";
import { checkStudy, storageKey, type Course } from "./lesson-types";
import { validateStudy } from "./study";
import "./lab-tools.css";

const courses = catalog as Course[];
const favoriteKey = "civitas/lab/favorites";
const teacherKey = "civitas/lab/teacher";
const views = ["案例库", "我的实验", "收藏", "概念", "设置与帮助"] as const;
type View = typeof views[number];
type PresetExport = {
  case_id: string; case_version: string; provider_kind: "rule"; seed: number;
  student_choice: { bid: number } | { action: string };
  presets: { id: string; label: string }[];
};

function readFavorites(): string[] {
  const raw: unknown = JSON.parse(localStorage.getItem(favoriteKey) ?? "[]");
  return Array.isArray(raw)
    ? courses.filter(course => raw.includes(course.case_id)).map(course => course.case_id)
    : [];
}

export function teacherEnabled() {
  try {
    return localStorage.getItem(teacherKey) === "true";
  } catch {
    return false;
  }
}

export function readExperiments() {
  const entries = [];
  let invalid = 0;
  for (const course of courses) {
    const saved = localStorage.getItem(storageKey(course));
    if (saved === null) continue;
    try {
      const raw: unknown = JSON.parse(saved);
      const study = course.case_id === "double_auction" ? validateStudy(raw) : checkStudy(course, raw);
      if (study.unlocked || study.complete || Object.keys(study.runs).length) entries.push({ course, study });
    } catch {
      invalid += 1;
    }
  }
  return { entries, invalid };
}

function matches(query: string, ...parts: string[]) {
  return parts.some(part => part.toLocaleLowerCase().includes(query));
}

export function LabTools({ caseId }: { caseId: string }) {
  const pathSelectId = useId();
  const [view, setView] = useState<View>("案例库");
  const [query, setQuery] = useState("");
  const [conceptQuery, setConceptQuery] = useState("");
  const [pathFilter, setPathFilter] = useState("");
  const [experiments, setExperiments] = useState<ReturnType<typeof readExperiments>>({ entries: [], invalid: 0 });
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return readFavorites(); } catch { return []; }
  });
  const [teacher, setTeacher] = useState(teacherEnabled);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const current = courses.find(course => course.case_id === caseId);
  const search = query.trim().toLocaleLowerCase();
  const conceptSearch = conceptQuery.trim().toLocaleLowerCase();
  const paths = curriculum.paths.filter(path => !pathFilter || path.title === pathFilter).map(path => ({
    title: path.title,
    courses: courses.filter(course => path.cases.includes(course.case_id) &&
      matches(search, course.title, course.subtitle, ...course.glossary.map(concept => concept.term))),
  })).filter(path => path.courses.length);
  const concepts = courses.map(course => ({
    course,
    items: course.glossary.filter(concept => matches(conceptSearch, concept.term, concept.definition, course.title)),
  })).filter(group => group.items.length);

  function navigate(next: View) {
    setError("");
    setView(next);
    if (next === "我的实验") {
      try {
        setExperiments(readExperiments());
      } catch {
        setExperiments({ entries: [], invalid: 0 });
        setError("无法读取本机实验记录。请检查浏览器的存储设置。");
      }
    }
    if (next === "收藏") {
      try {
        setFavorites(readFavorites());
      } catch {
        setError("无法读取本机收藏。请检查浏览器的存储设置。");
      }
    }
  }

  function toggleFavorite(courseId: string) {
    setError("");
    try {
      const saved = readFavorites();
      const updated = saved.includes(courseId) ? saved.filter(id => id !== courseId) : [...saved, courseId];
      localStorage.setItem(favoriteKey, JSON.stringify(updated));
      setFavorites(updated);
    } catch {
      setError("无法保存收藏。请检查浏览器的存储设置。");
    }
  }

  function changeTeacher(enabled: boolean) {
    setError("");
    setExportStatus("");
    try {
      localStorage.setItem(teacherKey, String(enabled));
      setTeacher(enabled);
    } catch {
      setError("无法保存设置。请检查浏览器的存储设置。");
    }
  }

  async function exportPresets(course: Course) {
    setExportStatus("");
    setExporting(true);
    try {
      const result = await api<PresetExport>(`/cases/${encodeURIComponent(course.case_id)}/presets`);
      if (result.case_id !== course.case_id || result.case_version !== course.version ||
          result.provider_kind !== "rule" || result.seed !== course.seed || !Array.isArray(result.presets)) {
        throw new Error("预设与当前课程版本不一致。请刷新后重试。");
      }
      downloadJson(`${course.case_id}-${course.version}-实验预设.json`, result);
      setExportStatus("已下载实验预设。");
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : "无法导出实验预设。请重试。");
    } finally {
      setExporting(false);
    }
  }

  function courseRow(course: Course) {
    const saved = favorites.includes(course.case_id);
    return <li key={course.case_id} className="lab-course-row">
      <a href={legacyCourseHref(course.case_id)} aria-current={course.case_id === caseId ? "page" : undefined}>
        {course.title}
      </a>
      <button type="button" className="lab-favorite" aria-label={`收藏${course.title}`}
        aria-pressed={saved} onClick={() => toggleFavorite(course.case_id)}>
        <span aria-hidden="true">{saved ? "★" : "☆"}</span>
      </button>
    </li>;
  }

  return <section className="lab-tools" aria-label="实验室工具">
    <div className="lab-tool-nav" role="group" aria-label="选择工具">
      {views.map(item => <button key={item} type="button" aria-pressed={view === item}
        onClick={() => navigate(item)}>{item}</button>)}
    </div>
    {error && <p className="lab-message" role="alert">{error}</p>}

    {view === "案例库" && <>
      <div className="lab-filters">
        <label>搜索课程<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="lab-filter">
          <label htmlFor={pathSelectId}>学习路径</label>
          <select id={pathSelectId} value={pathFilter} onChange={event => setPathFilter(event.target.value)}>
            <option value="">全部路径</option>
            {curriculum.paths.map(path => <option key={path.title}>{path.title}</option>)}
          </select>
        </div>
      </div>
      <nav aria-label="课程目录" className="lab-paths">
        {paths.map(path => <section key={path.title}>
          <h2>{path.title}</h2>
          <ul>{path.courses.map(courseRow)}</ul>
        </section>)}
        {!paths.length && <p className="lab-message" role="status">没有符合条件的课程。</p>}
      </nav>
    </>}

    {view === "我的实验" && <div className="lab-experiments">
      {!experiments.entries.length && !error && <p className="lab-message">此浏览器还没有已开始的课程。</p>}
      {experiments.invalid > 0 && <p className="lab-message" role="status">
        {experiments.invalid} 门课程的本机记录无法读取。可回到课程导入已导出的笔记。
      </p>}
      {experiments.entries.map(({ course, study }) => <section key={course.case_id}>
        <h2><a href={legacyCourseHref(course.case_id)}>{course.title}</a></h2>
        <p>{study.complete ? "已完成" : `进行中 · ${course.lessons[study.stage || study.unlocked].title}`}</p>
        {Object.keys(study.runs).length > 0 && <ul aria-label={`${course.title}的本机运行`}>
          {course.scenarios.map(scenario => {
            const runId = (study.runs as Partial<Record<string, string>>)[scenario.id];
            if (!runId) return null;
            return <li key={scenario.id}><a href={traceHref(course.case_id, runId, study.selections[runId]?.tick ?? 0)}>
              {scenario.label}
            </a></li>;
          })}
        </ul>}
      </section>)}
    </div>}

    {view === "收藏" && (favorites.length
      ? <nav aria-label="收藏的课程"><ul className="lab-saved">{courses.filter(course =>
        favorites.includes(course.case_id)).map(courseRow)}</ul></nav>
      : <p className="lab-message">在案例库里点按星标即可收藏课程。</p>)}

    {view === "概念" && <>
      <div className="lab-filters">
        <label>搜索概念<input type="search" value={conceptQuery} onChange={event => setConceptQuery(event.target.value)} /></label>
      </div>
      <div className="lab-concepts">
        {concepts.map(({ course, items }) => <section key={course.case_id}>
          <h2><a href={legacyCourseHref(course.case_id)}>{course.title}</a></h2>
          <dl>{items.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.definition}</dd></div>)}</dl>
        </section>)}
        {!concepts.length && <p className="lab-message" role="status">没有找到匹配的概念。</p>}
      </div>
    </>}

    {view === "设置与帮助" && <div className="lab-settings">
      <label className="lab-teacher">
        <input type="checkbox" checked={teacher} onChange={event => changeTeacher(event.target.checked)} />教师模式
      </label>
      {teacher && current && <div className="lab-export">
        <button type="button" disabled={exporting} onClick={() => void exportPresets(current)}>
          {exporting ? "正在导出…" : "导出本课实验预设"}
        </button>
        {exportStatus && <p role="status">{exportStatus}</p>}
      </div>}
      <details>
        <summary>如何保留或接续实验？</summary>
        <p>同一浏览器可从「我的实验」返回课程。更换设备或清除浏览器数据前，可在课程笔记中导出学习记录。恢复时需同时保留本地服务中的对应运行记录。</p>
      </details>
      <details>
        <summary>离线课程和模型实验怎样使用？</summary>
        <p>打开本地服务即可使用离线课程。模型实验需要在服务端另行启用，课程内会显示可用状态。</p>
      </details>
    </div>}
  </section>;
}
