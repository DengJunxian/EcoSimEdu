from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Event
from uuid import uuid4

from fastapi import HTTPException, Request
import pytest

from services.simulation import api, live
from services.simulation.auction import digest
from services.simulation.lessons import load_case, simulate
from services.simulation.live_client import PROVIDERS, cost_micros, parse_reply


def local(origin=None, client="127.0.0.1"):
    return Request({"type": "http", "scheme": "http", "path": "/", "server": ("127.0.0.1", 8776), "client": (client, 12345),
                    "headers": [(b"origin", origin.encode())] if origin else []})


def make(case_id, **overrides):
    case = load_case(case_id)
    return api.RunRequest(**{"request_id": uuid4(), "case_id": case_id, "scenario_id": "baseline",
                             "provider_kind": "live", "seed": case["seed"], "action": case["action"]["default"],
                             **overrides})


def reply(provider, *, action=None, reason=None, usage=True):
    return {"action": action, "reason": reason, "request_id": "req_mock", "response_id": "resp_mock",
            "actual_model": provider.model, "usage": {"input_tokens": 400, "cached_input_tokens": 0,
                                                      "output_tokens": 28} if usage else None}


@pytest.fixture
def admitted(tmp_path, monkeypatch):
    monkeypatch.setenv("CIVITAS_EDU_DB", str(tmp_path / "admitted.sqlite3"))
    monkeypatch.setenv("CIVITAS_LIVE_ENABLED", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-non-secret")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    return monkeypatch


@pytest.mark.parametrize("case_id", live.LIVE_CASES)
def test_valid_model_choice_executes_and_replays(admitted, case_id):
    seen = []

    def send(provider, packet, allowed, repair=False):
        seen.append((provider.name, packet["case_id"], len(allowed), repair))
        preferred_change = {
            "svb_run": "withdraw_unprotected", "information_cascade": "force_b",
            "public_goods": "20", "gamestop": "buy_2",
        }
        return reply(provider, action=preferred_change[case_id])

    admitted.setattr(live, "send", send)
    request = make(case_id)
    key = request.request_id
    assert api.create(request, local())["execution_status"] == "created"
    run = api.start(key, local())
    assert run["origin"] == "live_simulation" and run["execution_status"] == "completed"
    assert api.start(key, local()) == api.export(key) == run
    assert len(seen) == 1 and seen[0][:2] == ("openai", case_id)
    manifest = run["result"]["live"]
    assert manifest["selected_by_model"] == 1 and manifest["rule_fallbacks"] == 0
    decision = manifest["decisions"][0]
    assert decision["changed_from_rule"]
    event = api.trace(key, decision["event_seq"])["event"]
    assert event["actor_id"] == decision["actor_id"] and event["action"] == decision["action"]
    assert decision["attempts"][0]["cost"] == .000054
    baseline = simulate(load_case(case_id), "baseline", request.seed, request.action)
    assert baseline["root_hash"] == run["result"]["root_hash"]
    assert baseline["metrics"] != run["result"]["metrics"]
    comparison = api.rule_reference(key)
    assert comparison["case_id"] == case_id and comparison["seed"] == request.seed
    assert comparison["action"] == request.action and comparison["result_hash"] == run["result_hash"]
    assert comparison["reference_hash"] == digest(baseline)
    assert {metric["id"]: metric["rule"] for metric in comparison["metrics"]} == baseline["metrics"]
    assert {metric["id"]: metric["advanced"] for metric in comparison["metrics"]} == run["result"]["metrics"]
    assert len(seen) == 1
    with pytest.raises(HTTPException, match="INVALID_COMPARISON_PARENT"):
        alternative = next(s["id"] for s in load_case(case_id)["scenarios"] if s["id"] != "baseline")
        api.create(make(case_id, provider_kind="rule", scenario_id=alternative, parent_run_id=key), local())


def test_invalid_action_budget_and_auth_fallback(admitted):
    admitted.setattr(live, "sleep", lambda _: None)
    admitted.setenv("DEEPSEEK_API_KEY", "another-test-key")
    providers = []
    def rejected(provider, *_args, **_kwargs):
        providers.append(provider.name)
        return (reply(provider, reason="auth_failed", usage=False) if provider.name == "openai"
                else reply(provider, action="not an allowed option"))
    admitted.setattr(live, "send", rejected)
    request = make("public_goods")
    api.create(request, local())
    run = api.start(request.request_id, local())
    assert providers == ["openai", "deepseek"]
    decision = run["result"]["live"]["decisions"][0]
    assert decision["source"] == "rule_fallback" and decision["reason"] == "action_out_of_bounds"
    assert decision["action"] == decision["rule_default"]
    assert decision["attempts"][0]["cost"] is None
    assert all(metric["rule"] == metric["advanced"] for metric in api.rule_reference(request.request_id)["metrics"])
    with closing(api.connect()) as conn:
        reserved = conn.execute("SELECT reservation, consumed FROM live_attempts WHERE currency='USD'").fetchone()
    assert reserved[0] > 0 and reserved[1] is None
    admitted.setattr(live, "CEILING", {"USD": 0, "CNY": 0})
    request = make("public_goods")
    api.create(request, local())
    limited = api.start(request.request_id, local())["result"]["live"]
    assert limited["decisions"][0]["reason"] == "budget_limit" and limited["external_attempts"] == 0


def test_local_only_one_inflight_and_cancel_preserves_usage(admitted):
    entered, release = Event(), Event()
    def slow(provider, *_args, **_kwargs):
        entered.set()
        assert release.wait(4)
        return reply(provider, action="20")
    admitted.setattr(live, "send", slow)
    first, second = make("public_goods"), make("information_cascade")
    with pytest.raises(HTTPException, match="LIVE_LOCAL_ONLY"):
        api.create(first, local("https://unrelated.test"))
    for request in (first, second):
        api.create(request, local())
    with ThreadPoolExecutor(max_workers=1) as pool:
        running = pool.submit(api.start, first.request_id, local())
        try:
            assert entered.wait(3)
            assert api.start(first.request_id, local())["execution_status"] == "running"
            with pytest.raises(HTTPException, match="LIVE_BUSY"):
                api.start(second.request_id, local())
            assert api.cancel(first.request_id, local())["execution_status"] == "cancel_requested"
        finally:
            release.set()
        cancelled = running.result()
    assert cancelled["execution_status"] == "cancelled"
    decision = cancelled["result"]["live"]["decisions"][0]
    assert decision["source"] == "rule_fallback" and decision["reason"] == "cancelled"
    assert decision["attempts"][0]["usage"]["output_tokens"] == 28
    assert api.export(first.request_id) == cancelled
    with pytest.raises(HTTPException, match="LIVE_REFERENCE_NOT_AVAILABLE"):
        api.rule_reference(first.request_id)


def test_provider_formats_and_strict_usage_are_separate():
    openai, deepseek = PROVIDERS
    a = parse_reply(openai, {"id": "resp_demo", "model": "gpt-6-luna", "status": "completed",
                            "output": [{"type": "message", "content": [{"type": "output_text", "text": '{"action":"20"}'}]}],
                            "usage": {"input_tokens": 80, "output_tokens": 12,
                                      "input_tokens_details": {"cached_tokens": 30}}}, "req_demo")
    assert a["action"] == "20" and a["request_id"] == "req_demo"
    assert cost_micros(openai, a["usage"]) == 12
    b = parse_reply(deepseek, {"id": "reply_demo", "model": "deepseek-flash",
                              "choices": [{"finish_reason": "stop", "message": {"content": '{"action":"hold"}'}}],
                              "usage": {"prompt_tokens": 80, "completion_tokens": 8, "prompt_cache_hit_tokens": 12}}, None)
    assert b["action"] == "hold" and b["usage"]["cached_input_tokens"] == 12
    assert cost_micros(deepseek, b["usage"]) == 201


def test_tutor_endpoint_source_validation(admitted):
    result = api.tutor(api.TutorRequest(case_id="information_cascade", question="给我一个预测提示。"))
    assert result["answer"] and result["citations"]
    with pytest.raises(HTTPException, match="EVIDENCE_TICK_NOT_AVAILABLE"):
        api.tutor(api.TutorRequest(case_id="information_cascade", question="当前事件是什么", tick=0))


def test_cancellation_wins_after_accepted_response_before_commit(admitted):
    from uuid import UUID

    admitted.setattr(live, "send", lambda provider, *_a, **_kw: reply(provider, action="20"))
    attach = live.DecisionSession.attach

    def cancel_after_action(session, result):
        result = attach(session, result)
        if result["live"]["selected_by_model"]:
            assert api.cancel(UUID(session.run_id), local())["execution_status"] == "cancel_requested"
        return result

    admitted.setattr(live.DecisionSession, "attach", cancel_after_action)
    request = make("public_goods")
    api.create(request, local())
    result = api.start(request.request_id, local())
    decision = result["result"]["live"]["decisions"][0]
    assert result["execution_status"] == "cancelled" and decision["source"] == "rule_fallback"
    assert decision["action"] == decision["rule_default"] and decision["attempts"][0]["usage"]


def test_expired_same_key_recovers_and_nonlocal_is_rejected(admitted):
    request = make("public_goods")
    with pytest.raises(HTTPException, match="LIVE_LOCAL_ONLY"):
        api.create(request, local(client="192.0.2.7"))
    api.create(request, local())
    with closing(api.connect()) as conn, conn:
        live.setup(conn)
        conn.execute("UPDATE runs SET status='running' WHERE id=?", (str(request.request_id),))
        conn.execute("INSERT INTO live_jobs VALUES(?,0)", (str(request.request_id),))
    with pytest.raises(HTTPException, match="RUN_ALREADY_TERMINAL"):
        api.start(request.request_id, local())
    assert api.get_run(request.request_id)["execution_status"] == "interrupted"


@pytest.mark.parametrize("first_failure", ["timeout", "rate_limited"])
def test_transient_failure_has_one_retry_and_retains_unknown_budget(admitted, first_failure):
    calls = []

    def transient(provider, *_args, repair=False):
        calls.append(repair)
        if len(calls) == 1:
            return reply(provider, reason=first_failure, usage=False)
        return reply(provider, action="20")

    admitted.setattr(live, "send", transient)
    request = make("public_goods")
    api.create(request, local())
    model = api.start(request.request_id, local())["result"]["live"]
    assert calls == [False, True] and model["selected_by_model"] == 1
    rows = model["decisions"][0]["attempts"]
    assert rows[0]["reason"] == first_failure and rows[0]["cost"] is None
    assert rows[1]["reason"] is None and rows[1]["cost"] == .000054
    with closing(api.connect()) as conn:
        exposure = conn.execute("SELECT SUM(COALESCE(consumed,reservation)) FROM live_attempts").fetchone()[0]
    assert exposure == PROVIDERS[0].reserve_micros + 54


@pytest.mark.parametrize("configured_timeout, expected", [(None, 12), ("19", 19), ("0", 12), ("31", 12), ("invalid", 12)])
def test_response_hash_uses_exact_bytes_without_persisting_raw_payload(monkeypatch, configured_timeout, expected):
    from hashlib import sha256
    import json

    from services.simulation import live_client

    raw = json.dumps({
        "id": "resp_demo", "model": "gpt-6-luna", "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": '{"action":"20"}'}]}],
    }, indent=2).encode()

    class Reply:
        status = 200

        def getheader(self, name):
            assert name == "x-request-id"
            return "req_demo"

        def read(self, limit):
            assert limit > len(raw)
            return raw

    class MockTransport:
        def __init__(self, host, timeout):
            assert host == "api.openai.com" and timeout == expected

        def request(self, method, path, **_kwargs):
            assert (method, path) == ("POST", "/v1/responses")

        def getresponse(self):
            return Reply()

        def close(self):
            pass

    monkeypatch.setenv("OPENAI_API_KEY", "scoped-test-placeholder")
    if configured_timeout is None:
        monkeypatch.delenv("CIVITAS_LIVE_TIMEOUT_SECONDS", raising=False)
    else:
        monkeypatch.setenv("CIVITAS_LIVE_TIMEOUT_SECONDS", configured_timeout)
    monkeypatch.setattr(live_client, "HTTPSConnection", MockTransport)
    response = live_client.send(PROVIDERS[0], {"case_id": "public_goods"}, {"20": "twenty"})
    assert response["response_sha256"] == sha256(raw).hexdigest()
    assert response["action"] == "20"
    assert "output" not in response and "raw" not in response
