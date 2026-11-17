import json

import pytest
from jsonschema import Draft202012Validator

from services.simulation.auction import CASE, ROOT, run_auction
from services.simulation.lesson_scenes import load_lesson_scenes, validate_lesson
from services.simulation.lessons import CATALOG, load_case

from test_education_api import call


def test_lesson_route_serves_released_content_and_legacy_adapter(local_app):
    for case_id in CATALOG:
        route = f"/api/cases/{case_id}/lesson"
        assert call(local_app, route) == load_lesson_scenes(case_id)
    missing = call(local_app, "/api/cases/no-such-case/lesson", status=422)
    assert missing["detail"] == "CASE_NOT_AVAILABLE"


def test_scene_contract_retains_published_course_paths_and_keeps_drafts_unpublished():
    contract = Draft202012Validator(json.loads((ROOT / "schemas/lesson.scenes.schema.json").read_text()))
    for case_id in CATALOG:
        case = load_case(case_id)
        lesson = load_lesson_scenes(case_id)
        contract.validate(lesson)
        assert [scene["legacy_stage"] for scene in lesson["scenes"]] == [stage["id"] for stage in case["lessons"]]
        if (ROOT / "cases" / case_id / "lesson-v2.json").is_file():
            assert lesson["content_version"] != case["version"]
            assert [scene["action"] for scene in lesson["scenes"]] == [stage["id"] for stage in case["lessons"]]
        else:
            assert lesson["content_version"] == case["version"]
            assert all(scene["action"] == "legacy" for scene in lesson["scenes"])
        draft_path = ROOT / "cases" / case_id / "lesson-v2.draft.json"
        if draft_path.is_file():
            draft = json.loads(draft_path.read_text())
            contract.validate(draft)
            validate_lesson(draft, case_id, draft=True)
            with pytest.raises(ValueError, match="draft content"):
                validate_lesson(draft, case_id)


@pytest.mark.parametrize(("area", "field", "value", "message"), [
    ("selector", "event_type", "fake_trade", "unknown evidence event"),
    ("selector", "fields", ["pending"], "unknown evidence field"),
    ("selector", "actor_id", "B999", "unknown evidence actor"),
    ("evidence", "missing", "", "String should have at least 1 character"),
    ("scene", "next_scene", "notebook", "invalid next scene"),
    ("scene", "observables", ["adjusted_price"], "unknown observable"),
    ("role", "actor_id", "S999", "unknown role"),
    ("lesson", "source_ids", ["FAKE"], "unknown or duplicate source references"),
])
def test_scene_contract_rejects_dangling_content_references(area, field, value, message):
    lesson = load_lesson_scenes("double_auction")
    scene = lesson["scenes"][3]
    target = {
        "lesson": lesson, "scene": scene, "evidence": scene["evidence"],
        "selector": scene["evidence"]["selector"], "role": lesson["scenes"][1]["role"],
    }[area]
    target[field] = value
    with pytest.raises(ValueError, match=message):
        validate_lesson(lesson, "double_auction")


@pytest.mark.parametrize(("bid", "filled"), [(96, True), (1, False)])
def test_prediction_selector_distinguishes_player_fill_from_market_activity(bid, filled):
    scene = load_lesson_scenes("double_auction")["scenes"][1]
    question = next(question for question in scene["questions"] if question["kind"] == "prediction")
    selector = question["selector"]
    run = run_auction("baseline", CASE["seed"], bid)
    trades = [event for event in run["events"] if event["event_type"] == selector["event_type"]]
    matching = [event for event in trades if selector["actor_id"] in (event["buyer_id"], event["seller_id"])]
    assert trades and bool(matching) is filled
    assert run["events"][-1]["event_type"] == "market_close"
    assert all(set(selector["fields"]) <= event.keys() for event in matching)
    assert "unknown" in {option["id"] for option in question["options"]}
