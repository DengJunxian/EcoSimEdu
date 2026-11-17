from services.simulation.lessons import load_case

from test_catalog import payload
from test_education_api import call


def complete(url, case, scenario="baseline", parent=None):
    body = payload(case, scenario, parent_run_id=parent)
    run_id = call(url, "/api/runs", body, 201)["run_id"]
    return call(url, f"/api/runs/{run_id}/start", {})


def test_exact_schelling_alignment_retains_missing_round(local_app):
    case = load_case("schelling_segregation")
    base = complete(local_app, case)
    other = complete(local_app, case, "zero", base["run_id"])
    path = f"/api/runs/{base['run_id']}/compare/{other['run_id']}"
    aligned = call(local_app, path)
    assert aligned["axis_label"] == "更新轮次"
    assert aligned["rows"][0]["checkpoint"] is None
    assert aligned["rows"][0]["baseline"]["tick"] == aligned["rows"][0]["branch"]["tick"] == 0
    assert any(row["branch"] is None for row in aligned["rows"][1:])
    for row in (row for row in aligned["rows"] if row["phase"] == "checkpoint"):
        for side, run in (("baseline", base), ("branch", other)):
            check = row[side]
            if check is None:
                assert all(e.get("round") != row["checkpoint"] or e["event_type"] != "round_end"
                           for e in run["result"]["events"])
            else:
                event = run["result"]["events"][check["tick"]]
                assert event["round"] == row["checkpoint"] and event["event_type"] == "round_end"
                assert check["metrics"] == run["result"]["snapshots"][check["tick"]]["metrics"]
    forbidden = complete(local_app, case)
    path = f"/api/runs/{base['run_id']}/compare/{forbidden['run_id']}"
    assert call(local_app, path, status=409)["detail"] == "RUNS_NOT_PAIRED"


def test_svb_and_cascade_synchronize_different_event_indices(local_app):
    for case_id, scenario, field in (
        ("svb_run", "network", "round"), ("information_cascade", "verified", "turn"),
    ):
        case = load_case(case_id)
        base = complete(local_app, case)
        other = complete(local_app, case, scenario, base["run_id"])
        aligned = call(local_app, f"/api/runs/{base['run_id']}/compare/{other['run_id']}")
        shared = [row for row in aligned["rows"] if row["phase"] == "checkpoint" and row["baseline"] and row["branch"]]
        assert any(row["baseline"]["tick"] != row["branch"]["tick"] for row in shared)
        assert all(row["checkpoint"] == base["result"]["events"][row["baseline"]["tick"]][field]
                   == other["result"]["events"][row["branch"]["tick"]][field] for row in shared)


def test_sampled_ticks_map_to_original_snapshots_and_keep_bounds(local_app):
    run = complete(local_app, load_case("schelling_segregation"))
    path = f"/api/runs/{run['run_id']}"
    projection = call(local_app, path + "/metrics/similarity?limit=23")
    frames = run["result"]["snapshots"]
    points = projection["points"]
    assert len(points) <= 23 < projection["total_points"]
    assert [point["tick"] for point in points] == sorted({point["tick"] for point in points})
    assert points[0]["tick"] == 0 and points[-1]["tick"] == len(frames) - 1
    assert {min(frame["metrics"]["similarity"] for frame in frames),
            max(frame["metrics"]["similarity"] for frame in frames)} <= {point["value"] for point in points}
    for point in points:
        assert point["value"] == frames[point["tick"]]["metrics"]["similarity"]
    tick = points[len(points) // 2]["tick"]
    trace = call(local_app, path + f"/trace/{tick}")
    assert trace["after"]["metrics"]["similarity"] == frames[tick]["metrics"]["similarity"]
    assert call(local_app, path + "/metrics/not_a_metric", status=404)["detail"] == "METRIC_NOT_AVAILABLE"


def test_terminal_outcomes_and_initial_patch_are_preserved(local_app):
    for case_id, scenario, metric, expected in (
        ("lemons_market", "informed", "traded", (6, 30)),
        ("school_matching", "expanded", "student_true_rank", (2, 1)),
        ("information_cascade", "private", "correct_pct", (0, 50)),
    ):
        case = load_case(case_id)
        base = complete(local_app, case)
        other = complete(local_app, case, scenario, base["run_id"])
        aligned = call(local_app, f"/api/runs/{base['run_id']}/compare/{other['run_id']}")
        last = aligned["rows"][-1]
        assert last["phase"] == "ending" and last["checkpoint"] is None
        assert (last["baseline"]["metrics"][metric], last["branch"]["metrics"][metric]) == expected
        assert last["baseline"]["tick"] == base["result"]["events"][-1]["tick"]
        assert last["branch"]["tick"] == other["result"]["events"][-1]["tick"]
        if case_id == "school_matching":
            assert base["result"]["root_hash"] == other["result"]["root_hash"]
            assert base["result"]["initial_hash"] != other["result"]["initial_hash"]
            assert other["result"]["initial"]["capacities"]["A"] == 5
