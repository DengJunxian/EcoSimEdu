import json
from collections import defaultdict, deque
from pathlib import Path

import pytest

from services.simulation.auction import digest
from services.simulation.svb import simulate


CASE = json.loads((Path(__file__).parents[2] / "cases/svb_run/case.json").read_text())


@pytest.mark.parametrize("scenario_id,seed,action,defer_after", [
    *((scenario["id"], seed, action, None) for scenario in CASE["scenarios"]
      for seed, action in ((20230309, "withdraw_now"), (17, "withdraw_later"))),
    ("baseline", 20230309, "withdraw_now", 2),
])
def test_bank_run_reconciles_every_event(scenario_id, seed, action, defer_after):
    result = simulate(CASE, scenario_id, seed, action, defer_after=defer_after)
    assert result == simulate(CASE, scenario_id, seed, action, defer_after=defer_after)
    assert result["initial_hash"] == digest(result["initial"])
    initial = result["initial"]
    assert len(initial["people"]) == 60
    balances = {person: state["deposit"] for person, state in initial["people"].items()}
    external = dict.fromkeys(balances, 0)
    amounts_by_person = dict.fromkeys(balances, 0)
    pending = {}
    order = deque()
    total_deposits = sum(balances.values())
    total_cash = initial["bank"]["cash"] + initial["support_cash"] + initial["market_cash"]
    cash, units = initial["bank"]["cash"], initial["bank"]["units"]
    reserve, buyer_cash = initial["support_cash"], initial["market_cash"]
    equity = CASE["rules"]["initial_equity"]
    price = CASE["rules"]["initial_price"]
    requested = paid = borrowing = loss = 0
    event_sources = defaultdict(set)
    for i, (event, frame) in enumerate(zip(result["events"], result["snapshots"], strict=True)):
        assert event["seq"] == event["tick"] == frame["tick"] == i
        kind = event["event_type"]
        if kind == "revaluation":
            price = event["new_price"]
            equity -= (event["old_price"] - price) * units
        if kind == "student_deferred":
            assert event["checkpoint_round"] == defer_after
            assert event["actor_id"] == "D01"
            assert 0 < event["amount_deferred"] <= balances["D01"] - amounts_by_person["D01"]
        if kind == "requests":
            for row in event["requests"]:
                request_id, person = row["request_id"], row["person"]
                amount = row["requested"]
                assert request_id not in pending and amount > 0
                assert amount <= balances[person] - amounts_by_person[person]
                assert amount == row["protective"] + row["payroll"]
                assert row["remaining"] == amount and row["paid"] == 0
                assert set(row["observation_seqs"]) == event_sources[person]
                pending[request_id] = amount
                order.append(request_id)
                amounts_by_person[person] += amount
                requested += amount
        if kind == "messages":
            for edge in frame["relations"]:
                origin = result["events"][edge["origin_seq"]]
                assert origin["round"] < event["round"]
                assert edge["from"] in {row["person"] for row in origin["requests"]}
                assert edge["from"] in initial["network"][edge["to"]]
                event_sources[edge["to"]].add(edge["origin_seq"])
        if kind == "support":
            cash += event["draw"]
            reserve -= event["draw"]
            borrowing += event["draw"]
        if kind == "sale":
            units -= event["units"]
            proceeds = event["units"] * CASE["rules"]["sale_price"]
            realized_loss = price * event["units"] - proceeds
            assert event["proceeds"] == proceeds and event["realized_loss"] == realized_loss
            cash += proceeds
            buyer_cash -= proceeds
            loss += realized_loss
            equity -= realized_loss
        if kind == "payments":
            for row in event["payments"]:
                request_id, person = row["request_id"], row["person"]
                payout = row["amount"]
                assert request_id == order[0]
                assert 0 < payout <= min(cash, pending[request_id])
                pending[request_id] -= payout
                amounts_by_person[person] -= payout
                if pending[request_id] == 0:
                    order.popleft()
                balances[person] -= payout
                external[person] += payout
                cash -= payout
                paid += payout
        if kind == "queue":
            assert [row["request_id"] for row in event["pending"]] == list(order)
            for row in event["pending"]:
                assert row["remaining"] == pending[row["request_id"]]
                assert row["paid"] + row["remaining"] == row["requested"]
        bank, support, market = (frame["entities"][key] for key in ("BANK", "SUPPORT", "MARKET"))
        assert bank["证券单位"] == units >= 0
        assert bank["证券市值"] == price * units
        assert market["证券单位"] + units == initial["bank"]["units"]
        assert bank["现金"] == cash >= 0
        assert bank["存款负债"] == total_deposits - paid == sum(balances.values())
        assert bank["支持借款负债"] == borrowing == support["支持借款资产"]
        assert support["现金"] == reserve >= 0 and market["现金"] == buyer_cash >= 0
        assert cash + reserve + buyer_cash + sum(external.values()) == total_cash
        assert equity == cash + price * units + bank["贷款"] - sum(balances.values()) - borrowing
        assert frame["metrics"] == {
            "cash": cash, "requested": requested, "paid": paid, "queued": requested - paid,
            "equity": equity, "sale_loss": loss,
        }
        assert set(frame["metrics"]) == {metric["id"] for metric in CASE["metrics"]}
        for person, balance in balances.items():
            state = frame["entities"][person]
            assert state["存款余额"] == balance >= 0
            assert state["外部现金"] == external[person]
            assert state["等待支付"] == amounts_by_person[person] <= balance
    assert result["metrics"] == result["snapshots"][-1]["metrics"]
    player_payroll = next(
        event["round"] for event in result["events"] if event["event_type"] == "requests"
        and any(row["person"] == CASE["player_id"] and row["payroll"] > 0 for row in event["requests"])
    )
    assert player_payroll == (1 if action == "withdraw_now" else 2)


def test_counterfactuals_share_root_and_only_change_the_declared_condition():
    baseline, buffer, network = [
        simulate(CASE, scenario["id"], CASE["seed"], CASE["action"]["default"])
        for scenario in CASE["scenarios"]
    ]
    assert len({run["root_hash"] for run in (baseline, buffer, network)}) == 1
    assert len({run["initial_hash"] for run in (baseline, buffer, network)}) == 3
    assert baseline["initial"]["people"] == buffer["initial"]["people"] == network["initial"]["people"]
    assert baseline["initial"]["bank"] == network["initial"]["bank"]
    assert baseline["initial"]["network"] == buffer["initial"]["network"]
    assert baseline["initial"]["network"] != network["initial"]["network"]
    assert all(len(links) == 3 for run in (baseline, network) for links in run["initial"]["network"].values())
    left, right = (run["initial"]["bank"] for run in (baseline, buffer))
    assert right["cash"] - left["cash"] == 400
    assert left["units"] - right["units"] == 40
    assert left["loans"] == right["loans"]
    assert baseline["snapshots"][0]["metrics"]["equity"] == buffer["snapshots"][0]["metrics"]["equity"] == 400
    first_queue = next(event for event in baseline["events"] if event["event_type"] == "queue")
    assert baseline["snapshots"][first_queue["tick"]]["metrics"]["equity"] > 0


def test_no_neighbor_edges_means_no_neighbor_messages():
    case = {**CASE, "scenarios": [*CASE["scenarios"], {
        "id": "no_edges", "parameters": {"cash_reallocation": 0, "network": "none"},
    }]}
    result = simulate(case, "no_edges", case["seed"], case["action"]["default"])
    assert not any(result["initial"]["network"].values())
    assert all(event["event_type"] != "messages" for event in result["events"])
    assert all(
        not row["observation_seqs"]
        for event in result["events"] if event["event_type"] == "requests" for row in event["requests"]
    )


def test_deferral_rejects_ineligible_rounds():
    for round_number in (1, 3, CASE["rules"]["steps"]):
        with pytest.raises(ValueError):
            simulate(CASE, "baseline", CASE["seed"], "withdraw_now", defer_after=round_number)
