"""Walk all migrated courses over static resources, then inspect the downloaded evidence."""
import json
import re
import sys
from time import perf_counter
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from workbench_probe import run_bar, show_pane

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8776/explore").rstrip("/")
ENGINE = sys.argv[2] if len(sys.argv) > 2 else "chromium"
OUTPUT = Path("output/playwright/progressive-complete")
SELECTION = {
    "school_matching": ("truthful", 9, 11),
    "lemons_market": ("list", 6, 24),
    "information_cascade": ("bayes", 10, 0),
    "schelling_segregation": ("move", 84.55, 92.71),
    "public_goods": ("0", 1019, 949.6),
    "commons_governance": ("0", 0, 206.06463104997002),
    "carbon_market": ("0", 1318.5, 3357),
    "beer_game": ("8", 56.98611111111093, 36.45789930555548),
    "gamestop": ("buy", 2, 0),
    "flash_crash": ("tight", 192, 278),
}
METRIC = {
    "school_matching": "first_true_choice", "lemons_market": "traded",
    "information_cascade": "cascade_decisions", "schelling_segregation": "similarity",
    "public_goods": "net_income", "commons_governance": "stock", "carbon_market": "abatement_cost",
    "beer_game": "factory_variance_ratio", "gamestop": "forced_cover", "flash_crash": "program_filled",
}
ANCHOR = {
    "school_matching": "round_resolution", "lemons_market": "offer_iteration", "information_cascade": "decision",
    "schelling_segregation": "student_move", "public_goods": "settlement", "commons_governance": "withdrawal",
    "carbon_market": "transfer", "beer_game": "week_end", "gamestop": "trade", "flash_crash": "trade",
}


def key_button(scope, name):
    scope.get_by_role("button", name=name, exact=True).press("Enter")


def walk(page, case_id, width, inspect=None):
    action, baseline, treatment = SELECTION[case_id]
    definition = json.loads(Path(f"cases/{case_id}/case.json").read_text())
    page.goto(BASE + "/")
    page.locator(f"#lesson-{case_id}").get_by_role("link", name="打开四阶课堂", exact=False).press("Enter")
    expect(page).to_have_url(f"{BASE}/?lesson={case_id}")
    expect(page.get_by_role("slider")).to_have_count(0)
    expect(page.get_by_role("region", name="微观个体画布")).to_have_count(0)
    expect(page.locator("h1")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    key_button(page, next(item["label"] for item in definition["action"]["options"] if item["id"] == action))
    choice = page.locator("fieldset.decision-card").get_by_role("button").first
    expect(choice).to_be_visible()
    choice.press("Enter")
    key_button(page, "观察个体决策")
    expect(page.locator("h1")).to_have_text("微观机制透视")
    board = page.get_by_role("region", name="微观个体画布")
    if case_id == "schelling_segregation":
        key_button(board, "查看 A001")
        expect(page.get_by_role("combobox", name="选择个体")).to_have_value("A001")
    else:
        nodes = board.get_by_role("group", name="选择任一位个体查看决策")
        nodes.get_by_role("button").first.press("Enter")
    inspector = page.get_by_role("complementary", name="个体决策透视")
    expect(inspector).to_contain_text("局部信号")
    clock = page.get_by_role("group", name="时间轴")
    expect(clock.get_by_role("button")).to_have_count(4)
    key_button(clock, "单步前进")
    expect(run_bar(page)).to_contain_text("事件 1")
    if inspect:
        inspect(page, case_id, micro=True)
    key_button(page, "后退一步")
    expect(run_bar(page)).to_contain_text("事件 0")

    key_button(page, "观察群体变化")
    expect(page.locator("h1")).to_have_text("宏微观双屏联动")
    show_pane(page, "系统结果")
    chart = page.get_by_role("region", name="宏观指标曲线")
    expect(chart.locator("canvas")).to_be_visible()
    expect(page.get_by_role("button", name="试一项政策")).to_be_disabled()
    if case_id == "schelling_segregation":
        key_button(clock, "播放")
        expect(page.locator(".turning-point")).to_have_text("首次发生真实搬迁。画布高亮相关个体。")
        expect(clock.get_by_role("button", name="暂停")).to_be_disabled()
        show_pane(page, "经济世界")
        expect(board.locator("svg.resident-tile, svg .resident-tile")).to_have_count(340)
        page.get_by_text("从区间反查搬迁", exact=True).press("Enter")
        expect(page.get_by_text("区间 (0, 1] 共有 1 次搬迁。")).to_be_visible()
        key_button(page, "定位搬迁 1")
        group = page.locator(".range-fields")
        group.get_by_role("spinbutton", name="终点事件").press("ArrowDown")
        expect(page.get_by_role("status").filter(has_text="这个区间没有搬迁记录。")).to_be_visible()
        show_pane(page, "主体")
        expect(inspector).to_contain_text("A001 从")
        if ENGINE == "chromium":
            page.screenshot(path=str(OUTPUT / f"schelling-bridge-{width}.png"), full_page=True)
    else:
        key_button(page, "前往下一关键事件")
        expect(page.locator(".turning-point")).to_be_visible()
        information = {"school_matching": (2, "S01"), "lemons_market": (1, "S01"), "information_cascade": (3, "D03")}
        if case_id in information:
            tick, actor = information[case_id]
            question = page.get_by_role("region", name="从宏观回到个体的证据题")
            correct = question.get_by_role("radio", name=re.compile(rf"^事件 {tick} ·"))
            expect(question.get_by_role("radio")).to_have_count(2)
            incorrect = next(option for option in question.get_by_role("radio").all()
                             if not option.evaluate("(node, prefix) => node.labels[0].textContent.trim().startsWith(prefix)", f"事件 {tick} ·"))
            incorrect.check()
            key_button(question, "核对证据")
            expect(question.get_by_role("status")).to_be_visible()
            expect(question.get_by_role("button", name="打开对应个体与原事件")).to_have_count(0)
            correct.check()
            key_button(question, "核对证据")
            key_button(question, "打开对应个体与原事件")
            expect(run_bar(page)).to_contain_text(f"事件 {tick} · 已暂停")
            expect(page.get_by_role("combobox", name="选择个体")).to_have_value(actor)
            page.reload()
            expect(question.get_by_role("status")).to_be_visible()
            expect(question.get_by_role("button", name="打开对应个体与原事件")).to_be_visible()
        if case_id == "flash_crash":
            key_button(page, "前往下一关键事件")
            show_pane(page, "主体")
            expect(inspector).to_contain_text("撤回剩余买量")
        if case_id == "gamestop":
            show_pane(page, "主体")
            expect(inspector.get_by_role("button", name="回查源事件", exact=False)).to_be_visible()

    if inspect:
        inspect(page, case_id)
    key_button(page, "查看运行收尾")
    page.get_by_text("从指标数值反查事件", exact=True).press("Enter")
    lookup = page.locator(".bridge-evidence")
    expect(lookup.get_by_role("table")).to_be_visible()
    if case_id == "flash_crash":
        expect(lookup.locator("#metric-evidence tbody tr")).to_have_count(24)
        start = perf_counter()
        key_button(lookup, "下一页事件")
        expect(lookup.get_by_role("button", name="定位事件 24", exact=True)).to_be_visible()
        print(f"{ENGINE} {width}px Flash Crash event table: keyboard-to-visible page {(perf_counter() - start) * 1000:.2f} ms", flush=True)
        key_button(lookup, "上一页事件")
    key_button(lookup, "定位事件 1")
    expect(run_bar(page)).to_contain_text("事件 1")
    expect(page.get_by_role("button", name="试一项政策")).to_be_enabled()
    key_button(page, "试一项政策")
    expect(page.locator("h1")).to_have_text("反事实与制度实验")
    run_button = page.get_by_role("button", name="运行并验证")
    expect(run_button).to_be_disabled()
    page.get_by_role("slider").press("End")
    expect(run_button).to_be_disabled()
    page.get_by_role("radio", name="增加" if treatment >= baseline else "减少", exact=True).press("Space")
    run_button.press("Enter")
    expect(page.get_by_role("region", name="反事实对照结果")).to_be_visible()

    form = page.locator(".studio-explanation")
    with page.expect_download() as initial_download:
        key_button(form, "导出两次运行")
    work = json.loads(Path(initial_download.value.path()).read_text())
    left, right = work["observations"]
    assert work["caseId"] == case_id and work["origin"] == "browser_rule_engine"
    assert work["choices"] == [action, "prediction-0"] and left["seed"] == right["seed"] and left["id"] != right["id"]
    values = [side["metrics"][-1][METRIC[case_id]] for side in (left, right)]
    assert abs(values[0] - baseline) < 1e-9 and abs(values[1] - treatment) < 1e-9, (case_id, values)
    first = next(event for event in left["events"] if event["event_type"] == ANCHOR[case_id])
    second = next(event for event in right["events"] if event["event_type"] == ANCHOR[case_id])
    for label, entry in (("无干预证据", first), ("政策组证据", second)):
        form.get_by_label(label).select_option(str(entry["seq"]))

    form.locator("[name=rule]").fill(first["summary"])
    form.locator("[name=calculation]").fill(f"基准这次观察：{values[0]}。")
    form.locator("[name=difference]").fill(f"对照结果 {values[1]} 减基准 {values[0]}。")
    form.locator("[name=hypothesis]").fill("假设实际参与者按课堂所示信息和约束行动，需另外查实。")
    key_button(form, "保存解释")
    status = form.get_by_role("status")
    expect(status).to_contain_text("解释已保存在本浏览器")
    expect(status).to_be_focused()
    assert page.evaluate("Object.keys(localStorage).some(key => key.startsWith('ecosimedu:progressive:explanation:v1:'))")
    with page.expect_download() as submission:
        key_button(form, "导出含解释的结果")
    explained = json.loads(Path(submission.value.path()).read_text())
    assert explained["evidence"][0]["event"] == first and explained["evidence"][1]["event"] == second
    assert explained["evidence"][0]["after"] == left["metrics"][first["seq"]]
    assert explained["evidence"][1]["after"] == right["metrics"][second["seq"]]
    if case_id == "schelling_segregation":
        assert left["events"][0]["data"]["size"] == 20
        assert left["intervention"]["threshold"] == 30 and right["intervention"]["threshold"] == 50
        key_button(page, "再做一组对照")
        page.get_by_role("radio", name="减少", exact=True).press("Space")
        run_button.press("Enter")
        expect(form.locator("[name=rule]")).to_have_value(first["summary"])
        key_button(form, "保存解释")
        form.get_by_text("同条件的历史解释（2 条）", exact=True).press("Enter")
        expect(form.get_by_text("原政策预测：增加", exact=False)).to_be_visible()
        expect(form.get_by_text("原政策预测：减少", exact=False)).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    print(f"{ENGINE} {width}px {case_id}: {values[0]:.4f} → {values[1]:.4f}, verified evidence download", flush=True)
    return explained


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = getattr(playwright, ENGINE).launch(**({"channel": "chrome"} if ENGINE == "chromium" else {}))
        for width in (1180, 390):
            page = browser.new_page(viewport={"width": width, "height": 900}, reduced_motion="reduce", accept_downloads=True)
            errors, rejected = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))

            def local_only(route):
                if route.request.url.startswith(BASE + "/") and "/api/" not in route.request.url and route.request.method == "GET":
                    route.continue_()
                else:
                    rejected.append(route.request.url)
                    route.abort()

            page.route("**/*", local_only)
            for case_id in SELECTION:
                try:
                    walk(page, case_id, width)
                except Exception:
                    page.screenshot(path=str(OUTPUT / f"failure-{ENGINE}-{width}-{case_id}.png"), full_page=True)
                    raise
                assert not errors and not rejected, (errors, rejected)
            page.close()
        browser.close()
