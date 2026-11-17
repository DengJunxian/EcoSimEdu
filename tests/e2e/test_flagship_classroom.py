import json
import os
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

from services.simulation.lessons import load_case


@pytest.mark.parametrize("case_id,width", [
    ("svb_run", 320), ("svb_run", 768), ("schelling_segregation", 390), ("schelling_segregation", 1440),
])
def test_flagship_seven_scenes_offline_with_synchronized_evidence(local_app, case_id, width, chromium_options):
    expected = load_case(case_id)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": width, "height": 940}, accept_downloads=True)
        errors, external = [], []
        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()
        context.route("**/*", local_only)
        page = context.new_page()
        page.set_default_timeout(7000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        url = local_app + f"/cases/{case_id}"
        assert page.goto(url).ok
        expect(page.get_by_role("link", name="打开原版课堂")).to_have_attribute("href", f"/?case={case_id}")
        page.get_by_role("link", name="进入课堂").click()
        page.get_by_role("button", name="开始学习", exact=True).press("Enter")
        page.go_back()
        expect(page).to_have_url(f"{local_app}/learn/{case_id}?scene=intro")
        page.go_forward()
        expect(page).to_have_url(f"{local_app}/learn/{case_id}?scene=predict")
        page.get_by_role("radio", name="不确定" if case_id == "svb_run" else "暂不确定", exact=True).check()
        page.get_by_label("预测信心").select_option("中")
        page.get_by_role("button", name="选择行动").press("Enter")
        page.get_by_role("button", name="运行基础实验").press("Enter")
        expect(page.get_by_role("button", name="进入解释")).to_be_disabled()
        timeline = page.get_by_role("slider", name="回放事件", exact=True)
        full = page.get_by_role("checkbox", name="查看全程")
        full.press("Space")
        expect(full).to_be_focused()
        expect(timeline).not_to_have_attribute("max", "1")
        full.press("Space")
        expect(full).to_be_focused()
        expect(timeline).to_be_disabled()
        play = page.get_by_role("button", name="播放", exact=True)
        expect(play).to_be_enabled()
        play.press("Enter")
        expect(page.get_by_text("到达观察节点，可核对当前事件后继续。", exact=True)).to_be_visible(timeout=10000)
        expect(play).to_be_visible()
        page.get_by_role("button", name="快进到结束").press("Enter")
        expect(page.get_by_role("button", name="进入解释")).to_be_enabled()
        page.get_by_text("指标图与事件", exact=True).click()
        cite = page.get_by_role("button", name="引用当前事件")
        if case_id != "svb_run":
            cite.click()
        page.get_by_role("button", name="进入解释").press("Enter")
        expect(page.get_by_text("原预测", exact=False)).to_contain_text("不确定")
        if case_id == "svb_run":
            page.get_by_role("button", name="定位正权益待付").press("Enter")
            page.get_by_role("button", name="引用轮末待付").press("Enter")
        page.get_by_role("button", name="进行对照").press("Enter")
        for scenario in expected["scenarios"][1:]:
            page.get_by_label("选择对照", exact=True).select_option(scenario["id"])
            page.get_by_label("对照预测", exact=True).select_option("unknown")
            page.get_by_role("button", name="运行对照").press("Enter")
            slider = page.get_by_role("slider", name="同步观察点")
            slider.press("End")
            expect(slider).to_have_attribute("aria-valuetext", "各自结束")
            expect(page.get_by_role("table", name="同一观察点的指标")).to_be_visible()
            page.get_by_role("button", name="引用此对照").press("Enter")
            expect(page.get_by_role("button", name="已引用对照")).to_be_disabled()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        if target := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            page.screenshot(path=str(Path(target) / f"{case_id}-compare-{width}.png"), full_page=True)

        page.get_by_role("button", name="写实验笔记").press("Enter")
        page.get_by_role("textbox", name="机制解释").fill("引用的模型事件支持这项解释。")
        page.get_by_role("textbox", name="成立条件与自评").fill("对照沿用同一学生行动与种子。")
        page.get_by_role("button", name="保存笔记").press("Enter")
        expect(page.get_by_text("笔记已保存在此浏览器。", exact=True)).to_be_visible()
        expect(page.get_by_text("证据已核对", exact=False)).to_have_count(3)
        with page.expect_download() as exported:
            page.get_by_role("button", name="导出可读笔记").press("Enter")
        assert "对照沿用同一学生行动与种子" in Path(exported.value.path()).read_text()
        page.reload()
        expect(page.get_by_role("textbox", name="机制解释")).to_have_value("引用的模型事件支持这项解释。")
        page.get_by_role("link", name="EcoSimEdu", exact=True).click()
        page.get_by_role("link", name="回到课堂").click()
        expect(page.get_by_role("textbox", name="机制解释")).to_have_value("引用的模型事件支持这项解释。")
        page.get_by_role("link", name="实验笔记", exact=True).click()
        expect(page.get_by_text("证据已核对", exact=False)).to_have_count(3)
        if width == 768:
            with page.expect_download() as archive:
                page.get_by_role("button", name="导出原始记录").click()
            source = Path(archive.value.path())
            original = json.loads(source.read_text())
            restored = browser.new_context()
            restored.route("**/*", local_only)
            other = restored.new_page()
            other.goto(local_app + "/notes")
            upload = other.get_by_label("恢复新版笔记", exact=False)
            submit = other.get_by_role("button", name="导入新版笔记")
            for forged in (
                {**original, "content_version": "unsupported"},
                {**original, "evidence": [{**original["evidence"][0], "result_hash": "0" * 64}]},
            ):
                upload.set_input_files({"name": "forged.json", "mimeType": "application/json",
                                        "buffer": json.dumps(forged).encode()})
                submit.press("Enter")
                expect(other.get_by_role("alert")).to_be_visible()
                assert other.evaluate("key => localStorage.getItem(key)", f"civitas/{case_id}/lesson-v2") is None
            upload.set_input_files(source)
            submit.press("Enter")
            expect(other.get_by_role("status")).to_contain_text("新版学习记录已恢复")
            expect(other.get_by_text("证据已核对", exact=False)).to_have_count(3)
            other.get_by_role("link", name="继续课堂").click()
            expect(other.get_by_role("textbox", name="机制解释")).to_have_value("引用的模型事件支持这项解释。")
            restored.close()
        if width in (320, 390):
            key = f"civitas/{case_id}/lesson-v2"
            data = json.loads(page.evaluate("key => localStorage.getItem(key)", key))
            data["evidence"][0]["engine_version"] = "forged/2"
            page.evaluate("([key, data]) => localStorage.setItem(key, JSON.stringify(data))", [key, data])
            page.reload()
            expect(page.get_by_text("证据待修复", exact=False)).to_have_count(1)
            expect(page.get_by_text("证据已核对", exact=False)).to_have_count(2)
        assert not errors and not external
        browser.close()
