import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from jsonschema import Draft202012Validator

from services.simulation.auction import CASE


def call(url, path, payload=None, status=200):
    request = Request(url + path, headers={"Content-Type": "application/json"},
                      data=None if payload is None else json.dumps(payload).encode())
    try:
        with urlopen(request, timeout=10) as result:
            assert result.status == status
            return json.load(result)
    except HTTPError as result:
        assert result.code == status
        return json.load(result)


def params(**overrides):
    return {"request_id": str(uuid4()), "case_id": "double_auction", "scenario_id": "baseline",
            "provider_kind": "rule", "seed": CASE["seed"], "bid": CASE["preset_bid"], **overrides}


def test_case_package_is_coherent(local_app):
    case = call(local_app, "/api/case")
    capabilities = call(local_app, "/api/capabilities")
    assert case == CASE
    assert case["identity"] == "academic_experiment" and case["price_unit"] == "代币/件"
    assert [x["id"] for x in case["lessons"]] == ["intro", "predict", "bid", "observe", "explain", "compare", "notebook"]
    assert [x["id"] for x in case["scenarios"]] == capabilities["presets"]
    assert len(set(x["id"] for x in case["sources"])) == 2
    assert all(x["url"].startswith("https://") and x["supports"] for x in case["sources"])
    assert "unknown" in case["questions"]["prediction"]["options"]
    assert case["questions"]["explain"]["answer"] in case["questions"]["explain"]["options"]


def test_idempotency_replay_and_comparison(local_app):
    payload = params()
    key = call(local_app, "/api/runs", payload, 201)["run_id"]
    path = f"/api/runs/{key}"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: call(local_app, path + "/start", {}), range(2)))
    schema = json.loads((Path(__file__).resolve().parents[2] / "schemas/double_auction.run.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    run = results[0]
    validator.validate(run)
    assert run == results[1] == call(local_app, path + "/export")
    assert run["execution_status"] == "completed" and run["origin"] == "offline_simulation"
    assert call(local_app, path + "/snapshots/2") == run["result"]["snapshots"][2]
    assert call(local_app, path + "/snapshots/999", status=404)["detail"] == "SNAPSHOT_NOT_AVAILABLE"
    assert call(local_app, "/api/runs", {**payload, "bid": 95}, 409)["detail"] == "REQUEST_ID_CONFLICT"
    for provider, scenario in (("replay", "baseline"), ("rule", "fee")):
        child = call(local_app, "/api/runs", params(provider_kind=provider, scenario_id=scenario,
                     parent_run_id=key if scenario != "baseline" else None), 201)
        child = call(local_app, f"/api/runs/{child['run_id']}/start", {})
        validator.validate(child)
        assert child["result"]["root_hash"] == run["result"]["root_hash"]
        if provider == "replay":
            assert child["origin"] == "precomputed_simulation"
            assert child["result_hash"] == run["result_hash"]
        else:
            assert child["parent_run_id"] == key and child["result"]["intervention"]["fee"] == 6


def test_validation_and_cancel(local_app):
    for bad in ({"seed": -1}, {"bid": 109}, {"bid": "96"}, {"scenario_id": "other"}, {"token": "unexpected"}):
        call(local_app, "/api/runs", params(**bad), 422)
    assert call(local_app, "/api/runs", params(provider_kind="replay", bid=97), 422)["detail"] == "PRESET_NOT_AVAILABLE"
    assert call(local_app, "/api/runs", params(provider_kind="live"), 503)["detail"] == "LIVE_NOT_CONFIGURED"
    run = call(local_app, "/api/runs", params(), 201)
    path = f"/api/runs/{run['run_id']}"
    assert call(local_app, path + "/cancel", {})["execution_status"] == "cancelled"
    assert call(local_app, path + "/cancel", {})["execution_status"] == "cancelled"
    assert call(local_app, path + "/start", {}, 409)["detail"] == "RUN_ALREADY_TERMINAL"
