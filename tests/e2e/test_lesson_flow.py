from collections import deque
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from threading import Thread
from time import monotonic, sleep

import pytest
import uvicorn
from playwright.sync_api import expect, sync_playwright


CASES = {
    "schelling_segregation": ("居住隔离", "A001", [40, 50], "2", [50]),
    "svb_run": ("硅谷银行挤兑", "D01", [4, 57, 10, 10], "没有其他资金时缺现金 10，权益尚不能判断", [12]),
    "double_auction": ("双向拍卖", "B01", [6, 9, 6, 21], [4, 16], [27]),
}
REVIEW_QUESTIONS = {
    "schelling_segregation": "请写出同组邻接比例的分子和分母",
    "svb_run": "请用这两笔事件的前后账表核算一项变化",
    "double_auction": "请用原事件中的报价或账表核算差值",
}
STEPS = ["预备", "故事", "预测与决策", "仿真观察", "机制与涌现", "反事实实验", "独立解释", "迁移与复习"]


@pytest.fixture
def model_app(monkeypatch, tmp_path):
    from services.simulation import live_client
    from services.simulation.ai import router as study_sessions

    monkeypatch.setattr(study_sessions, "_sessions", {})
    monkeypatch.setattr(study_sessions, "_attempts", {name: deque() for name in study_sessions.PROFILES})
    monkeypatch.setenv("CIVITAS_EDU_DB", str(tmp_path / "model.sqlite"))
    from services.simulation.api import app

    provider_calls = []
    key = "fixture-key-for-v3"
    monkeypatch.setattr(live_client, "probe", lambda profile, token: {"reason": None, "usage": None})

    def compose(profile, token, observation):
        assert token == key and profile.name == "openai"
        provider_calls.append(observation)
        blocks = list(dict.fromkeys([*observation["required"], *observation["blocks"]]))
        question = "calculation" if observation["intent"] == "review_explanation" else next(iter(observation["questions"]))
        return {"selection": {"steps": blocks[:2], "question": question},
                "reason": None, "usage": None}

    monkeypatch.setattr(live_client, "compose_lesson", compose)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning"))
    worker = Thread(target=server.run, daemon=True)
    worker.start()
    try:
        deadline = monotonic() + 10
        while not server.started and worker.is_alive() and monotonic() < deadline:
            sleep(.02)
        assert server.started
        port = server.servers[0].sockets[0].getsockname()[1]
        yield f"http://127.0.0.1:{port}", key, provider_calls
    finally:
        server.should_exit = True
        worker.join(timeout=5)


def hit(scope, name):
    scope.get_by_role("button", name=name, exact=True).press("Enter")


def checkpoint(page, case):
    return page.evaluate("(id) => JSON.parse(localStorage.getItem('ecosimedu:progressive:progress:v1:' + id))", case)


def phase(page, chapter):
    expect(page.get_by_role("navigation", name="八阶段学习进度").locator('[aria-current="step"]')).to_contain_text(STEPS[chapter])


def resume(page, base, case, chapter):
    page.goto(base + "/explore/")
    link = page.get_by_role("link", name="继续上次学习")
    expect(link).to_have_attribute("href", f"?lesson={case}&flow=v3")
    link.press("Enter")
    phase(page, chapter)


def answer(task, response, *, practice=True):
    if isinstance(response, str):
        task.get_by_role("radio", name=response, exact=True).check()
    else:
        fields = task.get_by_role("spinbutton")
        expect(fields).to_have_count(len(response))
        for field, value in zip(fields.all(), response, strict=True):
            field.fill(str(value))
    hit(task, "提交作答")
    if practice:
        expect(task.get_by_role("heading", name="核对正确")).to_be_visible()
        expect(task.get_by_text("首次无本题帮助。", exact=True)).to_be_visible()


def complete(page, base, case, *, model=False, prepare_review=None, on_review=None):
    title, actor, independent, transfer, review = CASES[case]
    page.clock.set_fixed_time(datetime(2026, 11, 20, 2, tzinfo=timezone.utc))
    page.goto(base + "/explore/")
    page.locator(f"#lesson-{case}").get_by_role("link", name=f"八阶段自学 · {title}").press("Enter")
    phase(page, 0)
    level = {"schelling_segregation": "新手", "svb_run": "标准", "double_auction": "进阶"}[case]
    page.get_by_role("radio", name=level, exact=True).check()
    hit(page, "进入故事")
    resume(page, base, case, 1)
    assert checkpoint(page, case)["flow"]["level"] == level
    expect(page.get_by_role("region", name="微观个体画布")).to_have_count(0)

    if model and case == "schelling_segregation":
        story = page.locator("details.story-tutor")
        story.locator("summary").press("Enter")
        hit(story, "请求 AI 讲解")
        expect(story.get_by_role("status")).to_contain_text("AI 辅导")
        expect(story.locator("ol")).to_contain_text("A001")

    hit(page, "开始预测与决策")
    phase(page, 2)
    if case == "double_auction":
        page.get_by_label("开局限价（代币）").fill("96")
        hit(page, "确认限价")
        hit(page, "不会成交")
    else:
        prediction, action = (("原址周围和新址周围的住户", "搬到标记的空格") if case == "schelling_segregation"
                              else ("提交申请时", "第一轮提交"))
        expect(page.get_by_role("button", name=action, exact=True)).to_have_count(0)
        hit(page, prediction)
        expect(page.locator("fieldset.decision-card legend")).to_be_focused()
        draft = checkpoint(page, case)
        assert draft["choices"] == [] and draft["flow"]["prediction"]["at"] > 0
        page.reload()
        expect(page.get_by_role("status").filter(has_text="已记录预测")).to_contain_text(prediction)
        hit(page, action)
        assert checkpoint(page, case)["flow"]["prediction"] == draft["flow"]["prediction"]

    hit(page, "观察个体决策")
    phase(page, 3)
    if case == "schelling_segregation":
        hit(page, f"查看 {actor}")
    else:
        tab = page.get_by_role("tab", name="主体", exact=True)
        if tab.is_visible():
            tab.press("Enter")
        page.get_by_role("combobox", name="选择个体", exact=True).select_option(actor)
    hit(page, "单步前进")
    hit(page, "观察群体变化")
    phase(page, 4)
    bar = page.get_by_role("region", name="共用回放控制")
    expect(bar).to_contain_text("事件 0" if case != "svb_run" else "第 0 轮")
    before_recap = checkpoint(page, case)
    page.get_by_role("navigation", name="八阶段学习进度").get_by_role("button", name="仿真观察").press("Enter")
    expect(page.get_by_role("heading", level=1, name="仿真观察")).to_be_focused()
    expect(page.get_by_role("region", name="回看已完成阶段")).to_contain_text("观察对象")
    expect(bar).to_have_count(0)
    expect(page.locator(".relocation-tutor")).to_have_count(0)
    hit(page, "返回当前学习阶段")
    assert checkpoint(page, case) == before_recap
    page.reload()
    phase(page, 4)
    expect(bar).to_contain_text("事件 0" if case != "svb_run" else "第 0 轮")

    if model and case == "schelling_segregation":
        hit(page, "单步前进")
        tutor = page.locator("details.relocation-tutor")
        tutor.locator("summary").press("Enter")
        tutor.get_by_role("combobox", name="讲解方式").select_option("formula")
        hit(tutor, "请求 AI 讲解")
        expect(tutor.get_by_role("status")).to_contain_text("AI 辅导")

    if case == "schelling_segregation":
        hit(page, "查看运行收尾")
    elif case == "double_auction":
        hit(page, "快进到收盘")
    else:
        for _ in range(3):
            hit(page, "单步前进")
    hit(page, "试一项政策")
    phase(page, 5)
    panel = page.get_by_role("region", name="预测后运行")
    panel.get_by_role("slider").press("End")
    expect(panel.get_by_role("button", name="运行并验证")).to_be_disabled()
    panel.get_by_role("radio", name="增加" if case == "schelling_segregation" else "减少", exact=True).check()
    hit(panel, "运行并验证")
    expect(page.get_by_role("region", name="反事实对照结果")).to_be_visible()
    resume(page, base, case, 5)
    expect(page.get_by_role("region", name="反事实对照结果")).to_be_visible()
    if model and case == "schelling_segregation":
        pair = page.locator("details.pair-tutor")
        pair.locator("summary").press("Enter")
        pair.get_by_role("combobox", name="讲解方式").select_option("hint")
        hit(pair, "请求 AI 讲解")
        expect(pair.get_by_role("status")).to_contain_text("AI 辅导")
        expect(pair.get_by_role("link", name="核对干预收尾", exact=False)).to_be_visible()
    hit(page, "进入独立解释")
    phase(page, 6)
    form = page.get_by_role("region", name="用两次运行解释机制")
    for label in ("无干预证据", "政策组证据"):
        event = form.get_by_label(label)
        event.select_option(index=2)
    for field, value in {
        "claim": "两次课堂运行的结果可以比较。",
        "rule": "制度参数改变主体采取行动时面对的约束。",
        "calculation": "在相同口径下用实验组读数减去基线组读数。",
        "difference": "两组共同保留初始场景和学生决定。",
        "hypothesis": "推广到现实要另行核对制度和观察数据。",
    }.items():
        form.locator(f"[name={field}]").fill(value)
    hit(form, "保存解释")
    expect(form.get_by_role("status").filter(has_text="解释已保存在本浏览器")).to_be_visible()
    expect(page.get_by_role("button", name="进入迁移与复习")).to_have_count(0)
    page.reload()
    phase(page, 6)
    expect(form.locator("[name=claim]")).to_have_value("两次课堂运行的结果可以比较。")
    if model:
        panel = form.locator("details").filter(has=page.get_by_text("在线解释审阅", exact=True))
        panel.locator("summary").press("Enter")
        hit(panel, "请 AI 审阅")
        expect(panel.get_by_role("status")).to_contain_text(f"AI 选出的追问 · {REVIEW_QUESTIONS[case]}")
        expect(panel.get_by_role("link", name="查看追问的政策组证据")).to_be_visible()
        expect(page.get_by_role("button", name="进入迁移与复习")).to_have_count(0)
    task = page.get_by_role("region", name="课堂练习", exact=True)
    skip = task.get_by_role("button", name="跳过本题", exact=True)
    expect(skip).to_be_enabled()
    skip.press("Enter")
    expect(task.get_by_role("heading", name="独立应用", exact=False)).to_be_visible()
    if prepare_review:
        prepare_review(task, independent)
    else:
        answer(task, independent)
    hit(page, "进入迁移与复习")
    phase(page, 7)
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    resume(page, base, case, 7)
    answer(task, transfer)
    expect(task.get_by_text("已有迁移证据", exact=True)).to_be_visible()
    page.clock.set_fixed_time(datetime(2026, 11, 21, 3, tzinfo=timezone.utc))
    page.get_by_role("link", name="查看本机复习安排").press("Enter")
    review_card = page.locator("main .education-task")
    expect(review_card.get_by_role("heading", name=title)).to_be_visible()
    if on_review:
        on_review(page, review_card)
        return
    answer(review_card, review, practice=False)
    expect(page.locator("main").get_by_text("做过一次独立题后，可在此找下一道复习题。")).to_be_visible()


@pytest.mark.parametrize("case,width", [("schelling_segregation", 320), ("svb_run", 390), ("double_auction", 1440)])
def test_flagship_eight_stage_course_offline(offline_classroom_app, launch_education_browser, case, width):
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": width, "height": 850})
        errors = []
        requests = []
        page.on("request", lambda request: requests.append(request.url))
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(offline_classroom_app + "/")
                   and "/api/ai/" not in route.request.url else route.abort())
        complete(page, offline_classroom_app, case)
        assert not errors
        if os.environ.get("CIVITAS_V3_PAGES_DIR"):
            assert all(url.startswith(offline_classroom_app + "/") and "/api/" not in url for url in requests)
            expect(page.get_by_role("link", name="AI 导师", exact=True)).to_have_count(0)


@pytest.mark.parametrize("case", CASES)
def test_flagship_eight_stage_course_with_connected_model(model_app, launch_education_browser, case):
    base, key, provider_calls = model_app
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 850})
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
        page.goto(base + "/explore/?view=ai")
        page.get_by_label("API 密钥").fill(key)
        hit(page, "发送一次连接测试")
        expect(page.get_by_role("status").filter(has_text="连接测试通过")).to_be_visible()
        complete(page, base, case, model=True)
        intents = ["explain", "formula", "hint"] if case == "schelling_segregation" else []
        assert [call["intent"] for call in provider_calls] == [*intents, "review_explanation"]


@pytest.mark.parametrize("case,assisted,answers", [
    ("double_auction", False, [8, 33]),
    ("svb_run", True, [5, 9, 11]),
])
def test_adaptive_review_tracks_real_attempts_and_restores(model_app, launch_education_browser, audit_education,
                                                           case, assisted, answers):
    base, key, provider_calls = model_app
    review_api = "**/api/ai/review/recommendation"

    def prepare_review(task, independent):
        if assisted:
            hit(task, "看提示")
        answer(task, independent if assisted else [0] * len(independent), practice=False)
        expect(task.get_by_role("heading", name="核对正确" if assisted else "再核对这一步")).to_be_visible()

    def on_review(page, card):
        reason = "上次作答用过提示" if assisted else "上次作答有待核对"
        expect(card.get_by_text(reason, exact=False)).to_be_visible()
        expect(card.get_by_role("spinbutton")).to_have_count(len(answers))
        assert not provider_calls
        panel = card.locator("details")
        panel.locator("summary").press("Enter")
        page.route(review_api, lambda route: route.abort())
        hit(panel, "请 AI 选题")
        expect(panel.get_by_role("status")).to_contain_text("可继续当前复习题")
        expect(card.get_by_role("spinbutton")).to_have_count(len(answers))
        page.unroute(review_api)

        with page.expect_request(review_api) as sent:
            hit(panel, "请 AI 选题")
        expect(panel.get_by_role("status")).to_contain_text("已切换到 AI 推荐的题目")
        assert sent.value.post_data_json == {
            "confirm": True, "case_id": case, "content_version": "1.0.0", "outcome_id": f"{case}.1",
            "signal": {"result": "correct" if assisted else "incorrect", "used_hint": assisted,
                       "evidence": "assisted" if assisted else "independent"},
        }
        expect(card.get_by_role("spinbutton")).to_have_count(1)
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
        audit_education(page, f"dynamic-review-{case}", ".education-task")
        page.reload()
        expect(card.get_by_role("spinbutton")).to_have_count(len(answers))
        if not assisted:
            stale = page.context.new_page()
            stale.clock.set_fixed_time(datetime(2026, 11, 21, 3, tzinfo=timezone.utc))
            stale.goto(page.url)
            stale_card = stale.locator("main .education-task")
            expect(stale_card.get_by_role("spinbutton")).to_have_count(len(answers))
            hit(page, "推迟复习")
            expect(page.get_by_text("当前没有到期的复习。")).to_be_visible()
            answer(stale_card, answers, practice=False)
            expect(stale.get_by_role("status").filter(has_text="复习作答未保存")).to_be_visible()
            stale.close()
            page.clock.set_fixed_time(datetime(2026, 11, 22, 3, tzinfo=timezone.utc))
            page.reload()
        hit(card, "看复习提示")
        answer(card, answers, practice=False)
        expect(page.get_by_text("做过一次独立题后，可在此找下一道复习题。")).to_be_visible()

    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        context = browser.new_context(viewport={"width": 320, "height": 850}, accept_downloads=True)
        page = context.new_page()
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
        page.goto(base + "/explore/?view=ai")
        page.get_by_label("API 密钥").fill(key)
        hit(page, "发送一次连接测试")
        expect(page.get_by_role("status").filter(has_text="连接测试通过")).to_be_visible()
        complete(page, base, case, prepare_review=prepare_review, on_review=on_review)
        assert [call["intent"] for call in provider_calls] == ["review_recommendation"]
        page.goto(base + "/explore/?view=notes")
        backup = page.locator(".progress-backup")
        backup.locator("summary").press("Enter")
        with page.expect_download() as downloaded:
            hit(backup, "导出完整学习档案")
        path = Path(downloaded.value.path())
        indexed = json.loads(path.read_text())["indexed"]
        review, = [entry for entry in indexed["attempts"] if entry["assessment_role"] == "review"]
        assert review["item_id"] == "review-1-reinforce" and review["response"] == answers
        assert review["evaluation"]["result"] == "correct" and review["evidence_class"] == "assisted"
        assert review["exposure"]["max_hint_level"] == 1
        assert [entry["status"] for entry in indexed["records"]["reviews"]] == ["completed"]
        other = browser.new_context(viewport={"width": 320, "height": 850})
        restored = other.new_page()
        restored.goto(base + "/explore/?view=notes")
        backup = restored.locator(".progress-backup")
        backup.locator("summary").press("Enter")
        backup.get_by_label("四阶学习备份").set_input_files(path)
        hit(backup, "导入四阶学习备份")
        expect(backup.get_by_role("status")).to_contain_text(f"{len(indexed['attempts'])} 次作答")
        restored.goto(base + "/explore/?view=review")
        expect(restored.get_by_text("做过一次独立题后，可在此找下一道复习题。")).to_be_visible()
