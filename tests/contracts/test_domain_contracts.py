from contextlib import closing
import json
from uuid import uuid4

from jsonschema import Draft202012Validator
import pytest
from fastapi import HTTPException

from scripts.generate_case_packages import build_packages
from services.simulation import api
from services.simulation.auction import ROOT, run_auction
from services.simulation.lessons import CATALOG, load_case
from test_education_api import call


def validate(schema, data):
    definition = json.loads((ROOT / f"schemas/{schema}.schema.json").read_text())
    Draft202012Validator(definition).validate(data)


def test_packages_match_original_identity_sources_and_metric_roles(local_app):
    saved = json.loads((ROOT / "cases/case-packages-v1.json").read_text())
    assert saved == build_packages()
    assert tuple(entry["caseId"] for entry in saved) == CATALOG
    for package in saved:
        case = load_case(package["caseId"])
        response = call(local_app, f"/api/cases/{case['case_id']}/package")
        assert response == package
        validate("case-package", response)
        assert response["identity"] == case["identity"]
        source_ids = {entry["id"] for entry in response["sourceReferences"]}
        assert source_ids == {item["sourceId"] for item in response["rights"]}
        assert all(set(fact["sourceIds"]) <= source_ids for fact in response["historicalFacts"])
        assert {response["browserMetricRoles"]["comparison"], response["archivedMetricRoles"]["observation"]} <= {
            metric["id"] for metric in response["metrics"]
        }


def test_archived_run_envelope_preserves_identity_and_original_event_refs(monkeypatch, tmp_path):
    monkeypatch.setenv("CIVITAS_EDU_DB", str(tmp_path / "archive.sqlite3"))
    key = uuid4()
    request = {"case_id": "double_auction", "seed": 1962, "scenario_id": "baseline", "provider_kind": "rule", "bid": 96}
    run = run_auction("baseline", 1962, 96)
    old_payload = api.encode_result("1.0.0", "offline_simulation", run)
    with closing(api.connect()) as connection, connection:
        connection.execute("INSERT INTO runs VALUES (?, ?, 'completed', ?)", (str(key), json.dumps(request), old_payload))
    legacy = api.get_run(key)
    envelope = api.run_envelope(key)
    validate("run-envelope", envelope.model_dump())
    assert envelope.versions.content is None and envelope.runId == legacy["run_id"]
    assert envelope.resultDigest.value == legacy["result_hash"]
    assert envelope.metricRoles.observation == "last_price"
    assert envelope.clock.id == "round"
    with pytest.raises(HTTPException) as rejected:
        api.run_envelope(key, engine_version="wrong-version")
    assert rejected.value.detail == "RUN_VERSION_MISMATCH"

    event = api.archived_event_evidence(key, 4, "archive")
    validate("evidence", event.model_dump())
    assert event.event.record == api.read_event(key, 4)["event"]
    assert event.event.actorIds == ["B01", "S02"] and event.event.record["price"] == 96
    assert {row.eventId for row in event.event.sourceEvents} == {"1", "3"}
    assert event.event.runId == str(key)
    hidden = event.model_dump()
    hidden.update(scope="visible_prefix", asOf=3)
    with pytest.raises(ValueError, match="EVIDENCE_NOT_VISIBLE"):
        type(event).model_validate(hidden)
    with closing(api.connect()) as connection, connection:
        assert connection.execute("SELECT result FROM runs WHERE id=?", (str(key),)).fetchone()[0] == old_payload
        corrupted = old_payload.replace('"price": 96', '"price": 91', 1)
        assert corrupted != old_payload
        connection.execute("UPDATE runs SET result=? WHERE id=?", (corrupted, str(key)))
    with pytest.raises(HTTPException) as bad_hash:
        api.archived_event_evidence(key, 4, "archive")
    assert bad_hash.value.detail == "RUN_INTEGRITY_ERROR"
