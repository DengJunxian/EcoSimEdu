import { useEffect, useState } from "react";
import concepts from "../../../content/concepts.json";
import alignment from "../../../cases/learning-outcomes.json";
import { api } from "../contracts";
import { caseHref, catalog } from "../catalog";
import type { Attempt, LearningPackage, Outcome } from "./education-types";
import { outcomeEvidence } from "./evidence-rules";
import { profileId, result, transact } from "./learner-repository";

export function ConceptPage({ conceptId }: { conceptId: string }) {
  const [search, setSearch] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState(false);
  const concept = concepts.find(entry => entry.id === conceptId);
  useEffect(() => {
    if (!concept) return;
    let active = true;
    void profileId(false).then(async profile => {
      const data = await transact(["attempts"], "readonly", tx => result(tx.objectStore("attempts").getAll())) as Attempt[];
      const personal = data.filter(entry => entry.local_profile_id === profile);
      const cases = [...new Set(personal.map(entry => entry.case_id))];
      const current = await Promise.allSettled(cases.map(id => api<LearningPackage>(`/cases/${id}/lesson?schema_version=3`)));
      const versions = new Map(current.flatMap(check => check.status === "fulfilled"
        ? [[check.value.case_id, check.value.content_version] as const] : []));
      if (active) setAttempts(personal.filter(entry => entry.content_version === versions.get(entry.case_id)));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [concept]);
  const outcomes = concept ? Object.entries(alignment.cases).flatMap(([caseId, goals]) =>
    (goals as Outcome[]).filter(goal => goal.concept_ids.includes(concept.id)).map(goal => ({ caseId, goal }))) : [];
  const matches = concepts.filter(entry => `${entry.label}${entry.definition}`.includes(search.trim()));
  return <main id="main" tabIndex={-1} className="container app-page app-inner">
    <h1>{concept?.label ?? "经济学概念"}</h1>
    {concept ? <>
      <p>{concept.definition}</p>
      <a href="/concepts">全部概念</a>
      {concept.prerequisite_ids.map(id => <p key={id}>先修 <a href={`/concepts/${id}`}>{concepts.find(entry => entry.id === id)?.label}</a></p>)}
      {error && <p role="alert">暂时无法读取本机学习证据。</p>}
      <h2>用案例练习</h2>
      <ul>{outcomes.map(({ caseId, goal }) => {
        const evidence = outcomeEvidence(goal, attempts);
        return <li key={goal.id}><a href={caseHref(caseId)}>{catalog.find(course => course.case_id === caseId)?.title}</a>
          <p>{goal.performance}</p><p>{goal.task}。迁移练习包括{goal.transfer}。</p>
          <p>{evidence.evidence_state === "independent_evidence" ? "有独立应用证据" :
            evidence.evidence_state === "practicing" ? "练习中" : "未尝试"}。
            {evidence.evidence_dates.length > 0 && <time dateTime={evidence.evidence_dates.at(-1)}>
              {new Date(evidence.evidence_dates.at(-1)!).toLocaleDateString()}</time>}
            {evidence.transfer_status === "evidenced" && " 已有迁移证据。"}</p>
        </li>;
      })}</ul>
    </> : <>
      <label>搜索概念 <input type="search" value={search} onChange={event => setSearch(event.target.value)}/></label>
      <ul>{matches.map(entry => <li key={entry.id}><a href={`/concepts/${entry.id}`}>{entry.label}</a></li>)}</ul>
      {!matches.length && <p>没有匹配的概念。</p>}
    </>}
  </main>;
}
