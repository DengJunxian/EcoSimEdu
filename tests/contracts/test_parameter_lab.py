from uuid import uuid4

import pytest

from services.simulation.lessons import CATALOG, load_case
from services.simulation.parameter_specs import baseline
from test_education_api import call


def payload(case_id, patch=None, **changes):
    course = load_case(case_id)
    action = {"bid": 96} if case_id == "double_auction" else {"action": course["action"]["default"]}
    return {"schema_version": 2, "request_id": str(uuid4()), "provider_kind": "rule", "case_id": case_id,
            "scenario_id": "baseline", "seed": course["seed"], "parameter_patch": patch or {}, **action, **changes}


def finish(url, request):
    created = call(url, "/api/runs", request, 201)
    return call(url, f"/api/runs/{created['run_id']}/start", {})


def pair(url, case_id, patch, left=None, **choices):
    base = finish(url, payload(case_id, left, **choices))
    branch = finish(url, payload(case_id, patch, parent_run_id=base["run_id"], **choices))
    align = call(url, f"/api/runs/{base['run_id']}/compare/{branch['run_id']}")
    return base, branch, align


@pytest.mark.parametrize("case_id,patch", [
    ("double_auction", {"demand_shift": 6, "fee": 12}),
    ("svb_run", {"cash_reallocation": 600}),
    ("schelling_segregation", {"threshold": 10}),
    ("information_cascade", {"verification_turn": 4}),
    ("public_goods", {"unit_cost": 2}),
    ("commons_governance", {"institution": "community"}),
    ("lemons_market", {"information": "certified", "certification_fee": 1}),
    ("school_matching", {"extra_a_seats": 2}),
    ("beer_game", {"delay": 3}),
    ("carbon_market", {"cap": 64}),
    ("flash_crash", {"depth_multiplier": 3, "pause_steps": 5}),
    ("gamestop", {"social_weight": 0, "loan_supply": 0}),
])
def test_published_parameter_reaches_engine_and_export(local_app, case_id, patch):
    spec = call(local_app, f"/api/cases/{case_id}/parameters")
    assert case_id in CATALOG
    known = {item["id"]: item for item in spec["parameters"]}
    assert all(value in known[key]["values"] for key, value in patch.items())
    base, branch, alignment = pair(local_app, case_id, patch)
    output = branch["result"]
    assert output["intervention"] == {**baseline(load_case(case_id)), **patch}
    assert branch["parameter_patch"] == patch and output["seed_plan"]["seed"] == branch["seed"]
    assert base["result"]["root_hash"] == output["root_hash"] == alignment["conditions"]["common_root"]
    assert set(alignment["conditions"]["treatments"]) == patch.keys()
    assert alignment["rows"][0]["phase"] == "opening" and alignment["rows"][-1]["phase"] in ("ending", "checkpoint")
    for row in alignment["rows"]:
        for field, run in (("baseline", base), ("branch", branch)):
            if point := row[field]:
                assert point["tick"] == run["result"]["snapshots"][point["tick"]]["tick"]
    assert call(local_app, f"/api/runs/{branch['run_id']}/export") == branch
    repeated = finish(local_app, payload(case_id, patch))
    assert repeated["result_hash"] == branch["result_hash"]


def test_schelling_initial_geographies_keep_population_and_common_visit_plan(local_app):
    base, branch, alignment = pair(local_app, "schelling_segregation",
                                   {"threshold": 0, "initial_layout": "segregated"},
                                   {"threshold": 0, "initial_layout": "mixed"})
    a, b = base["result"], branch["result"]
    assert a["engine_version"] == b["engine_version"] == "schelling/2"
    assert a["root_hash"] == b["root_hash"] and a["initial_hash"] != b["initial_hash"]
    assert alignment["conditions"]["class"] == "initial_treatment"
    assert set(alignment["conditions"]["treatments"]) == {"initial_layout"}
    assert {actor for actor in a["initial"]["grid"]} == {actor for actor in b["initial"]["grid"]}
    assert [i for i, cell in enumerate(a["initial"]["grid"]) if cell is None] == [
        i for i, cell in enumerate(b["initial"]["grid"]) if cell is None]
    assert len([actor for actor in a["initial"]["grid"] if actor and actor[0] == "A"]) == 170
    assert len([actor for actor in a["initial"]["grid"] if actor and actor[0] == "B"]) == 170
    assert a["snapshots"][0]["metrics"]["similarity"] < b["snapshots"][0]["metrics"]["similarity"]
    assert a["metrics"]["moves"] == b["metrics"]["moves"] == 0


def test_beer_weekly_order_plan_is_an_action_tape_and_drives_actual_orders(local_app):
    orders = {"5": 21, "6": 0, "40": 14}
    base, branch, _ = pair(local_app, "beer_game", {"delay": 3}, weekly_orders=orders)
    for run in (base, branch):
        assert run["weekly_orders"] == orders
        assert run["result"]["engine_version"] == "beer/2"
        weeks = {str(event["week"]): event for event in run["result"]["events"] if event["event_type"] == "week_end"}
        for week, amount in orders.items():
            assert weeks[week]["orders"]["零售商"] == amount
        assert weeks["6"]["demand_received"]["批发商"] == 21
    rejected = payload("beer_game", {"delay": 1}, weekly_orders={"5": 20}, parent_run_id=base["run_id"])
    assert call(local_app, "/api/runs", rejected, 422)["detail"] == "INVALID_COMPARISON_PARENT"


@pytest.mark.parametrize("case_id,patch,changes", [
    ("double_auction", {"fee": 13}, {}),
    ("double_auction", {"fee": 12}, {"bid": 108}),
    ("double_auction", {"fee": 1}, {"provider_kind": "replay"}),
    ("svb_run", {"cash_reallocation": 201}, {}),
    ("lemons_market", {"certification_fee": 0.5}, {}),
    ("public_goods", {"unit_cost": 0}, {}),
    ("information_cascade", {"observe_actions": 1}, {}),
    ("beer_game", {}, {"weekly_orders": {"0": 10}}),
    ("beer_game", {}, {"weekly_orders": {"5": True}}),
])
def test_invalid_parameters_and_unsupported_precomputation_rejected(local_app, case_id, patch, changes):
    assert call(local_app, "/api/runs", payload(case_id, patch, **changes), 422)["detail"]


def test_exact_replay_keeps_preset_hash_and_new_auction_bid_uses_shifted_value(local_app):
    legacy = payload("double_auction", provider_kind="replay")
    for key in ("schema_version", "parameter_patch"):
        del legacy[key]
    v1 = finish(local_app, legacy)
    v2 = finish(local_app, payload("double_auction", {"fee": 0}, provider_kind="replay"))
    assert v1["result_hash"] == v2["result_hash"] and v1["result"] == v2["result"]
    assert v2["seed_plan"]["seed"] == v2["seed"]
    changed = finish(local_app, payload("double_auction", {"demand_shift": 18, "fee": 2}, bid=124))
    assert changed["result"]["events"][1]["event_type"] == "order_submitted"
    assert changed["result"]["initial"]["B01"]["marginals"][0] == 126


def test_public_goods_action_tape_preserves_simultaneous_settlement(local_app):
    plan = {"1": 0, "4": 20, "10": 13}
    base, branch, _ = pair(local_app, "public_goods", {"unit_cost": 2}, round_contributions=plan)
    for run in (base, branch):
        assert run["round_contributions"] == plan
        assert run["result"]["engine_version"] == "public-goods/2"
        for event in run["result"]["events"]:
            if event["event_type"] == "contributions" and str(event["round"]) in plan:
                assert event["contributions"]["P1"] == plan[str(event["round"])]
                assert len(event["contributions"]) == 4
                settlement = run["result"]["events"][event["seq"] + 1]
                assert settlement["round"] == event["round"]
                assert settlement["event_type"] == "settlement"
    rejected = payload("public_goods", round_contributions={"4": 21})
    assert call(local_app, "/api/runs", rejected, 422)["detail"] == "INVALID_ROUND_CONTRIBUTIONS"
