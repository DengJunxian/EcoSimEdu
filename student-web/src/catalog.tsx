import published from "../../cases/catalog.json";
import curriculum from "../../docs/curriculum/knowledge-map.json";

const packages = import.meta.glob<{ case_id: string; version: string; title: string; subtitle: string; seed: number }>(
  "../../cases/*/case.json", { import: "default", eager: true },
);
export const catalog = published.map(id => packages[`../../cases/${id}/case.json`]);
export const selectedCourse = new URLSearchParams(location.search).get("case") ?? published[0];

export function CourseLinks({ current }: { current: string }) {
  return <nav className="course-links" aria-label="课程目录">
    {curriculum.paths.map(path => <section key={path.title}><h2>{path.title}</h2>
      {catalog.filter(course => path.cases.includes(course.case_id)).map(course => <a key={course.case_id}
        href={course.case_id === published[0] ? "/" : `/?case=${course.case_id}`}
        aria-current={course.case_id === current ? "page" : undefined}>{course.title}</a>)}
    </section>)}
  </nav>;
}
