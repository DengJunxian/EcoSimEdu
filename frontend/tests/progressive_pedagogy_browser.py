"""Exercise the V2-07 offline learning loop and portable archive in real browsers."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from workbench_probe import run_bar, show_pane


BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8776/explore").rstrip("/")
ENGINE = sys.argv[2] if len(sys.argv) > 2 else "chromium"
WIDTH = int(sys.argv[3]) if len(sys.argv) > 3 else 390
OUT = Path("output/playwright/v2-07") / f"{ENGINE}-{WIDTH}"
OPTIONS = dict(accept_downloads=True, viewport={"width": WIDTH, "height": 900}, timezone_id="Asia/Shanghai",
               reduced_motion="reduce")
LAUNCH = {"channel": "chrome"} if ENGINE == "chromium" else {}
SOURCE_ID = "double-auction/browser-v1/1962/base/96/0"


def find(scope, role, name):
    return scope.get_by_role(role, name=name, exact=True)


def hit(scope, name):
    button = find(scope, "button", name)
    expect(button).to_be_enabled()
    button.press("Enter")


def prepare(context, day, errors):
    def local_only(route):
        request = route.request
        if request.method == "GET" and request.url.startswith(f"{BASE}/") and "/api/" not in request.url:
            route.continue_()
        else:
            errors.append(request.url)
            route.abort()
    context.route("**/*", local_only)
    page = context.pages[0] if context.pages else context.new_page()
    page.clock.set_fixed_time(datetime(2026, 11, day, 3, tzinfo=timezone.utc))
    page.on("pageerror", lambda error: errors.append(str(error)))
    return page


def screenshot(page, label):
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth"), label
    page.screenshot(path=str(OUT / f"{label}.png"))


def audit(page, scope, label):
    if not (source := os.environ.get("ECOSIM_AXE")):
        return
    if not page.evaluate("Boolean(window.axe)"):
        page.add_script_tag(path=source)
    issues = scope.evaluate("""async node => {
      const result = await axe.run(node, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa']}});
      return {version: axe.version, violations: result.violations.map(({id, impact, nodes}) => ({
        id, impact, nodes: nodes.map(node => node.target)
      }))};
    }""")
    (OUT / f"axe-{label}.json").write_text(json.dumps(issues, indent=2))
    assert not issues["violations"], issues


def number_answer(task, answers):
    inputs = task.get_by_role("spinbutton")
    expect(inputs).to_have_count(len(answers))
    for field, value in zip(inputs.all(), answers, strict=True):
        field.fill(str(value))
    hit(task, "提交作答")


def safe_start(page):
    page.goto(BASE + "/")
    expect(find(page, "heading", "自由探索")).to_be_visible()
    find(page, "link", "从双向拍卖开始").press("Enter")
    page.get_by_text("学习目标与七个学习动作", exact=True).press("Enter")
    actions = find(page, "list", "学习动作")
    expect(actions.get_by_role("listitem")).to_have_text(["情境", "预测", "行动", "观察", "解释", "反事实", "迁移"])
    expect(page.locator(".learning-goals > li")).to_have_count(3)
    page.get_by_label("开局限价（代币）").fill("96")
    hit(page, "确认限价")
    hit(page, "不会成交")
    hit(page, "观察个体决策")
    show_pane(page, "主体")
    find(page, "combobox", "选择个体").select_option("B01")
    hit(page, "单步前进")
    hit(page, "观察群体变化")
    feedback = find(page, "region", "原预测反馈")
    expect(feedback).to_have_count(0)
    hit(page, "播放")
    expect(run_bar(page)).to_contain_text("事件 4 · 已暂停")
    expect(feedback).to_contain_text("原预测「不会成交」")
    expect(find(feedback, "heading", "你的预测需要核对")).to_be_visible()
    expect(feedback.get_by_text("已观察到 B01 成交。", exact=True)).to_have_count(0)
    hit(feedback, "看预测提示")
    expect(feedback.get_by_role("status")).to_contain_text("提交限价表示愿意交易，还要等可撮合的对手方")
    expect(find(feedback, "button", "定位预测相关的实际事件 4")).to_be_visible()
    feedback.scroll_into_view_if_needed()
    screenshot(page, "01-wrong-forecast")
    audit(page, feedback, "forecast")


def experiment_and_practice(page):
    hit(page, "快进到收盘")
    hit(page, "试一项政策")
    page.get_by_role("slider").press("End")
    run = find(page, "button", "运行并验证")
    expect(run).to_be_disabled()
    find(page, "radio", "减少").press("Space")
    hit(page, "运行并验证")
    expected = find(page, "region", "反事实对照结果")
    expect(expected).to_contain_text("期末成交量 6 件")
    expect(expected).to_contain_text("期末成交量 4 件")
    form = find(page, "region", "用两次运行解释机制")
    expect(find(page, "region", "独立练习与学习证据")).to_have_count(0)
    for label in ("无干预证据", "政策组证据"):
        form.get_by_label(label).select_option("4")
    for key, value in {
        "claim": "双方收费使这个模拟市场成交量由 6 件减至 4 件。",
        "rule": "限价交叉才撮合，先入簿的 O001 决定首笔结算价。",
        "calculation": "政策组首笔剩余为 6 + 17 + 12 = 35 代币。",
        "difference": "配对运行使用同一种子和限价，收费组成交量比基线少 2 件。",
        "hypothesis": "推广到真实市场前，要核对收费制度与实际资源耗用。",
    }.items():
        form.locator(f"[name={key}]").fill(value)
    hit(form, "保存解释")
    expect(form.get_by_role("status").filter(has_text="已引用基线事件 4")).to_be_visible()
    reflection = find(form, "region", "自评与导师建议")
    reflection.get_by_label("你对这张解释卡的自评").select_option("can_explain")
    hit(reflection, "用原事件生成离线建议")
    expect(reflection.get_by_role("status")).to_contain_text("已保存离线导师建议")
    expect(find(reflection, "link", "核对建议的原事件")).to_be_visible()

    journey = find(page, "region", "独立练习与学习证据")
    find(form, "link", "去做独立练习").press("Enter")
    expect(journey).to_be_in_viewport()
    task = find(journey, "region", "课堂练习")
    expect(find(task, "heading", "练习")).to_be_visible()
    hit(task, "看比较步骤")
    expect(task.locator(".education-status")).to_contain_text("分别核对卖方剩余、平台收入")
    number_answer(task, [0, 0])
    expect(find(task, "heading", "再核对这一步")).to_be_visible()
    expect(task.get_by_text("有帮助或暴露未知。", exact=True)).to_be_visible()
    expect(journey.locator(".learning-goals").get_by_text("有独立应用证据", exact=False)).to_have_count(0)
    hit(task, "下一练习")
    expect(find(task, "heading", "独立应用")).to_be_visible()
    expect(task.get_by_text("价值 103、成本 82、成交价 94", exact=False)).to_be_visible()
    expect(task.locator(".education-feedback")).to_have_count(0)
    expect(task.get_by_text("上次作答已保存", exact=False)).to_have_count(0)
    number_answer(task, [6, 9, 6, 21])
    expect(find(task, "heading", "核对正确")).to_be_visible()
    expect(task.get_by_text("首次无本题帮助。", exact=True)).to_be_visible()
    expect(journey.locator(".learning-goals")).to_contain_text("有独立应用证据 · 复习安排在 2026-11-21")
    page.clock.set_fixed_time(datetime(2026, 11, 20, 3, 1, tzinfo=timezone.utc))
    number_answer(task, [6, 9, 6, 21])
    expect(task.get_by_text("已见同题反馈。", exact=True)).to_be_visible()
    screenshot(page, "02-independent-and-repeat")
    audit(page, journey, "independent")
    page.goto(BASE + "/")
    expect(find(page, "link", "继续上次学习")).to_be_visible()
    expect(find(page, "link", "打开下一课")).to_be_visible()
    expect(find(page, "heading", "复习一道短题")).to_have_count(0)
    print(f"{ENGINE} {WIDTH}px: real auction events, one forecast hint, assisted practice, an unseen independent item and a repeated attempt", flush=True)


def archive_panel(page):
    page.goto(BASE + "/?view=notes")
    page.get_by_text("备份与导入四阶学习", exact=True).press("Enter")
    return page.locator(".progress-backup")


def download(panel, label):
    with panel.page.expect_download() as downloaded:
        hit(panel, label)
    return json.loads(Path(downloaded.value.path()).read_text())


def archive_contents(data):
    return data["progressive"], data["teaching"], {key: value for key, value in data["indexed"].items() if key != "exported_at"}


def upload(panel, data):
    find(panel, "button", "导入四阶学习备份").wait_for()
    panel.get_by_label("四阶学习备份", exact=True).set_input_files({
        "name": "learning.json", "mimeType": "application/json", "buffer": json.dumps(data).encode(),
    })
    hit(panel, "导入四阶学习备份")


def tomorrow(page):
    page.goto(BASE + "/")
    expect(find(page, "heading", "复习一道短题")).to_be_visible()
    expect(page.get_by_text("双向拍卖 · 2026-11-21 到期", exact=True)).to_be_visible()
    screenshot(page, "03-next-day-home")
    find(page, "link", "继续上次学习").press("Enter")
    expect(page.get_by_role("heading", level=1)).to_have_text("反事实与制度实验")
    journey = find(page, "region", "独立练习与学习证据")
    expect(journey.locator(".learning-goals")).to_contain_text("有独立应用证据")
    expect(journey.get_by_text("上次作答已保存 · 已见同题反馈", exact=True)).to_be_visible()
    panel = archive_panel(page)
    full = download(panel, "导出完整学习档案")
    assert full["kind"] == "ecosimedu-learning-bundle/v1"
    study = full["indexed"]
    attempts = [row for row in study["attempts"] if row["item_id"] == "auc-independent"]
    assert {row["evidence_class"] for row in attempts} == {"independent", "repeated"}
    assert len({row["variant_id"] for row in attempts}) == 1
    exact = next(row for row in attempts if row["evidence_class"] == "independent")
    assert exact["exposure"]["max_hint_level"] == 0 and exact["response"] == [6, 9, 6, 21]
    practice = next(row for row in study["attempts"] if row["item_id"] == "auc-complete")
    assert practice["evidence_class"] == "assisted" and practice["exposure"]["max_hint_level"] == 2
    assert [row["due_at"] for row in study["records"]["reviews"]] == ["2026-11-21"]
    assert study["records"]["reviews"][0]["based_on_attempt_ids"] == [exact["id"]]
    teaching = {row["kind"]: row for row in full["teaching"]}
    assert teaching["forecast_exposure"]["level"] == 1
    assert teaching["self_assessment"]["answer"] == "can_explain"
    assert teaching["coach_advice"]["runId"] == SOURCE_ID and teaching["coach_advice"]["eventId"] == "4"
    (OUT / "student-archive.json").write_text(json.dumps(full, ensure_ascii=False, indent=2))

    tampered = deepcopy(full)
    tampered["indexed"]["attempts"][0]["evaluation"] = {"result": "correct", "evaluator": "bogus"}
    upload(panel, tampered)
    expect(panel.get_by_role("alert")).to_contain_text("作答或原评价无法核对")
    expect(panel.get_by_role("alert")).to_contain_text("可下载导入前快照")
    assert archive_contents(download(panel, "导出导入前快照")) == archive_contents(full)
    assert archive_contents(download(panel, "导出完整学习档案")) == archive_contents(full)

    page.goto(BASE + "/")
    find(page, "link", "打开复习").press("Enter")
    expect(page.get_by_role("heading", level=1)).to_have_text("复习")
    question = page.locator("main .education-task")
    expect(question).to_contain_text("价值 120，成本 93，成交价 101")
    audit(page, page.locator("main"), "review")
    number_answer(question, [27])
    expect(page.get_by_text("做过一次独立题后，可在此找下一道复习题。", exact=True)).to_be_visible()
    print(f"{ENGINE} {WIDTH}px: day-two resume and offline review; rejected a changed evaluation and preserved the pre-import snapshot", flush=True)
    return full


def other_response_formats(journey):
    task = find(journey, "region", "课堂练习")
    for answer in ("进入订单簿等待", "保持原值"):
        hit(task, "下一练习")
        find(task, "radio", answer).press("Space")
        hit(task, "提交作答")
        expect(find(task, "heading", "核对正确")).to_be_visible()
    hit(task, "完成本阶段练习")
    hit(task, "继续涌现练习")
    for index, step in enumerate(("step-1", "step-2", "step-3"), start=1):
        task.get_by_label(f"第 {index} 步").select_option(step)
    hit(task, "提交作答")
    expect(find(task, "heading", "核对正确")).to_be_visible()

    find(journey, "radio", "迁移到新情境").press("Space")
    expect(task).to_contain_text("二手教材价值 46 元")
    find(task, "button", "跳过本题").click()
    expect(task).to_contain_text("旧书价值 96")
    find(task, "button", "跳过本题").click()
    expect(task).to_contain_text("寄售平台向卖方收 6 元")
    find(task, "button", "跳过并返回课堂").click()
    hit(task, "继续涌现练习")
    for index, text in enumerate((
        "核对拍卖的首笔成交双边订单，和柠檬市场卖家退出时的保留价。",
        "统一报价低于高质量卖家的保留价，促使部分卖家退出。",
        "价格轨迹相似时，仍需要成交双方事件和退出前后的质量构成。",
    ), start=1):
        task.locator(f"[name=criterion-{index}]").fill(text)
    hit(task, "提交作答")
    expect(find(task, "heading", "已检查解释结构")).to_be_visible()
    print(f"{ENGINE} {WIDTH}px: verified numeric, choice, ordering, evidence pointers, policy prediction and structured transfer", flush=True)


def verify_restore(browser, full, errors):
    context = browser.new_context(**OPTIONS)
    page = prepare(context, 21, errors)
    panel = archive_panel(page)
    page.evaluate("""() => {
      const original = Storage.prototype.setItem;
      window.failArchiveWrite = true;
      Storage.prototype.setItem = function(key, value) {
        if (window.failArchiveWrite && key.startsWith("ecosimedu:teaching:v1:")) throw new DOMException("Test storage exhaustion", "QuotaExceededError");
        return original.call(this, key, value);
      };
    }""")
    upload(panel, full)
    expect(panel.get_by_role("alert")).to_contain_text("浏览器存储空间不足")
    empty = download(panel, "导出完整学习档案")
    assert not empty["indexed"]["attempts"] and not empty["indexed"]["records"]["reviews"]
    assert not empty["progressive"]["entries"] and not empty["teaching"]
    assert archive_contents(download(panel, "导出导入前快照")) == archive_contents(empty)

    page.evaluate("window.failArchiveWrite = false")
    upload(panel, full)
    expect(panel.get_by_role("status")).to_contain_text("档案已导入")
    find(page, "link", "打开已保存的解释").press("Enter")
    expect(page.get_by_text("双方收费使这个模拟市场成交量由 6 件减至 4 件。", exact=True)).to_be_visible()
    find(page, "link", "查看基线原事件 4").press("Enter")
    expect(page.get_by_text(SOURCE_ID, exact=True)).to_be_visible()
    expect(page.get_by_text("已核对保存的版本与运行摘要", exact=True)).to_be_visible()
    screenshot(page, "04-restored-source")
    page.goto(BASE + "/")
    expect(find(page, "heading", "复习一道短题")).to_be_visible()
    find(page, "link", "继续上次学习").press("Enter")
    journey = find(page, "region", "独立练习与学习证据")
    expect(journey).to_contain_text("有独立应用证据")
    other_response_formats(journey)
    task = find(journey, "region", "课堂练习")
    hit(task, "完成本阶段练习")
    hit(task, "重看本阶段练习")
    expect(task).to_contain_text("二手教材价值 46 元")
    page.evaluate("""() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value) {
        if (this.name === "exposures") throw new DOMException("Test exposure write", "QuotaExceededError");
        return put.call(this, value);
      };
    }""")
    hit(task, "看提示")
    expect(task.get_by_role("alert")).to_contain_text("帮助记录保存失败")
    backup = download(archive_panel(page), "导出完整学习档案")
    pack = json.loads(Path("cases/double_auction/learning-v3.json").read_text())
    variant = next(item["variant_id"] for item in pack["items"] if item["id"] == "auc-platform")
    assert not any(row["variant_id"] == variant for row in backup["indexed"]["attempts"])
    assert any(json.loads(entry["id"]) == ["double_auction", variant] and entry["exposure_unknown"]
               for entry in backup["indexed"]["exposures"])
    context.close()

    with browser.new_context(**OPTIONS) as original:
        page = prepare(original, 21, errors)
        panel = archive_panel(page)
        upload(panel, full["indexed"])
        expect(panel.get_by_role("status")).to_contain_text("档案已导入")
        page.goto(BASE + "/")
        expect(find(page, "link", "打开原进度与作答")).to_be_visible()
        expect(find(page, "heading", "复习一道短题")).to_be_visible()
        assert not errors, errors
    print(f"{ENGINE} {WIDTH}px: original IndexedDB archive and complete bundle restored offline; quota failure reverted all new writes", flush=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright, TemporaryDirectory(prefix="ecosim-v207-") as profile:
        engine = getattr(playwright, ENGINE)
        errors = []
        with engine.launch_persistent_context(profile, **LAUNCH, **OPTIONS) as context:
            page = prepare(context, 20, errors)
            safe_start(page)
            experiment_and_practice(page)
        with engine.launch_persistent_context(profile, **LAUNCH, **OPTIONS) as context:
            full = tomorrow(prepare(context, 21, errors))
        with engine.launch(**LAUNCH) as browser:
            verify_restore(browser, full, errors)
        assert not errors, errors
