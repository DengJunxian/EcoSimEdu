"""Verify the three evidence chains from their actual four-stage classrooms."""
import json
import sys
from pathlib import Path
from time import perf_counter

from playwright.sync_api import expect, sync_playwright

from workbench_probe import run_bar, show_pane


BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8776/explore").rstrip("/")
ENGINE = sys.argv[2] if len(sys.argv) > 2 else "chromium"
OUTPUT = Path("output/playwright/v2-04")


def button(page, label):
    page.get_by_role("button", name=label, exact=True).press("Enter")


def lens(page):
    return page.get_by_role("region", name="微观与宏观的证据追踪")


def stage_three(page, case_id, decisions, actor):
    page.goto(f"{BASE}/?lesson={case_id}")
    if case_id == "double_auction":
        page.get_by_label("开局限价（代币）").fill("96")
    for choice in (*decisions, "观察个体决策"):
        button(page, choice)
    show_pane(page, "主体")
    page.get_by_role("combobox", name="选择个体", exact=True).select_option(actor)
    button(page, "单步前进")
    button(page, "观察群体变化")
    expect(page.get_by_role("heading", level=1)).to_have_text("宏微观双屏联动")


def event_table(page):
    details = page.locator("#metric-evidence")
    if not details.evaluate("item => item.open"):
        details.locator("summary").press("Enter")
    expect(details.get_by_role("table")).to_be_visible()
    return details


def auction(page):
    stage_three(page, "double_auction", ("确认限价", "不会成交"), "B01")
    button(page, "播放")
    expect(run_bar(page)).to_contain_text("事件 4 · 已暂停")
    page.get_by_label("追踪指标", exact=True).select_option("volume")
    inspect = lens(page)
    expect(inspect).to_be_visible()
    expect(inspect).to_contain_text("1 − 0 = +1 件")
    expect(inspect).to_contain_text("O001 · B01 报价 96")
    expect(inspect).to_contain_text("O003 · S02 报价 78")
    expect(inspect.get_by_role("button", name="定位事件 5 · B03")).to_have_count(0)
    expect(page.get_by_text("核对成交剩余", exact=True)).to_have_count(0)
    order = inspect.get_by_role("button", name="定位事件 3 · S02")
    if page.viewport_size["width"] < 768:
        order.tap()
    else:
        order.press("Enter")
    expect(run_bar(page)).to_contain_text("事件 3")
    expect(inspect.get_by_role("status")).to_contain_text("已定位：O003")
    expect(inspect.get_by_role("heading", name="微观与宏观的证据追踪")).to_be_focused()
    table = event_table(page)
    button(table, "定位事件 4")
    button(page, "单步前进")
    button(table, "定位事件 4")
    feedback = inspect.get_by_role("button", name="定位事件 5 · B03")
    expect(feedback).to_be_visible()
    feedback.press("Enter")
    expect(inspect).to_contain_text("本次决策记录了本笔成交价 96")
    inspect.get_by_role("radio", name="我的角色").check()
    expect(page.get_by_role("region", name="宏观指标曲线")).to_have_count(0)
    expect(inspect.get_by_role("region", name="微观主体")).to_contain_text("B01")
    expect(inspect).not_to_contain_text("B03")
    inspect.get_by_role("radio", name="系统观察者").check()
    button(event_table(page), "定位事件 4")
    return inspect


def bank(page):
    stage_three(page, "svb_run", ("第一轮提交", "提交申请时"), "D01")
    button(page, "播放")
    expect(run_bar(page)).to_contain_text("第 2 轮 · 已暂停")
    page.get_by_label("追踪指标", exact=True).select_option("cash")
    button(event_table(page), "定位第 1 轮")
    inspect = lens(page)
    inspect.get_by_label("当前轮次的原事件").select_option("1/4")
    expect(inspect).to_contain_text("D01 到账 19")
    expect(inspect).to_contain_text("81 − 100 = -19 资金单位")
    button(inspect, "定位事件 1/2 · D01")
    expect(inspect).to_contain_text("D01 申请 19")
    expect(inspect.get_by_role("status")).to_contain_text("已定位：D01 的 19")
    button(inspect, "定位事件 1/4 · D01")
    expect(inspect).to_contain_text("81 − 100 = -19 资金单位")
    page.reload()
    expect(lens(page).get_by_role("status")).to_contain_text("事件 1/4")
    expect(lens(page)).to_contain_text("81 − 100 = -19 资金单位")
    return inspect


def schelling(page):
    stage_three(page, "schelling_segregation", ("搬到标记的空格", "原址周围和新址周围的住户"), "A001")
    button(page, "前往下一关键事件")
    button(event_table(page), "定位事件 1")
    inspect = lens(page)
    expect(inspect).to_contain_text("A001 从")
    expect(inspect).to_contain_text("529/1051 → 527/1051")
    expect(inspect).to_contain_text("A022 的同组／已占邻居")
    expect(inspect.get_by_role("region", name="微观主体")).to_contain_text("第 11 行第 9 列")
    expect(inspect.get_by_role("button", name="定位事件 11 · B062")).to_have_count(0)
    button(page, "查看运行收尾")
    table = event_table(page)
    assert table.locator("tbody tr").count() <= 24
    button(table, "下一页事件")
    expect(table.get_by_role("button", name="定位事件 24", exact=True)).to_be_visible()
    button(table, "上一页事件")
    button(table, "定位事件 1")
    button(inspect, "定位事件 11 · B062")
    expect(inspect).to_contain_text("搬迁前的邻居计数")
    expect(run_bar(page)).to_contain_text("事件 11")
    source = inspect.get_by_role("button", name="定位事件 1 · B062", exact=True)
    source.press("Enter")
    expect(run_bar(page)).to_contain_text("事件 1")

    times = []
    for event_id in (11, 1, 11, 1, 11, 1):
        start = perf_counter()
        button(table, f"定位事件 {event_id}")
        expect(run_bar(page)).to_contain_text(f"事件 {event_id}")
        times.append(round((perf_counter() - start) * 1000, 2))
    print(f"{ENGINE} 340 residents, revealed 118 frames: six keyboard-to-DOM seeks (ms) {times}", flush=True)
    return inspect


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = getattr(playwright, ENGINE).launch(**({"channel": "chrome"} if ENGINE == "chromium" else {}))
        for width in (390, 1440):
            for walk in (schelling, bank, auction):
                page = browser.new_page(viewport={"width": width, "height": 900}, accept_downloads=True,
                                        reduced_motion="reduce", has_touch=width == 390)
                rejected, errors = [], []
                page.on("pageerror", lambda error: errors.append(str(error)))

                def offline(route):
                    if route.request.method == "GET" and route.request.url.startswith(BASE + "/"):
                        route.continue_()
                    else:
                        rejected.append(route.request.url)
                        route.abort()

                page.route("**/*", offline)
                inspect = walk(page)
                with page.expect_download() as file:
                    button(inspect, "导出当前显微镜证据")
                data = json.loads(Path(file.value.path()).read_text())
                assert data["schema"] == "ecosimedu.microscope/v1"
                assert data["resultDigest"]["value"] and data["runId"] == data["evidence"]["runId"]
                assert all(row["point"]["tick"] <= data["revealedFrame"] for row in data["evidence"]["links"])
                assert "buyer_surplus" not in json.dumps(data)
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                assert not rejected and not errors, (rejected, errors)
                snapshot = inspect.aria_snapshot()
                assert all(label in snapshot for label in ("微观主体", "主体间互动", "宏观结果", "已揭示至"))
                if width == 390:
                    (OUTPUT / f"{ENGINE}-{walk.__name__}-aria.yml").write_text(snapshot)
                inspect.screenshot(path=OUTPUT / f"{ENGINE}-{walk.__name__}-{width}.png")
                print(f"{ENGINE} {width}px {walk.__name__}: verified source, reveal and evidence export", flush=True)
                page.close()
        browser.close()
