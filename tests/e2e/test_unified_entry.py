import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest
from playwright.sync_api import expect, sync_playwright

from test_auction_scenes import STUDY_KEY, enter_quote


@pytest.fixture
def former_progressive_origin():
    build = Path(__file__).resolve().parents[2] / "frontend/dist"
    handler = partial(SimpleHTTPRequestHandler, directory=str(build))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        worker = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        worker.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            worker.join()


def test_unified_entry_keeps_original_run_notes_and_learning_archive(local_app, launch_education_browser):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        context = browser.new_context(viewport={"width": 390, "height": 900}, accept_downloads=True)
        external = []

        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        context.route("**/*", local_only)
        page = context.new_page()
        enter_quote(page, local_app)
        page.get_by_label("开局限价").fill("96")
        page.get_by_role("button", name="提交开局报价").click()
        page.get_by_role("button", name="快进到收盘").click()
        page.get_by_role("button", name="进入剩余解释").click()
        task = page.get_by_role("region", name="课堂练习")
        task.get_by_label("卖方剩余（代币）").fill("10")
        task.get_by_label("平台收入（代币）").fill("4")
        task.get_by_role("button", name="提交作答").click()
        expect(task.get_by_role("heading", name="核对正确", exact=True)).to_be_visible()
        original = page.evaluate("(key) => localStorage.getItem(key)", STUDY_KEY)
        run_id = json.loads(original)["runs"]["baseline"]

        page.goto(local_app + "/")
        expect(page).to_have_title("EcoSimEdu · 学生实验室")
        page.get_by_role("link", name="打开渐进课堂", exact=True).press("Enter")
        expect(page).to_have_url(local_app + "/explore/")
        expect(page.get_by_role("article")).to_have_count(12)
        page.goto(local_app + "/?lesson=svb_run&check=keep")
        expect(page).to_have_url(local_app + "/explore/?lesson=svb_run&check=keep")
        page.goto(local_app + "/explore?lesson=svb_run&check=keep")
        expect(page).to_have_url(local_app + "/explore/?lesson=svb_run&check=keep")
        page.reload()
        expect(page.get_by_role("heading", level=1)).to_have_text("银行有资产，工资款为什么还没到账？")
        assert page.request.get(local_app + "/explore/assets/missing.js").status == 404
        page.get_by_role("link", name="原课堂与进度").press("Enter")
        expect(page).to_have_url(local_app + "/learn/svb_run?scene=intro")
        page.go_back()
        expect(page).to_have_url(local_app + "/explore/?lesson=svb_run&check=keep")
        expect(page.get_by_role("heading", level=1)).to_have_text("银行有资产，工资款为什么还没到账？")

        page.goto(local_app + "/explore/?view=notes")
        page.get_by_role("link", name="原版实验笔记与学习记录").press("Enter")
        expect(page).to_have_url(local_app + "/notes")
        assert page.evaluate("(key) => localStorage.getItem(key)", STUDY_KEY) == original
        page.get_by_text("备份此浏览器的作答记录", exact=True).press("Enter")
        with page.expect_download() as archive:
            page.get_by_role("button", name="导出作答记录").press("Enter")
        attempts = json.loads(Path(archive.value.path()).read_text())["attempts"]
        assert attempts and any(attempt["case_id"] == "double_auction" for attempt in attempts)
        closed = page.url
        page.close()
        page = context.new_page()
        page.goto(closed)
        assert page.evaluate("(key) => localStorage.getItem(key)", STUDY_KEY) == original

        page.goto(f"{local_app}/?case=double_auction&run={run_id}&event=4")
        expect(page.get_by_role("heading", name="事件 4", exact=True)).to_be_visible()
        result = page.request.get(f"{local_app}/api/runs/{run_id}").json()
        assert result["run_id"] == run_id and result["result"]["events"][4]["price"] == 96
        assert not external, external
        browser.close()


def test_four_stage_backup_migrates_between_ports_without_clearing_source(
    local_app, former_progressive_origin, launch_education_browser,
):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        context = browser.new_context(viewport={"width": 390, "height": 900}, accept_downloads=True)
        origins = (local_app + "/", former_progressive_origin + "/")
        context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origins) else route.abort())

        origin = context.new_page()
        origin.goto(former_progressive_origin + "/?lesson=double_auction")
        origin.get_by_label("开局限价（代币）").fill("96")
        for button in ("确认限价", "不会成交", "观察个体决策"):
            origin.get_by_role("button", name=button, exact=True).press("Enter")
        origin.get_by_role("button", name="你 · 买家 B01", exact=False).press("Enter")
        for button in ("单步前进", "观察群体变化", "播放"):
            origin.get_by_role("button", name=button, exact=True).press("Enter")
        pause = origin.get_by_role("region", name="当前成交证据与下一步")
        expect(pause.get_by_text("结算价 96 代币来自在簿订单 O001。")).to_be_visible(timeout=10_000)
        pause.get_by_role("button", name="下一步 · 查看后续报价").press("Enter")
        pause.get_by_role("button", name="试一项政策").press("Enter")
        origin.get_by_role("slider").press("End")
        origin.get_by_role("radio", name="减少").check()
        origin.get_by_role("button", name="运行并验证").press("Enter")
        form = origin.get_by_role("region", name="用两次运行解释机制")
        form.get_by_label("无干预证据").select_option("4")
        form.get_by_label("政策组证据").select_option(label=next(
            label for label in form.get_by_label("政策组证据").locator("option").all_text_contents() if "成交" in label
        ))
        for name, value in {"rule": "先到的 O001 决定结算价。", "calculation": "事件 4 支付 96 代币。",
                            "difference": "费用组与基线交易量不同。", "hypothesis": "比较保留原报价。"}.items():
            form.locator(f"[name={name}]").fill(value)
        form.get_by_role("button", name="保存解释", exact=True).press("Enter")
        expect(form.get_by_role("status")).to_contain_text("已引用基线事件 4")
        origin.get_by_role("link", name="实验笔记", exact=True).press("Enter")
        origin.get_by_text("备份与导入四阶学习", exact=True).press("Enter")
        with origin.expect_download() as archive:
            origin.get_by_role("button", name="导出四阶学习备份").press("Enter")
        filename = archive.value.path()
        entries = json.loads(Path(filename).read_text())["entries"]
        assert len(entries) == 2

        target = context.new_page()
        target.goto(local_app + "/?view=notes")
        expect(target).to_have_url(local_app + "/explore/?view=notes")
        expect(target.get_by_role("link", name="打开已保存的解释")).to_have_count(0)
        target.set_viewport_size({"width": 320, "height": 900})
        target.get_by_text("备份与导入四阶学习", exact=True).press("Enter")
        assert target.evaluate("document.documentElement.scrollWidth === innerWidth")
        for label in ("已导入 2 条，已有 0 条。", "已导入 0 条，已有 2 条。"):
            target.get_by_label("四阶学习备份", exact=True).set_input_files(filename)
            target.get_by_role("button", name="导入四阶学习备份").press("Enter")
            expect(target.get_by_role("status")).to_have_text(label)
        target.get_by_role("link", name="打开已保存的解释").press("Enter")
        expect(target.get_by_text("先到的 O001 决定结算价。")).to_be_visible()
        source_link = target.get_by_role("link", name="查看基线原事件 4").get_attribute("href")
        target.goto(local_app + "/" + source_link)
        expect(target.get_by_role("heading", level=1)).to_have_text("基线原事件 · 事件 4")
        target.reload()
        expect(target.get_by_text("double-auction/browser-v1/1962/base/96/0")).to_be_visible()
        target.go_back()
        expect(target.get_by_text("先到的 O001 决定结算价。")).to_be_visible()
        target.get_by_role("link", name="EcoSimEdu").press("Enter")
        target.get_by_role("link", name="继续上次学习").press("Enter")
        expect(target.get_by_role("heading", level=1)).to_have_text("反事实与制度实验")
        for key, value in entries:
            assert origin.evaluate("key => localStorage.getItem(key)", key) == value
        browser.close()
