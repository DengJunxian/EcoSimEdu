import { useEffect, useState } from "react";
import { downloadJson, eventHref, traceHref } from "../../contracts";
import { auctionView, checkpointLabel, compareAuction, readAuctionStudy, sameEvidence,
  type AuctionEvidence, type AuctionStudy } from "./auction-study";

const evidenceKey = (item: AuctionEvidence) => JSON.stringify(item);
const resultOf = (valid: boolean) => valid ? "证据已核对" : "证据待修复";

export function AuctionNotes({ value, edit }: {
  value?: AuctionStudy; edit?: (notes: AuctionStudy["notes"]) => void;
} = {}) {
  const [saved] = useState(readAuctionStudy);
  const study = value ?? saved;
  const items = study?.evidence;
  const comparison = study?.comparison;
  const baseline = study?.runs.baseline;
  const comparisons = study?.runs;
  const [verified, setVerified] = useState<Record<string, boolean | undefined>>({});
  const [comparisonVerified, setComparisonVerified] = useState<{ id: string; valid: boolean }>();
  const comparisonId = comparison && `${baseline}/${JSON.stringify(comparison)}`;
  useEffect(() => {
    let active = true;
    for (const item of items ?? []) {
      const key = evidenceKey(item);
      if (item.run_id !== baseline || !Number.isInteger(item.tick) || item.tick < 0) {
        setVerified(current => ({ ...current, [key]: false }));
        continue;
      }
      auctionView(item.run_id, item.tick, "review").then(view => sameEvidence(item, view.evidence))
        .catch(() => false).then(valid => {
          if (active) setVerified(current => ({ ...current, [key]: valid }));
        });
    }
    return () => { active = false; };
  }, [items, baseline]);
  useEffect(() => {
    if (!comparisonId || !comparison || !baseline) return;
    let active = true;
    const expectedBranch = comparisons?.[comparison.branch];
    const check = expectedBranch === comparison.run_id
      ? Promise.all([
        compareAuction(baseline, comparison.run_id), auctionView(baseline, comparison.baselineTick),
        auctionView(comparison.run_id, comparison.tick),
      ]).then(([data, baseView, branchView]) =>
        baseView.result_hash === comparison.baselineHash && branchView.result_hash === comparison.resultHash &&
        [baseView, branchView].every(view => view.case_version === comparison.caseVersion &&
          view.engine_version === comparison.engineVersion) && data.rows.some(row =>
          row.baseline?.tick === comparison.baselineTick && row.branch?.tick === comparison.tick &&
          checkpointLabel(row) === comparison.checkpoint)).catch(() => false)
      : Promise.resolve(false);
    check.then(valid => { if (active) setComparisonVerified({ id: comparisonId, valid }); });
    return () => { active = false; };
  }, [comparison, comparisonId, comparisons, baseline]);
  if (!study) return null;
  function verification(item: AuctionEvidence) {
    const value = verified[evidenceKey(item)];
    return value === undefined ? "正在核对证据" : resultOf(value);
  }
  const branchStatus = comparisonVerified?.id === comparisonId && comparisonVerified ?
    resultOf(comparisonVerified.valid) : "正在核对证据";
  const predictionText: Record<string, string> = { yes: "会成交", no: "不会成交", unknown: "不确定" };
  const prediction = study.prediction && [
    `原预测：${predictionText[study.prediction.first.answer]}${study.prediction.first.confidence ? `，信心${study.prediction.first.confidence}` : ""}`,
    `最近预测：${predictionText[study.prediction.latest.answer]}${study.prediction.latest.confidence ? `，信心${study.prediction.latest.confidence}` : ""}`,
  ].join("；");
  const noteLabels = { explanation: "机制解释", condition: "成立条件", selfReview: "自评与下一问" };
  function exportMarkdown() {
    if (!study) return;
    const lines = ["# 双向拍卖实验笔记", "", prediction || "尚未记录预测", "",
      ...study.evidence.map(item => `- ${verification(item)} · 运行 ${item.run_id} · ${item.engine_version} · 事件 ${item.seq} · ${item.actor_id} · ${item.value} ${item.unit}`),
      ...(comparison ? [`- ${branchStatus} · ${comparison.branch} · ${comparison.checkpoint} · 运行 ${comparison.run_id} · 事件 ${comparison.tick}`] : []),
      ...Object.entries(noteLabels).flatMap(([key, label]) => ["", `## ${label}`, study.notes[key as keyof typeof noteLabels]])];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "双向拍卖实验笔记.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="auction-notes">
    <h2>双向拍卖笔记</h2>
    {prediction && <p>{prediction}</p>}
    <ul>
      {study.evidence.map(item => <li key={`${item.run_id}/${item.seq}`}>
        {verification(item)} · {item.kind === "trade" ? "成交" : "收盘撤单"} · 事件 {item.seq} · {item.actor_id} · {item.value} {item.unit}{" "}
        <a href={eventHref("double_auction", item.run_id, item.seq)}>查看原始事件</a>
      </li>)}
      {comparison && <li>{branchStatus} · {comparison.branch === "fee" ? "交易收费" : "需求上移"} · {comparison.checkpoint}{" "}
        <a href={traceHref("double_auction", comparison.run_id, comparison.tick)}>查看对照事件</a></li>}
    </ul>
    {!study.evidence.length && !comparison && <p>尚无引用。可在交易大厅保存成交或收盘撤单，再保存一个制度对照观察点。</p>}
    {study.evidence.some(item => verification(item) === "证据待修复") || branchStatus === "证据待修复" ?
      <p role="alert">本地运行缺失或证据与运行不符。可导出草稿，恢复对应运行后重新打开。</p> : null}
    {edit && <p>自评时检查三件事：证据是否指向同一笔交易或未成交，算式是否对账，条件改变后结论是否还成立。</p>}
    {Object.entries(noteLabels).map(([name, label]) => {
      const key = name as keyof typeof noteLabels;
      return edit ? <label className="auction-field" key={key}>{label}
        <textarea value={study.notes[key]} onChange={event => edit({ ...study.notes, [key]: event.target.value })} maxLength={5000} rows={3}/>
      </label> : study.notes[key] && <div key={key}><h3>{label}</h3><p>{study.notes[key]}</p></div>;
    })}
    <div className="toolbar">
      {!edit && <a href="/learn/double_auction">继续课堂</a>}
      <button onClick={exportMarkdown}>导出可读笔记</button>
      <button onClick={() => downloadJson("double-auction-lesson-v2.json", study)}>导出原始记录</button>
    </div>
  </section>;
}
