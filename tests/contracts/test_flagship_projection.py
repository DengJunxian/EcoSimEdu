from uuid import uuid4

import pytest

from services.simulation.auction import digest
from services.simulation.lessons import load_case
from test_education_api import call


def launch(url, case_id, scenario="baseline", parent=None, seed=None, action=None):
    case = load_case(case_id)
    request_id = str(uuid4())
    receipt = call(url, "/api/runs", {
        "request_id": request_id, "case_id": case_id, "scenario_id": scenario, "provider_kind": "rule",
        "seed": case["seed"] if seed is None else seed,
        "action": case["action"]["default"] if action is None else action, "parent_run_id": parent,
    }, status=201)
    assert receipt["run_id"] == request_id
    manifest = call(url, f"/api/runs/{request_id}/start?manifest_only=true", {})
    assert "result" not in manifest
    return request_id


@pytest.mark.parametrize("case_id", ["svb_run", "schelling_segregation"])
def test_guided_projection_and_round_compare_preserve_verified_sources(local_app, case_id):
    case = load_case(case_id)
    base = launch(local_app, case_id)
    branch = launch(local_app, case_id, case["scenarios"][1]["id"], base)
    get = lambda route: call(local_app, route)
    route = f"/api/runs/{base}/classroom-view"
    opening, source = get(route), get(f"/api/runs/{base}")
    assert opening["tick"] == 0 and opening["end"] is None and opening["previous"] is None
    assert len(opening["events"]) == len(opening["series"]) == 1
    assert not opening["checkpoint_here"]
    assert opening["result_hash"] == source["result_hash"] == digest(source["result"])
    proof = get(route + "?tick=checkpoint")
    assert not proof["closed"] and proof["checkpoint_here"]
    assert proof["frame"] == source["result"]["snapshots"][proof["tick"]]
    assert proof["previous"] == source["result"]["snapshots"][proof["tick"] - 1]
    review = get(route + "?mode=review")
    assert len(review["events"]) == len(review["series"]) == review["end"] + 1
    assert {event["tick"] for event in proof["events"]} == set(range(proof["tick"] + 1))
    assert call(local_app, route + "?tick=-1", status=404)["detail"] == "SNAPSHOT_NOT_AVAILABLE"
    alignment = get(f"/api/runs/{base}/compare/{branch}")
    row = next(point for point in alignment["rows"] if point["phase"] == "checkpoint" and point["baseline"] and point["branch"])
    left = get(route + f"?tick={row['baseline']['tick']}")
    right = get(f"/api/runs/{branch}/classroom-view?tick={row['branch']['tick']}")
    assert left["root_hash"] == right["root_hash"]
    assert left["clock"] == right["clock"] == row["checkpoint"]
    if case_id == "svb_run":
        assert all(event["pending"] for event in review["events"] if event["event_type"] == "queue")
        assert proof["tick"] == 9 and proof["clock"] == 2
        cash, queued, equity = (proof["frame"]["metrics"][metric] for metric in ("cash", "queued", "equity"))
        assert (cash, queued, equity) == (0, 107, 155)
        assert left["initial_hash"] != right["initial_hash"]
        terminal = alignment["rows"][-1]
        assert terminal["phase"] == "ending"
        assert alignment["rows"][-2]["checkpoint"] == 20
        assert terminal["baseline"]["tick"] > alignment["rows"][-2]["baseline"]["tick"]
    else:
        assert proof["events"][-1]["event_type"] == "move"
        assert left["initial_hash"] == right["initial_hash"]
        assert left["intervention"]["threshold"] == 30 and right["intervention"]["threshold"] == 0
        fallback = get(f"/api/runs/{branch}/classroom-view?tick=checkpoint")
        assert fallback["closed"] and not fallback["checkpoint_here"]
        assert not any(event["event_type"] == "move" for event in fallback["events"])
