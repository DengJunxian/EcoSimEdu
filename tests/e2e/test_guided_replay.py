import re

from playwright.sync_api import expect, sync_playwright


def open_svb_observation(page, local_app):
    page.goto(local_app + "/?case=svb_run")
    page.get_by_role("button", name="开始实验", exact=True).click()
    page.get_by_role("radio", name="不确定", exact=True).check()
    page.get_by_role("button", name="选择行动", exact=True).click()
    page.get_by_role("button", name="运行实验", exact=True).click()
    expect(page.get_by_role("heading", name="追踪申请与到账", exact=True)).to_be_visible()


def test_svb_pin_survives_playback_and_keyboard_seek(local_app, chromium_options):
    with sync_playwright() as p:
        browser = p.chromium.launch(**chromium_options)
        page = browser.new_page()
        open_svb_observation(page, local_app)
        inspector = page.get_by_role("combobox", name="观察主体", exact=True)
        inspector.select_option("D01")
        page.get_by_role("button", name="固定 D01", exact=True).press("Enter")
        expect(page.get_by_role("button", name="取消固定 D01", exact=True)).to_be_focused()
        page.get_by_role("button", name="播放实验", exact=True).press("Enter")
        expect(page.get_by_text("首批提款已排队。", exact=False)).to_be_visible()
        expect(inspector).to_have_value("D01", timeout=1500)
        timeline = page.get_by_role("slider", name="事件时间轴")
        timeline.press("End")
        expect(inspector).to_have_value("D01")
        expect(page.locator(".evidence-panel > .entity-facts")).to_contain_text("存款余额")
        timeline.scroll_into_view_if_needed()
        track = timeline.bounding_box()
        y = track["y"] + track["height"] / 2
        page.mouse.move(track["x"] + track["width"] - 8, y)
        page.mouse.down()
        page.mouse.move(track["x"] + 8, y, steps=6)
        page.mouse.up()
        expect(timeline).to_have_value("0")
        expect(inspector).to_have_value("D01")
        browser.close()


def test_svb_guide_clips_series_table_axis_and_tutor(local_app, chromium_options):
    with sync_playwright() as p:
        browser = p.chromium.launch(**chromium_options)
        page = browser.new_page()
        open_svb_observation(page, local_app)
        chart = page.get_by_role("img", name=re.compile("^银行现金随事件变化"))
        expect(chart).to_contain_text("事件 0", timeout=1500)
        assert "L" not in chart.locator("path.demand").get_attribute("d")
        expect(chart.locator("text").first).to_have_text("100")
        page.get_by_text("查看指标数据", exact=True).press("Enter")
        table = page.get_by_role("table", name="银行现金（资金单位）")
        expect(table.get_by_role("row")).to_have_count(2)
        expect(table.get_by_role("button", name="事件 0", exact=True)).to_have_attribute("aria-current", "step")
        page.get_by_text("离线学习助手", exact=True).press("Enter")
        page.get_by_role("textbox", name="课程问题").fill("事件 4 的银行现金")
        query = page.get_by_role("button", name="查询", exact=True)
        query.press("Enter")
        expect(page.get_by_role("heading", name="证据范围", exact=True)).to_be_visible()

        page.get_by_role("button", name="查看全程", exact=True).press("Enter")
        assert "L" in chart.locator("path.demand").get_attribute("d")
        expect(table.get_by_role("button", name="事件 2", exact=True)).to_be_visible()
        query.press("Enter")
        expect(page.get_by_role("heading", name="本次观察", exact=True)).to_be_visible()
        page.get_by_role("button", name="返回引导播放", exact=True).press("Enter")
        expect(page.get_by_role("heading", name="本次观察", exact=True)).to_have_count(0)
        browser.close()
