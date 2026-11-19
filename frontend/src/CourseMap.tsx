import { useEffect, useState } from "react";
import { courseLink, latestProgress, notesLink, stageNames } from "./learning-store.ts";
import { classroomHref, hasClassroom } from "./classroom-routes.ts";
import { concepts, courseById, pathways, type Course } from "./curriculum.ts";
import "./course-map.css";

function StartingPoint({ legacyOrigin }: { legacyOrigin: string }) {
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
    <div>
      <h1>从一笔交易，<br/>看见经济系统</h1>
      <p>先做一个角色的决定，再沿着真实运行的事件，追到价格、资源与群体结果怎样变化。</p>
    </div>
    <div className="map-start">
      {progress && course ? <div>
        <h2>继续上次学习</h2>
        <p>{course.title}{progress.course.market && " · 供需无交叠"} · {stageNames[progress.stage - 1]}</p>
        <a className="map-action primary" href={courseLink(progress.course)}>继续上次学习</a>
      </div> : <div>
        <h2>报出你的第一个价格</h2>
        <p>你想买一本二手教材。报出限价，看看哪两张订单成交，哪张订单决定了价格。</p>
        <a className="map-action primary" href={classroomHref(opening.id, legacyOrigin)}>从双向拍卖开始</a>
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

function CourseRow({ course, legacyOrigin }: { course: Course; legacyOrigin: string }) {
  const native = hasClassroom(course.id);
  return <li>
    <article className="map-course" id={`lesson-${course.id}`} aria-labelledby={`title-${course.id}`}>
      <div className="course-main">
        <h4 id={`title-${course.id}`}>{course.title}</h4>
        <p>{course.question}</p>
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
        <a className="map-action" href={classroomHref(course.id, legacyOrigin)}
          aria-label={`${native ? "打开四阶课堂" : "打开现有课堂"} · ${course.title}`}>
          {native ? "打开四阶课堂" : "打开现有课堂"}
        </a>
        {native && <a href={`${legacyOrigin}/learn/${course.id}`} className="original-course">原课堂与进度</a>}
      </div>
    </article>
  </li>;
}

export function CourseMap({ legacyOrigin }: { legacyOrigin: string }) {
  return <>
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="site-header map-header">
      <div className="shell">
        <a className="brand" href="./">EcoSimEdu</a>
        <nav aria-label="站点导航">
          <a href="#paths">学习路径</a>
          <a href={notesLink()}>实验笔记</a>
          <a href={`${legacyOrigin}/#model-api`}>配置模型 API</a>
        </nav>
      </div>
    </header>
    <main className="shell course-map" id="main" tabIndex={-1}>
      <StartingPoint legacyOrigin={legacyOrigin}/>
      <section className="map-paths" aria-labelledby="paths">
        <div className="paths-heading">
          <h2 id="paths" tabIndex={-1}>学习路径</h2>
          <p>四条路径覆盖十二课。先看课前概念，再按建议顺序选择下一课。</p>
        </div>
        <nav className="path-jumps" aria-label="跳到一条学习路径">
          {pathways.map(path => <a key={path.id} href={`#${path.id}`}>{path.title}</a>)}
        </nav>
        {pathways.map((path, index) => <section key={path.id} id={path.id} className="map-path"
          aria-labelledby={`title-${path.id}`}>
          <div className="path-intro">
            <span className="path-number">模块 {index + 1}</span>
            <h3 id={`title-${path.id}`}>{path.title}</h3>
            <p>{path.summary}</p>
          </div>
          <ol className="map-courses">
            {path.courses.map(course => <CourseRow key={course.id} course={course} legacyOrigin={legacyOrigin}/>)}
          </ol>
        </section>)}
      </section>
    </main>
  </>;
}
