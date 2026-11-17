"""Read-only teaching projections over the SVB model's existing state and events."""

from .svb import _depositors, _neighbors


def briefing(case):
    """Expose the student's pre-decision information from the model's initial draws."""
    seed = case["seed"]
    actor = case["player_id"]
    people = _depositors(seed)
    baseline = next(scenario["parameters"] for scenario in case["scenarios"]
                    if scenario["id"] == "baseline")
    neighbors = _neighbors(people, seed, baseline["network"])
    person = people[actor]
    return {
        "actor_id": actor, "group": person["group"], "deposit": person["deposit"],
        "payroll": person["payroll"], "protected": person["protected"],
        "neighbors": list(neighbors[actor]), "steps": case["rules"]["steps"],
        "old_price": case["rules"]["initial_price"], "new_price": case["rules"]["shocked_price"],
    }


def _positive_equity_queue(events, frames):
    for event, frame in zip(events, frames, strict=True):
        if event["event_type"] == "queue" and frame["metrics"]["queued"] > 0 and frame["metrics"]["equity"] > 0:
            return event["tick"]
    return None


def checkpoint(run):
    result = run["result"]
    return _positive_equity_queue(result["events"], result["snapshots"])


def details(run, tick):
    result = run["result"]
    events = result["events"][:tick + 1]
    frames = result["snapshots"][:tick + 1]
    return {
        "checkpoint": _positive_equity_queue(events, frames),
        "network": result["initial"]["network"],
        "series": [
            {"tick": event["tick"], "round": event["round"],
             **{metric: frame["metrics"][metric] for metric in ("cash", "equity", "queued")}}
            for event, frame in zip(events, frames, strict=True)
        ],
    }
