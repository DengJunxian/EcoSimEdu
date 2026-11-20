import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def verify_svb_fork(page, base):
    page.goto(base + "/explore/?lesson=svb_run&flow=v3")

    def hit(scope, name):
        scope.get_by_role("button", name=name, exact=True).press("Enter")

    for action in ("进入故事", "开始预测与决策", "实际支付时", "第一轮提交", "观察个体决策"):
        hit(page, action)
    tab = page.get_by_role("tab", name="主体", exact=True)
    if tab.is_visible():
        tab.press("Enter")
    page.get_by_role("combobox", name="选择个体").select_option("D01")
    hit(page, "单步前进")
    hit(page, "观察群体变化")

    lab = page.get_by_role("region", name="暂缓一次防御性提款")
    result = lab.get_by_role("region", name="暂缓提款对照")
    expect(lab.get_by_role("button", name="暂缓一轮并运行分支")).to_have_count(0)
    hit(lab, "走到第 2 轮末")
    expect(lab.get_by_role("heading", name="暂缓一次防御性提款")).to_be_focused()
    bar = page.get_by_role("region", name="共用回放控制")
    expect(bar).to_contain_text("第 2 轮 · 已暂停")
    expect(lab.get_by_role("button", name="暂缓一轮并运行分支")).to_be_disabled()
    expect(lab).to_contain_text("银行待付 107，现金 0")
    expect(lab).to_contain_text("17 资金单位")
    lab.get_by_role("radio", name="减少", exact=True).check()
    hit(lab, "暂缓一轮并运行分支")

    expect(result).to_contain_text("原预测为「减少」")
    expect(result.get_by_role("row", name="待付金额 738 721")).to_be_visible()
    expect(result.get_by_role("row", name="累计实付 540 540")).to_be_visible()
    expect(bar).to_contain_text("第 2 轮 · 已暂停")
    result.get_by_text("查看本轮 D01、急售和借款流水", exact=True).press("Enter")
    expect(result.get_by_role("region", name="分支流水")).to_contain_text("事件 3/1 · D01 你选择本轮暂缓")
    result.get_by_label("核对轮次").select_option("4")
    expect(result.get_by_role("region", name="分支流水")).to_contain_text("D01 申请 17")
    result.get_by_label("核对轮次").select_option("20")
    expect(result.get_by_role("row", name="待付金额 257 257")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")

    page.reload()
    expect(bar).to_contain_text("第 2 轮 · 已暂停")
    expect(result.get_by_role("row", name="待付金额 738 721")).to_be_visible()
    with page.expect_download() as downloaded:
        hit(result, "导出暂缓提款证据")
    report = json.loads(Path(downloaded.value.path()).read_text())
    assert report["schema"] == "ecosimedu.svb-fork/v1"
    assert (report["checkpoint"], report["action"], report["prediction"]) == (2, "defer-protective", "down")
    left, right = report["baseline"], report["branch"]
    assert left["frames"][:3] == right["frames"][:3]
    assert left["observations"][:3] == right["observations"][:3]
    assert left["network"] == right["network"]
    assert left["envelope"]["runId"] == right["envelope"]["inputs"]["parentRunId"]
    assert right["sources"][0]["eventId"] == "3/1"
    assert set(ref["tick"] for ref in right["frames"][3]["events"][0]["observed"]) == {1, 2}

    page.locator("#microscope summary").press("Enter")
    page.get_by_role("radio", name="我的角色", exact=True).check()
    expect(lab).to_have_count(0)
    page.get_by_role("radio", name="系统观察者", exact=True).check()
    expect(result).to_be_visible()
    hit(page, "单步前进")
    hit(page, "试一项政策")
    expect(result).to_be_visible()
    expect(page.get_by_role("region", name="预测后运行")).to_be_visible()
    return lab


def test_svb_fork_keeps_the_original_ledger_and_can_be_restored(local_app, launch_education_browser):
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 900}, accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/")
                   and "/api/ai/" not in route.request.url else route.abort())
        verify_svb_fork(page, local_app)
        assert not errors
