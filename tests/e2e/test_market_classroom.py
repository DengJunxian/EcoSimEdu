"""Inspect real domain evidence in the market classroom renderers."""
import os
import re
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright


def button(page, label):
    return page.get_by_role("button", name=label, exact=isinstance(label, str))


@pytest.mark.parametrize("case_id,width", [("carbon_market", 320), ("flash_crash", 768), ("gamestop", 1440)])
def test_market_classroom_evidence(local_app, case_id, width, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": width, "height": 920})
        outbound, errors = [], []

        def offline(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                outbound.append(route.request.url)
                route.abort()

        page.route("**/*", offline)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{local_app}/learn/{case_id}")
        button(page, "开始学习").press("Enter")
        page.get_by_role("radio", name="不确定", exact=True).check()
        button(page, "选择行动").press("Enter")
        button(page, "运行基础实验").press("Enter")

        if case_id == "carbon_market":
            region = page.get_by_role("region", name="减排与配额登记簿")
            expect(region.get_by_text("本次未转移配额。", exact=False)).to_have_count(0)
            slider = region.get_by_role("slider")
            slider.press("ArrowRight")
            expect(region.get_by_text("检查第 2 吨的成本")).to_be_visible()
            button(page, "快进到结束").press("Enter")
            button(region, re.compile("看首次转移")).press("Enter")
            expect(region.get_by_text(re.compile("涉及编号 A"))).to_be_visible()
            region.get_by_text("追踪一张初始配额", exact=True).click()
            region.get_by_label("选择配额编号").select_option("A0012")
            expect(region.get_by_text("发行时登记给 F01。")).to_be_visible()
            expect(region.get_by_text(re.compile("向 F04 转移 4 张配额")).first).to_be_visible()
            button(region, "引用这条登记").press("Enter")
            page.get_by_role("radio", name="行业发行量增加", exact=True).check()
            expect(page.get_by_text(re.compile("调拨在既定发行量内进行"))).to_be_visible()
        elif case_id == "flash_crash":
            region = page.get_by_role("region", name="库存冲击与深度阶梯")
            expect(region.get_by_text("尚无成交记录，最近成交价留空。")).to_be_visible()
            button(page, "快进到结束").press("Enter")
            button(region, re.compile("首次撤单")).press("Enter")
            expect(region.get_by_text(re.compile("本事件无新成交。最近成交仍是事件"))).to_be_visible()
            expect(region.get_by_role("table", name="当前帧各侧最优四档")).to_be_visible()
            expect(button(region, re.compile(r"O\d+ · 买"))).to_be_visible()
            expect(region.get_by_text("261 → 243 股", exact=True)).to_be_visible()
            expect(region.get_by_text("22 → 22 股", exact=True)).to_be_visible()
            button(region, "引用此市场事件").press("Enter")
            page.get_by_role("radio", name="成交量增加 5 股", exact=True).check()
            expect(page.get_by_text(re.compile("未成交股数离开订单簿"))).to_be_visible()
        else:
            region = page.get_by_role("region", name="消息、订单与借券账")
            expect(region.get_by_text("当前帧尚未出现话题发布。")).to_be_visible()
            button(page, "快进到结束").press("Enter")
            region.get_by_label("查看话题").select_option("N1")
            recipients = region.get_by_role("list", name="收到同一话题的账户")
            expect(recipients.get_by_role("button")).to_have_count(5)
            recipients.get_by_role("button").last.press("Enter")
            expect(region.get_by_label("跟踪账户")).to_have_value("关注投资者 4")
            expect(button(region, re.compile("回查原话题"))).to_be_visible()
            button(region, "引用此模型事件").press("Enter")
            page.get_by_role("radio", name="每次触达自动计一股买量", exact=True).check()
            expect(page.get_by_text(re.compile("触达按人计数"))).to_be_visible()
            button(page, "快进到结束").press("Enter")
            button(region, "定位实际还券").press("Enter")
            expect(region.get_by_text("义务剩余 8 股。", exact=False)).to_be_visible()

        expect(page.get_by_text(re.compile("已引用事件"))).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not outbound and not errors
        if screenshots := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            region.screenshot(path=str(Path(screenshots) / f"{case_id}-domain-{width}.png"))
        browser.close()
