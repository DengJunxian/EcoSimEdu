import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from playwright.sync_api import expect, sync_playwright

from services.simulation.lessons import CATALOG, load_case


@pytest.mark.parametrize("width", [1440, 390])
@pytest.mark.parametrize("case_id", CATALOG[1:])
def test_published_course_completes_offline(local_app, width, case_id, tmp_path, chromium_options):
    course = load_case(case_id)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": width, "height": 950}, accept_downloads=True)
        external, errors = [], []

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
        page.get_by_role("navigation", name="课程目录").get_by_role("link", name=course["title"], exact=True).click()
        expect(page.get_by_role("heading", name=course["title"], exact=True)).to_be_visible()
        page.get_by_role("button", name="开始实验").click()
        answer = "unknown" if width == 390 else "no"
        page.get_by_role("radio", name=course["questions"]["prediction"]["options"][answer], exact=True).check()
        page.get_by_role("button", name="选择行动").click()
        action = course["action"]["options"][-1]["id"] if case_id == "schelling_segregation" else course["action"]["default"]
        page.get_by_label(course["action"]["label"], exact=True).select_option(action)
        if case_id == "information_cascade" and width == 1440:
            page.get_by_text("高级实验 · 模型决策", exact=True).click()
            expect(page.get_by_text("本机尚未启用模型服务。", exact=False)).to_be_visible()
        if case_id == "schelling_segregation":
            grid = page.get_by_role("group", name="社区地图，用方向键选择相邻位置")
            expect(grid).to_be_visible()
            focused = grid.locator('button[tabindex="0"]')
            old = focused.get_attribute("aria-label")
            focused.focus()
            page.keyboard.press("ArrowDown" if "第 20 行" not in old else "ArrowUp")
            assert focused.get_attribute("aria-label") != old
        page.get_by_role("button", name="运行实验", exact=True).click()
        expect(page.get_by_role("heading", name=course["lessons"][3]["title"], exact=True)).to_be_visible()
        if width == 1440:
            page.get_by_role("button", name="播放实验", exact=True).click()
            expect(page.get_by_role("status")).to_contain_text(course["checkpoint"]["message"], timeout=16000)
        page.get_by_role("button", name="跳到下一条证据").click()
        page.get_by_role("button", name="引用此事件").click()
        expect(page.get_by_role("button", name="已引用")).to_be_disabled()
        if case_id == "schelling_segregation":
            expect(page.get_by_text("邻居迁移前后的比例")).to_be_visible()
        if case_id == "information_cascade":
            page.get_by_text("信号、行动与似然", exact=True).click()
            expect(page.get_by_text("真状态为 A 时出现当前行动的概率")).to_be_visible()
            if width == 1440:
                page.get_by_text("离线学习助手", exact=True).click()
                page.get_by_role("button", name="查询", exact=True).click()
                expect(page.get_by_role("heading", name="本次观察", exact=True)).to_be_visible()
                expect(page.get_by_role("link", name="事件", exact=False).last).to_have_attribute("href", re.compile(r".*tick=[0-9]+"))
        mark = page.get_by_role("link", name="事件链接").get_attribute("href")
        if width == 1440:
            run_id = parse_qs(urlparse(mark).query)["run"][0]
            response = page.request.get(f"{local_app}/api/runs/{run_id}")
            assert response.ok
            frames = response.json()["result"]["snapshots"]
            frame = next(frame for frame in frames if frame["entities"] and (frame.get("grid") or frame.get("relations")))
            tick = frame["tick"]
            trace = context.new_page()
            trace.goto(f"{local_app}/?case={case_id}&run={run_id}&tick={tick}")
            expect(trace.get_by_role("heading", name=course["title"], exact=True)).to_be_visible()
            expect(trace.get_by_text("本次离线计算")).to_be_visible()
            assert trace.get_by_role("button", name="引用此事件").count() == 0
            if frame.get("relations"):
                trace.get_by_text("主体关系", exact=True).click()
                edge = frame["relations"][0]
                expect(trace.get_by_role("list", name="当前事件的全部关系").get_by_role("listitem").first).to_contain_text(
                    f"{edge['from']} → {edge['to']} · {edge['label']}")
            else:
                trace.get_by_text("查看选中格的邻居列表", exact=True).click()
                expect(trace.get_by_role("group", name="社区地图，用方向键选择相邻位置")).to_be_visible()
            actor, state = next((actor, state) for actor, state in frame["entities"].items() if state)
            inspector = trace.get_by_role("combobox", name="观察主体", exact=True)
            inspector.select_option(actor)
            expect(inspector).to_have_value(actor)
            expect(trace.locator(".evidence-panel > .entity-facts").locator("dt").first).to_have_text(next(iter(state)))
            metric = next(metric for metric in course["metrics"] if frame["metrics"][metric["id"]] is not None)
            trace.get_by_label("图表指标", exact=True).select_option(metric["id"])
            trace.get_by_text("查看指标数据", exact=True).click()
            table = trace.get_by_role("table", name=f"{metric['label']}（{metric['unit']}）")
            row = table.get_by_role("row").filter(has=trace.get_by_role("button", name=f"事件 {tick}", exact=True))
            value = trace.evaluate("n => new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 3}).format(n)",
                                   frame["metrics"][metric["id"]])
            expect(row.get_by_role("cell")).to_have_text(value)
            trace.close()
        if width == 1440 and case_id in {"flash_crash", "gamestop"}:
            run_id = parse_qs(urlparse(mark).query)["run"][0]
            run = page.request.get(f"{local_app}/api/runs/{run_id}").json()
            fill = next(e for e in run["result"]["events"] if e["event_type"] == "trade")
            incoming = context.new_page()
            incoming.goto(f"{local_app}/?case={case_id}&run={run_id}&tick={fill['tick']}")
            for side, role in (("buy", "买"), ("sell", "卖")):
                order = fill[f"{side}_order_id"]
                button = incoming.get_by_role("button", name=f"原始{role}单 {order}", exact=True)
                expect(button).to_be_visible()
            incoming.get_by_role("button", name=f"原始买单 {fill['buy_order_id']}", exact=True).click()
            original = next(e for e in run["result"]["events"] if e.get("order_id") == fill["buy_order_id"]
                            and e["event_type"] == "order_submitted")
            expect(incoming.get_by_role("heading", name=f"事件 {original['tick']}", exact=True)).to_be_visible()
            incoming.close()
        shots = os.environ.get("CIVITAS_SCREENSHOTS")
        if shots:
            page.evaluate("window.scrollTo(0, 0)")
            page.screenshot(path=str(Path(shots) / f"{case_id}-observe-{width}.png"), full_page=True)
        page.reload()
        expect(page.get_by_role("button", name="已引用")).to_be_visible()
        page.get_by_role("button", name="解释结果", exact=True).click()
        wrong = next(value for key, value in course["questions"]["explain"]["options"].items()
                     if key != course["questions"]["explain"]["answer"])
        page.get_by_role("radio", name=wrong, exact=True).check()
        expect(page.get_by_text(course["questions"]["explain"]["feedback"], exact=True)).to_be_visible()
        page.get_by_role("button", name="比较反事实").click()
        for scenario in course["scenarios"][1:]:
            page.get_by_role("button", name="运行对照", exact=True).first.click()
            expect(page.get_by_role("row", name=scenario["label"], exact=False)).not_to_contain_text("待运行")
            if case_id == "information_cascade" and scenario["id"] == "private":
                metric = page.get_by_label("图表指标", exact=True)
                metric.select_option("cascade_start")
                expect(page.get_by_text("此指标在当前情景无数值。", exact=False)).to_be_visible()
                metric.select_option("public_a_pct")
                expect(page.get_by_text("此指标在当前情景无数值。", exact=False)).not_to_be_visible()
        expect(page.get_by_role("heading", name="同步比较", exact=True)).to_be_visible()
        sync = page.get_by_role("slider", name="同步观察点")
        sync.focus()
        page.keyboard.press("ArrowRight")
        expect(sync).not_to_have_attribute("aria-valuetext", "开局")
        links = page.get_by_role("link", name="查看原事件", exact=False)
        assert 1 <= links.count() <= 2
        if case_id == "school_matching":
            sync.press("End")
            expect(sync).to_have_attribute("aria-valuetext", "各自结束")
            page.locator("#paired-metric").select_option("student_true_rank")
            expect(page.locator(".paired-values")).to_contain_text("2 位")
            expect(page.locator(".paired-values")).to_contain_text("1 位")
        if case_id in {"schelling_segregation", "svb_run"} and width == 1440:
            evidence = context.new_page()
            address = links.first.get_attribute("href")
            evidence.goto(local_app + address)
            expect(evidence.get_by_role("heading", name=course["title"], exact=True)).to_be_visible()
            expect(evidence.get_by_role("heading", name="事件 " + address.rsplit("=", 1)[1], exact=True)).to_be_visible()
            evidence.close()
        page.get_by_role("button", name="跳到下一条证据").click()
        page.get_by_role("button", name="引用此事件").click()
        assert page.locator("body").evaluate("(el) => el.scrollWidth <= innerWidth")
        if shots:
            page.evaluate("window.scrollTo(0, 0)")
            page.screenshot(path=str(Path(shots) / f"{case_id}-compare-{width}.png"), full_page=True)
        page.get_by_role("button", name="写实验笔记", exact=True).last.click()
        for field in ["观察", "机制解释", "成立条件", "迁移"]:
            page.get_by_role("textbox", name=field, exact=field != "迁移").fill("据本次事件比较规则改变时的结果。")
        page.get_by_role("button", name="完成学习", exact=True).click()
        expect(page.get_by_role("button", name="已完成学习")).to_be_disabled()
        with page.expect_download() as download:
            page.get_by_role("button", name="导出实验笔记").click()
        saved = tmp_path / "note.json"
        download.value.save_as(str(saved))
        note = json.loads(saved.read_text())
        assert note["complete"] and note["case_id"] == case_id
        assert len(note["runs"]) >= 3 and len({e["run_id"] for e in note["evidence"]}) == 2
        page.get_by_role("navigation", name="课程目录").get_by_role("link", name="双向拍卖", exact=True).click()
        expect(page.get_by_role("button", name="开始实验")).to_be_visible()
        page.get_by_label("导入学习记录").set_input_files(str(saved))
        expect(page.get_by_role("alert")).to_be_visible()
        page.get_by_role("navigation", name="课程目录").get_by_role("link", name=course["title"], exact=True).click()
        expect(page.get_by_role("button", name="已完成学习")).to_be_visible()
        page.get_by_role("button", name="Civitas Economica").click()
        page.get_by_label("导入学习记录").set_input_files(str(saved))
        expect(page.get_by_text("已恢复学习记录。")).to_be_visible()
        expect(page.get_by_role("button", name="已完成学习")).to_be_visible()
        if case_id == "schelling_segregation" and width == 1440:
            page.get_by_role("navigation", name="学习阶段").get_by_role("button", name=course["lessons"][2]["title"]).click()
            page.get_by_label(course["action"]["label"], exact=True).select_option("stay")
            page.get_by_role("button", name="运行实验", exact=True).click()
            expect(page.get_by_role("heading", name=course["lessons"][3]["title"], exact=True)).to_be_visible()
            raw = page.evaluate("JSON.parse(localStorage.getItem('civitas/schelling_segregation/1.0.0'))")
            assert raw["reviewRequired"] and not raw["complete"] and len(raw["runs"]) == 1 and not raw["evidence"]
            assert raw["notes"]["observation"] == "据本次事件比较规则改变时的结果。"
        assert not external and not errors
        browser.close()
