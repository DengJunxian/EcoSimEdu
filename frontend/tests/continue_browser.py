"""Continue an offline classroom in the same browser profile on the next day."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8878"
ENGINE = sys.argv[2] if len(sys.argv) > 2 else "chromium"
LEGACY = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8877"
OUTPUT = Path("output/playwright/progressive-continue")
OPTIONS = dict(viewport={"width": 390, "height": 844}, timezone_id="Asia/Shanghai", accept_downloads=True,
               reduced_motion="reduce")
ACTUAL_ID = "double-auction/browser-v1/1962/base/96/0"


def ui(page, role, name):
    return page.get_by_role(role, name=name, exact=isinstance(name, str))


def hit(page, name):
    ui(page, "button", name).press("Enter")


def session(browser, profile, day, log):
    context = browser.launch_persistent_context(profile, **OPTIONS, **({"channel": "chrome"} if ENGINE == "chromium" else {}))
    page = context.pages[0]
    page.clock.set_fixed_time(datetime(2026, 11, day, 3, tzinfo=timezone.utc))
    page.on("pageerror", lambda error: log.append(str(error)))

    def network(route):
        if route.request.method == "GET" and route.request.url.startswith(BASE + "/") and "/api/" not in route.request.url:
            route.continue_()
        else:
            log.append(route.request.url)
            route.abort()

    context.route("**/*", network)
    return context, page


def heading(page, title):
    expect(page.get_by_role("heading", level=1)).to_have_text(title)


def quote_today(page):
    page.goto(BASE)
    ui(page, "link", "从双向拍卖开始").press("Enter")
    page.get_by_label("开局限价（代币）").fill("96")
    hit(page, "确认限价")
    hit(page, "不会成交")
    hit(page, "观察个体决策")
    ui(page, "button", re.compile("你 · 买家 B01")).press("Enter")
    hit(page, "单步前进")
    hit(page, "观察群体变化")
    hit(page, "播放")
    pause = ui(page, "region", "当前成交证据与下一步")
    expect(pause.get_by_text("结算价 96 代币来自在簿订单 O001。")).to_be_in_viewport()
    expect(ui(pause, "button", "查看 O003 原报价")).to_be_in_viewport()
    expect(ui(pause, "button", "下一步 · 查看后续报价")).to_be_in_viewport(ratio=1)
    expect(ui(page, "button", "暂停")).to_be_disabled()
    page.screenshot(path=str(OUTPUT / f"{ENGINE}-today-pause.png"))
    print(f"{ENGINE}: Nov 20 Stage 3 paused at event 4; evidence and next action visible", flush=True)


def continue_tomorrow(page):
    page.goto(BASE)
    expect(ui(page, "heading", "继续上次学习")).to_be_visible()
    expect(page.get_by_text("双向拍卖 · 宏微观双屏联动")).to_be_visible()
    ui(page, "link", "继续上次学习").press("Enter")
    heading(page, "宏微观双屏联动")
    pause = ui(page, "region", "当前成交证据与下一步")
    expect(pause).to_contain_text("你报了 96 代币，预测「不会成交」")
    expect(ui(page, "region", "微观个体画布")).to_contain_text("事件 4")
    expect(ui(page, "button", "暂停")).to_be_disabled()
    page.get_by_text("从指标数值反查事件", exact=True).press("Enter")
    expect(ui(page, "button", "定位事件 5")).to_have_count(0)
    page.get_by_text("从指标数值反查事件", exact=True).press("Enter")
    hit(pause, "查看 O003 原报价")
    expect(pause).to_contain_text("最低卖价 78（O003）")
    hit(pause, "回到已观察到的成交")
    page.screenshot(path=str(OUTPUT / f"{ENGINE}-tomorrow-resumed.png"))

    hit(pause, "下一步 · 查看后续报价")
    expect(ui(pause, "button", "试一项政策")).to_be_in_viewport()
    hit(pause, "试一项政策")
    page.get_by_role("slider").press("End")
    ui(page, "radio", "减少").check()
    hit(page, "运行并验证")
    with page.expect_download() as artifact:
        hit(page, "导出本次运行")
    original = json.loads(Path(artifact.value.path()).read_text())
    assert original["baseline"]["id"] == ACTUAL_ID and original["choices"] == ["96", "no"]
    trade = next(frame for frame in original["comparison"]["run"]["frames"] if frame["record"]["event_type"] == "trade")
    form = ui(page, "region", "用两次运行解释机制")
    form.get_by_label("无干预证据").select_option("4")
    form.get_by_label("政策组证据").select_option(str(trade["tick"]))
    for name, value in {
        "rule": "先到的在簿买单 O001 决定价格。",
        "calculation": "事件4成交1件，实际支付96代币。",
        "difference": "收费组4件，基线6件，相差2件。",
        "hypothesis": "若要解释真实教材市场，还要核对报价与费用制度。",
    }.items():
        form.locator(f"[name={name}]").fill(value)
    hit(form, "保存解释")
    expect(form.get_by_role("status")).to_contain_text("已引用基线事件 4")
    ui(page, "link", "EcoSimEdu").press("Enter")
    ui(page, "link", "实验笔记").press("Enter")
    heading(page, "实验笔记")
    expect(ui(page, "link", "原版实验笔记与学习记录")).to_have_attribute("href", f"{LEGACY}/notes")
    ui(page, "link", "打开已保存的解释").press("Enter")
    expect(page.get_by_text("先到的在簿买单 O001 决定价格。")).to_be_visible()
    page.screenshot(path=str(OUTPUT / f"{ENGINE}-note.png"))
    ui(page, "link", "查看基线原事件 4").press("Enter")
    heading(page, "基线原事件 · 事件 4")
    expect(page.get_by_text(ACTUAL_ID, exact=True)).to_be_visible()
    expect(page.get_by_text("O001 · B01 报 96 代币 · 在簿定价", exact=True)).to_be_visible()
    price = page.get_by_role("row").filter(has_text="成交价（代币/件）")
    expect(price.get_by_role("cell")).to_have_text(["未定义", "96"])
    page.screenshot(path=str(OUTPUT / f"{ENGINE}-event.png"))
    ui(page, "link", "返回已保存的解释").press("Enter")
    ui(page, "link", f"查看政策组原事件 {trade['tick']}").press("Enter")
    heading(page, f"政策组原事件 · 事件 {trade['tick']}")
    expect(page.get_by_text(original["comparison"]["run"]["id"], exact=True)).to_be_visible()
    ui(page, "link", "EcoSimEdu").press("Enter")
    expect(page.get_by_text("双向拍卖 · 反事实与制度实验")).to_be_visible()
    print(f"{ENGINE}: Nov 21 continued at event 4, verified both saved source IDs from Notes", flush=True)


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright, TemporaryDirectory(prefix="ecosim-continue-") as profile:
        errors = []
        browser = getattr(playwright, ENGINE)
        context, page = session(browser, profile, 20, errors)
        try:
            quote_today(page)
        finally:
            context.close()
        tomorrow, page = session(browser, profile, 21, errors)
        try:
            continue_tomorrow(page)
        finally:
            tomorrow.close()
        assert not errors, errors
