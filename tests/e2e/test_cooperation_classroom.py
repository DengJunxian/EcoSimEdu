import os
from pathlib import Path
import re

import pytest
from playwright.sync_api import expect, sync_playwright


@pytest.mark.parametrize("case_id,width", [
    ("information_cascade", 390), ("public_goods", 768), ("commons_governance", 320),
])
def test_cooperation_models_show_current_evidence_after_submit(local_app, chromium_options, case_id, width):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": width, "height": 940})
        external = []
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def local_only(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        page.route("**/*", local_only)
        page.goto(f"{local_app}/learn/{case_id}")
        page.get_by_role("button", name="开始学习", exact=True).press("Enter")
        if case_id == "information_cascade":
            briefing = page.get_by_role("region", name="D03 可见信息")
            expect(briefing).to_contain_text("D01 选择 B、D02 选择 B")
            expect(briefing).to_contain_text("20%")
            expect(briefing).not_to_contain_text("真实箱子")
        page.get_by_role("radio", name="不确定", exact=True).check()
        page.get_by_role("button", name="选择行动", exact=True).press("Enter")
        page.get_by_role("button", name="运行基础实验", exact=True).press("Enter")
        next_event = page.get_by_role("button", name="下一个事件", exact=True)
        timeline = page.get_by_role("slider", name="回放事件", exact=True)

        def advance(index):
            expect(next_event).to_be_enabled()
            next_event.press("Enter")
            expect(timeline).to_have_attribute("aria-valuetext", re.compile(rf"事件 {index}$"))

        if case_id == "information_cascade":
            world = page.get_by_role("region", name="私人抽样与行动链")
            expect(world).to_contain_text("第一位参与者还未行动")
            for index in range(1, 4):
                advance(index)
            expect(world).to_contain_text("观察过 D01、D02 的公开行动")
            expect(world).to_contain_text("抽到 A 时会选 B，抽到 B 时会选 B")
            expect(world).to_contain_text("似然分别为 1 / 1")
            if target := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
                world.screenshot(path=str(Path(target) / "information_cascade-action-chain-390.png"))
            choose = world.get_by_role("button", name=re.compile(r"^D01 · 选择 B"))
            choose.press("Enter")
            expect(timeline).to_have_attribute("aria-valuetext", re.compile(r"事件 1$"))
            expect(world).to_contain_text("私人抽样待揭晓")
            page.get_by_role("radio", name="每个 B 都是一次独立抽样", exact=True).check()
            expect(page.get_by_text("若两种信号下都选 B", exact=False)).to_be_visible()
            page.get_by_role("radio", name="需检查每个行动怎样依赖私信号", exact=True).check()
            expect(page.get_by_text("对比同一位参与者", exact=False)).to_be_visible()
            world.get_by_role("button", name="引用这次行动", exact=True).press("Enter")
        elif case_id == "public_goods":
            world = page.get_by_role("region", name="公共池与小组账本")
            expect(world).to_contain_text("尚未开放贡献记录")
            advance(1)
            expect(world).to_contain_text("四笔贡献合计 39 代币")
            expect(world).to_contain_text("要等本轮结算")
            advance(2)
            world.get_by_role("button", name="P3", exact=True).press("Enter")
            expect(world).to_contain_text("P3 的本轮账本")
            expect(world).to_contain_text("本轮结算没有定向惩罚")
            expect(world).to_contain_text("103.4 净收益")
            world.get_by_role("button", name="引用本轮结算", exact=True).press("Enter")
        else:
            world = page.get_by_role("region", name="资源与管护账本")
            expect(world).to_contain_text("水域期初存量 180 单位")
            advance(1)
            expect(world).to_contain_text("本期再生仍待结算")
            advance(2)
            expect(world).to_contain_text("取用后余量 105 + 再生 32.484 = 下期期初 137.484 单位")
            expect(world).to_contain_text("检查 0 人")
            world.get_by_role("combobox", name="查看使用者", exact=True).select_option("F02")
            expect(world.get_by_role("combobox", name="查看使用者", exact=True)).to_have_value("F02")
            world.get_by_role("button", name="引用再生记录", exact=True).press("Enter")
        expect(page.get_by_text("已引用事件", exact=False)).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        if target := os.environ.get("CIVITAS_UPGRADE_SCREENSHOTS"):
            world.screenshot(path=str(Path(target) / f"{case_id}-mechanism-{width}.png"))
        assert not errors and not external
        browser.close()
