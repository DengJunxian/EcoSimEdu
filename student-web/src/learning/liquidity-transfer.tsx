import { useEffect, useRef, useState } from "react";
import { catalog } from "../catalog";
import { downloadJson, eventHref } from "../contracts";
import { runLesson, type Course } from "../lesson-types";
import { getFieldView } from "./flagship-study";
import { profileId } from "./learner-repository";
import { checkLabels, readEvidenceChecks, type EvidenceCheck } from "./evidence-checks";
import { dimensions, exposeTransferHint, importTransfer, readTransfers, saveTransfer, saveTransferReview,
  transferCases, transferEvent, verifyTransfer, type TransferRecord } from "./transfer-record";

const courses = transferCases.map(caseId => catalog.find(course => course.case_id === caseId) as Course);
const units = ["资金单位", "股"];
const exposureLabel = { independent: "首次无提示", assisted: "使用过提示", repeated: "重复提交" };
type Evidence = NonNullable<ReturnType<typeof transferEvent>>;

function reviewSummary(scores: number[], verdict: "pass" | "revise") {
  return `${scores.reduce((sum, score) => sum + score, 0)} 分，${verdict === "pass" ? "达标" : "待修订"}。`;
}

function Submission({ entry, evidence, teacher = false }: { entry: TransferRecord; evidence?: Evidence[]; teacher?: boolean }) {
  const latest = entry.reviews.at(-1);
  const exportKind = teacher && latest ? "教师复核" : "迁移作答";
  return <section aria-label="已提交作答">
    <p>{exposureLabel[entry.attempt.exposure]} · {latest ? "已复核" : "待教师复核"}</p>
    {entry.origin === "imported" && <p>从文件导入 · 帮助状态沿用作答记录。</p>}
    <ul>{entry.attempt.source_refs.map((ref, i) => <li key={ref.run_id}>
      <a href={eventHref(transferCases[i], ref.run_id, ref.seq)}>打开{courses[i].title}来源</a>
      {" · "}事件 {ref.seq}{evidence && <> · {evidence[i].before} → {evidence[i].after} {units[i]} · {evidence[i].summary}</>}
    </li>)}</ul>
    <dl>{entry.attempt.answers.map((answer, i) => <div key={dimensions[i]}><dt>{dimensions[i]}</dt><dd>{answer}</dd></div>)}</dl>
    {entry.reviews.length > 0 && <details open><summary>教师复核记录</summary>
      <ol>{entry.reviews.map((review, i) => <li key={i}>
        <strong>{review.scores.reduce((a, b) => a + b, 0)} / 8 · {review.verdict === "pass" ? "达标" : "待修订"}</strong>
        <p>{dimensions.map((label, j) => `${label} ${review.scores[j]}`).join(" · ")}。{review.comment}</p>
        <time dateTime={review.reviewed_at}>{new Date(review.reviewed_at).toLocaleString()}</time>
      </li>)}</ol>
    </details>}
    <button type="button" onClick={() => downloadJson(`EcoSimEdu-${exportKind}.json`, {
      kind: "ecosimedu-transfer", attempt: entry.attempt, reviews: entry.reviews,
    })}>导出{exportKind}</button>
  </section>;
}

export function LiquidityTransfer({ teacher = false }: { teacher?: boolean }) {
  const [profile, setProfile] = useState("");
  const [entries, setEntries] = useState<TransferRecord[]>([]);
  const [focused, setFocused] = useState("");
  const [file, setFile] = useState<File>();
  const [available, setAvailable] = useState<Evidence[][]>([]);
  const [choices, setChoices] = useState(["", ""]);
  const [answers, setAnswers] = useState(dimensions.map(() => ""));
  const [scores, setScores] = useState(dimensions.map(() => ""));
  const [verdict, setVerdict] = useState<"" | "pass" | "revise">("");
  const [comment, setComment] = useState("");
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [progress, setProgress] = useState("");
  const [savedNotice, setSavedNotice] = useState<{ message: string; origin: Element | null }>();
  const receipt = useRef<HTMLHeadingElement>(null);
  const [evidence, setEvidence] = useState<{ id: string; rows: Evidence[] }>();
  const [checks, setChecks] = useState<EvidenceCheck[]>([]);
  const entry = entries.find(item => item.id === focused) ?? entries[0];
  const verified = evidence?.id === entry?.id ? evidence?.rows : undefined;
  const selected = available.map((events, i) => events.find(row => String(row.ref.seq) === choices[i]));
  const independent = entries.filter(record => record.origin === "local" && record.attempt.exposure === "independent");
  const assessed = independent.filter(record => record.reviews.length > 0);

  useEffect(() => {
    if (!savedNotice) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body || document.activeElement === savedNotice.origin) {
        receipt.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [savedNotice]);

  useEffect(() => {
    let active = true;
    profileId(false).then(async id => {
      const [records, audit] = await Promise.all([readTransfers(id), teacher ? readEvidenceChecks(id) : []]);
      if (active) { setProfile(id); setEntries(records); setChecks(audit); }
    }).catch(() => { if (active) setProblem("本机学习记录暂不可用。"); });
    return () => { active = false; };
  }, [teacher]);

  useEffect(() => {
    if (!entry || !teacher) return;
    const controller = new AbortController();
    verifyTransfer(entry.attempt.source_refs, controller.signal).then(rows => {
      if (!controller.signal.aborted) setEvidence({ id: entry.id, rows });
    }).catch(() => {
      if (!controller.signal.aborted) setProblem("当前服务无法核对原始运行。请连接保存这两次运行的课堂服务。");
    });
    return () => controller.abort();
  }, [entry, teacher]);

  async function run(action: (origin: Element | null) => Promise<void>) {
    const origin = document.activeElement;
    setProblem("");
    setBusy(true);
    try { await action(origin); }
    catch (error) { setProblem(error instanceof Error ? error.message : "操作失败，请重试。"); }
    finally { setBusy(false); }
  }

  const importControls = <div className="toolbar">
    <label>{teacher ? "导入迁移作答" : "导入教师复核"} <input type="file" accept=".json,application/json"
      onChange={e => setFile(e.target.files?.[0])}/></label>
    <button type="button" disabled={!file || !profile || busy} onClick={() => void run(async origin => {
      setSavedNotice(undefined);
      if (!file || file.size > 250_000) throw new Error("请选择有效的迁移作答文件。");
      const data = JSON.parse(await file.text());
      const imported = await importTransfer(profile, data);
      setFocused(imported.id); setEntries(await readTransfers(profile));
      const latest = imported.reviews.at(-1);
      setSavedNotice({ origin, message: teacher ? "双来源作答已核对并导入。" : data.reviews?.length && latest
        ? `教师复核已导入。${reviewSummary(latest.scores, latest.verdict)}` : "迁移作答已导入。文件包含 0 条教师复核。" });
    })}>{teacher ? "核对并导入作答" : "核对并导入复核"}</button>
  </div>;

  return <section aria-labelledby="liquidity-transfer-title" id="liquidity-transfer" className="education-task">
    <h2 id="liquidity-transfer-title">{teacher ? "复核银行兑付与订单簿深度" : "银行兑付与订单簿深度"}</h2>
    <p className="education-status" role="status">{progress}</p>
    {problem && <p role="alert">{problem}</p>}
    {teacher ? <>
      <p>核对原始记录后，按四个维度分别给分。0 分为缺失或错误，1 分为部分成立，2 分为准确且有依据。</p>
      {importControls}
      {entries.length > 1 && <label>选择作答 <select value={entry?.id ?? ""} onChange={e => {
        setFocused(e.target.value); setProblem(""); setSavedNotice(undefined);
        setScores(dimensions.map(() => "")); setVerdict(""); setComment("");
      }}>
        {entries.map(item => <option key={item.id} value={item.id}>
          {new Date(item.attempt.submitted_at).toLocaleString()} · {item.attempt.id.slice(0, 8)}
        </option>)}
      </select></label>}
      {entry && <>
        {savedNotice && <h3 ref={receipt} tabIndex={-1}>{savedNotice.message}</h3>}
        <Submission entry={entry} evidence={verified} teacher/>
        <form className="liquidity-form" onSubmit={e => {
          e.preventDefault();
          if (!verdict || !verified || scores.some(score => score === "") || !comment.trim()) return;
          void run(async origin => {
            const values = scores.map(Number);
            await saveTransferReview(entry, values, verdict, comment);
            setEntries(await readTransfers(profile));
            setScores(dimensions.map(() => "")); setVerdict(""); setComment("");
            setSavedNotice({ origin, message: `教师复核已保存。${reviewSummary(values, verdict)}` });
          });
        }}>
          <div className="liquidity-scores">{dimensions.map((label, i) => <label key={label}>{label}
            <select value={scores[i]} required onChange={e => setScores(scores.map((value, j) => j === i ? e.target.value : value))}>
              <option value="">选择分数</option>{[0, 1, 2].map(score => <option key={score} value={score}>{score}</option>)}
            </select>
          </label>)}</div>
          <label>复核结论 <select required value={verdict} onChange={e => setVerdict(e.target.value as typeof verdict)}>
            <option value="">选择结论</option><option value="pass">达标</option><option value="revise">待修订</option>
          </select></label>
          <label>复核评语 <textarea required maxLength={800} value={comment} onChange={e => setComment(e.target.value)}/></label>
          <button disabled={!verified || busy}>保存教师复核</button>
        </form>
      </>}
      <details><summary>本机任务核对</summary>
        <dl>
          <dt>独立迁移达标／已人工复核</dt>
          <dd>{assessed.filter(record => record.reviews.at(-1)?.verdict === "pass").length} / {assessed.length}
            {" · "}待复核 {independent.length - assessed.length}</dd>
          {(Object.keys(checkLabels) as EvidenceCheck["kind"][]).map(kind => {
            const attempts = checks.filter(check => check.kind === kind);
            return <div key={kind}><dt>{checkLabels[kind]}通过／已提交</dt>
              <dd>{attempts.filter(check => check.passed).length} / {attempts.length}</dd></div>;
          })}
        </dl>
        <p>计数只涵盖本浏览器已提交的记录。首次无提示迁移按最近一次教师结论统计，跨课导入作答单独复核。</p>
      </details>
    </> : <>
      <p>分别找出一次银行现金因实付下降和一次订单簿买方深度下降。用两条运行证据解释各自的约束、传导和可推广边界。</p>
      <div className="toolbar">
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          setProgress("正在运行两门课的规则实验。");
          const pairs = await Promise.all(courses.map(async course => {
            const simulation = await runLesson(course, "baseline", course.action.default, crypto.randomUUID());
            const view = await getFieldView(simulation.run_id, "close");
            return view.events.flatMap(event => {
              const candidate = transferEvent(view, event);
              return candidate ? [candidate] : [];
            });
          }));
          setChoices(["", ""]); setAvailable(pairs);
          setProgress("两份运行已生成。请分别选择硅谷银行和闪电崩盘的来源事件。");
        })}>运行两门课的规则实验</button>
        <button type="button" disabled={!profile || busy || hint} onClick={() => void run(async () => {
          await exposeTransferHint(); setHint(true);
        })}>看证据提示</button>
        <a href="/practice?review=svb-flash">教师复核</a>
      </div>
      {hint && <p>先对比事件前后数值，再核对是资金实际到账、股票成交，还是尚未成交的买单被撤回。</p>}
      {available.length === 2 && <form className="liquidity-form" onSubmit={e => {
        e.preventDefault();
        const [bank, market] = selected;
        if (!bank || !market || answers.some(answer => !answer.trim())) return;
        void run(async origin => {
          const saved = await saveTransfer(profile, [bank.ref, market.ref], answers);
          setFocused(saved.id); setEntries(await readTransfers(profile));
          setSavedNotice({ origin, message: "双来源解释已保存，待教师复核。" });
        });
      }}>
        {available.map((events, i) => <div key={transferCases[i]}>
          <label>{courses[i].title}事件 <select required value={choices[i]} disabled={!events.length}
            onChange={e => setChoices(choices.map((value, j) => j === i ? e.target.value : value))}>
            <option value="">选择事件</option>
            {events.map(row => <option value={row.ref.seq} key={row.ref.seq}>
              事件 {row.ref.seq} · {row.before} → {row.after} {units[i]} · {row.summary}
            </option>)}
          </select></label>
          {!events.length && <p>这次运行没有符合条件的事件。</p>}
          {selected[i] && <a href={eventHref(transferCases[i], selected[i]!.ref.run_id, selected[i]!.ref.seq)}
            target="_blank" rel="noreferrer">核对{courses[i].title}事件</a>}
        </div>)}
        {dimensions.map((label, i) => <label key={label}>{label}
          <textarea value={answers[i]} required maxLength={800}
            onChange={e => setAnswers(answers.map((answer, j) => j === i ? e.target.value : answer))}/>
        </label>)}
        <button disabled={!profile || busy || selected.some(row => !row)}>提交双来源解释</button>
      </form>}
      {entry && <>
        {savedNotice && <h3 ref={receipt} tabIndex={-1}>{savedNotice.message}</h3>}
        <Submission entry={entry}/>{importControls}
      </>}
    </>}
  </section>;
}
