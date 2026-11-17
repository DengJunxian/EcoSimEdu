import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from scripts.check_boundaries import RECEIPT, audit
from services.simulation.auction import CASE, digest
from test_education_api import call, params


def test_auction_boundary_is_a_fixed_zero_trade_run(local_app):
    modes = []
    for provider in ("rule", "replay"):
        run = call(local_app, "/api/runs", params(scenario_id="boundary", bid=35, provider_kind=provider), 201)
        path = f"/api/runs/{run['run_id']}"
        run = call(local_app, path + "/start", {})
        modes.append(run)
        assert run == call(local_app, path + "/export")
        schema = json.loads((Path(__file__).resolve().parents[2] / "schemas/double_auction.run.schema.json").read_text())
        Draft202012Validator(schema).validate(run)
        result = run["result"]
        metrics = result["metrics"]
        assert metrics["volume"] == metrics["ceiling"] == metrics["surplus"] == 0
        assert all(metrics[name] is None for name in ("price_min", "price_max", "price_band", "efficiency"))
        assert call(local_app, path + f"/trace/{len(result['events'])-1}")["event"]["event_type"] == "market_close"
        assert run["result_hash"] == digest(result)
    assert modes[0]["result_hash"] == modes[1]["result_hash"]
    assert {run["origin"] for run in modes} == {"precomputed_simulation", "offline_simulation"}
    for overrides in ({"bid": 36}, {"seed": CASE["seed"] + 1}, {"parent_run_id": modes[0]["run_id"]}):
        assert call(local_app, "/api/runs", params(**({"scenario_id": "boundary", "bid": 35} | overrides)), 422
                    )["detail"] == "BOUNDARY_PARAMETERS_MISMATCH"


def test_boundary_receipt_matches_recomputed_mechanisms():
    assert audit() == json.loads(RECEIPT.read_text())


@pytest.mark.parametrize("fixture", json.loads(RECEIPT.read_text())[1:], ids=lambda row: row["case_id"])
def test_generic_boundary_contract(local_app, fixture):
    request = params(case_id=fixture["case_id"], scenario_id="boundary", seed=fixture["seed"])
    request.pop("bid")
    request.update(fixture["input"])
    for change in ({"provider_kind": "replay"}, {"provider_kind": "live"}, {"seed": fixture["seed"] + 1}):
        assert call(local_app, "/api/runs", request | change, 422)["detail"] == "BOUNDARY_PARAMETERS_MISMATCH"
    created = call(local_app, "/api/runs", request, 201)
    path = f"/api/runs/{created['run_id']}"
    finished = call(local_app, path + "/start", {})
    assert finished["result_hash"] == fixture["result_hash"]
    assert finished["result"]["metrics"] == fixture["final_metrics"]
    assert finished == call(local_app, path + "/export") == call(local_app, path + "/start", {})
    schema = json.loads((RECEIPT.parents[2] / "schemas/lesson.run.schema.json").read_text())
    Draft202012Validator(schema).validate(finished)
