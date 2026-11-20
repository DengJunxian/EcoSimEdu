"""Loopback-only sessions and in-lesson responses for the study tutor."""

import json
import re
from asyncio import get_running_loop
from collections import deque
from dataclasses import dataclass, field
from secrets import token_urlsafe
from threading import Lock
from time import monotonic

from anyio import CancelScope
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from .. import live_client
from . import explanation_review, review_recommendation, schelling_tutor

COOKIE = "ecosimedu_study_ai"
TTL_SECONDS = 3600
SESSION_ATTEMPTS = 5
TUTOR_ATTEMPTS = 6
PROVIDER_ATTEMPTS = 20
MIN_TEST_INTERVAL = 3
MAX_SESSIONS = 128

PROFILES = live_client.STUDY_PROFILES
NO_STORE = {"Cache-Control": "no-store"}


@dataclass
class Session:
    expires_at: float
    origin: str
    key: str | None = field(default=None, repr=False)
    active: dict | None = None
    attempts: int = 0
    last_test: float = float("-inf")
    checking: bool = False
    tutoring: bool = False
    tutor_attempts: int = 0
    tutor_cache: dict[tuple[str, str], dict] = field(default_factory=dict)


_sessions: dict[str, Session] = {}
_attempts = {name: deque() for name in PROFILES}
_lock = Lock()


def reject(status: int, code: str):
    raise HTTPException(status, code, headers=NO_STORE)


def require_local_origin(request: Request):
    origin = request.headers.get("origin")
    if (
        request.url.hostname not in {"127.0.0.1", "localhost", "::1"}
        or request.client is None
        or request.client.host not in {"127.0.0.1", "::1"}
        or request.headers.get("sec-fetch-site") not in {None, "same-origin", "none"}
        or (origin is not None and origin != str(request.base_url).rstrip("/"))
        or (request.method != "GET" and not origin)
    ):
        reject(403, "STUDY_AI_LOCAL_ONLY")


router = APIRouter(prefix="/api/ai", dependencies=[Depends(require_local_origin)])


def session_for(request: Request):
    session = _sessions.get(request.cookies.get(COOKIE))
    if session and session.expires_at > monotonic() and session.origin == str(request.base_url):
        return session
    return None


def expire_session(token: str):
    with _lock:
        session = _sessions.pop(token, None)
        if session:
            session.key = None


def response(content):
    return JSONResponse(content, headers=NO_STORE)


def session_status(session: Session | None):
    return {
        "active": session.active if session else None,
        "checking": session.checking if session else False,
        "tests_remaining": SESSION_ATTEMPTS - session.attempts if session else SESSION_ATTEMPTS,
        "tutor_requests_remaining": TUTOR_ATTEMPTS - session.tutor_attempts if session else TUTOR_ATTEMPTS,
    }


@router.get("/providers")
def providers():
    return response([
        {"provider": name, "label": label, "model": profile.model}
        for name, (profile, label) in PROFILES.items()
    ])


@router.get("/status")
def status(request: Request):
    with _lock:
        return response(session_status(session_for(request)))


@router.delete("/session")
def clear(request: Request):
    with _lock:
        if session := session_for(request):
            session.key = None
            del _sessions[request.cookies[COOKIE]]
    result = response(session_status(None))
    result.delete_cookie(COOKIE, path="/api/ai", httponly=True, samesite="strict",
                         secure=request.url.scheme == "https")
    return result


async def json_body(request: Request, limit: int, error: str):
    if request.headers.get("content-type", "").partition(";")[0].strip() != "application/json":
        reject(415, "STUDY_AI_EXPECTS_JSON")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            reject(413, error)
        body.extend(chunk)
    try:
        return json.loads(body)
    except ValueError:
        reject(422, error)


async def confirmed_config(request: Request) -> tuple[str, str]:
    fields = await json_body(request, 8192, "STUDY_AI_INVALID_TEST")
    if (
        not isinstance(fields, dict) or set(fields) != {"provider", "api_key", "confirm"}
        or fields["confirm"] is not True
        or not isinstance(fields["provider"], str) or fields["provider"] not in PROFILES
        or not isinstance(fields["api_key"], str) or not re.fullmatch(r"[!-~]{8,1024}", fields["api_key"])
    ):
        reject(422, "STUDY_AI_INVALID_TEST")
    return fields["provider"], fields["api_key"]


def reserve_provider_call(name, now):
    recent = _attempts[name]
    while recent and now - recent[0] >= TTL_SECONDS:
        recent.popleft()
    if len(recent) >= PROVIDER_ATTEMPTS:
        return False
    recent.append(now)
    return True


@router.post("/test")
async def test_connection(request: Request):
    name, key = await confirmed_config(request)
    profile, _label = PROFILES[name]

    with _lock:
        now = monotonic()
        for token, entry in tuple(_sessions.items()):
            if entry.expires_at <= now:
                entry.key = None
                del _sessions[token]
        token = request.cookies.get(COOKIE)
        session = session_for(request)
        if session and (session.checking or session.tutoring):
            reject(409, "STUDY_AI_TEST_IN_PROGRESS")
        if session and session.attempts >= SESSION_ATTEMPTS:
            reject(429, "STUDY_AI_SESSION_LIMIT")
        if session and now - session.last_test < MIN_TEST_INTERVAL:
            reject(429, "STUDY_AI_WAIT_BEFORE_RETRY")
        if (not session and len(_sessions) >= MAX_SESSIONS) or not reserve_provider_call(name, now):
            reject(429, "STUDY_AI_SERVICE_LIMIT")
        if session is None:
            token = token_urlsafe(32)
            session = _sessions[token] = Session(now + TTL_SECONDS, str(request.base_url))
            get_running_loop().call_later(TTL_SECONDS, expire_session, token)
        session.attempts += 1
        session.last_test = now
        session.checking = True
        session.key = None
        session.active = None
        session.tutor_cache.clear()

    try:
        report = await run_in_threadpool(live_client.probe, profile, key)
        result = {
            "provider": name, "model": profile.model,
            "reason": report["reason"], "usage": report["usage"],
        }
        with _lock:
            if _sessions.get(token) is not session or session.expires_at <= monotonic():
                reject(409, "STUDY_AI_SESSION_ENDED")
            session.active = result
            session.key = key if result["reason"] is None else None
            payload = session_status(session) | {"checking": False}
    finally:
        with _lock:
            session.checking = False

    result = response(payload)
    result.set_cookie(COOKIE, token, max_age=max(0, int(session.expires_at - monotonic())),
                      path="/api/ai", httponly=True, samesite="strict",
                      secure=request.url.scheme == "https")
    return result


def tutor_binding(request: Request):
    session = session_for(request)
    return request.cookies.get(COOKIE, ""), session.attempts if session else None


@router.post("/tutor/scope")
async def tutor_scope(request: Request):
    fields = await json_body(request, 2048, "STUDY_TUTOR_INVALID_REQUEST")
    try:
        focus = schelling_tutor.FOCUS.validate_python(fields)
    except ValueError:
        reject(422, "STUDY_TUTOR_INVALID_REQUEST")
    with _lock:
        binding = tutor_binding(request)
    grant = await run_in_threadpool(schelling_tutor.grant_scope, focus, str(request.base_url), binding)
    if grant is None:
        reject(409, "STUDY_TUTOR_EVIDENCE_UNAVAILABLE")
    return response({"grant": grant})


async def tutor_context(request: Request):
    fields = await json_body(request, 2048, "STUDY_TUTOR_INVALID_REQUEST")
    if not isinstance(fields, dict) or fields.get("confirm") is not True:
        reject(422, "STUDY_TUTOR_INVALID_REQUEST")
    try:
        query = schelling_tutor.REQUEST.validate_python(fields)
    except ValueError:
        reject(422, "STUDY_TUTOR_INVALID_REQUEST")
    if (query.intent == "question") != (query.question is not None) or (query.question and not query.question.strip()):
        reject(422, "STUDY_TUTOR_INVALID_REQUEST")
    with _lock:
        binding = tutor_binding(request)
    if not schelling_tutor.scope_valid(query, str(request.base_url), binding):
        reject(409, "STUDY_TUTOR_SCOPE_UNAVAILABLE")
    pack = await run_in_threadpool(schelling_tutor.evidence, query)
    if pack is None:
        reject(409, "STUDY_TUTOR_EVIDENCE_UNAVAILABLE")
    # Micro and macro views use the same public evidence for an identical relocation.
    cache_fields = {"grant", "confirm", "question"}
    if isinstance(query, schelling_tutor.ReplayFocus):
        cache_fields.add("stage")
    cache_key = (query.model_dump_json(exclude=cache_fields), pack["intent"])
    return binding, pack, cache_key


async def tutor_answer(request, binding, pack, cache_key=None):
    def deliver(answer, session=None, *, cached=False):
        return {**answer, "cached": cached,
                "requests_remaining": TUTOR_ATTEMPTS - session.tutor_attempts if session else None}

    with _lock:
        if binding != tutor_binding(request):
            reject(409, "STUDY_TUTOR_SCOPE_UNAVAILABLE")
        session = session_for(request)
        if pack["intent"] is None:
            return deliver(schelling_tutor.render(pack, reason="question_outside_scope"), session)
        if session is None:
            return deliver(schelling_tutor.render(pack, reason="not_connected"))
        if session.checking or session.tutoring:
            return deliver(schelling_tutor.render(pack, reason="busy"), session)
        if not session.key or not session.active:
            return deliver(schelling_tutor.render(pack, reason="not_connected"))
        if cache_key is not None and (cached := session.tutor_cache.get(cache_key)):
            return deliver(cached | {"anchor": pack["anchor"]}, session, cached=True)
        if session.tutor_attempts >= TUTOR_ATTEMPTS:
            return deliver(schelling_tutor.render(pack, reason="session_limit"), session)
        name = session.active["provider"]
        if not reserve_provider_call(name, monotonic()):
            return deliver(schelling_tutor.render(pack, reason="service_limit"), session)
        profile, _label = PROFILES[name]
        key = session.key
        session.tutor_attempts += 1
        session.tutoring = True

    try:
        answer = await run_in_threadpool(schelling_tutor.teach, profile, key, pack)
        with _lock:
            if session_for(request) is not session:
                return deliver(schelling_tutor.render(pack, reason="not_connected"))
            if cache_key is not None and answer["mode"] == "ai":
                session.tutor_cache[cache_key] = answer
            return deliver(answer, session)
    finally:
        with _lock:
            session.tutoring = False


@router.post("/review/explanation")
async def review_explanation(request: Request):
    fields = await json_body(request, 8192, "STUDY_REVIEW_INVALID_REQUEST")
    if not isinstance(fields, dict) or fields.get("confirm") is not True:
        reject(422, "STUDY_REVIEW_INVALID_REQUEST")
    try:
        query = explanation_review.ReviewRequest.model_validate(fields)
    except ValueError:
        reject(422, "STUDY_REVIEW_INVALID_REQUEST")
    with _lock:
        binding = tutor_binding(request)
    pack = await run_in_threadpool(explanation_review.evidence, query)
    if pack is None:
        reject(409, "STUDY_REVIEW_EVIDENCE_UNAVAILABLE")
    with CancelScope(shield=True):
        return response(await tutor_answer(request, binding, pack))


@router.post("/tutor")
async def tutor(request: Request):
    context = await tutor_context(request)
    return response(await tutor_answer(request, *context))


@router.post("/review/recommendation")
async def recommend_review(request: Request):
    fields = await json_body(request, 2048, "STUDY_RECOMMEND_INVALID_REQUEST")
    if not isinstance(fields, dict) or fields.get("confirm") is not True:
        reject(422, "STUDY_RECOMMEND_INVALID_REQUEST")
    try:
        query = review_recommendation.RecommendationRequest.model_validate(fields)
    except ValueError:
        reject(422, "STUDY_RECOMMEND_INVALID_REQUEST")
    with _lock:
        binding = tutor_binding(request)
    pack = await run_in_threadpool(review_recommendation.evidence, query)
    if pack is None:
        reject(409, "STUDY_RECOMMEND_EVIDENCE_UNAVAILABLE")
    with CancelScope(shield=True):
        return response(await tutor_answer(request, binding, pack))


@router.post("/tutor/stream")
async def tutor_stream(request: Request):
    context = await tutor_context(request)

    def line(kind, **data):
        return json.dumps({"type": kind, **data}, ensure_ascii=False, separators=(",", ":")) + "\n"

    async def events():
        yield line("progress")
        try:
            # A started provider request may be billed after the browser disconnects.
            with CancelScope(shield=True):
                answer = await tutor_answer(request, *context)
        except HTTPException as error:
            yield line("error", code=error.detail)
            return
        steps = answer["steps"]
        yield line("begin", answer={**answer, "steps": []}, count=len(steps))
        for step in steps:
            yield line("step", step=step)
        yield line("done")

    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={**NO_STORE, "X-Accel-Buffering": "no"})
