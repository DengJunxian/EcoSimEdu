"""Student-proposing deferred acceptance and immediate acceptance."""

import random

from .auction import digest

STUDENT = "S01"
SCHOOLS = ("A", "B", "C")


def match(submitted, priorities, capacities, mechanism):
    if mechanism not in {"deferred", "immediate"}:
        raise ValueError("Unknown admissions mechanism")
    next_choice = dict.fromkeys(submitted, 0)
    held = {school: [] for school in capacities}
    rank = {school: {student: i + 1 for i, student in enumerate(order)}
            for school, order in priorities.items()}
    rounds = []
    while True:
        assigned = {student for students in held.values() for student in students}
        proposals = {student: order[next_choice[student]] for student, order in submitted.items()
                     if student not in assigned and next_choice[student] < len(order)}
        if not proposals:
            return {student: school for school, students in held.items() for student in students}, rounds
        for student in proposals:
            next_choice[student] += 1
        before = {school: list(students) for school, students in held.items()}
        rejected = []
        for school, limit in capacities.items():
            arriving = [student for student, choice in proposals.items() if choice == school]
            committed = held[school] if mechanism == "immediate" else []
            candidates = arriving + ([] if mechanism == "immediate" else held[school])
            ordered = sorted(candidates, key=rank[school].__getitem__)
            available = limit - len(committed)
            held[school] = committed + ordered[:available]
            for student in ordered[available:]:
                rejected.append({
                    "student": student, "school": school, "priority_rank": rank[school][student],
                    "was_held": student in before[school], "cutoff": [rank[school][s] for s in held[school]],
                    "previous_commitments": list(committed),
                })
        rounds.append({
            "proposals": proposals, "before": before,
            "held": {school: list(students) for school, students in held.items()}, "rejected": rejected,
        })


def blocking_pairs(assignments, preferences, priorities, capacities):
    occupants = {school: {student for student, assigned in assignments.items() if assigned == school}
                 for school in capacities}
    pairs = []
    for student, order in preferences.items():
        for school in order:
            if school == assignments.get(student):
                break
            candidates = occupants[school]
            ranks = priorities[school]
            index = ranks.index(student)
            lower = [admitted for admitted in ranks[index + 1:] if admitted in candidates]
            if lower or len(candidates) < capacities[school]:
                pairs.append({"student": student, "school": school, "lower_priority": lower,
                              "empty_seat": len(candidates) < capacities[school]})
    return pairs


def _profile(seed):
    rng = random.Random(seed)
    anchors = {"A": ["S04", "S05", "S06"], "B": ["S07", "S08", "S09"], "C": ["S10", "S11", "S12"]}
    pivot = {"A": ["S02", "S03", "S01"], "B": ["S01", "S02", "S03"], "C": ["S03", "S01", "S02"]}
    preferences = {"S01": ["A", "B", "C"], "S02": ["B", "A", "C"], "S03": ["A", "B", "C"]}
    for school, students in anchors.items():
        other = [choice for choice in SCHOOLS if choice != school]
        for student in students:
            preferences[student] = [school, *rng.sample(other, len(other))]
    prior = {}
    for school in SCHOOLS:
        tail = [student for student in preferences if student not in anchors[school] + pivot[school]]
        prior[school] = rng.sample(anchors[school], 3) + pivot[school] + rng.sample(tail, len(tail))
    return preferences, prior


def simulate(case, scenario_id, seed, action):
    if action not in {"truthful", "safe_first"}:
        raise ValueError("Unknown school submission choice")
    parameters = next(s["parameters"] for s in case["scenarios"] if s["id"] == scenario_id)
    mechanism = parameters["mechanism"]
    true, priorities = _profile(seed)
    submitted = dict(true)
    if action == "safe_first":
        submitted[STUDENT] = ["B", "A", "C"]
    root = {"seed": seed, "true_preferences": true, "priorities": priorities,
               "base_capacities": dict.fromkeys(SCHOOLS, 4), "student": STUDENT}
    capacities = dict(root["base_capacities"])
    capacities["A"] += parameters["extra_a_seats"]
    initial = {**root, "capacities": capacities, "submitted_preferences": submitted}
    assignments, rounds = match(submitted, priorities, capacities, mechanism)
    events, snapshots = [], []
    application_seq = {}
    held = {school: [] for school in SCHOOLS}
    metrics = {
        "applications": 0, "rejections": 0, "first_true_choice": None, "student_true_rank": None,
        "submitted_blocking_pairs": None, "true_blocking_pairs": None,
    }

    def record(event_type, summary, *, actors=(), relations=(), **fields):
        index = len(events)
        events.append({
            "seq": index, "tick": index, "event_type": event_type,
            "summary": summary, "actors": list(actors), **fields,
        })
        spots = {student: school for school, students in held.items() for student in students}
        student_status = "最终入学" if event_type == "final_assignment" else (
            "暂留学校" if mechanism == "deferred" else "已确认学校"
        )
        entities = {
            student: {"真实偏好": " > ".join(true[student]), "提交志愿": " > ".join(submitted[student]),
                      student_status: spots.get(student)}
            for student in true
        }
        entities.update({
            school: {"容量": capacities[school], "席位名单": "、".join(held[school]),
                     "学校优先序": " > ".join(priorities[school])}
            for school in SCHOOLS
        })
        snapshots.append({"tick": index, "metrics": dict(metrics), "entities": entities, "relations": list(relations)})

    record("admissions_open", "12 名学生提交排序。每所学校按固定优先序和本场席位容量处理申请。",
           actors=[STUDENT], submitted=submitted, capacities=capacities)
    for number, result in enumerate(rounds, start=1):
        proposals = result["proposals"]
        origin = len(events)
        metrics["applications"] += len(proposals)
        application_seq.update({(student, school): origin for student, school in proposals.items()})
        record(
            "round_proposals", f"第 {number} 轮，新收到 {len(proposals)} 份申请。",
            actors=proposals,
            relations=[{"from": student, "to": school, "label": "提交申请"} for student, school in proposals.items()],
            round=number, proposals=proposals,
        )
        held = result["held"]
        rejected = result["rejected"]
        metrics["rejections"] += len(rejected)
        status = "暂留" if mechanism == "deferred" else "确认录取"
        held_total = sum(map(len, held.values()))
        rejected_edges = [
            {"from": row["school"], "to": row["student"], "label":
             f"拒绝，校内优先名次 {row['priority_rank']}，保留名次 {','.join(map(str, row['cutoff'])) or '无'}",
             "origin_seq": application_seq[row["student"], row["school"]]}
            for row in rejected
        ]
        acceptance_edges = [
            {"from": school, "to": student, "label": status, "origin_seq": application_seq[student, school]}
            for school, students in held.items() for student in students
        ]
        record(
            "round_resolution", f"第 {number} 轮处理后，{held_total} 人获得{status}，本轮拒绝 {len(rejected)} 份申请。",
            actors=[row["student"] for row in rejected], relations=rejected_edges + acceptance_edges, round=number,
            before=result["before"], held=held, rejected=rejected,
        )

    submitted_blocks = blocking_pairs(assignments, submitted, priorities, capacities)
    true_blocks = blocking_pairs(assignments, true, priorities, capacities)
    student_school = assignments.get(STUDENT)
    metrics.update(
        first_true_choice=sum(school == true[student][0] for student, school in assignments.items()),
        student_true_rank=true[STUDENT].index(student_school) + 1 if student_school else None,
        submitted_blocking_pairs=len(submitted_blocks), true_blocking_pairs=len(true_blocks),
    )
    record(
        "final_assignment", f"{len(assignments)} 位学生分配到学校。按提交志愿有 {len(submitted_blocks)} 个阻挡对，"
        f"按真实偏好有 {len(true_blocks)} 个。S01：{student_school or '未分配'}。",
        actors=[STUDENT],
        relations=[{"from": pair["student"], "to": pair["school"], "label": "按提交志愿的阻挡对"}
                   for pair in submitted_blocks] +
                  [{"from": pair["student"], "to": pair["school"], "label": "按真实偏好的阻挡对"}
                   for pair in true_blocks],
        assignments=assignments, submitted_blocking=submitted_blocks, true_blocking=true_blocks,
    )
    return {
        "engine_version": "school-matching/1", "initial": initial, "root_hash": digest(root),
        "initial_hash": digest(initial), "intervention": parameters, "events": events, "snapshots": snapshots,
        "metrics": snapshots[-1]["metrics"],
    }
