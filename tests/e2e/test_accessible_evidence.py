import re
from uuid import uuid4

import pytest
from playwright.sync_api import expect, sync_playwright

from services.simulation.lessons import load_case


def open_trace(page, local_app, case_id):
    course = load_case(case_id)
    request = {"request_id": str(uuid4()), "case_id": case_id, "scenario_id": "baseline",
               "provider_kind": "rule", "seed": course["seed"]}
    if case_id == "double_auction":
        request["bid"] = course["preset_bid"]
    else:
        request["action"] = course["action"]["default"]
    created = page.request.post(local_app + "/api/runs", data=request)
    assert created.status == 201
    run_id = created.json()["run_id"]
    response = page.request.post(f"{local_app}/api/runs/{run_id}/start", data={})
    assert response.ok
    return f"{local_app}/?case={case_id}&run={run_id}", response.json()["result"]


def test_grid_coordinates_and_arrows_use_same_cell(local_app, chromium_options):
    with sync_playwright() as p:
        browser = p.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": 390, "height": 850}, has_touch=True)
        url, result = open_trace(page, local_app, "schelling_segregation")
        page.goto(url + "&tick=0")
        expect(page).to_have_title(re.compile("实验回放"))
        expect(page.get_by_role("heading", name="居住隔离", exact=True)).to_be_visible()
        page.get_by_text("按行列选格", exact=True).tap()
        coordinates = page.get_by_role("group", name="按坐标选择社区格子")
        row = coordinates.get_by_role("combobox", name="行", exact=True)
        column = coordinates.get_by_role("combobox", name="列", exact=True)
        for control in (row, column):
            assert control.bounding_box()["height"] >= 44 and control.bounding_box()["width"] >= 44
        row.select_option(label="3")
        column.select_option(label="4")
        grid = page.get_by_role("group", name="社区地图，用方向键选择相邻位置")
        data = result["snapshots"][0]["grid"]
        resident = data["cells"][2 * data["size"] + 3] or "空位"
        cell = grid.get_by_role("button", name=f"第 3 行第 4 列，{resident}", exact=True)
        expect(cell).to_have_attribute("aria-pressed", "true")
        cell.press("ArrowRight")
        expect(grid.get_by_role("button", name="第 3 行第 5 列", exact=False)).to_be_focused()
        expect(column).to_have_value("4")
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")

        inspector = page.get_by_role("combobox", name="观察主体", exact=True)
        inspector.select_option("A001")
        page.get_by_role("button", name="固定 A001", exact=True).press("Enter")
        missing = next(frame["tick"] for frame in result["snapshots"] if "A001" not in frame["entities"])
        timeline = page.get_by_role("slider", name="事件时间轴")
        timeline.fill(str(missing))
        expect(inspector).to_have_value("A001")
        expect(page.get_by_text("A001 在当前事件没有状态记录。", exact=True)).to_be_visible()
        expect(page.locator(".evidence-panel > .entity-facts")).to_have_count(0)
        timeline.press("Home")
        expect(inspector).to_have_value("A001")
        expect(page.locator(".evidence-panel > .entity-facts")).to_be_visible()
        browser.close()


@pytest.mark.parametrize("case_id", ["double_auction", "svb_run"])
def test_event_boundary_and_text_data_keep_keyboard_operable(local_app, chromium_options, case_id):
    with sync_playwright() as p:
        browser = p.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": 390, "height": 850})
        url, result = open_trace(page, local_app, case_id)
        end = len(result["snapshots"]) - 1
        page.goto(url + f"&tick={end - 1}")
        next_step = page.get_by_role("button", name="下一步", exact=True)
        next_step.press("Enter")
        expect(next_step).to_be_disabled()
        expect(next_step).to_be_focused()
        page.keyboard.press("Enter")
        slider = page.get_by_role("slider", name="事件时间轴")
        expect(slider).to_have_value(str(end))
        expect(slider).to_have_attribute("aria-valuetext", f"事件 {end}，末条为 {end}")
        if case_id == "double_auction":
            page.get_by_text("查看成交价格表", exact=True).press("Enter")
            table = page.get_by_role("table", name="已播放成交价格（代币 / 件）")
            event = next(event for event in result["events"] if event["event_type"] == "trade")
            seq, value = event["seq"], event["price"]
        else:
            page.get_by_text("查看指标数据", exact=True).press("Enter")
            metric = load_case(case_id)["metrics"][0]
            table = page.get_by_role("table", name=f"{metric['label']}（{metric['unit']}）")
            seq = end - 2
            value = result["snapshots"][seq]["metrics"][metric["id"]]
        row = table.get_by_role("row").filter(has=page.get_by_role("button", name=f"事件 {seq}", exact=True))
        expect(row.get_by_role("cell")).to_have_text(f"{value:,}" if value is not None else "缺失")
        entry = row.get_by_role("button", name=f"事件 {seq}", exact=True)
        entry.press("Enter")
        expect(entry).to_be_focused()
        expect(entry).to_have_attribute("aria-current", "step")
        expect(slider).to_have_value(str(seq))
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
        if case_id == "svb_run":
            frame = next(frame for frame in result["snapshots"] if any(
                0 <= edge.get("origin_seq", -1) < frame["tick"] for edge in frame.get("relations", ())))
            origin = next(edge["origin_seq"] for edge in frame["relations"]
                          if 0 <= edge.get("origin_seq", -1) < frame["tick"])
            page.goto(url + f"&tick={frame['tick']}")
            page.get_by_text("主体关系", exact=True).press("Enter")
            page.get_by_role("button", name=f"来源事件 {origin}", exact=True).first.press("Enter")
            expect(slider).to_be_focused()
            expect(slider).to_have_value(str(origin))
        browser.close()
