import { ExplanationEditor } from "../learning/explanation-card";
import type { FlagshipView, DomainPanelProps } from "../learning/flagship-types";
import { emergenceExplanationTasks } from "../learning/inquiry";

export function FeedbackExplanation({ view, contentVersion, evidence, demo, prompt, eventType }: Pick<
  DomainPanelProps, "contentVersion" | "evidence" | "demo"
> & { view: FlagshipView; prompt: string; eventType: string }) {
  if (view.case_id !== "public_goods" && view.case_id !== "beer_game" || !contentVersion) return null;
  const sources = (evidence ?? []).filter(ref => ref.run_id === view.run_id && ref.result_hash === view.result_hash &&
    ref.tick <= view.tick);
  return <section className="emergence-section">
    <h3>解释本次反馈</h3>
    <p>先引用课堂中的一条{view.case_id === "beer_game" ? "周账本" : "结算"}记录，再写解释。</p>
    <ExplanationEditor caseId={view.case_id} version={contentVersion} demo={demo} sources={sources}
      task={{ id: emergenceExplanationTasks[view.case_id], prompt,
        evidenceMet: refs => refs.some(ref => ref.event_type === eventType &&
          sources.some(source => source.seq === ref.seq && source.run_id === ref.run_id && source.result_hash === ref.result_hash)),
      }}/>
  </section>;
}
