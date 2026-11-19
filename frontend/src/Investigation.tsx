import { useEffect, useMemo, useRef, useState } from "react";
import { frameLabel, type Lesson, type Run, type Session } from "./lesson.ts";
import { allNotes, notesLink, saveNote, trendLabel, type CourseRef, type Explanation, type SavedExplanation } from "./learning-store.ts";
import { browserEnvelope, browserEvents, browserEvidence, evidencePointer, runRecords, seedEvidence } from "./run-evidence.ts";
import type { EventEnvelope } from "./domain-contracts.ts";
import type { ModelRun } from "./models/record.ts";
import type { SvbRun } from "./svb.ts";
import type { AuctionRun } from "./auction.ts";

function EvidencePicker({ events, name, label, selection, tickUnit }: {
  events: readonly EventEnvelope[]; name: string; label: string; selection?: string; tickUnit?: Lesson["tickUnit"];
}) {
  const listed = events.filter(record => record.eventId === selection ||
    (record.kind !== "period_end" && record.kind !== "round_end"));
  return <label>{label}
    <select name={name} required defaultValue={selection ?? ""}>
      <option value="" disabled>选取原始事件</option>
      {listed.map(event => <option key={event.eventId} value={event.eventId}>
        {frameLabel(tickUnit, event.frameTick!)} · {event.sequence === null ? `${event.eventId} · ` : ""}
        {event.summary ?? event.kind}
      </option>)}
    </select>
  </label>;
}

export function Investigation({ course, lesson, session, onSaved }: {
  course: CourseRef; lesson: Lesson; session: Session; onSaved?: () => void;
}) {
  const baseline = session.run!;
  const comparison = session.comparison!.run;
  const published = lesson.casePackage!;
  const baselineEvents = useMemo(() => browserEvents(baseline, published), [baseline, published]);
  const comparisonEvents = useMemo(() => browserEvents(comparison, published), [comparison, published]);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(() => {
    try { return allNotes(localStorage, baseline.id, comparison.id); }
    catch { return []; }
  });
  const [savedId, setSavedId] = useState<string>();
  const previous = notes[0];
  const [status, setStatus] = useState("");
  const receipt = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (status) receipt.current?.focus();
  }, [status]);

  async function describeRuns() {
    return await Promise.all([baseline, comparison].map((run, index) => browserEnvelope(run, published, {
      choices: session.choices, policy: index === 0 ? lesson.policy.baseline : session.comparison!.policy,
      ...("records" in run ? { scenario: (run as ModelRun).scenario, intervention: (run as ModelRun).intervention } : {}),
      ...(published.caseId === "svb_run" ? { scenario: (run as SvbRun).scenario, network: (run as SvbRun).network } : {}),
      ...(published.caseId === "double_auction" ? { demand_shift: (run as AuctionRun).demandShift,
        fee: (run as AuctionRun).fee, market: (run as AuctionRun).market } : {}),
    })));
  }

  async function download(selected?: { explanation: Explanation; baseline: EventEnvelope; comparison: EventEnvelope }) {
    const runEnvelopes = await describeRuns();
    const payload = {
      schema: "ecosimedu.progressive.work/v1",
      caseId: course.caseId,
      contentVersion: published.browserContentVersion,
      origin: "browser_rule_engine",
      modelRule: lesson.bridge?.rule,
      references: lesson.source.references,
      choices: session.choices,
      policyPrediction: session.comparison!.prediction,
      observations: [baseline, comparison].map(run => ({ id: run.id, seed: run.seed,
        ...("records" in run ? { scenario: (run as ModelRun).scenario, action: (run as ModelRun).action, intervention: (run as ModelRun).intervention } : {}),
        initialActors: run.frames[0].actors, events: runRecords(run), metrics: run.frames.map(frame => frame.metrics) })),
      runEnvelopes,
      eventEnvelopes: [baselineEvents, comparisonEvents],
      ...(selected ? { explanation: selected.explanation,
        evidence: [seedEvidence(baseline, selected.explanation.baselineEvent), seedEvidence(comparison, selected.explanation.comparisonEvent)],
        sourceEvidence: [browserEvidence(runEnvelopes[0], selected.baseline, baseline.frames.length - 1),
          browserEvidence(runEnvelopes[1], selected.comparison, comparison.frames.length - 1)] } : {}),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `EcoSimEdu-${course.caseId}-实验.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="studio-explanation" aria-labelledby="explanation-heading">
    <h2 id="explanation-heading">用两次运行解释机制</h2>
    <p>{lesson.explanationPrompt ?? "引用一次基线运行和一次政策运行里的证据，再用它们解释机制。"}</p>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      const form = new FormData(event.currentTarget);
      const selectedBaseline = baselineEvents.find(entry => entry.eventId === form.get("baselineEvent"));
      const selectedComparison = comparisonEvents.find(entry => entry.eventId === form.get("comparisonEvent"));
      if (selectedBaseline?.frameTick == null || selectedComparison?.frameTick == null) {
        setStatus("请选取两条运行事件并填完四项解释。");
        return;
      }
      const explanation: Explanation = {
        baselineEvent: selectedBaseline.frameTick, comparisonEvent: selectedComparison.frameTick,
        rule: String(form.get("rule")).trim(), calculation: String(form.get("calculation")).trim(),
        comparison: String(form.get("difference")).trim(), hypothesis: String(form.get("hypothesis")).trim(),
      };
      if (!explanation.rule || !explanation.calculation || !explanation.comparison || !explanation.hypothesis) {
        setStatus("请选取两条运行事件并填完四项解释。");
        return;
      }
      const exportRequested = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "export";
      setBusy(true);
      try {
        if (exportRequested) {
          await download({ explanation, baseline: selectedBaseline, comparison: selectedComparison });
          setStatus("已导出两次运行与解释。");
          return;
        }
        const [baselineRun, comparisonRun] = await describeRuns();
        const evidence = {
          baseline: evidencePointer(browserEvidence(baselineRun, selectedBaseline, baseline.frames.length - 1)),
          comparison: evidencePointer(browserEvidence(comparisonRun, selectedComparison, comparison.frames.length - 1)),
        };
        const savedAt = new Date().toISOString();
        const saved: SavedExplanation = { ...explanation, choices: session.choices, prediction: session.comparison!.prediction,
          baselineId: baseline.id, comparisonId: comparison.id, savedAt, policy: session.comparison!.policy,
          course, evidence };
        const id = saveNote(localStorage, saved);
        setSavedId(id);
        setNotes(allNotes(localStorage, baseline.id, comparison.id));
        onSaved?.();
        setStatus(`解释已保存在本浏览器。已引用基线事件 ${selectedBaseline.eventId}、干预事件 ${selectedComparison.eventId}。`);
      } catch {
        setStatus(exportRequested ? "无法核对并导出本次运行。" : "本浏览器无法核对并保存解释。");
      } finally {
        setBusy(false);
      }
    }}>
      <EvidencePicker tickUnit={lesson.tickUnit} events={baselineEvents} name="baselineEvent" label="无干预证据"
        selection={previous?.evidence?.baseline?.eventId ?? (previous && String(previous.baselineEvent))}/>
      <EvidencePicker tickUnit={lesson.tickUnit} events={comparisonEvents} name="comparisonEvent" label="政策组证据"
        selection={previous?.evidence?.comparison?.eventId ?? (previous && String(previous.comparisonEvent))}/>
      <label>哪条规则决定了个体的行动？
        <textarea name="rule" rows={2} required maxLength={1000} defaultValue={previous?.rule}/></label>
      <label>如何从事件核算观察到的变化？
        <textarea name="calculation" rows={2} required maxLength={1000} defaultValue={previous?.calculation}/></label>
      <label>在同种子对照中，改变了什么、结果相差多少？
        <textarea name="difference" rows={2} required maxLength={1000} defaultValue={previous?.comparison}/></label>
      <label>应用到现实还需核对的假设
        <textarea name="hypothesis" rows={2} required maxLength={1000} defaultValue={previous?.hypothesis}/></label>
      <div className="decision-actions">
        <button value="save" type="submit" className="primary" disabled={busy}>保存解释</button>
        <button value="export" type="submit" disabled={busy}>导出含解释的结果</button>
        <button type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await download(); }
          catch { setStatus("无法核对并导出本次运行。"); }
          finally { setBusy(false); }
        }}>导出两次运行</button>
      </div>
    </form>
    <p ref={receipt} tabIndex={-1} role="status">{status}</p>
    {savedId && <a href={notesLink(savedId)}>在实验笔记打开已保存的解释</a>}
    {notes.length > 0 && <details className="trace-details">
      <summary>同条件的历史解释（{notes.length} 条）</summary>
      <ol>{notes.map(note => <li key={note.id}>
        <p>{new Date(note.savedAt).toLocaleString()} · 原政策预测：{trendLabel[note.prediction]}。
          引用了基线事件 {note.baselineEvent} 和干预事件 {note.comparisonEvent}。</p>
        <dl>
          <dt>规则</dt><dd>{note.rule}</dd>
          <dt>算术</dt><dd>{note.calculation}</dd>
          <dt>对照</dt><dd>{note.comparison}</dd>
          <dt>假设</dt><dd>{note.hypothesis}</dd>
        </dl>
      </li>)}</ol>
    </details>}
  </section>;
}
