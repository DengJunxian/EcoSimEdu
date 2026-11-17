"""Seeded, sequential relocation on a bounded Moore grid."""
from functools import lru_cache
from random import Random

from .auction import digest

SIZE = 20
ROUNDS = 8


@lru_cache
def neighborhood(size, cell):
    row, col = divmod(cell, size)
    return tuple(
        r * size + c
        for r in range(max(0, row - 1), min(size, row + 2))
        for c in range(max(0, col - 1), min(size, col + 2))
        if (r, c) != (row, col)
    )


def adjacent(grid, size, cell, excluded=None):
    return [grid[i] for i in neighborhood(size, cell) if grid[i] is not None and i != excluded]


def counts(grid, size, cell, resident, excluded=None):
    neighbors = adjacent(grid, size, cell, excluded)
    return sum(neighbor[0] == resident[0] for neighbor in neighbors), len(neighbors)


def satisfied(local, threshold):
    same, total = local
    return 100 * same >= threshold * total


def score(grid, size, threshold, moves):
    profiles = [counts(grid, size, cell, resident) for cell, resident in enumerate(grid) if resident]
    matched = sum(satisfied(profile, threshold) for profile in profiles)
    edges = sum(total for _, total in profiles)
    return {
        "satisfied": round(100 * matched / len(profiles), 2) if profiles else None,
        "similarity": round(100 * sum(same for same, _ in profiles) / edges, 2) if edges else None,
        "moves": moves,
        "remaining": len(profiles) - matched,
    }


def initial_board(seed):
    size = SIZE
    residents = [f"{group}{i:03}" for group in "AB" for i in range(1, 171)]
    grid = residents + [None] * (size * size - len(residents))
    rng = Random(seed)
    rng.shuffle(grid)
    target = rng.choice([i for i, cell in enumerate(grid) if cell is None])
    return {"size": size, "grid": grid, "student_target": target}


def simulate(case, scenario_id, seed, action):
    intervention = next(s["parameters"] for s in case["scenarios"] if s["id"] == scenario_id)
    threshold = intervention["threshold"]
    initial = initial_board(seed)
    size = initial["size"]
    grid = initial["grid"].copy()
    cells = {resident: i for i, resident in enumerate(grid) if resident}
    vacancies = set(range(len(grid))) - set(cells.values())
    order = sorted(cells)
    events, snapshots = [], []
    moves = 0

    def emit(event_type, summary, actors=(), marked=(), **payload):
        seq = len(events)
        events.append({"seq": seq, "tick": seq, "event_type": event_type, "summary": summary,
                       "actors": list(actors), **payload})
        entities = {}
        for actor in actors:
            cell = cells[actor]
            same, total = counts(grid, size, cell, actor)
            row, col = divmod(cell, size)
            entities[actor] = {"群体": actor[0], "行": row + 1, "列": col + 1, "同组邻居": same,
                               "已占邻居": total, "达到阈值": satisfied((same, total), threshold)}
        snapshots.append({"tick": seq, "metrics": score(grid, size, threshold, moves), "entities": entities,
                          "grid": {"size": size, "cells": grid.copy(), "marked": list(marked)}})

    def relocate(resident, dest, source, round_no):
        nonlocal moves
        old = cells[resident]
        before = counts(grid, size, old, resident)
        affected = set(adjacent(grid, size, old) + adjacent(grid, size, dest)) - {resident}
        old_neighbors = {actor: counts(grid, size, cells[actor], actor) for actor in affected}
        grid[old], grid[dest] = None, resident
        cells[resident] = dest
        vacancies.remove(dest)
        vacancies.add(old)
        after = counts(grid, size, dest, resident)
        changes = [{"actor": actor, "before": old_neighbors[actor], "after": counts(grid, size, cells[actor], actor)}
                   for actor in sorted(affected)]
        moves += 1
        emit("student_move" if source == "student" else "move",
             f"{resident} 搬迁。同组邻居由 {before[0]}/{before[1]} 变为 {after[0]}/{after[1]}，"
             f"原址与新址共有 {len(affected)} 名其他居民的邻居集合受到影响。",
             [resident, *sorted(affected)], [old, dest], actor_id=resident, source=source, round=round_no,
             origin=old, destination=dest, before=list(before), after=list(after), changed_neighbors=changes)

    target = initial["student_target"]
    marked = [cells["A001"]] + ([target] if target is not None else [])
    emit("opening", f"社区共有 {len(cells)} 户，最低同类比例为 {threshold}%。", ["A001"], marked)
    if action == "move" and target in vacancies:
        relocate("A001", target, "student", 0)
    elif action == "move":
        emit("student_blocked", "没有可供 A001 迁入的预留空位。", ["A001"], marked)
    else:
        emit("student_stay", "A001 留在原地。", ["A001"], marked)

    terminal = "round_limit"
    for round_no in range(1, ROUNDS + 1):
        ranked = order.copy()
        Random(f"{seed}:visit:{round_no}").shuffle(ranked)
        moved_before = moves
        for resident in ranked:
            cell = cells[resident]
            if satisfied(counts(grid, size, cell, resident), threshold):
                continue
            candidates = sorted(vacancies)
            Random(f"{seed}:search:{round_no}:{resident}").shuffle(candidates)
            dest = next((i for i in candidates if satisfied(counts(grid, size, i, resident, cell), threshold)), None)
            if dest is not None:
                relocate(resident, dest, "rule", round_no)
        emit("round_end", f"第 {round_no} 轮结束，本轮迁居 {moves - moved_before} 次。", round=round_no)
        if snapshots[-1]["metrics"]["remaining"] == 0:
            terminal = "all_satisfied"
            break
        if moves == moved_before:
            terminal = "blocked"
            break

    message = {"all_satisfied": "所有居民达到各自阈值。", "blocked": "无可行搬迁，仍有未达阈值的居民。",
               "round_limit": "达到轮数上限，地图尚未稳定。"}[terminal]
    emit("market_close", message, terminal=terminal)
    return {"engine_version": "schelling/1", "initial": initial, "root_hash": digest(initial),
            "initial_hash": digest(initial), "intervention": intervention, "events": events,
            "snapshots": snapshots, "metrics": snapshots[-1]["metrics"]}
