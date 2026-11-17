import json
from pathlib import Path
from uuid import uuid4

import pytest
from jsonschema import Draft202012Validator

from services.simulation.lessons import CATALOG, load_case

from test_education_api import call


def payload(case, scenario="baseline", **kwargs):
    return {
        "request_id": str(uuid4()), "case_id": case["case_id"], "scenario_id": scenario,
        "provider_kind": "rule", "seed": case["seed"], "action": case["action"]["default"], **kwargs,
    }


def test_published_catalog_matches_browser_content_source(local_app):
    packages = call(local_app, "/api/cases")
    assert [case["case_id"] for case in packages] == list(CATALOG)
    assert len(packages) == 12
    curriculum = json.loads((Path(__file__).resolve().parents[2] / "docs/curriculum/knowledge-map.json").read_text())
    assert sorted(case_id for path in curriculum["paths"] for case_id in path["cases"]) == sorted(CATALOG)
    assert {item["case_id"] for item in curriculum["lessons"]} == set(CATALOG)
    assert all(len(case["lessons"]) == 7 and len(case["scenarios"]) >= 3 for case in packages)


@pytest.mark.parametrize("case_id", CATALOG[1:])
def test_run_pair_and_trace(local_app, case_id):
    case = load_case(case_id)
    base_request = payload(case)
    base = call(local_app, "/api/runs", base_request, 201)
    path = f"/api/runs/{base['run_id']}"
    base = call(local_app, path + "/start", {})
    schema = json.loads((Path(__file__).resolve().parents[2] / "schemas/lesson.run.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    contract = Draft202012Validator(schema)
    contract.validate(base)
    assert base == call(local_app, "/api/runs", base_request, 201)
    assert base["case_id"] == case_id and base["action"] == case["action"]["default"]
    for scenario in case["scenarios"][1:]:
        branch = call(local_app, "/api/runs", payload(case, scenario["id"], parent_run_id=base["run_id"]), 201)
        branch = call(local_app, f"/api/runs/{branch['run_id']}/start", {})
        contract.validate(branch)
        assert branch["parent_run_id"] == base["run_id"]
        assert branch["result"]["root_hash"] == base["result"]["root_hash"]
        assert branch["result"]["intervention"] == scenario["parameters"]
        assert branch["execution_status"] == "completed"
    trace = call(local_app, path + "/trace/1")
    assert trace["event"] == base["result"]["events"][1]
    assert trace["before"] == base["result"]["snapshots"][0]
    assert trace["after"] == call(local_app, path + "/snapshots/1")
    assert trace["result_hash"] == base["result_hash"]
    event = call(local_app, path + "/events/1")
    assert event == {"run_id": base["run_id"], "case_id": case_id, "case_version": case["version"],
                     "result_hash": base["result_hash"], "event_count": len(base["result"]["events"]),
                     "event": trace["event"], "snapshot_tick": 1}
    assert call(local_app, path + "/trace/-1", status=404)["detail"] == "SNAPSHOT_NOT_AVAILABLE"
    assert call(local_app, "/api/runs", payload(case, action="not-a-choice"), 422)["detail"] == "INVALID_ACTION"
    half = {**base_request, "request_id": str(uuid4()), "provider_kind": "replay"}
    assert call(local_app, "/api/runs", half, 422)["detail"] == "PRESET_NOT_AVAILABLE"


def test_cross_course_branch_is_rejected(local_app):
    case = load_case("schelling_segregation")
    parent = call(local_app, "/api/runs", payload(case), 201)["run_id"]
    call(local_app, f"/api/runs/{parent}/start", {})
    auction = {"request_id": str(uuid4()), "case_id": "double_auction", "scenario_id": "fee",
               "provider_kind": "rule", "seed": 1962, "bid": 96, "parent_run_id": parent}
    assert call(local_app, "/api/runs", auction, 422)["detail"] == "INVALID_COMPARISON_PARENT"


def test_auction_trace_links_actual_order_records(local_app):
    request = {"request_id": str(uuid4()), "case_id": "double_auction", "scenario_id": "baseline",
               "provider_kind": "rule", "seed": 1962, "bid": 96}
    key = call(local_app, "/api/runs", request, 201)["run_id"]
    path = f"/api/runs/{key}"
    run = call(local_app, path + "/start", {})
    trade = next(event for event in run["result"]["events"] if event["event_type"] == "trade")
    trace = call(local_app, path + f"/trace/{trade['tick']}")
    assert {order["order_id"] for order in trace["linked_events"]} == {trade["buy_order_id"], trade["sell_order_id"]}
    assert trace["before"]["volume"] + 1 == trace["after"]["volume"]
