"""One local worker, currency-separated admission, and atomic teaching prefixes."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
import logging
import os
from threading import Thread
from time import monotonic, sleep
from uuid import uuid4

from . import live, live_client
from .auction import canonical_json, digest
from .lessons import load_case, MODULES
from .projection import metric_registry, paired_projection

PLANNED = {"public_goods": 18, "svb_run": 30, "information_cascade": 3, "gamestop": 3}
ACTIVE = ("running", "pause_requested", "paused", "cancel_requested")
TERMINAL = ("completed", "cancelled", "failed", "interrupted")
OWNER = f"{os.getpid()}:{uuid4()}"
MAX_INPUT, MAX_OUTPUT, MAX_ATTEMPTS, MAX_OPPORTUNITIES = 45_000, 12_000, 128, 64
MAX_SECONDS = 180


class Halt(Exception):
    """The worker should terminate without committing the pending step."""


class LiveProblem(Exception):
    def __init__(self, code, status=409):
        self.code, self.status = code, status


def setup(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS live_l2_runs (
        id TEXT PRIMARY KEY, request TEXT NOT NULL, status TEXT NOT NULL,
        owner TEXT, step INTEGER NOT NULL DEFAULT 0, prefix TEXT, reference TEXT,
        termination TEXT, reached INTEGER NOT NULL DEFAULT 0)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS live_l2_attempts (
        run_id TEXT NOT NULL, decision_id TEXT NOT NULL, attempt INTEGER NOT NULL,
        currency TEXT NOT NULL, reservation INTEGER NOT NULL, input_reserved INTEGER NOT NULL,
        output_reserved INTEGER NOT NULL, consumed INTEGER, receipt TEXT,
        PRIMARY KEY(run_id, decision_id, attempt))""")


def admitted_providers():
    flag = os.environ.get("CIVITAS_L2_ENABLED")
    return tuple(provider for provider in live_client.configured()
                 if (flag == "1" or (flag is None and provider.session_id))
                 and server_budget(provider) >= provider.reserve_micros)


def server_budget(provider):
    currency = provider.currency
    raw = os.environ.get(f"CIVITAS_L2_MAX_{currency}_MICROS", "2000000" if provider.session_id else "")
    try:
        amount = int(raw)
    except ValueError:
        return 0
    return amount if 0 < amount <= live.CEILING[currency] else 0


def capabilities():
    providers = [provider.public() | {"max_run_cost": server_budget(provider) / 1_000_000}
                 for provider in admitted_providers()]
    return {"cases": PLANNED, "providers": providers, "available": bool(providers),
            "wall_seconds": MAX_SECONDS, "recovery": "process_local", "rule_reference": True}


def row(conn, key):
    value = conn.execute("SELECT request,status,owner,step,prefix,reference,termination,reached "
                         "FROM live_l2_runs WHERE id=?", (key,)).fetchone()
    if value is None:
        raise LiveProblem("RUN_NOT_FOUND", 404)
    return value


def owner_alive(owner):
    if not owner:
        return False
    pid = int(owner.split(":")[0])
    if pid == os.getpid():
        return owner == OWNER
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def recover(conn):
    for key, owner in conn.execute("SELECT id,owner FROM live_l2_runs WHERE status IN "
                                   "('running','pause_requested','paused','cancel_requested')"):
        if not owner_alive(owner):
            conn.execute("UPDATE live_l2_runs SET status='interrupted', termination='worker_exited' "
                         "WHERE id=? AND owner=?", (key, owner))


def reference_policy(_step, requests):
    return {item["actor"]: item["default"] for item in requests}


reference_policy.commit = lambda *_args: None


def simulate(case, action, seed, policy):
    from importlib import import_module

    module = import_module(f".{MODULES[case['case_id']]}", __package__)
    options = {"rounds": 6} if case["case_id"] == "public_goods" else {}
    return module.simulate(case, "baseline", seed, action, classroom_policy=policy, **options)


class Worker:
    def __init__(self, connect, key, request, *, providers=None, transport=None):
        self.connect = connect
        self.key = key
        self.request = request
        self.case = load_case(request["case_id"])
        self.providers = tuple(admitted_providers() if providers is None else providers)
        self.transport = transport or live_client.send
        self.deadline = monotonic() + MAX_SECONDS
        self.pending = []
        self.committed = []
        self.commits = []

    def phase(self):
        with closing(self.connect()) as conn:
            return row(conn, self.key)[1]

    def boundary(self):
        while True:
            phase = self.phase()
            if phase not in ("running", "pause_requested", "paused"):
                raise Halt("cancelled" if phase == "cancel_requested" else "worker_unavailable")
            if monotonic() >= self.deadline:
                raise Halt("wall_limit")
            if phase == "pause_requested":
                with closing(self.connect()) as conn, conn:
                    conn.execute("UPDATE live_l2_runs SET status='paused' WHERE id=? AND status='pause_requested'",
                                 (self.key,))
            elif phase == "running":
                return
            else:
                sleep(.05)

    def proposal(self, step, item):
        actor, stage = item["actor"], item["stage"]
        allowed, default = item["allowed"], item["default"]
        packet = {"case_id": self.case["case_id"], "case_version": self.case["version"],
                  "actor": actor, "stage": stage, "simulation_step": step, "state": item["observation"]}
        identifier = f"{step}/{actor}/{stage}"
        result = {"decision_id": identifier, "step": step, "actor_id": actor, "stage": stage, "action": default,
                  "rule_default": default, "observation_hash": digest(packet), "source": "rule_fallback",
                  "reason": "no_valid_proposal"}
        if len(allowed) == 1:
            return result | {"reason": "single_legal_action"}
        bound = len(canonical_json({"observation": packet, "allowed": allowed}).encode()) + 512
        for attempt in (1, 2):
            provider = self.providers[0] if self.providers else None
            if provider is None:
                raise Halt("provider_unavailable")
            if monotonic() >= self.deadline:
                raise Halt("wall_limit")
            with closing(self.connect()) as conn, conn:
                conn.execute("BEGIN IMMEDIATE")
                if row(conn, self.key)[1] not in ("running", "pause_requested"):
                    raise Halt("cancelled")
                if conn.execute("SELECT 1 FROM live_l2_attempts WHERE run_id=? AND receipt IS NOT NULL "
                                "AND consumed IS NULL", (self.key,)).fetchone():
                    raise Halt("unknown_usage")
                all_cost = conn.execute(
                    """SELECT
                    coalesce((SELECT sum(coalesce(consumed,reservation)) FROM live_l2_attempts WHERE currency=?),0)
                    + coalesce((SELECT sum(coalesce(consumed,reservation)) FROM live_attempts WHERE currency=?),0)""",
                    (provider.currency, provider.currency),
                ).fetchone()[0]
                count, used_input, used_output = conn.execute(
                    "SELECT count(*),coalesce(sum(input_reserved),0),coalesce(sum(output_reserved),0) "
                    "FROM live_l2_attempts WHERE run_id=?", (self.key,)
                ).fetchone()
                spent = conn.execute("SELECT coalesce(sum(coalesce(consumed,reservation)),0) FROM live_l2_attempts "
                                     "WHERE run_id=? AND currency=?", (self.key, provider.currency)).fetchone()[0]
                limit = server_budget(provider)
                if self.request.get("budget_micros") is not None:
                    limit = min(limit, self.request["budget_micros"])
                if (count >= MAX_ATTEMPTS or used_input + bound > MAX_INPUT
                        or used_output + provider.max_output > MAX_OUTPUT
                        or spent + provider.reserve_micros > limit
                        or all_cost + provider.reserve_micros > live.CEILING[provider.currency]):
                    raise Halt("budget_limit")
                conn.execute("INSERT INTO live_l2_attempts VALUES(?,?,?,?,?,?,?,NULL,NULL)",
                             (self.key, identifier, attempt, provider.currency, provider.reserve_micros,
                              bound, provider.max_output))
            try:
                report = self.transport(provider, packet, allowed, repair=attempt > 1)
            except Exception:
                report = {"reason": "transport_failure", "usage": None}
            usage = report.get("usage")
            consumed = live_client.cost_micros(provider, usage)
            reason = report.get("reason")
            proposed = report.get("action")
            if not reason and (not isinstance(proposed, str) or proposed not in allowed or not report.get("actual_model")):
                reason = "invalid_action"
            if consumed is None and reason in {"missing_key", "observation_too_large"}:
                consumed = 0
            receipt = {name: report.get(name) for name in
                       ("actual_model", "request_id", "response_id", "response_sha256", "usage", "http_status")}
            receipt.update(reason=reason, provider=provider.name, requested_model=provider.model)
            if provider.session_id:
                receipt.update(pricing_basis=provider.pricing_basis, pricing_date=provider.public()["pricing_date"])
            with closing(self.connect()) as conn, conn:
                conn.execute("UPDATE live_l2_attempts SET consumed=?,receipt=? WHERE run_id=? AND decision_id=? AND attempt=?",
                             (consumed, canonical_json(receipt), self.key, identifier, attempt))
            if consumed is None:
                raise Halt("unknown_usage")
            if consumed > provider.reserve_micros or (usage and
                    (usage["input_tokens"] > bound or usage["output_tokens"] > provider.max_output)):
                raise Halt("usage_bound_exceeded")
            result["reason"] = reason
            if reason is None:
                result.update(action=proposed, source="model")
                break
            if reason not in live.RECOVERABLE | {"invalid_action"}:
                break
        return result

    def __call__(self, step, requests):
        self.boundary()
        with closing(self.connect()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            reached = row(conn, self.key)[7] + len(requests)
            if reached > min(MAX_OPPORTUNITIES, PLANNED[self.case["case_id"]]):
                raise Halt("opportunity_limit")
            conn.execute("UPDATE live_l2_runs SET reached=? WHERE id=?", (reached, self.key))
        if len({item["actor"] for item in requests}) != len(requests):
            raise ValueError("Duplicate actor in frozen batch")
        # The domain has already frozen every observation in this batch.
        with ThreadPoolExecutor(max_workers=min(3, len(requests))) as pool:
            futures = [pool.submit(self.proposal, step, item) for item in requests]
            outcomes = [future.result() for future in futures]
        self.pending.extend(outcomes)
        return {result["actor_id"]: result["action"] for result in outcomes}

    def commit(self, step, events, snapshots):
        with closing(self.connect()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            current = row(conn, self.key)
            old = json.loads(current[4]) if current[4] else None
            if old and current[3] == step and not self.pending:
                if all(canonical_json(items) == canonical_json(old[name])
                       for name, items in (("events", events), ("snapshots", snapshots))):
                    return
            if current[1] not in ("running", "pause_requested"):
                raise Halt("cancelled")
            if current[3] + 1 != step or len(events) != len(snapshots):
                raise ValueError("Unexpected settlement step")
            if old:
                count = len(old["events"])
                if canonical_json(events[:count]) != canonical_json(old["events"]) or (
                        canonical_json(snapshots[:count]) != canonical_json(old["snapshots"])):
                    raise ValueError("A committed prefix cannot be modified")
            seen = {item["event_seq"] for item in self.committed}
            for item in self.pending:
                event = next((event for event in events if event["seq"] not in seen
                              and event["event_type"] == "agent_action_selected"
                              and all(event.get(key) == item[key] for key in ("actor_id", "stage", "action"))), None)
                if event is None:
                    raise ValueError("Decision does not point to a committed mechanism event")
                seen.add(event["seq"])
                item["event_seq"] = event["seq"]
            decisions = [*self.committed, *self.pending]
            span = {"step": step, "first_seq": len(old["events"]) if old else 0,
                    "last_seq": events[-1]["seq"] if events else None}
            commit = {**span, "commit_id": digest({"run_id": self.key, **span, "events": events, "snapshots": snapshots})}
            prefix = {"events": events, "snapshots": snapshots, "decisions": decisions, "commits": [*self.commits, commit]}
            conn.execute("UPDATE live_l2_runs SET step=?,prefix=? WHERE id=? AND owner=?",
                         (step, canonical_json(prefix), self.key, OWNER))
        self.committed = decisions
        self.commits.append(commit)
        self.pending = []
        self.boundary()

    def run(self):
        status, reason, final = "completed", None, None
        try:
            action, seed = self.request["action"], self.request["seed"]
            reference = simulate(self.case, action, seed, reference_policy)
            with closing(self.connect()) as conn, conn:
                conn.execute("UPDATE live_l2_runs SET reference=? WHERE id=? AND owner=?",
                             (canonical_json(reference), self.key, OWNER))
            final = simulate(self.case, action, seed, self)
            if final["root_hash"] != reference["root_hash"] or final["initial_hash"] != reference["initial_hash"]:
                raise ValueError("Live and rule runs must share opening state")
        except Halt as stop:
            status, reason = ("cancelled" if str(stop) == "cancelled" else "interrupted"), str(stop)
        except Exception:
            logging.getLogger(__name__).exception("L2 simulation failed for %s", self.key)
            status, reason = "failed", "settlement_failed"
        with closing(self.connect()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            current = row(conn, self.key)
            if current[1] == "cancel_requested":
                status, reason = "cancelled", "cancelled"
            if status == "completed" and final is not None:
                if current[4]:
                    previous = json.loads(current[4])
                    if canonical_json(final["events"]) != canonical_json(previous["events"]) or (
                            canonical_json(final["snapshots"]) != canonical_json(previous["snapshots"])):
                        conn.execute("UPDATE live_l2_runs SET status='failed',termination='prefix_changed' WHERE id=? AND owner=?",
                                     (self.key, OWNER))
                        return
                prefix = final | {"decisions": self.committed, "commits": self.commits}
                conn.execute("UPDATE live_l2_runs SET prefix=? WHERE id=? AND owner=?",
                             (canonical_json(prefix), self.key, OWNER))
            conn.execute("UPDATE live_l2_runs SET status=?,termination=? WHERE id=? AND owner=?",
                         (status, reason, self.key, OWNER))


class LiveLab:
    def __init__(self, connect):
        self.connect = connect

    def create(self, key, request):
        with closing(self.connect()) as conn, conn:
            setup(conn)
            conn.execute("BEGIN IMMEDIATE")
            canonical = canonical_json(request)
            conn.execute("INSERT OR IGNORE INTO live_l2_runs(id,request,status) VALUES(?,?,'created')", (key, canonical))
            if row(conn, key)[0] != canonical:
                raise LiveProblem("REQUEST_ID_CONFLICT")
        return self.read(key)

    def start(self, key, *, providers=None, transport=None, foreground=False):
        with closing(self.connect()) as conn, conn:
            setup(conn)
            live.setup(conn)
            conn.commit()
            conn.execute("BEGIN IMMEDIATE")
            recover(conn)
            request, phase, *_ = row(conn, key)
            if phase == "created":
                if providers is None:
                    providers = admitted_providers()
                    expected = providers[0].session_id if providers else None
                    if expected != json.loads(request).get("model_session_id"):
                        raise LiveProblem("MODEL_CONFIGURATION_CHANGED")
                    if not providers:
                        raise LiveProblem("LIVE_NOT_CONFIGURED", 503)
                if (conn.execute("SELECT 1 FROM live_l2_runs WHERE status IN "
                                 "('running','pause_requested','paused','cancel_requested')").fetchone() or
                    conn.execute("SELECT 1 FROM runs WHERE status IN ('running','cancel_requested') LIMIT 1").fetchone()):
                    raise LiveProblem("LIVE_BUSY")
                conn.execute("UPDATE live_l2_runs SET status='running',owner=? WHERE id=?", (OWNER, key))
        if phase == "created":
            worker = Worker(self.connect, key, json.loads(request), providers=providers, transport=transport)
            if foreground:
                worker.run()
            else:
                Thread(target=worker.run, name="civitas-live-l2", daemon=True).start()
        return self.read(key)

    def control(self, key, action):
        with closing(self.connect()) as conn, conn:
            setup(conn)
            conn.execute("BEGIN IMMEDIATE")
            recover(conn)
            phase = row(conn, key)[1]
            transitions = {
                "pause": {"running": "pause_requested"},
                "resume": {"paused": "running", "pause_requested": "running"},
                "cancel": {"created": "cancelled", **dict.fromkeys(ACTIVE, "cancel_requested")},
            }
            target = transitions[action].get(phase)
            if target:
                conn.execute("UPDATE live_l2_runs SET status=? WHERE id=?", (target, key))
        return self.read(key)

    def rule_run(self, key):
        with closing(self.connect()) as conn, conn:
            setup(conn)
            conn.execute("BEGIN IMMEDIATE")
            raw, phase, *_ = row(conn, key)
            if phase != "created":
                return self.read_after_transaction(conn, key)
            conn.execute("UPDATE live_l2_runs SET status='running',owner=? WHERE id=?", (OWNER, key))
        request = json.loads(raw)
        try:
            reference = simulate(load_case(request["case_id"]), request["action"], request["seed"], reference_policy)
            prefix = reference | {"decisions": []}
            with closing(self.connect()) as conn, conn:
                conn.execute("UPDATE live_l2_runs SET status='completed',step=?,prefix=?,reference=? "
                             "WHERE id=? AND status='running' AND owner=?",
                             (max((event.get("round", event.get("turn", event.get("time", 0))) for event in reference["events"]), default=0),
                              canonical_json(prefix), canonical_json(reference), key, OWNER))
                conn.execute("UPDATE live_l2_runs SET status='cancelled' WHERE id=? AND status='cancel_requested'", (key,))
        except Exception:
            logging.getLogger(__name__).exception("L2 rule simulation failed for %s", key)
            with closing(self.connect()) as conn, conn:
                conn.execute("UPDATE live_l2_runs SET status='failed',termination='settlement_failed' WHERE id=? AND owner=?",
                             (key, OWNER))
        return self.read(key)

    def read_after_transaction(self, conn, key):
        conn.commit()
        return self.read(key)

    def read(self, key, *, full=False):
        with closing(self.connect()) as conn, conn:
            setup(conn)
            recover(conn)
            raw, phase, _, step, encoded, reference, reason, reached = row(conn, key)
            receipts = [{"decision_id": decision, "attempt": attempt, "currency": currency,
                         "reserved_micros": reservation, "cost_micros": consumed,
                         **(json.loads(receipt) if receipt else {"reason": "pending_or_unknown"})}
                        for decision, attempt, currency, reservation, consumed, receipt in conn.execute(
                            "SELECT decision_id,attempt,currency,reservation,consumed,receipt FROM live_l2_attempts "
                            "WHERE run_id=? ORDER BY decision_id,attempt", (key,))]
        request = json.loads(raw)
        prefix = json.loads(encoded) if encoded else {}
        planned = PLANNED[request["case_id"]]
        committed = prefix.get("decisions", [])
        modeled = [item for item in committed if item["source"] == "model"]
        result = {"schema_version": "lesson-run/2", "run_id": key, **request, "state": phase, "termination_reason": reason, "committed_step": step,
                  "completeness": "complete" if phase == "completed" else "prefix" if prefix else "none",
                  "prefix_hash": digest(prefix) if prefix else None,
                  "engine_version": prefix.get("engine_version"),
                  "last_committed_seq": prefix["events"][-1]["seq"] if prefix.get("events") else None,
                  "actual_mode": ("rule" if not modeled else "model" if len(modeled) == len(committed) else "hybrid"),
                  "coverage": {"planned": planned, "reached": reached, "model_committed": len(modeled),
                               "fallback": len(committed) - len(modeled), "attempts": len(receipts),
                               "actors": sorted({item["actor_id"] for item in modeled}),
                               "steps": sorted({item["step"] for item in modeled})},
                  "attempts": receipts, "decisions": committed,
                  "last_event": prefix.get("events", [None])[-1]}
        if full:
            result["prefix"] = prefix
            base = json.loads(reference) if reference else None
            result["rule_reference"] = base
            result["case_version"] = load_case(request["case_id"])["version"]
            for name in ("root_hash", "initial_hash", "engine_version"):
                result[name] = prefix.get(name) or (base or {}).get(name)
        return result

    def compare(self, key):
        run = self.read(key, full=True)
        base = run["rule_reference"]
        prefix = run["prefix"]
        if not base or not prefix:
            raise LiveProblem("EVIDENCE_NOT_AVAILABLE", 404)
        case = load_case(run["case_id"])
        # Both endpoints use the same named clock, and prefix comparisons end at shared steps.
        projection = paired_projection(case, {"result": base}, {"result": prefix})
        rows = projection["rows"]
        if run["state"] != "completed":
            rows = [item for item in rows if item["phase"] != "ending" and item["branch"] and item["baseline"]]
        return {"metrics": metric_registry(case), "rows": rows, "axis_label": projection["axis_label"]}
