import json
from pathlib import Path

from jsonschema import Draft202012Validator

from test_education_api import call
from test_flagship_projection import launch


def test_schelling_trace_uses_actual_move_and_bounded_run_evidence(local_app):
    key = launch(local_app, "schelling_segregation")
    stored = call(local_app, f"/api/runs/{key}/export")
    result = stored["result"]
    event = next(event for event in result["events"] if event["event_type"] == "move")
    seq = event["seq"]
    endpoint = f"/api/emergence/runs/{key}/trace"
    assert call(local_app, endpoint + f"?seq={seq}&as_of_seq={seq - 1}",
                status=422)["detail"] == "FOCUS_NOT_VISIBLE"
    trace = call(local_app, endpoint + f"?seq={seq}&as_of_seq={seq}")
    schema_file = Path(__file__).resolve().parents[2] / "schemas/emergence_trace.schema.json"
    Draft202012Validator(json.loads(schema_file.read_text())).validate(trace)
    assert trace["focus"] == {"event_seq": seq, "clock": "round", "economic_time": event["round"],
                               "metric_id": "similarity"}
    assert trace["evidence_level"] == "exact_identity"
    assert trace["as_of_seq"] == seq and trace["result_hash"] == stored["result_hash"]
    assert {node["actor_id"] for node in trace["nodes"] if node["kind"] == "relation"} == {
        neighbor["actor"] for neighbor in event["changed_neighbors"]
    }
    metrics = [node for node in trace["nodes"] if node["kind"] == "system_metric"]
    assert [(node["metric_id"], node["source_refs"][0]["seq"], node["value"]) for node in metrics] == [
        (metric, tick, result["snapshots"][tick]["metrics"][metric])
        for tick in (seq - 1, seq) for metric in ("similarity", "satisfied")
    ]
    for item in trace["nodes"] + trace["edges"]:
        for ref in item["source_refs"]:
            assert (ref["run_id"], ref["result_hash"]) == (key, stored["result_hash"])
            assert ref["seq"] <= seq and ref["event_type"] == result["events"][ref["seq"]]["event_type"]
    opening = call(local_app, endpoint + "?seq=0&as_of_seq=0")
    assert opening["evidence_level"] == "partial"
    assert all(edge["kind"] != "model_rule" for edge in opening["edges"])
    assert call(local_app, endpoint + f"?seq={seq}&as_of_seq=9999",
                status=404)["detail"] == "SNAPSHOT_NOT_AVAILABLE"


def test_role_lens_shares_run_focus_without_showing_the_city_or_other_decisions(local_app):
    key = launch(local_app, "schelling_segregation", action="stay")
    route = f"/api/emergence/runs/{key}/trace"
    args = "seq=2&as_of_seq=2"
    system = call(local_app, f"{route}?{args}")
    role = call(local_app, f"{route}?{args}&perspective=role")
    assert role["perspective"] == "role"
    assert role["run_id"] == system["run_id"] and role["focus"]["event_seq"] == system["focus"]["event_seq"]
    assert role["evidence_level"] == "partial" and not role["edges"]
    assert {node["actor_id"] for node in role["nodes"]} == {"A001"}
    assert {node["kind"] for node in role["nodes"]} == {"actor_state"}
    assert "邻居" in role["nodes"][0]["label"]
    assert all(ref["actor"] in (None, "A001") for node in role["nodes"] for ref in node["source_refs"])
    assert call(local_app, f"{route}?{args}&perspective=role&actor_id=B014",
                status=422)["detail"] == "ACTOR_NOT_VISIBLE"
