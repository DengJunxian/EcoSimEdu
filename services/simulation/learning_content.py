"""Versioned authoring contract for offline education packages."""
from functools import lru_cache
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, PositiveInt

ROOT = Path(__file__).resolve().parents[2]
Phase = Literal["intro", "predict", "bid", "observe", "explain", "compare", "notebook"]


class AuthoringModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Concept(AuthoringModel):
    id: str
    version: PositiveInt
    label: str
    definition: str
    prerequisite_ids: list[str]
    misconception_codes: list[str]


class Outcome(AuthoringModel):
    id: str
    version: PositiveInt
    concept_ids: list[str]
    performance: str
    evidence_requirement: str
    phase: Phase
    task: str
    transfer: str


class Context(AuthoringModel):
    kind: Literal["authored_model_exercise"]


class Option(AuthoringModel):
    id: str
    label: str


class NumericField(Option):
    unit: str


class Response(AuthoringModel):
    fields: list[NumericField] = []
    options: list[Option] = []


class Evaluator(AuthoringModel):
    id: Literal["choice_v1", "numeric_v1", "ordering_v1", "structure_v1"]
    version: Literal[1]
    answer: str | list[str] | None = None
    answers: list[int | float] | None = None


class Feedback(AuthoringModel):
    hint: str
    explanation: str
    misconception_code: str


class Item(AuthoringModel):
    id: str
    version: PositiveInt
    variant_id: str
    family_id: str
    outcome_ids: list[str]
    kind: Literal["single_choice", "numeric", "ordering", "structured_explanation"]
    prompt: str
    context: Context
    assessment_role: Literal["practice", "independent", "transfer", "review"]
    response_schema: Response
    evaluator: Evaluator
    feedback: Feedback


class Activity(AuthoringModel):
    id: str
    phase: Phase
    kind: Literal["assessment", "example", "review"]
    outcome_ids: list[str]
    content_ref: str
    assessment_item_ids: list[str]
    completion_rule: Literal["submit_or_skip", "read_or_skip"]
    next_activity_id: str | None
    remediation_activity_id: str | None = None
    return_activity_id: str | None = None
    text: str | None = None


class LearningPackage(AuthoringModel):
    schema_version: Literal[3]
    case_id: str
    case_version: str
    content_version: str
    source_ids: list[str]
    required_comparisons: list[str]
    outcomes: list[Outcome]
    items: list[Item]
    activities: list[Activity]


def index(values, label):
    result = {value.id: value for value in values}
    if len(result) != len(values) or "" in result:
        raise ValueError(f"{label}: duplicate or blank ID")
    return result


def load_concepts():
    path = ROOT / "content/concepts.json"
    concepts = index([Concept.model_validate(item) for item in json.loads(path.read_text())], "concepts")
    checked = set()

    def check(key, ancestors):
        if key in ancestors or key not in concepts:
            raise ValueError(f"concept prerequisite missing or cyclic: {key}")
        if key not in checked:
            for predecessor in concepts[key].prerequisite_ids:
                check(predecessor, ancestors | {key})
            checked.add(key)

    for key in concepts:
        check(key, set())
    return concepts


def check_outcomes(outcomes, concepts):
    for key, outcome in outcomes.items():
        if (not outcome.concept_ids or set(outcome.concept_ids) - concepts.keys() or
                not all(part.strip() for part in (outcome.performance, outcome.evidence_requirement,
                                                  outcome.task, outcome.transfer))):
            raise ValueError(f"{key}: outcome needs observable task and concepts")


def validate_package(package, case, concepts):
    outcomes = index(package.outcomes, "outcomes")
    items = index(package.items, "items")
    activities = index(package.activities, "activities")
    check_outcomes(outcomes, concepts)
    if (len(outcomes) != 3 or package.case_id != case["case_id"] or package.case_version != case["version"] or
            not package.source_ids or set(package.source_ids) - {source["id"] for source in case["sources"]}):
        raise ValueError("case identity, version, source, or outcome coverage")
    branches = {scenario["id"] for scenario in case["scenarios"]} - {"baseline"}
    if (not package.required_comparisons or len(set(package.required_comparisons)) != len(package.required_comparisons) or
            set(package.required_comparisons) - branches):
        raise ValueError("required comparison references an unavailable scenario")
    if len({item.variant_id for item in items.values()}) != len(items):
        raise ValueError("duplicate variant IDs")
    codes = {code for concept in concepts.values() for code in concept.misconception_codes}
    coverage = {key: set() for key in outcomes}
    for key, item in items.items():
        fields = index(item.response_schema.fields, f"{key}.fields")
        options = index(item.response_schema.options, f"{key}.options")
        evaluator = item.evaluator
        valid = {
            "numeric": evaluator.id == "numeric_v1" and fields and not options
            and evaluator.answers is not None and len(evaluator.answers) == len(fields)
            and all(field.unit for field in fields.values()),
            "single_choice": evaluator.id == "choice_v1" and len(options) >= 2
            and isinstance(evaluator.answer, str) and evaluator.answer in options,
            "ordering": evaluator.id == "ordering_v1" and len(options) >= 2
            and isinstance(evaluator.answer, list) and len(evaluator.answer) == len(options)
            and set(evaluator.answer) == options.keys(),
            "structured_explanation": evaluator.id == "structure_v1" and len(fields) >= 2 and not options,
        }[item.kind]
        if (not valid or not item.prompt.strip() or not item.outcome_ids or set(item.outcome_ids) - outcomes.keys()
                or item.feedback.misconception_code not in codes or not item.feedback.explanation.strip()):
            raise ValueError(f"{key}: invalid response, evaluator, feedback, or outcome reference")
        for outcome in item.outcome_ids:
            if item.kind != "structured_explanation":
                coverage[outcome].add(item.assessment_role)
    for key, roles in coverage.items():
        if not {"independent", "transfer"} <= roles:
            raise ValueError(f"{key}: independent and transfer tasks required")
    assigned = set()
    inbound = set()
    for key, activity in activities.items():
        if set(activity.outcome_ids) - outcomes.keys():
            raise ValueError(f"{key}: unknown activity outcome")
        if activity.kind in {"assessment", "review"}:
            if (activity.assessment_item_ids != [activity.content_ref] or activity.content_ref not in items or
                    activity.return_activity_id or activity.completion_rule != "submit_or_skip"):
                raise ValueError(f"{key}: invalid assessment activity")
            item = items[activity.content_ref]
            if (item.id in assigned or set(activity.outcome_ids) != set(item.outcome_ids) or
                    (item.assessment_role == "transfer" and activity.phase != "notebook") or
                    (item.assessment_role == "review") != (activity.kind == "review") or
                    (activity.kind == "review" and (activity.next_activity_id or activity.remediation_activity_id))):
                raise ValueError(f"{key}: invalid assessment assignment")
            assigned.add(item.id)
        if activity.kind == "example":
            origin = activities.get(activity.return_activity_id)
            if (not activity.text or not origin or origin.remediation_activity_id != key or
                    origin.phase != activity.phase or activity.assessment_item_ids or activity.next_activity_id or
                    activity.remediation_activity_id or activity.completion_rule != "read_or_skip"):
                raise ValueError(f"{key}: remediation needs one same-phase return point")
        if activity.remediation_activity_id:
            example = activities.get(activity.remediation_activity_id)
            if not example or example.kind != "example" or example.return_activity_id != key:
                raise ValueError(f"{key}: unresolved remediation")
        if activity.next_activity_id:
            following = activities.get(activity.next_activity_id)
            if (not following or following.phase != activity.phase or following.kind != "assessment" or
                    following.id in inbound):
                raise ValueError(f"{key}: invalid phase successor")
            inbound.add(following.id)

    for phase in {activity.phase for activity in activities.values() if activity.kind != "review"}:
        main = {activity.id for activity in activities.values()
                if activity.phase == phase and activity.kind == "assessment"}
        if not main:
            raise ValueError(f"{phase}: no main activity")
        starts = main - inbound
        if len(starts) != 1:
            raise ValueError(f"{phase}: needs exactly one starting activity")
        key = next(iter(starts))
        while key:
            if key not in main:
                raise ValueError(f"{phase}: cyclic activities")
            main.remove(key)
            key = activities[key].next_activity_id
        if main:
            raise ValueError(f"{phase}: unreachable activities")
    if assigned != items.keys():
        raise ValueError("unassigned items")


@lru_cache
def load_learning_package(case_id):
    from .lessons import load_case

    case = load_case(case_id)
    path = ROOT / "cases" / case_id / "learning-v3.json"
    if not path.is_file():
        return None
    package = LearningPackage.model_validate_json(path.read_bytes())
    validate_package(package, case, load_concepts())
    return package.model_dump(exclude_unset=True)
