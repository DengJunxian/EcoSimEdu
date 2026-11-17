from fractions import Fraction
import json
from pathlib import Path

import pytest

from services.simulation.auction import digest
from services.simulation.public_goods import PARTICIPANTS, settle_round, simulate

CASE_DIR = Path(__file__).resolve().parents[2] / "cases/public_goods"
CASE = json.loads((CASE_DIR / "case.json").read_text())


def test_manual_payoffs_and_no_contribution_boundary():
    contributions = dict(zip(PARTICIPANTS, (0, 10, 12, 20), strict=True))
    gross, costs, fines, net, _ = settle_round(contributions, {("P4", "P1"): 2}, 1, 3)
    assert gross["P1"] == Fraction("36.8")
    assert costs["P4"] == 2 and fines["P1"] == 6
    assert net["P1"] == Fraction("30.8") and net["P4"] == Fraction("14.8")
    assert sum(net.values()) == Fraction("97.2")
    for amount, group_net in [(0, 80), (20, 128)]:
        _, _, _, net, _ = settle_round(dict.fromkeys(PARTICIPANTS, amount), {}, 0, 3)
        assert sum(net.values()) == group_net


def test_batch_penalties_reserve_costs_and_split_cap_without_order_effect():
    contributions = dict(zip(PARTICIPANTS, (0, 0, 0, 20), strict=True))
    points = {("P1", "P4"): 3, ("P2", "P4"): 3, ("P3", "P4"): 3, ("P4", "P1"): 1}
    result = settle_round(contributions, points, 1, 3)
    assert result == settle_round(dict(reversed(list(contributions.items()))), dict(reversed(list(points.items()))), 1, 3)
    _, costs, fines, net, edges = result
    assert costs["P4"] == 1 and fines["P4"] == 7 and net["P4"] == 0
    assert sum(edge["fine"] for edge in edges if edge["to"] == "P4") == pytest.approx(7)
    with pytest.raises(ValueError, match="Invalid sanction"):
        settle_round(contributions, {("P1", "P1"): 1}, 1, 3)
    with pytest.raises(ValueError, match="exceed budget"):
        settle_round(contributions, {("P4", "P1"): 9}, 1, 3)


def test_pairing_and_ten_round_evidence():
    runs = {s["id"]: simulate(CASE, s["id"], CASE["seed"], "0") for s in CASE["scenarios"]}
    assert len({r["root_hash"] for r in runs.values()}) == 1
    assert len({r["initial_hash"] for r in runs.values()}) == 1
    assert len({digest(r["events"][1]) for r in runs.values()}) == 1
    for scenario, run in runs.items():
        assert run == simulate(CASE, scenario, CASE["seed"], "0")
        assert run["events"][1]["contributions"]["P1"] == 0
        assert len(run["events"]) == len(run["snapshots"]) == 21
        totals = {"contributions": 0, "net": 0, "sanctions": 0}
        for decisions, settlement in zip(run["events"][1::2], run["events"][2::2], strict=True):
            total = sum(decisions["contributions"].values())
            deductions = sum(settlement["outgoing"].values()) + sum(settlement["fines"].values())
            net = sum(settlement["net"].values())
            assert net == pytest.approx(80 + 0.6 * total - deductions)
            assert min(settlement["net"].values()) >= 0
            totals["contributions"] += total
            totals["net"] += net
            totals["sanctions"] += deductions
        assert run["metrics"]["total_contributions"] == totals["contributions"]
        assert run["metrics"]["net_income"] == pytest.approx(totals["net"])
        assert run["metrics"]["sanction_cost"] == pytest.approx(totals["sanctions"])
    assert runs["baseline"]["metrics"]["sanction_cost"] == 0


def test_ten_precomputed_repeats_can_be_regenerated():
    data = json.loads((CASE_DIR / "replicates.json").read_text())
    assert data["case_version"] == CASE["version"]
    rows = data["runs"]
    assert len(rows) == 30 and len({row["seed"] for row in rows}) == 10
    for row in rows:
        run = simulate(CASE, row["scenario"], row["seed"], data["action"])
        assert row["digest"] == digest(run)
        assert row["metrics"] == run["metrics"]
