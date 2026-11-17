from collections import Counter
from itertools import combinations

import pytest

from services.simulation.auction import digest
from services.simulation.lessons import load_case
from services.simulation import schelling

CASE = load_case("schelling_segregation")


def independent_counts(grid, size, index):
    row, column = divmod(index, size)
    adjacent = [resident for other, resident in enumerate(grid) if resident and other != index
                and abs(row - other // size) <= 1 and abs(column - other % size) <= 1]
    return sum(resident[0] == grid[index][0] for resident in adjacent), len(adjacent)


@pytest.mark.parametrize("scenario, threshold", [("baseline", 30), ("zero", 0), ("higher", 50)])
def test_relocation_replays_and_recomputes(scenario, threshold):
    result = schelling.simulate(CASE, scenario, 1971, "move")
    assert digest(result) == digest(schelling.simulate(CASE, scenario, 1971, "move"))
    before = result["initial"]["grid"]
    initial_counts = Counter(before)
    assert initial_counts[None] == 60
    assert Counter(resident[0] for resident in before if resident) == {"A": 170, "B": 170}
    moves = 0
    for event, frame in zip(result["events"], result["snapshots"], strict=True):
        after = frame["grid"]["cells"]
        assert Counter(after) == initial_counts
        assert event["tick"] == frame["tick"]
        if event["event_type"] in {"move", "student_move"}:
            origin, dest = event["origin"], event["destination"]
            assert before[origin] == event["actor_id"] == after[dest]
            assert before[dest] is None and after[origin] is None
            assert {i for i, (a, b) in enumerate(zip(before, after)) if a != b} == {origin, dest}
            origin_counts = independent_counts(before, 20, origin)
            dest_counts = independent_counts(after, 20, dest)
            assert list(origin_counts) == event["before"]
            assert list(dest_counts) == event["after"]
            affected = {
                resident for index, resident in enumerate(before)
                if resident and resident != event["actor_id"] and
                any(abs(index // 20 - marked // 20) <= 1 and abs(index % 20 - marked % 20) <= 1
                    for marked in (origin, dest))
            }
            assert {change["actor"] for change in event["changed_neighbors"]} == affected
            for change in event["changed_neighbors"]:
                actor_index = before.index(change["actor"])
                assert actor_index == after.index(change["actor"])
                assert change["before"] == independent_counts(before, 20, actor_index)
                assert change["after"] == independent_counts(after, 20, actor_index)
            if event["event_type"] == "move":
                assert 100 * origin_counts[0] < threshold * origin_counts[1]
                assert 100 * dest_counts[0] >= threshold * dest_counts[1]
            moves += 1
        else:
            assert before == after
        assert frame["metrics"]["moves"] == moves
        before = after

    occupied = [(i, name) for i, name in enumerate(before) if name is not None]
    edges = [(a, b) for (i, a), (j, b) in combinations(occupied, 2) if
             abs(i // 20 - j // 20) <= 1 and abs(i % 20 - j % 20) <= 1]
    rate = round(100 * sum(a[0] == b[0] for a, b in edges) / len(edges), 2)
    assert result["metrics"]["similarity"] == rate
    if threshold == 0:
        assert moves == 1


def test_no_empty_neighbors_or_available_moves(monkeypatch):
    assert schelling.counts(["A001", None, None, None], 2, 0, "A001") == (0, 0)
    assert schelling.satisfied((0, 0), 100)
    full = {"size": 2, "grid": ["A001", "B001", "A002", "B002"], "student_target": None}
    monkeypatch.setattr(schelling, "initial_board", lambda _: full)
    run = schelling.simulate(CASE, "higher", 0, "move")
    assert run["events"][1]["event_type"] == "student_blocked"
    assert run["events"][-1]["terminal"] == "blocked"
    assert run["metrics"]["moves"] == 0 and run["metrics"]["remaining"] == 4



def test_round_limit_preserves_unsatisfied_population(monkeypatch):
    monkeypatch.setattr(schelling, "ROUNDS", 1)
    run = schelling.simulate(CASE, "higher", CASE["seed"], "stay")
    assert run["events"][-1]["terminal"] == "round_limit"
    assert run["metrics"]["remaining"] > 0


def test_small_rule_practice_counts_empty_center_edge_and_prospective_vacancy():
    grid = ["A002", "B001", None, "B002", "A001", "A003", "B003", None, "B004"]
    profile = schelling.counts(grid, 3, 4, "A001")
    assert profile == (2, 6)
    assert schelling.satisfied(profile, 30)
    assert not schelling.satisfied(profile, 50)
    assert schelling.counts(grid, 3, 0, "A002") == (1, 3)
    assert schelling.counts(grid, 3, 2, "A001", excluded=4) == (1, 2)
