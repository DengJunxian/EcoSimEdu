"""Verify the four-stage lesson and its no-overlap sibling entirely over static assets."""
import json
from pathlib import Path
import sys

from chart_probe import click_turning_point
from playwright.sync_api import expect, sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8878"
engine = sys.argv[2] if len(sys.argv) > 2 else "chromium"


def begin(page, bid, prediction):
    price = page.get_by_label("开局限价（代币）")
    expect(price).to_have_attribute("type", "number")
    price.fill(str(bid))
    page.get_by_role("button", name="确认限价").press("Enter")
    page.get_by_role("button", name=prediction, exact=True).press("Enter")
    page.get_by_role("button", name="观察个体决策").press("Enter")
    expect(page.get_by_role("heading", level=1)).to_have_text("微观机制透视")
    board = page.get_by_role("region", name="微观个体画布")
    expect(board.locator("svg").get_by_role("button")).to_have_count(20)
    board.get_by_role("button", name="你 · 买家 B01", exact=False).press("Enter")
    clock = page.get_by_role("group", name="时间轴")
    expect(clock.get_by_role("button")).to_have_count(4)
    clock.get_by_role("button", name="单步前进").press("Enter")
    expect(board.get_by_text("事件 1", exact=True)).to_be_visible()
    expect(page.get_by_role("complementary", name="个体决策透视")).to_contain_text(f"限价 {bid} 代币")
    page.get_by_role("button", name="后退一步").press("Enter")
    expect(board.get_by_text("事件 0", exact=True)).to_be_visible()
    page.get_by_role("button", name="观察群体变化").press("Enter")
    expect(page.get_by_role("heading", level=1)).to_have_text("宏微观双屏联动")
    return board, clock


def compare(page, prediction):
    page.get_by_role("button", name="试一项政策").press("Enter")
    execute = page.get_by_role("button", name="运行并验证")
    expect(execute).to_be_disabled()
    page.get_by_role("slider").fill("6")
    expect(execute).to_be_disabled()
    page.get_by_role("radio", name=prediction, exact=True).check()
    execute.press("Enter")
    with page.expect_download() as downloading:
        page.get_by_role("button", name="导出本次运行").click()
    return json.loads(Path(downloading.value.path()).read_text())


def walk(page):
    page.goto(base)
    page.get_by_role("link", name="从双向拍卖开始").click()
    expect(page.get_by_role("heading", level=1)).to_have_text("你的报价会以什么价格成交？")
    expect(page.get_by_role("slider")).to_have_count(0)
    expect(page.get_by_role("region", name="微观个体画布")).to_have_count(0)
    board, clock = begin(page, 96, "会成交")
    macro = page.get_by_role("region", name="宏观指标曲线")
    expect(macro.locator("canvas")).to_be_visible()
    clock.get_by_role("button", name="播放", exact=True).click()
    expect(page.locator(".turning-point")).to_contain_text("首次成交 96")
    expect(clock.get_by_role("button", name="暂停")).to_be_disabled()
    expect(board.locator(".actor-contributor")).to_have_count(2)
    evidence = page.get_by_role("region", name="订单与成交证据")
    expect(evidence).to_contain_text("O003 S02 报 78")
    expect(evidence).to_contain_text("结算价 96 代币来自在簿订单 O001")
    evidence.get_by_role("button", name="查看 O003 原报价").press("Enter")
    expect(board.get_by_text("事件 3", exact=True)).to_be_visible()
    click_turning_point(macro.locator("canvas"))
    expect(board.get_by_text("事件 4", exact=True)).to_be_visible()
    clock.get_by_role("button", name="单步前进").press("Enter")
    board.get_by_role("button", name="买家 B03", exact=False).press("Enter")
    inspector = page.get_by_role("complementary", name="个体决策透视")
    expect(inspector).to_contain_text("最近成交价 96 代币，来自事件 4")
    inspector.get_by_role("button", name="查看作为参考的成交事件 4").press("Enter")
    expect(board.get_by_text("事件 4", exact=True)).to_be_visible()

    record = compare(page, "减少")
    expect(page.get_by_text("期末成交量 6 件")).to_be_visible()
    expect(page.get_by_text("期末成交量 4 件")).to_be_visible()
    assert record["choices"] == ["96", "yes"]
    assert record["comparison"]["prediction"] == "down"
    assert record["baseline"]["frames"][4]["record"]["maker_order_id"] == "O001"
    assert record["comparison"]["run"]["frames"][-1]["metrics"]["platform_cash"] == 48

    page.get_by_role("link", name="试一试供需无交叠").click()
    expect(page.get_by_role("heading", level=1)).to_have_text("买卖两边都报价，为什么没有成交？")
    board, clock = begin(page, 35, "不会成交")
    clock.get_by_role("button", name="播放", exact=True).click()
    expect(page.locator(".turning-point")).to_contain_text("最高买价 35 低于最低卖价 78")
    page.get_by_role("button", name="快进到收盘").press("Enter")
    expect(evidence).to_contain_text("成交量 0，成交价未定义")
    expect(evidence).to_contain_text("效率未定义")
    record = compare(page, "不变")
    close = record["baseline"]["frames"][-1]
    assert close["book"] == []
    assert close["metrics"]["price"] is None and close["metrics"]["efficiency"] is None
    assert close["metrics"]["volume"] == 0
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")


with sync_playwright() as playwright:
    browser = getattr(playwright, engine).launch(**({"channel": "chrome"} if engine == "chromium" else {}))
    for width in (1180, 390):
        page = browser.new_page(viewport={"width": width, "height": 920}, accept_downloads=True)
        errors, unexpected = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def local_only(route):
            url = route.request.url
            if url.startswith(base + "/") and "/api/" not in url and route.request.method == "GET":
                route.continue_()
            else:
                unexpected.append(url)
                route.abort()

        page.route("**/*", local_only)
        walk(page)
        assert not errors and not unexpected, (errors, unexpected)
        print(f"{engine} {width}px: four stages, order and price lookup, both comparisons, and exports")
        page.close()
    browser.close()
