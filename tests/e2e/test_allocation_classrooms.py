import os
import re
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright


def advance(page, tick):
    page.get_by_role("button", name="下一个事件", exact=True).press("Enter")
    expect(page.get_by_role("slider", name="回放事件")).to_have_attribute("aria-valuetext", re.compile(fr"事件 {tick}$"))


@pytest.mark.parametrize(("case_id", "width"), [
    ("lemons_market", 320), ("school_matching", 768), ("beer_game", 1440),
])
def test_domain_evidence_and_outcomes_on_the_real_classroom(local_app, chromium_options, case_id, width):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": width, "height": 960})
        external, errors = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        page.route("**/*", local_only)
        page.set_default_timeout(7500)
        assert page.goto(f"{local_app}/learn/{case_id}").ok
        page.get_by_role("button", name="开始学习", exact=True).press("Enter")
        page.get_by_role("radio", name="会出现", exact=True).check()
        page.get_by_role("button", name="选择行动", exact=True).press("Enter")
        if case_id == "beer_game":
            page.get_by_role("combobox", name=re.compile("这周你下多少单")).select_option("20")
        page.get_by_role("button", name="运行基础实验", exact=True).press("Enter")
        if case_id == "lemons_market":
            world = page.get_by_role("region", name="商品质量与交易")
            expect(world.get_by_text("未公开", exact=True)).to_be_visible()
            advance(page, 1)
            expect(world.get_by_text("S01 · 已因报价退出", exact=True)).to_be_visible()
            expect(world.get_by_text("实际交割（件）", exact=True).locator("..").get_by_role("definition")).to_have_text("0")
            page.get_by_role("radio", name="数量下降就是已经卖出").check()
            expect(page.get_by_text("两项分别来自退出记录和后续结算。", exact=False)).to_be_visible()
            page.get_by_role("radio", name="仍要查看交割记录").check()
            expect(page.get_by_text("结算前的商品仍在原卖家手里。", exact=False)).to_be_visible()
            world.get_by_role("button", name="引用本轮报价").press("Enter")
        elif case_id == "school_matching":
            world = page.get_by_role("region", name="志愿与席位")
            advance(page, 1)
            expect(world.get_by_text("S01 向 A 校申请。", exact=True)).to_be_visible()
            advance(page, 2)
            expect(world.get_by_text("S01 的 A 校申请被拒", exact=False)).to_be_visible()
            world.get_by_role("button", name="引用 S01 的拒绝").press("Enter")
            world.get_by_role("button", name="回查 S01 的原申请 · 事件 1").press("Enter")
            expect(world.get_by_text("S01 向 A 校申请。", exact=True)).to_be_visible()
            advance(page, 2)
            advance(page, 3)
            expect(world.get_by_text("S01 向 B 校申请。", exact=True)).to_be_visible()
        else:
            world = page.get_by_role("region", name="订单与实物在途")
            expect(world.get_by_text("零售商 本周无到货记录。")).to_be_visible()
            world.get_by_text("核对各环节的订单放大").press("Enter")
            expect(world.get_by_text("终端需求方差为零或周数不足")).to_be_visible()
            for tick in range(1, 6):
                advance(page, tick)
            expect(world.get_by_text("本周下单", exact=True).locator("..").get_by_role("definition")).to_have_text("20")
            expect(world.get_by_text("实际到货", exact=True).locator("..").get_by_role("definition")).to_have_text("4")
            expect(world.get_by_text("算术恒等式", exact=True)).to_be_visible()
            expect(world.get_by_text("截至当前的 5 个已完成周", exact=False)).to_be_visible()
            expect(world.get_by_text("放大比无法计算", exact=False)).to_have_count(0)
            world.get_by_role("button", name="引用这一周").press("Enter")
            advance(page, 6)
            world.get_by_role("button", name="定位第 6 周批发收到订单").press("Enter")
            expect(world.get_by_text("本周需求", exact=True).locator("..").get_by_role("definition")).to_have_text("20")
            source = world.get_by_role("button", name="回查第 4 周发货 · 事件 4")
            source.press("Enter")
            expect(world.get_by_role("heading", name="批发商 · 第 4 周")).to_be_visible()
            world.get_by_text("反查 批发商 的订单样本", exact=True).press("Enter")
            world.get_by_role("button", name=re.compile("第 2 周 · 批发商下单")).press("Enter")
            expect(world.get_by_role("heading", name="批发商 · 第 2 周")).to_be_visible()
        if screenshots := os.getenv("CIVITAS_UPGRADE_SCREENSHOTS"):
            page.screenshot(path=str(Path(screenshots) / f"{case_id}-observe-{width}.png"), full_page=True)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.get_by_role("button", name="快进到结束", exact=True).press("Enter")
        page.get_by_role("button", name="进入解释", exact=True).click()
        outcome = "运行结束，未出现匹配事件。" if case_id == "beer_game" else "与原预测一致。"
        expect(page.get_by_text(outcome, exact=False)).to_be_visible()
        if case_id == "beer_game":
            page.get_by_text("写一张机制解释卡", exact=True).press("Enter")
            expect(page.get_by_text("用一个有周账本证据的环节说明", exact=False)).to_be_visible()
            expect(page.get_by_role("button", name="提交解释卡", exact=True)).to_be_disabled()
        assert not external and not errors
        browser.close()


def test_matching_safe_report_does_not_invent_rejection(local_app, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page()
        page.set_default_timeout(7500)
        assert page.goto(f"{local_app}/learn/school_matching").ok
        page.get_by_role("button", name="开始学习", exact=True).press("Enter")
        page.get_by_role("radio", name="不会出现", exact=True).check()
        page.get_by_role("button", name="选择行动", exact=True).press("Enter")
        page.get_by_role("combobox", name="为 S01 填报志愿", exact=True).select_option("safe_first")
        expect(page.get_by_role("region", name="S01 的志愿单")).to_contain_text("B → A → C")
        page.get_by_role("button", name="运行基础实验", exact=True).press("Enter")
        page.get_by_role("button", name="快进到结束", exact=True).press("Enter")
        page.get_by_role("button", name="进入解释", exact=True).click()
        expect(page.get_by_text("运行结束，未出现匹配事件。与原预测一致。", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="打开 A 校拒绝", exact=False)).to_have_count(0)
        expect(page.get_by_role("region", name="志愿与席位")).to_contain_text("S01 的真实志愿名次")
        browser.close()
