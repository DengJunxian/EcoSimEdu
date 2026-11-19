import { Studio } from "./Studio";
import type { MigratedLesson } from "./models/course-lesson.ts";

export function ModelClassroom({ lesson }: { lesson: MigratedLesson }) {
  const setup = lesson.decisions[0], prediction = lesson.decisions[1];
  return <Studio lesson={lesson} review={session => {
    if (!session.run) return null;
    const choice = "options" in setup ? setup.options.find(option => option.id === session.choices[0]) : undefined;
    const guess = "options" in prediction ? prediction.options.find(option => option.id === session.choices[1]) : undefined;
    return <>
      <details className="trace-details">
        <summary>回看你的决定与预测</summary>
        <p>{choice?.label}。你当时选了「{guess?.label}」。</p>
        <p>核对规则 · {lesson.teaching.rule}</p>
      </details>
    </>;
  }}/>;
}
