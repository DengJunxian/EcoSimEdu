import { studentBrand, studentRoutes, originalLessonHref } from "../../content/student-navigation.ts";
import { notesLink } from "./learning-store.ts";

export function StudentHeader({ caseId }: { caseId?: string }) {
  return <>
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="site-header">
      <div className="shell">
        <a className="brand" href="./">{studentBrand}</a>
        <nav aria-label="主导航">
          <a href="./#paths">学习路径</a>
          <a href={notesLink()}>实验笔记</a>
          <a href={studentRoutes.review}>复习</a>
          {caseId ? <a href={originalLessonHref(caseId)}>原课堂与进度</a> :
            <a href={studentRoutes.model}>配置模型 API</a>}
        </nav>
      </div>
    </header>
  </>;
}
