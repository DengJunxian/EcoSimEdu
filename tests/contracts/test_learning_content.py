from copy import deepcopy

import pytest

from scripts.check_learning_packages import check
from services.simulation.learning_content import LearningPackage, load_concepts, load_learning_package, validate_package
from services.simulation.lessons import load_case
from test_education_api import call


def test_curriculum_and_versioned_content_are_published(local_app):
    courses, outcomes, packages = check()
    assert (courses, outcomes) == (12, 36)
    assert packages == 12
    url = "/api/cases/double_auction/lesson"
    assert len(call(local_app, url)["scenes"]) == 7
    package = call(local_app, url + "?schema_version=3")
    assert package["schema_version"] == 3
    assert len(package["activities"]) >= 8
    assert all(item["context"] == {"kind": "authored_model_exercise"} for item in package["items"])


@pytest.mark.parametrize("corrupt,expected", [
    (lambda pack: next(a for a in pack["activities"] if a["kind"] == "example").pop("return_activity_id"), "unresolved remediation"),
    (lambda pack: pack["items"][0]["outcome_ids"].append("unknown"), "outcome reference"),
    (lambda pack: pack["activities"][0].update(next_activity_id=pack["activities"][0]["id"]), "unreachable activities"),
    (lambda pack: pack["outcomes"][0]["concept_ids"].append("unknown"), "observable task and concepts"),
])
def test_invalid_authoring_fails_before_serving(corrupt, expected):
    case = load_case("double_auction")
    raw = deepcopy(load_learning_package(case["case_id"]))
    corrupt(raw)
    with pytest.raises(ValueError, match=expected):
        validate_package(LearningPackage.model_validate(raw), case, load_concepts())


def test_flagship_and_domain_calculations_have_independent_reference_answers():
    checks = {
        "double_auction": ("auc-independent", [103 - 94 - 3, 94 - 82 - 3, 3 * 2, 103 - 82]),
        "svb_run": ("svb-independent", [12 - 8, 65 - 8, 18 - 8, 12 + 28 + 40 - 65 - 5]),
        "schelling_segregation": ("sch-independent", [100 * 2 / 5, 100 * 2 / 4]),
        "information_cascade": ("cascade-odds", [100 * (1 / 2 * 1 / 2) / (1 + 1 / 2 * 1 / 2)]),
        "public_goods": ("pg-sanctions", [4 * 20 + (4 * .4 - 1) * 30 - 2 - 6]),
        "commons_governance": ("commons-growth", [120 + .55 * 120 * (1 - 120 / 240)]),
        "lemons_market": ("lemons-net", [6 - 5 - .5]),
        "beer_game": ("beer-position", [12 + 9 - 5]),
        "carbon_market": ("carbon-cost", [sum(sorted(k * (step - .5) for k in (2, 8) for step in (1, 2))[:2])]),
        "flash_crash": ("flash-tape", [18 - 4 - 7 + 2]),
        "gamestop": ("gme-return", [12 - 4]),
    }
    for case_id, (item_id, expected) in checks.items():
        item = next(item for item in load_learning_package(case_id)["items"] if item["id"] == item_id)
        assert item["evaluator"]["answers"] == pytest.approx(expected), (case_id, item_id)
    matching = next(item for item in load_learning_package("school_matching")["items"] if item["id"] == "matching-blocking")
    correct = next(option["label"] for option in matching["response_schema"]["options"]
                   if option["id"] == matching["evaluator"]["answer"])
    assert correct == "相对真实偏好的阻挡对"
