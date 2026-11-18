import json
import os
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

from services.simulation.auction import CASE, run_auction

LEARN = "/learn/double_auction"
STUDY_KEY = "civitas/double_auction/lesson-v2"
LEGACY_KEY = "civitas/double_auction/1.0.0"


def enter_quote(page, local_app):
    page.goto(local_app + LEARN)
    expect(page.get_by_role("heading", level=1)).to_have_text("走进交易大厅")
    page.get_by_role("radio", name="市场规定大家都用 95").check()
    expect(page.get_by_role("status")).to_contain_text("把 95 换成 90")
    page.get_by_role("radio", name="95 落在双方都接受的范围内").check()
    expect(page.get_by_role("status")).to_contain_text("各 10 代币")
    page.get_by_role("button", name="领取买家身份").click()
    expect(page.get_by_role("heading", level=1)).to_have_text("领取 B01 身份")
    page.go_back()
    expect(page.get_by_role("heading", level=1)).to_have_text("走进交易大厅")
    page.go_forward()
    expect(page.get_by_role("heading", level=1)).to_have_text("领取 B01 身份")
    page.get_by_role("radio", name="会成交", exact=True).check()
    page.get_by_label("信心", exact=True).select_option("中")
    page.get_by_label("最高总支出").fill("108")
    page.get_by_role("button", name="去报价").click()
    page.get_by_role("checkbox", name="我接受这笔单会留到成交或收盘").check()


@pytest.mark.parametrize("width", [320, 390, 768, 1440])
def test_auction_scene_offline_from_price_to_notebook(local_app, width, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": width, "height": 920}, accept_downloads=True)
        errors, external = [], []

        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        context.route("**/*", local_only)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.set_default_timeout(6000)
        enter_quote(page, local_app)
        page.get_by_label("开局限价").fill("200")
        page.get_by_role("button", name="提交开局报价").click()
        expect(page.get_by_role("alert")).to_contain_text("私人价值约束")
        page.get_by_label("开局限价").fill("96")
        page.get_by_role("button", name="提交开局报价").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("找出成交的那一刻")
        expect(page.get_by_text("当前时点尚无成交。")).to_be_visible()
        expect(page.get_by_role("button", name="成交事件", exact=False)).to_have_count(0)
        expect(page.get_by_text("当前证据无法确定", exact=False)).to_be_visible()
        page.get_by_role("button", name="下一步", exact=True).click()
        expect(page.get_by_text("B01 · 96 代币限价 · 已入簿，尚未成交")).to_be_visible()
        play = page.get_by_role("button", name="播放至成交")
        play.focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name="96 代币成交")).to_be_visible()
        expect(page.get_by_text("逐笔核对", exact=False)).to_have_count(0)
        playback = page.get_by_role("region", name="市场时间").get_by_role("slider")
        if width == 390:
            page.evaluate("""() => {
                const original = window.fetch;
                const blocked = new Promise(resolve => { window.releaseAuctionFrames = resolve; });
                window.fetch = (input, options) => {
                    const response = original(input, options);
                    return String(input).includes('/auction-view?') && window.releaseAuctionFrames
                        ? Promise.all([response, blocked]).then(([value]) => value)
                        : response;
                };
            }""")
            playback.press("ArrowLeft")
            playback.press("ArrowLeft")
            expect(playback).to_have_value("2")
            expect(page.get_by_role("heading", name="96 代币成交")).to_be_visible()
            page.evaluate("() => { window.releaseAuctionFrames(); delete window.releaseAuctionFrames; }")
            expect(playback).to_have_attribute("aria-valuetext", "事件 2，第 1 轮，报价入簿")
            playback.press("End")
            expect(page.get_by_role("heading", name="96 代币成交")).to_be_visible()
        price_point = page.get_by_role("button", name="成交事件 4，96 代币")
        price_point.focus()
        page.keyboard.press("Enter")
        expect(playback).to_be_focused()
        expect(page.get_by_text("先到在簿")).to_be_visible()
        expect(page.get_by_text("与原预测一致", exact=False)).to_be_visible()
        expect(page.get_by_role("button", name="取消固定 B01")).to_be_visible()
        seller_order = page.get_by_role("button", name="卖单 O", exact=False)
        seller_order.click()
        expect(page.get_by_text("返回已固定主体 B01")).to_be_visible()
        if width == 390:
            page.evaluate("""() => {
                const original = window.fetch;
                let holdFifthFrame = true;
                window.fetch = (input, options) => {
                    if (holdFifthFrame && String(input).includes('/auction-view?tick=5&')) {
                        holdFifthFrame = false;
                        return new Promise(resolve => { window.releaseFifthFrame = () => resolve(original(input, options)); });
                    }
                    return original(input, options);
                };
            }""")
            play.press("Enter")
            page.wait_for_function("typeof window.releaseFifthFrame === 'function'")
        page.get_by_role("button", name="定位卖单原报价 · 事件 3", exact=True).press("Enter")
        if width == 390:
            expect(play).to_be_visible()
        expect(playback).to_be_focused()
        expect(playback).to_have_attribute("aria-valuetext", "事件 3，第 1 轮，报价入簿")
        if width == 390:
            page.evaluate("window.releaseFifthFrame()")
        page.get_by_role("button", name="返回已固定主体 B01").press("Enter")
        actor = page.get_by_role("combobox", name="查看主体")
        expect(actor).to_be_focused()
        expect(actor).to_have_value("B01")
        playback.press("End")
        expect(page.get_by_role("heading", name="96 代币成交")).to_be_visible()
        page.get_by_role("button", name="引用此笔成交").click()
        page.reload()
        expect(page.get_by_role("button", name="已加入笔记")).to_be_visible()
        expect(page.get_by_role("button", name="取消固定 B01")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        if target := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            page.screenshot(path=str(Path(target) / f"auction-observe-{width}.png"), full_page=True)

        page.get_by_role("button", name="快进到收盘").click()
        expect(page.get_by_role("button", name="进入剩余解释")).to_be_enabled()
        page.get_by_role("button", name="进入剩余解释").click()
        expect(page.get_by_role("heading", name="价值、成本与配置")).to_be_visible()
        summary = page.get_by_text("逐笔核对", exact=False)
        summary.press("Enter")
        ledger = page.get_by_role("table", name="截至事件 4 的结算加总 · 代币")
        expect(ledger.get_by_role("row", name="累计 35")).to_be_visible()
        ledger.get_by_role("button", name="事件 4", exact=True).press("Enter")
        expect(page.get_by_role("heading", name="96 代币成交")).to_be_visible()
        trade = next(event for event in run_auction("baseline", CASE["seed"], 96)["events"]
                     if event["event_type"] == "trade")
        for label, field in [("买方剩余", "buyer_surplus"), ("卖方剩余", "seller_surplus"), ("平台费用", "platform_fee")]:
            page.get_by_label(label, exact=True).fill(str(trade[field]))
        page.get_by_role("button", name="核对结算").click()
        expect(page.get_by_text("对账一致。", exact=False)).to_be_visible()
        if width == 390:
            task = page.get_by_role("region", name="课堂练习")
            task.get_by_text("查看本课尝试（1）", exact=True).click()
            expect(task.get_by_text("实际成交结算", exact=False)).to_be_visible()
            rows = page.evaluate("""() => new Promise((resolve, reject) => {
                const open = indexedDB.open("ecosimedu-learning");
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                    const read = open.result.transaction("attempts").objectStore("attempts").getAll();
                    read.onsuccess = () => { open.result.close(); resolve(read.result); };
                    read.onerror = () => reject(read.error);
                };
            })""")
            assert len(rows) == 1 and rows[0]["evidence_class"] == "assisted"
            assert rows[0]["source_refs"][0]["event_type"] == "trade"
            assert len(rows[0]["source_refs"][0]["result_hash"]) == 64
        page.get_by_role("button", name="比较两项制度").click()
        for branch in ("demand", "fee"):
            page.get_by_label("选择条件").select_option(branch)
            page.get_by_label("预测收盘", exact=False).select_option("unknown")
            page.get_by_role("button", name="生成对照").click()
            slider = page.get_by_role("slider", name="同步观察点", exact=False)
            slider.focus()
            page.keyboard.press("End")
            expect(slider).to_have_attribute("aria-valuetext", "收盘")
            expect(page.get_by_text("平台收入", exact=False)).to_have_count(2)
            if branch == "fee":
                page.get_by_role("button", name="核对该情景最近一笔成交").click()
                expect(page.get_by_text("平台 12 ＝", exact=False)).to_be_visible()
            page.get_by_role("button", name="引用此对照").click()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.get_by_role("button", name="写实验笔记", exact=True).click()
        page.get_by_label("机制解释", exact=True).fill("先在簿的买单以 96 代币成交。")
        page.get_by_label("成立条件", exact=True).fill("价格时间优先，且开局限价保持不变。")
        page.get_by_role("button", name="保存笔记").click()
        saved_note = page.get_by_role("status").filter(has_text="笔记已保存在此浏览器")
        expect(saved_note).to_be_visible()
        expect(page.get_by_text("证据已核对", exact=False)).to_have_count(2)
        with page.expect_download() as exported:
            page.get_by_role("button", name="导出可读笔记").click()
        assert "先在簿的买单" in Path(exported.value.path()).read_text()
        assert page.evaluate("key => localStorage.getItem(key)", LEGACY_KEY) is None
        page.get_by_role("link", name="EcoSimEdu", exact=True).click()
        expect(page.get_by_role("link", name="回到课堂")).to_be_visible()
        page.get_by_role("link", name="回到课堂").click()
        expect(page.get_by_label("机制解释")).to_have_value("先在簿的买单以 96 代币成交。")
        if width == 1440:
            with page.expect_download() as exported:
                page.get_by_role("button", name="导出原始记录").click()
            source = Path(exported.value.path())
            original = json.loads(source.read_text())
            restored = browser.new_context(viewport={"width": 320, "height": 850})
            restored.route("**/*", local_only)
            other = restored.new_page()
            other.goto(local_app + "/notes")
            upload = other.get_by_label("恢复新版笔记", exact=False)

            def import_file(file):
                upload.set_input_files(file)
                other.get_by_role("button", name="导入新版笔记").press("Enter")

            missing = {**original, "runs": {**original["runs"], "baseline": "7e06d230-d2ab-4765-9c99-c58b05bc3bdd"}}
            import_file({"name": "missing.json", "mimeType": "application/json", "buffer": json.dumps(missing).encode()})
            expect(other.get_by_role("alert")).to_contain_text("运行记录已缺失")
            assert other.evaluate("key => localStorage.getItem(key)", STUDY_KEY) is None

            for _ in range(2):
                import_file(source)
                expect(other.get_by_role("status").last).to_contain_text("新版学习记录已恢复")
                expect(other.get_by_text("证据已核对", exact=False)).to_have_count(2)
            before = other.evaluate("key => localStorage.getItem(key)", STUDY_KEY)
            assert json.loads(before) == original
            changed = {**original, "notes": {**original["notes"], "condition": "不覆盖已有条件"}}
            import_file({"name": "changed.json", "mimeType": "application/json", "buffer": json.dumps(changed).encode()})
            expect(other.get_by_role("alert")).to_contain_text("已有该课的新版记录")
            assert other.evaluate("key => localStorage.getItem(key)", STUDY_KEY) == before
            assert other.evaluate("document.documentElement.scrollWidth <= innerWidth")
            other.reload()
            expect(other.get_by_text("证据已核对", exact=False)).to_have_count(2)
            other.get_by_role("link", name="继续课堂").click()
            expect(other.get_by_label("机制解释")).to_have_value("先在簿的买单以 96 代币成交。")
            restored.close()
        assert not errors and not external
        browser.close()


@pytest.mark.parametrize("provider", ["rule", "replay"])
def test_unfilled_order_and_fixed_replay_paths(local_app, provider, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page()
        page.set_default_timeout(6000)
        enter_quote(page, local_app)
        page.get_by_label("开局限价").fill("1")
        page.get_by_label("运行方式").select_option(provider)
        if provider == "replay":
            expect(page.get_by_label("开局限价")).to_have_value("96")
            expect(page.get_by_label("开局限价")).not_to_be_editable()
        page.get_by_role("button", name="提交开局报价" if provider == "rule" else "加载固定回放").click()
        expect(page.get_by_text("当前时点尚无成交。")).to_be_visible()
        page.get_by_label("查看方式").select_option("review")
        expect(page.get_by_role("button", name="成交事件", exact=False).first).to_be_visible()
        page.get_by_label("查看方式").select_option("guided")
        expect(page.get_by_text("当前时点尚无成交。")).to_be_visible()
        page.get_by_role("button", name="快进到收盘").click()
        if provider == "rule":
            expect(page.get_by_text("已收盘，B01 在本次运行未成交", exact=False)).to_be_visible()
            page.get_by_role("button", name="查看收盘撤单").click()
            page.get_by_role("button", name="引用收盘未成交").click()
            expect(page.get_by_role("button", name="已加入笔记")).to_be_visible()
            page.evaluate("""key => {
                const data = JSON.parse(localStorage.getItem(key));
                data.evidence[0].engine_version = "forged";
                localStorage.setItem(key, JSON.stringify(data));
            }""", STUDY_KEY)
            page.goto(local_app + "/notes")
            expect(page.get_by_text("证据待修复", exact=False)).to_be_visible()
            expect(page.get_by_text("证据已核对", exact=False)).to_have_count(0)
        else:
            expect(page.get_by_text("预计算仿真", exact=True)).to_be_visible()
            expect(page.get_by_text("B01 在本次运行已成交", exact=False)).to_be_visible()
        assert page.evaluate("key => JSON.parse(localStorage.getItem(key)).provider", STUDY_KEY) == provider
        browser.close()


def test_resume_legacy_saved_run_keeps_original_record(local_app, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page()
        page.set_default_timeout(6000)
        page.goto(local_app + "/?case=double_auction")
        page.get_by_role("button", name="开始实验").click()
        page.get_by_role("radio", name="不确定", exact=True).check()
        page.get_by_role("button", name="去报价").click()
        page.get_by_role("button", name="运行实验", exact=True).click()
        expect(page.get_by_role("heading", name="观察撮合")).to_be_visible()
        page.get_by_role("button", name="跳到下一笔成交").click()
        expect(page.get_by_role("button", name="引用此笔成交")).to_be_visible()
        before = page.evaluate("key => localStorage.getItem(key)", LEGACY_KEY)
        old = json.loads(before)
        run_id = old["runs"]["baseline"]
        page.goto(local_app + LEARN)
        page.get_by_role("button", name="用旧版基准运行继续").click()
        expect(page.get_by_role("heading", name="96 代币成交")).to_be_visible()
        assert page.evaluate("key => localStorage.getItem(key)", LEGACY_KEY) == before
        latest = page.evaluate("key => JSON.parse(localStorage.getItem(key))", STUDY_KEY)
        assert latest["runs"]["baseline"] == run_id
        assert latest["tick"] == old["selections"][run_id]["tick"]
        page.set_viewport_size({"width": 320, "height": 920})
        page.get_by_role("combobox", name="场景 4 / 7", exact=True).select_option("intro")
        expect(page.get_by_role("heading", name="走进交易大厅")).to_be_visible()
        browser.close()
