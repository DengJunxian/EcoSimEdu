"""Read-only classroom projection over persisted auction settlements."""
from .auction import CASE, ENGINE_VERSION


def project_auction(run, tick, *, review=False, explain=False):
    result = run["result"]
    frames = result["snapshots"]
    if tick >= len(frames):
        raise IndexError(tick)
    frame = frames[tick]
    closed = tick == len(frames) - 1
    explain = explain and (closed or review)
    all_events = result["events"]
    events = all_events if review else all_events[:tick + 1]
    current = all_events[tick]
    player = CASE["player_id"]
    private_fields = {"buyer_surplus", "seller_surplus", "platform_fee"}
    trades = [event for event in events if event["event_type"] == "trade"]
    student_trade = next((event for event in trades if event["buyer_id"] == player and event["tick"] <= tick), None)
    order_open = next((event for event in events
                       if event["event_type"] in {"order_submitted", "order_rejected"}
                       and event["actor_id"] == player), None)
    student_close = next((event for event in events if event["event_type"] == "order_cancelled"
                          and event["actor_id"] == player), None)
    order_by_id = {event["order_id"]: event for event in events if event["event_type"] == "order_submitted"}
    settlement = None
    evidence = None
    if current["event_type"] == "trade":
        buy, sell = (order_by_id.get(current[key]) for key in ("buy_order_id", "sell_order_id"))
        if buy and sell:
            before = frames[tick - 1]["accounts"]
            buyer, seller = current["buyer_id"], current["seller_id"]
            settlement = {"buy": buy, "sell": sell, "maker_order_id": current["maker_order_id"],
                          "before": {actor: before[actor] for actor in (buyer, seller)}}
            if explain:
                settlement["value"] = result["initial"][buyer]["marginals"][before[buyer]["filled"]]
                settlement["cost"] = result["initial"][seller]["marginals"][before[seller]["filled"]]
                settlement.update({k: current[k] for k in private_fields})
            evidence = {"kind": "trade", "actor_id": buyer, "metric": "last_price",
                        "unit": CASE["price_unit"], "value": current["price"]}
    elif current == student_close and order_open and order_open["event_type"] == "order_submitted":
        evidence = {"kind": "unfilled", "actor_id": player, "metric": "filled",
                    "unit": "件", "value": frame["accounts"][player]["filled"]}
    if evidence:
        evidence.update(run_id=run["run_id"], case_version=run["case_version"], engine_version=ENGINE_VERSION,
                        result_hash=run["result_hash"], seq=current["seq"], tick=tick)
    return {
        "run_id": run["run_id"], "case_version": run["case_version"], "engine_version": ENGINE_VERSION,
        "result_hash": run["result_hash"], "origin": run["origin"], "seed": run["seed"], "bid": run["bid"],
        "root_hash": result["root_hash"], "initial_hash": result["initial_hash"],
        "intervention": result["intervention"], "tick": tick, "closed": closed,
        "end": len(frames) - 1 if review or closed else None,
        "round": current.get("round"), "frame": {k: v for k, v in frame.items()
                                                 if explain or k not in {"surplus", "platform_cash"}},
        "events": events if explain else [{k: v for k, v in e.items() if k not in private_fields}
                                           for e in events],
        "settlement": settlement, "evidence": evidence, "student_order": order_open,
        "student_trade": student_trade["seq"] if student_trade else None,
        "student_close": student_close["seq"] if student_close else None,
        "private_information": {key: result[key] for key in ("supply", "demand", "metrics")} if explain else None,
    }
