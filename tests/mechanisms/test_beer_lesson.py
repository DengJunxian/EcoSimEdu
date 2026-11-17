from copy import deepcopy
from pathlib import Path
from statistics import pvariance
import json

import pytest

from services.simulation.auction import digest
from services.simulation.beer import ROLES, run_chain, simulate

CASE = json.loads((Path(__file__).resolve().parents[2] / "cases/beer_game/case.json").read_text())


@pytest.mark.parametrize("scenario", [s["id"] for s in CASE["scenarios"]])
def test_weekly_stocks_pipe_and_orders_reconcile(scenario):
    run = simulate(CASE, scenario, CASE["seed"], "12")
    assert digest(run) == digest(simulate(CASE, scenario, CASE["seed"], "12"))
    initial = run["initial"]
    opening = sum(initial["stock"].values()) + sum(batch["amount"] for batch in initial["initial_batches"])
    assert initial["demand"] == [4] * 4 + [8] * 36
    production = []
    for prev, event, frame in zip(run["snapshots"], run["events"][1:], run["snapshots"][1:]):
        assert frame["tick"] == event["week"]
        state = frame["entities"]
        for i, (role, cell) in enumerate(state.items()):
            before = prev["entities"][role]
            received = sum(batch["amount"] for batch in event["arrivals"] if batch["receiver"] == role)
            available = before["期末库存"] + received
            due = before["期末积压"] + event["demand_received"][role]
            shipped = min(available, due)
            assert cell["期末库存"] == available - shipped
            assert cell["期末积压"] == due - shipped
            assert cell["全部已订未到"] == before["全部已订未到"] + event["orders"][role] - received
            assert cell["库存位置"] == cell["期末库存"] - cell["期末积压"] + cell["全部已订未到"]
            physical = sum(batch["amount"] for batch in event["in_transit_batches"] if batch["receiver"] == role)
            unshipped = event["orders"][role] + state[ROLES[i + 1]]["期末积压"] if i < 3 else 0
            assert cell["全部已订未到"] == physical + unshipped
        assert sum(cell["期末库存"] for cell in state.values()) + frame["metrics"]["in_transit"] + event["delivered"] == opening + event["produced"]
        assert all(batch["due"] == event["week"] for batch in event["arrivals"])
        assert all(batch["due"] - batch["sent"] == initial["delay"] for batch in event["dispatches"])
        assert all(
            any(batch == sent for sent in run["events"][batch["origin_seq"]]["dispatches"])
            for batch in event["arrivals"] if "origin_seq" in batch
        )
        assert 0 <= event["production"] <= initial["factory_capacity"]
        production.append(event["production"])
    assert run["events"][5]["orders"]["零售商"] == 12
    assert run["metrics"]["factory_variance_ratio"] == pytest.approx(pvariance(production) / pvariance(initial["demand"]))


def test_hand_check_stock_and_pairing():
    base = simulate(CASE, "baseline", 1989, "12")
    shorter = simulate(CASE, "shorter", 1989, "12")
    assert base["root_hash"] == shorter["root_hash"]
    assert base["initial_hash"] != shorter["initial_hash"]
    shock = base["snapshots"][5]["entities"]["零售商"]
    assert (shock["期末库存"], shock["期末积压"], shock["本周到货"], shock["本周下单"]) == (8, 0, 4, 12)
    assert base["events"][6]["demand_received"]["批发商"] == 12
    assert base["snapshots"][4]["metrics"]["factory_variance_ratio"] is None


def test_delay_and_zero_variance_boundary():
    case = deepcopy(CASE)
    args = case["scenarios"][0]["parameters"]
    args["delay"] = 4
    slow = run_chain(case, "baseline", 0, 4, [4] * 8)
    assert slow["events"][1]["dispatches"][0]["due"] == 5
    assert all(frame["metrics"]["factory_variance_ratio"] is None for frame in slow["snapshots"])
    args["delay"] = 0
    with pytest.raises(ValueError, match="1 to 4"):
        run_chain(case, "baseline", 0, 4, [4] * 8)
