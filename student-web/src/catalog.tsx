import published from "../../cases/catalog.json";
import courseFiles from "virtual:course-files";
import curriculum from "../../docs/curriculum/knowledge-map.json";
import type { Course } from "./lesson-types";

export type CatalogCourse = Pick<Course, "case_id" | "version" | "title" | "subtitle" | "seed" | "identity" |
  "identity_label" | "minutes" | "intro" | "background" | "metrics" | "goals" | "glossary" | "lessons" | "sources">;
export const catalog = courseFiles.catalog;
export const selectedCourse = new URLSearchParams(location.search).get("case") ?? published[0];
export const paths = curriculum.paths;
export const pathPreferenceKey = "civitas/learning-path";
export function preferredPath() {
  try {
    const title = localStorage.getItem(pathPreferenceKey);
    return paths.find(path => path.title === title);
  } catch { return undefined; }
}
export const legacyCourseHref = (caseId: string) => `/?${new URLSearchParams({ case: caseId })}`;
export const caseHref = (caseId: string) => `/cases/${encodeURIComponent(caseId)}`;

export function CourseLinks({ current }: { current: string }) {
  return <nav className="course-links" aria-label="课程目录">
    {paths.map(path => <section key={path.title}><h2>{path.title}</h2>
      {catalog.filter(course => path.cases.includes(course.case_id)).map(course => <a key={course.case_id}
        href={legacyCourseHref(course.case_id)}
        aria-current={course.case_id === current ? "page" : undefined}>{course.title}</a>)}
    </section>)}
  </nav>;
}
