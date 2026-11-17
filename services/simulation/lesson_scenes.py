"""Versioned teaching content layered over the existing case and run contracts."""
from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from .auction import ENGINE_VERSION, ROOT, initial_agents
from .lessons import CATALOG, load_case

Text = Annotated[str, Field(min_length=1)]
Stage = Literal["intro", "predict", "bid", "observe", "explain", "compare", "notebook"]

ENGINE_VERSIONS = {
    "double_auction": ENGINE_VERSION,
    "svb_run": "svb/1",
    "schelling_segregation": "schelling/1",
    "information_cascade": "information-cascade/1",
    "public_goods": "public-goods/1",
    "commons_governance": "commons-governance/1",
    "lemons_market": "lemons-market/1",
    "school_matching": "school-matching/1",
    "beer_game": "beer/1",
    "carbon_market": "carbon/1",
    "flash_crash": "flash-crash/1",
    "gamestop": "gamestop/1",
}

# Selectors may reference payload fields from their own event type.
EVENT_FIELDS = {
    "double_auction": {
        "order_submitted": {"actor_id", "order_id", "price", "side", "quantity", "round"},
        "order_rejected": {"actor_id", "order_id", "price", "side", "quantity", "round"},
        "order_cancelled": {"actor_id", "order_id", "round"},
        "trade": {"buyer_id", "seller_id", "buy_order_id", "sell_order_id", "maker_order_id",
                  "price", "quantity", "round", "buyer_surplus", "seller_surplus", "platform_fee"},
        "market_close": set(),
    },
    "svb_run": {
        "requests": {"requests", "round"},
        "payments": {"payments", "round"},
        "messages": {"messages", "round"},
        "support": {"draw", "round"},
        "sale": {"units", "proceeds", "realized_loss", "round"},
        "revaluation": {"old_price", "new_price", "mark_loss", "round"},
        "queue": {"pending", "round"},
    },
    'information_cascade': {
        'decision': {'turn', 'signal', 'signal_id', 'choice', 'policy', 'visible_action_ids', 'choice_if_private_a', 'choice_if_private_b', 'public_a_before_pct', 'private_a_after_pct', 'public_a_after_pct', 'action_likelihood_given_a', 'action_likelihood_given_b', 'cascade', 'information_added'},
        'verification': {'signal', 'public_a_before_pct', 'public_a_after_pct', 'turn'},
        'reveal': {'state', 'correct_count'},
        'experiment_open': set(),
    },
    'public_goods': {
        'contributions': {'round', 'contributions', 'public_return'},
        'settlement': {'round', 'sanctions', 'gross', 'net', 'outgoing', 'fines'},
        'start': {'round'},
    },
    'commons_governance': {
        'withdrawal': {'period', 'start_stock', 'remaining_stock', 'allocations', 'requests', 'plans', 'monitoring_cost', 'monitored', 'fines', 'monitor_budget_before', 'monitor_budget_after', 'participant_net', 'gross_value'},
        'growth': {'period', 'remaining_stock', 'growth', 'next_stock'},
        'start': {'period'},
    },
    'lemons_market': {
        'market_open': {'listed', 'listed_quality_distribution'},
        'certification': {'certified', 'fee'},
        'offer_iteration': {'iteration', 'exited', 'willing_pool', 'listed_stock'},
        'settlement': {'transactions', 'status'},
    },
    'school_matching': {
        'admissions_open': {'submitted', 'capacities'},
        'round_proposals': {'round', 'proposals'},
        'round_resolution': {'round', 'before', 'held', 'rejected'},
        'final_assignment': {'assignments', 'submitted_blocking', 'true_blocking'},
    },
    'beer_game': {
        'opening': {'week', 'orders', 'arrivals', 'dispatches', 'in_transit_batches', 'production', 'demand_received', 'delivered', 'produced'},
        'week_end': {'week', 'orders', 'arrivals', 'dispatches', 'in_transit_batches', 'production', 'demand_received', 'delivered', 'produced'},
    },
    'carbon_market': {
        'issuance': {'issue', 'phase'},
        'phase_end': {'phase', 'abatement', 'emissions', 'continuous_cost_floor', 'integer_minimum_cost', 'max_marginal_abatement_cost'},
        'transfer': {'phase', 'seller', 'buyer', 'permits', 'payment'},
        'surrender': {'phase', 'firm', 'permits', 'emissions'},
    },
    'flash_crash': {
        'opening': {'plan_shares', 'time'},
        'release': {'quantity', 'time'},
        'inventory_limit': {'excess', 'limit', 'active_orders', 'time'},
        'cancel': {'order_id', 'quantity', 'reason', 'time'},
        'trade': {'quantity', 'price_cents', 'buy_order_id', 'sell_order_id', 'maker_id', 'purpose', 'time'},
        'pause': {'pause_steps', 'time'},
        'resume': {'time'},
        'period_end': {'time'},
        'order_submitted': {'order_id', 'quantity', 'side', 'price_cents', 'purpose', 'time'},
        'unfilled': {'order_id', 'quantity', 'purpose', 'time'},
    },
    'gamestop': {
        'opening': {'time'},
        'message': {'message_id', 'tone', 'time'},
        'forward': {'message_id', 'origin_seq', 'tone', 'time'},
        'loan': {'quantity', 'debt', 'collateral_cents', 'time'},
        'loan_blocked': {'quantity', 'time'},
        'margin_call': {'mark_cents', 'maintenance_percent', 'debt', 'collateral_cents', 'time'},
        'trade': {'quantity', 'price_cents', 'buy_order_id', 'sell_order_id', 'maker_id', 'purpose', 'time'},
        'return': {'quantity', 'remaining_debt', 'time'},
        'period_end': {'time'},
        'student': {'action', 'time'},
        'order_submitted': {'order_id', 'quantity', 'price_cents', 'purpose', 'time'},
    },
    "schelling_segregation": {
        kind: {"actor_id", "origin", "destination", "before", "after", "changed_neighbors", "round"}
        for kind in ("move", "student_move")
    } | {"market_close": {"terminal"}},
}

ACTORS = {
    'svb_run': {'D01', 'BANK'},
    'schelling_segregation': {'A001'},
    'information_cascade': {'D03'},
    'public_goods': {'P1'},
    'commons_governance': {'F01'},
    'lemons_market': {'S01'},
    'school_matching': {'S01'},
    'beer_game': {'零售商'},
    'carbon_market': {'F01'},
    'flash_crash': {'做市者 0（学生）'},
    'gamestop': {'学生投资者'},
}

AUCTION_OBSERVABLES = {
    "best_bid", "best_ask", "volume", "surplus", "ceiling", "participant_surplus", "platform_cash",
    "efficiency", "price_band", "cash", "marginals", "accounts", "orders", "demand", "supply",
    "demand_shift", "fee", "root_hash", "initial_hash",
}


class ContentModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)


class Selector(ContentModel):
    event_type: Text
    actor_id: Text | None = None
    fields: list[Text] = Field(min_length=1)
    equals: dict[Text, bool | int | str | None] | None = None
    nonempty: Text | None = None
    metric_positive: Text | None = None


class Evidence(ContentModel):
    selector: Selector
    missing: Text


class Option(ContentModel):
    id: Text
    label: Text
    feedback: Text
    criterion: Literal["correct", "incorrect", "uncertain"] | None = None


class Question(ContentModel):
    id: Text
    prompt: Text
    options: list[Option] = Field(min_length=2)
    kind: Literal["concept", "prediction"] | None = None
    selector: Selector | None = None


class Role(ContentModel):
    actor_id: Text
    label: Text
    goal: Text


class CaseScene(ContentModel):
    id: Text
    legacy_stage: Stage
    title: Text
    question: Text
    objective: Text
    role: Role | None = None
    information: list[Text]
    action: Stage | Literal["legacy"]
    observables: list[Text]
    questions: list[Question]
    evidence: Evidence | None = None
    rubric: Text | None = None
    next_scene: Text | None


class LessonScenes(ContentModel):
    schema_version: Literal[2]
    case_id: Text
    content_version: Annotated[str, Field(pattern=r"^\d+\.\d+\.\d+(-draft)?$")]
    engine_version: Text
    source_ids: list[Text]
    scenes: list[CaseScene] = Field(min_length=1)


def validate_lesson(data, case_id, *, draft=False):
    lesson = LessonScenes.model_validate(data)
    case = load_case(case_id)
    if lesson.case_id != case_id or lesson.engine_version != ENGINE_VERSIONS[case_id]:
        raise ValueError(f"{case_id}: scene package identity or engine version does not match the case")
    if lesson.content_version.endswith("-draft") != draft:
        raise ValueError(f"{case_id}: draft content must be kept separate from published content")
    sources = set(lesson.source_ids)
    if len(sources) != len(lesson.source_ids) or sources - {source["id"] for source in case["sources"]}:
        raise ValueError(f"{case_id}: unknown or duplicate source references")
    stages = [row["id"] for row in case["lessons"]]
    if [scene.id for scene in lesson.scenes] != stages or [scene.legacy_stage for scene in lesson.scenes] != stages:
        raise ValueError(f"{case_id}: scene IDs and legacy stage IDs must preserve the seven-stage order")

    event_fields = EVENT_FIELDS.get(case_id, {})
    metrics = {row["id"] for row in case.get("metrics", [])}
    observables = metrics | set(event_fields) | set().union(*event_fields.values())
    if case_id == "double_auction":
        observables |= AUCTION_OBSERVABLES
        actors = set(initial_agents(case["seed"]))
    else:
        actors = ACTORS.get(case_id, set())
    question_ids = set()
    for index, scene in enumerate(lesson.scenes):
        scope = f"{case_id}/{scene.id}"
        if scene.next_scene != (stages[index + 1] if index + 1 < len(stages) else None):
            raise ValueError(f"{scope}: invalid next scene")
        if scene.action not in {scene.legacy_stage, "legacy"}:
            raise ValueError(f"{scope}: invalid action for stage")
        if scene.role and scene.role.actor_id not in actors:
            raise ValueError(f"{scope}: unknown role {scene.role.actor_id}")
        if set(scene.observables) - observables:
            raise ValueError(f"{scope}: unknown observable {set(scene.observables) - observables}")

        selectors = [scene.evidence.selector] if scene.evidence else []
        for question in scene.questions:
            if question.id in question_ids:
                raise ValueError(f"{scope}: duplicate question {question.id}")
            question_ids.add(question.id)
            option_ids = {option.id for option in question.options}
            if len(option_ids) != len(question.options) or len({option.feedback for option in question.options}) != len(question.options):
                raise ValueError(f"{scope}/{question.id}: each option needs a distinct ID and feedback")
            if question.kind == "prediction" and (not question.selector or option_ids != {"yes", "no", "unknown"}):
                raise ValueError(f"{scope}/{question.id}: occurrence prediction requires a selector and yes/no/unknown")
            if question.selector:
                selectors.append(question.selector)

        for selector in selectors:
            fields = event_fields.get(selector.event_type)
            if fields is None:
                raise ValueError(f"{scope}: unknown evidence event {selector.event_type}")
            extra_fields = set(selector.equals or ())
            if selector.nonempty:
                extra_fields.add(selector.nonempty)
            if (set(selector.fields) | extra_fields) - (fields | {"seq", "tick", "event_type"}):
                raise ValueError(f"{scope}: unknown evidence field for {selector.event_type}")
            if selector.metric_positive and selector.metric_positive not in metrics:
                raise ValueError(f"{scope}: unknown prediction metric")
            if selector.actor_id and selector.actor_id not in actors:
                raise ValueError(f"{scope}: unknown evidence actor {selector.actor_id}")
    return lesson


def adapt_legacy_lesson(case):
    stages = case["lessons"]
    return {
        "schema_version": 2,
        "case_id": case["case_id"],
        "engine_version": ENGINE_VERSIONS[case["case_id"]],
        "content_version": case["version"],
        "source_ids": [source["id"] for source in case["sources"]],
        "scenes": [
            {"id": step["id"], "legacy_stage": step["id"], "title": step["title"],
             "question": step["prompt"], "objective": step["prompt"], "information": [],
             "action": "legacy", "observables": [], "questions": [],
             "next_scene": stages[index + 1]["id"] if index + 1 < len(stages) else None}
            for index, step in enumerate(stages)
        ],
    }


def load_lesson_scenes(case_id):
    case = load_case(case_id)
    path = ROOT / "cases" / case_id / "lesson-v2.json"
    data = json.loads(path.read_text()) if path.is_file() else adapt_legacy_lesson(case)
    return validate_lesson(data, case_id).model_dump(exclude_unset=True)


if __name__ == "__main__":
    for key in CATALOG:
        load_lesson_scenes(key)
        draft_path = ROOT / "cases" / key / "lesson-v2.draft.json"
        if draft_path.is_file():
            validate_lesson(json.loads(draft_path.read_text()), key, draft=True)
    print(f"Validated scene contracts for {len(CATALOG)} published courses and any local drafts")
