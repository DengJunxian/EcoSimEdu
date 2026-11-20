import { lazy, Suspense, useEffect, useState } from "react";
import { courseLink, latestProgress, stageNames } from "./learning-store.ts";
import { flowQuery, flowSteps, hasLessonFlow } from "./learning/lesson-flow.ts";
import { classroomHref } from "./classroom-routes.ts";
import { concepts, courseById, pathways, type Course } from "./curriculum.ts";
import { StudentHeader } from "./StudentHeader.tsx";
import { originalLessonHref } from "../../content/student-navigation.ts";
import { CaseCard, PageTitle } from "../../content/student-ui.tsx";
import { StudyAIStart } from "./app/onboarding/StudyAI.tsx";
import { localStudyAI, pagesDemo } from "./deployment.ts";
import "./course-map.css";

const HomeStudyActions = lazy(() => import("./ProgressiveLearning.tsx").then(module => ({ default: module.HomeStudyActions })));

function StartingPoint() {
  const opening = pathways[0].courses[0];
  const readLatest = () => {
    try { return latestProgress(localStorage, id => Object.hasOwn(courseById, id)); }
    catch { return undefined; }
  };
  const [progress, setProgress] = useState(readLatest);
  useEffect(() => {
    const update = () => setProgress(readLatest());
    window.addEventListener("pageshow", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("pageshow", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const course = progress ? courseById[progress.course.caseId] : undefined;
  return <section className="map-intro">
    <PageTitle description="用一笔报价、一份提款申请或一次搬家，追查个人选择怎样改变集体结果。">个人选择，<br/>怎样改变市场？</PageTitle>
    <div className="map-start">
      {progress && course ? <div>
        <h2>继续上次学习</h2>
        <p>{course.title}{progress.course.market && " · 供需无交叠"} · {progress.flow ? flowSteps[progress.flow.chapter] : stageNames[progress.stage - 1]}</p>
        <a className="map-action primary" href={courseLink(progress.course, progress.flow ? flowQuery : undefined)}>继续上次学习</a>
      </div> : <div>
        <h2>{opening.question}</h2>
        <p>给二手教材报一个限价，然后用买单和卖单核对成交。</p>
        <a className="map-action primary" href={classroomHref(opening.id)}>从双向拍卖开始</a>
      </div>}
      <svg className="trade-diagram" viewBox="0 0 170 124" aria-hidden="true">
        <path d="M25 33h38a27 27 0 0 1 27 27v3" fill="none" stroke="#f4c16a" strokeWidth="3"/>
        <path d="M145 92h-28a27 27 0 0 1-27-27v-4" fill="none" stroke="#a2d3bd" strokeWidth="3"/>
        <circle cx="25" cy="33" r="5" fill="#f4c16a"/>
        <circle cx="145" cy="92" r="5" fill="#a2d3bd"/>
        <circle cx="90" cy="62" r="8" fill="#f8f5ed" stroke="#103b35" strokeWidth="2"/>
        <text x="11" y="19" fill="#edf4ec" fontSize="12">买单</text>
        <text x="133" y="115" fill="#edf4ec" fontSize="12">卖单</text>
        <text x="104" y="55" fill="#edf4ec" fontSize="12">成交</text>
      </svg>
    </div>
  </section>;
}

function CourseRow({ course }: { course: Course }) {
  return <li>
    <CaseCard className="map-course" level="h4" title={course.question} label={course.title} id={`lesson-${course.id}`}>
      <div className="course-main">
        <p className="course-name">{course.title}</p>
        {course.after && <p className="course-before">
          <span>{course.after.length > 1 ? "建议先任选其一" : "建议先学"}</span>
          {course.after.map(id => <a key={id} href={`#lesson-${id}`}>{courseById[id].title}</a>)}
        </p>}
        <details className="course-concepts">
          <summary>先理解 {course.concepts.map(id => concepts[id].label).join("、")}</summary>
          <dl>{course.concepts.map(id => <div key={id}>
            <dt>{concepts[id].label}</dt>
            <dd>{concepts[id].definition}</dd>
          </div>)}</dl>
        </details>
      </div>
      <div className="course-entry">
        {hasLessonFlow(course.id) && <a className="map-action primary" href={courseLink({ caseId: course.id }, flowQuery)}
          aria-label={`八阶段自学 · ${course.title}`}>八阶段自学</a>}
        <a className="map-action" href={classroomHref(course.id)} aria-label={`打开四阶课堂 · ${course.title}`}>
          打开四阶课堂
        </a>
        {!pagesDemo && <a href={originalLessonHref(course.id)} className="original-course">原课堂与进度</a>}
      </div>
    </CaseCard>
  </li>;
}

export function CourseMap() {
  return <>
    <StudentHeader/>
    <main className="shell course-map" id="main" tabIndex={-1}>
      <StartingPoint/>
      {localStudyAI && <StudyAIStart/>}
      {pagesDemo && <p>这是十二门规则课的公开演示。学习进度保存在当前浏览器，正式学习档案、原课堂与模型实验可在本机版使用。</p>}
      <Suspense fallback={null}><HomeStudyActions/></Suspense>
      <section className="map-paths" aria-labelledby="paths">
        <div className="paths-heading">
          <h2 id="paths" tabIndex={-1}>学习路径</h2>
          {!pagesDemo && <a href="/cases">查看全部案例</a>}
        </div>
        <nav className="path-jumps" aria-label="跳到一条学习路径">
          {pathways.map(path => <a key={path.id} href={`#${path.id}`}>{path.title}</a>)}
        </nav>
        {pathways.map(path => <section key={path.id} id={path.id} className="map-path"
          aria-labelledby={`title-${path.id}`}>
          <div className="path-intro">
            <h3 id={`title-${path.id}`}>{path.title}</h3>
            <p>{path.summary}</p>
          </div>
          <ol className="map-courses">
            {path.courses.map(course => <CourseRow key={course.id} course={course}/>)}
          </ol>
        </section>)}
      </section>
    </main>
  </>;
}
