import { lazy, Suspense, useEffect, useState } from "react";
import { RestoreStudy } from "../learning/restore-study";
import { FlagshipNotes } from "../learning/flagship-notes";
import { readFieldStudy } from "../learning/flagship-study";
import { fieldFlagships, isFieldFlagship } from "../learning/flagship-types";
import courseFiles from "virtual:course-files";
import auctionScenes from "../../../cases/double_auction/lesson-v2.json";
import { caseHref, catalog, legacyCourseHref, paths, pathPreferenceKey, preferredPath, type CatalogCourse } from "../catalog";
import { downloadJson, traceHref } from "../contracts";
import { noteKeys, noteNames, type Course } from "../lesson-types";
import { readExperiments, readFavorites, toggleCourseFavorite } from "../lab-tools";
import { BoundaryLink } from "../boundary";
import { readAuctionStudy } from "../cases/auction/auction-study";
import { AuctionNotes } from "../cases/auction/auction-notes";
import { Mechanism, QuoteDiagram } from "./mechanisms";
import { LocalModelSettings } from "./local-model";
import type { Outcome } from "../learning/education-types";

const HomeLearningActions = lazy(() => import("../learning/review-page").then(module => ({ default: module.HomeLearningActions })));
const LearningRecords = lazy(() => import("../learning/learning-records").then(module => ({ default: module.LearningRecords })));

const auction = catalog[0];
const auctionHref = "/learn/double_auction";
const fieldContent = courseFiles.scenes;
const featured = ["double_auction", "schelling_segregation", "svb_run", "public_goods", "information_cascade", "carbon_market"];
const introductory = new Set(["double_auction", "schelling_segregation", "public_goods", "lemons_market", "information_cascade"]);
const level = (course: CatalogCourse) => introductory.has(course.case_id) ? "入门" : "进阶";
const metadata = (course: CatalogCourse) => [course.identity_label, level(course), course.minutes].join(" · ");
const action = (course: CatalogCourse) => course.lessons.find(lesson => lesson.id === "bid")!.prompt;

function listProgress() {
  const savedAuction = readAuctionStudy();
  const currentAuction = savedAuction &&
    (savedAuction.unlocked > 0 || savedAuction.runs.baseline || Object.keys(savedAuction.responses).length)
    ? savedAuction : null;
  const fieldReads = fieldFlagships.map(caseId => readFieldStudy(caseId));
  const fields = fieldReads.flatMap(({ study }) => study && study.updatedAt ? [study] : [])
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const invalidFields = fieldReads.filter(entry => entry.bad).length;
  try {
    const experiments = readExperiments();
    return { ...experiments, invalid: experiments.invalid + invalidFields, fields, currentAuction, unavailable: false };
  } catch {
    return { entries: [], invalid: invalidFields, fields, currentAuction, unavailable: true };
  }
}

function useLocalProgress(onChange?: number) {
  const [local, setLocal] = useState(listProgress);
  useEffect(() => {
    function refresh(event: PageTransitionEvent) {
      if (event.persisted) setLocal(listProgress());
    }
    window.addEventListener("pageshow", refresh);
    return () => window.removeEventListener("pageshow", refresh);
  }, []);
  useEffect(() => setLocal(listProgress()), [onChange]);
  return local;
}

function Cards({ courses, Heading = "h3" }: { courses: CatalogCourse[]; Heading?: "h2" | "h3" }) {
  return <ul className="app-card-grid">
    {courses.map(course => <li key={course.case_id}>
      <a className="app-case-card" href={caseHref(course.case_id)}>
        <Mechanism caseId={course.case_id}/>
        <div>
          <p className="app-case-name">{course.title}</p>
          <Heading>{course.subtitle}</Heading>
          <p className="app-case-action">{action(course)}</p>
        </div>
        <p className="app-meta">{metadata(course)}</p>
      </a>
    </li>)}
  </ul>;
}

export function HomePage() {
  const local = useLocalProgress();
  const legacy = local.entries.find(({ study }) => !study.complete);
  const lastField = local.fields[0];
  const resume = lastField && lastField.updatedAt > (local.currentAuction?.updatedAt ?? 0) ? {
    title: catalog.find(course => course.case_id === lastField.case_id)?.title,
    scene: fieldContent[lastField.case_id].scenes[lastField.stage].title,
    href: `/learn/${lastField.case_id}`,
  } : local.currentAuction ? {
    title: "双向拍卖",
    scene: auctionScenes.scenes.find(scene => scene.id === local.currentAuction?.scene)?.title,
    href: auctionHref,
  } : legacy && {
    title: legacy.course.title,
    scene: legacy.course.lessons[legacy.study.stage].title,
    href: legacyCourseHref(legacy.course.case_id),
  };
  return <main id="main" tabIndex={-1} className="container app-page">
    <section className="app-home-hero">
      <div>
        <h1>从一次选择，<br/>看见经济系统</h1>
        <p>报出一个价格，决定何时提款，或在地图上搬一次家。先做预测，再从仿真记录里追查你的选择如何进入群体结果。</p>
        <div className="app-actions">
          <a className="app-button" href={auctionHref}>进入双向拍卖</a>
          <a href="/emergence">从微观到宏观</a>
          <a href="/paths">查看学习路径</a>
        </div>
      </div>
      <QuoteDiagram/>
    </section>
    <LocalModelSettings/>
    {resume && <section className="app-resume">
      <div><h2>继续学习</h2><p>{resume.title} · {resume.scene}</p></div>
      <a className="app-button" href={resume.href}>回到课堂</a>
    </section>}
    <Suspense fallback={null}><HomeLearningActions/></Suspense>
    <section className="app-featured">
      <div className="app-section-line"><h2>选一个你想弄懂的问题</h2><a href="/cases">全部 {catalog.length} 门案例</a></div>
      <Cards courses={featured.map(id => catalog.find(course => course.case_id === id)!)}/>
    </section>
    <footer><span>Civitas Economica</span><span>互动经济学 · 本地离线学习</span></footer>
  </main>;
}

export function CasesPage() {
  const [query, setQuery] = useState("");
  const [path, setPath] = useState(() => {
    const requested = new URLSearchParams(location.search).get("path");
    return paths.find(item => item.title === requested)?.title ?? "";
  });
  const [difficulty, setDifficulty] = useState("");
  const [identity, setIdentity] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const inPath = paths.find(item => item.title === path)?.cases;
  const visible = catalog.filter(course =>
    (!inPath || inPath.includes(course.case_id)) &&
    (!difficulty || level(course) === difficulty) &&
    (!identity || course.identity_label === identity) &&
    [course.title, course.subtitle, action(course), ...course.glossary.map(item => item.term)]
      .some(part => part.toLocaleLowerCase().includes(search)));
  return <main id="main" tabIndex={-1} className="container app-page app-inner">
    <h1>案例库</h1>
    <div className="app-filters">
      <label>搜索课程<input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="app-filter"><label htmlFor="case-path">学习路径</label><select id="case-path" value={path} onChange={event => setPath(event.target.value)}>
        <option value="">全部路径</option>
        {paths.map(item => <option key={item.title}>{item.title}</option>)}
      </select></div>
      <div className="app-filter"><label htmlFor="case-level">难度</label><select id="case-level" value={difficulty} onChange={event => setDifficulty(event.target.value)}>
        <option value="">全部难度</option><option>入门</option><option>进阶</option>
      </select></div>
      <div className="app-filter"><label htmlFor="case-identity">材料类型</label><select id="case-identity" value={identity} onChange={event => setIdentity(event.target.value)}>
        <option value="">全部类型</option>
        {[...new Set(catalog.map(course => course.identity_label))].map(label => <option key={label}>{label}</option>)}
      </select></div>
    </div>
    <p className="app-meta" role="status">{visible.length ? `${visible.length} 门案例` : "没有符合条件的案例。"}</p>
    <Cards courses={visible} Heading="h2"/>
  </main>;
}

export function CasePage({ course }: { course: CatalogCourse }) {
  const local = useLocalProgress();
  const resume = local.entries.find(entry => entry.course.case_id === course.case_id);
  const isAuction = course.case_id === auction.case_id;
  const hasNewClass = isAuction || isFieldFlagship(course.case_id);
  const [outcomes, setOutcomes] = useState<Outcome[]>();
  useEffect(() => {
    void import("../../../cases/learning-outcomes.json").then(({ default: { cases } }) => {
      setOutcomes((cases as Record<string, Outcome[]>)[course.case_id]);
    }).catch(() => setOutcomes(undefined));
  }, [course.case_id]);
  const newProgress = isAuction ? local.currentAuction : local.fields.find(item => item.case_id === course.case_id);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return readFavorites(); } catch { return []; }
  });
  const [favoriteError, setFavoriteError] = useState("");
  const favorite = favorites.includes(course.case_id);
  return <main id="main" tabIndex={-1} className="container app-page app-inner">
    <a href="/cases">返回案例库</a>
    <section className="app-case-brief">
      <div>
        <h1>{course.subtitle}</h1>
        <p className="app-case-name">{course.title} · {metadata(course)}</p>
        <p>{course.intro}</p>
        <p><strong>你的选择</strong><br/>{action(course)}</p>
        <div className="app-actions">
          <a className="app-button" href={hasNewClass ? `/learn/${course.case_id}` : legacyCourseHref(course.case_id)}>
            {(hasNewClass ? newProgress : resume) ? "继续学习" : "进入课堂"}
          </a>
          <button type="button" aria-pressed={favorite} onClick={() => {
            try { setFavorites(toggleCourseFavorite(course.case_id)); setFavoriteError(""); }
            catch { setFavoriteError("收藏暂时无法保存。"); }
          }}>{favorite ? "取消收藏" : "收藏案例"}</button>
          {hasNewClass && <a href={`/teach?case=${encodeURIComponent(course.case_id)}`}>教学活动页</a>}
          {hasNewClass && <a href={legacyCourseHref(course.case_id)}>{resume ? "继续原版课堂" : "打开原版课堂"}</a>}
        </div>
        {favoriteError && <p role="alert">{favoriteError}</p>}
      </div>
      <Mechanism caseId={course.case_id}/>
    </section>
    <section className="app-case-context">
      <h2>学完能做什么</h2>
      <ul>{(outcomes?.map(outcome => outcome.performance) ?? course.goals).map(goal => <li key={goal}>{goal}</li>)}</ul>
      <p>带走一份含预测、观察和运行引用的实验笔记。</p>
      <a href="#course-concepts" onClick={() => {
        const details = document.querySelector<HTMLDetailsElement>("#course-concepts");
        if (details) details.open = true;
      }}>自查课前概念</a>
    </section>
    <section className="app-case-context">
      <h2>实验背景</h2><p>{course.background}</p>
      <details id="course-concepts"><summary>来源与概念</summary>
        <ul>{course.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> · {source.supports}</li>)}</ul>
        <dl>{course.glossary.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.definition}</dd></div>)}</dl>
      </details>
      <div className="toolbar"><BoundaryLink caseId={course.case_id}/>
        <a href={`/compare?case=${encodeURIComponent(course.case_id)}`}>自定义参数对照</a></div>
    </section>
  </main>;
}

export function PathsPage() {
  const [selected, setSelected] = useState(() => preferredPath()?.title ?? "");
  const [error, setError] = useState("");
  return <main id="main" tabIndex={-1} className="container app-page app-inner">
    <h1>学习路径</h1>
    <p><a href="/emergence">按机制浏览十二课</a></p>
    <p>按建议顺序学习，也可直接选择一门课。</p>
    <label>首页推荐路径 <select aria-label="首页推荐路径" value={selected} onChange={event => {
      const value = event.target.value;
      try { localStorage.setItem(pathPreferenceKey, value); setSelected(value); setError(""); }
      catch { setError("路径暂时无法保存。仍可直接打开课程。"); }
    }}><option value="">按最近练习推荐</option>
      {paths.map(path => <option key={path.title} value={path.title}>{path.title}</option>)}
    </select></label>
    {error && <p role="alert">{error}</p>}
    <div className="toolbar"><a href="/concepts">浏览概念</a><a href="/review">复习</a><a href="/practice">跨课练习</a></div>
    <div className="app-path-list">
      {paths.map(path => <section key={path.title}>
        <div className="app-section-line"><h2>{path.title}</h2><a href={`/cases?${new URLSearchParams({ path: path.title })}`}>筛选此路径</a></div>
        <p>{path.learning_goal}</p>
        <a href={`/concepts/${path.bridge_concept}`}>先做概念自查</a>
        <ul>{path.cases.map(id => {
          const course = catalog.find(item => item.case_id === id)!;
          return <li key={id}><a href={caseHref(id)}>{course.title}</a><span>{course.subtitle}</span></li>;
        })}</ul>
      </section>)}
    </div>
  </main>;
}

export function NotesPage() {
  const [restored, setRestored] = useState(0);
  const local = useLocalProgress(restored);
  return <main id="main" tabIndex={-1} className="container app-page app-inner">
    <h1>实验笔记</h1>
    <div className="toolbar"><a href="/review">复习</a><a href="/concepts">按概念查看</a></div>
    <Suspense fallback={null}><LearningRecords/></Suspense>
    <RestoreStudy courseFor={caseId => catalog.find(course => course.case_id === caseId) as Course}
      contentFor={caseId => fieldContent[caseId]}
      onRestore={() => setRestored(count => count + 1)}/>
    {local.unavailable && <p className="error" role="alert">无法读取本机笔记。请检查浏览器的存储设置。</p>}
    {local.invalid > 0 && <p className="callout" role="status">
      {local.invalid} 门案例的本机记录无法读取。可在对应课堂重新导入备份。
    </p>}
    {!local.entries.length && !local.currentAuction && !local.fields.length && !local.unavailable && <section className="app-empty">
      <h2>此浏览器还没有已开始的案例</h2><a href="/cases">去案例库选课</a>
    </section>}
    <div className="app-notes">
      {local.currentAuction && <AuctionNotes value={local.currentAuction}/>}
      {local.fields.map(study => <FlagshipNotes key={study.case_id} study={study} content={fieldContent[study.case_id]}
        title={catalog.find(course => course.case_id === study.case_id)!.title}/>)}
      {local.entries.map(({ course, study }) => <section key={course.case_id}>
        <div className="app-section-line">
          <h2><a href={legacyCourseHref(course.case_id)}>{course.title}</a></h2>
          <button onClick={() => downloadJson(`${course.case_id}-实验笔记.json`, study)}>导出学习记录</button>
        </div>
        <p className="app-meta">{study.complete ? "已完成" : `进行中 · ${course.lessons[study.stage].title}`}</p>
        {noteKeys.some(key => study.notes[key].trim()) && <dl>{noteKeys.map(key =>
          study.notes[key].trim() && <div key={key}><dt>{noteNames[key]}</dt><dd>{study.notes[key]}</dd></div>)}</dl>}
        {Object.values(study.runs).length > 0 && <ul aria-label={`${course.title}的本机运行`}>
          {course.scenarios.map(scenario => {
            const runId = (study.runs as Partial<Record<string, string>>)[scenario.id];
            return runId && <li key={scenario.id}><a href={traceHref(course.case_id, runId, study.selections[runId]?.tick ?? 0)}>{scenario.label}</a></li>;
          })}
        </ul>}
      </section>)}
    </div>
  </main>;
}
