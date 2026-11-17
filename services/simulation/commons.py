"""Repeated extraction from a renewable commons with a separate monitor ledger."""

from math import fsum
from random import Random

from .auction import digest

CAPACITY = 240
INITIAL_STOCK = 180
GROWTH_RATE = 0.55
PERIODS = 12
QUOTA = 1
INITIAL_BUDGET = 8
MAX_CHECKS = 4
CHECK_COST = 0.5
FINE_RATE = 1.25
VALUE = 2
USERS = tuple(f"F{i:02d}" for i in range(1, 25))


def resource_step(stock, demand, capacity=CAPACITY, rate=GROWTH_RATE):
    if not 0 <= stock <= capacity or not 0 <= rate <= 1 or capacity <= 0:
        raise ValueError("Invalid resource conditions")
    if any(not 0 <= value < float("inf") for value in demand.values()):
        raise ValueError("Invalid withdrawal demand")
    demand_total = fsum(demand.values())
    share = min(stock / demand_total, 1) if demand_total else 0
    allocations = {actor: amount * share for actor, amount in demand.items()}
    harvested = min(stock, fsum(allocations.values()))
    remaining = stock - harvested
    growth = rate * remaining * (1 - remaining / capacity)
    return allocations, harvested, remaining, growth


def simulate(case, scenario_id, seed, action):
    if action not in {option["id"] for option in case["action"]["options"]}:
        raise ValueError("Unknown withdrawal plan")
    parameters = next(scenario["parameters"] for scenario in case["scenarios"] if scenario["id"] == scenario_id)
    institution = parameters["institution"]
    regeneration_rate = parameters.get("growth_rate", GROWTH_RATE)
    rng = Random(seed)
    profiles = {
        actor: {"capacity": rng.randint(2, 5), "trust": rng.randint(65, 95) / 100}
        for actor in USERS
    }
    draws = [[rng.random() for _ in USERS] for _ in range(PERIODS)]
    inspections = [rng.sample(USERS, MAX_CHECKS) for _ in range(PERIODS)]
    initial = {
        "resource_stock": parameters.get("initial_stock", INITIAL_STOCK),
        "capacity": CAPACITY, "monitor_budget": INITIAL_BUDGET,
        "users": profiles,
    }
    root_hash = digest({"seed": seed, "initial": initial, "draws": draws, "inspections": inspections})
    stock = initial["resource_stock"]
    budget = INITIAL_BUDGET
    cumulative_income = 0
    cumulative_cost = 0
    current_cost = 0
    compliance = dict.fromkeys(USERS, True)
    metrics = {"stock": stock, "harvest": None, "growth": None, "income": 0, "monitoring_cost": 0}
    entities = {
        actor: {"取用能力": profile["capacity"], "初始规则信任": profile["trust"]}
        for actor, profile in profiles.items()
    }
    events, snapshots = [], []

    def record(event_type, period, summary, relations=(), **fields):
        tick = len(events)
        events.append({
            "seq": tick, "tick": tick, "event_type": event_type, "summary": summary,
            "period": period, **fields,
        })
        snapshots.append({
            "tick": tick,
            "metrics": dict(metrics),
            "entities": {
                **{actor: dict(values) for actor, values in entities.items()},
                "水域": {"存量": metrics["stock"], "承载量": CAPACITY},
                "管护账户": {"余额": budget, "本期检查支出": current_cost},
            },
            "relations": list(relations),
        })

    record("start", 0, f"水域初始存量 {stock} 单位，24 位使用者共享。")
    for index in range(PERIODS):
        period = index + 1
        checked = inspections[index][:min(MAX_CHECKS, int(budget // CHECK_COST))] if institution == "community" else []
        current_cost = len(checked) * CHECK_COST
        cumulative_cost += current_cost
        before = stock
        plans = {}
        for j, actor in enumerate(USERS):
            profile = profiles[actor]
            # A low stock reduces catch opportunities even before proportional allocation.
            planned = max(1, round(profile["capacity"] * before / INITIAL_STOCK))
            if institution == "community":
                peers = (compliance[USERS[j - 1]] + compliance[USERS[(j + 1) % len(USERS)]]) / 2
                propensity = min(1, profile["trust"] + 0.12 * (peers - 0.5) + 0.18 * len(checked) / MAX_CHECKS)
                if draws[index][j] < propensity:
                    planned = min(planned, QUOTA)
            plans[actor] = planned
        if index == 0:
            plans["F01"] = int(action)
        requests = {
            actor: min(QUOTA, desire) if institution == "quota" else desire
            for actor, desire in plans.items()
        }
        allocations, harvested, remaining, growth = resource_step(before, requests, rate=regeneration_rate)
        fines = {
            actor: min(units * VALUE, FINE_RATE * max(0, units - QUOTA)) if actor in checked else 0
            for actor, units in allocations.items()
        }
        budget_before = budget
        budget += fsum(fines.values()) - current_cost
        income = fsum(units * VALUE - fines[actor] for actor, units in allocations.items())
        cumulative_income += income + budget - budget_before
        compliance = {actor: request <= QUOTA for actor, request in requests.items()}
        relations = [
            {"from": actor, "to": "水域", "label": f"取用 {units:.2f} 单位"}
            for actor, units in allocations.items()
            if units > 0
        ] + [
            {"from": "管护账户", "to": actor, "label": f"监测，扣缴 {fines[actor]:.2f} 代币"}
            for actor in checked
        ]
        for actor, units in allocations.items():
            entities[actor].update({
                "计划取用": plans[actor], "获准申请": requests[actor], "实际取用": units,
                "本期扣缴": fines[actor], "本期净收入": units * VALUE - fines[actor],
            })
        metrics.update(stock=remaining, harvest=harvested, growth=None, income=cumulative_income, monitoring_cost=cumulative_cost)
        record(
            "withdrawal", period,
            f"第 {period} 期实际取用 {harvested:.2f} 单位，取用后存量 {remaining:.2f} 单位。",
            relations, actors=["F01", "水域", "管护账户"], start_stock=before, remaining_stock=remaining,
            allocations=allocations, requests=requests, plans=plans, monitoring_cost=current_cost,
            monitored=checked, fines=fines, monitor_budget_before=budget_before,
            monitor_budget_after=budget, participant_net=income, gross_value=VALUE * harvested,
        )
        stock = remaining + growth
        metrics.update(stock=stock, growth=growth)
        record(
            "growth", period,
            f"第 {period} 期资源自然再生 {growth:.2f} 单位，下一期初存量 {stock:.2f} 单位。",
            actors=["水域"], remaining_stock=remaining, growth=growth, next_stock=stock,
        )
    return {
        "engine_version": "commons-governance/1", "initial": initial, "events": events, "snapshots": snapshots, "metrics": dict(metrics),
        "root_hash": root_hash, "initial_hash": digest(initial), "intervention": parameters,
    }
