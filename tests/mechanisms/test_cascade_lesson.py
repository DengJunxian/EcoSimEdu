import json
from fractions import Fraction
from itertools import product
from pathlib import Path

import pytest

from services.simulation.auction import digest
from services.simulation.cascade import simulate

CASE = json.loads((Path(__file__).resolve().parents[2] / "cases/information_cascade/case.json").read_text())


def decisions(result):
    return [event for event in result["events"] if event["event_type"] == "decision"]


def test_classic_cascade_matches_independent_path_enumeration():
    result = simulate(CASE, "baseline", CASE["seed"], "bayes")
    history = []
    for event in decisions(result):
        history.append(event["choice"])
        weights = {}
        for state in ("A", "B"):
            weights[state] = 0
            for signals in product(("A", "B"), repeat=len(history)):
                score, choices = 0, []
                for signal in signals:
                    if abs(score) >= 2:
                        choices.append("A" if score > 0 else "B")
                    else:
                        choices.append(signal)
                        score += 1 if signal == "A" else -1
                if choices == history:
                    weights[state] += 2 ** signals.count(state)
        numerator = weights["A"]
        expected = Fraction(numerator, numerator + weights["B"])
        assert event["public_a_after_pct"] == round(float(expected * 100), 4)

    third = decisions(result)[2]
    assert third["signal"] == "A" and third["choice"] == "B"
    assert third["public_a_before_pct"] == third["public_a_after_pct"] == 20
    assert third["private_a_after_pct"] == pytest.approx(100 / 3, abs=0.0001)
    assert third["action_likelihood_given_a"] == third["action_likelihood_given_b"] == 1
    assert result["metrics"]["cascade_start"] == 3
    assert result["metrics"]["correct_pct"] == 0


def test_paired_counterfactuals_never_reuse_verification_as_new_evidence():
    runs = {name: simulate(CASE, name, CASE["seed"], "bayes") for name in ("baseline", "private", "verified")}
    assert len({run["root_hash"] for run in runs.values()}) == 1
    private = decisions(runs["private"])
    assert all(not event["visible_action_ids"] and event["public_a_after_pct"] == 50 for event in private)
    assert all(event["choice"] == event["signal"] for event in private)
    assert runs["private"]["metrics"]["cascade_decisions"] == 0

    verified_run = runs["verified"]
    verification = [event for event in verified_run["events"] if event["event_type"] == "verification"]
    assert len(verification) == 1
    assert verification[0]["public_a_before_pct"] == 20
    assert verification[0]["public_a_after_pct"] == pytest.approx(500 / 9, abs=0.0001)
    verified = decisions(verified_run)
    assert verified[6]["public_a_before_pct"] == verification[0]["public_a_after_pct"]
    assert not verified[6]["cascade"]
    assert verified[7]["public_a_before_pct"] == verified[6]["public_a_after_pct"]
    assert all(event["observed_origin_ids"] == [] for event in verified[:6])
    assert all(event["observed_origin_ids"] == [verification[0]["origin_id"]] for event in verified[6:])


@pytest.mark.parametrize("action", ["bayes", "private_signal", "force_a", "force_b"])
def test_seed_reproducibility_and_observable_history_boundaries(action):
    result = simulate(CASE, "baseline", CASE["seed"], action)
    assert digest(result) == digest(simulate(CASE, "baseline", CASE["seed"], action))
    assert all(event["seq"] == event["tick"] == snapshot["tick"] == index
               for index, (event, snapshot) in enumerate(zip(result["events"], result["snapshots"], strict=True)))
    assert all(snapshot["metrics"]["correct_pct"] is None for snapshot in result["snapshots"][:-1])
    assert result["metrics"] == result["snapshots"][-1]["metrics"]
    done = decisions(result)
    assert len({event["signal_id"] for event in done}) == 12
    for event in done:
        assert event["visible_action_ids"] == [f"D{i:02d}" for i in range(1, event["turn"])]
        assert 0 <= event["private_a_after_pct"] <= 100
    if action.startswith("force_"):
        third = done[2]
        assert third["choice"] == action[-1].upper()
        assert third["action_likelihood_given_a"] == third["action_likelihood_given_b"] == 1
        assert third["public_a_before_pct"] == third["public_a_after_pct"]
        assert not third["cascade"]


def test_zero_information_signals_keep_public_and_private_posteriors_balanced():
    result = simulate({**CASE, "private_accuracy": "1/2"}, "baseline", 0, "bayes")
    assert all(event["private_a_after_pct"] == event["public_a_after_pct"] == 50
               for event in decisions(result))
    assert result["metrics"]["cascade_start"] is None
    assert result["metrics"]["revealing_decisions"] == 0
