import os
from pathlib import Path
import re

import pytest
from playwright.sync_api import expect, sync_playwright


@pytest.mark.parametrize("width", [390, 1440])
def test_svb_request_message_payment_and_checkpoint(local_app, width, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": width, "height": 920})
        external, page_errors = [], []
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        page.route("**/*", local_only)
        page.goto(local_app + "/learn/svb_run")
        expect(page.get_by_role("heading", level=1)).to_have_text("看一张银行账表")
        page.get_by_role("button", name="开始学习", exact=True).click()
        role = page.get_by_role("region", name="D01 开局简报")
        expect(role).to_contain_text("本次工资款")
        expect(role).to_contain_text("D02、D03、D04")
        page.get_by_role("radio", name="不会出现", exact=True).check()
        page.get_by_role("button", name="选择行动", exact=True).click()
        expect(page.get_by_text("当前方案在第 1 轮提交 19 单位")).to_be_visible()
        page.get_by_role("button", name="运行基础实验", exact=True).click()

        playhead = page.get_by_role("slider", name="回放事件", exact=True)
        world = page.get_by_role("region", name="银行与储户", exact=True)
        expect(world.get_by_role("img", name=re.compile("共 1 个已揭示事件点"))).to_be_visible()
        expect(world.get_by_role("button", name=re.compile("定位最近现金下跌"))).to_have_count(0)
        pinned = world.get_by_role("combobox", name="固定储户", exact=True)
        expect(pinned).to_have_value("D01")
        next_event = page.get_by_role("button", name="下一个事件", exact=True)
        for index in range(1, 6):
            if index == 1 and width == 390:
                page.evaluate("""() => {
                    const original = window.fetch;
                    let holdFirstFrame = true;
                    window.fetch = (input, options) => {
                        if (holdFirstFrame && String(input).includes('/classroom-view?tick=1&')) {
                            holdFirstFrame = false;
                            return new Promise(resolve => { window.releaseFirstFrame = () => resolve(original(input, options)); });
                        }
                        return original(input, options);
                    };
                }""")
                next_event.press("Enter")
                page.wait_for_function("typeof window.releaseFirstFrame === 'function'")
                expect(next_event).to_be_disabled()
                expect(next_event).to_be_focused()
                page.evaluate("window.releaseFirstFrame()")
            else:
                next_event.click()
            expect(playhead).to_have_attribute("aria-valuetext", re.compile(rf"事件 {index}$"))
            if index == 3:
                expect(world.get_by_text("银行现金 100 → 100", exact=False)).to_be_visible()
                expect(world.get_by_text("累计实付 0，待付 19。", exact=True)).to_be_visible()
            if index == 4:
                expect(world.get_by_text("银行现金 100 → 68", exact=False)).to_be_visible()
                expect(world.get_by_text("累计实付 19，待付 0。", exact=True)).to_be_visible()
        expect(pinned).to_have_value("D01")
        expect(world.get_by_text("第 2 轮 · 事件 5 · 消息", exact=False)).to_be_visible()
        pinned.select_option("D05")
        expect(world.get_by_text("D05 的风险分", exact=False)).to_be_visible()
        if screenshots := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            world.screenshot(path=str(Path(screenshots) / f"svb-messages-{width}.png"))
        source = world.get_by_role("button", name="打开来源事件 3", exact=True)
        source.focus()
        page.keyboard.press("Enter")
        expect(playhead).to_have_attribute("aria-valuetext", re.compile(r"事件 3$"))
        expect(pinned).to_have_value("D05")
        expect(playhead).to_be_focused()
        expect(source).to_have_count(0)
        for index in (4, 5):
            next_event.click()
            expect(playhead).to_have_attribute("aria-valuetext", re.compile(rf"事件 {index}$"))
        world.get_by_role("button", name="定位最近现金下跌 · 事件 4", exact=True).click()
        expect(playhead).to_have_attribute("aria-valuetext", re.compile(r"事件 4$"))
        expect(playhead).to_be_focused()
        expect(world.get_by_text("银行现金 100 → 68", exact=False)).to_be_visible()
        world.get_by_role("button", name="引用当前实付", exact=True).click()
        expect(page.get_by_text("已引用事件 4。", exact=True)).to_be_visible()

        page.get_by_role("button", name="快进到结束", exact=True).click()
        page.get_by_role("button", name="进入解释", exact=True).click()
        page.get_by_role("button", name="定位正权益待付", exact=True).click()
        ledger = page.get_by_role("region", name="流动性与权益对账", exact=True)
        expect(ledger.get_by_text("第 2 轮结算后，现金 0，待付 107，权益 155。", exact=True)).to_be_visible()
        expect(ledger.get_by_text("轮末待付清单（合计 107）", exact=True)).to_be_visible()
        ledger.get_by_role("button", name=re.compile(r"D16 · D16-02 · 待付 38")).click()
        expect(ledger.get_by_text("D16：申请 42 − 已付 4 = 待付 38。")).to_be_visible()
        expect(pinned).to_have_value("D16")
        ledger.get_by_role("spinbutton", name="你算出的权益", exact=True).fill("155")
        ledger.get_by_role("button", name="核对权益", exact=True).click()
        expect(ledger.get_by_text("核对正确", exact=False)).to_be_visible()
        ledger.get_by_role("button", name="引用轮末待付", exact=True).click()
        page.reload()
        expect(ledger.get_by_text("核对正确", exact=False)).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not external and not page_errors
        if screenshots := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            page.screenshot(path=str(Path(screenshots) / f"svb-flagship-{width}.png"), full_page=True)
        browser.close()
