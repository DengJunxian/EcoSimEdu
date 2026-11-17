"""Frozen offline tutor release corpus. These engineering checks do not measure general comprehension."""

import gzip
import json
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from unittest.mock import patch

import pytest

from services.simulation.auction import digest, run_auction
from services.simulation.lessons import CATALOG, load_case, simulate
from services.simulation.projection import frame_metrics, metric_registry
from services.simulation.tutor import answer_tutor

ROOT = Path(__file__).resolve().parents[2]
SUITE = json.loads((ROOT / "docs/release/tutor-acceptance-v1.json").read_text(encoding="utf-8"))


def test_acceptance_corpus_has_twelve_case_scope_and_sixty_fixed_questions():
    items = SUITE["items"]
    assert SUITE["version"] == 1
    assert len(items) == len({item["id"] for item in items}) == 60
    assert Counter(item["group"] for item in items) == {"lesson": 36, "cross_scope": 24}
    assert Counter(item["case_id"] for item in items if item["group"] == "lesson") == dict.fromkeys(CATALOG, 3)
    assert all(item["question"] and item["expected"] and item["prohibits"] for item in items)


@lru_cache(maxsize=None)
def _source_run(case_id, mode):
    case = load_case(case_id)
    if mode == "replay":
        packed = ROOT / "cases/double_auction/presets.json.gz"
        with gzip.open(packed, "rt", encoding="utf-8") as source:
            stored = json.load(source)["baseline"]
        assert stored["result_hash"] == digest(stored["result"])
        result = stored["result"]
    elif case_id == "double_auction":
        result = run_auction("baseline", case["seed"], 100)
    elif mode == "live_stub":
        # An engine-only stand-in for active-origin question routing. No provider contact.
        result = simulate(case, "baseline", case["seed"], case["action"]["default"],
                          decide=lambda _actor, _stage, _state, _allowed, default: default)
    else:
        result = simulate(case, "baseline", case["seed"], case["action"]["default"])
    version = "0.0.0" if mode == "stale" else case["version"]
    origin = {"replay": "precomputed_simulation", "live_stub": "live_simulation"}.get(mode, "offline_simulation")
    return {"run_id": f"wp10:{case_id}:{mode}", "case_id": case_id, "case_version": version,
            "origin": origin, "result": result}


def _playhead(run, requested):
    if requested == "first_trade":
        return next(event["tick"] for event in run["result"]["events"] if event["event_type"] == "trade")
    if requested == "latest":
        return run["result"]["events"][-1]["tick"]
    return requested


def _check_observation(case, expected, answer, run, playhead):
    citation, = answer["citations"]
    events = run["result"]["events"]
    if expected.get("rule") == "first_request_batch":
        original = next(event for event in events[:playhead + 1] if event["event_type"] == "requests")
        cited_tick = original["tick"]
        people = sorted({request["person"] for request in original["requests"]})
        assert "、".join(people) in answer["answer"]
        assert set(re.findall(r"(?<![a-zA-Z0-9])D[0-9]{2}(?![a-zA-Z0-9])", answer["answer"])) == set(people)
    else:
        cited_tick = expected.get("evidence_tick", playhead)
        original = events[cited_tick]
        observed = frame_metrics(run["result"]["snapshots"][cited_tick])
        descriptors = {metric["id"]: metric for metric in metric_registry(case)}
        stated = {
            key for key, metric in descriptors.items()
            if f'{metric["label"]}为 ' in answer["answer"] or f'{metric["label"]}没有记录' in answer["answer"]
        }
        assert stated == set(expected["metric_ids"])
        for key in expected["metric_ids"]:
            metric = descriptors[key]
            value = observed.get(key)
            if expected.get("requires_null"):
                assert value is None
            if expected.get("requires_zero"):
                assert value == 0
            expected_text = (f'{metric["label"]}没有记录' if value is None
                             else f'{metric["label"]}为 {value} {metric["unit"]}')
            assert expected_text in answer["answer"]
        if expected.get("uses_event_summary"):
            if original.get("summary"):
                assert original["summary"].rstrip("。") in answer["answer"]
            else:
                assert original["event_type"] == "trade"
                assert f'{original["buyer_id"]} 与 {original["seller_id"]}' in answer["answer"]
    assert citation == {"kind": "event", "label": f"查看事件 {cited_tick}",
                        "run_id": run["run_id"], "tick": cited_tick}
    mentioned_ticks = {int(number) for number in re.findall(r"事件\s*(\d+)", answer["answer"])}
    assert cited_tick in mentioned_ticks
    assert all(0 <= tick <= cited_tick and events[tick]["tick"] == tick for tick in mentioned_ticks)


@pytest.mark.parametrize("item", SUITE["items"], ids=lambda item: item["id"])
def test_offline_tutor_engine_acceptance(item):
    case = load_case(item["case_id"])
    assert case["version"] == item["case_version"]
    expected = item["expected"]
    mode = item.get("run")
    with patch("socket.socket.connect", side_effect=AssertionError("offline tutor attempted network")):
        run = _source_run(item.get("run_case", item["case_id"]), mode) if mode else None
        playhead = _playhead(run, item.get("tick"))
        before = digest(run)
        answer = answer_tutor(case, item["question"], run, tick=playhead)
        assert digest(run) == before

    assert answer["kind"] == expected["kind"]
    assert answer["answer"] and all(value in answer["answer"] for value in expected.get("includes", []))
    assert not re.search(r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}", answer["answer"])
    if expected["kind"] == "concept":
        term = next(term for term in case["glossary"] if term["term"] == expected["concept"])
        assert answer["answer"] == term["definition"]
        assert answer["citations"] == [{"kind": "concept", "label": term["term"], "concept": term["term"]}]
    elif expected["kind"] == "model":
        step = next(step for step in case["lessons"] if step["id"] == expected["lesson"])
        text = case["questions"]["prediction"]["prompt"] if step["id"] == "predict" else step["prompt"]
        assert answer["answer"] == text
        assert answer["citations"] == [{"kind": "lesson", "label": step["title"], "lesson_id": step["id"]}]
    elif expected["kind"] == "history":
        sources = {source["id"]: source for source in case["sources"]}
        assert [citation["source_id"] for citation in answer["citations"]] == expected["source_ids"]
        for citation in answer["citations"]:
            source = sources[citation["source_id"]]
            assert citation["kind"] == "source"
            assert [citation[attr] for attr in ("url", "supports", "label")] == [
                source["url"], source["supports"], source["title"]]
        if expected.get("includes"):
            assert answer["answer"] == case["background"]
    elif expected["kind"] == "observation":
        _check_observation(case, expected, answer, run, playhead)
    else:
        assert answer["citations"] == []
        assert item["question"] not in answer["answer"]
