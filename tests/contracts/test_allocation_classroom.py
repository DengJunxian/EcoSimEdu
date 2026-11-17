from uuid import uuid4

import pytest

from services.simulation.auction import BOUNDARIES
from services.simulation.lesson_scenes import load_lesson_scenes
from services.simulation.lessons import load_case, simulate
from test_education_api import call


@pytest.mark.parametrize(("case_id", "branch"), [
    ("lemons_market", "informed"), ("school_matching", "immediate"), ("beer_game", "shorter"),
])
def test_allocation_classrooms_read_rule_runs_and_boundaries(local_app, case_id, branch):
    case = load_case(case_id)
    baseline_id = str(uuid4())
    for scenario in ("baseline", branch, "boundary"):
        run_id = baseline_id if scenario == "baseline" else str(uuid4())
        action = BOUNDARIES[case_id]["action"] if scenario == "boundary" else case["action"]["default"]
        call(local_app, "/api/runs", {
            "request_id": run_id, "case_id": case_id, "scenario_id": scenario,
            "seed": case["seed"], "action": action, "provider_kind": "rule",
            "parent_run_id": baseline_id if scenario == branch else None,
        }, status=201)
        call(local_app, f"/api/runs/{run_id}/start?manifest_only=true", {})
        observed = call(local_app, f"/api/runs/{run_id}/classroom-view?tick=close")
        expected = simulate(case, scenario, case["seed"], action)
        assert observed["closed"] and observed["engine_version"] == expected["engine_version"]
        assert observed["frame"] == expected["snapshots"][-1]
        assert observed["events"] == expected["events"]
        if scenario == branch:
            pair = call(local_app, f"/api/runs/{baseline_id}/compare/{run_id}")
            assert pair["rows"][-1]["branch"]["tick"] == observed["tick"]
        if scenario == "boundary":
            if case_id == "lemons_market":
                assert all(event["event_type"] != "certification" for event in observed["events"])
                assert observed["frame"]["metrics"]["certification_cost"] == 0
            elif case_id == "school_matching":
                assert observed["events"][0]["capacities"]["A"] == 0
                assert "A" not in observed["events"][-1]["assignments"].values()
            else:
                assert observed["frame"]["metrics"]["factory_variance_ratio"] is None

    scenes = load_lesson_scenes(case_id)["scenes"]
    assert len(scenes) == 7
    assert {question["kind"] for scene in scenes for question in scene["questions"]} == {"concept", "prediction"}
