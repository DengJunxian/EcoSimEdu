import { useEffect, useState, type ReactNode } from "react";

export const workbenchMedia = "(max-width: 767px)";
const panes = [
  { id: "world", label: "经济世界" },
  { id: "actors", label: "主体" },
  { id: "system", label: "系统结果" },
] as const;
export type WorkbenchView = typeof panes[number]["id"];

export function Workbench({ active, change, world, actors, system }: {
  active: WorkbenchView; change: (id: WorkbenchView) => void;
  world: ReactNode; actors: ReactNode; system?: ReactNode;
}) {
  const [compact, setCompact] = useState(() => window.matchMedia(workbenchMedia).matches);
  useEffect(() => {
    const media = window.matchMedia(workbenchMedia);
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const views = system ? panes : panes.slice(0, 2);
  const selection = views.some(pane => pane.id === active) ? active : "world";
  const content = { world, actors, system };
  return <section className="workbench" aria-label="教学工作台">
    {compact && <div className="workbench-tabs" role="tablist" aria-label="工作台视图" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = views.findIndex(pane => pane.id === selection);
      const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
      change(views[next].id);
      event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next].focus();
    }}>
      {views.map(({ id, label }) => <button key={id} type="button" role="tab" id={`workbench-tab-${id}`}
        aria-selected={selection === id} aria-controls={`workbench-${id}`} tabIndex={selection === id ? 0 : -1}
        onClick={() => change(id)}>{label}</button>)}
    </div>}
    <div className="workbench-panes" data-system={!!system}>
      {views.map(({ id }) => {
        const hidden = compact && selection !== id;
        return <div key={id} className={`workbench-pane pane-${id}`} id={`workbench-${id}`} hidden={hidden}
          role={compact ? "tabpanel" : undefined} aria-labelledby={compact ? `workbench-tab-${id}` : undefined}
          tabIndex={compact && !hidden ? 0 : undefined}>
          {(id !== "system" || !hidden) && content[id]}
        </div>;
      })}
    </div>
  </section>;
}
