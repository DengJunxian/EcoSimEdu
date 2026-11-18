import { useEffect, useState } from "react";
import { api, downloadJson, eventHref, type MarketEvent } from "../contracts";
import { auctionView } from "../cases/auction/auction-study";
import { eventActors, getFieldView, type SourceRef } from "./flagship-study";
import type { LearningPackage } from "./education-types";
import type { Event } from "../lesson-types";
import { conditionMessage, evidenceKeyFor, evidenceUseLabels, type EvidenceUse,
  type ComparisonConditions, type ExperimentCard, type ExplanationCard } from "./inquiry";
import { profileId, result, transact } from "./learner-repository";
import "./education.css";

const fieldLabels = { claim: "我的论断", micro: "主体怎样作出行动", aggregation: "互动怎样形成总体结果",
  conditions: "成立条件", alternative_explanation: "另一种可能的解释" };
type Field = keyof typeof fieldLabels;
const fields = Object.keys(fieldLabels) as Field[];

function actorMatches(event: Event & Partial<MarketEvent>, actor: string) {
  return eventActors(event).includes(actor) || [event.actor_id, event.buyer_id, event.seller_id].includes(actor);
}

async function verify(caseId: string, source: SourceRef, signal: AbortSignal) {
  const view = caseId === "double_auction" ? await auctionView(source.run_id, source.tick) :
    await getFieldView(source.run_id, source.tick, false, signal);
  const event = view.events.find(row => row.seq === source.seq) as Event | undefined;
  return view.run_id === source.run_id && view.result_hash === source.result_hash &&
    view.case_version === source.case_version && view.engine_version === source.engine_version &&
    (!("case_id" in view) || view.case_id === caseId) && event?.tick === source.tick &&
    event.event_type === source.event_type && (!source.actor || actorMatches(event, source.actor));
}

export function ExplanationEditor({ caseId, version, sources, demo = false, task }: {
  caseId: string; version: string; sources: SourceRef[]; demo?: boolean;
  task?: { id: NonNullable<ExplanationCard["task_id"]>; prompt: string; evidenceMet: (refs: SourceRef[]) => boolean };
}) {
  const [expanded, setExpanded] = useState(false);
  const [card, setCard] = useState<ExplanationCard>();
  const [experiments, setExperiments] = useState<ExperimentCard[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [paired, setPaired] = useState<{ id: string; conditions?: ComparisonConditions }>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [structure, setStructure] = useState(false);
  const [coach, setCoach] = useState<{ next_action: string; online_available: boolean; delivery: string }>();
  const [coachPending, setCoachPending] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    async function load() {
      const profile = await profileId(demo);
      const id = JSON.stringify(task ? [profile, caseId, version, task.id] : [profile, caseId, version]);
      const { previous, cards } = await transact(["explanations", "experiments"], "readonly", async tx => ({
        previous: await result(tx.objectStore("explanations").get(id)) as ExplanationCard | undefined,
        cards: await result(tx.objectStore("experiments").getAll()) as ExperimentCard[],
      }));
      if (!active) return;
      setCard(previous ?? {
        id, version: 1, case_id: caseId, content_version: version, profile, source_refs: [],
        ...(task && { task_id: task.id }),
        outcome_ids: [`${caseId}.1`, `${caseId}.2`, `${caseId}.3`],
        claim: "", micro: "", aggregation: "", conditions: "", alternative_explanation: "",
      });
      setExperiments(cards.filter(item => item.case_id === caseId && item.profile === profile && item.status === "completed"));
    }
    void load().catch(() => { if (active) setError("解释卡暂时无法读取。"); });
    return () => { active = false; };
  }, [expanded, caseId, version, demo, task?.id]);

  const experiment = experiments.find(item => item.id === card?.experiment_card_id);
  useEffect(() => {
    if (!expanded || !experiment?.run_ids || !experiment.alignment_ref) return;
    const controller = new AbortController();
    const { baseline, branch } = experiment.run_ids;
    const selected = experiment.alignment_ref;
    const refs = experiment.source_refs;
    api<{ axis_label: string; conditions?: ComparisonConditions; rows: { baseline: { tick: number } | null;
      branch: { tick: number } | null }[] }>(`/runs/${baseline}/compare/${branch}`, undefined, controller.signal)
      .then(pair => {
        if (controller.signal.aborted) return;
        const aligned = refs?.[0]?.run_id === baseline && refs?.[1]?.run_id === branch &&
          refs[0].tick === selected.baseline_tick && refs[1].tick === selected.branch_tick &&
          pair.axis_label === selected.clock && pair.rows.some(row =>
            row.baseline?.tick === selected.baseline_tick && row.branch?.tick === selected.branch_tick);
        setPaired({ id: experiment.id, conditions: aligned ? pair.conditions : undefined });
      }).catch(() => {
        if (!controller.signal.aborted) setPaired({ id: experiment.id });
      });
    return () => controller.abort();
  }, [expanded, experiment]);
  const evidence = [...(card?.source_refs ?? []), ...(experiment?.source_refs ?? [])];
  const evidenceKey = JSON.stringify(evidence);
  const ready = !task || !!card && fields.every(field => card[field].trim()) &&
    task.evidenceMet(card.source_refs) && card.source_refs.every(ref =>
      checks[JSON.stringify(ref)] === true && !!card.source_uses?.[evidenceKeyFor(ref)]);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setChecks({});
    for (const source of JSON.parse(evidenceKey) as SourceRef[]) {
      void verify(caseId, source, controller.signal).catch(() => false).then(valid => {
        if (!controller.signal.aborted)
          setChecks(previous => ({ ...previous, [JSON.stringify(source)]: valid }));
      });
    }
    return () => controller.abort();
  }, [caseId, expanded, evidenceKey]);

  function edit(patch: Partial<ExplanationCard>) {
    setStatus("");
    setCoach(undefined);
    setCard(previous => previous && { ...previous, ...patch });
  }

  async function save() {
    if (!card || !ready) return;
    setBusy(true);
    setError("");
    try {
      await transact(["explanations"], "readwrite", tx => result(tx.objectStore("explanations").put({
        ...card, updated_at: new Date().toISOString(),
      })));
      setStatus("解释卡已保存。");
    } catch { setError("解释卡未保存。可导出当前草稿。"); }
    finally { setBusy(false); }
  }

  async function askCoach(online = false) {
    if (!card) return;
    if (!task) setStructure(true);
    setCoachPending(true);
    try {
      if (task && !card.structure_help_used) {
        const { id, profile, case_id, content_version, task_id, outcome_ids } = card;
        await transact(["explanations"], "readwrite", async tx => {
          const store = tx.objectStore("explanations");
          const previous = await result(store.get(id)) as ExplanationCard | undefined;
          await result(store.put({
            ...(previous ?? { id, profile, case_id, content_version, task_id, outcome_ids, version: 1,
              claim: "", micro: "", aggregation: "", conditions: "", alternative_explanation: "", source_refs: [] }),
            structure_help_used: true, updated_at: new Date().toISOString(),
          }));
        });
        setCard(previous => previous && { ...previous, structure_help_used: true });
      }
      setStructure(true);
      const pack = await api<LearningPackage>(`/cases/${caseId}/lesson?schema_version=3`);
      const activity = pack.activities.find(row => row.phase === "notebook" && row.kind === "assessment");
      const item = pack.items.find(row => row.id === activity?.content_ref);
      if (!activity || !item) return;
      const reply = await api<NonNullable<typeof coach>>("/tutor", {
        case_id: caseId, scene: "notebook", question: "核对解释结构",
        learning_context: { activity_id: activity.id, item_id: item.id, item_version: item.version,
          explanation_draft: Object.fromEntries(fields.map(field => [field, card[field].slice(0, 800)])) },
        ...(online && { online_request_id: crypto.randomUUID() }),
      });
      setCoach(reply);
    } catch {
      setCoach(undefined);
      if (task && !card.structure_help_used) setError("结构提示尚未记录。请重试。");
    }
    finally { setCoachPending(false); }
  }

  function downloadMarkdown() {
    if (!card) return;
    const content = [`# ${caseId} · 机制解释`, `课件版本 ${card.content_version}`,
      ...fields.flatMap(field => [`## ${fieldLabels[field]}`, card[field]]),
      "## 运行引用", ...evidence.map(source => {
        const use = card.source_uses?.[evidenceKeyFor(source)];
        return `- ${use ? evidenceUseLabels[use] + " · " : ""}${source.run_id} · 事件 ${source.seq} · ${source.result_hash}`;
      })].join("\n\n");
    const href = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = `${caseId}-机制解释.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return <details className="education-task" onToggle={event => { if (event.currentTarget.open) setExpanded(true); }}>
    <summary>写一张机制解释卡</summary>
    {error && <p role="alert">{error}</p>}
    {card && <>
      {task && <p>{task.prompt} 用「另一种可能的解释」记录待检验的解释假设。</p>}
      <div className="education-answer">
        {fields.map(field => <label key={field}>{fieldLabels[field]}
          <textarea maxLength={1000} value={card[field]} onChange={event => edit({ [field]: event.target.value })}/>
        </label>)}
      </div>
      {sources.length > 0 && <fieldset className="education-answer"><legend>选用课堂已经引用的事件</legend>
        {sources.map(source => {
          const key = JSON.stringify(source);
          const exists = card.source_refs.some(ref => JSON.stringify(ref) === key);
          const sourceKey = evidenceKeyFor(source);
          return <div key={key}><label className="education-option">
            <input type="checkbox" checked={exists} onChange={event => edit({
              source_refs: event.target.checked ? [...card.source_refs, source] :
                card.source_refs.filter(ref => JSON.stringify(ref) !== key),
              ...(task && !event.target.checked && { source_uses: Object.fromEntries(
                Object.entries(card.source_uses ?? {}).filter(([name]) => name !== sourceKey)) }),
            })}/>事件 {source.seq} · {source.event_type}{task && ` · ${source.actor ?? source.run_id.slice(0, 8)}`}
          </label>
            {task && exists && <label className="field-input">证据用途 · 事件 {source.seq}
              <select value={card.source_uses?.[sourceKey] ?? ""} onChange={event => edit({
                source_uses: { ...card.source_uses, [sourceKey]: event.target.value as EvidenceUse },
              })}>
                <option value="" disabled>选择这条证据支持哪句解释</option>
                {(Object.keys(evidenceUseLabels) as EvidenceUse[]).map(option =>
                  <option key={option} value={option}>{evidenceUseLabels[option]}</option>)}
              </select>
            </label>}
          </div>;
        })}
      </fieldset>}
      {experiments.length > 0 && <label>加入参数对照 <select aria-label="加入参数对照" value={card.experiment_card_id ?? ""}
        onChange={event => edit({ experiment_card_id: event.target.value || undefined })}>
        <option value="">暂不引用</option>{experiments.map(item => <option key={item.id} value={item.id}>{item.question}</option>)}
      </select></label>}
      {experiment && <p>{paired?.id !== experiment.id ? "正在核对两次运行的共同条件。" : paired.conditions ?
        conditionMessage(paired.conditions) : "成对运行待恢复。已保留原解释文字。"}</p>}
      {evidence.length > 0 && <ul>{evidence.map((source, index) => {
        const checked = checks[JSON.stringify(source)];
        return <li key={index}><a href={eventHref(caseId, source.run_id, source.seq)}>事件 {source.seq}</a>
          {" · "}{checked === true ? "运行引用有效" : checked === false ? "运行待恢复或版本不符" : "正在核对运行引用"}</li>;
      })}</ul>}
      <div className="toolbar">
        <button className="primary" disabled={busy || !ready || !!task && coachPending}
          onClick={() => void save()}>{task ? "提交解释卡" : "保存解释卡"}</button>
        <button disabled={coachPending} onClick={() => { if (structure) setStructure(false); else void askCoach(); }}
          aria-expanded={structure}>检查解释结构</button>
        <button disabled={!ready} onClick={() => downloadJson(`${caseId}-解释卡.json`, { ...card, experiment })}>导出解释卡 JSON</button>
        <button disabled={!ready} onClick={downloadMarkdown}>导出解释卡 Markdown</button>
      </div>
      {status && <p role="status">{status}</p>}
      {task && card.structure_help_used && <p>本卡已使用结构提示。</p>}
      {structure && <div className="education-feedback">
        <p>{fields.every(field => card[field].trim()) ? "已填写论断、机制和条件。" :
          `可以补充${fields.filter(field => !card[field].trim()).map(field => fieldLabels[field]).join("、")}。`}</p>
        <p>{coach?.next_action ?? "指出哪一个事件支持你的哪一句主张，并想想在相同数据下还有什么解释成立。"}</p>
        <p>机制推理留待自评或人工审阅。{coach?.delivery === "online" && "这条追问由在线导师从已核对选项中选择。"}</p>
        {coach?.online_available && coach.delivery === "offline" &&
          <button disabled={coachPending} onClick={() => void askCoach(true)}>在线选择追问</button>}
      </div>}
    </>}
  </details>;
}
