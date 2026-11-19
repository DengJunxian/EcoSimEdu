import { exportLearning, restoreLearning } from "../../student-web/src/learning/learning-archive";
import { result, transact } from "../../student-web/src/learning/learner-repository";
import { loadLearningPack } from "./learning-packs.ts";
import { addArchiveEntries, exportProgressArchive, validateProgressArchive } from "./learning-store.ts";
import { exportTeachingRecords, verifiedTeachingRecords } from "./teaching-records.ts";

const archiveKind = "ecosimedu-learning-bundle/v1";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export async function exportStudy(storage: Storage, profile: string) {
  return { kind: archiveKind, exportedAt: new Date().toISOString(), progressive: exportProgressArchive(storage),
    indexed: await exportLearning(profile), teaching: exportTeachingRecords(storage) };
}

type Recovery = { id: string; kind: "progressive_before_import"; owner: string; raw: string; savedAt: string };

export async function snapshotBeforeImport(storage: Storage, profile: string) {
  const data = await exportStudy(storage, profile);
  const entry: Recovery = { id: crypto.randomUUID(), kind: "progressive_before_import",
    owner: profile, raw: JSON.stringify(data), savedAt: data.exportedAt };
  // Recovery snapshots stay separate from the portable legacy migration receipts.
  await transact(["migration_backups"], "readwrite", tx => result(tx.objectStore("migration_backups").add(entry)));
  return data.indexed;
}

export async function latestRecovery(profile: string) {
  return transact(["migration_backups"], "readonly", async tx => {
    const entries = await result(tx.objectStore("migration_backups").getAll()) as Recovery[];
    return entries.filter(entry => entry.kind === "progressive_before_import" && entry.owner === profile)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
  });
}

export const isStudyBundle = (value: unknown) => object(value) && value.kind === archiveKind;
export const isIndexedArchive = (value: unknown) => object(value) && value.kind === "ecosimedu-learning-export";

export async function restoreWithProgress(storage: Storage, profile: string, progressive: unknown, indexed: unknown,
  teaching?: ReadonlyMap<string, string>) {
  const checkpoints = validateProgressArchive(progressive);
  const inserted = new Map<string, string>();
  const outcomes: { progressive?: ReturnType<typeof addArchiveEntries>; teaching?: ReturnType<typeof addArchiveEntries> } = {};
  try {
    const restoreLocal = () => {
      outcomes.progressive = addArchiveEntries(storage, checkpoints, inserted);
      outcomes.teaching = teaching && addArchiveEntries(storage, teaching, inserted);
      if (outcomes.progressive.failed || outcomes.teaching?.failed) throw new Error("浏览器存储空间不足。");
    };
    // Apply the local additions before the IndexedDB transaction commits.
    const archiveResult = indexed === undefined ? undefined : await restoreLearning(profile, indexed, loadLearningPack, restoreLocal);
    if (indexed === undefined) restoreLocal();
    return { indexed: archiveResult, progressive: outcomes.progressive!, teaching: outcomes.teaching };
  } catch (error) {
    for (const [key, raw] of inserted) {
      try { if (storage.getItem(key) === raw) storage.removeItem(key); }
      catch { /* Existing records were never replaced. The recovery snapshot remains available. */ }
    }
    throw error;
  }
}

export async function restoreStudy(storage: Storage, profile: string, value: unknown) {
  if (!object(value)) throw new Error("请选择 EcoSimEdu 学习档案 JSON。");
  if (isIndexedArchive(value)) {
    const indexed = await restoreLearning(profile, value, loadLearningPack);
    return { indexed, progressive: undefined, teaching: undefined };
  }
  if (!isStudyBundle(value) || !isIndexedArchive(value.indexed)) throw new Error("完整学习档案格式错误。");
  return restoreWithProgress(storage, profile, value.progressive, value.indexed, verifiedTeachingRecords(value.teaching));
}
