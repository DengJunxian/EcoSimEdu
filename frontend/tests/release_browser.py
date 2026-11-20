"""Release journeys for three student disciplines and isolated teacher work."""
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from playwright.sync_api import expect, sync_playwright

import progressive_pedagogy_browser as learning
import remaining_browser as remaining
import svb_flagship_browser as svb
from workbench_probe import run_bar

BASE, ENGINE, WIDTH = learning.BASE, learning.ENGINE, learning.WIDTH
ORIGIN = BASE.removesuffix("/explore")
OUT = Path("output/playwright/v2-10") / f"{ENGINE}-{WIDTH}"
find, hit = learning.find, learning.hit


def phase(page, phase_name):
    journey = find(page, "region", "独立练习与学习证据")
    if phase_name == "迁移到新情境":
        find(journey, "radio", phase_name).check()
    return find(journey, "region", "课堂练习")


def answer(task, response):
    if isinstance(response, str):
        find(task, "radio", response).check()
        hit(task, "提交作答")
    else:
        learning.number_answer(task, response)


def independent(page, response):
    task = phase(page, "机制练习与独立应用")
    hit(task, "跳过本题")
    expect(find(task, "heading", "独立应用")).to_be_visible()
    answer(task, response)
    expect(find(task, "heading", "核对正确")).to_be_visible()
    expect(task.get_by_text("首次无本题帮助。", exact=True)).to_be_visible()


def finish(page, title, transfer, review):
    task = phase(page, "迁移到新情境")
    answer(task, transfer)
    expect(find(task, "heading", "核对正确")).to_be_visible()
    expect(task.get_by_text("首次无本题帮助。", exact=True)).to_be_visible()
    expect(task.get_by_text("已有迁移证据", exact=True)).to_be_visible()
    page.clock.set_fixed_time(datetime(2026, 11, 21, 3, tzinfo=timezone.utc))
    find(page, "link", "查看本机复习安排").press("Enter")
    expect(page).to_have_url(BASE + "/?view=review")
    review_card = page.locator("main .education-task")
    expect(find(review_card, "heading", title)).to_be_visible()
    answer(review_card, review)
    expect(page.locator("main").get_by_text("做过一次独立题后，可在此找下一道复习题。")).to_be_visible()
    print(f"{ENGINE} {WIDTH}: {title} — original evidence, explained pair, formal transfer, next-day review", flush=True)


def teacher(browser, work):
    errors = []
    context = browser.new_context(**learning.OPTIONS)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))

    def local_only(route):
        if route.request.url.startswith(ORIGIN + "/"):
            route.continue_()
        else:
            errors.append(route.request.url)
            route.abort()

    context.route("**/*", local_only)
    page.goto(BASE + "/")
    find(page, "link", "教师工作台").press("Enter")
    expect(find(page, "combobox", "教学案例").locator("option")).to_have_count(12)
    find(page, "combobox", "教学案例").select_option("schelling_segregation")
    hit(page, "打开教学案例")
    expect(page).to_have_url(ORIGIN + "/teach?case=schelling_segregation")
    page.get_by_label("展示时长").select_option("40")
    expect(page.locator("#teacher-example")).to_be_empty()
    reveal = find(page, "button", "揭示示范解")
    reveal.press("Enter")
    expect(reveal).to_have_count(0)
    expect(page.locator("#teacher-example")).to_be_visible()
    hit(page, "收起示范解")
    expect(page.locator("#teacher-example")).to_be_empty()
    with page.expect_download() as receipt:
        hit(page, "导出教学预设")
    preset = json.loads(Path(receipt.value.path()).read_text())
    assert preset["case_id"] == "schelling_segregation" and preset["provider_kind"] == "rule"
    assert preset["seed"] == 1971 and preset["presets"]
    assert preset["classroom"]["duration_minutes"] == 40 and preset["classroom"]["solution_initially_hidden"]
    assert preset["classroom"]["phases"][-1] == "notebook"

    holder = context.new_page()
    holder.goto(BASE + "/?view=notes")
    before = learning.archive_contents(learning.download(learning.archive_panel(holder), "导出完整学习档案"))
    find(page, "link", "打开隔离展示课堂").press("Enter")
    expect(find(page, "link", "返回个人课堂")).to_be_visible()
    hit(page, "开始学习")
    expect(page).to_have_url(ORIGIN + "/learn/schelling_segregation?scene=predict&demo=1")
    assert "demo=1" in page.url
    find(page, "radio", "暂不确定").check()
    hit(page, "选择行动")
    hit(page, "运行基础实验")
    hit(page, "播放")
    hit(page, "暂停")
    slider = find(page, "slider", "回放事件")
    expect(slider).to_have_attribute("aria-valuetext", re.compile(r"事件 0$"))
    hit(page, "下一个事件")
    expect(slider).to_have_attribute("aria-valuetext", re.compile(r"事件 1$"))
    hit(page, "快进到结束")
    hit(page, "进入解释")
    demo_task = find(page, "region", "课堂练习")
    expect(demo_task.get_by_text("演示会话", exact=True)).to_be_visible()
    learning.number_answer(demo_task, [5, 60])
    expect(find(demo_task, "heading", "核对正确")).to_be_visible()
    hit(demo_task, "下一练习")
    expect(find(demo_task, "heading", "独立应用")).to_be_visible()
    learning.number_answer(demo_task, [40, 50])
    expect(find(demo_task, "heading", "核对正确")).to_be_visible()
    page.goto(ORIGIN + "/teach?case=schelling_segregation")
    find(page, "link", "查看学生解释作品").press("Enter")

    def import_work(value):
        page.get_by_label("学生解释作品").set_input_files({
            "name": "student-work.json", "mimeType": "application/json",
            "buffer": json.dumps(value).encode(),
        })
        hit(page, "核对并查看作品")

    invalid = deepcopy(work)
    invalid["sourceEvidence"][0]["resultDigest"]["value"] = "0" * 64
    import_work(invalid)
    expect(page.get_by_role("alert")).to_contain_text("无法核对")
    expect(find(page, "heading", "已核对两条运行来源")).to_have_count(0)
    import_work(work)
    expect(find(page, "heading", "已核对两条运行来源")).to_be_focused()
    for label, record in zip(("基线原事件", "政策组原事件"), work["sourceEvidence"], strict=True):
        expect(find(page, "region", label)).to_contain_text(record["runId"])
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    learning.audit(page, page.locator("main"), "teacher-work")
    page.screenshot(path=OUT / "teacher-work.png")
    after = learning.archive_contents(learning.download(learning.archive_panel(holder), "导出完整学习档案"))
    assert before == after, "teacher work entered the personal archive"
    remaining.walk(holder, "schelling_segregation", WIDTH)
    independent(holder, [40, 50])
    assert not errors, errors
    context.close()
    print(f"{ENGINE} {WIDTH}: case, plan, answer reveal, isolated demo, two verified sources, tamper rejection", flush=True)


def stale_tab(browser):
    context = browser.new_context(**learning.OPTIONS)
    page = learning.prepare(context, 20, [])
    learning.safe_start(page)
    older = context.new_page()
    older.goto(page.url)
    expect(run_bar(older)).to_contain_text("事件 4")
    hit(page, "单步前进")
    expect(run_bar(page)).to_contain_text("事件 5")
    hit(older, "后退一步")
    expect(older.get_by_role("status").filter(has_text="另一标签已经更新进度")).to_be_visible()
    hit(older, "载入最新进度")
    expect(run_bar(older)).to_contain_text("事件 5")
    hit(older, "后退一步")
    older.reload()
    expect(run_bar(older)).to_contain_text("事件 4")
    context.close()
    print(f"{ENGINE} {WIDTH}: stale-tab write blocked; intentional rewind restored", flush=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    learning.OUT = OUT
    svb.OUT = OUT
    remaining.OUTPUT = OUT
    with sync_playwright() as pw, getattr(pw, ENGINE).launch(**learning.LAUNCH) as browser:
        errors = []
        context = browser.new_context(**learning.OPTIONS)
        page = learning.prepare(context, 20, errors)
        learning.safe_start(page)
        find(page, "button", "定位预测相关的实际事件 4").press("Enter")
        expect(find(page, "region", "微观与宏观的证据追踪")).to_contain_text("O001")
        learning.experiment_and_practice(page)
        find(page, "link", "继续上次学习").press("Enter")
        finish(page, "双向拍卖", [4, 16], [27])
        context.close()
        context = browser.new_context(**learning.OPTIONS)
        page = learning.prepare(context, 20, errors)
        svb.entry(page)
        svb.bridge(page)
        svb.experiments(page)
        independent(page, [4, 57, 10, 10])
        finish(page, "硅谷银行挤兑", "没有其他资金时缺现金 10，权益尚不能判断", [12])
        context.close()
        context = browser.new_context(**learning.OPTIONS)
        page = learning.prepare(context, 20, errors)
        work = remaining.walk(page, "schelling_segregation", WIDTH)
        (OUT / "student-explanation.json").write_text(json.dumps(work, ensure_ascii=False, indent=2))
        independent(page, [40, 50])
        finish(page, "居住隔离", "2", [50])
        context.close()
        assert not errors, errors
        teacher(browser, work)
        stale_tab(browser)
