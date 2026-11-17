import json
from pathlib import Path
from uuid import uuid4

import pytest
from playwright.sync_api import expect, sync_playwright

from services.simulation.lessons import CATALOG


@pytest.mark.parametrize("width", [320, 390, 768, 1440])
def test_upgrade_navigation_resumes_legacy_progress(local_app, width, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": width, "height": 960}, accept_downloads=True)
        external = []
        errors = []
        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()
        context.route("**/*", local_only)
        page = context.new_page()
        page.set_default_timeout(6500)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(local_app)
        expect(page.get_by_role("heading", level=1)).to_have_text("从一次选择，看见经济系统")
        expect(page.get_by_role("link", name="进入双向拍卖")).to_have_attribute("href", "/learn/double_auction")
        expect(page.get_by_role("heading", name="继续学习")).to_have_count(0)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.keyboard.press("Tab")
        expect(page.get_by_role("link", name="跳到主要内容", exact=True)).to_be_focused()
        page.keyboard.press("Tab")
        expect(page.get_by_role("link", name="EcoSimEdu")).to_be_focused()
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", level=1)).to_have_text("案例库")
        expect(page.get_by_role("status")).to_have_text(f"{len(CATALOG)} 门案例")
        page.get_by_label("学习路径", exact=True).select_option("金融风险")
        expect(page.get_by_role("status")).to_have_text("3 门案例")
        page.get_by_label("难度").select_option("入门")
        expect(page.get_by_role("status")).to_have_text("没有符合条件的案例。")
        page.get_by_label("难度").select_option("进阶")
        page.get_by_label("材料类型").select_option("历史事件")
        expect(page.get_by_role("status")).to_have_text("3 门案例")
        page.get_by_label("搜索课程").fill("硅谷")
        expect(page.get_by_role("status")).to_have_text("1 门案例")
        page.get_by_role("link", name="硅谷银行挤兑 有资产的银行，为什么会付不出钱？").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("有资产的银行，为什么会付不出钱？")
        page.reload()
        expect(page.get_by_text("你的选择", exact=True)).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.go_back()
        expect(page.get_by_role("heading", level=1)).to_have_text("案例库")
        page.go_forward()
        expect(page.get_by_role("heading", level=1)).to_have_text("有资产的银行，为什么会付不出钱？")

        page.get_by_role("link", name="实验笔记").click()
        expect(page.get_by_role("heading", name="此浏览器还没有已开始的案例")).to_be_visible()
        page.goto(local_app + "/?case=double_auction")
        page.get_by_role("button", name="开始实验").click()
        page.get_by_role("radio", name="不确定", exact=True).check()
        page.get_by_role("button", name="去报价").click()
        page.get_by_role("button", name="运行实验", exact=True).click()
        expect(page.get_by_role("heading", name="观察撮合", exact=True)).to_be_visible()
        page.get_by_role("navigation", name="主导航").get_by_role("link", name="首页", exact=True).click()
        expect(page.get_by_text("双向拍卖 · 观察撮合", exact=True)).to_be_visible()
        page.get_by_role("link", name="回到课堂").click()
        expect(page.get_by_role("heading", name="观察撮合", exact=True)).to_be_visible()
        page.get_by_role("link", name="实验笔记").click()
        expect(page.get_by_text("进行中 · 观察撮合")).to_be_visible()
        with page.expect_download() as download:
            page.get_by_role("button", name="导出学习记录").click()
        record = json.loads(Path(download.value.path()).read_text())
        assert record["case_id"] == "double_auction" and record["runs"]["baseline"]
        page.get_by_role("list", name="双向拍卖的本机运行").get_by_role("link").click()
        expect(page.get_by_role("link", name="按事件序号查看")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

        page.goto(local_app + "/?case=double_auction")
        page.get_by_role("button", name="Civitas Economica").click()
        page.get_by_role("navigation", name="主导航").get_by_role("link", name="首页", exact=True).click()
        expect(page.get_by_text("双向拍卖 · 进入市场", exact=True)).to_be_visible()
        page.get_by_role("link", name="实验笔记").click()
        expect(page.get_by_text("进行中 · 进入市场", exact=True)).to_be_visible()
        page.get_by_role("link", name="EcoSimEdu", exact=True).click()
        page.get_by_role("link", name="回到课堂").click()
        expect(page.get_by_role("heading", name="双向拍卖 价格是怎样形成的？")).to_be_visible()
        assert not external and not errors
        browser.close()


def test_upgrade_production_deep_links_keep_404_and_explicit_recovery(local_app, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page()
        for route, title in (("/cases", "案例库"), ("/notes", "实验笔记"), ("/paths", "学习路径"),
                             ("/experiments", "模型实验"), ("/compare", "参数对照"),
                             ("/learn/double_auction", "走进交易大厅")):
            assert page.goto(local_app + route).ok
            expect(page.get_by_role("heading", level=1)).to_have_text(title)
            page.keyboard.press("Tab")
            expect(page.get_by_role("link", name="跳到主要内容", exact=True)).to_be_focused()
            page.keyboard.press("Enter")
            expect(page.get_by_role("main")).to_be_focused()
            assert page.reload().ok
        for path in ("/assets/missing.css", "/api/unknown", "/cases/unknown", "/learn/unknown"):
            assert page.request.get(local_app + path).status == 404
        page.goto(local_app + "/?case=double_auction&tick=3")
        expect(page.get_by_role("heading", name="链接参数无效")).to_be_visible()
        page.goto(local_app + f"/?case=double_auction&run={uuid4()}&tick=0")
        expect(page.get_by_role("alert")).to_contain_text("请核对运行链接和本机运行数据库")
        expect(page.get_by_role("link", name="按事件序号查看")).to_have_count(0)
        browser.close()
