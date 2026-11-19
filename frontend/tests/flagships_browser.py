"""Keyboard, chart and archive acceptance for each V2-06 flagship using local assets."""
import json
import os
from pathlib import Path
import re
import sys

from playwright.sync_api import expect, sync_playwright

from chart_probe import click_turning_point
from workbench_probe import run_bar, show_pane


BASE, COURSE, ENGINE, WIDTH = sys.argv[1:5]
BASE = BASE.rstrip("/")
WIDTH = int(WIDTH)
OUT = Path("output/playwright/v2-06") / f"{COURSE}-{ENGINE}-{WIDTH}"
OUT.mkdir(parents=True, exist_ok=True)


def get(scope, role, label):
    return scope.get_by_role(role, name=label, exact=isinstance(label, str))


def hit(scope, label):
    get(scope, "button", label).press("Enter")


def expand(scope, label):
    summary = scope.locator("summary").filter(has_text=label)
    if not summary.locator("..").evaluate("details => details.open"):
        summary.press("Enter")
    return summary.locator("..")


def snapshot(page, name):
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth"), name
    page.screenshot(path=str(OUT / f"{name}.png"))


def rows(table, label, expected):
    row = get(table, "rowheader", label).locator("..")
    expect(row.get_by_role("cell")).to_have_text(expected)


def audit(page, name):
    if not (script := os.environ.get("ECOSIM_AXE")):
        return
    if not page.evaluate("Boolean(window.axe)"):
        page.add_script_tag(path=script)
    report = page.evaluate("""async () => {
      const { violations, incomplete } = await axe.run(document.querySelector('main'), {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] }
      });
      const summarize = rows => rows.map(({id, impact, nodes}) => ({
        id, impact, nodes: nodes.map(({target, failureSummary}) => ({target, failureSummary}))
      }));
      return { version: axe.version, violations: summarize(violations), incomplete: summarize(incomplete) };
    }""")
    if report["incomplete"]:
        assert all(issue["id"] == "color-contrast" for issue in report["incomplete"]), report["incomplete"]
        selectors = [node["target"][0] for issue in report["incomplete"] for node in issue["nodes"]]
        report["svg_contrast"] = page.evaluate("""selectors => {
          const luminance = color => {
            const [r, g, b] = color.match(/[\\d.]+/g).slice(0, 3).map(channel => {
              const value = Number(channel) / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          return selectors.map(selector => {
            const label = document.querySelector(selector);
            const background = label?.closest(".actor-node")?.querySelector(".actor-fill");
            if (!label || label.tagName !== "text" || !background) throw new Error("Unreviewed contrast: " + selector);
            const colors = [getComputedStyle(label).fill, getComputedStyle(background).fill].map(luminance);
            return { selector, ratio: (Math.max(...colors) + 0.05) / (Math.min(...colors) + 0.05) };
          });
        }""", selectors)
        assert all(entry["ratio"] >= 4.5 for entry in report["svg_contrast"]), report["svg_contrast"]
    (OUT / f"axe-{name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    assert not report["violations"], report["violations"]


def save(page, fields, events):
    form = get(page, "region", "用两次运行解释机制")
    for label, event in zip(("无干预证据", "政策组证据"), events, strict=True):
        form.get_by_label(label).select_option(event)
    for name, response in fields.items():
        form.locator(f"[name={name}]").fill(response)
    hit(form, "保存解释")
    expect(get(form, "link", "在实验笔记打开已保存的解释")).to_be_visible()


def comparison(page, prediction, alternative=None):
    if alternative:
        get(page, "radio", alternative).press("Space")
        expect(page.get_by_role("slider")).to_have_count(0)
    else:
        page.get_by_role("slider").press("End")
    expect(get(page, "button", "运行并验证")).to_be_disabled()
    get(page, "radio", prediction).press("Space")
    hit(page, "运行并验证")
    expect(get(page, "region", "反事实对照结果")).to_be_visible()
    with page.expect_download() as download:
        hit(page, "导出两次运行")
    return json.loads(Path(download.value.path()).read_text())


def transfer(page, label, option):
    task = get(page, "region", label)
    expect(task.locator("ol")).to_have_count(0)
    get(task, "radio", option).press("Space")
    hit(task, "提交迁移作答")
    expect(task.get_by_text("独立作答 · 正确", exact=False)).to_be_visible()
    page.reload()
    expect(task.get_by_text("独立作答 · 正确", exact=False)).to_be_visible()


def verify_notes(page, task, event, run_id):
    page.goto(f"{BASE}/?view=notes")
    expect(get(page, "region", task).get_by_text("独立作答 · 正确", exact=False)).to_be_visible()
    get(page, "link", "打开已保存的解释").press("Enter")
    get(page, "link", f"查看政策组原事件 {event}").press("Enter")
    expect(page.get_by_text(run_id, exact=True)).to_be_visible()
    expect(page.get_by_text("已核对保存的版本与运行摘要")).to_be_visible()
    snapshot(page, "original-event")


def start_schelling(page, action, fresh=False):
    page.goto(f"{BASE}/?lesson=schelling_segregation" + ("&fresh=1" if fresh else ""))
    expect(page.get_by_text("340 名居民是合成角色", exact=False)).to_be_visible()
    hit(page, action)
    hit(page, "原址周围和新址周围的住户")
    hit(page, "观察个体决策")
    show_pane(page, "主体")
    get(page, "combobox", "选择个体").select_option("A001")
    expect(get(page, "region", "住户阈值与候选空格")).to_contain_text("最低阈值 30%")
    hit(page, "单步前进")
    hit(page, "观察群体变化")
    hit(page, "前往下一关键事件")
    expect(run_bar(page)).to_contain_text("事件")


def schelling(page):
    start_schelling(page, "搬到标记的空格")
    show_pane(page, "经济世界")
    board = get(page, "region", "微观个体画布")
    expect(board.locator("[data-affected]")).to_have_count(14)
    expect(board.locator("[data-site=origin]")).to_have_attribute("stroke-dasharray", "3 2")
    expect(board.locator("[data-site=destination]")).not_to_have_attribute("stroke-dasharray", "3 2")
    mover = board.locator("[data-mover]")
    after = mover.evaluate("node => node.style.transform")
    previous = get(board, "button", "搬迁前的网格")
    previous.press("Space")
    expect(previous).to_be_focused()
    expect(previous).to_have_attribute("aria-pressed", "true")
    assert mover.evaluate("node => node.style.transform") != after
    board.screenshot(path=str(OUT / "board-before.png"))
    hit(board, "搬迁后的网格")
    assert mover.evaluate("node => node.style.transform") == after
    board.screenshot(path=str(OUT / "board-after.png"))
    mover.click()
    show_pane(page, "主体")
    resident = get(page, "region", "住户阈值与候选空格")
    expect(resident).to_contain_text("搬迁前在第 11 行第 9 列")
    expect(resident).to_contain_text("实际迁入第 10 行第 16 列")
    summary = get(page, "region", "这次搬迁和全局变化")
    expect(summary).to_contain_text("50.33% → 50.14%")
    expand(summary, "查看受影响的邻居")
    expect(summary.get_by_role("table").get_by_role("rowheader")).to_have_count(14)
    audit(page, "resident")
    snapshot(page, "movement")
    get(page, "combobox", "追踪指标").select_option("satisfied")
    show_pane(page, "系统结果")
    macro = get(page, "region", "宏观指标曲线")
    expect(get(macro, "heading", "达到当前阈值的居民")).to_be_visible()
    hit(page, "后退一步")
    click_turning_point(macro.locator("canvas").first)
    scope = get(page, "region", "微观与宏观的证据追踪")
    expect(scope).to_contain_text("79.71 − 80 = -0.29 个百分点")
    get(page, "combobox", "追踪指标").select_option("similarity")
    hit(page, "后退一步")
    click_turning_point(macro.locator("canvas").first)
    expect(scope).to_contain_text("529/1051 → 527/1051")
    table = expand(page, "从指标数值反查事件")
    hit(table, "定位事件 1")
    expect(scope.get_by_role("status")).to_contain_text("事件 1")
    expand(page, "从区间反查搬迁")
    page.get_by_role("spinbutton", name="终点事件").fill("0")
    expect(page.get_by_text("这个区间没有搬迁记录。", exact=True)).to_be_visible()
    hit(page, "查看运行收尾")
    get(page, "combobox", "追踪指标").select_option("satisfied")
    hit(table, "定位事件 3")
    expect(get(page, "region", "这次搬迁和全局变化")).to_contain_text("这次全图达标比例相同")
    expect(scope.get_by_role("region", name="微观主体").get_by_text(
        re.compile(r"^[AB][0-9]{3} · 前一事件帧"))).to_be_visible()
    hit(page, "试一项政策")
    pair = comparison(page, "增加")
    assert [entry["inputs"]["intervention"]["threshold"] for entry in pair["runEnvelopes"]] == [30, 50]
    panel = get(page, "region", "阈值配对与停止条件")
    rows(panel, "同组邻接比例（%）", ["84.55", "92.71"])
    rows(panel, "达到当前阈值的居民（%）", ["100", "100"])
    expect(panel).to_contain_text("达标比例同为 100%")
    comparison_id = pair["runEnvelopes"][1]["runId"]
    save(page, {"rule": "原址和新址的已占邻居随搬迁改变。", "calculation": "事件 1 的同组邻接对 529/1051 → 527/1051。",
                "difference": "将阈值由 30% 提到 50%，期末同组邻接率 84.55% → 92.71%。",
                "hypothesis": "现实比较须另查居民的可选住宅和迁居限制。"}, ["1", "1"])
    transfer(page, "校园社团独立迁移", "比较拥有相同活动时间选择机会的同学的报名信息")
    audit(page, "pair")
    snapshot(page, "pair")
    verify_notes(page, "校园社团独立迁移", "1", comparison_id)
    start_schelling(page, "留在原地", fresh=True)
    hit(page, "查看运行收尾")
    hit(page, "试一项政策")
    comparison(page, "减少", "最低比例 0%")
    expect(panel).to_contain_text("本次没有搬迁")
    rows(panel, "累计搬迁（次）", ["99", "0"])
    hit(page, "再做一组对照")
    comparison(page, "减少", "最低比例 100%")
    expect(panel).to_contain_text("最后一轮没有可行搬迁，仍有 331 户未达阈值")
    rows(panel, "累计搬迁（次）", ["99", "2"])
    panel.screenshot(path=str(OUT / "blocked.png"))
    return "校园社团独立迁移"


def start_auction(page, bid, variant=""):
    page.goto(f"{BASE}/?lesson=double_auction{variant}")
    expand(page, "查看案例资料与模型假设")
    expect(get(page, "link", "Vernon L. Smith · Journal of Political Economy, 1962")).to_be_visible()
    expect(page.get_by_text("规则报价和浏览器生成的撮合记录", exact=False)).to_be_visible()
    page.get_by_label("开局限价（代币）").fill(str(bid))
    for label in ("确认限价", "不会成交", "观察个体决策"):
        hit(page, label)
    show_pane(page, "主体")
    get(page, "combobox", "选择个体").select_option("B01")
    hit(page, "单步前进")
    hit(page, "观察群体变化")
    hit(page, "播放")


def auction(page):
    start_auction(page, 96)
    expect(run_bar(page)).to_contain_text("事件 4 · 已暂停")
    show_pane(page, "系统结果")
    macro = get(page, "region", "宏观指标曲线")
    hit(page, "后退一步")
    click_turning_point(macro.locator("canvas").first)
    lens = get(page, "region", "微观与宏观的证据追踪")
    expect(lens).to_contain_text("O001 · B01 报价 96")
    expect(lens).to_contain_text("O003 · S02 报价 78")
    expect(page.get_by_text("买方价值 108", exact=False)).to_have_count(0)
    hit(lens, "定位事件 3 · S02")
    expect(run_bar(page)).to_contain_text("事件 3")
    board = expand(page, "查看当前订单簿")
    rows(get(board, "table", "买单，高价优先"), "查看挂单 O001 原报价", ["B01", "96", "1"])
    rows(get(board, "table", "卖单，低价优先"), "查看挂单 O003 原报价", ["S02", "78", "1"])
    expect(page.get_by_text("这一步的买卖限价已交叉", exact=False)).to_be_visible()
    audit(page, "book")
    snapshot(page, "book")
    hit(page, "快进到收盘")
    table = expand(page, "从指标数值反查事件")
    hit(table, "定位事件 23")
    expect(board).to_contain_text("O002 · B08")
    expect(board).to_contain_text("剩余委托已撤回")
    hit(board, "查看被撤委托 O002")
    expect(run_bar(page)).to_contain_text("事件 2")
    hit(page, "试一项政策")
    fee = comparison(page, "减少")
    assert [entry["inputs"]["fee"] for entry in fee["runEnvelopes"]] == [0, 6]
    economics = get(page, "region", "成交、费用与效率")
    table = get(economics, "table", "收盘核算，价和剩余以代币计")
    rows(table, "总剩余", ["180", "137"])
    rows(table, "平台收入", ["0", "48"])
    rows(table, "配置效率", ["61.9%", "47.1%"])
    trace = expand(economics, "核算干预逐笔成交剩余")
    expect(trace.get_by_text("买方价值 108", exact=False).first).to_be_visible()
    expect(trace.get_by_text("6 + 17 + 12 = 35", exact=False)).to_be_visible()
    save(page, {"rule": "在簿委托 O001 给出首笔成交价。", "calculation": "收费组首笔 6 + 17 + 12 = 35。",
                "difference": "首笔价格同为 96，最终成交由 6 件降到 4 件，总剩余由 180 降至 137。",
                "hypothesis": "新市场须核对收费是否还伴随真实资源耗用。"}, ["4", "4"])
    transfer(page, "旧书交易独立迁移", "无共同可接受价格")
    audit(page, "settlement")
    expand(economics, "核算干预逐笔成交剩余")
    economics.screenshot(path=str(OUT / "fee.png"))
    verify_notes(page, "旧书交易独立迁移", "4", fee["runEnvelopes"][1]["runId"])
    page.goto(f"{BASE}/?lesson=double_auction")
    hit(page, "再做一组对照")
    demand = comparison(page, "增加", "买方估值上升")
    assert [entry["inputs"]["demand_shift"] for entry in demand["runEnvelopes"]] == [0, 12]
    rows(table, "可实现剩余上界", ["291", "439"])
    rows(table, "总剩余", ["180", "272"])
    expect(economics).to_contain_text("两组效率各用自己的分母")
    start_auction(page, 35, "&market=no-overlap")
    expect(page.locator(".turning-point")).to_contain_text("两边都挂单但没有成交")
    hit(page, "快进到收盘")
    expect(page.get_by_text("收盘统计 · 成交量 0，成交价未定义，可实现剩余上界为 0，效率未定义。")).to_be_visible()
    hit(page, "试一项政策")
    comparison(page, "不变")
    rows(table, "配置效率", ["未定义", "未定义"])
    snapshot(page, "no-overlap")
    return "旧书交易独立迁移"


def student(browser, errors):
    context = browser.new_context(viewport={"width": WIDTH, "height": 900}, accept_downloads=True, reduced_motion="reduce")
    def route(request):
        if request.request.method == "GET" and request.request.url.startswith(BASE + "/") and "/api/" not in request.request.url:
            request.continue_()
        else:
            errors.append(request.request.url)
            request.abort()
    context.route("**/*", route)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    return context, page


def archive(page):
    page.goto(f"{BASE}/?view=notes")
    expand(page, "备份与导入四阶学习")
    with page.expect_download() as download:
        hit(page, "导出四阶学习备份")
    target = OUT / "student-backup.json"
    download.value.save_as(target)
    data = json.loads(target.read_text())
    assert len(data["flagshipTransfers"]) == 1 and data["flagshipTransfers"][0]["evidence_class"] == "independent"
    return target


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = getattr(playwright, ENGINE).launch(**({"channel": "chrome"} if ENGINE == "chromium" else {}))
        errors = []
        context, page = student(browser, errors)
        task = {"schelling": schelling, "auction": auction}[COURSE](page)
        file = archive(page)
        context.close()
        restored, page = student(browser, errors)
        page.goto(f"{BASE}/?view=notes")
        expand(page, "备份与导入四阶学习")
        page.get_by_label("四阶学习备份", exact=True).set_input_files(file)
        hit(page, "导入四阶学习备份")
        expect(get(page, "region", task)).to_contain_text("独立作答 · 正确")
        expect(get(page, "link", "打开已保存的解释")).to_have_count(1)
        restored.close()
        browser.close()
        assert not errors, errors
        print(f"{COURSE} {ENGINE} {WIDTH}px: full local lesson, real evidence, edge cases, keyboard, transfer and blank-profile restore")
