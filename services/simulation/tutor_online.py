"""Optional provider-assisted wording selected from a verified evidence pack."""

from contextlib import closing
import os

from .auction import digest
from . import live, live_client

ORDERS = {
    "observation_first": "Lead with the audited observation, then suggest what to inspect next.",
    "inspection_first": "Lead with the inspection step, then give the audited observation.",
}


def provider():
    if os.environ.get("CIVITAS_TUTOR_ONLINE_ENABLED") == "1":
        return next(iter(live_client.configured_environment()), None)
    return None


def evidence_pack(answer):
    return {
        "intent": answer["intent"],
        "claim": answer["claim"],
        "next_action": answer["next_action"],
        "evidence_ids": answer["evidence_ids"],
    }


def explain_online(connect, request_id, answer, selected_provider):
    """Use the same paid-call ceiling as the live lab and never repeat a request."""
    pack = evidence_pack(answer)
    options = answer.get("coach_options")
    allowed = options or ORDERS
    if options:
        pack["feedback_kind"] = "followup_question"
        pack["allowed_questions"] = options
    signature = digest(pack)
    fallback = {**answer, "delivery": "offline_fallback"}
    with closing(connect()) as conn, conn:
        live.setup(conn)
        conn.execute("""CREATE TABLE IF NOT EXISTS tutor_requests (
            id TEXT PRIMARY KEY, signature TEXT NOT NULL, ordering TEXT)""")
        conn.execute("BEGIN IMMEDIATE")
        cached = conn.execute("SELECT signature, ordering FROM tutor_requests WHERE id=?", (request_id,)).fetchone()
        if cached:
            return _render(answer, cached[1]) if cached[0] == signature and cached[1] in allowed else fallback
        consumed = conn.execute(
            "SELECT COALESCE(SUM(COALESCE(consumed,reservation)),0) FROM live_attempts WHERE currency=?",
            (selected_provider.currency,),
        ).fetchone()[0]
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='live_l2_attempts'").fetchone():
            consumed += conn.execute(
                "SELECT COALESCE(SUM(COALESCE(consumed,reservation)),0) FROM live_l2_attempts WHERE currency=?",
                (selected_provider.currency,),
            ).fetchone()[0]
        if consumed + selected_provider.reserve_micros > live.CEILING[selected_provider.currency]:
            return fallback
        conn.execute("INSERT INTO tutor_requests(id,signature) VALUES (?,?)", (request_id, signature))
        attempt = conn.execute(
            "INSERT INTO live_attempts(run_id,provider,currency,reservation) VALUES (?,?,?,?)",
            (f"tutor:{request_id}", selected_provider.name, selected_provider.currency, selected_provider.reserve_micros),
        ).lastrowid
    report = live_client.send(selected_provider, pack, allowed)
    reason = report["reason"]
    ordering = report["action"]
    if reason is None and (ordering not in allowed or not report["actual_model"]):
        reason = "invalid_model_output"
    cost = (0 if reason in {"missing_key", "observation_too_large"}
            else live_client.cost_micros(selected_provider, report["usage"]))
    with closing(connect()) as conn, conn:
        conn.execute("UPDATE live_attempts SET consumed=?, reason=? WHERE id=?", (cost, reason, attempt))
        if reason is None:
            conn.execute("UPDATE tutor_requests SET ordering=? WHERE id=?", (ordering, request_id))
    return _render(answer, ordering) if reason is None else fallback


def _render(answer, ordering):
    if answer.get("coach_options"):
        return {**answer, "delivery": "online", "feedback_kind": "followup_question",
                "next_action": answer["coach_options"][ordering]}
    return {**answer, "delivery": "online", "ordering": ordering}
