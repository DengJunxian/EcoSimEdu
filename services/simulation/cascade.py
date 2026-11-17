"""A sequential Bayesian decision model with explicit observation policies."""

import random
from fractions import Fraction

from .auction import digest

STATES = ("A", "B")
ROUNDS = 12
STUDENT_TURN = 3


def _likelihood(observed, state, accuracy):
    return accuracy if observed == state else 1 - accuracy


def _posterior(prior, given_a, given_b):
    evidence = prior * given_a + (1 - prior) * given_b
    return prior * given_a / evidence


def _draw(rng, state, accuracy):
    return state if rng.randrange(accuracy.denominator) < accuracy.numerator else STATES[1 - STATES.index(state)]


def _pct(probability):
    return round(float(probability * 100), 4)


def simulate(case, scenario_id, seed, action, *, decide=None):
    parameters = next(s["parameters"] for s in case["scenarios"] if s["id"] == scenario_id)
    observe_actions = parameters["observe_actions"]
    verification_turn = parameters["verification_turn"]
    accuracy = Fraction(parameters.get("private_accuracy", case["private_accuracy"]))
    verification_accuracy = Fraction(case["verification_accuracy"])
    rng = random.Random(seed)
    state = rng.choice(STATES)
    signals = [_draw(rng, state, accuracy) for _ in range(ROUNDS)]
    verification = _draw(rng, state, verification_accuracy)
    initial = {
        "seed": seed,
        "state": state,
        "signals": signals,
        "verification": verification,
        "reference_policy": "bayes_tie_follows_private_v1",
        "student_turn": STUDENT_TURN,
        "private_accuracy": str(accuracy),
        "verification_accuracy": str(verification_accuracy),
    }

    prior = Fraction(1, 2)
    events, snapshots = [], []
    entities = {}
    visible_choices = []
    verification_visible = False
    cascade_start = None
    cascade_decisions = revealing_decisions = 0
    correct = 0

    def record(event_type, summary, *, actors=(), relations=(), **fields):
        tick = len(events)
        events.append({
            "seq": tick, "tick": tick, "event_type": event_type, "summary": summary,
            "actors": list(actors), **fields,
        })
        snapshots.append({
            "tick": tick,
            "metrics": {
                "public_a_pct": _pct(prior),
                "cascade_decisions": cascade_decisions,
                "cascade_start": cascade_start,
                "revealing_decisions": revealing_decisions,
                "correct_pct": _pct(Fraction(correct, ROUNDS)) if event_type == "reveal" else None,
            },
            "entities": dict(entities),
            "relations": list(relations),
        })

    record("experiment_open", "实验开始。A、B 两个箱子被选中的机会各为一半。")
    for turn, signal in enumerate(signals, start=1):
        if turn == verification_turn:
            before = prior
            prior = _posterior(
                prior, _likelihood(verification, "A", verification_accuracy),
                _likelihood(verification, "B", verification_accuracy),
            )
            verification_visible = True
            entities["V01"] = {"公共核验": verification, "准确率": f"{_pct(verification_accuracy):.2f}%"}
            record(
                "verification", f"第 {turn} 人行动前，全体收到偏向 {verification} 的独立核验。",
                actors=["V01"], origin_id="verification-01", signal=verification,
                public_a_before_pct=_pct(before), public_a_after_pct=_pct(prior),
            )

        actor = f"D{turn:02d}"
        before = prior
        policy = action if turn == STUDENT_TURN else "bayes"
        decision_details = {}
        if decide is not None and turn == 4:
            allowed = {
                "bayes": "按公共后验与私信号进行贝叶斯选择，平局跟随私信号",
                "private_signal": "跟随自己的私信号",
                "force_a": "预先公开固定为 A",
                "force_b": "预先公开固定为 B",
            }
            stage = "choose_public_policy"
            policy = decide(actor, stage, {
                "turn": turn, "public_a_pct": _pct(before), "private_accuracy": str(accuracy),
                "visible_actions": [{"actor_id": person, "choice": entities[person]["行动"]}
                                    for person in visible_choices],
                "verification": entities["V01"]["公共核验"] if verification_visible else None,
            }, allowed, "bayes")
            if policy not in allowed:
                raise ValueError("Cascade decision is outside the offered policies")
            decision_details["agent_action_seq"] = len(events)
            record("agent_action_selected", f"{actor} 公开声明策略：{allowed[policy]}。", actors=[actor],
                   actor_id=actor, stage=stage, action=policy)
        posteriors = {
            observation: _posterior(
                before, _likelihood(observation, "A", accuracy), _likelihood(observation, "B", accuracy),
            )
            for observation in STATES
        }
        if policy == "bayes":
            choices = {
                observation: ("A" if posterior > Fraction(1, 2) else "B" if posterior < Fraction(1, 2) else observation)
                for observation, posterior in posteriors.items()
            }
        elif policy == "private_signal":
            choices = {observation: observation for observation in STATES}
        elif policy in ("force_a", "force_b"):
            choices = dict.fromkeys(STATES, policy[-1].upper())
        else:
            raise ValueError(f"Unknown student policy: {policy}")

        choice = choices[signal]
        likelihoods = {
            candidate: sum(
                _likelihood(observation, candidate, accuracy)
                for observation in STATES if choices[observation] == choice
            )
            for candidate in STATES
        }
        cascade = policy == "bayes" and choices["A"] == choices["B"]
        if cascade:
            cascade_decisions += 1
            if cascade_start is None:
                cascade_start = turn
        if observe_actions:
            prior = _posterior(prior, likelihoods["A"], likelihoods["B"])
        information_added = prior != before
        revealing_decisions += information_added
        correct += choice == state

        summary = f"第 {turn} 人选择 {choice}。"
        if cascade:
            summary += "两种私人抽样都会导向相同选择，公开信念保持不变。"
        elif not observe_actions:
            summary += "行动未公开，后续参与者无法利用这一选择。"
        elif not information_added:
            summary += "公开信念保持不变。"
        else:
            summary += f"公开的 A 箱概率变为 {_pct(prior):.2f}%。"

        entities[actor] = {
            "行动": choice, "私人抽样": signal,
            "声明策略": {
                "bayes": "贝叶斯，平局跟随私信号",
                "private_signal": "跟随私信号",
                "force_a": "固定选 A",
                "force_b": "固定选 B",
            }[policy],
            "私信号纳入后 A 箱概率（%）": _pct(posteriors[signal]),
            "动作是否依赖私信号": "是" if choices["A"] != choices["B"] else "否",
        }
        relations = [{"from": previous, "to": actor, "label": "已观察的公开行动"} for previous in visible_choices]
        if verification_visible:
            relations.append({"from": "V01", "to": actor, "label": "共同核验"})
        record(
            "decision", summary, actors=[actor], relations=relations,
            turn=turn, signal=signal, signal_id=f"draw-{turn:02d}", choice=choice, policy=policy,
            visible_action_ids=list(visible_choices),
            observed_origin_ids=["verification-01"] if verification_visible else [],
            choice_if_private_a=choices["A"], choice_if_private_b=choices["B"],
            public_a_before_pct=_pct(before), private_a_after_pct=_pct(posteriors[signal]),
            public_a_after_pct=_pct(prior), action_likelihood_given_a=float(likelihoods["A"]),
            action_likelihood_given_b=float(likelihoods["B"]),
            cascade=cascade, information_added=information_added, **decision_details,
        )
        if observe_actions:
            visible_choices.append(actor)

    record(
        "reveal", f"核对答案：本场抽样来自 {state} 箱，12 人中有 {correct} 人猜对。",
        state=state, correct_count=correct,
    )
    return {
        "engine_version": "information-cascade/1",
        "initial": initial,
        "events": events,
        "snapshots": snapshots,
        "metrics": snapshots[-1]["metrics"],
        "root_hash": digest(initial),
        "initial_hash": digest(initial),
        "intervention": parameters,
    }
