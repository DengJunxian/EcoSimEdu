"""Paid call admission, finite decision policy, and replay receipts."""
from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
from time import sleep

from .auction import digest
from .live_client import configured, cost_micros, send

LIVE_CASES = ("svb_run", "information_cascade", "public_goods", "gamestop")
CEILING = {"USD": 100_000_000, "CNY": 100_000_000}
MAX_ATTEMPTS = 2
RECOVERABLE = {"timeout", "network_error", "rate_limited", "provider_error",
               "incomplete_or_refused", "invalid_model_output", "action_out_of_bounds"}
ROUTE_FAILURE = {"auth_failed", "access_denied", "model_unavailable", "payment_required", "missing_key"}


def setup(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS live_attempts (
        id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, provider TEXT NOT NULL, currency TEXT NOT NULL,
        reservation INTEGER NOT NULL, consumed INTEGER, reason TEXT)""")
    conn.execute("CREATE TABLE IF NOT EXISTS live_jobs (run_id TEXT PRIMARY KEY, started REAL NOT NULL)")


def capabilities():
    providers = [p.public() for p in configured()]
    return {"available": bool(providers), "cases": list(LIVE_CASES), "scenario": "baseline",
            "decisions_per_run": 1, "attempts_per_run": MAX_ATTEMPTS, "providers": providers,
            "test_limits": {currency: amount / 1_000_000 for currency, amount in CEILING.items()}}


class DecisionSession:
    def __init__(self, connect, run_id, case, *, transport=None, pause=sleep):
        self.connect = connect
        self.run_id = str(run_id)
        self.case = case
        self.transport = transport or send
        self.pause = pause
        self.decisions = []

    def cancelled(self):
        with closing(self.connect()) as conn:
            phase = conn.execute("SELECT status FROM runs WHERE id=?", (self.run_id,)).fetchone()
        return phase is None or phase[0] != "running"

    def reserve(self, provider):
        with closing(self.connect()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            phase = conn.execute("SELECT status FROM runs WHERE id=?", (self.run_id,)).fetchone()
            if phase is None or phase[0] != "running":
                return None, "cancelled"
            charge = conn.execute(
                "SELECT COALESCE(SUM(COALESCE(consumed,reservation)),0) FROM live_attempts WHERE currency=?",
                (provider.currency,),
            ).fetchone()[0]
            if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='live_l2_attempts'").fetchone():
                charge += conn.execute(
                    "SELECT coalesce(sum(coalesce(consumed,reservation)),0) FROM live_l2_attempts WHERE currency=?",
                    (provider.currency,),
                ).fetchone()[0]
            if charge + provider.reserve_micros > CEILING[provider.currency]:
                return None, "budget_limit"
            receipt = conn.execute(
                "INSERT INTO live_attempts(run_id,provider,currency,reservation) VALUES(?,?,?,?)",
                (self.run_id, provider.name, provider.currency, provider.reserve_micros),
            )
            return receipt.lastrowid, None

    def __call__(self, actor, stage, observation, allowed, default):
        if self.decisions:
            raise ValueError("The pilot supports one model decision per experiment")
        packet = {"case_id": self.case["case_id"], "case_version": self.case["version"],
                  "actor": actor, "stage": stage, "state": observation}
        decision = {"actor_id": actor, "stage": stage, "allowed": allowed, "rule_default": default,
                    "observation_hash": digest(packet), "attempts": [], "action": default, "source": "rule_fallback",
                    "reason": "missing_key"}
        self.decisions.append(decision)
        providers = configured()
        index = 0
        for attempt in range(MAX_ATTEMPTS):
            if index >= len(providers):
                break
            provider = providers[index]
            receipt, reason = self.reserve(provider)
            if receipt is None:
                decision["reason"] = reason
                if reason == "budget_limit":
                    index += 1
                    continue
                break
            started_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
            report = self.transport(provider, packet, allowed, repair=attempt > 0)
            reason = report["reason"]
            if reason is None and report["action"] not in allowed:
                reason = "action_out_of_bounds"
            if reason is None and not report["actual_model"]:
                reason = "invalid_provider_response"
            if self.cancelled():
                reason = "cancelled"
            usage = report["usage"]
            consumed = cost_micros(provider, usage)
            if reason in {"observation_too_large", "missing_key"}:
                consumed = 0
            with closing(self.connect()) as conn, conn:
                conn.execute("UPDATE live_attempts SET consumed=?, reason=? WHERE id=?", (consumed, reason, receipt))
            decision["attempts"].append({
                "provider": provider.name, "model": report["actual_model"], "requested_model": provider.model,
                "request_id": report["request_id"], "response_id": report["response_id"], "usage": usage,
                "started_at": started_at, "response_sha256": report.get("response_sha256"),
                "cost": None if consumed is None else consumed / 1_000_000, "currency": provider.currency,
                "pricing_basis": "published_peak_ceiling" if provider.name == "deepseek" else "published_standard",
                "pricing_date": provider.public()["pricing_date"], "reason": reason,
                "provider_http_status": report.get("http_status"),
                "prompt_hash": digest({"protocol": "lesson-action/1", "observation": packet, "allowed": allowed,
                                       "provider": provider.name, "model": provider.model, "repair": attempt > 0}),
            })
            decision["reason"] = reason
            if reason is None:
                decision.update(action=report["action"], source="model")
                return report["action"]
            if reason in ROUTE_FAILURE:
                index += 1
            elif reason in RECOVERABLE and attempt + 1 < MAX_ATTEMPTS:
                self.pause(.35)
            else:
                break
        return default

    def attach(self, result):
        if len(self.decisions) != 1:
            raise ValueError("Expected one admitted role decision")
        decision = self.decisions[0]
        events = [event for event in result["events"] if event["event_type"] == "agent_action_selected"
                  and all(event.get(key) == decision[key] for key in ("actor_id", "stage", "action"))]
        if len(events) != 1:
            raise ValueError("The applied decision must point to an engine event")
        decision["event_seq"] = events[0]["seq"]
        decision["changed_from_rule"] = decision["action"] != decision["rule_default"]
        result["live"] = {"selected_by_model": int(decision["source"] == "model"),
                          "rule_fallbacks": int(decision["source"] != "model"),
                          "external_attempts": len(decision["attempts"]), "decisions": self.decisions}
        return result
