from unittest.mock import patch

import pytest

from services.simulation.auction import CASE, SCENARIOS, digest, initial_agents, run_auction


@pytest.mark.parametrize("scenario", SCENARIOS)
@pytest.mark.parametrize("seed,bid", [(1962, 96), (0, 1), (77, 108), (2**32 - 1, 97)])
def test_tape_matches_orders_and_conserves_assets(scenario, seed, bid):
    with patch("socket.socket.connect", side_effect=AssertionError("socket use")):
        result = run_auction(scenario, seed, bid)
        assert digest(result) == digest(run_auction(scenario, seed, bid))
    assert result["root_hash"] == digest(initial_agents(seed))
    fee = result["intervention"]["fee"]
    initial = result["initial"]
    cash = sum(a["cash"] for a in initial.values())
    goods = sum(a["goods"] for a in initial.values())
    orders = {}
    volume = accrued = fees = 0
    for seq, (event, frame) in enumerate(zip(result["events"], result["snapshots"], strict=True)):
        assert frame["tick"] == event["seq"] == event["tick"] == seq
        assert sum(a["cash"] for a in frame["accounts"].values()) + frame["platform_cash"] == cash
        assert sum(a["goods"] for a in frame["accounts"].values()) == goods
        assert all(a["cash"] >= 0 and a["goods"] >= 0 for a in frame["accounts"].values())
        if event["event_type"] == "order_submitted":
            orders[event["order_id"]] = event
        if event["event_type"] == "trade":
            buy = orders[event["buy_order_id"]]
            sell = orders[event["sell_order_id"]]
            assert buy["actor_id"] == event["buyer_id"]
            assert sell["actor_id"] == event["seller_id"]
            assert buy["price"] >= event["price"] >= sell["price"]
            assert event["price"] == min((buy, sell), key=lambda order: order["seq"])["price"]
            assert event["platform_fee"] == 2 * fee
            buyer_id = event["buyer_id"]
            seller_id = event["seller_id"]
            before = result["snapshots"][seq - 1]["accounts"]
            value = initial[buyer_id]["marginals"][before[buyer_id]["filled"]]
            cost = initial[seller_id]["marginals"][before[seller_id]["filled"]]
            assert event["buyer_surplus"] == value - event["price"] - fee >= 0
            assert event["seller_surplus"] == event["price"] - fee - cost >= 0
            accrued += value - cost
            fees += 2 * fee
            volume += 1
        assert (frame["volume"], frame["surplus"], frame["platform_cash"]) == (volume, accrued, fees)
    metrics = result["metrics"]
    assert metrics["surplus"] == accrued <= metrics["ceiling"]
    expected = sum(max(0, bid - ask) for bid, ask in zip(result["demand"], result["supply"]))
    assert metrics["ceiling"] == expected
    assert result["snapshots"][-1]["orders"] == []


def test_paired_intervention_and_zero_trade_boundary():
    runs = {name: run_auction(name, CASE["seed"], CASE["preset_bid"]) for name in SCENARIOS}
    assert len({run["root_hash"] for run in runs.values()}) == 1
    assert runs["baseline"]["initial_hash"] == runs["fee"]["initial_hash"]
    assert runs["demand"]["initial_hash"] != runs["baseline"]["initial_hash"]
    assert runs["demand"]["supply"] == runs["baseline"]["supply"]
    assert runs["demand"]["demand"] == [value + 12 for value in runs["baseline"]["demand"]]

    no_overlap = initial_agents(0)
    for account in no_overlap.values():
        account["marginals"] = [10 if account["side"] == "buy" else 50] * len(account["marginals"])
    with patch("services.simulation.auction.initial_agents", return_value=no_overlap):
        metrics = run_auction("baseline", 0, 10)["metrics"]
    assert metrics["volume"] == metrics["ceiling"] == 0
    assert metrics["efficiency"] is None and metrics["price_min"] is None


def test_offline_service_does_not_import_credential_configuration():
    import subprocess
    import sys

    subprocess.run([sys.executable, "-c", """
import sys
from unittest.mock import patch
with patch('socket.socket.connect', side_effect=AssertionError('socket use')):
    from services.simulation.api import app, replay, RunRequest
    from services.simulation.auction import CASE, run_auction
    import uuid
    request = RunRequest(request_id=uuid.uuid4(), case_id=CASE['case_id'], scenario_id='baseline',
                         provider_kind='replay', seed=CASE['seed'], bid=CASE['preset_bid'])
    assert replay(request) == run_auction('baseline', CASE['seed'], CASE['preset_bid'])
assert 'config' not in sys.modules
assert 'core.llm.config' not in sys.modules
"""], check=True)
