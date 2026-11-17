from contextlib import closing
from uuid import uuid4
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import json

import pytest

from services.simulation import api, live_client, tutor_online
from services.simulation.lessons import CATALOG
from test_auction_classroom import launch as launch_auction
from test_education_api import call
from test_svb_classroom import launch as launch_bank


def advice(url, case_id, question, **fields):
    return call(url, "/api/tutor", {"case_id": case_id, "question": question, "scene": "observe", **fields})


@pytest.mark.parametrize("case_id,question,term", [
    ("svb_run", "为什么别人提款后我也可能需要提款？", "挤兑压力"),
    ("double_auction", "我的报价太低会发生什么？", "暂不交叉"),
    ("public_goods", "为什么我应该贡献，别人却可以搭便车？", "个人边际回报"),
    ("beer_game", "为什么订单波动会越来越大？", "超额补订"),
    ("svb_run", "为什么更多现金缓冲后银行还可能出现待付队列？", "支付能力"),
    ("svb_run", "为什么我的取款会影响邻居？", "挤兑压力"),
])
def test_frozen_upgrade_questions_have_three_nonspoiling_hints(local_app, case_id, question, term):
    replies = [advice(local_app, case_id, question, scene="predict", hint_level=level, prediction="unknown")
               for level in (1, 2, 3)]
    assert all(item["kind"] == "model" and item["delivery"] == "offline" and not item["evidence_ids"]
               and not item["online_available"] for item in replies)
    assert len({item["claim"] for item in replies}) == 3
    assert replies[-1]["hint_level"] == 3 and term in replies[-1]["claim"]


@pytest.mark.parametrize("case_id", CATALOG)
def test_roles_come_from_each_published_scene(local_app, case_id):
    roles = call(local_app, f"/api/cases/{case_id}/lesson")["scenes"]
    role = next(scene["role"] for scene in roles if scene.get("role"))
    answer = advice(local_app, case_id, "我扮演什么角色？", scene="intro", actor=role["actor_id"])
    assert answer["intent"] == "role" and role["goal"] in answer["claim"]


def test_independent_prompts_on_navigation_and_revealed_evidence(local_app):
    bank = launch_bank(local_app, "baseline")
    queue = call(local_app, f"/api/runs/{bank}/classroom-view?tick=checkpoint")
    point = queue["tick"]
    answer = advice(local_app, "svb_run", "银行账上还有净资产，为什么这笔工资款还没到账？",
                    tick=point, run_id=bank, actor="D16", hint_level=3, evidence=[{"run_id": bank, "seq": point}])
    assert answer["intent"] == "mechanism"
    row = next(row for row in queue["events"][-1]["pending"] if row["person"] == "D16")
    assert f'D16 的待付金额为 {row["remaining"]}' in answer["claim"]
    assert f'净资产为 {queue["frame"]["metrics"]["equity"]}' in answer["claim"]
    assert answer["evidence_ids"] == [f"{bank}:{point}"]

    answer = advice(local_app, "schelling_segregation", "大家是不是已经都不想搬了？", scene="predict")
    assert answer["intent"] == "prediction" and answer["evidence_ids"] == []

    auction = launch_auction(local_app)
    answer = advice(local_app, "double_auction", "两笔成交价格一样，买家多赚了什么？", run_id=auction, tick=4)
    assert answer["intent"] == "comparison" and answer["unsupported_scope"] == "private_information"
    assert "买方价值" in answer["claim"] and not any(char.isdigit() for char in answer["claim"])
    assert answer["evidence_ids"] == []


def test_scope_rejects_future_private_cross_run_numeric_and_missing_evidence(local_app):
    bank = launch_bank(local_app, "baseline")
    compare_run = launch_bank(local_app, "baseline")
    queue = call(local_app, f"/api/runs/{bank}/classroom-view?tick=checkpoint")
    tick = queue["tick"]
    for question, expected, other in [
        ("事件 9999 的现金", "event_unavailable", {}),
        (f"事件 {tick} 是什么？", "event_unavailable", {"tick": 0}),
        (f"事件 {tick} 发生了什么？", "event_unavailable", {"scene": "predict"}),
        ("D99 提款了吗？", "actor_unavailable", {}),
        ("当前事件发生了什么？", "event_unavailable", {"tick": 0}),
        ("银行现金为 999 吗？", "unverified_number", {}),
        ("为什么木星会有圆环？", "unsupported_question", {}),
        (f"运行 {compare_run} 发生了什么？", "cross_run", {}),
        ("当前事件发生了什么？", "cross_run", {"evidence": [{"run_id": compare_run, "seq": 1}]}),
        ("当前事件发生了什么？", "event_unavailable", {"evidence": [{"run_id": bank, "seq": 99}]}),
    ]:
        answer = advice(local_app, "svb_run", question, **{"run_id": bank, "tick": tick, **other})
        assert answer["kind"] == "insufficient" and answer["unsupported_scope"] == expected
        assert not answer["evidence_ids"] and "999" not in answer["claim"]

    auction = launch_auction(local_app)
    answer = advice(local_app, "double_auction", "S01 的私人成本为多少？", run_id=auction, tick=4)
    assert answer["unsupported_scope"] == "private_information" and answer["citations"] == []
    answer = advice(local_app, "svb_run", "有待付就等于银行破产了？", run_id=bank, tick=tick)
    assert answer["unsupported_scope"] == "premise_to_check" and "流动性" in answer["claim"]


def test_public_observation_roundtrips_exact_id_and_values(local_app):
    bank = launch_bank(local_app, "baseline")
    queue = call(local_app, f"/api/runs/{bank}/classroom-view?tick=checkpoint")
    tick = queue["tick"]
    answer = advice(local_app, "svb_run", f"事件 {tick} 发生了什么？", run_id=bank, tick=tick + 1)
    assert answer["kind"] == "observation" and answer["evidence_ids"] == [f"{bank}:{tick}"]
    assert answer["citations"][0]["tick"] == tick
    for key, label in [("cash", "银行现金"), ("equity", "银行净资产"), ("queued", "等待支付")]:
        assert f'{label}为 {queue["frame"]["metrics"][key]}' in answer["claim"]


def test_online_choices_are_bounded_idempotent_and_fall_back(monkeypatch, tmp_path):
    monkeypatch.setenv("CIVITAS_EDU_DB", str(tmp_path / "runs.sqlite"))
    selected = live_client.PROVIDERS[0]
    evidence = ["audited-event:5"]
    answer = {"intent": "mechanism", "claim": "银行现金为 0。", "next_action": "查看队列。",
              "evidence_ids": evidence, "delivery": "offline"}
    calls = []
    choices = iter([("inspection_first", None), ("银行现金为 999", None), (None, "timeout")])

    def mock_send(provider, pack, allowed):
        calls.append(pack)
        assert provider == selected
        assert set(allowed) == {"observation_first", "inspection_first"}
        action, reason = next(choices)
        return {"action": action, "reason": reason, "actual_model": "mock",
                "usage": None if reason else live_client.make_usage(10, 2, 0)}

    monkeypatch.setattr(live_client, "send", mock_send)
    first = tutor_online.explain_online(api.connect, "first", answer, selected)
    assert first["delivery"] == "online" and first["ordering"] == "inspection_first"
    assert first["claim"] == answer["claim"] and first["evidence_ids"] == evidence
    assert first == tutor_online.explain_online(api.connect, "first", answer, selected)
    for key in ("numbers", "timeout"):
        fallback = tutor_online.explain_online(api.connect, key, answer, selected)
        assert fallback == {**answer, "delivery": "offline_fallback"}
    assert len(calls) == 3
    assert all(set(pack) == {"intent", "claim", "next_action", "evidence_ids"} for pack in calls)
    with closing(api.connect()) as conn:
        assert conn.execute("SELECT reason FROM live_attempts ORDER BY id").fetchall() == [
            (None,), ("invalid_model_output",), ("timeout",)]


def test_explicit_online_request_requires_loopback(local_app):
    payload = {"case_id": "svb_run", "scene": "predict", "question": "给我一个预测提示",
               "online_request_id": str(uuid4())}
    request = Request(local_app + "/api/tutor", headers={"Content-Type": "application/json",
                      "Origin": "https://example.test"}, data=json.dumps(payload).encode())
    with pytest.raises(HTTPError) as blocked:
        urlopen(request, timeout=5)
    assert blocked.value.code == 403
    assert call(local_app, "/api/tutor", payload)["delivery"] == "offline_fallback"


def test_online_tutor_shares_l1_and_l2_currency_ceiling(monkeypatch, tmp_path):
    from services.simulation import live, live_l2

    monkeypatch.setenv("CIVITAS_EDU_DB", str(tmp_path / "runs.sqlite"))
    selected = live_client.PROVIDERS[0]
    ceiling = live.CEILING[selected.currency]
    with closing(api.connect()) as conn, conn:
        live.setup(conn)
        live_l2.setup(conn)
        conn.execute("INSERT INTO live_attempts(run_id,provider,currency,reservation) VALUES (?,?,?,?)",
                     ("run-l1", selected.name, selected.currency, ceiling // 2))
        conn.execute("""INSERT INTO live_l2_attempts(run_id,decision_id,attempt,currency,reservation,input_reserved,output_reserved)
                     VALUES (?,?,?,?,?,?,?)""",
                     ("run-l2", "role", 1, selected.currency, ceiling // 2, 100, 20))
    monkeypatch.setattr(live_client, "send", lambda *_: pytest.fail("admission should prevent transport"))
    answer = {"intent": "mechanism", "claim": "已核验值", "next_action": "查看记录。",
              "evidence_ids": ["run:1"], "delivery": "offline"}
    assert tutor_online.explain_online(api.connect, "budget", answer, selected)["delivery"] == "offline_fallback"
