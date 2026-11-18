from urllib.parse import quote
from uuid import uuid4

from test_education_api import call
from test_flagship_projection import launch
from services.simulation.lessons import CATALOG, load_case


def test_registry_and_bounded_week_and_interval_evidence(local_app):
    key = launch(local_app, "beer_game")
    spec = call(local_app, "/api/emergence/cases/beer_game/mechanisms")
    assert spec["case_id"] == "beer_game"
    assert spec["economic_clock"]["field"] == "week"
    assert any(item["id"] == "retail_stock" for item in spec["macro_metrics"])
    trace = call(local_app, f"/api/emergence/runs/{key}/trace?seq=2&as_of_seq=2&actor_id={quote('零售商')}")
    assert trace["focus"]["economic_time"] == 2
    assert any(node["kind"] == "actor_state" and node["actor_id"] == "零售商" for node in trace["nodes"])
    interval = call(local_app, f"/api/emergence/runs/{key}/aggregate?from_seq=0&to_seq=2&as_of_seq=2&metric_id=retail_stock")
    assert [row["source_ref"]["seq"] for row in interval["events"]] == [1, 2]
    assert interval["end"]["value"] - interval["start"]["value"] == interval["delta"]
    assert all(row["source_ref"]["result_hash"] == trace["result_hash"] for row in interval["events"])
    assert call(local_app, f"/api/emergence/runs/{key}/aggregate?from_seq=0&to_seq=3&as_of_seq=2&metric_id=retail_stock",
                status=422)["detail"] == "FOCUS_NOT_VISIBLE"
    for case in CATALOG:
        spec = call(local_app, f"/api/emergence/cases/{case}/mechanisms")
        assert spec["case_id"] == case
        assert spec["decision_rules"][0]["version"]
        assert spec["macro_metrics"]


def test_auction_common_trace_links_orders_without_revealing_private_settlement(local_app):
    case = load_case("double_auction")
    key = str(uuid4())
    call(local_app, "/api/runs", {
        "case_id": case["case_id"], "request_id": key, "scenario_id": "baseline",
        "provider_kind": "rule", "seed": case["seed"], "bid": case["preset_bid"],
    }, status=201)
    call(local_app, f"/api/runs/{key}/start?manifest_only=true", {})
    stored = call(local_app, f"/api/runs/{key}/export")
    trade = next(event for event in stored["result"]["events"] if event["event_type"] == "trade")
    seq = trade["seq"]
    common = f"/api/emergence/runs/{key}"
    relations = call(local_app, f"{common}/relations?seq={seq}&as_of_seq={seq}")["relations"]
    assert len(relations) == 2
    orders = [stored["result"]["events"][node["source_refs"][0]["seq"]] for node in relations]
    assert {order["order_id"] for order in orders} == {trade["buy_order_id"], trade["sell_order_id"]}
    trace = call(local_app, f"{common}/trace?seq={seq}&as_of_seq={seq}")
    macro = next(node for node in trace["nodes"] if node["kind"] == "system_metric")
    assert macro["value"] == trade["price"]
    assert all("剩余" not in node["label"] for node in trace["nodes"])
    assert call(local_app, f"{common}/trace?seq={seq}&as_of_seq={seq}&metric_id=surplus", status=422
                )["detail"] == "METRIC_NOT_AVAILABLE"
