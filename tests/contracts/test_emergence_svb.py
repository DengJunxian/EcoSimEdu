from test_education_api import call
from test_svb_classroom import launch


def test_svb_cash_trace_and_source_message_have_real_ledger_origins(local_app):
    key = launch(local_app, "baseline")
    route = f"/api/emergence/runs/{key}/trace"
    run = call(local_app, f"/api/runs/{key}/export")
    payments = call(local_app, route + "?seq=4&as_of_seq=4&actor_id=D01")
    assert payments["evidence_level"] == "exact_identity"
    assert payments["focus"]["event_seq"] == 4 and payments["focus"]["metric_id"] == "cash"
    assert any(edge["kind"] == "accounting_identity" and "实付 32" in edge["label"] for edge in payments["edges"])
    assert {node["value"] for node in payments["nodes"] if node["metric_id"] == "cash"} == {100, 68}
    events = run["result"]["events"]
    current = next(event for event in events if event["event_type"] == "messages")
    message = current["messages"][0]
    tick = current["seq"]
    trace = call(local_app, route + f"?seq={tick}&as_of_seq={tick}&actor_id={message['to']}")
    assert trace["run_id"] == key
    assert any(node["kind"] == "relation" and node["source_refs"][0]["seq"] == message["origin_seq"]
               for node in trace["nodes"])
    assert any(edge["kind"] == "model_rule" and "风险评分" in edge["label"] for edge in trace["edges"])
    assert all(ref["seq"] <= tick for node in trace["nodes"] for ref in node["source_refs"])
