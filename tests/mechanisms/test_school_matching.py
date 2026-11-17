from collections import Counter
from itertools import permutations, product
import json
from pathlib import Path

import pytest

from services.simulation.auction import digest
from services.simulation.matching import blocking_pairs, match, simulate

CASE = json.loads((Path(__file__).resolve().parents[2] / "cases/school_matching/case.json").read_text())


def test_three_student_rejection_chain_and_irreversible_placements():
    preferences = {"S01": "ABC", "S02": "BAC", "S03": "ABC"}
    priorities = {"A": ["S02", "S03", "S01"], "B": ["S01", "S02", "S03"],
                  "C": ["S03", "S01", "S02"]}
    capacities = dict.fromkeys(priorities, 1)
    delayed, rounds = match(preferences, priorities, capacities, "deferred")
    fast, fast_rounds = match(preferences, priorities, capacities, "immediate")
    assert delayed == {"S02": "A", "S01": "B", "S03": "C"}
    assert fast == {"S03": "A", "S02": "B", "S01": "C"}
    assert rounds[1]["rejected"][0]["was_held"] is True
    assert fast_rounds[1]["rejected"][0]["previous_commitments"] == ["S02"]
    assert blocking_pairs(delayed, preferences, priorities, capacities) == []
    assert blocking_pairs(fast, preferences, priorities, capacities) == [
        {"student": "S01", "school": "B", "lower_priority": ["S02"], "empty_seat": False}
    ]


@pytest.mark.parametrize("action", ["truthful", "safe_first"])
def test_catalog_allocation_capacity_and_rejected_priorities(action):
    results = [simulate(CASE, item["id"], CASE["seed"], action) for item in CASE["scenarios"]]
    assert len({result["root_hash"] for result in results}) == 1
    for lesson, result in zip(CASE["scenarios"], results, strict=True):
        assert result["initial_hash"] == digest(result["initial"])
        assert result == simulate(CASE, lesson["id"], CASE["seed"], action)
        assignments = result["events"][-1]["assignments"]
        capacities = result["events"][0]["capacities"]
        assert len(assignments) == len(result["initial"]["true_preferences"]) == 12
        assert all(count <= capacities[school] for school, count in Counter(assignments.values()).items())
        applications = set()
        submitted = result["events"][0]["submitted"]
        preferences = result["initial"]["true_preferences"]
        for event in result["events"]:
            if event["event_type"] == "round_proposals":
                for pair in event["proposals"].items():
                    assert pair not in applications
                    applications.add(pair)
            elif event["event_type"] == "round_resolution":
                for row in event["rejected"]:
                    better = [rank for rank in row["cutoff"] if rank < row["priority_rank"]]
                    assert len(better) == capacities[row["school"]] or row["previous_commitments"]
        assert len(applications) == result["metrics"]["applications"] <= 36
        if lesson["parameters"]["mechanism"] == "deferred":
            assert result["events"][-1]["submitted_blocking"] == []
        actual_rank = preferences["S01"].index(assignments["S01"]) + 1
        assert result["metrics"]["student_true_rank"] == actual_rank
        if action == "safe_first":
            assert submitted["S01"] != preferences["S01"]
    assert [result["metrics"]["student_true_rank"] for result in results] == (
        [2, 3, 1] if action == "truthful" else [2, 2, 2]
    )


def test_deferred_acceptance_exhaustive_tiny_truthful_dominance():
    students = ("S01", "S02", "S03")
    schools = ("A", "B", "C")
    priority = {"A": students, "B": students[1:] + students[:1], "C": students[::-1]}
    capacities = dict.fromkeys(schools, 1)
    rankings = list(permutations(schools))
    for profile in product(rankings, repeat=3):
        truthful = dict(zip(students, profile, strict=True))
        assigned, _ = match(truthful, priority, capacities, "deferred")
        assert blocking_pairs(assigned, truthful, priority, capacities) == []
        for student, order in truthful.items():
            for report in rankings:
                altered = {**truthful, student: report}
                counterfactual, _ = match(altered, priority, capacities, "deferred")
                assert order.index(assigned[student]) <= order.index(counterfactual[student])


def test_zero_seats_and_outside_choice_are_well_defined():
    told = {"S01": ("A",), "S02": ("A", "B")}
    priority = {"A": ("S02", "S01"), "B": ("S01", "S02")}
    seats = {"A": 0, "B": 1}
    assigned, rounds = match(told, priority, seats, "deferred")
    assert assigned == {"S02": "B"}
    assert len(rounds) == 2
    assert blocking_pairs(assigned, told, priority, seats) == []
