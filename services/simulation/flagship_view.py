"""Reveal-bounded reads of published classroom runs."""
from .lessons import CATALOG, load_case
from .projection import CLOCKS

FIELDS = ("run_id", "case_id", "case_version", "result_hash", "scenario_id",
          "origin", "seed", "action", "parent_run_id")

CLASSROOMS = set(CATALOG) - {"double_auction"}


def project_flagship(run, tick=0, *, review=False):
    result = run["result"]
    frames = result["snapshots"]
    events = result["events"]
    case_id = run["case_id"]
    definition = load_case(case_id)
    alignment = definition.get("alignment") or CLOCKS.get(case_id, {})
    clock_field = alignment.get("field")
    focus_event = definition["checkpoint"]["event_type"]
    is_svb = case_id == "svb_run"
    last = len(frames) - 1
    if tick == "close":
        tick = last
    elif tick == "checkpoint":
        if is_svb:
            from .svb_view import checkpoint

            match = checkpoint(run)
        else:
            match = next((event["tick"] for event in events if event["event_type"] == focus_event), None)
        tick = match if match is not None else last
    if not 0 <= tick <= last:
        raise IndexError(tick)
    event = events[tick]
    visible_end = last if review else tick
    details = None
    if is_svb:
        from .svb_view import details as svb_details

        details = svb_details(run, tick)
    view = {
        **{key: run[key] for key in FIELDS},
        **{key: result[key] for key in ("engine_version", "root_hash", "initial_hash", "intervention")},
        "tick": tick, "closed": tick == last, "end": last if review or tick == last else None,
        "clock": event.get(clock_field),
        "clock_label": alignment.get("axis_label"),
        "frame": frames[tick], "previous": frames[tick - 1] if tick else None,
        "checkpoint_here": (details["checkpoint"] == tick if details is not None else
                            event["event_type"] == focus_event and not any(
                                previous["event_type"] == focus_event for previous in events[:tick]
                            )),
        "events": events[:visible_end + 1],
        "series": [{"metrics": frame["metrics"]} for frame in frames[:visible_end + 1]],
        "details": details,
    }
    if case_id == "information_cascade":
        from .cooperation_view import cascade_visibility

        return cascade_visibility(view)
    if case_id == "lemons_market" and review and not view["closed"]:
        view["events"] = [
            {key: value for key, value in record.items() if key not in {"transactions", "status", "summary"}}
            | {"summary": "到达交割时点后揭示交割清单。"}
            if record["event_type"] == "settlement" else record for record in view["events"]
        ]
        view["series"] = [
            {"metrics": {**point["metrics"], "net_surplus": None, "traded": None}} if index > tick else point
            for index, point in enumerate(view["series"])
        ]
    return view
