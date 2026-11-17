from uuid import uuid4

from services.simulation.auction import CASE, ENGINE_VERSION, digest, run_auction
from test_education_api import call


def launch(url, scenario="baseline", bid=96, parent=None):
    run_id = str(uuid4())
    call(url, "/api/runs", {"request_id": run_id, "case_id": CASE["case_id"],
                           "scenario_id": scenario, "seed": CASE["seed"], "bid": bid,
                           "provider_kind": "rule", "parent_run_id": parent}, status=201)
    manifest = call(url, f"/api/runs/{run_id}/start?manifest_only=true", {})
    assert manifest["execution_status"] == "completed"
    assert "result" not in manifest
    return run_id


def test_classroom_projection_masks_future_and_preserves_order_lineage(local_app):
    key = launch(local_app)
    route = f"/api/runs/{key}/auction-view"
    opening = call(local_app, route + "?explain=true")
    assert opening["events"] == [{"event_type": "market_open", "seq": 0, "tick": 0}]
    assert opening["end"] is None and opening["private_information"] is None
    assert opening["frame"]["last_price"] is None and "surplus" not in opening["frame"]
    assert opening["evidence"] is None

    old_run = call(local_app, f"/api/runs/{key}")
    assert old_run["result_hash"] == digest(run_auction("baseline", CASE["seed"], 96))
    trade = next(event for event in old_run["result"]["events"] if event["event_type"] == "trade")
    tick = trade["tick"]
    guided = call(local_app, f"{route}?tick={tick}")
    review = call(local_app, f"{route}?tick={tick}&mode=review&explain=true")
    assert len(guided["events"]) == tick + 1 and "buyer_surplus" not in guided["events"][-1]
    assert guided["settlement"].get("value") is None
    assert len(review["events"]) == len(old_run["result"]["events"])
    settlement = review["settlement"]
    assert settlement["buy"]["order_id"] == trade["buy_order_id"]
    assert settlement["sell"]["order_id"] == trade["sell_order_id"]
    assert next(side["price"] for side in (settlement["buy"], settlement["sell"])
                if side["order_id"] == settlement["maker_order_id"]) == trade["price"]
    assert settlement["buyer_surplus"] + settlement["seller_surplus"] + settlement["platform_fee"] == (
        settlement["value"] - settlement["cost"])
    for role, movement in (("buyer", 1), ("seller", -1)):
        actor = trade[f"{role}_id"]
        assert review["frame"]["accounts"][actor]["goods"] - settlement["before"][actor]["goods"] == movement
    assert guided["evidence"] == review["evidence"] == {
        "kind": "trade", "run_id": key, "case_version": CASE["version"], "engine_version": ENGINE_VERSION,
        "result_hash": old_run["result_hash"], "tick": tick, "seq": trade["seq"], "actor_id": trade["buyer_id"],
        "metric": "last_price", "unit": CASE["price_unit"], "value": trade["price"],
    }
    assert call(local_app, route + "?tick=9999", status=404)["detail"] == "SNAPSHOT_NOT_AVAILABLE"


def test_unfilled_student_order_and_fee_rejection_keep_exact_comparison_inputs(local_app):
    key = launch(local_app, bid=1)
    route = f"/api/runs/{key}/auction-view"
    close = call(local_app, route + "?tick=close")
    assert close["closed"] and close["student_trade"] is None and close["frame"]["volume"] > 0
    cancellation = call(local_app, f"{route}?tick={close['student_close']}")
    assert cancellation["evidence"]["kind"] == "unfilled" and cancellation["evidence"]["value"] == 0
    assert cancellation["events"][-1]["order_id"] == close["student_order"]["order_id"]

    base = launch(local_app, bid=108)
    branch = launch(local_app, "fee", bid=108, parent=base)
    comparison = call(local_app, f"/api/runs/{base}/compare/{branch}")
    rejected = call(local_app, f"/api/runs/{branch}/auction-view?tick=1")
    assert rejected["student_order"]["event_type"] == "order_rejected"
    assert rejected["bid"] == 108 and rejected["intervention"]["fee"] == 6
    assert comparison["rows"][-1]["phase"] == "ending"
    branch_run = call(local_app, f"/api/runs/{branch}")
    trade = next(event for event in branch_run["result"]["events"] if event["event_type"] == "trade")
    settled = call(local_app, f"/api/runs/{branch}/auction-view?tick={trade['tick']}&mode=review&explain=true")["settlement"]
    assert settled["platform_fee"] == 12
    assert settled["buyer_surplus"] + settled["seller_surplus"] + settled["platform_fee"] == settled["value"] - settled["cost"]
    for branch_id in (base, branch):
        assert call(local_app, f"/api/runs/{branch_id}")["bid"] == 108
