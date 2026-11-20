"""Exercise rule-only paired experiments, archived cards and failed seed assets."""
from copy import deepcopy
import json
import os
from pathlib import Path
import re
import sys

from playwright.sync_api import expect, sync_playwright

from workbench_probe import show_pane


BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8776/explore").rstrip("/")
ENGINE = sys.argv[2] if len(sys.argv) > 2 else "chromium"
WIDTH = int(sys.argv[3]) if len(sys.argv) > 3 else 390
OUT = Path("output/playwright/v2-08") / f"{ENGINE}-{WIDTH}"
OPTIONS = dict(viewport={"width": WIDTH, "height": 920}, accept_downloads=True, reduced_motion="reduce", has_touch=WIDTH <= 390)


def role(scope, kind, name):
    return scope.get_by_role(kind, name=name, exact=isinstance(name, str))


def press(scope, name):
    button = role(scope, "button", name)
    expect(button).to_be_enabled()
    button.press("Enter")


def details(page, name):
    summary = page.get_by_text(name, exact=True)
    panel = summary.locator("..")
    if not panel.evaluate("node => node.open"):
        summary.press("Enter")
    return panel


def begin(page, course, *, boundary=False):
    url = f"{BASE}/?lesson={course}" + ("&market=no-overlap" if boundary else "")
    page.goto(url)
    auction = course == "double_auction"
    if auction:
        page.get_by_label("开局限价（代币）").fill("35" if boundary else "96")
    for action in (("确认限价", "不会成交") if auction else ("第一轮提交", "提交申请时")):
        press(page, action)
    press(page, "观察个体决策")
    show_pane(page, "主体")
    role(page, "combobox", "选择个体").select_option("B01" if auction else "D01")
    press(page, "单步前进")
    press(page, "观察群体变化")
    press(page, "快进到收盘" if auction else "查看运行收尾")
    press(page, "试一项政策")
    expect(page.get_by_role("heading", level=1)).to_have_text("反事实与制度实验")
    page.get_by_role("slider").press("End")


def execute(page, prediction, multi=False):
    run = role(page, "button", "运行并验证")
    expect(run).to_be_disabled()
    role(page, "radio", prediction).press("Space")
    if multi:
        checkbox = role(page, "checkbox", re.compile("同时比较另外两组种子"))
        checkbox.press("Space")
        expect(run).to_be_disabled()
        role(page, "radio", prediction).press("Space")
    press(page, "运行并验证")
    return role(page, "region", "反事实对照结果")


def snapshot(page, label):
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth"), label
    page.screenshot(path=str(OUT / f"{label}.png"))


def audit(page, scope, label):
    if not (source := os.environ.get("ECOSIM_AXE")):
        return
    if not page.evaluate("Boolean(window.axe)"):
        page.add_script_tag(path=source)
    report = scope.evaluate("""async node => {
      const { violations } = await axe.run(node, {runOnly: {type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"]}});
      return {version: axe.version, violations: violations.map(({id, impact, nodes}) => ({
        id, impact, nodes: nodes.map(node => node.target)
      }))};
    }""")
    (OUT / f"axe-{label}.json").write_text(json.dumps(report, indent=2))
    assert not report["violations"], report


def archive(page, result):
    panel = details(page, "实验卡与结论边界")
    with page.expect_download() as exported:
        press(panel, "导出实验卡")
    saved = json.loads(Path(exported.value.path()).read_text())
    assert saved["origin"] == "browser_rule_engine"
    address = role(panel, "link", "恢复实验卡").get_attribute("href")
    expect(result).to_contain_text("原预测：减少")
    return saved, address


def auction(page):
    begin(page, "double_auction")
    result = execute(page, "减少", multi=True)
    expect(result).to_contain_text("共 3 对，可比较 3 对，未定义 0 对，失败 0 对")
    expect(result).to_contain_text("成交量（件） · 期末累计值")
    expect(result).to_contain_text("置信区间")
    page.reload()
    expect(result).to_contain_text("原预测：减少")
    expect(result).to_contain_text("共 3 对，可比较 3 对")
    role(result, "region", "逐种子差异").scroll_into_view_if_needed()
    snapshot(page, "seed-distribution")
    role(result, "combobox", "查看种子的原曲线与事件").select_option("1963")
    role(result, "combobox", "对照曲线指标").select_option("last_price")
    expect(result).to_contain_text("两图共用纵轴")
    table = details(result, "按经济时点查看两组最近成交价与原事件")
    close = role(table, "rowheader", "收盘").locator("..")
    expect(close.get_by_role("cell").first).not_to_contain_text("未定义")
    buttons = close.get_by_role("button")
    ids = [re.search(r"\d+$", button.inner_text()).group() for button in buttons.all()]
    assert len(ids) == 2 and ids[0] != ids[1], ids
    buttons.first.press("Enter")
    evidence = role(table, "region", "原事件证据")
    expect(evidence).to_contain_text("double-auction/browser-v1/1963/base/96/0")
    expect(evidence).to_contain_text(f"原事件 {ids[0]}")
    expect(buttons.first).to_have_attribute("aria-expanded", "true")
    assert close.evaluate("row => Boolean(row.nextElementSibling?.querySelector('[aria-label=原事件证据]'))")
    audit(page, result, "sources")
    snapshot(page, "seeds-source")
    saved, address = archive(page, result)
    assert saved["plan"]["seeds"] == [1962, 1963, 1964] and saved["plan"]["prediction"] == "down"
    assert sorted([len(row["baseline"]["envelope"]["resultDigest"]["value"]) for row in saved["pairs"]]) == [64] * 3
    assert saved["pairs"][1]["baseline"]["evidence"]["eventId"] == ids[0]
    assert saved["pairs"][1]["comparison"]["evidence"]["eventId"] == ids[1]
    assert [row["delta"] for row in saved["pairs"]] == [row["right"] - row["left"] for row in saved["pairs"]]
    (OUT / "auction-experiment.json").write_text(json.dumps(saved, ensure_ascii=False, indent=2))
    return saved, address


def restore(page, saved, address):
    page.goto(BASE + "/" + address)
    expect(page.get_by_role("heading", level=1)).to_have_text("恢复实验卡")

    def upload(card):
        page.get_by_label("本课实验卡").set_input_files({
            "name": "实验卡.json", "mimeType": "application/json", "buffer": json.dumps(card).encode(),
        })
        press(page, "核对并恢复")

    upload(saved)
    expect(page.get_by_role("status")).to_contain_text("已核对运行、原预测和证据")
    result = role(page, "region", "反事实对照结果")
    expect(result).to_contain_text("原预测：减少")
    changed = deepcopy(saved)
    changed["pairs"][1]["baseline"]["evidence"]["eventId"] = "0"
    upload(changed)
    expect(page.get_by_role("alert")).to_contain_text("原运行、证据或差值不一致")
    expect(result).to_contain_text("共 3 对，可比较 3 对")
    expect(page.get_by_role("status")).to_contain_text("继续显示上一份已核对的实验卡")
    audit(page, page.locator("main"), "archive")
    snapshot(page, "archive-verified")


def boundary(page):
    begin(page, "double_auction", boundary=True)
    result = execute(page, "不变", multi=True)
    expect(result).to_contain_text("共 3 对，可比较 3 对")
    expect(result).to_contain_text("最小 0 · 中位数 0 · 最大 0 件")
    role(result, "combobox", "对照曲线指标").select_option("last_price")
    expect(result).to_contain_text("两组在所选时点均无数值可绘制")
    expect(result.locator("canvas")).to_have_count(0)
    table = details(result, "按经济时点查看两组最近成交价与原事件").get_by_role("table")
    assert all("未定义" in text for text in table.get_by_role("cell").all_text_contents())
    snapshot(page, "no-trade")


def bank(page):
    begin(page, "svb_run")
    result = execute(page, "减少")
    expect(result).to_contain_text("同时改变开局流动性和利率敞口")
    expect(result).to_contain_text("期末银行权益 -120 资金单位")
    role(result, "combobox", "对照曲线指标").select_option("equity")
    expect(result).to_contain_text(re.compile(r"两图共用纵轴 -\d"))
    expect(result.locator("canvas")).to_have_count(2)
    result.locator(".comparison-grid").scroll_into_view_if_needed()
    audit(page, result, "bank")
    snapshot(page, "bank-shared-axis")


def schelling(page):
    page.goto(BASE + "/?lesson=schelling_segregation")
    for action in ("搬到标记的空格", "原址周围和新址周围的住户", "观察个体决策"):
        press(page, action)
    show_pane(page, "主体")
    role(page, "combobox", "选择个体").select_option("A001")
    press(page, "单步前进")
    press(page, "观察群体变化")
    press(page, "查看运行收尾")
    press(page, "试一项政策")
    page.get_by_role("slider").press("End")
    result = execute(page, "增加", multi=True)
    expect(result).to_contain_text("共 3 对，可比较 3 对")
    expect(result.get_by_role("columnheader", name="差值（百分点）")).to_be_visible()
    role(result, "combobox", "查看种子的原曲线与事件").select_option("1972")
    table = details(result, "按经济时点查看两组同组邻接比例与原事件")
    row = role(table, "rowheader", "开局决定后").locator("..")
    row.get_by_role("button").first.press("Enter")
    evidence = role(table, "region", "原事件证据")
    expect(evidence).to_contain_text("schelling_segregation/browser-v1|1972|move|baseline")
    expect(evidence).to_contain_text("A001")
    snapshot(page, "schelling-seed")


def unavailable(page):
    begin(page, "double_auction")
    block = "**/paired-inputs-*.js"
    page.route(block, lambda route: route.abort())
    result = execute(page, "减少", multi=True)
    expect(result).to_contain_text("共 3 对，可比较 1 对，未定义 0 对，失败 2 对")
    expect(result).to_contain_text("原预测：减少。实际：部分可比较")
    panel = details(result, "实验卡与结论边界")
    expect(role(panel, "button", "导出实验卡")).to_be_disabled()
    page.unroute(block)
    role(result, "link", "重新载入本课").press("Enter")
    expect(result).to_contain_text("共 3 对，可比较 3 对")
    expect(result).to_contain_text("原预测：减少")


def student(browser, errors):
    context = browser.new_context(**OPTIONS)

    def local_only(route):
        request = route.request
        if request.method == "GET" and request.url.startswith(BASE + "/") and "/api/" not in request.url:
            route.continue_()
        else:
            errors.append(request.url)
            route.abort()

    context.route("**/*", local_only)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    return context, page


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        engine = getattr(playwright, ENGINE)
        errors = []
        with engine.launch(**({"channel": "chrome"} if ENGINE == "chromium" else {})) as browser:
            first, page = student(browser, errors)
            card, address = auction(page)
            first.close()
            for step in (lambda page: restore(page, card, address), boundary, bank, schelling, unavailable):
                profile, page = student(browser, errors)
                try:
                    step(page)
                finally:
                    profile.close()
        assert not errors, errors
    print(f"{ENGINE} {WIDTH}px: three real seed pairs, separate source ticks, archived recovery, zero trades, SVB negative equity, Schelling percentage points and failed-seed recovery")
