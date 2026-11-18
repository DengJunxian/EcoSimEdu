from datetime import datetime, timezone
import json
import os
import re
from uuid import uuid4
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

from test_auction_scenes import STUDY_KEY, enter_quote


@pytest.mark.parametrize("width,bid", [(320, 1), (1440, 96)])
def test_auction_v3_retries_independence_and_transfer(local_app, launch_education_browser, audit_education, width, bid):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        touch = browser.browser_type.name == "webkit" and width == 320
        context = browser.new_context(viewport={"width": width, "height": 900}, reduced_motion="reduce",
                                      accept_downloads=True, is_mobile=touch, has_touch=touch)
        page = context.new_page()
        external, errors = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        page.route("**/*", local_only)
        if width == 1440:
            page.clock.install(time=datetime(2026, 11, 18, 4, tzinfo=timezone.utc))
        page.goto(local_app + "/cases/double_auction")
        expect(page.get_by_role("heading", name="学完能做什么")).to_be_visible()
        enter_quote(page, local_app)
        expect(page.get_by_text("独立教学练习 · 自编数据")).to_have_count(0)
        page.get_by_label("开局限价").fill(str(bid))
        page.get_by_role("button", name="提交开局报价").click()
        page.get_by_role("button", name="快进到收盘").click()
        page.get_by_role("button", name="进入剩余解释").click()
        if width == 1440:
            page.get_by_text("相近成交价下的两条市场路径", exact=True).press("Enter")
            page.get_by_role("button", name="运行两条市场路径").press("Enter")
            market_paths = page.get_by_role("table", name="同种子市场路径")
            expect(market_paths.get_by_text("99 代币／件", exact=True)).to_have_count(2)
            expect(market_paths.get_by_role("row", name=re.compile("基准"))).to_contain_text("6")
            expect(market_paths.get_by_role("row", name=re.compile("收费"))).to_contain_text("5")
            page.get_by_text("相近成交价下的两条市场路径", exact=True).press("Enter")
        task = page.get_by_role("region", name="课堂练习")
        answer = task.get_by_role("button", name="提交作答")
        expect(task.get_by_text("独立教学练习 · 自编数据")).to_be_visible()
        page.wait_for_function("(key) => { const row = JSON.parse(localStorage.getItem(key)); return row.tick < row.revealed; }", arg=STUDY_KEY)
        old = json.loads(page.evaluate("(key) => localStorage.getItem(key)", STUDY_KEY))
        example = task.get_by_role("button", name="看完整例题")
        if touch:
            example.tap()
        else:
            example.press("Enter")
        expect(task.get_by_role("heading", name="看一个完整例题")).to_be_focused()
        page.reload()
        expect(task.get_by_role("heading", name="看一个完整例题")).to_be_visible()
        task.get_by_role("button", name="返回原题").press("Enter")
        new = json.loads(page.evaluate("(key) => localStorage.getItem(key)", STUDY_KEY))
        for field in ("prediction", "pinned", "tick", "revealed", "runs"):
            assert old[field] == new[field]

        task.get_by_label("卖方剩余（代币）").fill("12")
        task.get_by_label("平台收入（代币）").fill("2")
        if width == 1440:
            page.evaluate("""() => {
                const add = IDBObjectStore.prototype.add;
                IDBObjectStore.prototype.add = function(...args) {
                    if (this.name === "attempts") {
                        IDBObjectStore.prototype.add = add;
                        throw new DOMException("injected", "QuotaExceededError");
                    }
                    return add.apply(this, args);
                };
            }""")
            answer.press("Enter")
            expect(task.get_by_role("alert")).to_contain_text("作答未保存")
            expect(task.get_by_text("再核对这一步", exact=True)).to_have_count(0)
            expect(task.get_by_label("卖方剩余（代币）")).to_have_value("12")
        answer.press("Enter")
        expect(task.get_by_role("heading", name="再核对这一步", exact=True)).to_be_focused()
        expect(task.get_by_text("有帮助或暴露未知。", exact=True)).to_be_visible()
        page.keyboard.press("Alt+Tab" if browser.browser_type.name == "webkit" else "Tab")
        expect(task.get_by_role("button", name="看提示")).to_be_focused()
        page.reload()
        expect(task.get_by_text("上次作答已保存", exact=False)).to_be_visible()
        task.get_by_label("卖方剩余（代币）").fill("10")
        task.get_by_label("平台收入（代币）").fill("4")
        answer.click()
        expect(task.get_by_role("heading", name="核对正确", exact=True)).to_be_focused()
        expect(task.get_by_text("已见同题反馈。", exact=True)).to_be_visible()
        task.get_by_role("button", name="下一练习").press("Enter")
        for label, value in [("买方剩余", "6"), ("卖方剩余", "9"), ("平台收入", "6"), ("三方合计", "21")]:
            task.get_by_label(f"{label}（代币）").fill(value)
        answer.click()
        expect(task.get_by_text("首次无本题帮助。", exact=True)).to_be_visible()
        audit_education(page, f"auction-{width}")
        if directory := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            task.screenshot(path=str(Path(directory) / f"ed03-auction-{width}.png"))
        task.get_by_role("button", name="下一练习").click()
        if width == 1440:
            task.get_by_role("button", name="看参考解").click()
            expect(task.get_by_text("买价 95 低于卖价 96", exact=False)).to_be_visible()
        task.get_by_role("button", name="跳过本题").click()
        task.get_by_role("button", name="跳过并返回课堂").click()
        expect(task.get_by_text("有独立应用证据", exact=True)).to_have_count(1)

        page.get_by_role("button", name="比较两项制度").click()
        page.get_by_label("选择条件").select_option("fee")
        page.get_by_label("预测收盘", exact=False).select_option("unknown")
        page.get_by_role("button", name="生成对照").click()
        page.get_by_role("button", name="写实验笔记").click()
        task.get_by_label("平台净收入（元）").fill("4")
        task.get_by_label("三方合计（元）").fill("16")
        answer.click()
        expect(task.get_by_text("已有迁移证据", exact=True)).to_have_count(1)
        expect(task.get_by_text("查看本课尝试（4）")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        if width == 1440:
            page.goto(local_app + "/notes")
            page.get_by_text("备份此浏览器的作答记录").click()
            with page.expect_download() as download:
                page.get_by_role("button", name="导出作答记录").click()
            exported = json.loads(Path(download.value.path()).read_text())
            assert len(exported["attempts"]) == 4
            assert [row["evidence_class"] for row in sorted(exported["attempts"], key=lambda row: row["submitted_at"])] == [
                "assisted", "repeated", "independent", "independent",
            ]
            assert exported["receipts"]
            assert any(row["answer_seen"] and "auc-crossing" in row["id"] for row in exported["exposures"])
            assert exported["records"]["reviews"]
            other = browser.new_page()
            other.goto(local_app + "/notes")
            other.get_by_text("备份此浏览器的作答记录").click()

            def restore(value):
                other.get_by_label("作答记录文件").set_input_files({
                    "name": "attempts.json", "mimeType": "application/json", "buffer": json.dumps(value).encode(),
                })
                other.get_by_role("button", name="恢复作答记录").click()

            restore({"attempts": []})
            expect(other.get_by_role("alert")).to_contain_text("从本平台导出")
            restore(exported)
            expect(other.get_by_text("已恢复 4 次作答。", exact=True)).to_be_visible()
            assert other.evaluate("""() => new Promise((resolve, reject) => {
                const open = indexedDB.open("ecosimedu-learning");
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                    const db = open.result;
                    const read = db.transaction("exposures").objectStore("exposures")
                        .get(JSON.stringify(["double_auction", "auc-crossing"]));
                    read.onsuccess = () => { db.close(); resolve(read.result.answer_seen); };
                    read.onerror = () => { db.close(); reject(read.error); };
                };
            })""")
            restore(exported)
            expect(other.get_by_text("这些作答已在本机。", exact=True)).to_be_visible()
            archived = json.loads(json.dumps(exported["attempts"][0]))
            archived["id"] = str(uuid4())
            archived["content_version"] = "0.9.0"
            archived["session_id"] = json.dumps([archived["local_profile_id"], archived["case_id"], "0.9.0"], separators=(",", ":"))
            restore({"kind": exported["kind"], "schema_version": 1, "attempts": [archived]})
            expect(other.get_by_text("另保留 1 次待核对的旧版作答", exact=False)).to_be_visible()
            conflicting = json.loads(json.dumps(exported))
            conflicting["attempts"][0]["submitted_at"] = datetime.now(timezone.utc).isoformat()
            restore(conflicting)
            expect(other.get_by_role("alert")).to_contain_text("同 ID")
            other.close()
            page.goto(local_app + "/review")
            expect(page.get_by_text("当前没有到期的复习。")).to_be_visible()
            page.clock.set_fixed_time(datetime(2026, 11, 19, 4, tzinfo=timezone.utc))
            page.reload()
            page.get_by_role("button", name="暂停复习").click()
            expect(page.get_by_text("已暂停", exact=False)).to_be_visible()
            page.get_by_role("button", name="恢复复习").click()
            page.get_by_label("三方合计（代币）", exact=True).fill("27")
            stale = page.context.new_page()
            stale.clock.set_fixed_time(datetime(2026, 11, 19, 4, tzinfo=timezone.utc))
            stale.goto(local_app + "/review")
            expect(stale.get_by_role("button", name="推迟复习")).to_be_visible()
            page.get_by_role("button", name="提交作答", exact=True).click()
            expect(page.get_by_text("支付在三个账户里抵消", exact=False)).to_be_visible()
            stale.get_by_role("button", name="推迟复习").click()
            expect(stale.get_by_text("复习安排已在另一页面更新。")).to_be_visible()
            stale.close()
            page.goto(local_app + "/concepts/C02")
            expect(page.get_by_text("有独立应用证据", exact=False)).to_be_visible()
            before_demo = page.evaluate("key => localStorage.getItem(key)", STUDY_KEY)
            page.goto(local_app + "/teach?case=double_auction")
            expect(page).to_have_title("双向拍卖教学活动 · EcoSimEdu · Civitas Economica")
            page.get_by_role("link", name="打开隔离展示课堂").click()
            page.get_by_role("button", name="领取买家身份").click()
            assert "demo=1" in page.url
            assert page.evaluate("key => localStorage.getItem(key)", STUDY_KEY) == before_demo
            page.get_by_role("link", name="返回个人课堂").click()
            expect(page.get_by_role("region", name="课堂练习").get_by_text("已有迁移证据", exact=True)).to_be_visible()
        assert not external and not errors
        browser.close()


@pytest.mark.parametrize("case_id", ["svb_run", "schelling_segregation"])
def test_field_flagship_learns_from_a_new_variant(local_app, launch_education_browser, audit_education, case_id):
    from services.simulation.lesson_scenes import load_lesson_scenes
    from services.simulation.lessons import load_case

    course = load_case(case_id)
    scenes = load_lesson_scenes(case_id)["scenes"]
    prediction = next(q for q in scenes[1]["questions"] if q.get("kind") == "prediction")
    uncertain = next(option["label"] for option in prediction["options"] if option["id"] == "unknown")
    bank = case_id == "svb_run"
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        page = browser.new_page(viewport={"width": 390, "height": 900}, reduced_motion="reduce")
        external = []

        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        page.route("**/*", local_only)
        page.goto(f"{local_app}/learn/{case_id}")
        page.get_by_role("button", name="开始学习", exact=True).press("Enter")
        page.get_by_role("group", name=prediction["prompt"], exact=True).get_by_role("radio", name=uncertain, exact=True).check()
        page.get_by_role("button", name="选择行动").click()
        page.get_by_role("button", name="运行基础实验").click()
        page.get_by_role("button", name="快进到结束").click()
        page.get_by_role("button", name="进入解释", exact=True).click()
        task = page.get_by_role("region", name="课堂练习")
        first = {"现金（资金单位）": "15", "存款（资金单位）": "55", "权益（资金单位）": "18"} if bank else {
            "已占邻居数（人）": "8", "同类比例（%）": "60",
        }
        for label, value in first.items():
            task.get_by_label(label, exact=True).fill(value)
        task.get_by_role("spinbutton").last.press("Enter")
        expect(task.get_by_role("heading", name="再核对这一步", exact=True)).to_be_focused()
        task.get_by_role("button", name="看完整例题").click()
        expect(task.get_by_role("heading", name="看一个完整例题")).to_be_focused()
        task.get_by_role("button", name="返回原题").click()
        corrected = dict(first)
        if bank:
            corrected["现金（资金单位）"] = "13"
        else:
            corrected["已占邻居数（人）"] = "5"
        for label, value in corrected.items():
            task.get_by_label(label, exact=True).fill(value)
        task.get_by_role("button", name="提交作答").click()
        expect(task.get_by_text("已见同题反馈。", exact=True)).to_be_visible()
        task.get_by_role("button", name="下一练习").click()
        independent = {"现金（资金单位）": "4", "存款（资金单位）": "57", "待付（资金单位）": "10",
                       "权益（资金单位）": "10"} if bank else {"搬离前（%）": "40", "搬离后（%）": "50"}
        for label, value in independent.items():
            task.get_by_label(label, exact=True).fill(value)
        task.get_by_role("button", name="提交作答").click()
        expect(task.get_by_text("首次无本题帮助。")).to_be_visible()
        task.get_by_role("button", name="下一练习").click()
        if bank:
            for index, option in enumerate(("observe", "threshold", "request", "pay"), 1):
                task.get_by_label(f"第 {index} 步", exact=True).select_option(option)
            task.get_by_role("button", name="提交作答").click()
            expect(task.get_by_text("核对正确", exact=True)).to_be_visible()
        audit_education(page, case_id)
        if directory := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            task.screenshot(path=str(Path(directory) / f"ed04-{case_id}.png"))
        page.get_by_role("button", name="进行对照", exact=True).click()
        for scenario in course["scenarios"][1:]:
            page.get_by_label("选择对照", exact=True).select_option(scenario["id"])
            page.get_by_label("对照预测", exact=True).select_option("unknown")
            page.get_by_role("button", name="运行对照", exact=True).click()
            expect(page.get_by_role("slider", name="同步观察点", exact=True)).to_be_enabled()
        page.get_by_role("button", name="写实验笔记").click()
        page.get_by_role("textbox", name="机制解释", exact=True).fill("根据两个已运行分支核对共同条件。")
        page.get_by_role("button", name="保存笔记", exact=True).click()
        task.get_by_role("radio", name="没有其他资金时缺现金 10，权益尚不能判断" if bank else "2", exact=True).check()
        task.get_by_role("button", name="提交作答").click()
        expect(task.get_by_text("已有迁移证据", exact=True)).to_be_visible()
        page.reload()
        expect(task.get_by_text("已有迁移证据", exact=True)).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not external
        browser.close()


def test_parameter_experiment_links_actual_runs_to_explanation(local_app, launch_education_browser):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        page = browser.new_page(viewport={"width": 768, "height": 900})
        page.set_default_timeout(8000)
        page.goto(local_app + "/compare?case=double_auction")
        page.get_by_text("先写实验计划", exact=True).click()
        initial = "如果费用使报价区间不再重叠，成交可能下降。"
        for label, value in {
            "实验问题": "费用改变了哪一步？", "运行前预测": initial, "准备改变的条件": "交易费用",
            "计划保持的条件": "种子和同一学生报价", "哪个结果会改变你的判断": "交易量相同但账户分配变化",
        }.items():
            page.get_by_label(label, exact=True).fill(value)
        page.get_by_label("预先选择观察指标").select_option("volume")
        page.get_by_label("每方交易费", exact=True).select_option(label="6")
        page.get_by_role("button", name="运行参数对照").click()
        expect(page.get_by_text(initial, exact=False)).to_be_visible()
        page.get_by_label("观察后的修订").fill("需要检查两个场景的实际成交与边际条件。")
        page.get_by_label("对照结论").fill("使用对齐后的同一观察点核对两组读数。")
        page.get_by_label("适用条件").fill("共同种子、同一角色选择及报价。")
        page.get_by_role("button", name="保存实验卡与当前观察点").click()
        expect(page.get_by_text("实验卡已保存", exact=True)).to_be_visible()
        expect(page.get_by_role("link", name="回课堂写解释卡")).to_be_visible()

        enter_quote(page, local_app)
        page.get_by_role("button", name="提交开局报价").click()
        page.get_by_role("button", name="快进到收盘").click()
        page.get_by_role("button", name="进入剩余解释").click()
        page.get_by_role("button", name="比较两项制度").click()
        page.get_by_label("选择条件").select_option("fee")
        page.get_by_label("预测收盘", exact=False).select_option("unknown")
        page.get_by_role("button", name="生成对照").click()
        page.get_by_role("button", name="写实验笔记").click()
        page.get_by_text("写一张机制解释卡", exact=True).click()
        page.get_by_label("加入参数对照", exact=True).select_option(label="费用改变了哪一步？")
        expect(page.get_by_text("运行引用有效", exact=False)).to_have_count(2)
        page.get_by_role("textbox", name="我的论断", exact=True).fill("只要价格更高，就创造更多总剩余。")
        page.get_by_role("button", name="检查解释结构").click()
        expect(page.get_by_text("机制推理留待自评或人工审阅", exact=False)).to_be_visible()
        page.get_by_role("button", name="保存解释卡").click()
        expect(page.get_by_text("解释卡已保存。")).to_be_visible()
        page.reload()
        page.get_by_text("写一张机制解释卡", exact=True).click()
        expect(page.get_by_role("textbox", name="我的论断", exact=True)).to_have_value("只要价格更高，就创造更多总剩余。")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        browser.close()


def test_emergence_ordering_uses_existing_help_exposure_without_replacing_old_activities(local_app, launch_education_browser):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        page = browser.new_page()
        page.set_default_timeout(8000)
        page.goto(local_app + "/learn/schelling_segregation")
        page.get_by_role("button", name="开始学习", exact=True).click()
        page.get_by_role("radio", name="暂不确定", exact=True).check()
        page.get_by_role("button", name="选择行动").click()
        page.get_by_role("button", name="运行基础实验").click()
        page.get_by_role("button", name="快进到结束").click()
        page.get_by_role("button", name="进入解释").click()
        task = page.get_by_role("region", name="课堂练习")
        for _ in range(3):
            task.get_by_role("button", name="跳过本题", exact=True).click()
        task.get_by_role("button", name="跳过并返回课堂").click()
        task.get_by_role("button", name="继续涌现练习").press("Enter")
        expect(task.get_by_text("把一次真实搬迁的三层核查按证据顺序排好。")).to_be_visible()
        task.get_by_role("button", name="看提示", exact=True).click()
        for index in range(1, 4):
            task.get_by_role("combobox", name=f"第 {index} 步").select_option(f"step-{index}")
        task.get_by_role("button", name="提交作答").click()
        expect(task.get_by_text("核对正确", exact=True)).to_be_visible()
        expect(task.get_by_text("有帮助或暴露未知。", exact=True)).to_be_visible()
        page.reload()
        expect(task.get_by_text("上次作答已保存", exact=False)).to_be_visible()
        browser.close()
