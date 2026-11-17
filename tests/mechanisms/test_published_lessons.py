"""Every offered student action must leave a usable offline learning path."""
from unittest.mock import patch

import pytest

from services.simulation.lessons import CATALOG, load_case, simulate
from services.simulation.projection import paired_projection


@pytest.mark.parametrize("case_id", CATALOG[1:])
def test_offered_actions_keep_evidence_and_clock_valid(case_id):
    case = load_case(case_id)
    allowed = set(case["evidence_types"])
    with patch("socket.socket.connect", side_effect=AssertionError("network in lesson model")):
        for action in case["action"]["options"]:
            runs = [
                simulate(case, scenario["id"], case["seed"], action["id"])
                for scenario in case["scenarios"]
            ]
            assert any(e["event_type"] == case["checkpoint"]["event_type"] and e["tick"] > 0 for e in runs[0]["events"])
            assert len({run["root_hash"] for run in runs}) == 1
            for run in runs:
                assert sum(event["event_type"] in allowed for event in run["events"]) >= case["minimum_evidence"]
                assert all(tick == event["seq"] == event["tick"] == frame["tick"]
                           for tick, (event, frame) in enumerate(zip(run["events"], run["snapshots"], strict=True)))
                for frame in run["snapshots"]:
                    assert all(0 <= edge["origin_seq"] <= frame["tick"] for edge in frame.get("relations", [])
                               if "origin_seq" in edge)
            for branch in runs[1:]:
                paired = paired_projection(case, {"result": runs[0]}, {"result": branch})
                assert len(paired["rows"]) > 1
                assert any(row["baseline"] and row["branch"] for row in paired["rows"][1:])
