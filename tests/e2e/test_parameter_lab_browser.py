import json
import os
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def test_parameter_lab_keeps_missing_points_and_exports_actual_layouts(local_app, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": 390, "height": 900}, accept_downloads=True)
        page.set_default_timeout(9000)
        assert page.goto(local_app + "/compare?case=schelling_segregation").ok
        expect(page.get_by_role("heading", name="参数对照")).to_be_visible()
        page.get_by_role("button", name="比较混合与分化初态", exact=True).press("Enter")
        page.get_by_role("combobox", name="最低同组邻居比例", exact=True).select_option(label="50")
        page.get_by_role("button", name="运行参数对照", exact=True).press("Enter")
        expect(page.get_by_role("img", name="基准，170 名 A 组、170 名 B 组、60 个空位")).to_be_visible()
        expect(page.get_by_text("交错混合 → 左右分区", exact=False)).to_be_visible()
        slider = page.get_by_role("slider", name="同步观察点")
        slider.press("Home")
        expect(slider).to_have_attribute("aria-valuetext", "开局")
        expect(page.get_by_role("link", name="打开基准原事件", exact=True)).to_have_attribute(
            "href", re.compile(r"event=0$"))
        page.get_by_role("combobox", name="同步观察主体", exact=True).select_option("A001")
        expect(page.get_by_role("heading", name="基准 · A001", exact=True)).to_be_visible()
        expect(page.get_by_role("heading", name="对照 · A001", exact=True)).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        with page.expect_download() as download:
            page.get_by_role("button", name="导出对照与两组运行").press("Enter")
        data = json.loads(Path(download.value.path()).read_text())
        assert data["conditions"]["baseline_initial_hash"] != data["conditions"]["branch_initial_hash"]
        assert data["baseline"]["parameter_patch"]["initial_layout"] == "mixed"
        assert data["branch"]["parameter_patch"]["initial_layout"] == "segregated"
        assert data["baseline"]["effective_parameters"]["threshold"] == data["branch"]["effective_parameters"]["threshold"] == 50
        if screens := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            page.screenshot(path=str(Path(screens) / "parameter-layouts-390.png"), full_page=True)
        browser.close()


def test_parameter_lab_weekly_tape_changes_executed_retail_orders(local_app, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(accept_downloads=True)
        page.set_default_timeout(9000)
        page.goto(local_app + "/compare?case=beer_game")
        page.get_by_text("设定零售逐周订单", exact=True).click()
        page.get_by_role("spinbutton", name="第 5 周", exact=True).fill("26")
        page.get_by_role("spinbutton", name="第 6 周", exact=True).fill("0")
        page.get_by_role("combobox", name="交货延迟", exact=True).select_option(label="3")
        page.get_by_role("button", name="运行参数对照", exact=True).click()
        with page.expect_download() as download:
            page.get_by_role("button", name="导出对照与两组运行").click()
        data = json.loads(Path(download.value.path()).read_text())
        for arm in ("baseline", "branch"):
            orders = {event["week"]: event["orders"]["零售商"] for event in data[arm]["result"]["events"] if event["week"]}
            assert orders[5] == 26 and orders[6] == 0
        browser.close()


def test_parameter_lab_exports_all_seed_pairs(local_app, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(accept_downloads=True)
        page.goto(local_app + "/compare?case=double_auction")
        page.get_by_text("跨种子核对", exact=True).click()
        page.get_by_role("checkbox", name="同时运行其后 4 个连续种子").check()
        page.get_by_role("combobox", name="每方交易费", exact=True).select_option(label="6")
        page.get_by_role("button", name="运行参数对照", exact=True).click()
        page.get_by_text("五组模拟样本的期末差异", exact=True).click()
        expect(page.get_by_role("rowheader", name="1966", exact=True)).to_be_visible()
        with page.expect_download() as download:
            page.get_by_role("button", name="导出对照与两组运行").click()
        data = json.loads(Path(download.value.path()).read_text())
        results = [data, *data["replicates"]]
        assert [item["conditions"]["seed"] for item in results] == list(range(1962, 1967))
        assert len({item[arm]["run_id"] for item in results for arm in ("baseline", "branch")}) == 10
        browser.close()


def test_parameter_lab_public_goods_student_tape_reaches_both_arms(local_app, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(accept_downloads=True)
        page.goto(local_app + "/compare?case=public_goods")
        page.get_by_text("设定 P1 逐轮贡献", exact=True).click()
        page.get_by_role("spinbutton", name="第 4 轮", exact=True).fill("20")
        page.get_by_role("spinbutton", name="第 7 轮", exact=True).fill("0")
        page.get_by_role("combobox", name="每次制裁的个人成本", exact=True).select_option(label="2")
        page.get_by_role("button", name="运行参数对照", exact=True).click()
        with page.expect_download() as download:
            page.get_by_role("button", name="导出对照与两组运行").click()
        data = json.loads(Path(download.value.path()).read_text())
        for arm in ("baseline", "branch"):
            contributions = {
                event["round"]: event["contributions"]["P1"] for event in data[arm]["result"]["events"]
                if event["event_type"] == "contributions"
            }
            assert contributions[4] == 20 and contributions[7] == 0
        browser.close()
