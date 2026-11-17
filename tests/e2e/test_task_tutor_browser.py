import re

import pytest
from playwright.sync_api import expect, sync_playwright

from test_auction_scenes import enter_quote


@pytest.mark.parametrize("width", [390, 1440])
def test_auction_mentor_clips_the_future_and_jumps_to_the_live_worksheet(local_app, chromium_options, width):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": width, "height": 900})
        external = []

        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        page.route("**/*", local_only)
        enter_quote(page, local_app)
        page.get_by_text("离线学习助手", exact=True).click()
        ask = page.get_by_role("textbox", name="课程问题")
        submit = page.get_by_role("button", name="查询", exact=True)
        ask.fill("我的报价太低会发生什么？")
        submit.press("Enter")
        expect(page.get_by_text("在订单簿找到自己的买单和当前最低卖价", exact=False)).to_be_visible()
        page.get_by_label("提示程度").select_option("3")
        submit.click()
        expect(page.get_by_text("两单暂不交叉", exact=False)).to_be_visible()
        assert page.get_by_role("button", name="在线组织解释").count() == 0

        page.get_by_label("开局限价").fill("96")
        page.get_by_role("button", name="提交开局报价").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("找出成交的那一刻")
        expect(page.get_by_text("两单暂不交叉", exact=False)).to_have_count(0)
        ask.fill("事件 4 发生了什么？")
        submit.click()
        expect(page.get_by_text("当前回放时点还没有揭示指定事件。", exact=True)).to_be_visible()

        page.get_by_role("button", name="播放至成交").click()
        expect(page.get_by_role("heading", name="96 代币成交", exact=True)).to_be_visible()
        page.get_by_role("button", name="下一步", exact=True).click()
        slider = page.get_by_role("slider")
        expect(slider).to_have_attribute("aria-valuetext", re.compile("^事件 5，"))
        submit.click()
        expect(page.get_by_text("最近成交价为 96 代币/件", exact=False)).to_be_visible()
        link = page.get_by_role("button", name="定位事件 4", exact=True)
        link.press("Enter")
        expect(slider).to_have_attribute("aria-valuetext", re.compile("^事件 4，"))
        expect(slider).to_be_focused()
        assert page.url.endswith("/learn/double_auction?scene=observe")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not external
        browser.close()
