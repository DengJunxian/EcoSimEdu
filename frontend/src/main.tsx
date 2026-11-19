import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { CourseMap } from "./CourseMap";
import { StudentNotes } from "./StudentNotes";
import { classrooms, hasClassroom } from "./classroom-routes.ts";
import { courseById } from "./curriculum.ts";
import { studentBrand } from "../../content/student-navigation.ts";
import "./styles.css";

const query = new URLSearchParams(location.search);
const id = query.get("lesson");
const Classroom = hasClassroom(id) ? lazy(classrooms[id]) : null;
const isNotes = query.get("view") === "notes";
const course = id && Object.hasOwn(courseById, id) ? courseById[id] : undefined;
document.title = `${studentBrand} · ${isNotes ? "实验笔记" : course?.title ?? "渐进课堂"}`;

createRoot(document.getElementById("root")!).render(
  isNotes ? <StudentNotes id={query.get("note")}/> :
  Classroom ? <Suspense fallback={<main className="shell lesson-shell"><p role="status">正在打开课堂…</p></main>}>
    <Classroom/>
  </Suspense> : <CourseMap/>,
);
