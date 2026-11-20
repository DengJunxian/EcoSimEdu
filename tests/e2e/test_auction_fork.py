import hashlib
import json
from pathlib import Path
import re

import pytest
from playwright.sync_api import expect, sync_playwright


def verify_auction_fork(page, base, boundary=False):
    market = "&market=no-overlap" if boundary else ""
    bid = 35 if boundary else 96
    page.goto(base + "/explore/?lesson=double_auction&flow=v3" + market)

    def hit(scope, name):
        scope.get_by_role("button", name=name, exact=True).press("Enter")

    for label in ("进入故事", "开始预测与决策"):
        hit(page, label)
    page.get_by_label("开局限价（代币）").fill(str(bid))
    for label in ("确认限价", "不会成交" if boundary else "会成交", "观察个体决策"):
        hit(page, label)
    tab = page.get_by_role("tab", name="主体", exact=True)
    if tab.is_visible():
        tab.press("Enter")
    page.get_by_role("combobox", name="选择个体").select_option("B01")
    hit(page, "单步前进")
    hit(page, "观察群体变化")

    lab = page.get_by_role("region", name="试一次中途撤单")
    result = lab.get_by_role("region", name="撤单对照")
    expect(lab.get_by_role("button", name="撤回限价单并运行分支")).to_have_count(0)
    hit(lab, "走到可撤单的事件 2")
    expect(lab.get_by_role("heading", name="试一次中途撤单")).to_be_focused()
    bar = page.get_by_role("region", name="共用回放控制")
    expect(bar).to_contain_text("事件 2 · 已暂停")
    expect(lab).to_contain_text(f"订单 O001 仍在簿上，限价 {bid} 代币")
    expect(lab.get_by_role("button", name="撤回限价单并运行分支")).to_be_disabled()
    trend = "不变" if boundary else "减少"
    lab.get_by_role("radio", name=trend, exact=True).check()
    hit(lab, "撤回限价单并运行分支")
    expect(result).to_contain_text(f"原预测为「{trend}」")
    volumes = "0 0" if boundary else "6 4"
    volume_row = result.get_by_role("row", name=re.compile(r"累计成交.*" + volumes))
    expect(volume_row).to_be_visible()
    if boundary:
        expect(result.get_by_role("row", name=re.compile(r"最近成交价.*未定义 未定义"))).to_be_visible()
    else:
        expect(result.get_by_role("row", name=re.compile(r"B01 已成交.*1 0"))).to_be_visible()
    result.get_by_label("核对时点").select_option("1")
    expect(result.get_by_role("table", name="第 1 轮末成交对照")).to_be_visible()
    result.get_by_text("核对撤单与下一笔成交", exact=True).press("Enter")
    expect(result).to_contain_text("分支事件 3 · B01 撤回 O001")
    if boundary:
        expect(result.get_by_text("此后无成交。", exact=False)).to_have_count(2)
    else:
        expect(result).to_contain_text("事件 4 · O001 与 O003 按在簿单 O001 的 96 代币成交")
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")

    page.reload()
    expect(bar).to_contain_text("事件 2 · 已暂停")
    expect(volume_row).to_be_visible()
    with page.expect_download() as downloaded:
        hit(result, "导出中途撤单证据")
    report = json.loads(Path(downloaded.value.path()).read_text())
    assert report["schema"] == "ecosimedu.auction-fork/v1"
    assert (report["checkpoint"], report["action"], report["prediction"]) == (
        2, "cancel-open-order", "same" if boundary else "down")
    left, right = report["baseline"], report["branch"]
    assert left["frames"][:3] == right["frames"][:3]
    assert right["envelope"]["inputs"]["parentRunId"] == left["envelope"]["runId"]
    assert right["sources"][1]["eventId"] == "3"
    for side in (left, right):
        book = [[frame["book"], frame["accounts"]] for frame in side["frames"]]
        assert hashlib.sha256(json.dumps(book, separators=(",", ":")).encode()).hexdigest() == side["bookDigest"]
    assert right["frames"][3]["record"]["checkpoint_event"] == 2
    assert right["frames"][3]["accounts"] == left["frames"][2]["accounts"]

    page.locator("#microscope summary").press("Enter")
    page.get_by_role("radio", name="我的角色", exact=True).check()
    expect(lab).to_have_count(0)
    page.get_by_role("radio", name="系统观察者", exact=True).check()
    expect(volume_row).to_be_visible()
    hit(page, "快进到收盘")
    expect(lab.get_by_role("button", name="撤回限价单并运行分支")).to_have_count(0)
    hit(page, "试一项政策")
    expect(volume_row).to_be_visible()
    expect(page.get_by_role("region", name="预测后运行")).to_be_visible()
    return lab


@pytest.mark.parametrize("boundary", [False, True])
def test_auction_fork_resumes_the_book_and_preserves_missing_prices(local_app, launch_education_browser, boundary):
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 900}, accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/")
                   and "/api/ai/" not in route.request.url else route.abort())
        verify_auction_fork(page, local_app, boundary)
        assert not errors
