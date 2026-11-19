import { useEffect, useRef, useState } from "react";
import { frameLabel, type Lesson, type Run, type Session } from "./lesson.ts";
import { allNotes, notesLink, saveNote, trendLabel, type CourseRef, type Explanation, type SavedExplanation } from "./learning-store.ts";
import { runRecords, seedEvidence } from "./run-evidence.ts";
import type { ModelRun } from "./models/record.ts";

function EvidencePicker({ run, name, label, selection, tickUnit }: {
  run: Run; name: string; label: string; selection?: number; tickUnit?: Lesson["tickUnit"];
}) {
  const all = runRecords(run);
  const meaningful = all.filter(record => record.event_type !== "period_end" && record.event_type !== "round_end");
  const records = selection === undefined || meaningful.some(record => record.seq === selection) ? meaningful :
    all.filter(record => record.seq === selection || meaningful.includes(record));
  return <label>{label}
    <select name={name} required defaultValue={selection ?? ""}>
      <option value="" disabled>选取原始事件</option>
      {records.map(record => <option key={record.seq} value={record.seq}>{frameLabel(tickUnit, record.seq)} · {record.summary}</option>)}
    </select>
  </label>;
}

export function Investigation({ course, lesson, session }: { course: CourseRef; lesson: Lesson; session: Session }) {
  const baseline = session.run!;
  const comparison = session.comparison!.run;
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

  function download(explanation?: Explanation) {
    const payload = {
      schema: "ecosimedu.progressive.work/v1",
      caseId: course.caseId,
      contentVersion: "contentVersion" in lesson ? lesson.contentVersion : undefined,
      origin: "browser_rule_engine",
      modelRule: lesson.bridge?.rule,
      references: lesson.source.references,
      choices: session.choices,
      policyPrediction: session.comparison!.prediction,
      observations: [baseline, comparison].map(run => ({ id: run.id, seed: run.seed,
        ...("records" in run ? { scenario: (run as ModelRun).scenario, action: (run as ModelRun).action, intervention: (run as ModelRun).intervention } : {}),
        initialActors: run.frames[0].actors, events: runRecords(run), metrics: run.frames.map(frame => frame.metrics) })),
      ...(explanation ? { explanation,
        evidence: [seedEvidence(baseline, explanation.baselineEvent), seedEvidence(comparison, explanation.comparisonEvent)] } : {}),
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
    <form onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const explanation: Explanation = {
        baselineEvent: Number(form.get("baselineEvent")), comparisonEvent: Number(form.get("comparisonEvent")),
        rule: String(form.get("rule")).trim(), calculation: String(form.get("calculation")).trim(),
        comparison: String(form.get("difference")).trim(), hypothesis: String(form.get("hypothesis")).trim(),
      };
      if (!baseline.frames[explanation.baselineEvent] || !comparison.frames[explanation.comparisonEvent] ||
          !form.get("baselineEvent") || !form.get("comparisonEvent") ||
          !explanation.rule || !explanation.calculation || !explanation.comparison || !explanation.hypothesis) {
        setStatus("请选取两条运行事件并填完四项解释。");
        return;
      }
      if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "export") {
        download(explanation);
        setStatus("已导出两次运行与解释。");
        return;
      }
      try {
        const savedAt = new Date().toISOString();
        const saved: SavedExplanation = { ...explanation, choices: session.choices, prediction: session.comparison!.prediction,
          baselineId: baseline.id, comparisonId: comparison.id, savedAt, policy: session.comparison!.policy };
        const id = saveNote(localStorage, saved);
        setSavedId(id);
        setNotes(allNotes(localStorage, baseline.id, comparison.id));
        setStatus(`解释已保存在本浏览器。已引用基线事件 ${explanation.baselineEvent}、干预事件 ${explanation.comparisonEvent}。`);
      } catch {
        setStatus("本浏览器无法保存。可以导出包含解释的文件。");
      }
    }}>
      <EvidencePicker tickUnit={lesson.tickUnit} run={baseline} name="baselineEvent" label="无干预证据" selection={previous?.baselineEvent}/>
      <EvidencePicker tickUnit={lesson.tickUnit} run={comparison} name="comparisonEvent" label="政策组证据" selection={previous?.comparisonEvent}/>
      <label>哪条规则决定了个体的行动？
        <textarea name="rule" rows={2} required maxLength={1000} defaultValue={previous?.rule}/></label>
      <label>如何从事件核算观察到的变化？
        <textarea name="calculation" rows={2} required maxLength={1000} defaultValue={previous?.calculation}/></label>
      <label>在同种子对照中，改变了什么、结果相差多少？
        <textarea name="difference" rows={2} required maxLength={1000} defaultValue={previous?.comparison}/></label>
      <label>应用到现实还需核对的假设
        <textarea name="hypothesis" rows={2} required maxLength={1000} defaultValue={previous?.hypothesis}/></label>
      <div className="decision-actions">
        <button value="save" type="submit" className="primary">保存解释</button>
        <button value="export" type="submit">导出含解释的结果</button>
        <button type="button" onClick={() => download()}>导出两次运行</button>
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
