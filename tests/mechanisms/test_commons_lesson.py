import json
from pathlib import Path

import pytest

from services.simulation.auction import digest
from services.simulation.commons import CAPACITY, CHECK_COST, FINE_RATE, GROWTH_RATE, USERS, VALUE, resource_step, simulate

CASE_DIR = Path(__file__).resolve().parents[2] / "cases/commons_governance"
CASE = json.loads((CASE_DIR / "case.json").read_text())


def test_stock_and_regrowth_manual_examples():
    allocations, harvested, remaining, growth = resource_step(10, {"A": 8, "B": 12})
    assert allocations == {"A": 4, "B": 6}
    assert (harvested, remaining, growth) == (10, 0, 0)

    _, harvested, remaining, growth = resource_step(100, {"A": 20})
    assert (harvested, remaining) == (20, 80)
    assert remaining + growth == pytest.approx(109 + 1 / 3)
    assert resource_step(0, {"A": 20})[1:] == (0, 0, 0)
    assert resource_step(CAPACITY, {})[1:] == (0, CAPACITY, 0)
    with pytest.raises(ValueError, match="Invalid withdrawal demand"):
        resource_step(10, {"A": -1})


def test_paired_stock_balance_and_budget_conservation():
    runs = {scenario["id"]: simulate(CASE, scenario["id"], CASE["seed"], "4") for scenario in CASE["scenarios"]}
    assert len({run["root_hash"] for run in runs.values()}) == 1
    assert len({run["initial_hash"] for run in runs.values()}) == 1
    assert len(runs["baseline"]["initial"]["users"]) == 24
    for scenario, run in runs.items():
        assert run == simulate(CASE, scenario, CASE["seed"], "4")
        assert len(run["events"]) == len(run["snapshots"]) == 25
        assert run["events"][1]["plans"]["F01"] == 4
        stock = run["initial"]["resource_stock"]
        budget = run["initial"]["monitor_budget"]
        group_income = 0
        monitor_cost = 0
        for withdrawal, renewal in zip(run["events"][1::2], run["events"][2::2], strict=True):
            allocations = withdrawal["allocations"]
            assert set(allocations) == set(USERS)
            assert sum(allocations.values()) <= stock + 1e-12
            assert withdrawal["start_stock"] == stock
            remaining = stock - sum(allocations.values())
            assert withdrawal["remaining_stock"] == renewal["remaining_stock"] == pytest.approx(remaining)
            assert renewal["growth"] == pytest.approx(GROWTH_RATE * remaining * (1 - remaining / CAPACITY))
            stock = renewal["next_stock"]
            assert stock == pytest.approx(remaining + renewal["growth"])
            assert 0 <= stock <= CAPACITY
            cost = withdrawal["monitoring_cost"]
            assert cost == CHECK_COST * len(withdrawal["monitored"])
            assert cost <= budget == withdrawal["monitor_budget_before"]
            for actor, fine in withdrawal["fines"].items():
                if actor in withdrawal["monitored"]:
                    assert fine == pytest.approx(FINE_RATE * max(0, allocations[actor] - 1))
                else:
                    assert fine == 0
            budget += sum(withdrawal["fines"].values()) - cost
            assert withdrawal["monitor_budget_after"] == pytest.approx(budget)
            cash_delta = withdrawal["monitor_budget_after"] - withdrawal["monitor_budget_before"]
            assert withdrawal["participant_net"] + cash_delta == pytest.approx(VALUE * sum(allocations.values()) - cost)
            group_income += withdrawal["participant_net"] + cash_delta
            monitor_cost += cost
        assert run["metrics"]["stock"] == stock
        assert run["metrics"]["income"] == pytest.approx(group_income)
        assert run["metrics"]["monitoring_cost"] == monitor_cost
        if scenario == "quota":
            assert run["events"][1]["requests"]["F01"] == 1
            assert all(max(event["requests"].values()) <= 1 for event in run["events"][1::2])
        assert (monitor_cost > 0) == (scenario == "community")


def test_precomputed_stress_results_can_be_regenerated():
    data = json.loads((CASE_DIR / "replicates.json").read_text())
    case = {**CASE, "scenarios": [*CASE["scenarios"], data["stress_case"]]}
    rows = data["runs"]
    assert len(rows) == 16 and len({row["seed"] for row in rows}) == 4
    assert len({row["scenario"] for row in rows}) == 4
    for row in rows:
        run = simulate(case, row["scenario"], row["seed"], data["action"])
        assert row["result_hash"] == digest(run)
        assert row["metrics"] == run["metrics"]
