from copy import deepcopy
from itertools import product
from pathlib import Path
import json

import pytest

from services.simulation.auction import digest
from services.simulation.carbon import continuous_cost, reduction_plan, run_market, simulate

CASE = json.loads((Path(__file__).resolve().parents[2] / "cases/carbon_market/case.json").read_text())


@pytest.mark.parametrize("scenario", [s["id"] for s in CASE["scenarios"]])
def test_allowance_ids_cash_and_surrender_reconcile(scenario):
    model = simulate(CASE, scenario, 2005, "3")
    assert digest(model) == digest(simulate(CASE, scenario, 2005, "3"))
    cap = model["initial"]["cap"]
    issued = model["events"][0]["issue"]
    owned = {firm: set(permits) for firm, permits in issued.items()}
    spent = set()
    assert sum(map(len, owned.values())) == len(set.union(*owned.values())) == cap
    payments = dict.fromkeys(owned, 0)
    for i, (event, frame) in enumerate(zip(model["events"], model["snapshots"], strict=True)):
        assert event["seq"] == event["tick"] == frame["tick"] == i
        if event["event_type"] == "transfer":
            seller, buyer = event["seller"], event["buyer"]
            permits = set(event["permits"])
            assert permits <= owned[seller] and not permits & owned[buyer]
            owned[seller].difference_update(permits)
            owned[buyer].update(permits)
            payments[buyer] += event["payment"]
            payments[seller] -= event["payment"]
        elif event["event_type"] == "surrender":
            firm = event["firm"]
            permits = set(event["permits"])
            assert permits <= owned[firm] and not permits & spent
            assert event["emissions"] == len(permits)
            owned[firm].difference_update(permits)
            spent.update(permits)
        assert sum(map(len, owned.values())) + len(spent) == cap
        for firm, ids in owned.items():
            assert frame["entities"][firm]["持有配额"] == len(ids)
            assert frame["entities"][firm]["配额净支付"] == payments[firm]
        assert sum(payments.values()) == 0
    planned = model["events"][1]
    assert model["metrics"]["surrendered"] == sum(planned["emissions"].values()) == len(spent) <= cap
    assert planned["continuous_cost_floor"] <= planned["integer_minimum_cost"] <= model["metrics"]["abatement_cost"]
    if scenario != "uniform":
        assert model["metrics"]["abatement_cost"] == planned["integer_minimum_cost"]


def test_discrete_solver_matches_brute_force_and_continuous_example():
    firms = {"F01": (4, 2), "F08": (4, 8)}
    assert reduction_plan(firms, 5, "trade") == ({"F01": 2, "F08": 1}, 4, 8)
    assert continuous_cost(firms, 5) == pytest.approx(7.2)
    for cap in range(11):
        target = max(0, 8 - cap)
        alternatives = [i * i + 4 * j * j for i, j in product(range(5), repeat=2) if i + j == target]
        plan, price, cost = reduction_plan(firms, cap, "trade")
        assert sum(plan.values()) == target
        assert cost == min(alternatives)
        assert continuous_cost(firms, cap) <= cost
        if cap == 0:
            assert price == 32
        if cap >= 8:
            assert price == 0


def test_allocation_and_tightening_have_distinct_endpoints():
    base = simulate(CASE, "baseline", 2005, "3")
    redistribution = simulate(CASE, "redistribute", 2005, "3")
    own = simulate(CASE, "baseline", 2005, "0")
    tightened = simulate(CASE, "tighten", 2005, "3")
    assert len({market["root_hash"] for market in (base, redistribution, tightened)}) == 1
    assert base["events"][1]["abatement"] == redistribution["events"][1]["abatement"] == own["events"][1]["abatement"]
    assert base["metrics"]["price"] == redistribution["metrics"]["price"] == own["metrics"]["price"]
    assert base["initial"]["free_allocation"] != redistribution["initial"]["free_allocation"]
    assert base["snapshots"][-1]["entities"]["F01"]["配额净支付"] != own["snapshots"][-1]["entities"]["F01"]["配额净支付"]
    assert tightened["metrics"]["planned_emissions"] == 56
    assert tightened["metrics"]["abatement_cost"] >= base["metrics"]["abatement_cost"]


def test_zero_emissions_and_invalid_input():
    case = deepcopy(CASE)
    for cap in [0, 4]:
        case["scenarios"][0]["parameters"]["cap"] = cap
        run = run_market(case, "baseline", 0, 6, {"F01": (0, 4), "F08": (0, 10)})
        assert run["metrics"]["surrendered"] == run["metrics"]["abatement_cost"] == run["metrics"]["price"] == 0
        assert run["metrics"]["cap"] == cap
        assert run["initial"]["student_applied"] <= cap
    with pytest.raises(ValueError, match="strictly positive"):
        reduction_plan({"F01": (4, 0)}, 2, "trade")
    with pytest.raises(ValueError, match="nonnegative integer"):
        reduction_plan({"F01": (4, 2)}, -1, "trade")
