import { useEffect, useId, useRef, type ReactNode } from "react";
import { trendLabel } from "./learning-store.ts";
import type { Command, Lesson, Session, Trend } from "./lesson.ts";

export function ForkPrediction({ label, value, change }: {
  label: string; value?: Trend; change: (trend: Trend) => void;
}) {
  return <fieldset className="decision-actions study-phase">
    <legend>{label}</legend>
    {(Object.keys(trendLabel) as Trend[]).map(trend => <label key={trend}>
      <input type="radio" name="fork-prediction" checked={value === trend}
        onChange={() => change(trend)} required/> {trendLabel[trend]}
    </label>)}
  </fieldset>;
}

export function ForkPanel({ lesson, session, send, title, description, seekLabel, decision, children }: {
  lesson: Lesson; session: Session; send: (command: Command) => void;
  title: string; description: string; seekLabel: (tick: number) => string;
  decision: (tick: number) => ReactNode; children?: ReactNode;
}) {
  const run = session.run!;
  const editable = session.stage === 3;
  const checkpoint = editable && lesson.fork?.checkpoint(run, session.cursor);
  const next = editable ? run.frames.find(({ tick }) => tick > session.cursor && lesson.fork?.checkpoint(run, tick)) : undefined;
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const previous = useRef(session.fork);
  const requested = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (requested.current === session.cursor || session.fork && previous.current !== session.fork) {
      requested.current = undefined;
      heading.current?.focus();
    }
    previous.current = session.fork;
  }, [session.cursor, session.fork]);

  return <section className="edu-panel fork-lab" aria-labelledby={id}>
    <h2 ref={heading} tabIndex={-1} id={id}>{title}</h2>
    {editable && <>
      <p>{description}</p>
      {checkpoint && !session.playing && decision(session.cursor)}
      {next && <button type="button" onClick={() => {
        requested.current = next.tick;
        send({ type: "seek-checkpoint", tick: next.tick });
      }}>{seekLabel(next.tick)}</button>}
      {!checkpoint && !next && <p>这一时点之后没有可分支的检查点。若此前有检查点，可用回放返回。</p>}
    </>}
    {children}
  </section>;
}
