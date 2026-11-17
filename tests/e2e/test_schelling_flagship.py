import os
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

from services.simulation.schelling import simulate
from services.simulation.lessons import load_case


def local_ratio(grid, cell, actor):
    row, column = divmod(cell, 20)
    neighbors = [other for index, other in enumerate(grid)
                 if other and index != cell and abs(index // 20 - row) <= 1 and abs(index % 20 - column) <= 1]
    return f"{sum(other[0] == actor[0] for other in neighbors)}/{len(neighbors)}"


@pytest.mark.parametrize("width", [320, 390, 1440])
def test_schelling_grid_follows_resident_on_move_and_sparse_frame(local_app, chromium_options, width):
    case = load_case("schelling_segregation")
    result = simulate(case, "baseline", case["seed"], "move")
    opening = result["snapshots"][0]["grid"]["cells"]
    student_move = result["events"][1]
    first = next(event for event in result["events"] if event["event_type"] == "move")
    changed = first["changed_neighbors"][0]["actor"]
    sparse = next(frame for frame in result["snapshots"][first["tick"] + 20:] if not frame["entities"])
    board = sparse["grid"]["cells"]
    position = board.index(changed)
    row, column = divmod(position, 20)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": width, "height": 900}, has_touch=width < 500)
        outbound = []
        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                outbound.append(route.request.url)
                route.abort()
        context.route("**/*", local_only)
        page = context.new_page()
        page.goto(local_app + "/learn/schelling_segregation")
        practice = page.get_by_role("group", name="九格练习", exact=True)
        practice.get_by_role("button", name="第 2 行第 2 列，A 本人").press("Enter")
        page.get_by_role("button", name="核对邻居计数").press("Enter")
        expect(page.get_by_text("中央是被观察居民", exact=False)).to_be_visible()
        page.get_by_role("button", name="开始学习", exact=True).press("Enter")
        page.get_by_role("combobox", name="最低同组比例", exact=True).select_option("50")
        page.get_by_role("radio", name="达到", exact=True).check()
        expect(page.get_by_text("未达到 50%", exact=False)).to_be_visible()
        page.get_by_role("combobox", name="最低同组比例", exact=True).select_option("30")
        page.get_by_role("radio", name="达到", exact=True).check()
        expect(page.get_by_text("判断正确。", exact=False)).to_be_visible()
        page.get_by_role("radio", name="暂不确定", exact=True).check()
        page.get_by_role("button", name="选择行动", exact=True).press("Enter")

        preview = page.get_by_role("group", name="社区地图，用方向键选择相邻位置", exact=True)
        selected = preview.locator("button[tabindex='0']")
        selected.press("ArrowRight")
        expect(preview.locator("button[tabindex='0']")).to_be_focused()
        student_row, student_col = divmod(opening.index("A001"), 20)
        expect(preview.locator("button[tabindex='0']")).to_have_attribute(
            "aria-label", f"第 {student_row + 1} 行第 {student_col + 2} 列，{opening[opening.index('A001') + 1] or '空位'}")
        page.get_by_text("按行列选格", exact=True).press("Enter")
        coordinates = page.get_by_role("group", name="按坐标选择社区格子")
        coordinates.get_by_role("combobox", name="列").select_option(label=str(student_col + 1))
        expect(preview.locator("button[tabindex='0']")).to_have_attribute("aria-label", f"第 {student_row + 1} 行第 {student_col + 1} 列，A001")
        expect(page.locator('.lesson-grid [aria-live="polite"]')).to_have_text(
            f"A001 · 第 {student_row + 1} 行第 {student_col + 1} 列。"
            f"同组邻居 {local_ratio(opening, opening.index('A001'), 'A001')}。")
        coordinates.get_by_role("combobox", name="列").press("Tab")
        disclosure = page.get_by_text("查看选中格的邻居列表", exact=True)
        expect(disclosure).to_be_focused()
        expect(disclosure).to_have_attribute(
            "aria-label", f"查看选中格的邻居列表。A001 · 第 {student_row + 1} 行第 {student_col + 1} 列。"
            f"同组邻居 {local_ratio(opening, opening.index('A001'), 'A001')}。")
        if width < 500:
            scrollport = preview.locator("..")
            assert scrollport.evaluate("(element) => element.scrollWidth > element.clientWidth")
            far_cell = preview.get_by_role("button", name=f"第 {student_row + 1} 行第 20 列，", exact=False)
            size = far_cell.bounding_box()
            assert size and size["width"] >= 24 and size["height"] >= 24
            far_cell.tap()
            expect(far_cell).to_have_attribute("aria-pressed", "true")
            assert scrollport.evaluate("(element) => element.scrollLeft") > 0
            expect(coordinates.get_by_role("combobox", name="列")).to_have_value("19")

        page.get_by_role("combobox", name=case["action"]["label"], exact=True).select_option("move")
        page.get_by_role("button", name="运行基础实验", exact=True).press("Enter")
        tracked = page.locator(".schelling-tracking")
        expect(tracked).to_contain_text("同组邻居 5/7")
        page.get_by_role("button", name="下一个事件", exact=True).press("Enter")
        move_row, move_column = divmod(student_move["destination"], 20)
        expect(tracked).to_contain_text(f"第 {move_row + 1} 行第 {move_column + 1} 列")
        expect(tracked).to_contain_text("同组邻居 3/7")
        page.get_by_role("button", name="推进至首次自动迁居", exact=True).press("Enter")
        ledger = page.get_by_role("table", name=f"事件 {first['seq']} · 同组／已占邻居", exact=True)
        expect(ledger).to_be_visible()
        ledger.get_by_role("button", name=changed, exact=True).press("Enter")
        expect(tracked).to_contain_text(f"已固定 {changed}")
        page.get_by_role("button", name=f"引用 {changed} 的邻域变化", exact=True).press("Enter")
        if target := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            page.get_by_role("heading", name="追踪一位没搬家的邻居", exact=True).scroll_into_view_if_needed()
            page.screenshot(path=str(Path(target) / f"schelling-observe-{width}.png"), full_page=True)

        # Passing a sparse frame through the real route exercises grid-based projection instead of cached entities.
        page.get_by_role("button", name="快进到结束", exact=True).press("Enter")
        expect(page.locator("[data-terminal=all_satisfied]")).to_be_visible()
        timeline = page.get_by_role("slider", name="回放事件", exact=True)
        # Two native key presses should advance the slider twice even before either frame arrives.
        page.evaluate("""() => {
            const original = window.fetch;
            const blocked = new Promise(resolve => { window.releaseClassroomFrame = resolve; });
            window.fetch = (input, options) => {
                const response = original(input, options);
                return String(input).includes('/classroom-view?') && window.releaseClassroomFrame
                    ? Promise.all([response, blocked]).then(([value]) => value)
                    : response;
            };
            window.classroomSeeks = [];
            document.querySelector('input[aria-label="回放事件"]').addEventListener('input',
                event => window.classroomSeeks.push(Number(event.currentTarget.value)));
        }""")
        end = result["events"][-1]["tick"]
        timeline.press("ArrowLeft")
        timeline.press("ArrowLeft")
        assert page.evaluate("window.classroomSeeks") == [end - 1, end - 2]
        expect(timeline).to_have_attribute("aria-valuetext", f"正在定位，目标事件为 {end - 2}")
        expect(page.locator("[data-terminal=all_satisfied]")).to_be_visible()
        page.evaluate("() => { window.releaseClassroomFrame(); delete window.releaseClassroomFrame; }")
        expect(timeline).to_have_attribute("aria-valuetext",
                                           f"第 {result['events'][end - 2]['round']} 轮，事件 {end - 2}")
        timeline.fill(str(sparse["tick"]))
        expect(tracked).to_contain_text(f"{changed} · 第 {row + 1} 行第 {column + 1} 列")
        expect(tracked).to_contain_text(f"同组邻居 {local_ratio(board, position, changed)}")
        expect(timeline).to_have_attribute("aria-valuetext", f"第 {result['events'][sparse['tick']]['round']} 轮，事件 {sparse['tick']}")
        unpin = tracked.get_by_role("button", name=f"取消固定 {changed}", exact=True)
        unpin.press("Enter")
        repin = tracked.get_by_role("button", name=f"固定追踪 {changed}", exact=True)
        expect(repin).to_be_focused()
        repin.press("Enter")
        expect(unpin).to_be_focused()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not outbound
        browser.close()
