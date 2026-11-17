import copy
import json
from pathlib import Path

import pytest

from services.simulation import flash_crash, gamestop
from services.simulation.auction import digest
from services.simulation.market_tape import MarketTape


def load(case_id):
    return json.loads((Path("cases") / case_id / "case.json").read_text())


def run_case(model):
    case_id = model.__name__.split(".")[-1]
    case = load(case_id)
    return case, {scenario["id"]: model.simulate(case, scenario["id"], case["seed"], case["action"]["default"])
                  for scenario in case["scenarios"]}


def audit_book(run):
    accounts = copy.deepcopy(run["initial"]["accounts"])
    orders, resting, prices = {}, {}, []
    total_shares = sum(a["shares"] for a in accounts.values())
    total_cash = sum(a["cash"] for a in accounts.values())
    volume = 0
    for seq, (event, snap) in enumerate(zip(run["events"], run["snapshots"], strict=True)):
        assert event["seq"] == event["tick"] == snap["tick"] == seq
        kind = event["event_type"]
        if kind == "order_submitted":
            actor = event["actors"][0]
            side = event["side"]
            requested = event["quantity"]
            price = event["price_cents"]
            committed = [o for o in resting.values() if o["actors"][0] == actor and o["side"] == side]
            if side == "buy":
                assert requested * price + sum(o["quantity"] * o["price_cents"] for o in committed) <= accounts[actor]["cash"]
            else:
                assert requested + sum(o["quantity"] for o in committed) <= accounts[actor]["shares"]
            orders[event["order_id"]] = dict(event)
        elif kind == "rest":
            order = orders[event["order_id"]]
            assert order["quantity"] == event["quantity"]
            resting[event["order_id"]] = order
        elif kind in {"cancel", "unfilled"}:
            order = orders[event["order_id"]]
            assert order["quantity"] == event["quantity"]
            assert (event["order_id"] in resting) == (kind == "cancel")
            resting.pop(event["order_id"], None)
            order["quantity"] = 0
        elif kind == "trade":
            price, quantity = event["price_cents"], event["quantity"]
            buy, sell = orders[event["buy_order_id"]], orders[event["sell_order_id"]]
            assert buy["price_cents"] >= price >= sell["price_cents"]
            maker = min((buy, sell), key=lambda o: o["seq"])
            assert maker["order_id"] == event["maker_id"] and price == maker["price_cents"]
            resting_side = "buy" if maker["side"] == "buy" else "sell"
            alternatives = [o for o in resting.values() if o["side"] == resting_side]
            sign = -1 if resting_side == "buy" else 1
            assert maker == min(alternatives, key=lambda o: (sign * o["price_cents"], o["seq"]))
            for order, direction in ((buy, 1), (sell, -1)):
                assert quantity <= order["quantity"]
                order["quantity"] -= quantity
                if order["quantity"] == 0:
                    resting.pop(order["order_id"], None)
                account = accounts[order["actors"][0]]
                account["cash"] -= direction * price * quantity
                account["shares"] += direction * quantity
            volume += quantity
            prices.append(price / 100)
        elif kind == "loan":
            quantity = event["quantity"]
            accounts[gamestop.LENDER]["shares"] -= quantity
            accounts[gamestop.SHORT]["shares"] += quantity
            accounts[gamestop.SHORT]["debt"] += quantity
        elif kind == "return":
            quantity = event["quantity"]
            accounts[gamestop.LENDER]["shares"] += quantity
            accounts[gamestop.SHORT]["shares"] -= quantity
            accounts[gamestop.SHORT]["debt"] -= quantity
            assert event["remaining_debt"] == accounts[gamestop.SHORT]["debt"] >= 0
        assert all(a["cash"] >= 0 and a["shares"] >= 0 for a in accounts.values())
        assert sum(a["shares"] for a in accounts.values()) == total_shares
        assert sum(a["cash"] for a in accounts.values()) == total_cash
        for actor, entity in snap["entities"].items():
            if actor in accounts:
                assert entity["现金（美元）"] * 100 == pytest.approx(accounts[actor]["cash"])
                assert entity["现有股票（股）"] == accounts[actor]["shares"]
        metrics = snap["metrics"]
        assert metrics["last_price"] == (prices[-1] if prices else None)
        assert metrics["volume"] == volume
        assert metrics["bid_depth"] == sum(o["quantity"] for o in resting.values() if o["side"] == "buy")
        assert metrics["ask_depth"] == sum(o["quantity"] for o in resting.values() if o["side"] == "sell")


@pytest.mark.parametrize("model", [flash_crash, gamestop])
def test_paired_books_reproduce_and_settle(model):
    case, runs = run_case(model)
    assert len({run["root_hash"] for run in runs.values()}) == 1
    for scenario, run in runs.items():
        repeat = model.simulate(case, scenario, case["seed"], case["action"]["default"])
        assert digest(run) == digest(repeat)
        assert run["initial_hash"] == digest(run["initial"])
        assert run["metrics"] == run["snapshots"][-1]["metrics"]
        assert set(run["metrics"]) == {metric["id"] for metric in case["metrics"]}
        audit_book(run)


def test_flash_pause_defers_same_plan_and_expires_unfilled_orders():
    _, runs = run_case(flash_crash)
    base = runs["baseline"]
    pause = runs["pause"]
    release = lambda run: [(e["time"], e["quantity"]) for e in run["events"] if e["event_type"] == "release"]
    assert all(release(run) == release(base) for run in runs.values())
    assert all(len([e for e in run["events"] if e["event_type"] == "period_end"]) == 200 for run in runs.values())
    assert not [e for e in pause["events"] if e["event_type"] == "trade" and 55 <= e["time"] < 70]
    resume = next(e for e in pause["events"] if e["event_type"] == "resume")
    assert pause["snapshots"][resume["seq"]]["metrics"]["program_queued"] == sum(q for t, q in release(base) if t < 70)
    assert not any(e["event_type"] == "inventory_limit" for e in runs["no_withdrawal"]["events"])
    for run in runs.values():
        losses = [e for e in run["events"] if e["event_type"] == "unfilled" and e["purpose"] == "固定卖出程序"]
        assert sum(e["quantity"] for e in losses) + run["metrics"]["program_filled"] == sum(q for _, q in release(base))


def test_gamestop_covers_only_delivered_borrow_and_reaches_same_audience():
    _, runs = run_case(gamestop)
    assert len({digest(run["initial"]["exogenous_events"]) for run in runs.values()}) == 1
    for scenario, run in runs.items():
        events = run["events"]
        transfers = sum(e["quantity"] for e in events if e["event_type"] == "loan")
        returns = sum(e["quantity"] for e in events if e["event_type"] == "return")
        forced = sum(e["quantity"] for e in events if e["event_type"] == "trade" and e["purpose"] == "强制回补")
        assert run["metrics"]["short_interest"] == transfers - returns >= 0
        assert run["metrics"]["forced_cover"] == forced <= transfers
        for e in (e for e in events if e["event_type"] == "margin_call"):
            assert e["collateral_cents"] * 100 < e["maintenance_percent"] * e["debt"] * e["mark_cents"]
        deliveries = [(e["actors"][0], e["message_id"]) for e in events if e["event_type"] == "forward"]
        assert len(deliveries) == len(set(deliveries))
        if scenario == "no_lending":
            assert not any(e.get("purpose") == "借券卖出" for e in events)
        if scenario == "no_social":
            assert run["metrics"]["social_buys"] == 0 and run["metrics"]["reach"] == runs["baseline"]["metrics"]["reach"]
    assert runs["baseline"]["metrics"]["forced_cover"] > 0


def test_book_rejects_unfunded_inventory_and_buys_and_has_no_phantom_price():
    root = {"accounts": {"buyer": {"cash": 999, "shares": 0}, "seller": {"cash": 0, "shares": 1}}}
    tape = MarketTape(root, root, {}, "test", lambda: {})
    assert tape.submit("buyer", "buy", 1000, 1, "invalid funds") == 0
    assert tape.submit("seller", "sell", 100, 2, "invalid shares") == 0
    assert tape.submit("seller", "sell", 100, 1, "no counterparty", immediate=True) == 0
    assert tape.steps[-1]["event_type"] == "unfilled"
    assert tape.last is None and tape.volume == 0 and not tape.resting
    assert tape.accounts == root["accounts"]
