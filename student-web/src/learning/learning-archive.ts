import { api } from "../contracts";
import { isSourceRef } from "./flagship-study";
import { emergenceExplanationTasks, evidenceKeyFor, evidenceUseLabels } from "./inquiry";
import { worksheetLabels } from "./worksheet-attempt";
import { evaluate } from "./assessment";
import type { Attempt, Exposure, LearningPackage } from "./education-types";
import { emptySession, result, transact } from "./learner-repository";
import { parseTransfer } from "./transfer-record";
import { parseEvidenceCheck } from "./evidence-checks";

const archiveKind = "ecosimedu-learning-export";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const row = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === "string");

function exposure(value: unknown): value is Exposure {
  return row(value) && Number.isInteger(value.max_hint_level) && Number(value.max_hint_level) >= 0 &&
    Number(value.max_hint_level) <= 3 &&
    ["answer_seen", "exemplar_seen", "prior_feedback_for_variant", "exposure_unknown"].every(key => typeof value[key] === "boolean") &&
    (value.solution_seen_at === undefined || date(value.solution_seen_at));
}

const archiveStores = ["sessions", "explanations", "experiments", "reviews", "migration_backups",
  "transfers", "evidence_checks"] as const;
type ArchiveStore = typeof archiveStores[number];
type ArchiveRecord = Record<string, unknown> & { id: string };

function owned(entry: Record<string, unknown>, profile: string) {
  return entry.profile === profile || entry.local_profile_id === profile ||
    typeof entry.session_id === "string" && entry.session_id.startsWith(`["${profile}",`);
}

export async function exportLearning(profile: string) {
  return transact(["attempts", "archived_attempts", "exposures", ...archiveStores], "readonly", async tx => {
    const active = await result(tx.objectStore("attempts").getAll()) as Attempt[];
    const archived = await result(tx.objectStore("archived_attempts").getAll()) as Attempt[];
    const attempts = [...active, ...archived].filter(attempt => attempt.local_profile_id === profile);
    const records: Partial<Record<ArchiveStore, Record<string, unknown>[]>> = {};
    for (const name of archiveStores) {
      const values = await result(tx.objectStore(name).getAll()) as Record<string, unknown>[];
      records[name] = values.filter(entry => owned(entry, profile));
    }
    const receipts = records.migration_backups!.map(({ legacy_key, digest, migrated_at }) => ({ legacy_key, digest, migrated_at }));
    const exposures = await result(tx.objectStore("exposures").getAll()) as Exposure[];
    return { kind: archiveKind, schema_version: 1, exported_at: new Date().toISOString(), attempts, receipts, records, exposures };
  });
}

const caseKey = /^[a-z_]{1,48}$/;
const phaseKey = /^(intro|predict|bid|observe|explain|compare|notebook)$/;
const semver = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;

function portableRecords(records: unknown, profile: string) {
  const packed: [ArchiveStore, ArchiveRecord][] = [];
  if (records === undefined) return packed;
  const reject = () => { throw new Error("备份中的活动、作品或复习记录不符合版本合同。"); };
  if (!row(records)) throw new Error("备份记录格式错误。");
  for (const name of archiveStores) {
    const entries = records[name];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > 10000) reject();
    for (const entry of entries as unknown[]) {
      if (!row(entry) || typeof entry.id !== "string" || entry.id.length > 300) throw new Error("备份记录缺少身份。");
      if (name === "transfers") {
        packed.push([name, parseTransfer(entry.profile === profile ? entry : { ...entry, origin: "imported" }, profile)]);
        continue;
      }
      if (name === "evidence_checks") {
        packed.push([name, parseEvidenceCheck(entry, profile)]);
        continue;
      }
      if (name === "migration_backups") {
        if (typeof entry.legacy_key !== "string" || !/^civitas\/[a-z_]+\/lesson-v2$/.test(entry.legacy_key) ||
            typeof entry.digest !== "string" || !/^[0-9a-f]{64}$/.test(entry.digest) ||
            typeof entry.original !== "string" || !date(entry.migrated_at) ||
            typeof entry.session_id !== "string" || !row(JSON.parse(entry.original))) reject();
        const [, caseId, version] = JSON.parse(String(entry.session_id)) as string[];
        if (!caseKey.test(caseId) || !semver.test(version)) reject();
        packed.push([name, { ...entry, id: JSON.stringify([profile, entry.legacy_key, entry.digest]),
          session_id: JSON.stringify([profile, caseId, version]), exposure_unknown: true }]);
        continue;
      }
      const caseId = String(entry.case_id);
      const version = String(entry.content_version);
      if (!caseKey.test(caseId) || (name !== "experiments" && !semver.test(version))) reject();
      if (name === "sessions") {
        if (entry.schema_version !== 1 || !strings(entry.accessible_activity_ids) || !strings(entry.return_stack) ||
            entry.return_stack.length > 1 || !row(entry.phase_cursor) || !row(entry.activity_states) ||
            !Object.entries(entry.phase_cursor).every(([key, value]) => phaseKey.test(key) && typeof value === "string") ||
            !Object.values(entry.activity_states).every(value => typeof value === "string" &&
              ["available", "in_progress", "submitted", "completed", "skipped"].includes(value))) reject();
        packed.push([name, { ...entry, id: JSON.stringify([profile, caseId, version]), local_profile_id: profile }]);
      } else if (name === "explanations") {
        const task = entry.task_id;
        if (entry.version !== 1 || !strings(entry.outcome_ids) || !Array.isArray(entry.source_refs) ||
            entry.source_refs.length > 200 || !entry.source_refs.every(isSourceRef) || !date(entry.updated_at) ||
            !["claim", "micro", "aggregation", "conditions", "alternative_explanation"].every(key =>
              typeof entry[key] === "string" && String(entry[key]).length <= 1000) ||
            (entry.experiment_card_id !== undefined && !uuid.test(String(entry.experiment_card_id))) ||
            (entry.structure_help_used !== undefined && typeof entry.structure_help_used !== "boolean") ||
            (task !== undefined && (!Object.hasOwn(emergenceExplanationTasks, caseId) ||
              task !== emergenceExplanationTasks[caseId as keyof typeof emergenceExplanationTasks]))) reject();
        const sources = (entry.source_refs as unknown[]).filter(isSourceRef);
        if (entry.source_uses !== undefined && (!row(entry.source_uses) || Object.entries(entry.source_uses)
          .some(([key, use]) => typeof use !== "string" || !Object.hasOwn(evidenceUseLabels, use) ||
            !sources.some(source => evidenceKeyFor(source) === key)))) reject();
        packed.push([name, { ...entry, id: JSON.stringify(task ? [profile, caseId, version, task] :
          [profile, caseId, version]), profile }]);
      } else if (name === "experiments") {
        if (entry.version !== 1 || !uuid.test(entry.id) || !date(entry.created_at) ||
            !strings(entry.outcome_metric_ids) || !["planned", "completed"].includes(String(entry.status)) ||
            !["question", "hypothesis", "treatment_plan", "controlled_inputs", "falsification"].every(key =>
              typeof entry[key] === "string" && String(entry[key]).length <= 600) ||
            (entry.status === "completed" && (!Array.isArray(entry.source_refs) || entry.source_refs.length !== 2 ||
              !entry.source_refs.every(isSourceRef) || !row(entry.run_ids) ||
              !uuid.test(String(entry.run_ids.baseline)) || !uuid.test(String(entry.run_ids.branch)) ||
              !row(entry.actual_conditions) ||
              !row(entry.actual_conditions.treatments) || !["initial_treatment", "policy_comparison"].includes(String(entry.actual_conditions.class)) ||
              !row(entry.alignment_ref)))) reject();
        packed.push([name, { ...entry, id: entry.id, profile }]);
      } else {
        if (entry.rule_version !== 1 || !strings(entry.based_on_attempt_ids) || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.due_at)) ||
            !["scheduled", "completed", "paused"].includes(String(entry.status)) ||
            typeof entry.outcome_id !== "string" || !entry.outcome_id.startsWith(caseId + ".")) reject();
        packed.push([name, { ...entry, id: JSON.stringify([profile, version, entry.outcome_id]), profile }]);
      }
    }
  }
  return packed;
}

function verifiedAttempt(value: unknown, pack: LearningPackage, profile: string): Attempt {
  if (!row(value) || value.schema_version !== 1 || typeof value.id !== "string" || !uuid.test(value.id) ||
      typeof value.local_profile_id !== "string" || !uuid.test(value.local_profile_id) ||
      value.session_id !== JSON.stringify([value.local_profile_id, value.case_id, value.content_version]) ||
      !date(value.submitted_at) || !exposure(value.exposure) ||
      !Array.isArray(value.source_refs) || value.source_refs.length ||
      pack.case_id !== value.case_id || pack.content_version !== value.content_version) {
    throw new Error("记录身份、运行引用或课程版本无法核对。可保留原文件。");
  }
  const activity = pack.activities.find(entry => entry.id === value.activity_id);
  const item = pack.items.find(entry => entry.id === value.item_id);
  if (!activity || !item || activity.content_ref !== item.id || value.item_version !== item.version ||
      value.variant_id !== item.variant_id || value.family_id !== item.family_id ||
      value.assessment_role !== item.assessment_role || JSON.stringify(value.outcome_ids) !== JSON.stringify(item.outcome_ids)) {
    throw new Error("题目版本或活动引用无法核对。");
  }
  const options = (item.response_schema.options ?? []).map(option => option.id);
  if (!strings(value.presented_order) || JSON.stringify([...value.presented_order].sort()) !== JSON.stringify(options.sort())) {
    throw new Error("选项记录无法核对。");
  }
  const response = value.response;
  const fields = item.response_schema.fields ?? [];
  const validResponse = response === null || {
    numeric: Array.isArray(response) && response.length === fields.length && response.every(Number.isFinite),
    single_choice: typeof response === "string" && options.includes(response),
    ordering: strings(response) && JSON.stringify([...response].sort()) === JSON.stringify(options),
    structured_explanation: row(response) && Object.keys(response).length === fields.length &&
      fields.every(field => typeof response[field.id] === "string" && String(response[field.id]).length <= 800),
  }[item.kind];
  const evidenceClass = value.exposure.prior_feedback_for_variant ? "repeated" : value.exposure.exposure_unknown ||
    value.exposure.answer_seen || value.exposure.exemplar_seen || value.exposure.max_hint_level ? "assisted" : "independent";
  if (!validResponse || value.evidence_class !== evidenceClass ||
      canonical(value.evaluation) !== canonical(evaluate(item, response as Attempt["response"]))) {
    throw new Error("作答或原评价无法核对。");
  }
  return {
    id: value.id, schema_version: 1, local_profile_id: profile, session_id: emptySession(pack, profile).id,
    case_id: pack.case_id, content_version: pack.content_version, activity_id: activity.id, item_id: item.id,
    item_version: item.version, variant_id: item.variant_id, family_id: item.family_id, outcome_ids: item.outcome_ids,
    assessment_role: item.assessment_role, presented_order: value.presented_order, response: response as Attempt["response"],
    submitted_at: value.submitted_at as string, exposure: {
      max_hint_level: value.exposure.max_hint_level, answer_seen: value.exposure.answer_seen,
      exemplar_seen: value.exposure.exemplar_seen, prior_feedback_for_variant: value.exposure.prior_feedback_for_variant,
      exposure_unknown: value.exposure.exposure_unknown, solution_seen_at: value.exposure.solution_seen_at,
    }, evidence_class: evidenceClass,
    evaluation: value.evaluation as Attempt["evaluation"], source_refs: [],
  };
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => row(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}

function archivedAttempt(value: Record<string, unknown>, profile: string): Attempt {
  if (value.schema_version !== 1 || !uuid.test(String(value.id)) || !uuid.test(String(value.local_profile_id)) ||
      !semver.test(String(value.content_version)) || !date(value.submitted_at) || !exposure(value.exposure) ||
      !strings(value.outcome_ids) || !strings(value.presented_order) || !row(value.evaluation) ||
      !["numeric_v1", "choice_v1", "ordering_v1", "structure_v1"].includes(String(value.evaluation.evaluator)) ||
      !Array.isArray(value.source_refs) || !value.source_refs.every(isSourceRef) ||
      value.session_id !== JSON.stringify([value.local_profile_id, value.case_id, value.content_version])) {
    throw new Error("无法保留身份不完整的旧版作答。");
  }
  return { ...value, local_profile_id: profile,
    session_id: JSON.stringify([profile, value.case_id, value.content_version]) } as Attempt;
}

type SavedExposure = Exposure & { id: string };

function archiveExposures(value: unknown): SavedExposure[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10000) throw new Error("作答帮助记录格式错误。");
  return value.map(entry => {
    if (!row(entry) || typeof entry.id !== "string" || !exposure(entry)) throw new Error("作答帮助记录缺少身份。");
    const ids: unknown = JSON.parse((entry as SavedExposure).id);
    if (!strings(ids) || ids.length !== 2 || !caseKey.test(ids[0]) || !/^[a-z0-9_-]{1,120}$/.test(ids[1])) {
      throw new Error("作答帮助记录的案例或变式无法核对。");
    }
    return { id: JSON.stringify(ids), max_hint_level: entry.max_hint_level, answer_seen: entry.answer_seen,
      exemplar_seen: entry.exemplar_seen, prior_feedback_for_variant: entry.prior_feedback_for_variant,
      solution_seen_at: entry.solution_seen_at, exposure_unknown: entry.exposure_unknown };
  });
}

async function mergeExposure(exposures: IDBObjectStore, entry: SavedExposure) {
  const prior = await result(exposures.get(entry.id)) as Exposure | undefined;
  await result(exposures.put({
    id: entry.id, max_hint_level: Math.max(prior?.max_hint_level ?? 0, entry.max_hint_level),
    answer_seen: !!prior?.answer_seen || entry.answer_seen, exemplar_seen: !!prior?.exemplar_seen || entry.exemplar_seen,
    prior_feedback_for_variant: !!prior?.prior_feedback_for_variant || entry.prior_feedback_for_variant,
    exposure_unknown: !!prior?.exposure_unknown || entry.exposure_unknown,
    solution_seen_at: prior?.solution_seen_at ?? entry.solution_seen_at,
  }));
}

export async function restoreLearning(profile: string, data: unknown) {
  if (!row(data) || data.kind !== archiveKind || data.schema_version !== 1 || !Array.isArray(data.attempts) ||
      data.attempts.length > 10000 || !data.attempts.every(attempt => row(attempt) &&
        typeof attempt.case_id === "string" && /^[a-z_]{1,48}$/.test(attempt.case_id))) {
    throw new Error("请选择从本平台导出的学习记录 JSON。");
  }
  const cases = [...new Set(data.attempts.map(attempt => attempt.case_id as string))];
  const packs = await Promise.allSettled(cases.map(caseId => api<LearningPackage>(`/cases/${caseId}/lesson?schema_version=3`)));
  const byCase = new Map(packs.flatMap(check => check.status === "fulfilled"
    ? [[check.value.case_id, check.value] as const] : []));
  const records = data.attempts.map(attempt => {
    const pack = byCase.get(attempt.case_id);
    const worksheet = typeof attempt.item_id === "string" && Object.hasOwn(worksheetLabels, attempt.item_id);
    if (worksheet && (attempt.assessment_role !== "practice" || attempt.evidence_class === "independent")) {
      throw new Error("实际课堂表单记录属于有帮助的练习。");
    }
    return pack && pack.content_version === attempt.content_version && !worksheet
      ? { row: verifiedAttempt(attempt, pack, profile), active: true }
      : { row: archivedAttempt(attempt, profile), active: false };
  });
  const portable = portableRecords(data.records, profile);
  const exposureRows = archiveExposures(data.exposures);
  return transact(["attempts", "archived_attempts", "exposures", ...archiveStores], "readwrite", async tx => {
    const attempts = tx.objectStore("attempts");
    const archived = tx.objectStore("archived_attempts");
    const exposures = tx.objectStore("exposures");
    let restored = 0, preservedVersions = 0;
    for (const entry of exposureRows) await mergeExposure(exposures, entry);
    for (const { row: entry, active } of records) {
      const existing = await result(attempts.get(entry.id)) as Attempt | undefined ??
        await result(archived.get(entry.id)) as Attempt | undefined;
      if (existing) {
        if (canonical(existing) !== canonical(entry)) throw new Error("已有一笔同 ID 的不同记录。已保留本机记录。");
        continue;
      }
      // A restored copy can reopen feedback even when the owning content version was archived.
      await mergeExposure(exposures, { ...entry.exposure, id: JSON.stringify([entry.case_id, entry.variant_id]),
        prior_feedback_for_variant: true, solution_seen_at: entry.exposure.solution_seen_at ?? entry.submitted_at });
      await result((active ? attempts : archived).add(entry));
      if (active) restored++;
      else preservedVersions++;
    }
    let restoredRecords = 0;
    for (const [name, entry] of portable) {
      const store = tx.objectStore(name);
      const existing = await result(store.get(entry.id));
      if (existing) {
        if (canonical(existing) !== canonical(entry)) throw new Error("已有一笔同 ID 的不同记录。已保留本机记录。");
      } else {
        await result(store.add(entry));
        restoredRecords++;
      }
    }
    return { restored, restoredRecords, preservedVersions };
  });
}

export async function clearLearning(profile: string) {
  return transact(["attempts", "archived_attempts", "sessions", "reviews"], "readwrite", async tx => {
    for (const name of ["attempts", "archived_attempts", "sessions", "reviews"]) {
      const store = tx.objectStore(name);
      const records = await result(store.getAll()) as ArchiveRecord[];
      for (const entry of records) {
        if (owned(entry, profile)) await result(store.delete(entry.id));
      }
    }
  });
}
