"""Exercise each pilot action against its unchanged numerical transition."""
import pytest

from services.simulation import cascade, svb
from services.simulation.lessons import load_case


def run_with(case_id, simulate, choice, scenario="baseline"):
    case = load_case(case_id)
    observations = []

    def decide(actor, stage, observation, allowed, default):
        assert choice in allowed and default in allowed
        observations.append((actor, stage, observation))
        return choice

    result = simulate(case, scenario, case["seed"], case["action"]["default"], decide=decide)
    assert len(observations) == 1
    return result, observations[0]


def test_svb_decision_creates_bounded_application_and_moves_existing_ledger():
    held, (actor, stage, observation) = run_with("svb_run", svb.simulate, "hold")
    withdrawn, _ = run_with("svb_run", svb.simulate, "withdraw_unprotected")
    assert actor == "D02" and stage == "protective_withdrawal"
    assert observation["round"] == 1
    assert set(observation) == {"round", "deposit", "pending", "payroll_due", "protected",
                               "observed_requests", "risk_score", "public_security_price"}
    assert observation["observed_requests"] == []
    cap = observation["deposit"] - observation["pending"] - observation["protected"] - observation["payroll_due"]
    assert cap > 0

    selected = next(row for row in withdrawn["events"] if row["event_type"] == "agent_action_selected")
    assert selected["actor_id"] == actor and selected["action"] == "withdraw_unprotected"
    first = next(row for row in withdrawn["events"] if row["event_type"] == "requests")
    applied = next(row for row in first["requests"] if row["person"] == actor)
    assert applied["protective"] == cap and applied["agent_action_seq"] == selected["seq"]
    assert applied["requested"] == observation["payroll_due"] + cap
    held_first = next(row for row in held["events"] if row["event_type"] == "requests")
    assert sum(row["requested"] for row in first["requests"]) - sum(
        row["requested"] for row in held_first["requests"]
    ) == cap
    assert withdrawn["root_hash"] == held["root_hash"]
    assert withdrawn["snapshots"][first["tick"]]["metrics"]["requested"] == sum(
        row["requested"] for row in first["requests"]
    )


def test_cascade_public_policies_act_with_declared_likelihood():
    choose_a, (actor, stage, observation) = run_with("information_cascade", cascade.simulate, "force_a")
    choose_b, _ = run_with("information_cascade", cascade.simulate, "force_b")
    assert (actor, stage) == ("D04", "choose_public_policy")
    assert set(observation) == {"turn", "public_a_pct", "private_accuracy", "visible_actions", "verification"}
    assert observation["verification"] is None and observation["turn"] == 4
    assert [row["actor_id"] for row in observation["visible_actions"]] == ["D01", "D02", "D03"]
    assert all(set(row) == {"actor_id", "choice"} for row in observation["visible_actions"])
    _, (_, _, private) = run_with("information_cascade", cascade.simulate, "force_a", "private")
    assert private["visible_actions"] == []

    for run, action in ((choose_a, "A"), (choose_b, "B")):
        decision = next(row for row in run["events"] if row.get("turn") == 4)
        selected = run["events"][decision["agent_action_seq"]]
        assert selected["seq"] + 1 == decision["seq"]
        assert selected["action"] == f"force_{action.lower()}"
        assert decision["choice"] == action
        assert decision["action_likelihood_given_a"] == decision["action_likelihood_given_b"] == 1
        assert decision["public_a_before_pct"] == decision["public_a_after_pct"]
    assert choose_a["root_hash"] == choose_b["root_hash"]
    assert choose_a["metrics"]["correct_pct"] != choose_b["metrics"]["correct_pct"]


@pytest.mark.parametrize(("case_id", "simulate"), [
    ("svb_run", svb.simulate), ("information_cascade", cascade.simulate),
])
def test_role_hook_has_no_unlisted_action(case_id, simulate):
    case = load_case(case_id)
    with pytest.raises(ValueError, match="outside the offered"):
        simulate(case, "baseline", case["seed"], case["action"]["default"], decide=lambda *args: "override_ledger")
