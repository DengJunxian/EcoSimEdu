import hashlib
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def verify_fork(page, base):
    course = base + "/explore/?lesson=schelling_segregation&flow=v3"
    page.goto(course)

    def hit(scope, name):
        scope.get_by_role("button", name=name, exact=True).press("Enter")

    for action in ("进入故事", "开始预测与决策", "原址周围和新址周围的住户", "搬到标记的空格", "观察个体决策",
                   "查看 A001", "单步前进", "观察群体变化"):
        hit(page, action)

    lab = page.get_by_role("region", name="在轮末再搬一次")
    expect(lab.get_by_label("迁入空格")).to_have_count(0)
    expect(lab.get_by_role("region", name="轮间迁居对照")).to_have_count(0)
    hit(lab, "走到第 1 轮末")
    expect(lab.get_by_role("heading", name="在轮末再搬一次")).to_be_focused()
    bar = page.get_by_role("region", name="共用回放控制")
    expect(bar).to_contain_text("事件 73 · 已暂停")
    select = lab.get_by_label("迁入空格")
    select.select_option("19")
    expect(lab.get_by_role("button", name="运行分支并核对")).to_be_disabled()
    lab.get_by_role("radio", name="增加", exact=True).check()
    hit(lab, "运行分支并核对")
    expect(lab.get_by_role("heading", name="在轮末再搬一次")).to_be_focused()
    results = lab.get_by_role("region", name="轮间迁居对照")
    expect(results).to_contain_text("原预测为「增加」")
    expect(results).to_contain_text("2.39 个百分点")
    expect(results.get_by_role("row", name="收尾", exact=False)).to_contain_text("84.55")
    expect(results.get_by_role("row", name="收尾", exact=False)).to_contain_text("86.94")
    focus = results.get_by_role("region", name="分支原事件")
    expect(focus).to_contain_text("分支 · 事件 74")
    expect(focus).to_contain_text("A001 从")
    hit(results, "基线事件 73")
    expect(focus).to_contain_text("基线 · 事件 73")
    expect(bar).to_contain_text("事件 73 · 已暂停")
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")

    page.reload()
    expect(bar).to_contain_text("事件 73 · 已暂停")
    expect(results).to_contain_text("84.55")
    expect(results).to_contain_text("86.94")
    with page.expect_download() as downloaded:
        hit(results, "导出轮间迁居证据")
    report = json.loads(Path(downloaded.value.path()).read_text())
    assert report["schema"] == "ecosimedu.schelling-fork/v1" and report["checkpoint"] == 73
    assert report["destination"] == 19 and report["prediction"] == "up"
    left, right = report["baseline"], report["branch"]
    assert left["frames"][:74] == right["frames"][:74]
    assert left["records"][:74] == right["records"][:74]
    assert left["envelope"]["runId"] == right["envelope"]["inputs"]["parentRunId"]
    assert len({left["envelope"]["resultDigest"]["value"], right["envelope"]["resultDigest"]["value"]}) == 2
    for side in (left, right):
        boards = [frame["board"] for frame in side["frames"]]
        assert hashlib.sha256(json.dumps(boards, separators=(",", ":")).encode()).hexdigest() == side["gridDigest"]
    assert right["sources"][1]["frameTick"] == 74
    assert right["records"][74]["data"]["checkpoint_event"] == 73
    assert right["frames"][74]["board"]["cells"][19] == "A001"

    page.locator("#microscope summary").press("Enter")
    page.get_by_role("radio", name="我的角色", exact=True).check()
    expect(lab).to_have_count(0)
    page.get_by_role("radio", name="系统观察者", exact=True).check()
    expect(results).to_contain_text("86.94")
    hit(page, "试一项政策")
    expect(results).to_contain_text("86.94")
    page.reload()
    expect(results).to_contain_text("86.94")
    expect(page.get_by_role("region", name="预测后运行")).to_be_visible()
    return results


def test_fork_recovers_from_the_round_boundary_and_preserves_the_parent(local_app, launch_education_browser):
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 900}, accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/")
                   and "/api/ai/" not in route.request.url else route.abort())
        verify_fork(page, local_app)
        assert not errors
