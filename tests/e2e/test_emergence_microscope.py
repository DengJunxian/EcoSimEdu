import json
import os
import re
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright


@pytest.mark.parametrize("width", [390, 1440])
def test_student_traces_a_real_move_and_submits_a_paired_explanation(
    local_app, launch_education_browser, audit_education, width,
):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        context = browser.new_context(viewport={"width": width, "height": 940}, accept_downloads=True)
        external, errors = [], []

        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        context.route("**/*", local_only)
        page = context.new_page()
        page.set_default_timeout(8000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        assert page.goto(local_app + "/learn/schelling_segregation").ok
        page.get_by_role("button", name="开始学习", exact=True).press("Enter")
        page.get_by_role("radio", name="暂不确定", exact=True).check()
        page.get_by_label("社区格局预测").select_option(label="最终会出现空间分化")
        page.get_by_label("预测依据").fill("阈值只检查局部，格局也受到起点影响。")
        page.get_by_role("button", name="选择行动", exact=True).press("Enter")
        page.get_by_role("combobox", name=re.compile("你是 A001")).select_option("move")
        with page.expect_response(lambda reply: "classroom-view?tick=0" in reply.url) as opening_reply:
            page.get_by_role("button", name="运行基础实验", exact=True).press("Enter")
        opening = opening_reply.value.json()
        key = opening["run_id"]
        stored = context.request.get(f"{local_app}/api/runs/{key}/export").json()
        move = stored["result"]["events"][1]
        assert move["actor_id"] == "A001" and move["event_type"] == "student_move"

        scope = page.locator(".emergence-studio")
        scope.locator("summary").press("Enter")
        expect(scope).to_contain_text("已固定 A001")
        expect(scope).to_contain_text("这个系统观察点没有记录搬迁")
        expect(scope.get_by_role("button", name="运行初态对照")).to_have_count(0)
        page.get_by_role("button", name="下一个事件", exact=True).press("Enter")
        expect(scope.get_by_role("heading", name="搬迁与邻域 · 事件 1")).to_be_visible()
        expect(scope).to_contain_text("算术恒等式 · 已从前后网格独立复算两项比例")
        expect(scope).to_contain_text(f'从 {"/".join(map(str, move["before"]))} 变为 {"/".join(map(str, move["after"]))}')
        scope.get_by_text("按区间反查搬迁", exact=True).press("Enter")
        start = scope.get_by_role("spinbutton", name="起点事件")
        end_point = scope.get_by_role("spinbutton", name="终点事件")
        expect(end_point).to_have_attribute("max", "1")
        expect(end_point).to_have_accessible_description(re.compile("已揭示事件 0 至 1"))
        start.fill("0")
        end_point.fill("0")
        expect(scope.get_by_text("这个区间没有搬迁记录。")).to_be_visible()
        expect(end_point).to_have_accessible_description(re.compile("这个区间没有搬迁记录"))
        scope.get_by_role("button", name="在曲线上选区间").press("Tab")
        expect(scope.get_by_role("heading", name="这个区间没有搬迁记录。")).to_be_focused()
        end_point.fill("1")
        expect(scope.get_by_role("status").get_by_text("区间内有 1 次搬迁。")).to_be_visible()
        expect(end_point).to_have_accessible_description(re.compile("区间内有 1 次搬迁"))
        interval = scope.get_by_role("table", name="区间内的搬迁")
        expect(interval.get_by_role("row")).to_have_count(2)
        if target := os.environ.get("CIVITAS_EMERGENCE_SCREENSHOTS"):
            interval.locator("xpath=ancestor::details[1]").screenshot(path=str(Path(target) / f"schelling-interval-{width}.png"))
        interval.get_by_role("button", name="事件 1 · A001").press("Enter")
        expect(scope.get_by_role("heading", name="搬迁与邻域 · 事件 1")).to_be_focused()
        lens = scope.get_by_role("region", name="三个证据镜头")
        lens.get_by_label("证据镜头").select_option("meso")
        expect(lens).to_contain_text("的邻居集合受到影响")
        lens.get_by_label("证据镜头").select_option("macro")
        expect(lens).to_contain_text("同类邻接率")
        scope.get_by_label("证据视角").select_option("role")
        expect(lens).to_contain_text("A001 · 第")
        expect(lens.get_by_role("link")).to_have_count(0)
        expect(scope.get_by_role("heading", name="全图指标")).to_have_count(0)
        expect(page.get_by_role("button", name=re.compile("第 1 行第 1 列"))).to_have_count(0)
        scope.get_by_label("证据视角").select_option("system")
        expect(lens).to_contain_text("同类邻接率")
        audit_education(page, f"emer-move-{width}", "main")
        neighbor = move["changed_neighbors"][0]["actor"]
        changed = page.get_by_role("table", name="事件 1 · 同组／已占邻居")
        changed.get_by_role("button", name=neighbor, exact=True).press("Enter")
        expect(scope).to_contain_text(f"已固定 {neighbor}")
        scope.get_by_role("button", name="核对我的区间反查").press("Enter")
        expect(scope.get_by_text("反查成立。", exact=False)).to_be_visible()
        expect(scope.get_by_role("heading", name=re.compile("反查成立"))).to_be_focused()
        scope.get_by_role("button", name=f"引用此搬迁与 {neighbor} 的邻域").press("Enter")
        expect(page.get_by_text(f"已引用事件 1（{neighbor}）。", exact=True)).to_be_visible()

        page.get_by_role("button", name="快进到结束", exact=True).press("Enter")
        enter = page.get_by_role("button", name="进入解释", exact=True)
        expect(enter).to_be_enabled()
        enter.press("Enter")
        microscope = scope.get_by_text("涌现显微镜", exact=True)
        if scope.get_attribute("open") is None:
            microscope.press("Enter")
        expect(scope.get_by_role("heading", name="全图指标")).to_be_visible()
        expect(page.get_by_label("社区格局预测")).to_have_count(0)
        end = stored["result"]["events"][-1]["tick"]
        chart = scope.get_by_role("img", name=re.compile("同类邻接率随事件变化"))
        chart.scroll_into_view_if_needed()
        bounds = chart.bounding_box()
        assert bounds
        chart.click(position={"x": bounds["width"] * (78 + 484 / end) / 595, "y": bounds["height"] / 2})
        expect(scope.get_by_role("heading", name="搬迁与邻域 · 事件 1")).to_be_focused()
        expect(scope).to_contain_text("已从同类邻接率定位事件 1")
        expect(scope).to_contain_text(f"已固定 {neighbor}")
        assert key in scope.get_by_role("link", name="打开事件来源").get_attribute("href")
        value = stored["result"]["snapshots"][1]["metrics"]["similarity"]
        expect(scope.get_by_role("table", name="该次搬迁前后").get_by_role("row",
               name=re.compile("同类邻接率"))).to_contain_text(f"{value}%")
        scope.get_by_text("查看指标数据", exact=True).press("Enter")
        rows = scope.get_by_role("table", name="同类邻接率（%）")
        rows.get_by_role("button", name="事件 0", exact=True).press("Enter")
        expect(scope.get_by_role("heading", name="搬迁与邻域 · 事件 0")).to_be_focused()
        expect(scope).to_contain_text("该点无搬迁记录")
        page.get_by_role("button", name="下一个事件", exact=True).press("Enter")
        expect(scope.get_by_role("heading", name="搬迁与邻域 · 事件 1")).to_be_visible()

        scope.get_by_role("button", name="运行初态对照").press("Enter")
        expect(scope.get_by_role("table", name=re.compile("配对差异"))).to_be_visible()
        scope.get_by_label("对照观察点").select_option(label="更新轮次 1")
        expect(scope.get_by_role("table", name="配对差异 · 更新轮次 1")).to_be_visible()
        branch_link = scope.get_by_role("link", name=re.compile("分支事件"))
        branch_key = re.search(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", branch_link.get_attribute("href")).group()
        branch = context.request.get(f"{local_app}/api/runs/{branch_key}/export").json()
        assert branch["parent_run_id"] == key
        assert branch["seed"] == stored["seed"] and branch["action"] == stored["action"]
        assert branch["result"]["root_hash"] == stored["result"]["root_hash"]
        assert branch["result"]["initial_hash"] != stored["result"]["initial_hash"]
        assert branch["result"]["intervention"] == {"threshold": 30, "initial_layout": "mixed"}
        data = context.request.get(f"{local_app}/api/runs/{key}/compare/{branch_key}").json()
        row = next(point for point in data["rows"] if point["checkpoint"] == 1)
        assert row["baseline"]["tick"] != row["branch"]["tick"]
        scope.get_by_role("button", name="引用此初态对照").press("Enter")
        expect(scope.get_by_role("button", name="已引用初态对照")).to_be_disabled()

        scope.get_by_text("写一张机制解释卡", exact=True).press("Enter")
        submit = scope.get_by_role("button", name="提交解释卡")
        expect(submit).to_be_disabled()
        for label, answer in {
            "我的论断": "一次搬迁改变了特定住户的邻接边。",
            "主体怎样作出行动": "A001 使用了开局允许的预留空格。",
            "互动怎样形成总体结果": f"查 {neighbor} 的前后比例。两项全图比例的分母不同。",
            "成立条件": "对照固定了种子、开局选择和阈值，改变了布局。",
            "另一种可能的解释": "不同空位可达性也可能改变格局，需要另设实验验证。",
        }.items():
            scope.get_by_role("textbox", name=label).fill(answer)
        for checkbox in scope.get_by_role("checkbox").all():
            checkbox.check()
        for index, field in enumerate(scope.get_by_role("combobox", name=re.compile("证据用途")).all()):
            field.select_option("observed_transition" if index == 0 else "paired_difference")
        scope.get_by_role("button", name="检查解释结构").press("Enter")
        expect(scope.get_by_text("本卡已使用结构提示。", exact=True)).to_be_visible()
        audit_education(page, f"emer-explanation-{width}", ".emergence-studio")
        expect(submit).to_be_enabled()
        submit.press("Enter")
        expect(scope.get_by_text("解释卡已保存。", exact=True)).to_be_visible()
        with page.expect_download() as exported:
            scope.get_by_role("button", name="导出解释卡 JSON").press("Enter")
        card = json.loads(Path(exported.value.path()).read_text())
        assert card["task_id"] == "schelling-emergence-v1"
        assert card["structure_help_used"]
        assert sorted(card["source_uses"].values()) == ["observed_transition", "paired_difference", "paired_difference"]
        assert {(ref["run_id"], ref["seq"]) for ref in card["source_refs"]} == {
            (key, move["seq"]), (key, row["baseline"]["tick"]), (branch_key, row["branch"]["tick"]),
        }
        assert card["source_refs"][0]["actor"] == neighbor
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        if target := os.environ.get("CIVITAS_EMERGENCE_SCREENSHOTS"):
            page.get_by_role("heading", name="全图指标").scroll_into_view_if_needed()
            page.screenshot(path=str(Path(target) / f"schelling-microscope-{width}.png"))
        page.reload()
        scope.get_by_text("涌现显微镜", exact=True).press("Enter")
        scope.get_by_text("写一张机制解释卡", exact=True).press("Enter")
        expect(scope.get_by_role("textbox", name="我的论断")).to_have_value("一次搬迁改变了特定住户的邻接边。")
        page.goto(local_app + "/notes")
        expect(page.get_by_text("证据已核对 · 初态对照 · 更新轮次 1", exact=False)).to_be_visible()
        if width == 1440:
            with page.expect_download() as backup:
                page.get_by_role("button", name="导出原始记录", exact=True).press("Enter")
            restored = browser.new_page()
            restored.goto(local_app + "/notes")
            restored.get_by_label("恢复新版笔记").set_input_files(backup.value.path())
            restored.get_by_role("button", name="导入新版笔记").press("Enter")
            expect(restored.get_by_text("新版学习记录已恢复", exact=False)).to_be_visible()
            expect(restored.get_by_text("证据已核对 · 初态对照 · 更新轮次 1", exact=False)).to_be_visible()
            restored.close()
        else:
            page.goto(local_app + "/learn/schelling_segregation?explore=1")
            expect(page.locator(".emergence-studio")).to_have_attribute("open", "")
            nav = page.get_by_role("navigation", name="窄屏探究视图")
            nav.get_by_role("button", name="主体", exact=True).press("Enter")
            expect(page.get_by_role("region", name="主体", exact=True)).to_contain_text(neighbor)
            nav.get_by_role("button", name="系统结果").press("Enter")
            expect(page.get_by_role("region", name="系统结果", exact=True)).to_contain_text("同类邻接率")
            nav.get_by_role("button", name="经济世界").press("Enter")
            expect(page.locator(".emergence-studio")).to_contain_text(f"已固定 {neighbor}")
        assert not external and not errors
        browser.close()
