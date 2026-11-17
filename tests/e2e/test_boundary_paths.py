import json
from urllib.parse import parse_qs, urlsplit

import pytest
from playwright.sync_api import expect, sync_playwright

from scripts.check_boundaries import RECEIPT

BOUNDARY_RESULTS = json.loads(RECEIPT.read_text())


def download_run(page):
    with page.expect_download() as event:
        page.get_by_role("button", name="导出运行记录").click()
    return json.loads(event.value.path().read_text())


def test_auction_boundary_run_replay_and_download(local_app, chromium_options):
    with sync_playwright() as p:
        browser = p.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": 390, "height": 850}, accept_downloads=True)
        external = []

        def local(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        context.route("**/*", local)
        page = context.new_page()
        page.goto(local_app + "/?case=double_auction")
        page.get_by_role("link", name="边界实验：供需无交叠").click()
        saved = []
        for button, origin in (("运行边界实验", "offline_simulation"), ("载入预计算边界回放", "precomputed_simulation")):
            page.get_by_role("button", name=button).click()
            expect(page.get_by_role("heading", name="供需无交叠", level=2)).to_be_visible()
            expect(page.get_by_text("未定义", exact=True)).to_have_count(2)
            expect(page.get_by_text("0 件", exact=True).first).to_be_visible()
            page.get_by_text("查看边界供需曲线").click()
            page.get_by_text("查看供需数据").click()
            expect(page.get_by_role("table")).to_be_visible()
            slider = page.get_by_role("slider", name="事件时间轴")
            expect(page.get_by_role("button", name="跳到下一笔成交")).to_be_disabled()
            slider.press("End")
            expect(page.get_by_text("市场结束", exact=True)).to_be_visible()
            expect(page.get_by_text("整场无成交。成交价未定义。")).to_be_visible()
            assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
            record = download_run(page)
            assert record["origin"] == origin
            saved.append(record["result_hash"])
            assert record["result"]["metrics"]["volume"] == 0
            assert record["result"]["metrics"]["price_min"] is None
            assert record["result"]["metrics"]["price_max"] is None
            assert record["result"]["metrics"]["efficiency"] is None
            page.reload()
            expect(page.get_by_role("heading", name="供需无交叠", level=2)).to_be_visible()
            page.get_by_role("link", name="边界实验：供需无交叠").click()
        assert all(value == BOUNDARY_RESULTS[0]["result_hash"] for value in saved) and not external
        page.get_by_role("link", name="回放上次边界实验").click()
        assert download_run(page)["origin"] == "precomputed_simulation"
        page.get_by_role("link", name="返回课程").click()
        expect(page.get_by_role("button", name="开始实验")).to_be_visible()
        browser.close()


@pytest.mark.parametrize("fixture", BOUNDARY_RESULTS[1:], ids=lambda row: row["case_id"])
def test_lesson_boundary_run_saved_replay_and_download(local_app, chromium_options, fixture):
    with sync_playwright() as p:
        browser = p.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": 390, "height": 850}, accept_downloads=True)
        context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/") else route.abort())
        page = context.new_page()
        case_id, label, end = fixture["case_id"], fixture["label"], fixture["events"] - 1
        page.goto(f"{local_app}/?case={case_id}")
        page.get_by_role("link", name=f"边界实验：{label}").click()
        progress = "() => Object.entries(localStorage).filter(([key]) => !key.startsWith('civitas/boundary/'))"
        before = page.evaluate(progress)
        page.get_by_role("button", name="运行边界实验").click()
        expect(page.get_by_role("heading", name=label, level=2)).to_be_visible()
        slider = page.get_by_role("slider", name="事件时间轴")
        expect(slider).to_have_value("0")
        slider.press("ArrowRight")
        expect(slider).to_have_value("1")
        page.get_by_role("link", name="查看末条事件").click()
        expect(slider).to_have_value(str(end))
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
        run_id = parse_qs(urlsplit(page.url).query)["run"][0]
        record = download_run(page)
        assert record["run_id"] == run_id and record["case_id"] == case_id
        assert record["origin"] == "offline_simulation" and record["scenario_id"] == "boundary"
        assert record["execution_status"] == "completed" and record["parent_run_id"] is None
        assert record["seed"] == fixture["seed"] and record["action"] == fixture["input"]["action"]
        assert record["result_hash"] == fixture["result_hash"]
        assert record["result"]["metrics"] == fixture["final_metrics"]
        expect(page.get_by_text(record["result"]["events"][-1]["summary"], exact=True)).to_be_visible()
        page.reload()
        expect(slider).to_have_value(str(end))
        assert download_run(page) == record
        assert page.evaluate(progress) == before
        page.get_by_role("link", name="返回课程").click()
        page.get_by_role("link", name=f"边界实验：{label}").click()
        page.get_by_role("link", name="回放上次边界实验").click()
        expect(slider).to_have_value("0")
        assert download_run(page) == record
        browser.close()
