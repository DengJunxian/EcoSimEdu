from uuid import uuid4

from services.simulation.flagship_view import project_flagship
from services.simulation.lessons import load_case, simulate
from test_education_api import call


SVB = load_case("svb_run")


def launch(url, scenario, parent=None):
    identifier = str(uuid4())
    call(url, "/api/runs", {"request_id": identifier, "case_id": SVB["case_id"], "seed": SVB["seed"],
                           "provider_kind": "rule", "scenario_id": scenario, "action": "withdraw_now",
                           "parent_run_id": parent}, status=201)
    manifest = call(url, f"/api/runs/{identifier}/start?manifest_only=true", {})
    assert "result" not in manifest
    return identifier


def test_svb_checkpoint_and_ledger_use_actual_course_run(local_app):
    role = call(local_app, "/api/cases/svb_run/briefing")
    assert role["actor_id"] == "D01"
    key = launch(local_app, "baseline")
    endpoint = f"/api/runs/{key}/classroom-view"
    opening = call(local_app, endpoint)
    assert opening["end"] is None and opening["details"]["checkpoint"] is None
    assert len(opening["details"]["series"]) == 1
    actor = opening["frame"]["entities"][role["actor_id"]]
    assert (role["deposit"], role["payroll"], role["protected"]) == tuple(
        actor[field] for field in ("存款余额", "工资款", "已保障额度")
    )
    assert role["neighbors"] == opening["details"]["network"]["D01"]

    queued = call(local_app, endpoint + "?tick=checkpoint")
    assert (queued["tick"], queued["clock"], queued["details"]["checkpoint"]) == (9, 2, 9)
    frame = queued["frame"]
    assert [frame["metrics"][name] for name in ("cash", "queued", "equity")] == [0, 107, 155]
    assert len(queued["events"]) == len(queued["details"]["series"]) == 10
    pending = queued["events"][-1]["pending"]
    assert sum(item["remaining"] for item in pending) == 107
    d16 = next(item for item in pending if item["person"] == "D16")
    assert (d16["requested"], d16["paid"], d16["remaining"]) == (42, 4, 38)

    for event in queued["events"]:
        if event["event_type"] == "messages":
            for edge in event["messages"]:
                source = queued["events"][edge["origin_seq"]]
                assert source["seq"] < event["seq"] and source["event_type"] == "requests"
                assert edge["from"] in {item["person"] for item in source["requests"]}
    req, pay = (call(local_app, endpoint + f"?tick={event}") for event in (3, 4))
    for item, amount in ((req, 0), (pay, 32)):
        assert item["previous"]["metrics"]["cash"] - item["frame"]["metrics"]["cash"] == amount
        assert item["previous"]["entities"]["BANK"]["存款负债"] - item["frame"]["entities"]["BANK"]["存款负债"] == amount

    branch = launch(local_app, "liquidity_buffer", key)
    buffer = call(local_app, f"/api/runs/{branch}/classroom-view")
    assert buffer["root_hash"] == opening["root_hash"]
    assert buffer["initial_hash"] != opening["initial_hash"]
    assert buffer["frame"]["metrics"]["cash"] == 500 and buffer["frame"]["metrics"]["equity"] == 400
    assert call(local_app, f"/api/runs/{branch}/classroom-view?tick=checkpoint")["tick"] == 13
    same_round = next(row for row in call(local_app, f"/api/runs/{key}/compare/{branch}")["rows"]
                      if row["checkpoint"] == 2)
    assert same_round["baseline"]["tick"] == 9
    assert same_round["branch"]["metrics"]["queued"] == 0


def test_no_positive_equity_queue_lands_on_actual_close():
    # All opening securities are converted at opening value in this mechanism fixture.
    case = {**SVB, "scenarios": [*SVB["scenarios"], {
        "id": "fully_liquid", "parameters": {"cash_reallocation": 1700, "network": "concentrated"}
    }]}
    result = simulate(case, "fully_liquid", SVB["seed"], "withdraw_now")
    run = {"result": result, "run_id": str(uuid4()), "case_id": SVB["case_id"],
           "case_version": SVB["version"], "result_hash": "fixture", "scenario_id": "fully_liquid",
           "origin": "offline_simulation", "seed": SVB["seed"], "action": "withdraw_now", "parent_run_id": None}
    view = project_flagship(run, "checkpoint")
    assert view["closed"] and view["details"]["checkpoint"] is None
    assert view["events"][-1]["event_type"] == "closing" and view["frame"]["metrics"]["queued"] == 0
