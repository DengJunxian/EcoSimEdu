"""Four-tier inventory chain with independent order and goods clocks."""

from statistics import pvariance

from .auction import digest

ROLES = ("零售商", "批发商", "分销商", "工厂")
WEEKS = 40
SHOCK = 5
CAPACITY = 20
BASE_DEMAND = 4
INITIAL_STOCK = 12
BASELINE_DELAY = 2


def starting_state(delay, demand):
    if type(delay) is not int or not 1 <= delay <= 4:
        raise ValueError("Shipping delay must be 1 to 4 weeks")
    batches = [
        {"sender": ROLES[i + 1] if i < 3 else "生产", "receiver": role,
         "amount": BASE_DEMAND, "sent": week - delay, "due": week}
        for i, role in enumerate(ROLES) for week in range(1, delay + 1)
    ]
    return {
        "demand": list(demand), "delay": delay, "stock": dict.fromkeys(ROLES, INITIAL_STOCK),
        "backlog": dict.fromkeys(ROLES, 0), "pending_orders": dict.fromkeys(ROLES[:3], BASE_DEMAND),
        "initial_batches": batches, "factory_capacity": CAPACITY,
    }


def decide(policy, forecast, stock, backlog, outstanding, lag):
    if policy == "order_up_to":
        target = round(forecast * lag + INITIAL_STOCK)
        return max(0, target - (stock + outstanding - backlog))
    beta = 0.65 if policy == "track_orders" else 0.15
    return max(0, round(forecast + 0.55 * (INITIAL_STOCK - (stock - backlog))
                        + beta * (forecast * (lag - 1) - outstanding)))


def simulate(case, scenario_id, seed, action):
    if action not in {option["id"] for option in case["action"]["options"]}:
        raise ValueError("Unknown retail order")
    parameters = next(s["parameters"] for s in case["scenarios"] if s["id"] == scenario_id)
    demand = [parameters["constant_demand"]] * 40 if "constant_demand" in parameters else [4] * 4 + [8] * 36
    return run_chain(case, scenario_id, seed, int(action), demand)


def run_chain(case, scenario_id, seed, first_order, demand):
    parameters = next(s["parameters"] for s in case["scenarios"] if s["id"] == scenario_id)
    delay = parameters["delay"]
    policy = parameters["policy"]
    initial = starting_state(delay, demand)
    root_hash = digest({"seed": seed, "action": first_order, "initial": starting_state(BASELINE_DELAY, demand)})
    stock = initial["stock"].copy()
    backlog = initial["backlog"].copy()
    batches = initial["initial_batches"].copy()
    pending = initial["pending_orders"].copy()
    outstanding = {role: BASE_DEMAND * delay + pending.get(role, 0) for role in ROLES}
    forecast = dict.fromkeys(ROLES, BASE_DEMAND)
    orders_by_role = {role: [] for role in ROLES}
    events, snapshots = [], []
    costs = delivered = produced = 0

    def emit(week, summary, *, placed=None, receipts=(), dispatches=(), arrivals=None, product=None, demand_received=None):
        seq = len(events)
        actual_arrivals = arrivals if arrivals is not None else dict.fromkeys(ROLES, 0)
        metrics = {
            "retail_stock": stock["零售商"], "retail_backlog": backlog["零售商"],
            "factory_order": placed["工厂"] if placed else None,
            "in_transit": sum(batch["amount"] for batch in batches), "total_cost": costs / 2,
            "factory_variance_ratio": None,
        }
        external_variance = pvariance(demand[:week]) if week > 1 else 0
        if external_variance:
            metrics["factory_variance_ratio"] = pvariance(orders_by_role["工厂"]) / external_variance
        entities = {
            role: {
                "期末库存": stock[role], "期末积压": backlog[role], "全部已订未到": outstanding[role],
                "库存位置": stock[role] + outstanding[role] - backlog[role],
                "本周到货": actual_arrivals[role], "本周下单": placed[role] if placed else None,
                "本周需求": demand_received[role] if demand_received else None,
                "需求预测": round(forecast[role], 3),
            } for role in ROLES
        }
        relations = [
            {"from": batch["sender"], "to": batch["receiver"],
             "label": f"{batch['amount']} 件于第 {batch['due']} 周到货",
             "origin_seq": batch["origin_seq"]}
            for batch in dispatches
        ]
        relations.extend(
            {"from": batch["sender"], "to": batch["receiver"], "label": f"本周实际到货 {batch['amount']} 件",
             **({"origin_seq": batch["origin_seq"]} if "origin_seq" in batch else {})}
            for batch in receipts
        )
        if placed is not None:
            relations.extend({"from": role, "to": ROLES[i + 1], "label": f"下单 {placed[role]} 件，下周到达"}
                             for i, role in enumerate(ROLES[:3]))
        events.append({
            "seq": seq, "tick": seq, "event_type": "week_end" if week else "opening", "week": week, "summary": summary,
            "actors": list(ROLES), "arrivals": list(receipts), "dispatches": list(dispatches),
            "orders": placed, "demand_received": demand_received, "production": product,
            "in_transit_batches": batches.copy(), "delivered": delivered, "produced": produced,
        })
        snapshots.append({"tick": seq, "metrics": metrics, "entities": entities, "relations": relations})

    emit(0, "四个环节各有 12 件库存，先前发货的批次和已下达的订单会在各自时点到达。")
    for week, consumer_demand in enumerate(demand, 1):
        receipts = [batch for batch in batches if batch["due"] == week]
        batches = [batch for batch in batches if batch["due"] > week]
        arrivals = dict.fromkeys(ROLES, 0)
        for batch in receipts:
            arrivals[batch["receiver"]] += batch["amount"]
        demand_received = dict(zip(ROLES, [consumer_demand, *pending.values()], strict=True))
        dispatches = []
        for i, role in enumerate(ROLES):
            available = stock[role] + arrivals[role]
            due = backlog[role] + demand_received[role]
            ship = min(available, due)
            stock[role], backlog[role] = available - ship, due - ship
            if i == 0:
                delivered += ship
            elif ship:
                dispatches.append({"sender": role, "receiver": ROLES[i - 1], "amount": ship,
                                   "sent": week, "due": week + delay, "origin_seq": len(events)})

        placed = {}
        for i, role in enumerate(ROLES):
            signal = consumer_demand if parameters["share_demand"] else demand_received[role]
            forecast[role] = 0.35 * signal + 0.65 * forecast[role]
            lag = delay if role == "工厂" else delay + 1
            outstanding[role] -= arrivals[role]
            units = decide(policy, forecast[role], stock[role], backlog[role], outstanding[role], lag)
            if week == SHOCK and role == "零售商":
                units = first_order
            if role == "工厂":
                units = min(units, CAPACITY)
            placed[role] = units
            outstanding[role] += units
            orders_by_role[role].append(units)
        product = placed["工厂"]
        produced += product
        if product:
            dispatches.append({"sender": "生产", "receiver": "工厂", "amount": product,
                               "sent": week, "due": week + delay, "origin_seq": len(events)})
        batches.extend(dispatches)
        pending = {role: placed[role] for role in ROLES[:3]}
        costs += sum(stock.values()) + 2 * sum(backlog.values())
        student = " 本周使用你提交的零售订单。" if week == SHOCK else ""
        emit(week, f"第 {week} 周终端需求 {consumer_demand} 件，零售商下单 {placed['零售商']} 件，"
            f"工厂启动生产 {product} 件，零售期末积压 {backlog['零售商']} 件。{student}",
            placed=placed, receipts=receipts, dispatches=dispatches, arrivals=arrivals,
            product=product, demand_received=demand_received)
    return {
        "engine_version": "beer/1", "initial": initial, "root_hash": root_hash,
        "initial_hash": digest(initial), "intervention": parameters, "events": events,
        "snapshots": snapshots, "metrics": snapshots[-1]["metrics"],
    }
