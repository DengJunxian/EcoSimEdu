"""Four-person repeated public goods model with simultaneous settlement."""

from fractions import Fraction
from random import Random

from .auction import digest
from .classroom_policy import choose_actions

ENDOWMENT = 20
RETURN = Fraction(2, 5)
PARTICIPANTS = ("P1", "P2", "P3", "P4")
ROUNDS = 10


def settle_round(contributions, points, cost, multiplier):
    if set(contributions) != set(PARTICIPANTS) or any(
        type(amount) is not int or not 0 <= amount <= ENDOWMENT
        for amount in contributions.values()
    ):
        raise ValueError("Invalid contribution")
    if cost < 0 or multiplier < 0:
        raise ValueError("Invalid sanction parameters")
    if any(
        giver == receiver or giver not in contributions or receiver not in contributions
        or type(amount) is not int or amount < 0
        for (giver, receiver), amount in points.items()
    ):
        raise ValueError("Invalid sanction")
    public_return = sum(contributions.values()) * RETURN
    gross = {actor: ENDOWMENT - amount + public_return for actor, amount in contributions.items()}
    outgoing = {
        actor: sum(amount * cost for (giver, _), amount in points.items() if giver == actor)
        for actor in contributions
    }
    if any(outgoing[actor] > gross[actor] for actor in contributions):
        raise ValueError("Sanctions exceed budget")
    incoming = {
        actor: sum(amount * multiplier for (_, receiver), amount in points.items() if receiver == actor)
        for actor in contributions
    }
    fines = {actor: min(incoming[actor], gross[actor] - outgoing[actor]) for actor in contributions}
    net = {actor: gross[actor] - outgoing[actor] - fines[actor] for actor in contributions}
    edges = [
        {
            "from": giver,
            "to": receiver,
            "points": amount,
            "cost": amount * cost,
            "fine": float(fines[receiver] * Fraction(amount * multiplier, incoming[receiver]))
            if incoming[receiver] else 0,
        }
        for (giver, receiver), amount in sorted(points.items())
        if amount
    ]
    return gross, outgoing, fines, net, edges


def simulate(case, scenario_id, seed, action, *, decide=None, contribution_plan=None,
             rounds=ROUNDS, classroom_policy=None):
    if type(rounds) is not int or not 1 <= rounds <= ROUNDS:
        raise ValueError("Invalid public goods round count")
    if decide is not None and classroom_policy is not None:
        raise ValueError("Only one model policy may own a round")
    if action not in {item["id"] for item in case["action"]["options"]}:
        raise ValueError("Unknown contribution")
    parameters = next(scenario["parameters"] for scenario in case["scenarios"] if scenario["id"] == scenario_id)
    cost = parameters["unit_cost"]
    rng = Random(seed)
    profiles = {
        "P1": {"role": "学生", "target": 10},
        "P2": {"role": "条件合作者", "target": rng.randint(10, 14)},
        "P3": {"role": "自利策略", "target": rng.randint(0, 3)},
        "P4": {"role": "规范维护者", "target": rng.randint(13, 18)},
    }
    noise = [[rng.randint(-2, 2) for _ in PARTICIPANTS] for _ in range(rounds)]
    initial = {"agents": profiles, "round_endowment": ENDOWMENT, "rounds": rounds}
    if contribution_plan:
        initial["round_contributions"] = contribution_plan
    root_hash = digest({"seed": seed, "initial": initial, "noise": noise})
    balances = dict.fromkeys(PARTICIPANTS, Fraction(0))
    fines = dict.fromkeys(PARTICIPANTS, Fraction(0))
    metrics = {"contributions": 0, "total_contributions": 0, "net_income": 0, "sanction_cost": 0}
    entities = {actor: {"策略": profile["role"], "累计净收益": 0} for actor, profile in profiles.items()}
    entities["公共池"] = {"累计贡献": 0}
    events, snapshots = [], []
    cumulative_cost = Fraction(0)

    def record(event_type, round_no, summary, relations=(), **fields):
        tick = len(events)
        events.append({"seq": tick, "tick": tick, "event_type": event_type, "summary": summary, "round": round_no, **fields})
        snapshots.append({"tick": tick, "metrics": dict(metrics), "entities": {
            actor: dict(values) for actor, values in entities.items()
        }, "relations": list(relations)})

    record("start", 0, "四名参与者入组，每轮各有 20 代币。")
    previous = None
    for index in range(rounds):
        contributions = {}
        for j, actor in enumerate(PARTICIPANTS):
            profile = profiles[actor]
            target = profile["target"]
            if previous is not None:
                peers = (sum(previous.values()) - previous[actor]) / (len(PARTICIPANTS) - 1)
                target = round((target + peers) / 2) if actor in ("P1", "P2") else target
                target += (fines[actor] > 0) * 3
            contributions[actor] = max(0, min(ENDOWMENT, target + noise[index][j]))
        if contribution_plan and str(index + 1) in contribution_plan:
            contributions["P1"] = contribution_plan[str(index + 1)]
        elif index == 0:
            contributions["P1"] = int(action)
        if decide is not None and index == 1:
            actor = "P2"
            stage = "round_2_contribution"
            default = str(contributions[actor])
            allowed = {str(amount): f"投入 {amount} 代币" for amount in (0, 10, ENDOWMENT, int(default))}
            observation = {
                "round": index + 1,
                "role": profiles[actor]["role"],
                "endowment_tokens": ENDOWMENT,
                "marginal_return_per_player": float(RETURN),
                "players": len(PARTICIPANTS),
                "sanction_cost_per_point": cost,
                "previous_public_contributions": dict(previous),
                "own_previous_payoff": float(balances[actor]),
                "own_previous_fine": float(fines[actor]),
            }
            chosen = decide(actor, stage, observation, allowed, default)
            if not isinstance(chosen, str) or chosen not in allowed:
                raise ValueError("Unexpected contribution choice")
            contributions[actor] = int(chosen)
            record("agent_action_selected", index + 1, f"{actor} 提交本轮贡献选择，等待四人同时公开。",
                   actors=[actor], actor_id=actor, stage=stage, action=chosen)

        if classroom_policy is not None:
            step = index + 1
            stage = "round_contribution"
            requests = [{
                "actor": actor,
                "stage": stage,
                "observation": {
                    "round": step,
                    "role": profiles[actor]["role"],
                    "endowment_tokens": ENDOWMENT,
                    "marginal_return_per_player": float(RETURN),
                    "players": len(PARTICIPANTS),
                    "sanction_cost_per_point": cost,
                    "previous_public_contributions": dict(previous) if previous is not None else {},
                    "own_cumulative_payoff": float(balances[actor]),
                    "own_previous_fine": float(fines[actor]),
                },
                "allowed": {str(amount): f"投入 {amount} 代币" for amount in range(ENDOWMENT + 1)},
                "default": str(contributions[actor]),
            } for actor in PARTICIPANTS[1:]]
            choices = choose_actions(classroom_policy, step, requests)
            decision_seqs = {}
            for actor in PARTICIPANTS[1:]:
                contributions[actor] = int(choices[actor])
                decision_seqs[actor] = len(events)
                record("agent_action_selected", step, f"{actor} 提交本轮贡献选择。",
                       actors=[actor], actor_id=actor, stage=stage, action=choices[actor])

        total = sum(contributions.values())
        metrics["contributions"] = total
        metrics["total_contributions"] += total
        for actor in PARTICIPANTS:
            entities[actor] = {
                "策略": profiles[actor]["role"], "本轮贡献": contributions[actor],
                "累计净收益": float(balances[actor]),
            }
        entities["公共池"] = {
            "本轮贡献": total, "累计贡献": metrics["total_contributions"], "每人公共回报": float(total * RETURN),
        }
        contribution_edges = [
            {"from": actor, "to": "公共池", "label": f"贡献 {amount} 代币"}
            for actor, amount in contributions.items()
            if amount
        ]
        record(
            "contributions", index + 1, f"第 {index + 1} 轮同时公开四人的贡献，公共池收到 {total} 代币。",
            contribution_edges, actors=[*PARTICIPANTS, "公共池"], contributions=contributions,
            public_return=float(total * RETURN),
            **({"agent_action_seqs": decision_seqs} if classroom_policy is not None else {}),
        )

        points = {}
        if cost is not None:
            points = {
                ("P4", actor): min(2, 4 // cost)
                for actor, amount in contributions.items()
                if actor != "P4" and amount < 8
            }
        gross, outgoing, fines, net, sanctions = settle_round(contributions, points, cost or 0, 3)
        relations = [
            {"from": edge["from"], "to": edge["to"], "label": f"施罚成本 {edge['cost']}，扣损 {edge['fine']:g}"}
            for edge in sanctions
        ]
        for actor in PARTICIPANTS:
            balances[actor] += net[actor]
            entities[actor].update({
                "惩罚前收益": float(gross[actor]), "施罚成本": outgoing[actor],
                "受罚扣损": float(fines[actor]), "本轮净收益": float(net[actor]),
                "累计净收益": float(balances[actor]),
            })
        metrics["net_income"] = float(sum(balances.values()))
        cumulative_cost += sum(outgoing.values()) + sum(fines.values())
        metrics["sanction_cost"] = float(cumulative_cost)
        group_net = float(sum(net.values()))
        record(
            "settlement", index + 1,
            f"第 {index + 1} 轮群体净收益 {group_net:g} 代币，定向惩罚 {len(sanctions)} 笔。",
            relations, actors=list(PARTICIPANTS), sanctions=sanctions,
            gross={actor: float(value) for actor, value in gross.items()},
            net={actor: float(value) for actor, value in net.items()},
            outgoing=outgoing, fines={actor: float(value) for actor, value in fines.items()},
        )
        previous = contributions
        if classroom_policy is not None:
            classroom_policy.commit(index + 1, events, snapshots)
    return {
        "engine_version": "public-goods/3" if rounds != ROUNDS or classroom_policy is not None
                          else "public-goods/2" if contribution_plan else "public-goods/1", "initial": initial, "events": events, "snapshots": snapshots, "metrics": dict(metrics),
        "root_hash": root_hash, "initial_hash": digest(initial), "intervention": parameters,
    }
