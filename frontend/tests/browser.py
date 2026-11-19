"""Exercise the built preview from a fresh browser at two viewport sizes."""
import sys

from chart_probe import click_turning_point
from playwright.sync_api import expect, sync_playwright


base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8776/explore").rstrip("/")
engine = sys.argv[2] if len(sys.argv) > 2 else "chromium"

with sync_playwright() as playwright:
    browser = getattr(playwright, engine).launch(**({"channel": "chrome"} if engine == "chromium" else {}))
    for width in (1180, 390):
        page = browser.new_page(viewport={"width": width, "height": 920}, reduced_motion="reduce")
        errors, external = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def local_only(route):
            if (route.request.url.startswith(base + "/") and route.request.method == "GET"
                    and not route.request.url.startswith(base + "/api/")):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        page.route("**/*", local_only)
        page.goto(base + "/?lesson=demo")
        heading = page.get_by_role("heading", level=1)
        expect(heading).to_have_text("一把工具，要等多久？")
        expect(page.get_by_text("脚手架练习 · 虚构社区", exact=False)).to_be_visible()
        expect(page.get_by_role("slider")).to_have_count(0)
        expect(page.get_by_role("region", name="微观个体画布")).to_have_count(0)
        expect(page.get_by_role("region", name="宏观指标曲线")).to_have_count(0)

        page.get_by_role("button", name="第 2 轮再申请").press("Enter")
        page.get_by_role("button", name="等 1 轮就换办法").press("Enter")
        begin = page.get_by_role("button", name="观察个体决策")
        expect(begin).to_be_focused()
        begin.press("Enter")
        expect(heading).to_have_text("微观机制透视")
        expect(heading).to_be_focused()
        board = page.get_by_role("region", name="微观个体画布")
        expect(board.get_by_role("button")).to_have_count(24)
        board.get_by_role("button", name="你 · 小林", exact=False).press("Enter")
        inspector = page.get_by_role("complementary", name="个体决策透视")
        expect(inspector).to_contain_text("第 2 轮申请")
        clock = page.get_by_role("group", name="时间轴")
        expect(clock.get_by_role("button")).to_have_count(4)
        clock.get_by_role("button", name="单步前进").press("Enter")
        expect(board.get_by_text("第 1 轮")).to_be_visible()
        page.get_by_role("button", name="后退一步").press("Enter")
        expect(board.get_by_text("第 0 轮")).to_be_visible()
        clock.get_by_role("button", name="单步前进").press("Enter")
        page.get_by_role("button", name="观察群体变化").press("Enter")
        expect(heading).to_have_text("宏微观双屏联动")

        macro = page.get_by_role("region", name="宏观指标曲线")
        expect(macro.locator("canvas")).to_be_visible()
        clock.get_by_role("button", name="播放").click()
        expect(page.locator(".turning-point")).to_contain_text("拥挤阈值")
        expect(clock.get_by_role("button", name="暂停")).to_be_disabled()
        expect(board.locator(".actor-contributor").first).to_be_visible()
        clock.get_by_role("button", name="单步前进").click()
        expect(board.get_by_text("第 2 轮")).to_be_visible()
        board.get_by_role("button", name="邻居 N13", exact=False).press("Enter")
        expect(inspector).to_contain_text("上一轮结束时有 7 人等候")
        inspector.get_by_role("button", name="查看影响决策的第 1 轮指标").press("Enter")
        expect(board.get_by_text("第 1 轮")).to_be_visible()
        expect(board.locator(".actor-contributor").first).to_be_visible()

        page.get_by_text("从指标数值反查事件").press("Enter")
        page.get_by_role("button", name="定位第 2 轮").press("Enter")
        expect(board.get_by_text("第 2 轮")).to_be_visible()
        expect(page.get_by_role("button", name="定位第 3 轮")).to_have_count(0)

        click_turning_point(macro.locator("canvas"))
        expect(board.get_by_text("第 1 轮")).to_be_visible()

        page.get_by_role("button", name="试一项政策").press("Enter")
        expect(heading).to_have_text("反事实与制度实验")
        run = page.get_by_role("button", name="运行并验证")
        expect(run).to_be_disabled()
        page.get_by_role("slider", name="每轮发放工具").fill("4")
        expect(run).to_be_disabled()
        page.get_by_role("radio", name="增加").check()
        run.press("Enter")
        result = page.get_by_role("region", name="反事实对照结果")
        expect(result.get_by_text("原预测：增加。实际：减少。", exact=False)).to_be_visible()
        expect(result.get_by_text("峰值等候人数 7 人")).to_be_visible()
        expect(result.get_by_text("峰值等候人数 5 人")).to_be_visible()
        expect(result.locator("canvas")).to_have_count(2)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not errors and not external, (errors, external)
        print(f"{engine} {width}px: four stages, rewind, turning-point and canvas lookup, same-seed comparison")
        page.close()
    browser.close()
