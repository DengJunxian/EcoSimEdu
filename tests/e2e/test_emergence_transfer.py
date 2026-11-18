import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def test_cross_case_transfer_reopens_real_sources_and_keeps_teacher_review(local_app, launch_education_browser):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        context = browser.new_context(viewport={"width": 390, "height": 900}, accept_downloads=True)
        page = context.new_page()
        assert page.goto(local_app + "/practice").ok
        task = page.get_by_role("region", name="银行兑付与订单簿深度")
        task.get_by_role("button", name="运行两门课的规则实验").click()
        for label in ("硅谷银行挤兑", "闪电崩盘"):
            selection = task.get_by_role("combobox", name=f"{label}事件")
            expect(selection).to_be_enabled()
            selection.select_option(index=1)
        for label, answer in [
            ("主体约束", "储户申请现金，做市者受资金和库存约束。"),
            ("互动与传导", "实际兑付消耗现金，撮合或撤单会移除买量。"),
            ("系统指标", "现金按资金单位计，买方深度按有效买单剩余股数计。"),
            ("边界与对照", "两场实验使用各自时钟，各自来源只能支持模型内过程。"),
        ]:
            task.get_by_role("textbox", name=label).fill(answer)
        task.get_by_role("button", name="提交双来源解释").press("Enter")
        expect(task.get_by_text("首次无提示 · 待教师复核")).to_be_visible()
        expect(task.get_by_role("heading", name="双来源解释已保存，待教师复核。")).to_be_focused()
        if screenshots := os.environ.get("CIVITAS_EMERGENCE_SCREENSHOTS"):
            task.get_by_role("region", name="已提交作答").screenshot(path=str(Path(screenshots) / "paired-transfer-390.png"))
        with page.expect_download() as exported:
            task.get_by_role("button", name="导出迁移作答").click()
        filename = Path(exported.value.path())
        data = json.loads(filename.read_text())
        for case_id, source in zip(("svb_run", "flash_crash"), data["attempt"]["source_refs"], strict=True):
            origin = context.request.get(f'{local_app}/api/runs/{source["run_id"]}/events/{source["seq"]}').json()
            assert origin["case_id"] == case_id and source["result_hash"] == origin["result_hash"]
            assert source["event_type"] == origin["event"]["event_type"]

        teacher = browser.new_page()
        teacher.goto(local_app + "/practice?review=svb-flash")
        damaged = json.loads(filename.read_text())
        damaged["attempt"]["source_refs"][1]["result_hash"] = "0" * 64
        teacher.get_by_label("导入迁移作答").set_input_files({
            "name": "damaged.json", "mimeType": "application/json", "buffer": json.dumps(damaged).encode(),
        })
        teacher.get_by_role("button", name="核对并导入作答").click()
        expect(teacher.get_by_role("alert")).to_contain_text("无法核对")
        teacher.get_by_label("导入迁移作答").set_input_files(filename)
        teacher.get_by_role("button", name="核对并导入作答").press("Enter")
        expect(teacher.get_by_role("heading", name="双来源作答已核对并导入。")).to_be_focused()
        expect(teacher.get_by_role("link", name="打开硅谷银行挤兑来源")).to_be_visible()
        expect(teacher.get_by_role("link", name="打开闪电崩盘来源")).to_be_visible()
        for dimension in ("主体约束", "互动与传导", "系统指标", "边界与对照"):
            teacher.get_by_role("combobox", name=dimension).select_option("2")
        teacher.get_by_label("复核结论").select_option("pass")
        teacher.get_by_label("复核评语").fill("两条来源与所用的计量口径相符。")
        save_review = teacher.get_by_role("button", name="保存教师复核")
        expect(save_review).to_be_enabled()
        save_review.press("Enter")
        expect(teacher.get_by_text("8 / 8 · 达标")).to_be_visible()
        expect(teacher.get_by_role("heading", name="教师复核已保存。8 分，达标。")).to_be_focused()
        teacher.reload()
        expect(teacher.get_by_text("8 / 8 · 达标")).to_be_visible()
        if screenshots:
            teacher.get_by_role("region", name="已提交作答").screenshot(path=str(Path(screenshots) / "teacher-review.png"))
        with teacher.expect_download() as reviewed:
            teacher.get_by_role("button", name="导出教师复核").press("Enter")
        assert reviewed.value.suggested_filename == "EcoSimEdu-教师复核.json"
        task.get_by_label("导入教师复核").set_input_files(reviewed.value.path())
        task.get_by_role("button", name="核对并导入复核").press("Enter")
        expect(task.get_by_role("heading", name="教师复核已导入。8 分，达标。")).to_be_focused()
        expect(task.get_by_text("8 / 8 · 达标")).to_be_visible()
        page.goto(local_app + "/practice?review=svb-flash")
        page.get_by_text("本机任务核对", exact=True).press("Enter")
        expect(page.get_by_text("1 / 1 · 待复核 0")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        browser.close()
