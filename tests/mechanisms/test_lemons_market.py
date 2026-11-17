from fractions import Fraction
import json
from pathlib import Path

import pytest

from services.simulation.auction import digest
from services.simulation.lemons import _pool_rounds, simulate

CASE = json.loads((Path(__file__).resolve().parents[2] / "cases/lemons_market/case.json").read_text())


def test_selection_hand_example_and_uniform_quality():
    levels = {str(q): q for q in range(1, 6)}
    rounds = list(_pool_rounds(levels))
    assert [row[0] for row in rounds] == [
        Fraction(18, 5), Fraction(12, 5), Fraction(9, 5), Fraction(6, 5)
    ]
    assert [len(row[1]) for row in rounds] == [3, 2, 1, 1]
    identical = {"S01": 3, "S02": 3}
    assert list(_pool_rounds(identical)) == [(Fraction(18, 5), identical)]
    assert list(_pool_rounds({})) == []


@pytest.mark.parametrize("action", ["list", "keep"])
def test_shared_stock_one_settlement_and_welfare(action):
    outputs = [simulate(CASE, item["id"], CASE["seed"], action) for item in CASE["scenarios"]]
    assert len({output["root_hash"] for output in outputs}) == 1
    expected = [6, 30, 24] if action == "list" else [6, 29, 23]
    assert [output["metrics"]["traded"] for output in outputs] == expected
    for output in outputs:
        assert output["initial_hash"] == digest(output["initial"])
        assert all(snapshot["metrics"]["traded"] == 0 for snapshot in output["snapshots"][:-1])
        assert [event["event_type"] for event in output["events"]].count("settlement") == 1
        final = output["events"][-1]
        transactions = final["transactions"]
        assert len({row["seller"] for row in transactions}) == len(transactions)
        assert output["metrics"]["net_surplus"] == pytest.approx(
            sum(row["buyer_gain"] + row["seller_gain"] for row in transactions)
        )
        assert output["metrics"]["certification_cost"] == pytest.approx(
            sum(row["certification_cost"] for row in transactions)
        )
        if action == "keep":
            assert "S01" not in {row["seller"] for row in transactions}
    informed = outputs[1]
    assert informed["metrics"]["quoted_pool_price"] is None
    assert informed["metrics"]["net_surplus"] == pytest.approx(
        sum(informed["initial"]["qualities"].values()) / 5 - (1 if action == "keep" else 0)
    )


def test_unverified_quality_is_not_visible_during_price_discovery():
    output = simulate(CASE, "certified", 19, "list")
    verified = next(event["certified"] for event in output["events"] if event["event_type"] == "certification")
    for event, frame in zip(output["events"], output["snapshots"], strict=True):
        if event["event_type"] == "offer_iteration":
            actors = {actor for actor, row in frame["entities"].items() if "买方可见的核验质量" in row}
            assert actors == set(verified)
            assert all("复盘质量" not in row for row in frame["entities"].values())
            assert event["listed_stock"] == 30
    assert output == simulate(CASE, "certified", 19, "list")
