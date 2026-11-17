import json
import os
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright


@pytest.mark.parametrize("width", [1440, 1280, 768, 390, 320])
def test_complete_learning_path_with_external_network_blocked(local_app, width, tmp_path, chromium_options):
    target = os.environ.get("CIVITAS_SCREENSHOTS")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": width, "height": 960}, accept_downloads=True)
        external, page_errors = [], []
        def route_request(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()
        context.route("**/*", route_request)
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(local_app + "/?case=double_auction")
        expect(page.get_by_role("heading", name="双向拍卖 价格是怎样形成的？")).to_be_visible()
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
        if target:
            page.screenshot(path=str(Path(target) / f"home-{width}.png"), full_page=True)
        page.keyboard.press("Tab")
        expect(page.get_by_role("link", name="跳到主要内容", exact=True)).to_be_focused()
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Civitas Economica")).to_be_focused()
        for label in ("首页", "案例库", "学习路径", "实验笔记", "模型实验"):
            page.keyboard.press("Tab")
            expect(page.get_by_role("link", name=label, exact=True)).to_be_focused()
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="开始实验")).to_be_focused()
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name="领取角色")).to_be_focused()
        page.get_by_label("不确定" if width == 390 else "不会成交", exact=True).check()
        page.get_by_role("button", name="去报价").click()
        if width == 390:
            page.get_by_role("button", name="播放预设").click()
        else:
            page.get_by_role("spinbutton").fill("96")
            if width == 1440:
                # Make the first start hit the server's actual terminal-state branch.
                def cancel_before_start(route):
                    cancel = route.request.url.removesuffix("/start") + "/cancel"
                    assert page.request.post(cancel, data={}).ok
                    route.continue_()
                page.route("**/api/runs/*/start", cancel_before_start, times=1)
                page.get_by_role("button", name="运行实验", exact=True).click()
                expect(page.get_by_role("alert")).to_contain_text("可用原参数重新运行")
            page.get_by_role("button", name="运行实验", exact=True).click()
        expect(page.get_by_role("heading", name="观察撮合")).to_be_visible()
        expect(page.get_by_text("预计算仿真" if width == 390 else "本次离线计算")).to_be_visible()
        if width == 1440:
            page.get_by_role("button", name="播放实验", exact=True).click()
            expect(page.get_by_text("首笔成交。", exact=False)).to_be_visible(timeout=15000)
            expect(page.get_by_role("button", name="播放实验", exact=True)).to_be_visible()
        else:
            page.get_by_role("button", name="跳到下一笔成交").click()
        page.get_by_role("button", name="引用此笔成交").click()
        page.get_by_text("查看两张原始订单").click()
        expect(page.get_by_text("在簿订单为", exact=False)).to_be_visible()
        if width == 1440:
            page.get_by_text("查看成交价格表", exact=True).click()
            price = page.get_by_role("table", name="已播放成交价格（代币 / 件）")
            expect(price.get_by_role("cell")).to_have_text("96")
        page.get_by_label("观察角色").select_option("B01")
        expect(page.get_by_text("B01 · 现金", exact=False)).to_be_visible()
        page.reload()
        expect(page.get_by_role("button", name="已引用")).to_be_visible()
        expect(page.get_by_label("观察角色")).to_have_value("B01")
        if target:
            page.screenshot(path=str(Path(target) / f"market-{width}.png"), full_page=True)
        page.get_by_role("button", name="揭示全市场价值").click()
        expect(page.get_by_text("买家 B01 成交了 1 件", exact=False)).to_be_visible()
        page.get_by_label("是", exact=True).check()
        expect(page.get_by_text("总剩余取决于", exact=False)).to_be_visible()
        page.get_by_role("button", name="比较反事实").click()
        run_title = "载入预计算对照" if width == 390 else "运行对照"
        page.get_by_role("button", name=run_title).first.click()
        expect(page.get_by_role("row", name="买方估值上升", exact=False)).to_contain_text("272")
        page.get_by_role("button", name=run_title).click()
        expect(page.get_by_role("row", name="每笔成交收费", exact=False)).to_contain_text("137")
        expect(page.get_by_role("heading", name="同步比较", exact=True)).to_be_visible()
        sync = page.get_by_role("slider", name="同步观察点")
        sync.focus()
        page.keyboard.press("ArrowRight")
        expect(sync).to_have_attribute("aria-valuetext", "报价轮次 0")
        expect(page.get_by_role("link", name="查看原事件", exact=False)).to_have_count(2)
        assert page.locator("body").evaluate("(el) => el.scrollWidth <= innerWidth")
        if width == 390:
            comparison = page.get_by_role("table", name="同一初始根状态下的实验对照")
            assert comparison.evaluate("(el) => el.scrollWidth <= el.clientWidth")
        page.get_by_role("button", name="跳到下一笔成交").click()
        page.get_by_role("button", name="引用此笔成交").click()
        if target:
            page.screenshot(path=str(Path(target) / f"compare-{width}.png"), full_page=True)
        page.get_by_role("button", name="写实验笔记", exact=True).last.click()
        for name, observation in (("观察", "我记录了首笔真实成交。"), ("机制解释", "在簿订单先到并决定成交价。"),
                                  ("成立条件", "在价格时间优先和当前限价中成立。"), ("迁移", "查看二手教材买方含费支出。")):
            page.get_by_role("textbox", name=name, exact=name != "迁移").fill(observation)
        page.get_by_role("button", name="完成学习", exact=True).click()
        expect(page.get_by_role("button", name="已完成学习")).to_be_disabled()
        if target:
            page.screenshot(path=str(Path(target) / f"notebook-{width}.png"), full_page=True)
        with page.expect_download() as file:
            page.get_by_role("button", name="导出实验笔记").click()
        save_path = tmp_path / "study.json"
        file.value.save_as(str(save_path))
        note = json.loads(save_path.read_text())
        assert note["complete"] and len(note["runs"]) == 3
        assert note["evidence"][0]["run_id"] == note["runs"]["baseline"]
        assert note["evidence"][1]["run_id"] == note["runs"]["fee"]
        page.reload()
        expect(page.get_by_role("button", name="已完成学习")).to_be_visible()
        page.get_by_role("button", name="Civitas Economica").click()
        page.get_by_label("导入学习记录").set_input_files(str(save_path))
        expect(page.get_by_text("已恢复学习记录。")).to_be_visible()
        expect(page.get_by_role("button", name="已完成学习")).to_be_visible()
        if width == 1440:
            page.get_by_role("button", name="提交报价").click()
            page.get_by_role("spinbutton").fill("1.5")
            page.reload()
            expect(page.get_by_role("spinbutton")).to_have_value("1.5")
            expect(page.get_by_role("button", name="运行实验", exact=True)).to_be_disabled()
            page.get_by_role("button", name="写实验笔记").click()
            expect(page.get_by_role("button", name="已完成学习")).to_be_visible()
            expect(page.get_by_role("textbox", name="观察", exact=True)).to_have_value("我记录了首笔真实成交。")
            note["evidence"][0]["seq"] = 0
            save_path.write_text(json.dumps(note))
            page.get_by_role("button", name="Civitas Economica").click()
            page.get_by_label("导入学习记录").set_input_files(str(save_path))
            expect(page.get_by_role("alert")).to_contain_text("成交证据无法核对")
        assert page.locator("body").evaluate("(el) => el.scrollWidth <= innerWidth")
        assert not page_errors and not external
        browser.close()
