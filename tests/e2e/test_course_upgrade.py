import json
import os
from pathlib import Path
from time import perf_counter

import pytest
from playwright.sync_api import expect, sync_playwright

from services.simulation.auction import ROOT
from services.simulation.lesson_scenes import load_lesson_scenes
from services.simulation.lessons import CATALOG, load_case


@pytest.mark.parametrize(
    "case_id,width",
    list(zip(CATALOG[3:], [320, 390, 768, 1440] * 3)),
)
def test_new_course_offline_decision_comparison_and_note(local_app, case_id, width, chromium_options):
    course = load_case(case_id)
    scenes = load_lesson_scenes(case_id)["scenes"]
    pack = json.loads((ROOT / "cases" / case_id / "learning-v3.json").read_text())
    starter = next(item for item in pack["items"] if item["assessment_role"] == "practice")
    independent = next(item for item in pack["items"] if item["assessment_role"] == "independent")
    transfer = next(item for item in pack["items"] if item["assessment_role"] == "transfer")
    prediction = next(q for q in scenes[1]["questions"] if q.get("kind") == "prediction")
    uncertain = next(option["label"] for option in prediction["options"] if option["id"] == "unknown")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": width, "height": 920}, accept_downloads=True)
        errors, outbound = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                outbound.append(route.request.url)
                route.abort()

        page.route("**/*", local_only)
        page.set_default_timeout(10000)
        assert page.goto(f"{local_app}/learn/{case_id}").ok
        expect(page.get_by_role("heading", level=1)).to_have_text(scenes[0]["title"])
        page.get_by_role("button", name="开始学习", exact=True).press("Enter")
        page.get_by_role("group", name=prediction["prompt"], exact=True).get_by_role("radio", name=uncertain, exact=True).check()
        page.get_by_role("button", name="选择行动").press("Enter")
        page.get_by_role("combobox", name=course["action"]["label"], exact=True).select_option(course["action"]["default"])
        page.get_by_role("button", name="运行基础实验").press("Enter")
        expect(page.get_by_role("heading", level=1)).to_have_text(scenes[3]["title"])
        expect(page.get_by_role("slider", name="回放事件")).to_be_disabled()
        fast = page.get_by_role("button", name="快进到结束", exact=True)
        expect(fast).to_be_enabled()
        fast.press("Enter")
        explain = page.get_by_role("button", name="进入解释", exact=True)
        expect(explain).to_be_enabled()
        started = perf_counter()
        explain.press("Enter")
        task = page.get_by_role("region", name="课堂练习")
        expect(task.get_by_role("button", name="提交作答", exact=True)).to_be_enabled()
        first_activity_ms = (perf_counter() - started) * 1000
        expect(page.get_by_role("heading", level=1)).to_have_text(scenes[4]["title"])
        expect(page.get_by_role("heading", name="回看入场预测")).to_be_visible()
        group_spec = next((q for q in scenes[4]["questions"] if q.get("kind") != "prediction"), None)
        if group_spec:
            group = page.get_by_role("group", name=group_spec["prompt"], exact=True)
            for option in group_spec["options"][:2]:
                group.get_by_role("radio", name=option["label"], exact=True).check()
                expect(group.get_by_role("status")).to_have_text(option["feedback"])
        if starter["kind"] == "numeric":
            field = starter["response_schema"]["fields"][0]
            task.get_by_label(f'{field["label"]}（{field["unit"]}）', exact=True).fill(
                str(starter["evaluator"]["answers"][0] + 1))
        else:
            wrong = next(option["label"] for option in starter["response_schema"]["options"]
                         if option["id"] != starter["evaluator"]["answer"])
            task.get_by_role("radio", name=wrong, exact=True).check()
        task.get_by_role("button", name="提交作答", exact=True).press("Enter")
        expect(task.get_by_text("再核对这一步", exact=True)).to_be_visible()
        task.get_by_role("button", name="看完整例题").press("Enter")
        expect(task.get_by_role("button", name="返回原题")).to_be_visible()
        task.get_by_role("button", name="返回原题").press("Enter")
        task.get_by_role("button", name="下一练习").press("Enter")
        if independent["kind"] == "numeric":
            field = independent["response_schema"]["fields"][0]
            task.get_by_label(f'{field["label"]}（{field["unit"]}）', exact=True).fill(str(independent["evaluator"]["answers"][0]))
        else:
            chosen = next(option["label"] for option in independent["response_schema"]["options"]
                          if option["id"] == independent["evaluator"]["answer"])
            task.get_by_role("radio", name=chosen, exact=True).check()
        started = perf_counter()
        task.get_by_role("button", name="提交作答", exact=True).press("Enter")
        expect(task.get_by_text("首次无本题帮助。", exact=True)).to_be_visible()
        submit_ms = (perf_counter() - started) * 1000
        page.get_by_role("button", name="进行对照", exact=True).press("Enter")
        for index, scenario in enumerate(course["scenarios"][1:]):
            page.get_by_label("选择对照", exact=True).select_option(scenario["id"])
            page.get_by_label("对照预测", exact=True).select_option("unknown")
            page.get_by_role("button", name="运行对照", exact=True).press("Enter")
            slider = page.get_by_role("slider", name="同步观察点", exact=True)
            slider.press("End")
            expect(page.get_by_role("table", name="同一观察点的指标")).to_be_visible()
            if index == 0:
                page.get_by_role("button", name="引用此对照", exact=True).press("Enter")
                expect(page.get_by_role("button", name="已引用对照", exact=True)).to_be_disabled()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        if directory := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            page.screenshot(path=str(Path(directory) / f"{case_id}-compare-{width}.png"), full_page=True)
        page.get_by_role("button", name="写实验笔记", exact=True).press("Enter")
        if transfer["kind"] == "numeric":
            field = transfer["response_schema"]["fields"][0]
            task.get_by_label(f'{field["label"]}（{field["unit"]}）', exact=True).fill(str(transfer["evaluator"]["answers"][0]))
        else:
            correct = next(option["label"] for option in transfer["response_schema"]["options"]
                           if option["id"] == transfer["evaluator"]["answer"])
            task.get_by_role("radio", name=correct, exact=True).check()
        task.get_by_role("button", name="提交作答", exact=True).press("Enter")
        expect(task.get_by_text("已有迁移证据", exact=True)).to_be_visible()
        page.get_by_role("textbox", name="机制解释", exact=True).fill("使用同步观察点与实际条件比较。")
        page.get_by_role("button", name="保存笔记", exact=True).press("Enter")
        expect(page.get_by_text("证据已核对", exact=False)).to_have_count(1)
        started = perf_counter()
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("""() => Array.from(document.querySelectorAll('textarea')).some(
            node => node.value === '使用同步观察点与实际条件比较。'
        ) && document.querySelector('[aria-label="课堂练习"]')?.textContent.includes('已有迁移证据')""")
        restore_ms = (perf_counter() - started) * 1000
        if directory := os.environ.get("CIVITAS_ED_PERFORMANCE"):
            Path(directory, f"{case_id}.json").write_text(json.dumps({
                "case": case_id, "width": width, "first_activity_ms": first_activity_ms,
                "submit_ms": submit_ms, "restore_ms": restore_ms,
            }) + "\n")
        assert not errors and not outbound
        browser.close()
