import { useState, type ComponentType } from "react";
import type { BrowserPanelProps } from "../../content/domain-panel.ts";
import type { Session } from "./lesson.ts";
import { Studio } from "./Studio";
import type { MigratedLesson } from "./models/course-lesson.ts";
import { domainView } from "./domain-view.ts";
import "./domain-classroom.css";

type Panel = ComponentType<BrowserPanelProps>;

function DomainComparison({ Panel, session }: { Panel: Panel; session: Session }) {
  const [actor, setActor] = useState(session.selected ?? "");
  const baseline = session.run!, branch = session.comparison!.run;
  const view = domainView(baseline, baseline.frames.length - 1);
  const comparison = domainView(branch, branch.frames.length - 1);
  if (!view || !comparison) return null;
  return <section className="domain-classroom" aria-label="两组运行的领域对照">
    <p>按各组运行的收尾时点核对账目。</p>
    <Panel stage="compare" action={session.choices[0]} pinned={actor} pin={setActor}
      view={view} comparison={comparison} seek={() => {}}/>
  </section>;
}

export function ModelClassroom({ lesson, Panel }: { lesson: MigratedLesson; Panel?: Panel }) {
  const setup = lesson.decisions[0], prediction = lesson.decisions[1];
  return <Studio lesson={lesson} world={Panel ? (session, _select, { micro, pin, seek }) => {
    const view = domainView(session.run!, session.cursor);
    if (!view) return micro;
    return <div className="domain-classroom">
      <Panel stage="observe" action={session.choices[0]} pinned={session.selected ?? ""} pin={pin} seek={seek} view={view}/>
      {session.stage === 2 && <div className="canvas-panel">{micro}</div>}
    </div>;
  } : undefined} review={session => {
    if (!session.run) return null;
    const choice = "options" in setup ? setup.options.find(option => option.id === session.choices[0]) : undefined;
    const guess = "options" in prediction ? prediction.options.find(option => option.id === session.choices[1]) : undefined;
    return <>
      <details className="trace-details">
        <summary>回看你的决定与预测</summary>
        <p>{choice?.label}。你当时选了「{guess?.label}」。</p>
        <p>核对规则 · {lesson.teaching.rule}</p>
      </details>
      {Panel && session.comparison && <DomainComparison Panel={Panel} session={session}/>}
    </>;
  }}/>;
}
