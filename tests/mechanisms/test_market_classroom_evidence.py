"""Verify the economic contrasts used by the three upgraded market classrooms."""
from services.simulation import gamestop
from services.simulation.lessons import load_case, simulate


def run(case_id, scenario, action=None):
    case = load_case(case_id)
    return simulate(case, scenario, case["seed"], action if action is not None else case["action"]["default"])


def test_carbon_allocation_preserves_resource_cost_and_exposes_transfer_and_empty_paths():
    base = run("carbon_market", "baseline")
    redistributed = run("carbon_market", "redistribute")
    uniform = run("carbon_market", "uniform")
    boundary = run("carbon_market", "boundary", "0")
    assert base["metrics"]["abatement_cost"] == redistributed["metrics"]["abatement_cost"] == 1318.5
    assert uniform["metrics"]["abatement_cost"] == 1577.5
    assert base["metrics"]["permits_moved"] != redistributed["metrics"]["permits_moved"]
    for left in (base, redistributed, uniform):
        first = next(event for event in left["events"] if event["event_type"] == "transfer")
        assert first["seller"] in first["actors"] and first["buyer"] in first["actors"]
        liable = left["snapshots"][-1]["entities"]
        assert sum(row["配额净支付"] for actor, row in liable.items() if actor.startswith("F")) == 0
    assert boundary["metrics"]["price"] is None
    assert not any(event["event_type"] == "transfer" for event in boundary["events"])


def test_flash_depth_counts_only_resting_orders_and_last_trade_keeps_its_source():
    result = run("flash_crash", "baseline")
    withdrawal = next(event for event in result["events"] if event["event_type"] == "cancel")
    event_no = withdrawal["seq"]
    before, here = (result["snapshots"][index]["metrics"] for index in (event_no - 1, event_no))
    earlier_trade = next(e for e in reversed(result["events"][:event_no]) if e["event_type"] == "trade")
    assert here["bid_depth"] == before["bid_depth"] - withdrawal["quantity"]
    assert here["volume"] == before["volume"] and here["last_price"] == earlier_trade["price_cents"] / 100
    boundary = run("flash_crash", "boundary", "tight")
    assert boundary["metrics"]["program_filled"] == 0
    assert boundary["metrics"]["program_queued"] > 0
    assert any(event["event_type"] == "pause" for event in boundary["events"])
    assert not any(event["event_type"] == "resume" for event in boundary["events"])


def test_gamestop_message_references_and_borrowed_shares_have_distinct_units_and_sources():
    base = run("gamestop", "baseline")
    disabled = run("gamestop", "no_social")
    no_borrow = run("gamestop", "boundary", "observe")
    assert base["metrics"]["reach"] == disabled["metrics"]["reach"] == 5
    assert base["metrics"]["social_buys"] == 18 and disabled["metrics"]["social_buys"] == 0
    returns = [e for e in base["events"] if e["event_type"] == "return"]
    assert len(returns) == 1
    snap = base["snapshots"][returns[0]["seq"]]
    assert snap["entities"][gamestop.SHORT]["股票交还义务（股）"] == returns[0]["remaining_debt"] == 8
    for forward in (e for e in base["events"] if e["event_type"] == "forward"):
        original = base["events"][forward["origin_seq"]]
        assert original["seq"] < forward["seq"] and original["event_type"] == "message"
        assert original["message_id"] == forward["message_id"]
    assert no_borrow["metrics"]["short_interest"] == 0
    assert not any(e["event_type"] in {"loan", "margin_call", "return"} for e in no_borrow["events"])
