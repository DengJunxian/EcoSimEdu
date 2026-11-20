from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys

import pytest
from playwright.sync_api import expect, sync_playwright

from services.simulation.lessons import load_case, simulate
from test_lesson_flow import answer, checkpoint, hit, model_app, phase, resume


ROOT = Path(__file__).resolve().parents[2]
GUIDES = json.loads((ROOT / "cases/classroom-guides-v3.json").read_text())
MECHANISMS = {
    "school_matching": ("round_resolution", "微观个体画布", "席位"),
    "lemons_market": ("offer_iteration", "微观个体画布", "开盘挂牌分布"),
    "information_cascade": ("decision", "微观个体画布", "A 箱公共后验"),
    "public_goods": ("settlement", "公共池与小组账本", "公共池"),
    "commons_governance": ("withdrawal", "资源与管护账本", "水域期初存量"),
    "beer_game": ("week_end", "订单与实物在途", "在途"),
    "carbon_market": ("transfer", "减排与配额登记簿", "配额"),
    "gamestop": ("trade", "消息、订单与借券账", "借券"),
    "flash_crash": ("trade", "库存冲击与深度阶梯", "买方"),
}


def expected_answer(item):
    if item["kind"] == "numeric":
        return item["evaluator"]["answers"]
    return next(row["label"] for row in item["response_schema"]["options"]
                if row["id"] == item["evaluator"]["answer"])


def migrated_path(page, base, case_id, audit=None, on_event=None, on_comparison=None, hypothesis=None):
    case = load_case(case_id)
    guide = GUIDES[case_id]
    kind, landmark, words = MECHANISMS[case_id]
    action = case["action"]["default"]
    action_label = next(row["label"] for row in case["action"]["options"] if row["id"] == action)
    baseline = simulate(case, "baseline", case["seed"], action)
    anchor = next(event for event in baseline["events"] if event["event_type"] == kind)
    pack = json.loads((ROOT / f"cases/{case_id}/learning-v3.json").read_text())
    independent = next(item for item in pack["items"] if item["assessment_role"] == "independent")
    transfer = next(item for item in pack["items"] if item["assessment_role"] == "transfer")
    review = next(item for item in pack["items"] if item["assessment_role"] == "review"
                  and item["outcome_ids"] == independent["outcome_ids"])

    page.clock.set_fixed_time(datetime(2026, 11, 20, 5, tzinfo=timezone.utc))
    page.goto(base + "/explore/")
    expect(page.get_by_role("link", name=re.compile(r"^八阶段自学 ·"))).to_have_count(12)
    card = page.locator(f"#lesson-{case_id}")
    expect(card.get_by_role("link", name=re.compile(r"^打开四阶课堂"))).to_have_attribute("href", f"?lesson={case_id}")
    card.get_by_role("link", name=f"八阶段自学 · {case['title']}", exact=True).press("Enter")
    phase(page, 0)
    page.get_by_role("radio", name="新手", exact=True).check()
    expect(page.get_by_text(guide["starter"], exact=True)).to_be_visible()
    page.get_by_role("radio", name="进阶", exact=True).check()
    expect(page.get_by_text(guide["comparison"], exact=True)).to_be_visible()
    hit(page, "进入故事")
    phase(page, 1)
    expect(page.locator("#opening-case-materials")).to_be_visible()
    expect(page.get_by_role("region", name=landmark, exact=True)).to_have_count(0)
    hit(page, "开始预测与决策")
    phase(page, 2)
    expect(page.get_by_role("button", name=action_label, exact=True)).to_have_count(0)
    page.locator(".decision-card button").first.press("Enter")
    draft = checkpoint(page, case_id)
    assert draft["choices"] == [] and draft["flow"]["prediction"]["option"] == "prediction-0"
    page.reload()
    expect(page.get_by_role("status").filter(has_text="已记录预测")).to_be_visible()
    hit(page, action_label)
    hit(page, "观察个体决策")
    phase(page, 3)
    panel = page.get_by_role("region", name=landmark, exact=True)
    expect(panel).to_contain_text(words)
    if audit:
        audit(page, f"wp07-{case_id}", ".workbench")
    actors = page.get_by_role("tab", name="主体", exact=True)
    if actors.is_visible():
        actors.press("Enter")
    page.get_by_role("combobox", name="选择个体", exact=True).select_option(index=1)
    hit(page, "单步前进")
    hit(page, "观察群体变化")
    phase(page, 4)
    expect(page.get_by_text(guide["observation"], exact=True)).to_be_visible()
    hit(page, "查看运行收尾")
    lookup = page.locator("#metric-evidence")
    lookup.locator("summary").press("Enter")
    for _ in range(anchor["seq"] // 24):
        hit(lookup, "下一页事件")
    hit(lookup, f"定位事件 {anchor['seq']}")
    expect(page.get_by_role("region", name="共用回放控制")).to_contain_text(f"事件 {anchor['seq']}")
    assert checkpoint(page, case_id)["cursor"] == anchor["seq"]
    if on_event:
        on_event(page, anchor)
        return
    hit(page, "试一项政策")
    phase(page, 5)
    prediction = page.get_by_role("region", name="预测后运行")
    prediction.get_by_role("slider").press("End")
    expect(prediction.get_by_role("button", name="运行并验证")).to_be_disabled()
    if hypothesis:
        entry = prediction.get_by_role("textbox", name="实验假设（选填）")
        entry.fill(f" {hypothesis} ")
        page.reload()
        expect(entry).to_have_value(f" {hypothesis} ")
    prediction.get_by_role("radio", name="增加", exact=True).check()
    hit(prediction, "运行并验证")
    expect(page.get_by_role("region", name="反事实对照结果")).to_be_visible()
    paired = checkpoint(page, case_id)
    assert paired["runId"] != paired["comparisonId"] and paired["choices"] == [action, "prediction-0"]
    scenario = paired["comparisonId"].rsplit("|", 1)[1]
    comparison = simulate(case, scenario, case["seed"], action)
    alternate = next(event for event in comparison["events"] if event["event_type"] == kind)
    if on_comparison:
        on_comparison(page, paired, anchor, alternate)
        return
    hit(page, "进入独立解释")
    phase(page, 6)
    form = page.get_by_role("region", name="用两次运行解释机制")
    form.get_by_label("无干预证据").select_option(str(anchor["seq"]))
    form.get_by_label("政策组证据").select_option(str(alternate["seq"]))
    for field, value in {
        "claim": guide["observation"], "rule": anchor["summary"],
        "calculation": f"核对基线事件 {anchor['seq']} 和政策组事件 {alternate['seq']} 当时的数值。",
        "difference": guide["comparison"], "hypothesis": "现实中还要核对两组的执行条件。",
    }.items():
        form.locator(f"[name={field}]").fill(value)
    hit(form, "保存解释")
    expect(form.get_by_role("status").filter(has_text="解释已保存在本浏览器")).to_be_visible()
    expect(page.get_by_role("button", name="进入迁移与复习")).to_have_count(0)
    resume(page, base, case_id, 6)
    expect(form.get_by_label("政策组证据")).to_have_value(str(alternate["seq"]))
    task = page.get_by_role("region", name="课堂练习", exact=True)
    expect(task.get_by_role("button", name="跳过本题", exact=True)).to_be_enabled()
    hit(task, "跳过本题")
    expect(task.get_by_role("heading", name="独立应用", exact=True)).to_be_visible()
    answer(task, expected_answer(independent))
    hit(page, "进入迁移与复习")
    phase(page, 7)
    answer(task, expected_answer(transfer))
    expect(task.get_by_text("已有迁移证据", exact=True)).to_be_visible()
    page.clock.set_fixed_time(datetime(2026, 11, 21, 5, tzinfo=timezone.utc))
    page.get_by_role("link", name="查看本机复习安排").press("Enter")
    review_card = page.locator("main .education-task")
    expect(review_card.get_by_role("heading", name=case["title"], exact=True)).to_be_visible()
    answer(review_card, expected_answer(review), practice=False)
    expect(page.get_by_role("status").filter(has_text=review["feedback"]["explanation"])).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")


@pytest.mark.parametrize("case_id", GUIDES)
def test_nine_migrated_classrooms_complete_the_eight_stage_path(offline_classroom_app, launch_education_browser, audit_education, case_id):
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 850})
        requests = []
        page.on("request", lambda request: requests.append(request.url))
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(offline_classroom_app + "/")
                   and "/api/" not in route.request.url else route.abort())
        migrated_path(page, offline_classroom_app, case_id, audit=audit_education)
        assert all(url.startswith(offline_classroom_app + "/") and "/api/" not in url for url in requests)
        if os.environ.get("CIVITAS_V3_PAGES_DIR"):
            expect(page.get_by_role("link", name="AI 导师", exact=True)).to_have_count(0)


def test_migrated_story_tutor_uses_only_published_school_material(model_app, launch_education_browser):
    base, key, calls = model_app
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 850})
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
        page.goto(base + "/explore/?view=ai")
        page.get_by_label("API 密钥").fill(key)
        hit(page, "发送一次连接测试")
        expect(page.get_by_role("status").filter(has_text="连接测试通过")).to_be_visible()
        page.goto(base + "/explore/?lesson=school_matching&flow=v3")
        hit(page, "进入故事")
        story = page.locator("details.briefing-tutor")
        story.locator("summary").press("Enter")
        expect(story.get_by_role("option", name="自由提问")).to_have_count(0)
        story.get_by_role("combobox", name="讲解方式").select_option("hint")
        hit(story, "请求 AI 讲解")
        expect(story.get_by_role("status")).to_contain_text("AI 辅导 · 已核对课程材料")
        expect(story.locator("ol")).to_contain_text(GUIDES["school_matching"]["observation"])
        story.get_by_role("link", name="查看课程来源").press("Enter")
        expect(page.locator("#opening-case-materials summary")).to_be_focused()
        hit(page, "开始预测与决策")
        phase(page, 2)
        expect(story).to_have_count(0)
        assert [call["intent"] for call in calls] == ["hint"]
        assert all(not block["event_seqs"] for block in calls[0]["blocks"].values())


def test_migrated_course_restores_an_existing_four_stage_observation(local_app, launch_education_browser):
    case_id = "information_cascade"
    url = local_app + f"/explore/?lesson={case_id}"
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 850})
        page.goto(url)
        expect(page.get_by_role("navigation", name="八阶段学习进度")).to_have_count(0)
        page.locator(".decision-card button").first.press("Enter")
        page.locator(".decision-card button").first.press("Enter")
        hit(page, "观察个体决策")
        page.get_by_role("tab", name="主体", exact=True).press("Enter")
        page.get_by_role("combobox", name="选择个体", exact=True).select_option("D01")
        hit(page, "单步前进")
        before = checkpoint(page, case_id)
        assert before["cursor"] == before["revealed"] == 1 and "flow" not in before
        page.goto(url + "&flow=v3")
        phase(page, 3)
        expect(page.get_by_role("region", name="共用回放控制")).to_contain_text("事件 1")
        page.get_by_role("tab", name="主体", exact=True).press("Enter")
        expect(page.get_by_role("combobox", name="选择个体", exact=True)).to_have_value("D01")
        expect(page.get_by_role("region", name="行动与公共信念")).to_contain_text("终场揭晓")
        expect(page.get_by_text("真箱为", exact=False)).to_have_count(0)
        assert checkpoint(page, case_id) == before


@pytest.mark.parametrize("case_id,shown", [
    ("information_cascade", "公开 A 箱后验"),
    ("carbon_market", "配额编号"),
    ("flash_crash", "成交（股）"),
])
def test_course_event_tutor_follows_the_selected_published_event(
    model_app, launch_education_browser, audit_education, case_id, shown
):
    base, key, calls = model_app

    def check_event(page, event):
        tutor = page.locator("details.event-tutor")
        expect(tutor).to_be_visible()
        assert not calls
        tutor.locator("summary").press("Enter")
        expect(tutor.get_by_role("option", name="自由提问")).to_have_count(1)
        tutor.get_by_role("combobox", name="讲解方式").select_option("formula")
        with page.expect_request("**/api/ai/tutor/scope") as scope:
            hit(tutor, "请求 AI 讲解")
        payload = scope.value.post_data_json
        assert set(payload) == {"stage", "perspective", "case_id", "case_version", "content_version",
                                "run_id", "event_seq", "digest"}
        assert (payload["case_id"], payload["event_seq"], payload["stage"]) == (case_id, event["seq"], 3)
        expect(tutor.get_by_role("status")).to_contain_text("AI 辅导 · 已核对当前事件")
        expect(tutor.locator("ol")).to_contain_text(shown)
        audit_education(page, f"wp07-event-{case_id}", ".event-tutor")
        before = checkpoint(page, case_id)
        hit(tutor, f"查看原事件 {event['seq']}")
        expect(page.locator("#current-event-evidence summary")).to_be_focused()
        assert checkpoint(page, case_id) == before
        assert len(calls) == 1
        assert {seq for block in calls[0]["blocks"].values() for seq in block["event_seqs"]} == {
            event["seq"] - 1, event["seq"],
        }
        hit(page.get_by_role("group", name="时间轴"), "重置")
        expect(tutor).to_have_count(0)

    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 850})
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
        page.goto(base + "/explore/?view=ai")
        page.get_by_label("API 密钥").fill(key)
        hit(page, "发送一次连接测试")
        expect(page.get_by_role("status").filter(has_text="连接测试通过")).to_be_visible()
        migrated_path(page, base, case_id, on_event=check_event)


@pytest.mark.parametrize("case_id,rule", [
    ("information_cascade", "前序行动不公开"),
    ("school_matching", "即时接受下，本轮录取立即生效"),
    ("carbon_market", "一张编号配额只能有一个持有者"),
])
def test_course_policy_event_question_keeps_the_original_source(
    model_app, launch_education_browser, audit_education, case_id, rule
):
    base, key, calls = model_app

    def check_comparison(page, report, baseline, policy):
        region = page.get_by_role("region", name="对照事件核对")
        picker = region.get_by_role("combobox", name="核对对照事件")
        baseline_events = picker.locator('optgroup[label="基线组"] option').evaluate_all(
            "(options) => options.map(option => Number(option.value.split('/').at(-1)))")
        assert baseline["seq"] in baseline_events and max(baseline_events) <= report["revealed"]
        picker.select_option(f"{report['comparisonId']}/{policy['seq']}")
        tutor = region.locator("details.event-tutor")
        tutor.locator("summary").press("Enter")
        tutor.get_by_role("combobox", name="讲解方式").select_option("question")
        question = tutor.get_by_role("textbox", name="关于当前材料的问题")
        question.fill(f"事件 {policy['seq'] + 1} 为什么发生？")
        hit(tutor, "请求 AI 讲解")
        expect(tutor.get_by_role("status")).to_contain_text("当前材料不足以回答这个问题")
        assert not calls
        question.fill(f"请问事件 {policy['seq']} 为什么发生？")
        with page.expect_request("**/api/ai/tutor/scope") as scope:
            hit(tutor, "请求 AI 讲解")
        assert (scope.value.post_data_json["run_id"], scope.value.post_data_json["event_seq"]) == (
            report["comparisonId"], policy["seq"])
        expect(tutor.get_by_role("status")).to_contain_text("AI 辅导 · 已核对当前事件")
        expect(tutor.locator("ol")).to_contain_text(rule)
        assert len(calls) == 1 and calls[0]["intent"] == "question:explain"
        assert question.input_value() not in str(calls[0])
        hit(tutor, f"查看原事件 {policy['seq']}")
        expect(region.get_by_text(re.compile(rf"^政策组原事件 {policy['seq']} ·"))).to_be_focused()
        if case_id == "information_cascade":
            expect(region.locator("dd").first).to_have_text("50 → 50")
        if case_id == "carbon_market":
            expect(region.locator("dd").nth(2)).to_have_text("、".join(policy["permits"]))
        assert checkpoint(page, case_id) == report
        audit_education(page, f"wp07-policy-{case_id}", '[aria-label="对照事件核对"]')
        picker.select_option(f"{report['runId']}/{baseline['seq']}")
        expect(tutor).not_to_have_attribute("open", "")
        picker.select_option(f"{report['comparisonId']}/{policy['seq']}")
        tutor.locator("summary").press("Enter")
        expect(tutor.locator("ol")).to_have_count(0)
        hit(page, "再做一组对照")
        expect(region).to_have_count(0)

    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 850})
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
        page.goto(base + "/explore/?view=ai")
        page.get_by_label("API 密钥").fill(key)
        hit(page, "发送一次连接测试")
        expect(page.get_by_role("status").filter(has_text="连接测试通过")).to_be_visible()
        migrated_path(page, base, case_id, on_comparison=check_comparison)



def test_guided_hypothesis_survives_reload_and_experiment_card_restore(local_app, launch_education_browser, tmp_path):
    case_id = "carbon_market"
    hypothesis = "当发行量减少，同一种子下企业需要用更多代币完成减排。"

    def check_comparison(page, report, baseline, policy):
        controls = page.get_by_role("region", name="预测后运行")
        entry = controls.get_by_role("textbox", name="实验假设（选填）")
        result = page.get_by_role("region", name="反事实对照结果")
        expect(entry).to_have_count(0)
        assert report["hypothesis"] == hypothesis
        expect(result).to_contain_text(hypothesis)
        advanced = page.get_by_role("link", name="自选参数实验")
        expect(advanced).to_have_attribute("href", f"/compare?case={case_id}")
        expect(page.get_by_role("link", name="多角色模型实验")).to_have_attribute("href", "/experiments/multi-role")
        page.reload()
        expect(result).to_contain_text(hypothesis)
        result.get_by_text("实验卡与结论边界", exact=True).press("Enter")
        with page.expect_download() as download:
            hit(result, "导出实验卡")
        path = tmp_path / "experiment.json"
        download.value.save_as(path)
        card = json.loads(path.read_text())
        pair = card["pairs"][0]
        assert card["plan"]["hypothesis"] == hypothesis
        assert pair["baseline"]["envelope"]["runId"] == report["runId"]
        assert pair["comparison"]["envelope"]["runId"] == report["comparisonId"]
        result.get_by_role("link", name="恢复实验卡").press("Enter")
        page.set_viewport_size({"width": 320, "height": 850})
        upload = page.get_by_label("本课实验卡")
        expect(upload).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        upload.set_input_files(path)
        hit(page, "核对并恢复")
        expect(result).to_contain_text(hypothesis)
        expect(result).to_contain_text("原预测：增加")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 850}, accept_downloads=True)
        migrated_path(page, local_app, case_id, hypothesis=hypothesis, on_comparison=check_comparison)



def test_long_comparison_pages_keep_evidence_reachable(local_app, launch_education_browser, audit_education):
    def check_comparison(page, report, *_):
        result = page.get_by_role("region", name="反事实对照结果")
        summary = result.get_by_text(re.compile(r"^按经济时点查看两组"))
        table = result.get_by_role("table")
        expect(result.locator("tbody tr")).to_have_count(0)
        summary.press("Enter")
        rows = table.locator("tbody tr")
        expect(rows).to_have_count(24)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        tab = "Alt+Tab" if sys.platform == "darwin" and page.context.browser.browser_type.name == "webkit" else "Tab"
        page.keyboard.press(tab)
        pages = result.get_by_role("group", name="对照证据分页")
        previous_page = pages.get_by_role("button", name="上一页")
        next_page = pages.get_by_role("button", name="下一页")
        expect(next_page).to_be_focused()
        for _ in range(8):
            hit(pages, "下一页")
        expect(pages.get_by_role("status")).to_have_text("第 9 / 9 页")
        expect(previous_page).to_be_focused()
        expect(rows).to_have_count(9)
        source = table.get_by_role("button", name=re.compile(r"^查干预原记录")).last
        seq = int(source.inner_text().split()[-1])
        hit(table, f"查干预原记录 {seq}")
        event = table.get_by_role("region", name="原事件证据")
        expect(event).to_contain_text(report["comparisonId"])
        expect(event).to_contain_text(f"原事件 {seq}")
        expect(source).to_have_attribute("aria-expanded", "true")
        held = source.get_attribute("aria-controls")
        assert table.locator("[id=" + json.dumps(held) + "]").get_by_role("region", name="原事件证据").count() == 1
        audit_education(page, f"wp09-long-comparison-{page.viewport_size['width']}", ".study-results")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        for _ in range(8):
            hit(pages, "上一页")
        expect(pages.get_by_role("status")).to_have_text("第 1 / 9 页")
        expect(next_page).to_be_focused()
        expect(event).to_have_count(0)
        expect(rows).to_have_count(24)
        summary.press("Enter")
        expect(result.locator("tbody tr")).to_have_count(0)
        assert checkpoint(page, "flash_crash") == report

    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        for width in (320, 390, 768, 1440):
            page = browser.new_page(viewport={"width": width, "height": 900}, reduced_motion="reduce")
            page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/") else route.abort())
            migrated_path(page, local_app, "flash_crash", on_comparison=check_comparison)
            page.close()
