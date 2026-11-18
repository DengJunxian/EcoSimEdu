import { useState } from "react";
import type { ComparisonConditions } from "../learning/inquiry";
import type { SourceRef } from "../learning/flagship-study";
import { saveEvidenceCheck } from "../learning/evidence-checks";

export function ConditionsCheck({ caseId, conditions, parameters, ending, refs }: {
  caseId: string; conditions: ComparisonConditions; parameters: { id: string; label: string }[];
  ending: boolean; refs: SourceRef[];
}) {
  const [changed, setChanged] = useState<string[]>([]);
  const [seed, setSeed] = useState("");
  const [initial, setInitial] = useState("");
  const [clock, setClock] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  return <details className="education-task">
    <summary>核对我理解的比较条件</summary>
    <form onSubmit={async e => {
      e.preventDefault();
      if (busy || !seed || !initial || !clock) return;
      const treatment = Object.keys(conditions.treatments);
      const passed = treatment.length === changed.length && treatment.every(id => changed.includes(id)) &&
        +seed === conditions.seed && initial === (conditions.baseline_initial_hash === conditions.branch_initial_hash ? "same" : "different") &&
        clock === (ending ? "ending" : "clock");
      setBusy(true);
      try {
        await saveEvidenceCheck({ case_id: caseId, kind: "comparison", passed,
          source_refs: refs, response: { 处理: changed.join(","), 共同种子: seed, 初态: initial, 时钟: clock } });
        setFeedback(passed ? "四项条件与两份运行记录相符。" : "至少一项与记录不符。核对实际处理、种子、初态摘要与所选时点。");
      } catch { setFeedback("本机未能保存本次核对。请重试。"); }
      finally { setBusy(false); }
    }}>
      <fieldset className="education-answer"><legend>两场实际改变了什么？可多选，完全相同可留空</legend>
        {parameters.map(item => <label key={item.id} className="education-option">
          <input type="checkbox" checked={changed.includes(item.id)} onChange={e => setChanged(
            e.target.checked ? [...changed, item.id] : changed.filter(id => id !== item.id),
          )}/>{item.label}
        </label>)}
      </fieldset>
      <label className="field-input">共同种子 <input type="number" min={0} max={4294967295} value={seed}
        required onChange={e => setSeed(e.target.value)}/></label>
      <label className="field-input">初态摘要 <select value={initial} required onChange={e => setInitial(e.target.value)}>
        <option value="">选择</option><option value="same">相同</option><option value="different">不同</option>
      </select></label>
      <label className="field-input">当前时点的对齐依据 <select value={clock} required onChange={e => setClock(e.target.value)}>
        <option value="">选择</option><option value="clock">相同经济时点</option><option value="ending">各自停止</option>
        <option value="seq">相同事件编号</option>
      </select></label>
      <button type="submit" disabled={busy}>提交比较条件核对</button>
      {feedback && <p role="status">{feedback}</p>}
    </form>
  </details>;
}
