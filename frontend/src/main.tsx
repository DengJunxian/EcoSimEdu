import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { CourseMap } from "./CourseMap";
import { StudentNotes } from "./StudentNotes";
import { classrooms, hasClassroom, studentOrigin } from "./classroom-routes.ts";
import "./styles.css";

const query = new URLSearchParams(location.search);
const id = query.get("lesson");
const Classroom = hasClassroom(id) ? lazy(classrooms[id]) : null;
const origin = studentOrigin(import.meta.env.VITE_LEGACY_ORIGIN);

createRoot(document.getElementById("root")!).render(
  query.get("view") === "notes" ? <StudentNotes legacyOrigin={origin} id={query.get("note")}/> :
  Classroom ? <Suspense fallback={<main className="shell lesson-shell"><p role="status">正在打开课堂…</p></main>}>
    <Classroom/>
  </Suspense> : <CourseMap legacyOrigin={origin}/>,
);
