import pytest

from services.simulation.auction import BOUNDARIES
from services.simulation.lessons import load_case
from test_education_api import call
from test_flagship_projection import launch


def test_cascade_briefing_and_review_protect_other_draws_until_reveal(local_app):
    case_id = "information_cascade"
    briefing = call(local_app, f"/api/cases/{case_id}/briefing")
    assert briefing == {
        "signal": "A", "prior": 20.0, "public_actions": [
            {"actor": "D01", "choice": "B"}, {"actor": "D02", "choice": "B"}
        ],
    }
    run = launch(local_app, case_id)
    endpoint = f"/api/runs/{run}/classroom-view"
    opening = call(local_app, endpoint)
    assert len(opening["events"]) == 1 and opening["end"] is None
    review = call(local_app, endpoint + "?tick=3&mode=review")
    assert len(review["events"]) > 4 and all(point["metrics"]["correct_pct"] is None for point in review["series"])
    for source in (review["frame"], review["previous"]):
        assert "私人抽样" not in source["entities"]["D01"]
        assert "私信号纳入后 A 箱概率（%）" not in source["entities"]["D02"]
    assert "signal" not in review["events"][1] and "signal_id" not in review["events"][2]
    assert "state" not in review["events"][-1] and "correct_count" not in review["events"][-1]
    assert review["events"][3]["signal"] == "A"
    assert review["events"][3]["choice_if_private_a"] == review["events"][3]["choice_if_private_b"] == "B"
    closed = call(local_app, endpoint + "?tick=close")
    assert closed["events"][1]["signal"] == "B" and closed["events"][-1]["state"] == "A"


def test_public_pool_trace_separates_contribution_settlement_and_sanction_boundary(local_app):
    case_id = "public_goods"
    base = launch(local_app, case_id)
    branch = launch(local_app, case_id, "low_cost", base)
    contributions = call(local_app, f"/api/runs/{base}/classroom-view?tick=1")
    assert contributions["events"][-1]["event_type"] == "contributions"
    assert len(contributions["events"]) == 2
    assert contributions["events"][-1]["public_return"] == pytest.approx(0.4 * 39)
    assert not any("本轮净收益" in state for state in contributions["frame"]["entities"].values())
    settlement = call(local_app, f"/api/runs/{branch}/classroom-view?tick=2")["events"][-1]
    assert settlement["sanctions"] and settlement["sanctions"][0]["from"] == "P4"
    for actor in settlement["net"]:
        assert settlement["net"][actor] == pytest.approx(
            settlement["gross"][actor] - settlement["outgoing"][actor] - settlement["fines"][actor]
        )
    boundary = launch(local_app, case_id, "boundary", action=BOUNDARIES[case_id]["action"])
    result = call(local_app, f"/api/runs/{boundary}/classroom-view?tick=close")
    assert result["intervention"]["unit_cost"] == 100
    assert all(not event["sanctions"] for event in result["events"] if event["event_type"] == "settlement")


def test_commons_reveals_renewal_after_allocation_and_keeps_transfer_separate(local_app):
    case_id = "commons_governance"
    case = load_case(case_id)
    base = launch(local_app, case_id)
    branch = launch(local_app, case_id, "community", base, seed=case["seed"])
    assigned = call(local_app, f"/api/runs/{base}/classroom-view?tick=1")
    assert assigned["frame"]["metrics"]["growth"] is None
    assert all(event["event_type"] != "growth" for event in assigned["events"])
    after_growth = call(local_app, f"/api/runs/{base}/classroom-view?tick=2")["events"][-1]
    assert after_growth["remaining_stock"] == 105
    assert after_growth["next_stock"] == pytest.approx(105 + after_growth["growth"])
    community = call(local_app, f"/api/runs/{branch}/classroom-view?tick=close")
    measured = [event for event in community["events"] if event["event_type"] == "withdrawal" and event["monitoring_cost"]]
    assert measured
    for event in measured:
        transfer = sum(event["fines"].values())
        assert event["monitor_budget_after"] - event["monitor_budget_before"] == pytest.approx(
            transfer - event["monitoring_cost"]
        )
        assert event["participant_net"] + transfer == pytest.approx(event["gross_value"])
    boundary = launch(local_app, case_id, "boundary", action=BOUNDARIES[case_id]["action"])
    result = call(local_app, f"/api/runs/{boundary}/classroom-view?tick=close")
    assert result["frame"]["metrics"]["stock"] == 0
    assert all(event["growth"] == 0 for event in result["events"] if event["event_type"] == "growth")
