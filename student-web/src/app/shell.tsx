import "./app.css";
import { studentBrand, studentRoutes } from "../../../content/student-navigation";

export function AppHeader({ resetLesson, modelCaseId }: { resetLesson?: () => void; modelCaseId?: string }) {
  const path = location.pathname;
  const modelHref = modelCaseId ? `/?${new URLSearchParams({ case: modelCaseId, view: "model" })}` : "/experiments";
  return <header className="topbar app-topbar">
    <a className="app-skip-link" href="#main" onClick={event => {
      const main = document.getElementById("main");
      if (!main) return;
      event.preventDefault();
      main.focus();
    }}>跳到主要内容</a>
    <div className="container app-bar">
      {resetLesson ? <button type="button" className="brand" onClick={resetLesson}>
        <span className="brand-mark" aria-hidden="true"/>Civitas <em>Economica</em>
      </button> : <a className="app-brand" href={studentRoutes.home}>
        <span className="brand-mark" aria-hidden="true"/>{studentBrand}
      </a>}
      <nav aria-label="主导航" className="app-nav">
        {resetLesson && <a href="/">首页</a>}
        <a href="/cases" aria-current={path === "/cases" ? "page" : undefined}>案例库</a>
        <a href="/paths" aria-current={path === "/paths" ? "page" : undefined}>学习路径</a>
        <a href={studentRoutes.notes} aria-current={path === studentRoutes.notes ? "page" : undefined}>实验笔记</a>
        <a href={modelHref} aria-current={path === "/experiments" ? "page" : undefined}>模型实验</a>
        {!resetLesson && <a href={studentRoutes.explore}>渐进课堂</a>}
      </nav>
    </div>
  </header>;
}
