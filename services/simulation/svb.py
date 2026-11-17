"""Twenty-round bank run with synthetic depositors and a stock-flow ledger."""
from collections import deque
from random import Random

from .auction import digest


def _depositors(seed):
    rng = Random(seed)
    groups = [
        ("工资现金需求较高的企业", (45, 55), (12, 21), 20, (26, 47)),
        ("现金较充裕的企业", (25, 40), (5, 10), 25, (36, 57)),
        ("分散小额储户", (6, 12), (1, 3), 100, (50, 70)),
    ]
    people = {}
    for group, deposit, payroll, protected, threshold in groups:
        for _ in range(20):
            person_id = f"D{len(people) + 1:02}"
            balance = rng.randint(*deposit)
            people[person_id] = {
                "group": group,
                "deposit": balance,
                "payout": 0,
                "queued": 0,
                "payroll": rng.randint(*payroll),
                "payroll_round": rng.randint(1, 4) if protected == 20 else rng.randint(6, 14),
                "protected": balance * protected // 100,
                "threshold": rng.randint(*threshold),
                "protective_requested": False,
            }
    return people


def _neighbors(people, seed, layout):
    # Keep the observed-neighbor count constant across both layouts.
    order = list(people)
    Random(seed ^ 0x535642).shuffle(order)
    if layout == "none":
        return {person: () for person in order}
    hubs = ("D01", "D02", "D03", "D04")
    return {
        person: (tuple(hub for hub in hubs if person != hub)[:3] if layout == "concentrated"
                 else (order[i - 1], order[i - 2], order[(i + 1) % len(order)]))
        for i, person in enumerate(order)
    }


def simulate(case, scenario_id, seed, action, *, decide=None):
    options = {option["id"] for option in case["action"]["options"]}
    if action not in options:
        raise ValueError(f"Unknown SVB action: {action}")
    scenarios = {scenario["id"]: scenario["parameters"] for scenario in case["scenarios"]}
    patch = scenarios[scenario_id]
    baseline = scenarios["baseline"]
    rules = case["rules"]
    people = _depositors(seed)
    player = case["player_id"]
    people[player]["payroll_round"] = 1 if action == "withdraw_now" else 2
    initial_deposits = sum(person["deposit"] for person in people.values())
    start_price = rules["initial_price"]
    loans = (
        initial_deposits + rules["initial_equity"]
        - rules["initial_cash"] - rules["securities"] * start_price
    )
    cash = rules["initial_cash"] + patch["cash_reallocation"]
    units = rules["securities"] - patch["cash_reallocation"] // start_price
    price = start_price
    reserve = rules["support_reserve"]
    outside_cash = rules["securities"] * rules["sale_price"]
    graph = _neighbors(people, seed, patch["network"])
    if cash < 0 or units < 0 or loans < 0 or patch["cash_reallocation"] % start_price:
        raise ValueError("Invalid opening balance sheet")

    root = {
        "seed": seed,
        "action": action,
        "rules": rules,
        "bank": {"cash": rules["initial_cash"], "units": rules["securities"], "loans": loans},
        "support_cash": reserve,
        "market_cash": outside_cash,
        "people": people,
        "network": _neighbors(people, seed, baseline["network"]),
    }
    initial = {
        **root,
        "bank": {"cash": cash, "units": units, "loans": loans},
        "people": {person: state.copy() for person, state in people.items()},
        "network": graph,
    }
    root_hash = digest(root)
    initial_hash = digest(initial)

    support = sold = loss = paid = requested = queued = 0
    previous_sale = False
    queue = deque()
    events, snapshots = [], []
    first_requests = {}
    seen = {person: set() for person in people}
    risk_scores = dict.fromkeys(people, 0)
    step = 0

    def record(event_type, summary, actors, relations=(), **details):
        tick = len(events)
        events.append({
            "seq": tick,
            "tick": tick,
            "round": step,
            "event_type": event_type,
            "summary": summary,
            "actors": list(dict.fromkeys(actors)),
            **details,
        })
        deposits = initial_deposits - paid
        equity = cash + price * units + loans - deposits - support
        snapshots.append({
            "tick": tick,
            "metrics": {
                "cash": cash, "requested": requested, "paid": paid, "queued": queued,
                "equity": equity, "sale_loss": loss,
            },
            "entities": {
                "BANK": {
                    "类型": "教学银行", "现金": cash, "证券单位": units, "证券现价": price,
                    "证券市值": price * units, "贷款": loans, "存款负债": deposits,
                    "支持借款负债": support, "净资产": equity,
                    "付款状态": "仍有待付" if queued else "无待付",
                },
                "SUPPORT": {"类型": "流动性机构", "现金": reserve, "支持借款资产": support},
                "MARKET": {"类型": "证券买家", "现金": outside_cash, "证券单位": sold},
                **{
                    person: {
                        "类型": state["group"], "存款余额": state["deposit"], "外部现金": state["payout"],
                        "等待支付": state["queued"], "工资款": state["payroll"],
                        "已保障额度": state["protected"], "已观察储户数": len(seen[person]),
                        "风险评分": risk_scores[person], "行动阈值": state["threshold"],
                    }
                    for person, state in people.items()
                },
            },
            "relations": list(relations),
        })

    record("opening", "核对银行账表与储户存款。金额使用模拟资金单位。", ["BANK", player])
    step = 1
    price = rules["shocked_price"]
    record(
        "revaluation", f"共同冲击将每单位证券标价从 {start_price} 降至 {price}，银行现金不变。",
        ["BANK"], old_price=start_price, new_price=price, mark_loss=(start_price - price) * units,
    )
    record(
        "decision", f"你选择在第 {people[player]['payroll_round']} 轮提交工资款申请。",
        [player], action=action,
    )

    for step in range(1, rules["steps"] + 1):
        deliveries = []
        for person in people:
            for neighbor in graph[person]:
                origin = first_requests.get(neighbor)
                if origin is not None and neighbor not in seen[person]:
                    seen[person].add(neighbor)
                    deliveries.append({"from": neighbor, "to": person, "label": "观察到提款申请", "origin_seq": origin})
            risk_scores[person] = (
                rules["public_risk"] + len(seen[person]) * rules["neighbor_signal"]
                + (rules["sale_signal"] if previous_sale else 0)
                + (rules["queue_signal"] if queued else 0)
            )
        if deliveries:
            record(
                "messages", f"本轮有 {len(deliveries)} 条邻居提款消息首次到达。",
                [edge["to"] for edge in deliveries], deliveries, messages=deliveries,
            )

        live_actor = None
        if decide is not None and step == 1:
            live_actor = next(person for person in people if person != player)
            state = people[live_actor]
            free = state["deposit"] - state["queued"]
            payroll_due = min(state["payroll"], free) if state["payroll_round"] == step else 0
            cap = max(0, free - payroll_due - state["protected"])
            default = "withdraw_unprotected" if cap and risk_scores[live_actor] >= state["threshold"] else "hold"
            allowed = {"hold": "本轮不追加防御性提款"}
            if cap:
                allowed["withdraw_unprotected"] = f"本轮追加 {cap} 资金单位的防御性提款申请"
            stage = "protective_withdrawal"
            choice = decide(live_actor, stage, {
                "round": step, "deposit": state["deposit"], "pending": state["queued"],
                "payroll_due": payroll_due, "protected": state["protected"],
                "observed_requests": sorted(seen[live_actor]), "risk_score": risk_scores[live_actor],
                "public_security_price": price,
            }, allowed, default)
            if choice not in allowed:
                raise ValueError("Withdrawal decision is outside the offered actions")
            live_amount = cap if choice == "withdraw_unprotected" else 0
            decision_seq = len(events)
            record("agent_action_selected", f"{live_actor}：{allowed[choice]}。", [live_actor],
                   actor_id=live_actor, stage=stage, action=choice, protective=live_amount)

        new = []
        for person, state in people.items():
            free = state["deposit"] - state["queued"]
            payroll = min(state["payroll"], free) if state["payroll_round"] == step else 0
            # The student's first two rounds expose the chosen payroll timing.
            protective = (
                max(0, free - payroll - state["protected"])
                if (person != player or step > 2)
                and not state["protective_requested"] and risk_scores[person] >= state["threshold"]
                else 0
            )
            if person == live_actor:
                protective = live_amount
            if protective:
                state["protective_requested"] = True
            amount = payroll + protective
            if amount:
                entry = {
                    "request_id": f"{person}-{step:02}", "person": person,
                    "requested": amount, "remaining": amount, "paid": 0,
                    "payroll": payroll, "protective": protective, "risk_score": risk_scores[person],
                    "observation_seqs": sorted({first_requests[neighbor] for neighbor in seen[person]}),
                }
                if person == live_actor:
                    entry["agent_action_seq"] = decision_seq
                queue.append(entry)
                new.append(entry.copy())
                first_requests.setdefault(person, len(events))
                state["queued"] += amount
                queued += amount
                requested += amount
        if new:
            record(
                "requests", f"{len(new)} 名储户申请 {sum(row['requested'] for row in new)}，进入待付队列。",
                [row["person"] for row in new], [
                    {"from": row["person"], "to": "BANK", "label": f"申请 {row['requested']}"}
                    for row in new
                ], requests=new,
            )

        if step >= rules["support_start_round"] and queued > cash and reserve:
            draw = min(queued - cash, reserve)
            cash += draw
            reserve -= draw
            support += draw
            record(
                "support", f"支持机构借出 {draw}，现金与支持借款负债同时增加。",
                ["SUPPORT", "BANK"], [{"from": "SUPPORT", "to": "BANK", "label": f"借款 {draw}"}],
                draw=draw,
            )

        previous_sale = False
        if queued > cash and units:
            sale_price = rules["sale_price"]
            sale = min(units, rules["max_sale_units_per_round"], (queued - cash + sale_price - 1) // sale_price)
            proceeds = sale * sale_price
            realized_loss = sale * (price - sale_price)
            cash += proceeds
            outside_cash -= proceeds
            units -= sale
            sold += sale
            loss += realized_loss
            previous_sale = True
            record(
                "sale", f"银行急售 {sale} 单位证券，收到现金 {proceeds}，增加折价损失 {realized_loss}。",
                ["BANK", "MARKET"], [{"from": "BANK", "to": "MARKET", "label": f"出售证券 {sale}"}],
                units=sale, proceeds=proceeds, realized_loss=realized_loss,
            )

        payments = []
        while queue and cash:
            entry = queue[0]
            payout = min(cash, entry["remaining"])
            person = people[entry["person"]]
            entry["remaining"] -= payout
            entry["paid"] += payout
            person["queued"] -= payout
            person["deposit"] -= payout
            person["payout"] += payout
            cash -= payout
            paid += payout
            queued -= payout
            payments.append({**entry, "amount": payout})
            if entry["remaining"] == 0:
                queue.popleft()
        if payments:
            record(
                "payments", f"按先到先付原则结算 {sum(row['amount'] for row in payments)}；银行现金和存款负债等额减少。",
                [row["person"] for row in payments], [
                    {"from": "BANK", "to": row["person"], "label": f"到账 {row['amount']}"}
                    for row in payments
                ], payments=payments,
            )
        if queued:
            record(
                "queue", f"本轮结束仍有 {queued} 等待支付，相关金额仍在银行存款负债内。",
                ["BANK"], pending=[entry.copy() for entry in queue],
            )

    record("closing", "教学时段结束。比较未付款、剩余现金和净资产。", ["BANK"])
    return {
        "engine_version": "svb/1", "initial": initial,
        "events": events,
        "snapshots": snapshots,
        "metrics": snapshots[-1]["metrics"],
        "root_hash": root_hash,
        "initial_hash": initial_hash,
        "intervention": patch,
    }
