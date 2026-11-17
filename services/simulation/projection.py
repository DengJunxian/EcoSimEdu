"""Read-only metrics and paired checkpoints on case clocks."""
from __future__ import annotations

AUCTION_METRICS = [
    {"id": "last_price", "label": "最近成交价", "unit": "代币/件"},
    {"id": "volume", "label": "累计成交", "unit": "件"},
    {"id": "surplus", "label": "累计总剩余", "unit": "代币"},
]

CLOCKS = {
    "double_auction": {"axis_label": "报价轮次", "field": "round"},
    "schelling_segregation": {"axis_label": "更新轮次", "field": "round", "event_type": "round_end"},
    "svb_run": {"axis_label": "清结算轮次", "field": "round", "minimum": 1},
    "information_cascade": {"axis_label": "决策序位", "field": "turn", "event_type": "decision"},
    "public_goods": {"axis_label": "结算轮次", "field": "round", "event_type": "settlement"},
    "commons_governance": {"axis_label": "再生期", "field": "period", "event_type": "growth"},
}


def metric_registry(case):
    return AUCTION_METRICS if case["case_id"] == "double_auction" else case["metrics"]


def frame_metrics(frame):
    return frame.get("metrics", frame)


def checkpoints(case, run):
    settings = case.get("alignment") or CLOCKS.get(case["case_id"])
    if settings is None:
        return None
    event_type = settings.get("event_type")
    minimum = settings.get("minimum", 0)
    maximum = case["rounds"] - 1 if case["case_id"] == "double_auction" else None
    ticks = {}
    for event in run["result"]["events"]:
        value = event.get(settings["field"])
        if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
            continue
        if event_type is None or event["event_type"] == event_type:
            ticks[value] = event["tick"]
    return settings["axis_label"], ticks


def paired_projection(case, base, branch):
    left, right = checkpoints(case, base), checkpoints(case, branch)
    if left is None or right is None:
        return None
    axis_label, base_ticks = left
    _, branch_ticks = right
    metrics = metric_registry(case)

    def point(run, tick):
        if tick is None:
            return None
        frame = run["result"]["snapshots"][tick]
        values = frame_metrics(frame)
        return {"tick": tick, "metrics": {metric["id"]: values.get(metric["id"]) for metric in metrics}}

    rows = [{"phase": "opening", "checkpoint": None, "baseline": point(base, 0), "branch": point(branch, 0)}]
    for value in sorted(set(base_ticks) | set(branch_ticks)):
        base_tick, branch_tick = base_ticks.get(value), branch_ticks.get(value)
        if (base_tick, branch_tick) != (0, 0):
            rows.append({"phase": "checkpoint", "checkpoint": value, "baseline": point(base, base_tick),
                         "branch": point(branch, branch_tick)})
    base_end = len(base["result"]["snapshots"]) - 1
    branch_end = len(branch["result"]["snapshots"]) - 1
    last = rows[-1]
    if ((last["baseline"] or {}).get("tick"), (last["branch"] or {}).get("tick")) != (base_end, branch_end):
        rows.append({"phase": "ending", "checkpoint": None, "baseline": point(base, base_end),
                     "branch": point(branch, branch_end)})
    return {"case_id": case["case_id"], "axis_label": axis_label, "metrics": metrics, "rows": rows}


def sampled_metric(run, metric, limit):
    """Return source ticks, retaining endpoints and strongest bucket changes."""
    frames = run["result"]["snapshots"]
    points = [(frame["tick"], frame_metrics(frame).get(metric)) for frame in frames]
    if len(points) <= limit:
        return points
    # Each bucket spends at most three slots: extrema plus a gap marker.
    bucket_count = (limit - 2) // 3
    chosen = [points[0]]
    interior = points[1:-1]
    for i in range(bucket_count):
        group = interior[i * len(interior) // bucket_count:(i + 1) * len(interior) // bucket_count]
        numeric = [point for point in group if point[1] is not None]
        representatives = {min(numeric, key=lambda point: point[1]), max(numeric, key=lambda point: point[1])} if numeric else set()
        gap = next((point for point in group if point[1] is None), None)
        if gap is not None:
            representatives.add(gap)
        chosen.extend(sorted(representatives))
    return [*chosen, points[-1]]
