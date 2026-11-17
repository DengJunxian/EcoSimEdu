"""Loopback API with persistent, idempotent run creation and exact replay."""
from __future__ import annotations

import gzip
import json
import logging
import os
import sqlite3
from contextlib import closing
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from time import time
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from . import live, live_l2
from .auction import BOUNDARIES, CASE, ENGINE_VERSION, ROOT, SCENARIOS, canonical_json, digest, run_auction
from .auction_view import project_auction
from .flagship_view import CLASSROOMS, project_flagship
from .lesson_scenes import ENGINE_VERSIONS, load_lesson_scenes
from .lessons import CATALOG, briefing, load_case, simulate
from .projection import metric_registry, paired_projection, sampled_metric
from . import parameter_specs
from .tutor import answer_tutor

PRESETS = ROOT / "cases/double_auction/presets.json.gz"
BUILD = ROOT / "student-web/dist"
VERSION = "1.0.0-rc.10"
EVENT_CACHE_BYTES = 24 * 1024 * 1024
CANONICAL_RESULT_PREFIX = b'{"format":"canonical-result/1",'
app = FastAPI(title="Civitas Economica", version=VERSION)


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    case_id: str = Field(min_length=1, max_length=48)
    scenario_id: str = Field(min_length=1, max_length=48)
    provider_kind: Literal["rule", "replay", "live"]
    seed: int = Field(strict=True, ge=0, le=2**32 - 1)
    bid: int | None = Field(default=None, strict=True, ge=1, le=CASE["player_value"])
    action: str | None = Field(default=None, strict=True, min_length=1, max_length=48)
    parent_run_id: UUID | None = None


class RunRequestV2(RunRequest):
    schema_version: Literal[2]
    bid: int | None = Field(default=None, strict=True, ge=1, le=CASE["player_value"] + 18)
    parameter_patch: dict[str, int | float | str | bool | None] = Field(default_factory=dict, max_length=12)
    weekly_orders: dict[str, StrictInt] = Field(default_factory=dict, max_length=40)
    round_contributions: dict[str, StrictInt] = Field(default_factory=dict, max_length=10)


class TutorEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: UUID
    seq: int = Field(strict=True, ge=0)


class MultiRoleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    case_id: str = Field(min_length=1, max_length=48)
    action: str = Field(min_length=1, max_length=48)
    seed: int = Field(strict=True, ge=0, le=2**32 - 1)
    mode: Literal["live", "rule"]
    budget_micros: int | None = Field(default=None, strict=True, ge=1, le=100_000_000)


class TutorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_id: str = Field(min_length=1, max_length=48)
    question: str = Field(min_length=1, max_length=300)
    run_id: UUID | None = None
    tick: int | None = Field(default=None, strict=True, ge=0)
    reveal_until: int | None = Field(default=None, strict=True, ge=0)
    scene: Literal["intro", "predict", "bid", "observe", "explain", "compare", "notebook"] | None = None
    actor: str | None = Field(default=None, max_length=64)
    prediction: Literal["yes", "no", "unknown"] | None = None
    hint_level: int = Field(default=1, strict=True, ge=1, le=3)
    evidence: list[TutorEvidence] = Field(default_factory=list, max_length=8)
    online_request_id: UUID | None = None


def connect():
    path = Path(os.environ.get("CIVITAS_EDU_DB", ".civitas-edu/runs.sqlite3"))
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, request TEXT, status TEXT, result TEXT)")
    return conn


def run_row(conn, key):
    row = conn.execute("SELECT request, status, CAST(result AS BLOB) FROM runs WHERE id = ?", (str(key),)).fetchone()
    if row is None:
        raise HTTPException(404, "RUN_NOT_FOUND")
    return row


def encode_result(case_version, origin, result):
    body = canonical_json(result)
    body_bytes = body.encode()
    metadata = {"case_version": case_version, "origin": origin,
                "result_hash": sha256(body_bytes).hexdigest()}
    if len(body_bytes) <= EVENT_CACHE_BYTES:
        legacy = json.dumps({**metadata, "result": result}, ensure_ascii=False)
        if len(legacy.encode()) <= EVENT_CACHE_BYTES:
            return legacy
    header = json.dumps({"format": "canonical-result/1", **metadata}, separators=(",", ":"))
    return header[:-1] + ',"result":' + body + "}"


def checked_result(result):
    stored = json.loads(result)
    if digest(stored["result"]) != stored["result_hash"]:
        raise HTTPException(409, "RUN_INTEGRITY_ERROR")
    stored.pop("format", None)
    return stored


def lookup(conn, key):
    row = run_row(conn, key)
    request, status, result = row
    run = {"run_id": str(key), **json.loads(request), "execution_status": status}
    if result is not None:
        run.update(checked_result(result))
    return run


def replay(request):
    bid = BOUNDARIES[CASE["case_id"]]["bid"] if request.scenario_id == "boundary" else CASE["preset_bid"]
    if (request.seed, request.bid) != (CASE["seed"], bid):
        raise HTTPException(422, "PRESET_NOT_AVAILABLE")
    try:
        stored = json.loads(gzip.decompress(PRESETS.read_bytes()))[request.scenario_id]
        result = stored["result"]
        if digest(result) != stored["result_hash"] or result["engine_version"] != ENGINE_VERSION:
            raise ValueError("integrity")
        return result
    except (OSError, EOFError, ValueError, KeyError, TypeError) as error:
        raise HTTPException(503, "PRESET_INTEGRITY_ERROR") from error


@app.get("/api/case")
def case():
    return CASE


@app.get("/api/health")
def health():
    if not (BUILD / "index.html").is_file():
        raise HTTPException(503, "STUDENT_ASSETS_UNAVAILABLE")
    return {"status": "ready", "version": VERSION, "published_cases": len(CATALOG),
            "live_configured": bool(live.configured())}


@app.get("/api/cases")
def list_cases():
    return [load_case(case_id) for case_id in CATALOG]


def get_case(case_id):
    try:
        return load_case(case_id)
    except KeyError as error:
        raise HTTPException(422, "CASE_NOT_AVAILABLE") from error


@app.get("/api/cases/{case_id}/briefing")
def case_briefing(case_id: str):
    definition = get_case(case_id)
    if case_id == "svb_run":
        from .svb_view import briefing as svb_briefing
        return svb_briefing(definition)
    if case_id == "information_cascade":
        from .cooperation_view import cascade_briefing
        return cascade_briefing(definition)
    if case_id == "school_matching":
        from .matching import STUDENT, SCHOOLS, _profile
        preferences, priorities = _profile(definition["seed"])
        return {"true_preference": preferences[STUDENT], "priority_positions": {
            school: order.index(STUDENT) + 1 for school, order in priorities.items()},
            "capacities": dict.fromkeys(SCHOOLS, 4)}
    return briefing(definition)


@app.get("/api/cases/{case_id}/lesson")
def case_lesson(case_id: str):
    get_case(case_id)
    return load_lesson_scenes(case_id)


@app.get("/api/cases/{case_id}/presets")
def teaching_presets(case_id: str):
    case = get_case(case_id)
    choices = {"bid": case["preset_bid"]} if case_id == CASE["case_id"] else {"action": case["action"]["default"]}
    return {"case_id": case_id, "case_version": case["version"], "seed": case["seed"],
            "provider_kind": "rule", "student_choice": choices,
            "presets": [{key: value for key, value in row.items() if key != "description"}
                          for row in case["scenarios"]]}


@app.get("/api/cases/{case_id}/parameters")
def case_parameters(case_id: str):
    return parameter_specs.describe(get_case(case_id))


@app.get("/api/live")
def live_capabilities():
    return live.capabilities()


@app.post("/api/tutor")
def tutor(request: TutorRequest, http: Request = None):
    definition = get_case(request.case_id)
    run = get_run(request.run_id) if request.run_id else None
    if run and (run["case_id"] != request.case_id or run.get("case_version") != definition["version"]
                or run["execution_status"] not in {"completed", "cancelled"} or "result" not in run):
        raise HTTPException(422, "EVIDENCE_RUN_MISMATCH")
    if request.tick is not None and (run is None or request.tick >= len(run["result"]["snapshots"])):
        raise HTTPException(422, "EVIDENCE_TICK_NOT_AVAILABLE")
    if request.reveal_until is not None and (
            run is None or request.reveal_until >= len(run["result"]["snapshots"])
            or (request.tick is not None and request.tick > request.reveal_until)):
        raise HTTPException(422, "EVIDENCE_TICK_NOT_AVAILABLE")
    if request.scene is None:
        return answer_tutor(definition, request.question, run, request.tick, reveal_until=request.reveal_until)

    from .task_tutor import task_answer
    from .tutor_online import explain_online, provider

    answer = task_answer(definition, request, run)
    selected_provider = provider()
    local = http is not None and http.client is not None and http.client.host in {"127.0.0.1", "::1"}
    answer["online_available"] = local and selected_provider is not None and answer["kind"] == "observation"
    if request.online_request_id is not None:
        if http is not None:
            require_loopback(http)
        if answer["online_available"]:
            return explain_online(connect, str(request.online_request_id), answer, selected_provider)
        answer["delivery"] = "offline_fallback"
    return answer


def require_loopback(request: Request):
    origin = request.headers.get("origin")
    if (request.url.hostname not in {"127.0.0.1", "localhost", "::1"} or
            request.client is None or request.client.host not in {"127.0.0.1", "::1"} or
            (origin is not None and origin != str(request.base_url).rstrip("/"))):
        raise HTTPException(403, "LIVE_LOCAL_ONLY")


def multi_role_action(name, *args, **kwargs):
    try:
        return getattr(live_l2.LiveLab(connect), name)(*args, **kwargs)
    except live_l2.LiveProblem as problem:
        raise HTTPException(problem.status, problem.code) from problem


@app.get("/api/v2/model-lab")
def multi_role_capabilities():
    return live_l2.capabilities()


@app.post("/api/v2/model-lab/runs", status_code=201)
def multi_role_create(payload: MultiRoleRequest, request: Request):
    require_loopback(request)
    case = get_case(payload.case_id)
    if payload.case_id not in live_l2.PLANNED or payload.action not in {x["id"] for x in case["action"]["options"]}:
        raise HTTPException(422, "INVALID_ACTION")
    if payload.mode == "live" and not live_l2.capabilities()["available"]:
        raise HTTPException(503, "LIVE_NOT_CONFIGURED")
    data = payload.model_dump(exclude={"request_id"})
    return multi_role_action("create", str(payload.request_id), data)


@app.post("/api/v2/model-lab/runs/{key}/start", status_code=202)
def multi_role_start(key: UUID, request: Request):
    require_loopback(request)
    run = multi_role_action("read", str(key))
    return multi_role_action("rule_run" if run["mode"] == "rule" else "start", str(key))


@app.get("/api/v2/model-lab/runs/{key}")
def multi_role_read(key: UUID, request: Request):
    require_loopback(request)
    return multi_role_action("read", str(key))


@app.get("/api/v2/model-lab/runs/{key}/export")
def multi_role_export(key: UUID, request: Request):
    require_loopback(request)
    return multi_role_action("read", str(key), full=True)


@app.get("/api/v2/model-lab/runs/{key}/compare")
def multi_role_compare(key: UUID, request: Request):
    require_loopback(request)
    return multi_role_action("compare", str(key))


@app.post("/api/v2/model-lab/runs/{key}/{control}")
def multi_role_control(key: UUID, control: Literal["pause", "resume", "cancel"], request: Request):
    require_loopback(request)
    return multi_role_action("control", str(key), control)


@app.get("/api/capabilities")
def capabilities():
    return {
        "case_id": CASE["case_id"], "basic": ["rule", "replay"], "offline_ready": True,
        "presets": list(SCENARIOS), "preset_seed": CASE["seed"], "preset_bid": CASE["preset_bid"],
        "can_seek_playback": True, "can_pause_execution": False, "can_resume_execution": False,
        "can_cancel_created": True, "can_fork": True, "can_export": True,
        "live": {"available": False, "reason": "LIVE_NOT_CONFIGURED"},
    }


@app.post("/api/runs", status_code=201)
def create(request: RunRequest | RunRequestV2, http: Request):
    definition = get_case(request.case_id)
    versioned = isinstance(request, RunRequestV2)
    if versioned:
        if request.scenario_id == "boundary" or request.provider_kind == "live":
            raise HTTPException(422, "V2_PROVIDER_NOT_SUPPORTED")
        if (request.weekly_orders and request.case_id != "beer_game") or any(
                week not in parameter_specs.ORDER_WEEKS or not 0 <= units <= 40
                for week, units in request.weekly_orders.items()):
            raise HTTPException(422, "INVALID_WEEKLY_ORDERS")
        if (request.round_contributions and request.case_id != "public_goods") or any(
                round_id not in parameter_specs.CONTRIBUTION_ROUNDS or not 0 <= units <= 20
                for round_id, units in request.round_contributions.items()):
            raise HTTPException(422, "INVALID_ROUND_CONTRIBUTIONS")
    boundary = BOUNDARIES.get(request.case_id) if request.scenario_id == "boundary" else None
    if boundary:
        if (request.seed != definition["seed"] or request.bid != boundary.get("bid")
                or request.action != boundary.get("action") or request.parent_run_id is not None
                or request.provider_kind not in ({"rule", "replay"} if boundary.get("replay") else {"rule"})):
            raise HTTPException(422, "BOUNDARY_PARAMETERS_MISMATCH")
    elif request.scenario_id not in {s["id"] for s in definition["scenarios"]}:
        raise HTTPException(422, "SCENARIO_NOT_AVAILABLE")
    is_auction = request.case_id == CASE["case_id"]
    if is_auction:
        if request.bid is None or request.action is not None:
            raise HTTPException(422, "INVALID_ACTION")
    elif request.bid is not None or request.action not in {a["id"] for a in definition["action"]["options"]}:
        raise HTTPException(422, "INVALID_ACTION")
    if request.provider_kind == "live":
        require_loopback(http)
        if request.case_id not in live.LIVE_CASES or not live.configured():
            raise HTTPException(503, "LIVE_NOT_CONFIGURED")
        if request.scenario_id != "baseline" or request.parent_run_id:
            raise HTTPException(422, "LIVE_BASELINE_ONLY")
    if versioned:
        try:
            parameters = parameter_specs.effective(definition, request.scenario_id, request.parameter_patch, request.bid)
        except parameter_specs.InvalidParameters as error:
            raise HTTPException(422, str(error)) from error
        if request.provider_kind == "replay" and (request.parameter_patch or request.weekly_orders):
            matched = any(row["id"] == request.scenario_id and parameter_specs.preset_values(definition, row) == parameters
                          for row in definition["scenarios"])
            if not matched or request.weekly_orders:
                raise HTTPException(422, "PRESET_NOT_AVAILABLE")
    if request.provider_kind == "replay":
        if not is_auction:
            raise HTTPException(422, "PRESET_NOT_AVAILABLE")
        replay(request)
    key = str(request.request_id)
    payload = request.model_dump(mode="json", exclude={"request_id", "action" if is_auction else "bid"})
    if versioned:
        payload["effective_parameters"] = parameters
        payload["seed_plan"] = parameter_specs.seed_plan(request.case_id, request.seed)
    serialized = json.dumps(payload, sort_keys=True)
    with closing(connect()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT request FROM runs WHERE id = ?", (key,)).fetchone()
        if existing:
            if existing[0] != serialized:
                raise HTTPException(409, "REQUEST_ID_CONFLICT")
            return lookup(conn, key)
        if request.parent_run_id:
            parent = lookup(conn, request.parent_run_id)
            if (parent["execution_status"] != "completed" or parent["scenario_id"] != "baseline"
                    or parent["case_id"] != request.case_id or parent["case_version"] != definition["version"]
                    or parent["provider_kind"] == "live"
                    or parent["seed"] != request.seed or parent.get("bid") != request.bid
                    or parent.get("action") != request.action
                    or parent.get("weekly_orders", {}) != (request.weekly_orders if versioned else {})
                    or parent.get("round_contributions", {}) != (request.round_contributions if versioned else {})
                    or (request.scenario_id == "baseline" and not versioned)):
                raise HTTPException(422, "INVALID_COMPARISON_PARENT")
        conn.execute("INSERT INTO runs VALUES (?, ?, 'created', NULL)", (key, serialized))
        return lookup(conn, key)


@app.get("/api/runs/{key}")
def get_run(key: UUID):
    with closing(connect()) as conn:
        run = lookup(conn, key)
        if run["execution_status"] in {"running", "cancel_requested"}:
            interrupt_expired_live(conn)
            run = lookup(conn, key)
        return run


def interrupt_expired_live(conn):
    with conn:
        conn.execute("""UPDATE runs SET status='interrupted' WHERE status IN ('running','cancel_requested')
                     AND id IN (SELECT run_id FROM live_jobs WHERE started<?)""", (time() - 120,))


def start_live(key, http):
    require_loopback(http)
    with closing(connect()) as conn, conn:
        live.setup(conn)
        interrupt_expired_live(conn)
        conn.execute("BEGIN IMMEDIATE")
        run = lookup(conn, key)
        if run["execution_status"] in {"completed", "cancelled"}:
            return run
        if run["execution_status"] in {"running", "cancel_requested"}:
            return run
        if run["execution_status"] != "created":
            raise HTTPException(409, "RUN_ALREADY_TERMINAL")
        if not live.configured():
            raise HTTPException(503, "LIVE_NOT_CONFIGURED")
        live_l2.setup(conn)
        live_l2.recover(conn)
        if (conn.execute("SELECT 1 FROM runs WHERE status IN ('running','cancel_requested') LIMIT 1").fetchone() or
            conn.execute("SELECT 1 FROM live_l2_runs WHERE status IN "
                         "('running','pause_requested','paused','cancel_requested')").fetchone()):
            raise HTTPException(409, "LIVE_BUSY")
        conn.execute("UPDATE runs SET status='running' WHERE id=?", (str(key),))
        conn.execute("INSERT INTO live_jobs(run_id,started) VALUES(?,?)", (str(key), time()))
    lesson = get_case(run["case_id"])
    session = live.DecisionSession(connect, key, lesson)
    result = None
    try:
        result = session.attach(simulate(lesson, run["scenario_id"], run["seed"], run["action"], decide=session))
    except Exception:
        logging.getLogger(__name__).error("Live lesson computation failed for run %s", key)
    with closing(connect()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute("SELECT status FROM runs WHERE id=?", (str(key),)).fetchone()[0]
        if current == "interrupted":
            return lookup(conn, key)
        cancelled = current == "cancel_requested"
        if cancelled and result and result["live"]["selected_by_model"]:
            session.decisions[0].update(action=session.decisions[0]["rule_default"], source="rule_fallback", reason="cancelled")
            result = session.attach(simulate(lesson, run["scenario_id"], run["seed"], run["action"],
                                             decide=lambda _actor, _stage, _state, _allowed, default: default))
        stored = encode_result(lesson["version"], "live_simulation", result) if result else None
        status = "cancelled" if cancelled else "completed" if stored else "failed"
        conn.execute("UPDATE runs SET status=?, result=? WHERE id=?", (status, stored, str(key)))
        run = lookup(conn, key)
    if status == "failed":
        raise HTTPException(503, "RUN_FAILED")
    return run


@app.post("/api/runs/{key}/start")
def start(key: UUID, http: Request, manifest_only: bool = False):
    with closing(connect()) as conn:
        row = conn.execute("SELECT request FROM runs WHERE id=?", (str(key),)).fetchone()
    if row and json.loads(row[0])["provider_kind"] == "live":
        return start_live(key, http)
    failed = False
    with closing(connect()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        run = lookup(conn, key)
        if run["execution_status"] == "completed":
            return {name: value for name, value in run.items() if name != "result"} if manifest_only else run
        if run["execution_status"] != "created":
            raise HTTPException(409, "RUN_ALREADY_TERMINAL")
        model = RunRequestV2 if run.get("schema_version") == 2 else RunRequest
        request = model(request_id=key, **{name: run[name] for name in model.model_fields if name in run})
        try:
            definition = get_case(request.case_id)
            if request.provider_kind == "replay":
                result = replay(request)
            else:
                parameters = None
                if run.get("schema_version") == 2:
                    parameters = run.get("effective_parameters")
                    if parameters is None:
                        parameters = parameter_specs.effective(
                            definition, request.scenario_id, run["parameter_patch"], request.bid)
                if request.case_id == CASE["case_id"]:
                    result = run_auction(request.scenario_id, request.seed, request.bid, parameters=parameters)
                else:
                    if parameters is not None:
                        definition = parameter_specs.with_parameters(definition, request.scenario_id, parameters)
                    if orders := run.get("weekly_orders"):
                        from .beer import run_chain
                        result = run_chain(definition, request.scenario_id, request.seed, int(request.action),
                                           [4] * 4 + [8] * 36, order_plan=orders)
                    elif contributions := run.get("round_contributions"):
                        from .public_goods import simulate as simulate_public_goods
                        result = simulate_public_goods(definition, request.scenario_id, request.seed, request.action,
                                                       contribution_plan=contributions)
                    else:
                        result = simulate(definition, request.scenario_id, request.seed, request.action)
            if isinstance(request, RunRequestV2) and request.provider_kind == "rule":
                result["seed_plan"] = parameter_specs.seed_plan(request.case_id, request.seed)
            if request.parent_run_id and lookup(conn, request.parent_run_id)["result"]["root_hash"] != result["root_hash"]:
                raise ValueError("Comparison inputs do not share a common root")
            origin = "precomputed_simulation" if request.provider_kind == "replay" else "offline_simulation"
            stored = encode_result(definition["version"], origin, result)
            conn.execute("UPDATE runs SET status='completed', result=? WHERE id=?", (stored, str(key)))
        except HTTPException:
            conn.execute("UPDATE runs SET status='failed' WHERE id=?", (str(key),))
            failed = True
        except Exception:
            logging.getLogger(__name__).exception("Lesson computation failed")
            conn.execute("UPDATE runs SET status='failed' WHERE id=?", (str(key),))
            failed = True
        run = lookup(conn, key)
    if failed:
        raise HTTPException(503, "RUN_FAILED")
    return {name: value for name, value in run.items() if name != "result"} if manifest_only else run


@app.post("/api/runs/{key}/cancel")
def cancel(key: UUID, http: Request):
    with closing(connect()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        run = lookup(conn, key)
        if run["provider_kind"] == "live":
            require_loopback(http)
        if run["execution_status"] == "created":
            conn.execute("UPDATE runs SET status='cancelled' WHERE id=?", (str(key),))
        elif run["execution_status"] == "running" and run["provider_kind"] == "live":
            conn.execute("UPDATE runs SET status='cancel_requested' WHERE id=?", (str(key),))
        elif run["execution_status"] not in {"cancelled", "cancel_requested"}:
            raise HTTPException(409, "RUN_ALREADY_TERMINAL")
        return lookup(conn, key)


@app.get("/api/runs/{key}/auction-view")
def auction_view(key: UUID, tick: int | Literal["close"] = 0,
                 mode: Literal["guided", "review", "explore"] = "guided", explain: bool = False):
    run = get_run(key)
    if (run["case_id"] != CASE["case_id"] or run.get("case_version") != CASE["version"]
            or run["execution_status"] != "completed" or run["result"]["engine_version"] != ENGINE_VERSION):
        raise HTTPException(409, "RUN_VERSION_MISMATCH")
    if tick == "close":
        tick = len(run["result"]["snapshots"]) - 1
    if tick < 0:
        raise HTTPException(404, "SNAPSHOT_NOT_AVAILABLE")
    try:
        return project_auction(run, tick, review=mode != "guided", explain=explain)
    except IndexError as error:
        raise HTTPException(404, "SNAPSHOT_NOT_AVAILABLE") from error


@app.get("/api/runs/{key}/classroom-view")
def classroom_view(key: UUID, tick: int | Literal["close", "checkpoint"] = 0,
                   mode: Literal["guided", "review"] = "guided"):
    run = get_run(key)
    case_id = run["case_id"]
    if (case_id not in CLASSROOMS or run["execution_status"] != "completed"
            or run.get("case_version") != get_case(case_id)["version"]
            or run["result"]["engine_version"] not in {
                ENGINE_VERSIONS[case_id], parameter_specs.EXTENDED_ENGINES.get(case_id)
            }):
        raise HTTPException(409, "RUN_VERSION_MISMATCH")
    try:
        return project_flagship(run, tick, review=mode == "review")
    except IndexError as error:
        raise HTTPException(404, "SNAPSHOT_NOT_AVAILABLE") from error


@app.get("/api/runs/{key}/snapshots/{tick}")
def seek(key: UUID, tick: int):
    with closing(connect()) as conn:
        _, status, encoded = run_row(conn, key)
        if status in {"running", "cancel_requested"}:
            interrupt_expired_live(conn)
            _, _, encoded = run_row(conn, key)
        if encoded is None or tick < 0:
            frame = None
        else:
            stored = checked_result(encoded) if len(encoded) <= EVENT_CACHE_BYTES else verify_large_result(encoded)
            if stored is not None:
                frames = stored["result"].get("snapshots", [])
                frame = frames[tick] if tick < len(frames) else None
            else:
                raw, = conn.execute("SELECT json_extract(CAST(? AS TEXT), ?)",
                                    (encoded, f"$.result.snapshots[{tick}]")).fetchone()
                frame = json.loads(raw) if raw is not None else None
                if frame is not None and frame["tick"] != tick:
                    frame = None
    if frame is None:
        raise HTTPException(404, "SNAPSHOT_NOT_AVAILABLE")
    return frame


def event_index(stored):
    result = stored["result"]
    return stored["case_version"], stored["result_hash"], result["events"], tuple(
        frame["tick"] for frame in result["snapshots"])


# Exact stored bytes invalidate the single-entry index on any database edit.
@lru_cache(maxsize=1)
def cached_event_index(encoded):
    return event_index(checked_result(encoded))


_verified_large_result: bytes | None = None


def verify_large_result(encoded):
    global _verified_large_result
    fingerprint = sha256(encoded).digest()
    if fingerprint == _verified_large_result:
        return None
    if encoded.startswith(CANONICAL_RESULT_PREFIX):
        marker = b',"result":'
        boundary = encoded.find(marker, len(CANONICAL_RESULT_PREFIX), 1024)
        if boundary < 0 or not encoded.endswith(b"}"):
            raise HTTPException(409, "RUN_INTEGRITY_ERROR")
        try:
            declared = json.loads(encoded[:boundary] + b"}")["result_hash"]
        except (ValueError, KeyError):
            raise HTTPException(409, "RUN_INTEGRITY_ERROR") from None
        body = memoryview(encoded)[boundary + len(marker):-1]
        if sha256(body).hexdigest() != declared:
            raise HTTPException(409, "RUN_INTEGRITY_ERROR")
        stored = None
    else:
        stored = checked_result(encoded)
    _verified_large_result = fingerprint
    return stored


@app.get("/api/runs/{key}/events/{seq}")
def read_event(key: UUID, seq: int):
    with closing(connect()) as conn:
        request, status, encoded = run_row(conn, key)
        if encoded is None or status not in {"completed", "cancelled"} or seq < 0:
            raise HTTPException(404, "EVENT_NOT_AVAILABLE")
        if len(encoded) <= EVENT_CACHE_BYTES:
            index = cached_event_index(encoded)
        else:
            stored = verify_large_result(encoded)
            index = event_index(stored) if stored is not None else None
        if index is None:
            case_version, result_hash, count, raw, frame_tick = conn.execute("""
                SELECT json_extract(CAST(?1 AS TEXT), '$.case_version'),
                       json_extract(CAST(?1 AS TEXT), '$.result_hash'),
                       json_array_length(CAST(?1 AS TEXT), '$.result.events'),
                       json_extract(CAST(?1 AS TEXT), ?2),
                       json_extract(CAST(?1 AS TEXT), '$.result.snapshots[' ||
                           max(0, coalesce(json_extract(CAST(?1 AS TEXT), ?3), 0)) || '].tick')
            """, (encoded, f"$.result.events[{seq}]", f"$.result.events[{seq}].tick")).fetchone()
            event = json.loads(raw) if raw is not None else None
        else:
            case_version, result_hash, events, frame_ticks = index
            count = len(events)
            event = events[seq] if seq < count else None
            tick = event["tick"] if event is not None else -1
            frame_tick = frame_ticks[tick] if 0 <= tick < len(frame_ticks) else None
    if event is None or event["seq"] != seq:
        raise HTTPException(404, "EVENT_NOT_AVAILABLE")
    return {"run_id": str(key), "case_id": json.loads(request)["case_id"], "case_version": case_version,
            "result_hash": result_hash, "event_count": count, "event": event,
            "snapshot_tick": frame_tick if frame_tick == event["tick"] else None}


@app.get("/api/runs/{key}/trace/{tick}")
def trace(key: UUID, tick: int):
    run = get_run(key)
    result = run.get("result", {})
    frames = result.get("snapshots", [])
    if not 0 <= tick < len(frames):
        raise HTTPException(404, "SNAPSHOT_NOT_AVAILABLE")
    tape = result["events"]
    event = tape[tick]
    orders = {event[k] for k in ("buy_order_id", "sell_order_id") if k in event}
    return {
        "case_id": run["case_id"], "run_id": run["run_id"], "result_hash": run["result_hash"],
        "event": event, "before": frames[tick - 1] if tick else None, "after": frames[tick],
        "linked_events": [row for row in tape[:tick]
                          if row.get("event_type") == "order_submitted" and row.get("order_id") in orders],
    }


@app.get("/api/runs/{key}/metrics/{metric}")
def metric_projection(key: UUID, metric: str, limit: int = Query(default=500, ge=8, le=2000)):
    run = get_run(key)
    definition = get_case(run["case_id"])
    descriptor = next((entry for entry in metric_registry(definition) if entry["id"] == metric), None)
    if descriptor is None or run["execution_status"] != "completed":
        raise HTTPException(404, "METRIC_NOT_AVAILABLE")
    if run["case_version"] != definition["version"]:
        raise HTTPException(409, "RUN_VERSION_MISMATCH")
    points = sampled_metric(run, metric, limit)
    return {"run_id": run["run_id"], "result_hash": run["result_hash"], "metric": descriptor,
            "total_points": len(run["result"]["snapshots"]),
            "points": [{"tick": tick, "value": value} for tick, value in points]}


@app.get("/api/runs/{key}/compare/{branch}")
def compare(key: UUID, branch: UUID):
    with closing(connect()) as conn:
        base = lookup(conn, key)
        other = lookup(conn, branch)
    if (base["execution_status"] != "completed" or other["execution_status"] != "completed"
            or base["scenario_id"] != "baseline" or other["parent_run_id"] != base["run_id"]
            or base["case_id"] != other["case_id"] or base["case_version"] != other["case_version"]
            or base["seed"] != other["seed"] or base.get("bid") != other.get("bid")
            or base.get("action") != other.get("action")
            or base.get("weekly_orders", {}) != other.get("weekly_orders", {})
            or base.get("round_contributions", {}) != other.get("round_contributions", {})
            or base["result"]["root_hash"] != other["result"]["root_hash"]):
        raise HTTPException(409, "RUNS_NOT_PAIRED")
    definition = get_case(base["case_id"])
    if base["case_version"] != definition["version"]:
        raise HTTPException(409, "RUN_VERSION_MISMATCH")
    projection = paired_projection(definition, base, other)
    if projection is None:
        raise HTTPException(422, "ALIGNMENT_NOT_AVAILABLE")
    if base.get("schema_version") == 2 or other.get("schema_version") == 2:
        projection["conditions"] = {
            "common_root": base["result"]["root_hash"], "seed": base["seed"],
            "baseline_initial_hash": base["result"]["initial_hash"],
            "branch_initial_hash": other["result"]["initial_hash"],
            "treatments": parameter_specs.comparison_intervention(base, other),
            "class": "initial_treatment" if base["result"]["initial_hash"] != other["result"]["initial_hash"]
                     else "policy_comparison",
        }
    return projection


@app.get("/api/runs/{key}/rule-reference")
def rule_reference(key: UUID):
    run = get_run(key)
    if (run["execution_status"] != "completed" or run["origin"] != "live_simulation"
            or run["case_id"] not in live.LIVE_CASES or run["scenario_id"] != "baseline"):
        raise HTTPException(409, "LIVE_REFERENCE_NOT_AVAILABLE")
    lesson = get_case(run["case_id"])
    if run["case_version"] != lesson["version"]:
        raise HTTPException(409, "RUN_VERSION_MISMATCH")
    result = run["result"]
    reference = simulate(lesson, "baseline", run["seed"], run["action"])
    if any(result[field] != reference[field] for field in ("engine_version", "root_hash", "initial_hash", "intervention")):
        raise HTTPException(409, "RUNS_NOT_PAIRED")
    return {
        "run_id": run["run_id"], "case_id": run["case_id"], "case_version": run["case_version"],
        "seed": run["seed"], "action": run["action"], "root_hash": result["root_hash"],
        "result_hash": run["result_hash"], "reference_hash": digest(reference),
        "metrics": [
            {**entry, "rule": reference["metrics"][entry["id"]], "advanced": result["metrics"][entry["id"]]}
            for entry in metric_registry(lesson)
        ],
    }


@app.get("/api/runs/{key}/export")
def export(key: UUID):
    return get_run(key)


if BUILD.is_dir():
    @app.get("/cases", include_in_schema=False)
    @app.get("/experiments/multi-role", include_in_schema=False)
    @app.get("/compare", include_in_schema=False)
    @app.get("/paths", include_in_schema=False)
    @app.get("/notes", include_in_schema=False)
    @app.get("/experiments", include_in_schema=False)
    def student_page():
        return FileResponse(BUILD / "index.html")

    @app.get("/learn/{case_id}", include_in_schema=False)
    def flagship_page(case_id: str):
        if case_id not in CLASSROOMS | {CASE["case_id"]}:
            raise HTTPException(404, "CASE_NOT_AVAILABLE")
        return student_page()

    @app.get("/cases/{case_id}", include_in_schema=False)
    def student_case_page(case_id: str):
        if case_id not in CATALOG:
            raise HTTPException(404, "CASE_NOT_AVAILABLE")
        return student_page()

    app.mount("/", StaticFiles(directory=BUILD, html=True), name="student")
