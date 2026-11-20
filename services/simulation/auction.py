"""Deterministic teaching adapter for the Demo limit order book."""
from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

from core.exchange.market_rules import MarketRuleSchema
from core.exchange.order_book import OrderBook
from core.types import Order, OrderSide, OrderStatus, OrderType

ROOT = Path(__file__).resolve().parents[2]
CASE = json.loads((ROOT / "cases/double_auction/case.json").read_text())
BOUNDARIES = json.loads((ROOT / "cases/boundaries.json").read_text())
SCENARIOS = {scenario["id"]: scenario for scenario in CASE["scenarios"]}
ENGINE_VERSION = "double-auction/1"


def canonical_json(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(data):
    return hashlib.sha256(canonical_json(data).encode()).hexdigest()


def initial_agents(seed):
    rng = random.Random(seed)
    agents = {}
    for side, prefix in (("buy", "B"), ("sell", "S")):
        for i in range(10):
            is_player = prefix == "B" and i == 0
            first = CASE["player_value"] if is_player else (
                127 - i * 5 + rng.randint(-3, 3) if side == "buy" else 70 + i * 5 + rng.randint(-3, 3)
            )
            units = 1 if is_player else 1 + i % 3
            agents[f"{prefix}{i + 1:02}"] = {
                "side": side,
                "marginals": [first + j * (-3 if side == "buy" else 3) for j in range(units)],
                "cash": CASE["initial_cash"] if side == "buy" else 0,
                "goods": 0 if side == "buy" else units,
                "filled": 0,
            }
    return agents


def run_auction(scenario_id: str, seed: int, bid: int, *, parameters=None, cancel_after=None):
    """Replay an optional student cancellation after an automatic turn settles."""
    if cancel_after is not None and (type(cancel_after) is not int or cancel_after < 2):
        raise ValueError("Invalid student cancellation checkpoint")
    cancelled = False
    scenario = BOUNDARIES[CASE["case_id"]]["parameters"] if scenario_id == "boundary" else SCENARIOS[scenario_id]
    if parameters is not None:
        scenario = parameters
    root = initial_agents(seed)
    fee = scenario["fee"]
    agents = {key: {**a, "marginals": [
        value + scenario["demand_shift"] if a["side"] == "buy" else value
        for value in a["marginals"]
    ]} for key, a in root.items()}
    initial = {key: dict(agent) for key, agent in agents.items()}
    demand = sorted((v for a in agents.values() if a["side"] == "buy" for v in a["marginals"]), reverse=True)
    supply = sorted(v for a in agents.values() if a["side"] == "sell" for v in a["marginals"])
    q = sum(v >= c for v, c in zip(demand, supply))
    ceiling = sum(v - c for v, c in zip(demand[:q], supply[:q]))
    price_band = [max(supply[q - 1], demand[q] if q < len(demand) else 0),
                  min(demand[q - 1], supply[q] if q < len(supply) else demand[q - 1])] if q else None
    rules = MarketRuleSchema(symbol="LAB", prev_close=100, price_limit_pct=1.0, min_price_tick=1,
                             board_lot=1, commission_rate=0, stamp_duty_rate=0, sessions=(),
                             supported_order_types=("limit",),
                             feature_flags={"strict_queue_timestamps": True},
                             metadata={"market": "education", "price_unit": CASE["price_unit"]})
    book = OrderBook("LAB", market_rules=rules)
    events, snapshots = [], []
    active = {}
    prices = []
    platform = surplus = 0

    def emit(event_type, **payload):
        seq = len(events)
        events.append({"seq": seq, "tick": seq, "event_type": event_type, **payload})

    def snapshot():
        orders = [{"order_id": o.order_id, "actor_id": o.agent_id,
                   "side": o.side.value, "price": int(o.price), "quantity": o.remaining_qty}
                  for o in sorted(active.values(), key=lambda o: o.timestamp)
                  if o.status in {OrderStatus.PENDING, OrderStatus.PARTIAL}]
        snapshots.append({
            "tick": events[-1]["tick"],
            "best_bid": max((o["price"] for o in orders if o["side"] == "buy"), default=None),
            "best_ask": min((o["price"] for o in orders if o["side"] == "sell"), default=None),
            "last_price": prices[-1] if prices else None, "volume": len(prices),
            "surplus": surplus, "platform_cash": platform,
            "accounts": {key: {name: a[name] for name in ("cash", "goods", "filled")}
                         for key, a in agents.items()},
            "orders": orders,
        })

    def quote(actor, price, source, round_no, reference_price=None):
        nonlocal platform, surplus
        account = agents[actor]
        side = OrderSide(account["side"])
        filled = account["filled"]
        marginal = account["marginals"][filled]
        order_id = f"O{len(events):03}"
        legal = (price > 0 and (price + fee <= min(marginal, account["cash"])
                 if side == OrderSide.BUY else price - fee >= marginal and account["goods"] > 0))
        emit("order_submitted" if legal else "order_rejected", actor_id=actor, order_id=order_id,
             side=side.value, price=price, quantity=1, source=source, round=round_no,
             reference_price=reference_price)
        if not legal:
            snapshot()
            return
        order = Order("LAB", price, 1, side, OrderType.LIMIT, actor, len(events), order_id=order_id)
        active[actor] = order
        snapshot()
        fills = book.add_order(order)
        if order.status == OrderStatus.REJECTED:
            raise RuntimeError("The order book rejected an adapter-validated order")
        for trade in fills:
            buyer = agents[trade.buyer_agent_id]
            seller = agents[trade.seller_agent_id]
            value = buyer["marginals"][buyer["filled"]]
            cost = seller["marginals"][seller["filled"]]
            price_paid = int(trade.price)
            buyer["cash"] -= price_paid + fee
            seller["cash"] += price_paid - fee
            buyer["goods"] += 1
            seller["goods"] -= 1
            buyer["filled"] += 1
            seller["filled"] += 1
            platform += 2 * fee
            surplus += value - cost
            prices.append(price_paid)
            emit("trade", buyer_id=trade.buyer_agent_id, seller_id=trade.seller_agent_id,
                 buy_order_id=active[trade.buyer_agent_id].order_id,
                 sell_order_id=active[trade.seller_agent_id].order_id,
                 maker_order_id=trade.maker_id, price=price_paid, quantity=1, round=round_no,
                 buyer_surplus=value - price_paid - fee, seller_surplus=price_paid - fee - cost,
                 platform_fee=2 * fee)
            snapshot()

    emit("market_open")
    snapshot()
    player = CASE["player_id"]
    quote(player, bid, "student", 0)
    automatic = [key for key in agents if key != player]
    rng = random.Random(seed ^ 0xDA14)
    for round_no in range(CASE["rounds"]):
        rng.shuffle(automatic)
        for actor in automatic:
            shade = rng.randint(3, 18) // (round_no + 1)
            account = agents[actor]
            if account["filled"] == len(account["marginals"]):
                continue
            previous = active.get(actor)
            if previous and previous.status == OrderStatus.PENDING:
                book.cancel_order(previous.order_id)
                emit("order_cancelled", actor_id=actor, order_id=previous.order_id, round=round_no)
                snapshot()
            marginal = account["marginals"][account["filled"]]
            reference = prices[-1] if prices else None
            if account["side"] == "buy":
                boundary = min(marginal, account["cash"]) - fee
                price = min(boundary, (reference if reference is not None else boundary) + 2) - shade
            else:
                boundary = marginal + fee
                price = max(boundary, (reference if reference is not None else boundary) - 2) + shade
            quote(actor, price, "rule", round_no, reference)
            if cancel_after is not None and len(events) - 1 == cancel_after:
                order = active.get(player)
                if not order or order.status != OrderStatus.PENDING:
                    raise ValueError("No open student order at checkpoint")
                book.cancel_order(order.order_id)
                emit("order_cancelled", actor_id=player, order_id=order.order_id, round=round_no,
                     source="student", checkpoint_event=cancel_after)
                snapshot()
                cancelled = True
    if cancel_after is not None and not cancelled:
        raise ValueError("Checkpoint does not follow a complete automatic turn")
    for actor, order in active.items():
        if order.status == OrderStatus.PENDING:
            book.cancel_order(order.order_id)
            emit("order_cancelled", actor_id=actor, order_id=order.order_id, round=CASE["rounds"])
            snapshot()
    emit("market_close")
    snapshot()
    return {
        "engine_version": "double-auction/fork-v1" if cancelled else ENGINE_VERSION, "rules": rules.to_dict(),
        "root_hash": digest(root), "initial_hash": digest(initial), "initial": initial,
        "intervention": {"demand_shift": scenario["demand_shift"], "fee": fee},
        "events": events, "snapshots": snapshots, "demand": demand, "supply": supply,
        "metrics": {"volume": len(prices), "price_min": min(prices, default=None),
                    "price_max": max(prices, default=None), "surplus": surplus, "ceiling": ceiling,
                    "efficiency": surplus / ceiling if ceiling else None, "platform_cash": platform,
                    "participant_surplus": surplus - platform, "price_band": price_band},
    }
