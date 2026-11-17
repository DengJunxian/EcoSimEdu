from contextlib import closing
from threading import Event, Lock
from time import monotonic, sleep
from uuid import uuid4

import pytest

from services.simulation import api, live_client, live_l2
from services.simulation.auction import digest
from services.simulation.lessons import load_case
from test_education_api import call

PROVIDER = live_client.PROVIDERS[0]


@pytest.fixture
def lab(monkeypatch, tmp_path):
    monkeypatch.setenv("CIVITAS_EDU_DB", str(tmp_path / "live.sqlite"))
    monkeypatch.setenv("CIVITAS_L2_MAX_USD_MICROS", "5000000")
    return live_l2.LiveLab(api.connect)


def register(lab, case="public_goods", **patch):
    key = str(uuid4())
    course = load_case(case)
    request = dict(case_id=case, mode="live", seed=course["seed"], action=course["action"]["default"], **patch)
    lab.create(key, request)
    return key


def ok(action, **extra):
    return dict(action=action, actual_model="injected-transport", reason=None, **({
        "usage": {"input_tokens": 128, "output_tokens": 12, "cached_input_tokens": 0},
    } | extra))


def wait(lab, key, condition):
    deadline = monotonic() + 7
    while monotonic() < deadline:
        result = lab.read(key, full=True)
        if condition(result):
            return result
        sleep(.025)
    pytest.fail(f"worker never reached expected state: {lab.read(key)['state']}")


@pytest.mark.parametrize("case", live_l2.PLANNED)
def test_four_l2_models_commit_real_actions_with_reference(lab, case):
    packets, lock = [], Lock()
    key = register(lab, case)

    def transport(provider, packet, legal, **_):
        with lock:
            packets.append(packet)
        if packet["actor"] == "P2":
            sleep(.005)
        return ok(next(iter(legal)))

    result = lab.start(key, providers=(PROVIDER,), transport=transport, foreground=True)
    assert result["state"] == "completed"
    export = lab.read(key, full=True)
    assert export["coverage"]["planned"] == live_l2.PLANNED[case]
    assert len(export["coverage"]["actors"]) >= 3 and len(export["coverage"]["steps"]) >= 3
    assert export["prefix_hash"] == digest(export["prefix"])
    assert export["prefix"]["initial_hash"] == export["rule_reference"]["initial_hash"]
    assert len(export["prefix"]["events"]) == len(export["prefix"]["snapshots"])
    assert all(attempt["actual_model"] == "injected-transport" for attempt in result["attempts"])
    for item in result["decisions"]:
        event = export["prefix"]["events"][item["event_seq"]]
        assert event["event_type"] == "agent_action_selected"
        assert event["action"] == item["action"] and event["actor_id"] == item["actor_id"]
    assert lab.start(key, providers=(PROVIDER,), transport=transport)["state"] == "completed"
    assert len(lab.read(key)["attempts"]) == len(packets)
    assert lab.compare(key)["rows"][-1]["baseline"]
    if case == "public_goods":
        assert len([p for p in packets if p["simulation_step"] == 1]) == 3
        assert all("previous_public_contributions" in p["state"] and
                   not p["state"]["previous_public_contributions"] for p in packets if p["simulation_step"] == 1)


def test_pause_resume_and_cancel_preserve_prefix_and_inflight_cost(lab):
    second_entered, release_second = Event(), Event()
    key = register(lab)

    def transport(_provider, packet, legal, **_):
        if packet["simulation_step"] == 1:
            lab.control(key, "pause")
        elif packet["simulation_step"] == 2:
            second_entered.set()
            assert release_second.wait(4)
        return ok(next(iter(legal)))

    lab.start(key, providers=(PROVIDER,), transport=transport)
    paused = wait(lab, key, lambda value: value["state"] == "paused")
    assert paused["committed_step"] == 1
    assert paused["coverage"]["model_committed"] == 3
    assert sum(e["event_type"] == "settlement" for e in paused["prefix"]["events"]) == 1
    lab.control(key, "resume")
    assert second_entered.wait(4)
    lab.control(key, "cancel")
    release_second.set()
    final = wait(lab, key, lambda value: value["state"] == "cancelled")
    assert final["prefix_hash"] == paused["prefix_hash"]
    assert final["prefix"] == paused["prefix"]
    assert len(final["attempts"]) > len(paused["attempts"])
    assert lab.compare(key)["rows"][-1]["checkpoint"] == 1


def test_duplicate_settlement_reuses_committed_checkpoint(lab, monkeypatch):
    commit = live_l2.Worker.commit

    def replay(worker, step, events, snapshots):
        commit(worker, step, events, snapshots)
        commit(worker, step, events, snapshots)

    monkeypatch.setattr(live_l2.Worker, "commit", replay)
    key = register(lab)
    assert lab.start(key, providers=(PROVIDER,), transport=lambda _p, _o, legal, **_kw: ok(next(iter(legal))),
                     foreground=True)["state"] == "completed"
    commits = lab.read(key, full=True)["prefix"]["commits"]
    assert [item["step"] for item in commits] == list(range(1, 7))
    assert len({item["commit_id"] for item in commits}) == 6


def test_admission_and_worker_choose_the_same_funded_provider(monkeypatch):
    monkeypatch.setenv("CIVITAS_L2_ENABLED", "1")
    monkeypatch.delenv("CIVITAS_L2_MAX_USD_MICROS", raising=False)
    monkeypatch.setenv("CIVITAS_L2_MAX_CNY_MICROS", "5000000")
    monkeypatch.setattr(live_client, "configured", lambda: live_client.PROVIDERS)
    available, = live_l2.admitted_providers()
    assert available.currency == "CNY"
    assert [item["provider"] for item in live_l2.capabilities()["providers"]] == [available.name]


def test_budget_unknown_usage_and_restart_never_mutate_uncommitted_step(lab):
    low = register(lab, budget_micros=1)
    result = lab.start(low, providers=(PROVIDER,), transport=lambda *_args, **_kw: pytest.fail("spent below reserve"),
                       foreground=True)
    assert result["termination_reason"] == "budget_limit"
    assert result["completeness"] == "none" and result["attempts"] == []

    key = register(lab)
    stalled = lab.start(key, providers=(PROVIDER,), transport=lambda *_args, **_kw: ok("bad", usage=None), foreground=True)
    assert stalled["termination_reason"] == "unknown_usage"
    assert stalled["completeness"] == "none" and stalled["coverage"]["model_committed"] == 0
    assert stalled["attempts"][0]["cost_micros"] is None

    with closing(api.connect()) as conn, conn:
        conn.execute("UPDATE live_l2_runs SET status='paused',owner=? WHERE id=?", ("99999999:dead-worker", key))
    interrupted = lab.read(key)
    assert interrupted["state"] == "interrupted"
    assert lab.control(key, "resume")["state"] == "interrupted"


def test_invalid_provider_action_retries_then_commits_rule_fallback(lab):
    key = register(lab, "information_cascade")
    run = lab.start(key, providers=(PROVIDER,), transport=lambda *_args, **_kwargs: ok("out-of-domain"), foreground=True)
    assert run["state"] == "completed" and run["actual_mode"] == "rule"
    assert run["coverage"]["fallback"] == 3 and run["coverage"]["attempts"] == 6
    assert all(attempt["reason"] == "invalid_action" for attempt in run["attempts"])


def test_public_http_endpoint_rule_reference_without_provider(local_app):
    capabilities = call(local_app, "/api/v2/model-lab")
    assert not capabilities["available"] and len(capabilities["cases"]) == 4
    key = str(uuid4())
    payload = dict(request_id=key, case_id="public_goods", action="10", seed=2000, mode="rule")
    assert call(local_app, "/api/v2/model-lab/runs", payload, 201)["state"] == "created"
    result = call(local_app, f"/api/v2/model-lab/runs/{key}/start", {}, 202)
    assert result["state"] == "completed" and result["actual_mode"] == "rule" and not result["attempts"]
    compare = call(local_app, f"/api/v2/model-lab/runs/{key}/compare")
    assert compare["rows"][-1]["checkpoint"] == 6
    assert all(row["baseline"] == row["branch"] for row in compare["rows"])
    exported = call(local_app, f"/api/v2/model-lab/runs/{key}/export")
    assert exported["prefix"]["engine_version"] == "public-goods/3"
    assert exported["prefix"]["metrics"] == exported["rule_reference"]["metrics"]
    assert call(local_app, "/api/v2/model-lab/runs", payload | {"mode": "live"}, 503)["detail"] == "LIVE_NOT_CONFIGURED"
