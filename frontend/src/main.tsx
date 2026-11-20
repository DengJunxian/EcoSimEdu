import { Component, lazy, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CourseMap } from "./CourseMap";
import { StudentNotes } from "./StudentNotes";
import { classrooms, hasClassroom } from "./classroom-routes.ts";
import { courseById } from "./curriculum.ts";
import { studentBrand } from "../../content/student-navigation.ts";
import { PageTitle, StatusNotice } from "../../content/student-ui.tsx";
import { StudentHeader } from "./StudentHeader.tsx";
import "./styles.css";

const query = new URLSearchParams(location.search);
const id = query.get("lesson");
const Classroom = hasClassroom(id) ? lazy(classrooms[id]) : null;
const isNotes = query.get("view") === "notes";
const isReview = query.get("view") === "review";
const ProgressiveReview = lazy(() => import("./ProgressiveLearning.tsx").then(module => ({ default: module.ProgressiveReviewPage })));
const course = id && Object.hasOwn(courseById, id) ? courseById[id] : undefined;
document.title = `${studentBrand} · ${isNotes ? "实验笔记" : isReview ? "复习" : course?.title ?? "渐进课堂"}`;

function ClassroomStatus({ children }: { children: ReactNode }) {
  return <><StudentHeader caseId={course?.id}/>
    <main className="shell lesson-shell" id="main" tabIndex={-1}>{children}</main></>;
}

class ClassroomBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return <ClassroomStatus>
      <PageTitle>课堂暂时无法运行</PageTitle>
      <StatusNotice tone="error">打开课堂或计算时遇到问题。可以重新载入，课堂会尝试从已保存的位置恢复。</StatusNotice>
      <div className="decision-actions recovery-actions">
        <button className="primary" onClick={() => location.reload()}>重新载入课堂</button>
        <a href="./#paths">返回学习路径</a>
      </div>
    </ClassroomStatus>;
  }
}

createRoot(document.getElementById("root")!).render(
  isNotes ? <StudentNotes id={query.get("note")}/> :
  isReview ? <ClassroomBoundary><Suspense fallback={<ClassroomStatus><StatusNotice>正在打开复习…</StatusNotice></ClassroomStatus>}>
    <ProgressiveReview/>
  </Suspense></ClassroomBoundary> :
  Classroom ? <ClassroomBoundary><Suspense fallback={<ClassroomStatus>
    <StatusNotice>正在打开课堂…</StatusNotice>
  </ClassroomStatus>}>
    <Classroom/>
  </Suspense></ClassroomBoundary> : id ? <ClassroomStatus>
    <PageTitle>找不到这门课堂</PageTitle><a href="./#paths">从学习路径选择课程</a>
  </ClassroomStatus> : <CourseMap/>,
);
