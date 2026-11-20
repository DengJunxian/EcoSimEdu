import { useEffect, useState } from "react";
import { studentBrand, studentRoutes, originalLessonHref } from "../../content/student-navigation.ts";
import { AppShell, Navigation, StatusNotice } from "../../content/student-ui.tsx";
import { notesLink } from "./learning-store.ts";
import { pagesDemo } from "./deployment.ts";

export function StudentHeader({ caseId }: { caseId?: string }) {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return <AppShell skipClass="skip-link" header={<header className="site-header">
      <div className="shell">
        <a className="brand" href="./">{studentBrand}</a>
        <Navigation>
          <a href="./#paths">学习路径</a>
          {!pagesDemo && <a href="/cases">案例库</a>}
          <a href={notesLink()}>实验笔记</a>
          <a href="?view=review">复习</a>
          {pagesDemo ? <a href="https://github.com/DengJunxian/EcoSimEdu#本机启动">本机版</a> : <>
            {!caseId && <a href={studentRoutes.teach}>教师工作台</a>}
            {caseId ? <a href={originalLessonHref(caseId)}>原课堂与进度</a> :
              <a href={studentRoutes.model}>配置模型 API</a>}
          </>}
        </Navigation>
      </div>
    </header>}>
    {!online && <div className="shell offline-strip"><StatusNotice tone="warning">
      当前处于离线状态。已打开的规则实验可继续运行。
    </StatusNotice></div>}
  </AppShell>;
}
