import { auctionStages, auctionStudyKey, readAuctionStudy } from "../cases/auction/auction-study";
import { fieldStudyKey, readFieldStudy } from "./flagship-study";
import { isFieldFlagship } from "./flagship-types";
import type { Phase, SessionState } from "./education-types";
import { result, transact } from "./learner-repository";

const phases: Phase[] = ["intro", "predict", "bid", "observe", "explain", "compare", "notebook"];

export async function migrateLegacy(base: SessionState) {
  const caseId = base.case_id;
  const key = caseId === "double_auction" ? auctionStudyKey : isFieldFlagship(caseId) ? fieldStudyKey(caseId) : null;
  if (!key) return;
  const original = localStorage.getItem(key);
  if (!original) return;
  const auction = caseId === "double_auction" ? readAuctionStudy() : null;
  const field = isFieldFlagship(caseId) ? readFieldStudy(caseId).study : null;
  const study = auction ?? field;
  if (!study) return;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(original));
  const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  const id = JSON.stringify([base.local_profile_id, key, hash]);
  await transact(["sessions", "migration_backups"], "readwrite", async tx => {
    const backups = tx.objectStore("migration_backups");
    if (await result(backups.getKey(id))) return;
    const sessions = tx.objectStore("sessions");
    const current_phase = auction ? auctionStages[auctionStages.indexOf(auction.scene)] : phases[field!.stage];
    const accessible_phases = phases.slice(0, study.unlocked + 1);
    if (!await result(sessions.getKey(base.id))) {
      const accessible_activity_ids = accessible_phases.map(phase => `legacy:${phase}`);
      await result(sessions.add({ ...base, current_activity_id: `legacy:${current_phase}`, accessible_activity_ids,
        activity_states: Object.fromEntries(accessible_activity_ids.map(id => [id, "available"])) }));
    }
    await result(backups.add({
      id, schema_version: 1, session_id: base.id, legacy_key: key, digest: hash, original,
      current_phase, accessible_phases,
      legacy_response: auction?.responses ?? field?.answers, exposure_unknown: true,
      migrated_at: new Date().toISOString(),
    }));
  });
}
