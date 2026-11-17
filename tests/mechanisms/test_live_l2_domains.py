"""Offline policies exercise the same decision/settlement seam as the L2 worker."""
from copy import deepcopy
from importlib import import_module

import pytest

from services.simulation.lessons import MODULES, load_case


class RecordedPolicy:
    def __init__(self, pick=lambda request: request["default"]):
        self.pick = pick
        self.calls = {}
        self.commits = {}

    def __call__(self, step, requests):
        self.calls[step] = requests
        return {item["actor"]: self.pick(item) for item in requests}

    def commit(self, step, events, snapshots):
        assert len(events) == len(snapshots)
        assert events[-1]["seq"] == snapshots[-1]["tick"] == len(events) - 1
        self.commits[step] = deepcopy((events, snapshots))


def run(case_id, policy=None):
    case = load_case(case_id)
    engine = import_module(f"services.simulation.{MODULES[case_id]}")
    kwargs = {"rounds": 6} if case_id == "public_goods" else {}
    return engine.simulate(case, "baseline", case["seed"], case["action"]["default"],
                           classroom_policy=policy, **kwargs)


@pytest.mark.parametrize("case_id,expected,commits", [
    ("public_goods", 18, 6), ("svb_run", 30, 20),
    ("information_cascade", 3, 12), ("gamestop", 3, 10),
])
def test_l2_default_policy_preserves_rule_economics_and_complete_prefixes(case_id, expected, commits):
    policy = RecordedPolicy()
    result = run(case_id, policy)
    rule = run(case_id)
    assert result["metrics"] == rule["metrics"]
    assert result["root_hash"] == rule["root_hash"] and result["initial_hash"] == rule["initial_hash"]
    actions = [event for event in result["events"] if event["event_type"] == "agent_action_selected"]
    assert len(actions) == sum(map(len, policy.calls.values())) == expected
    assert len({event["actor_id"] for event in actions}) >= 3
    assert list(policy.commits) == list(range(1, commits + 1))
    for events, frames in policy.commits.values():
        assert events == result["events"][:len(events)]
        assert frames == result["snapshots"][:len(frames)]
    assert policy.commits[commits] == (result["events"], result["snapshots"])


def test_public_goods_round_observations_freeze_and_actions_reach_settlement():
    policy = RecordedPolicy(lambda request: "20")
    result = run("public_goods", policy)
    assert result["metrics"]["total_contributions"] > run("public_goods")["metrics"]["total_contributions"]
    contributions = {event["round"]: event for event in result["events"] if event["event_type"] == "contributions"}
    for step, requests in policy.calls.items():
        assert [request["actor"] for request in requests] == ["P2", "P3", "P4"]
        expected = {} if step == 1 else contributions[step - 1]["contributions"]
        for request in requests:
            assert request["observation"]["previous_public_contributions"] == expected
            assert "contributions" not in request["observation"]
            assert contributions[step]["contributions"][request["actor"]] == 20
            seq = contributions[step]["agent_action_seqs"][request["actor"]]
            assert result["events"][seq]["action"] == "20"
        assert policy.commits[step][0][-1]["event_type"] == "settlement"


def test_svb_wallet_observations_link_only_reached_requests_and_legal_amounts():
    policy = RecordedPolicy(lambda request: "withdraw_unprotected" if "withdraw_unprotected" in request["allowed"] else "hold")
    result = run("svb_run", policy)
    assert result["metrics"] != run("svb_run")["metrics"]
    events = result["events"]
    for step, requests in policy.calls.items():
        prior = [event for event in events if event["event_type"] == "requests" and event["round"] < step]
        actors = {row["person"] for event in prior for row in event["requests"]}
        for request in requests:
            fields = request["observation"]
            assert set(fields) == {
                "round", "deposit", "pending", "payroll_due", "protected",
                "observed_requests", "risk_score", "public_security_price",
            }
            assert set(fields["observed_requests"]) <= actors
    for event in events:
        if event["event_type"] == "requests":
            for row in event["requests"]:
                if (seq := row.get("agent_action_seq")) is not None:
                    selected = events[seq]
                    assert selected["protective"] == row["protective"]
                    assert selected["actor_id"] == row["person"]
        if event["event_type"] in {"payments", "queue", "closing"}:
            frame = result["snapshots"][event["tick"]]
            bank = frame["entities"]["BANK"]
            assert frame["metrics"]["requested"] == frame["metrics"]["paid"] + frame["metrics"]["queued"]
            assert bank["净资产"] == bank["现金"] + bank["证券市值"] + bank["贷款"] - bank["存款负债"] - bank["支持借款负债"]


def test_cascade_policy_sees_committed_public_choices_without_private_draw():
    policy = RecordedPolicy(lambda request: "force_b")
    result = run("information_cascade", policy)
    assert list(policy.calls) == [1, 2, 4]
    for turn, (request,) in policy.calls.items():
        observation = request["observation"]
        assert set(observation) == {"turn", "public_a_pct", "private_accuracy", "visible_actions", "verification"}
        assert [item["actor_id"] for item in observation["visible_actions"]] == [
            f"D{earlier:02d}" for earlier in range(1, turn)]
        if turn > 1:
            assert observation["visible_actions"][0]["choice"] == "B"
        action = next(event for event in result["events"] if event["event_type"] == "decision" and event["turn"] == turn)
        assert action["choice"] == "B" and action["action_likelihood_given_a"] == action["action_likelihood_given_b"] == 1
        assert result["events"][action["agent_action_seq"]]["actor_id"] == request["actor"]


def test_gamestop_funded_orders_reach_the_matching_book_with_lineage():
    policy = RecordedPolicy(lambda request: "buy_2" if "buy_2" in request["allowed"] else "hold")
    result = run("gamestop", policy)
    assert list(policy.calls) == [1, 4, 8]
    assert result["metrics"] != run("gamestop")["metrics"]
    for event in result["events"]:
        if event["event_type"] != "agent_action_selected" or not event["quantity"]:
            continue
        request = policy.calls[event["time"]][0]
        assert request["observation"]["free_cash_cents"] >= event["quantity"] * 2_000
        assert all(int(notice[1:]) <= event["time"] for notice in request["observation"]["delivered_notices"])
        order = result["events"][event["seq"] + 1]
        assert order["event_type"] == "order_submitted" and order["side"] == "buy"
        assert event["order_id"] == order["order_id"] and event["quantity"] == order["quantity"]


def test_invalid_batch_action_is_rejected_before_any_commit():
    policy = RecordedPolicy(lambda request: "ledger_override")
    with pytest.raises(ValueError, match="offered action"):
        run("public_goods", policy)
    assert not policy.commits
