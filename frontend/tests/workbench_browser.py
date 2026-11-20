"""Walk the connected foreground UI at the four release widths."""
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from workbench_probe import run_bar, show_pane


ORIGIN = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8776").rstrip("/")
ENGINE = sys.argv[2] if len(sys.argv) > 2 else "chromium"
OUTPUT = Path("output/playwright/v2-03")
HOME = ORIGIN + "/explore/"
AUCTION = HOME + "?lesson=double_auction"
VIEWPORTS = ((320, 568), (390, 844), (768, 960), (1440, 1000))


def role(page, kind, name):
    return page.get_by_role(kind, name=name, exact=True)


def button(page, name):
    return role(page, "button", name)


def heading(page, text):
    expect(page.get_by_role("heading", level=1)).to_have_text(text)


def no_overflow(page):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")


def capture(page, name, width, *, full=False):
    no_overflow(page)
    page.screenshot(path=OUTPUT / f"{ENGINE}-{name}-{width}.png", full_page=full)


def catalog(page, width):
    role(page, "navigation", "主导航").get_by_role("link", name="案例库", exact=True).press("Enter")
    heading(page, "案例库")
    expect(page.get_by_role("status")).to_have_text("12 门案例")
    capture(page, "catalog", width)
    page.get_by_role("searchbox", name="搜索课程").fill("没有这门课")
    expect(page.get_by_role("status")).to_have_text("没有符合条件的案例。")
    button(page, "清除筛选").press("Enter")
    expect(page.get_by_role("status")).to_have_text("12 门案例")
    role(page, "link", "双向拍卖 价格是怎样形成的？").press("Enter")
    heading(page, "价格是怎样形成的？")
    expect(role(page, "region", "学完能做什么")).to_be_visible()
    expect(role(page, "link", "进入课堂")).to_have_attribute("href", "/learn/double_auction")
    course = role(page, "link", "打开四阶课堂")
    expect(course).to_have_css("color", "rgb(255, 253, 246)")
    capture(page, "detail", width)
    course.press("Enter")


def auction(page, width):
    heading(page, "你的报价会以什么价格成交？")
    expect(role(page, "region", "当前学习任务")).to_be_visible()
    page.get_by_label("开局限价（代币）").fill("96")
    for name in ("确认限价", "不会成交", "观察个体决策"):
        button(page, name).press("Enter")
    heading(page, "微观机制透视")
    board = role(page, "region", "微观个体画布")
    expect(board.locator(".actor-fill").first).to_have_css("transition-duration", "0s")
    board.get_by_role("button", name="你 · 买家 B01").press("Enter")
    picker = role(page, "combobox", "选择个体")
    expect(picker).to_have_value("B01")
    if width < 768:
        expect(role(page, "tab", "主体")).to_have_attribute("aria-selected", "true")
        expect(picker).to_be_focused()
    button(page, "单步前进").press("Enter")
    button(page, "观察群体变化").press("Enter")
    heading(page, "宏微观双屏联动")
    show_pane(page, "系统结果")
    macro = role(page, "region", "宏观指标曲线")
    expect(macro.get_by_text("未定义", exact=True).first).to_be_visible()
    expect(macro.get_by_text("已揭示的记录里还没有这项指标的数值。")).to_be_visible()
    button(page, "播放").press("Enter")
    pause = role(page, "region", "当前成交证据与下一步")
    next_quote = button(pause, "下一步 · 查看后续报价")
    expect(pause.get_by_text("结算价 96 代币来自在簿订单 O001。")).to_be_visible()
    expect(button(page, "暂停")).to_be_disabled()
    expect(run_bar(page)).to_contain_text("事件 4 · 已暂停")
    if width < 768:
        expect(next_quote).to_be_in_viewport(ratio=1)
        expect(pause.get_by_text("结算价 96 代币来自在簿订单 O001。")).to_be_in_viewport(ratio=1)
        capture(page, "trade-pause", width)
        show_pane(page, "经济世界")
        world = role(page, "tab", "经济世界")
        world.press("ArrowRight")
        actors = role(page, "tab", "主体")
        expect(actors).to_be_focused()
        expect(actors).to_have_attribute("aria-selected", "true")
        assert actors.evaluate("tab => getComputedStyle(tab).outlineStyle !== 'none' && tab.matches(':focus-visible')")
    else:
        expect(role(page, "tablist", "工作台视图")).to_have_count(0)
        expect(board).to_be_visible()
        expect(macro).to_be_visible()
        capture(page, "trade-pause", width, full=True)

    peers = role(page, "group", "当前事件涉及的主体")
    expect(peers.get_by_role("button")).to_have_count(2)
    peers.get_by_role("button", name="卖家 S02").press("Enter")
    expect(picker).to_have_value("S02")
    expect(role(page, "complementary", "个体决策透视")).to_contain_text("O003")
    if width < 768:
        capture(page, "actors", width)
        role(page, "tab", "主体").press("End")
        expect(role(page, "tab", "系统结果")).to_be_focused()
    expect(macro.get_by_text("96 代币/件", exact=True)).to_be_visible()
    expect(macro.locator("canvas")).to_be_visible()
    if width < 768:
        macro.scroll_into_view_if_needed()
        capture(page, "system", width)
    macro.get_by_role("link", name="按表格查原事件").press("Enter")
    table = page.locator("#metric-evidence").get_by_role("table")
    expect(table).to_be_visible()
    no_overflow(page)
    expect(table.get_by_role("button", name="定位事件 5", exact=True)).to_have_count(0)
    button(table, "定位事件 3").press("Enter")
    expect(run_bar(page)).to_contain_text("事件 3")
    button(table, "定位事件 4").press("Enter")
    expect(run_bar(page)).to_contain_text("事件 4")
    next_quote.press("Enter")
    button(pause, "试一项政策").press("Enter")
    heading(page, "反事实与制度实验")
    execute = button(page, "运行并验证")
    expect(execute).to_be_disabled()
    page.get_by_role("slider").press("End")
    expect(execute).to_be_disabled()
    role(page, "radio", "减少").check()
    execute.press("Enter")
    result = role(page, "region", "反事实对照结果")
    expect(result).to_contain_text("期末成交量 6 件")
    expect(result).to_contain_text("期末成交量 4 件")
    capture(page, "comparison", width)


def failures(browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    held = []
    page.route("**/assets/AuctionClassroom-*.js", lambda route: held.append(route))
    with page.expect_request("**/assets/AuctionClassroom-*.js"):
        page.goto(AUCTION, wait_until="domcontentloaded")
    expect(page.get_by_text("正在打开课堂…")).to_be_visible()
    assert len(held) == 1
    held.pop().abort()
    heading(page, "课堂暂时无法运行")
    page.unroute("**/assets/AuctionClassroom-*.js")
    button(page, "重新载入课堂").press("Enter")
    heading(page, "你的报价会以什么价格成交？")

    key = "ecosimedu:progressive:progress:v1:double_auction"
    page.evaluate("key => localStorage.setItem(key, 'damaged checkpoint')", key)
    page.reload()
    expect(page.get_by_role("alert")).to_contain_text("这份进度无法恢复")
    button(page, "确认限价").press("Enter")
    assert page.evaluate("key => localStorage.getItem(key)", key) == "damaged checkpoint"
    role(page, "link", "开始并保存新练习").press("Enter")
    button(page, "确认限价").press("Enter")
    button(page, "不会成交").press("Enter")
    button(page, "观察个体决策").press("Enter")
    context.set_offline(True)
    expect(page.get_by_text("当前处于离线状态。已打开的规则实验可继续运行。")).to_be_visible()
    button(page, "单步前进").press("Enter")
    expect(run_bar(page)).to_contain_text("事件 1")
    context.set_offline(False)
    no_overflow(page)

    page.goto(ORIGIN + "/experiments")
    expect(page.get_by_text("本机尚未启用模型服务。", exact=False)).to_be_visible()
    expect(button(page, "运行高级实验")).to_have_count(0)
    no_overflow(page)
    context.close()


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = getattr(playwright, ENGINE).launch(**({"channel": "chrome"} if ENGINE == "chromium" else {}))
        for width, height in VIEWPORTS:
            page = browser.new_page(viewport={"width": width, "height": height}, reduced_motion="reduce")
            errors, rejected = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))

            def local_only(route):
                request = route.request
                if request.method == "GET" and request.url.startswith(ORIGIN + "/"):
                    route.continue_()
                else:
                    rejected.append(request.url)
                    route.abort()

            page.route("**/*", local_only)
            page.goto(HOME)
            heading(page, "个人选择，怎样改变市场？")
            expect(page.locator(".map-path")).to_have_count(4)
            expect(page.get_by_role("article")).to_have_count(12)
            expect(role(page, "link", "从双向拍卖开始")).to_be_in_viewport(ratio=1)
            capture(page, "home", width)
            catalog(page, width)
            auction(page, width)
            assert not errors and not rejected, (errors, rejected)
            print(f"{ENGINE} {width}px: home, catalog, detail, real trade, synchronized replay and counterfactual", flush=True)
            page.close()
        failures(browser)
        print(f"{ENGINE}: loading, chunk failure, preserved checkpoint, offline step and model gate", flush=True)
        browser.close()
