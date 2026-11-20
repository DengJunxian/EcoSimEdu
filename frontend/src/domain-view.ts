import type { BrowserPanelView } from "../../content/domain-panel.ts";
import type { Run } from "./lesson.ts";
import type { ModelRun } from "./models/record.ts";

export function domainView(run: Run, tick: number): BrowserPanelView | undefined {
  const model = run as ModelRun;
  const frame = model.frames[tick];
  if (!frame?.panel) return;
  const previous = model.frames[tick - 1];
  const clock = model.caseId === "public_goods" ? "round" : model.caseId === "beer_game" ? "week" :
    model.caseId === "gamestop" || model.caseId === "flash_crash" ? "time" : "period";
  return {
    run_id: run.id, origin: "browser_rule_engine", tick, closed: tick === model.frames.length - 1,
    frame: { tick, metrics: frame.metrics, entities: frame.panel.entities },
    previous: previous?.panel ? { tick: previous.tick, metrics: previous.metrics, entities: previous.panel.entities } : null,
    events: model.records.slice(0, tick + 1).map(row => ({
      ...row.data, ...model.frames[row.seq].panel?.data, [clock]: row.period,
      seq: row.seq, tick: row.seq, event_type: row.event_type, summary: row.summary, actors: [...row.actors],
    })),
  };
}
