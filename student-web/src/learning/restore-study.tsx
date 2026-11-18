import { useState, type FormEvent } from "react";
import auctionCase from "../../../cases/double_auction/case.json";
import auctionLesson from "../../../cases/double_auction/lesson-v2.json";
import {
  auctionStages, auctionStudyKey, auctionView, checkpointLabel, compareAuction, emptyAuctionStudy, sameEvidence,
  type AuctionStudy,
} from "../cases/auction/auction-study";
import { api } from "../contracts";
import type { Course, LessonRun } from "../lesson-types";
import { alignmentLabel, eventActors, fieldStudyKey, parseFieldStudy, verifyLayoutPair,
  type Alignment, type SourceRef } from "./flagship-study";
import { isFieldFlagship, type FieldFlagship, type SceneContent } from "./flagship-types";

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const index = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const matches = (value: unknown, pattern: RegExp) => text(value) && pattern.test(value);
const badFormat = "无法识别新版笔记 JSON。请选用课堂导出的原始记录。";
const badRun = "运行或证据无法核对。请恢复原学习数据库后重试。";
const badVersion = "版本与当前课堂不匹配。请保留原 JSON，可用对应课堂版本打开。";

function parseAuctionStudy(value: Record<string, unknown>): AuctionStudy {
  const { scene, updatedAt, unlocked, bid, provider, runs, tick, revealed, pinned, responses, prediction,
    forecasts, comparison, evidence, notes } = value;
  const answer = (item: unknown) => record(item) && text(item.answer) && text(item.confidence) && text(item.maxPayment);
  if (!text(scene) || !auctionStages.includes(scene) || (updatedAt !== undefined && !index(updatedAt)) ||
      !index(unlocked) || unlocked < auctionStages.indexOf(scene) || unlocked >= auctionStages.length ||
      !text(bid) || (provider !== "rule" && provider !== "replay") || !index(tick) || !index(revealed) ||
      tick > revealed || !text(pinned) || !record(runs) || !Object.values(runs).every(id => matches(id, uuid)) ||
      !record(responses) || !Object.values(responses).every(item => record(item) && text(item.first) && text(item.latest)) ||
      (prediction !== null && (!record(prediction) || !answer(prediction.first) || !answer(prediction.latest))) ||
      !record(forecasts) || !text(forecasts.demand) || !text(forecasts.fee) || !record(notes) ||
      ![notes.explanation, notes.condition, notes.selfReview].every(text) ||
      (comparison !== null && (!record(comparison) || !["demand", "fee"].some(branch => comparison.branch === branch) ||
        !matches(comparison.run_id, uuid) || !text(comparison.checkpoint) || !index(comparison.tick) ||
        !index(comparison.baselineTick) || !matches(comparison.resultHash, hash) || !matches(comparison.baselineHash, hash) ||
        !text(comparison.engineVersion) || !text(comparison.caseVersion))) ||
      !Array.isArray(evidence) || evidence.length > 200 || !evidence.every(item => record(item) &&
        matches(item.run_id, uuid) && matches(item.result_hash, hash) && text(item.case_version) &&
        text(item.engine_version) && index(item.seq) && index(item.tick))) {
    throw new Error(badFormat);
  }
  return value as AuctionStudy;
}

type OriginalRun = Omit<LessonRun, "result"> & { bid?: number; provider_kind: string;
  result: LessonRun["result"] & { engine_version: string } };

async function loadRuns(
  runs: Record<string, string | undefined>, course: Pick<Course, "case_id" | "version" | "seed"> & { scenarios: { id: string }[] },
  engine: string, revealed: number, expectsBaseline: boolean, choice: (run: OriginalRun) => boolean,
) {
  const entries = Object.entries(runs);
  if ((!runs.baseline && (entries.length > 0 || expectsBaseline || revealed > 0)) ||
      entries.some(([scenario]) => !course.scenarios.some(option => option.id === scenario))) throw new Error(badRun);
  const loaded = await Promise.all(entries.map(async ([scenario, id]) => {
    const run = await api<OriginalRun>(`/runs/${id}`);
    if (run.run_id !== id || run.execution_status !== "completed" || run.case_id !== course.case_id ||
        run.scenario_id !== scenario || run.seed !== course.seed || !choice(run)) throw new Error(badRun);
    if (run.case_version !== course.version || run.result.engine_version !== engine) throw new Error(badVersion);
    return run;
  }));
  const baseline = loaded.find(run => run.scenario_id === "baseline");
  if (baseline && (baseline.parent_run_id !== null || revealed >= baseline.result.snapshots.length ||
      loaded.some(run => run !== baseline && (run.parent_run_id !== baseline.run_id ||
        run.result.root_hash !== baseline.result.root_hash)))) throw new Error(badRun);
  return new Map(loaded.map(run => [run.run_id, run]));
}

async function verifyAuction(study: AuctionStudy) {
  const runs = await loadRuns(study.runs, auctionCase, auctionLesson.engine_version, study.revealed, study.unlocked >= 3,
    run => run.bid === Number(study.bid) && run.provider_kind === study.provider);
  const baseline = study.runs.baseline;
  for (const item of study.evidence) {
    if (item.run_id !== baseline || item.tick >= (runs.get(item.run_id)?.result.snapshots.length ?? 0) ||
        !sameEvidence(item, (await auctionView(item.run_id, item.tick, "review")).evidence)) throw new Error(badRun);
  }
  const comparison = study.comparison;
  if (comparison) {
    const base = baseline && runs.get(baseline);
    const branch = runs.get(comparison.run_id);
    if (!base || !branch || study.runs[comparison.branch] !== branch.run_id ||
        branch.result_hash !== comparison.resultHash || base.result_hash !== comparison.baselineHash ||
        [base, branch].some(run => run.case_version !== comparison.caseVersion ||
          run.result.engine_version !== comparison.engineVersion)) throw new Error(badRun);
    const alignment = await compareAuction(base.run_id, branch.run_id);
    if (!alignment.rows.some(row => row.baseline?.tick === comparison.baselineTick &&
        row.branch?.tick === comparison.tick && checkpointLabel(row) === comparison.checkpoint)) throw new Error(badRun);
  }
}

async function verifyField(study: NonNullable<ReturnType<typeof parseFieldStudy>>, course: Course, content: SceneContent) {
  if (study.content_version !== content.content_version) throw new Error(badVersion);
  if (!course.action.options.some(option => option.id === study.action)) throw new Error(badFormat);
  const runs = await loadRuns(study.runs, course, content.engine_version, study.revealed, study.unlocked >= 3,
    run => run.action === study.action && run.provider_kind === "rule");
  function verify(ref: SourceRef) {
    const run = runs.get(ref.run_id);
    const event = run?.result.events[ref.seq];
    return run?.case_version === ref.case_version && run?.result.engine_version === ref.engine_version &&
      run?.result_hash === ref.result_hash && event?.seq === ref.seq && event.tick === ref.tick &&
      event.event_type === ref.event_type && (!ref.actor || eventActors(event).includes(ref.actor));
  }
  if (study.evidence.some(ref => !verify(ref))) throw new Error(badRun);
  for (const pair of study.comparisons) {
    if (pair.kind === "initial_layout") {
      if (!await verifyLayoutPair(pair, study.runs.baseline)) throw new Error(badRun);
      continue;
    }
    if (pair.base.run_id !== study.runs.baseline || !verify(pair.base) || !verify(pair.branch)) throw new Error(badRun);
    const alignment = await api<Alignment>(`/runs/${pair.base.run_id}/compare/${pair.branch.run_id}`);
    if (!alignment.rows.some(row => row.baseline?.tick === pair.base.tick &&
        row.branch?.tick === pair.branch.tick && alignmentLabel(alignment, row) === pair.label)) throw new Error(badRun);
  }
}

export function RestoreStudy({ courseFor, contentFor, onRestore }: {
  courseFor: (caseId: FieldFlagship) => Course;
  contentFor: (caseId: FieldFlagship) => SceneContent;
  onRestore: () => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const source = new FormData(form).get("record");
    if (!(source instanceof File) || !source.size) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      if (source.size > 2 * 1024 * 1024) throw new Error("笔记文件须小于 2 MB。");
      let value: unknown;
      try { value = JSON.parse(await source.text()); } catch { throw new Error(badFormat); }
      if (!record(value)) throw new Error(badFormat);
      const caseId = value.case_id;
      let key: string;
      if (text(caseId) && isFieldFlagship(caseId)) {
        const study = parseFieldStudy(caseId, value);
        if (!study || !study.updatedAt) throw new Error(badFormat);
        key = fieldStudyKey(caseId);
        await verifyField(study, courseFor(caseId), contentFor(caseId));
      } else if (caseId === undefined && typeof value.scene === "string") {
        const study = parseAuctionStudy(value);
        key = auctionStudyKey;
        await verifyAuction(study);
      } else throw new Error(badFormat);
      const existing = localStorage.getItem(key);
      const serialized = JSON.stringify(value);
      if (existing !== serialized) {
        if (existing !== null && !(key === auctionStudyKey && existing === JSON.stringify(emptyAuctionStudy))) {
          throw new Error("此浏览器已有该课的新版记录，未导入。可在另一浏览器配置中恢复此备份。");
        }
        localStorage.setItem(key, serialized);
      }
      onRestore();
      form.reset();
      setMessage("新版学习记录已恢复。可打开下方笔记继续课堂。");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "导入失败，请保留原文件。");
    } finally {
      setBusy(false);
    }
  }
  return <form onSubmit={restore} className="app-empty">
    <label>恢复新版笔记（JSON） <input name="record" type="file" accept=".json,application/json" required disabled={busy}/></label>
    <button disabled={busy}>{busy ? "正在核对" : "导入新版笔记"}</button>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </form>;
}
