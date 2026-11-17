import json

import pytest
from playwright.sync_api import expect, sync_playwright


@pytest.mark.parametrize("case", ["public_goods", "svb_run", "information_cascade", "gamestop"])
def test_multirole_rule_reference_runs_without_provider(local_app, chromium_options, case):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": 390, "height": 900}, accept_downloads=True)
        outbound = []
        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                outbound.append(route.request.url)
                route.abort()
        page.route("**/*", local_only)
        assert page.goto(local_app + "/experiments/multi-role").ok
        expect(page.get_by_role("heading", name="多角色模型实验")).to_be_visible()
        expect(page.get_by_role("link", name="打开原版单角色实验")).to_have_attribute("href", "/experiments")
        page.get_by_text("启用供应商实验", exact=True).click()
        expect(page.get_by_text("本机尚未启用多角色供应商和金额限额。", exact=False)).to_be_visible()
        page.get_by_role("combobox", name="课程", exact=True).select_option(case)
        page.get_by_role("button", name="运行规则参考", exact=True).press("Enter")
        region = page.get_by_role("region", name="多角色运行状态")
        expect(region.get_by_role("heading", level=2)).to_contain_text("已完成")
        point = region.get_by_role("slider", name="同步观察点")
        point.press("End")
        region.get_by_role("button", name="打开当前原事件", exact=False).press("Enter")
        expect(region.get_by_role("status")).to_contain_text("事件")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        if case == "public_goods":
            with page.expect_download() as downloaded:
                region.get_by_role("button", name="导出运行和回执").press("Enter")
            record = json.loads(downloaded.value.path().read_text())
            assert record["completeness"] == "complete" and record["committed_step"] == 6
            assert record["attempts"] == [] and record["coverage"]["model_committed"] == 0
        page.reload()
        expect(region.get_by_role("heading", level=2)).to_contain_text("已完成")
        assert not outbound
        browser.close()
