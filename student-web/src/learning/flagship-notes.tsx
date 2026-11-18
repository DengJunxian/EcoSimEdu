import { useEffect, useState } from "react";
import { api, downloadJson, eventHref } from "../contracts";
import { alignmentLabel, type Alignment, type FieldStudy, type SourceRef, eventActors, getFieldView,
  verifyLayoutPair } from "./flagship-study";
import type { SceneContent } from "./flagship-types";

export function FlagshipNotes({ study, content, title, edit }: {
  study: FieldStudy; content?: SceneContent; title: string;
  edit?: (patch: Pick<Partial<FieldStudy>, "explanation" | "condition">) => void;
}) {
  const { evidence, comparisons, runs, case_id: caseId } = study;
  const [verified, setVerified] = useState<Record<string, { valid: boolean; detail?: string }>>({});
  useEffect(() => {
    const controller = new AbortController();
    const verify = async (ref: SourceRef) => {
      if (!Object.values(runs).includes(ref.run_id)) return { valid: false };
      try {
        const receipt = await getFieldView(ref.run_id, ref.tick, false, controller.signal);
        const event = receipt.events[ref.seq];
        const valid = receipt.run_id === ref.run_id && receipt.case_id === caseId &&
          receipt.case_version === ref.case_version && receipt.engine_version === ref.engine_version &&
          receipt.result_hash === ref.result_hash && receipt.frame.tick === ref.tick &&
          event?.seq === ref.seq && event.tick === ref.tick &&
          event.event_type === ref.event_type && (!ref.actor || eventActors(event).includes(ref.actor));
        const move = event?.changed_neighbors?.find(item => item.actor === ref.actor);
        const endings: Record<string, string> = { all_satisfied: "全部达到阈值", blocked: "无合规迁居", round_limit: "达到轮次上限" };
        const terminal = endings[String(event?.terminal)];
        const detail = move ? `同组／已占 ${move.before.join("/")} → ${move.after.join("/")}` : terminal;
        return { valid, detail: valid ? detail : undefined };
      } catch {
        return { valid: false };
      }
    };
    const save = (key: string, result: { valid: boolean; detail?: string }) => {
      if (!controller.signal.aborted) setVerified(previous => ({ ...previous, [key]: result }));
    };
    for (const ref of evidence) void verify(ref).then(result => save(JSON.stringify(ref), result));
    for (const pair of comparisons) void (async () => {
      try {
        if (pair.kind === "initial_layout") {
          save(JSON.stringify(pair), { valid: await verifyLayoutPair(pair, runs.baseline, controller.signal) });
          return;
        }
        const [baseValid, branchValid, alignment] = await Promise.all([
          verify(pair.base), verify(pair.branch),
          api<Alignment>(`/runs/${pair.base.run_id}/compare/${pair.branch.run_id}`, undefined, controller.signal),
        ]);
        save(JSON.stringify(pair), { valid: baseValid.valid && branchValid.valid && pair.base.run_id === runs.baseline &&
          alignment.rows.some(row => row.baseline?.tick === pair.base.tick && row.branch?.tick === pair.branch.tick &&
            alignmentLabel(alignment, row) === pair.label), detail: [baseValid.detail, branchValid.detail].filter(Boolean).join(" / ") });
      } catch {
        save(JSON.stringify(pair), { valid: false });
      }
    })();
    return () => controller.abort();
  }, [evidence, comparisons, runs, caseId]);

  const detailFor = (ref: object) => verified[JSON.stringify(ref)]?.detail;
  const label = (ref: SourceRef) => `事件 ${ref.seq} · ${ref.event_type}${ref.actor ? ` · ${ref.actor}` : ""}${
    detailFor(ref) ? ` · ${detailFor(ref)}` : ""}`;
  const records = Object.entries(study.records ?? {});
  const status = (ref: object) => {
    const result = verified[JSON.stringify(ref)]?.valid;
    return result === true ? "证据已核对" : result === false ? "证据待修复" : "正在核对证据";
  };
  const predictions = content?.scenes.flatMap(scene => scene.questions.filter(question => question.kind === "prediction")) ?? [];
  const forecastText: Record<string, string> = { increase: "上升", decrease: "下降", same: "相同", unknown: "不确定" };
  function download() {
    const predictionsText = predictions.map(question => {
      const answer = study.answers[question.id];
      const text = (id?: string) => question.options.find(option => option.id === id)?.label ?? "未作答";
      return `- ${question.prompt} 原预测：${text(answer?.original ?? answer?.first)}；最新：${text(answer?.latest)}`;
    });
    const formatted = [
      `# ${title} · 实验笔记`, "", `内容版本 ${study.content_version}`, "", ...predictionsText,
      ...(study.originalConfidence ? [`原预测信心：${study.originalConfidence}`] : []),
      "", "## 运行证据",
      ...evidence.map(ref => `- ${status(ref)} · ${ref.run_id} · ${label(ref)} · ${ref.engine_version} · ${ref.result_hash}`),
      ...comparisons.map(pair => `- ${status(pair)} · ${pair.label} · ${pair.base.run_id} 事件 ${pair.base.seq} / ${pair.branch.run_id} 事件 ${pair.branch.seq}`),
      ...records.map(([key, value]) => `- 手算记录 · ${key} · ${value}`),
      "", "## 机制解释", study.explanation, "", "## 成立条件与自评", study.condition,
    ];
    const uri = URL.createObjectURL(new Blob([formatted.join("\n")], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = uri;
    link.download = `${caseId}-实验笔记.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(uri), 1000);
  }

  return <section className="field-notes">
    <h2>{title}笔记</h2>
    {predictions.map(question => {
      const answer = study.answers[question.id];
      const text = (id?: string) => question.options.find(option => option.id === id)?.label ?? "未作答";
      return <p key={question.id}>原预测 {text(answer?.original ?? answer?.first)} · 最新 {text(answer?.latest)}
        {study.originalConfidence && ` · 原信心${study.originalConfidence}`}</p>;
    })}
    {Object.keys(study.forecasts).length > 0 && <details><summary>对照预测</summary>
      <ul>{Object.entries(study.forecasts).map(([key, value]) => <li key={key}>{key} · {forecastText[value] ?? value}</li>)}</ul>
    </details>}
    {!evidence.length && !comparisons.length && <p>可回到回放，引用一条实际事件或一个对照观察点。</p>}
    <ul>{evidence.map(ref => <li key={JSON.stringify(ref)}>{status(ref)} ·{" "}
      <a href={eventHref(caseId, ref.run_id, ref.seq)}>{label(ref)}</a></li>)}
      {comparisons.map(pair => <li key={JSON.stringify(pair)}>{status(pair)} · {pair.label} ·{" "}
        <a href={eventHref(caseId, pair.base.run_id, pair.base.seq)}>基准事件</a>{" / "}
        <a href={eventHref(caseId, pair.branch.run_id, pair.branch.seq)}>对照事件</a></li>)}</ul>
    {records.length > 0 && <details><summary>手算记录</summary>
      <ul>{records.map(([key, value]) => <li key={key}>{key} · {value}</li>)}</ul></details>}
    {Object.values(verified).some(item => !item.valid) && <p role="alert">部分运行证据无法核对。可先导出笔记，再恢复对应数据库。</p>}
    {edit ? <>
      <label className="field-input">机制解释 <textarea rows={4} maxLength={5000} value={study.explanation}
        onChange={event => edit({ explanation: event.target.value })}/></label>
      <label className="field-input">成立条件与自评 <textarea rows={3} maxLength={5000} value={study.condition}
        onChange={event => edit({ condition: event.target.value })}/></label>
    </> : <>
      {study.explanation && <p>{study.explanation}</p>}
      {study.condition && <p>{study.condition}</p>}
    </>}
    <div className="toolbar">
      {!edit && <a href={`/learn/${caseId}`}>继续课堂</a>}
      <button onClick={download}>导出可读笔记</button>
      <button onClick={() => downloadJson(`${caseId}-lesson-v2.json`, study)}>导出原始记录</button>
    </div>
  </section>;
}
