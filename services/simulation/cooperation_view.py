"""Classroom visibility and pre-decision observation for the cascade."""
from .cascade import STUDENT_TURN, simulate

STUDENT = f"D{STUDENT_TURN:02d}"
PRIVATE_FIELDS = {"私人抽样", "私信号纳入后 A 箱概率（%）"}
PRIVATE_EVENT_FIELDS = {"signal", "signal_id", "private_a_after_pct"}


def cascade_briefing(case):
    events = simulate(case, "baseline", case["seed"], case["action"]["default"])["events"]
    earlier = [event for event in events if event["event_type"] == "decision"
               and event["turn"] < STUDENT_TURN]
    student = next(event for event in events if event["event_type"] == "decision"
                   and event["turn"] == STUDENT_TURN)
    return {
        "signal": student["signal"],
        "prior": student["public_a_before_pct"],
        "public_actions": [
            {"actor": event["actors"][0], "choice": event["choice"]}
            for event in earlier if event["actors"][0] in student["visible_action_ids"]
        ],
    }


def cascade_visibility(view):
    if view["closed"]:
        return view

    def event_visible(event):
        if event["event_type"] == "reveal":
            return {key: event[key] for key in ("seq", "tick", "event_type", "actors")} | {
                "summary": "到达此事件后揭晓箱子和猜对人数。",
            }
        if event["event_type"] == "decision" and STUDENT not in event["actors"]:
            return {key: value for key, value in event.items() if key not in PRIVATE_EVENT_FIELDS}
        return event

    def frame_visible(frame):
        if frame is None:
            return None
        return {
            **frame,
            "entities": {
                actor: state if actor == STUDENT else
                {key: value for key, value in state.items() if key not in PRIVATE_FIELDS}
                for actor, state in frame["entities"].items()
            },
        }

    return {
        **view,
        "frame": frame_visible(view["frame"]),
        "previous": frame_visible(view["previous"]),
        "events": [event_visible(event) for event in view["events"]],
        "series": [{"metrics": {**point["metrics"], "correct_pct": None}} for point in view["series"]],
    }
