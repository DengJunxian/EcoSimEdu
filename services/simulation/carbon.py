"""One-period cap-and-trade lab with integer allowance IDs and exact settlement."""

from random import Random

from .auction import digest


def apportion(amount, weights):
    if not sum(weights.values()):
        weights = dict.fromkeys(weights, 1)
    total = sum(weights.values())
    allocation = {id_: amount * weight // total for id_, weight in weights.items()}
    ranking = sorted(weights, key=lambda id_: (-(amount * weights[id_] % total), id_))
    for id_ in ranking[: amount - sum(allocation.values())]:
        allocation[id_] += 1
    return allocation


def reduction_plan(firms, cap, policy):
    if type(cap) is not int or cap < 0:
        raise ValueError("Cap must be a nonnegative integer")
    if any(type(e) is not int or type(k) is not int or e < 0 or k <= 0 for e, k in firms.values()):
        raise ValueError("Expected nonnegative integer emissions and strictly positive integer costs")

    required = max(0, sum(e for e, _ in firms.values()) - cap)
    units = sorted((k * (2 * i + 1), firm) for firm, (e, k) in firms.items() for i in range(e))
    cost = sum(marginal for marginal, _ in units[:required]) / 2
    if policy == "uniform":
        return apportion(required, {firm: e for firm, (e, _) in firms.items()}), None, cost
    if policy != "trade":
        raise ValueError("Unknown clearing policy")
    plan = dict.fromkeys(firms, 0)
    for _, firm in units[:required]:
        plan[firm] += 1
    if required == 0:
        price = 0
    elif cap == 0:
        price = max(e * k for e, k in firms.values())
    else:
        price = units[required - 1][0] / 2
    return plan, price, cost


def continuous_cost(firms, cap):
    """Lower-bound cost from the continuous price-taking allocation."""
    required = sum(e for e, _ in firms.values()) - cap
    if required <= 0:
        return 0
    low, high = 0, max(e * k for e, k in firms.values())
    for _ in range(60):
        p = (low + high) / 2
        if sum(min(p / k, e) for e, k in firms.values()) < required:
            low = p
        else:
            high = p
    return round(sum(k * min(high / k, e) ** 2 / 2 for e, k in firms.values()), 6)


def simulate(case, scenario_id, seed, action):
    if action not in {option["id"] for option in case["action"]["options"]}:
        raise ValueError("Unknown allocation mandate")
    rng = Random(seed)
    firms = {f"F{i:02d}": (rng.randint(13, 24), rng.randint(2, 5) + i) for i in range(1, 9)}
    return run_market(case, scenario_id, seed, int(action), firms)


def run_market(case, scenario_id, seed, transfer_requested, firms):
    parameters = next(s["parameters"] for s in case["scenarios"] if s["id"] == scenario_id)
    cap = parameters["cap"]
    policy = parameters["policy"]
    plan, price, discrete_benchmark = reduction_plan(firms, cap, policy)
    zero_permits = scenario_id == "boundary" and cap == 0
    marginal_cost = price if zero_permits else None
    if zero_permits:
        price = None
    lower_bound = continuous_cost(firms, cap)
    e0 = {firm: emissions for firm, (emissions, _) in firms.items()}
    intensity = {firm: k for firm, (_, k) in firms.items()}
    emissions = {firm: e0[firm] - plan[firm] for firm in firms}
    weight = e0 if parameters["allocation"] == "emissions" else intensity
    allocation = apportion(cap, weight)
    special, donor = next(iter(firms)), next(reversed(firms))
    shifted = min(transfer_requested, allocation[donor]) if special != donor else 0
    allocation[special] += shifted
    allocation[donor] -= shifted

    initial = {
        "firms": {firm: {"baseline_emissions": e0[firm], "cost_coefficient": intensity[firm]} for firm in firms},
        "cap": cap, "free_allocation": allocation, "student_requested": transfer_requested, "student_applied": shifted,
        "market_rules": {"permit_tonnes": 1, "price_increment": 0.5, "fee": 0, "short_selling": False,
                         "banking": False, "offsets": False, "settlement": "clearing_then_surrender"},
    }
    root_hash = digest({"seed": seed, "firms": initial["firms"], "student_requested": transfer_requested})
    owned = {}
    next_id = 1
    for firm, quantity in allocation.items():
        owned[firm] = [f"A{i:04d}" for i in range(next_id, next_id + quantity)]
        next_id += quantity
    payments = dict.fromkeys(firms, 0)
    surrendered = {firm: [] for firm in firms}
    events, snapshots = [], []
    abatement_cost = {firm: intensity[firm] * plan[firm] ** 2 / 2 for firm in firms}
    moved = 0

    def record(kind, phase, summary, relations=(), **fields):
        seq = len(events)
        entities = {
            firm: {
                "基准排放": e0[firm], "成本系数": intensity[firm], "免费配额": allocation[firm],
                "计划减排": plan[firm] if phase else None, "计划排放": emissions[firm] if phase else None,
                "方案减排成本": abatement_cost[firm] if phase else None, "持有配额": len(owned[firm]),
                "已缴回配额": len(surrendered[firm]), "配额净支付": payments[firm],
                "方案净成本": abatement_cost[firm] + payments[firm] if phase else None,
            } for firm in firms
        }
        entities["登记簿"] = {"发行": cap, "缴回": sum(map(len, surrendered.values())),
                            "持有未缴回": sum(map(len, owned.values()))}
        metrics = {
            "cap": cap, "planned_emissions": sum(emissions.values()) if phase else None,
            "abatement_cost": sum(abatement_cost.values()) if phase else None,
            "price": price if phase >= 2 else None, "permits_moved": moved,
            "surrendered": entities["登记簿"]["缴回"],
        }
        events.append({"seq": seq, "tick": seq, "event_type": kind, "phase": phase, "summary": summary,
                       **fields})
        snapshots.append({"tick": seq, "metrics": metrics, "entities": entities, "relations": list(relations)})

    record("issuance", 0, f"登记簿发行 {cap} 张配额。按你的要求，实际由 {donor} 向 {special} 调整 {shifted} 张免费配额。",
           issue={firm: list(ids) for firm, ids in owned.items()}, actors=list(firms))
    record("phase_end", 1, f"各企业作出减排安排，计划排放合计 {sum(emissions.values())} 吨，方案减排成本 {sum(abatement_cost.values()):g} 代币。",
           abatement=plan, emissions=emissions, continuous_cost_floor=lower_bound, integer_minimum_cost=discrete_benchmark,
           actors=list(firms))

    sellers = [firm for firm in firms if len(owned[firm]) > emissions[firm]]
    for buyer in firms:
        for seller in sellers:
            quantity = min(emissions[buyer] - len(owned[buyer]), len(owned[seller]) - emissions[seller])
            if quantity <= 0:
                continue
            permits = owned[seller][-quantity:]
            del owned[seller][-quantity:]
            owned[buyer].extend(permits)
            amount = quantity * (price or 0)
            payments[buyer] += amount
            payments[seller] -= amount
            moved += quantity
            label = "清算交易" if policy == "trade" else "监管调配"
            record("transfer", 2, f"{seller} 向 {buyer} 转移 {quantity} 张配额，净付款 {amount:g} 代币。",
                   [{"from": seller, "to": buyer, "label": f"{label} {quantity} 张"}],
                   actors=[seller, buyer], seller=seller, buyer=buyer, permits=permits, payment=amount)
    price_note = f"清算价为每张 {price:g} 代币。" if price is not None else "统一比例情景按需调配配额，交易价格留空。"
    price_evidence = {}
    if zero_permits:
        price_note = f"没有配额可清算，清算价留空。完全减排时的最高边际成本为每吨 {marginal_cost:g} 代币。"
        price_evidence["max_marginal_abatement_cost"] = marginal_cost
    record("phase_end", 2, f"累计转移 {moved} 张配额。{price_note}", **price_evidence)

    for firm, quantity in emissions.items():
        if len(owned[firm]) < quantity:
            raise ArithmeticError("Firm would surrender more permits than it owns")
        permits, owned[firm] = owned[firm][:quantity], owned[firm][quantity:]
        surrendered[firm] = permits
        record("surrender", 3, f"{firm} 缴回 {quantity} 张配额，覆盖其 {quantity} 吨排放。",
               [{"from": firm, "to": "登记簿", "label": f"缴回 {quantity} 张"}],
               actors=[firm, "登记簿"], firm=firm, permits=permits, emissions=quantity)
    record("phase_end", 3, f"全部企业完成缴回。登记簿还有 {cap - sum(emissions.values())} 张未使用配额。",
           actors=["登记簿"])
    return {
        "engine_version": "carbon/1", "initial": initial, "root_hash": root_hash,
        "initial_hash": digest(initial), "intervention": parameters, "events": events,
        "snapshots": snapshots, "metrics": snapshots[-1]["metrics"],
    }
