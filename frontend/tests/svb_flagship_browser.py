"""Walk the flagship from a fresh student profile and restore its work in another profile."""
import json
from pathlib import Path
import re
import sys

from playwright.sync_api import expect, sync_playwright


BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8899/explore"
ENGINE = sys.argv[2] if len(sys.argv) > 2 else "chromium"
WIDTH = int(sys.argv[3]) if len(sys.argv) > 3 else 390
OUT = Path("output/playwright/v2-05") / f"{ENGINE}-{WIDTH}"
OUT.mkdir(parents=True, exist_ok=True)
ROLE = "青湾银行独立迁移"


def named(scope, role, name):
    return scope.get_by_role(role, name=name, exact=isinstance(name, str))


def hit(scope, label):
    named(scope, "button", label).press("Enter")


def metric(scope, label, values):
    expect(scope.get_by_role("row").filter(has_text=label).get_by_role("cell")).to_have_text(values)


def open_details(scope, label):
    summary = scope.locator("summary").filter(has_text=label)
    if not summary.locator("..").evaluate("(el) => el.open"):
        summary.press("Enter")


def tab(page, label):
    entry = named(page, "tab", label)
    if entry.count():
        entry.press("Enter")


def snapshot(page, name):
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth"), name
    page.screenshot(path=str(OUT / f"{name}.png"))


def entry(page):
    page.goto(f"{BASE}/?lesson=svb_run")
    open_details(page, "查看历史来源")
    for date in ("2023-03-08", "2023-03-09", "2023-03-10", "2023-03-12"):
        expect(named(page, "link", f"查阅 {date} 史料")).to_have_attribute("href", re.compile(r"^https://www\.federalreserve\.gov/"))
    expect(page.get_by_text("历史美元", exact=False)).to_be_visible()
    expect(page.get_by_text("储户、金额和轮次来自教学模型", exact=False)).to_be_visible()
    snapshot(page, "historical-boundary")
    hit(page, "第一轮提交")
    hit(page, "提交申请时")
    hit(page, "观察个体决策")
    tab(page, "主体")
    actors = named(page, "combobox", "选择个体")
    expect(actors.locator("option")).to_have_count(61)
    actors.select_option("D60")
    open_details(page, "D60 观察的三名储户")
    expect(named(page, "button", "选择 D01")).to_be_visible()
    expect(page.get_by_text("本轮尚未收到申请消息", exact=False)).to_have_count(3)
    actors.select_option("D01")
    hit(page, "单步前进")
    expect(named(page, "region", "核对入场预测")).to_contain_text("D01 在第 1 轮提出申请")
    expect(named(page, "complementary", "个体决策透视")).to_contain_text("D01 到账 19")
    hit(page, "观察群体变化")
    hit(page, "播放")
    expect(page.locator(".turning-point")).to_contain_text("待付 107")
    expect(named(page, "button", "暂停")).to_be_disabled()


def bridge(page):
    tab(page, "系统结果")
    macro = named(page, "region", "宏观指标曲线")
    expect(macro).to_contain_text("155 资金单位")
    hit(macro, "追踪累计出售证券")
    expect(named(macro, "heading", "累计出售证券")).to_be_visible()
    open_details(page, "位贡献个体及事件")
    page.get_by_role("button").filter(has_text="2/13 · 以 6 急售 25").press("Enter")
    lens = named(page, "region", "微观与宏观的证据追踪")
    expect(named(lens, "region", "宏观结果")).to_contain_text("25 − 0 = +25 证券单位")
    expect(named(lens, "combobox", "当前轮次的原事件")).to_have_value("2/13")

    tab(page, "主体")
    named(page, "combobox", "选择个体").select_option("D02")
    open_details(page, "D02 观察的三名储户")
    expect(page.get_by_text("风险分", exact=False).first).to_be_visible()
    hit(page, "回查 D01 首次申请 1/2")
    event = named(lens, "combobox", "当前轮次的原事件")
    expect(event).to_have_value("1/2")
    expect(named(lens, "region", "宏观结果")).to_contain_text("19 − 0 = +19 资金单位")
    event.select_option("1/4")
    expect(lens.get_by_text("按原入队申请结算", exact=False)).to_be_visible()
    open_details(page, "核对本轮银行账表")
    page.get_by_role("button").filter(has_text="1/1 · 证券标价").press("Enter")
    expect(named(lens, "region", "宏观结果")).to_contain_text("230 − 400 = -170 资金单位")
    hit(page, "单步前进")
    hit(page, "单步前进")
    open_details(page, "第 3 轮怎样形成待付与账表变化")
    expect(page.get_by_text("轮末借款负债 140", exact=False)).to_be_visible()
    open_details(page, "核对本轮银行账表")
    page.get_by_role("button").filter(has_text="3/35 · 支持机构借出 140").press("Enter")
    expect(named(lens, "region", "宏观结果")).to_contain_text("140 − 0 = +140 资金单位")
    expect(event).to_have_value("3/35")
    expect(event.locator("option").filter(has_text="4/")).to_have_count(0)
    lens.screenshot(path=str(OUT / "settlement-evidence.png"))
    snapshot(page, "trace")
    hit(page, "试一项政策")


def save(page, treatment, fields):
    form = named(page, "region", "用两次运行解释机制")
    with page.expect_download() as downloaded:
        hit(form, "导出两次运行")
    work = json.loads(Path(downloaded.value.path()).read_text())
    assert work["runEnvelopes"][0]["inputs"]["scenario"] == "baseline"
    change = work["runEnvelopes"][1]
    assert change["inputs"]["scenario"] == treatment and change["seed"] == 20230309
    assert work["choices"] == ["withdraw_now", "at-request"]
    assert len(change["inputs"]["network"]) == 60
    assert change["clock"] == work["runEnvelopes"][0]["clock"]
    def relevant(item):
        return item["kind"] == "revaluation" if treatment == "liquidity_buffer" else (
            item["kind"] == "request" and item["actorIds"] == ["D02"])
    for label, events in zip(("无干预证据", "政策组证据"), work["eventEnvelopes"], strict=True):
        form.get_by_label(label).select_option(next(item["eventId"] for item in events if relevant(item)))
    for key, value in fields.items():
        form.locator(f"[name={key}]").fill(value)
    hit(form, "保存解释")
    expect(named(form, "link", "在实验笔记打开已保存的解释")).to_be_visible()
    return work


def experiments(page):
    region = named(page, "region", "制度对照的账表与共同条件")
    page.get_by_role("slider").press("End")
    expect(named(page, "button", "运行并验证")).to_be_disabled()
    named(page, "radio", "减少").check()
    hit(page, "运行并验证")
    expect(region).to_contain_text("初始现金 100 → 500")
    expect(region).to_contain_text("持有证券 170 → 130")
    metric(region, "待付金额", ["257", "97", "-160"])
    metric(region, "净资产", ["-280", "-120", "+160"])
    cash = save(page, "liquidity_buffer", {
        "rule": "重估改变证券市值。共同冲击时，现金不变，净资产随证券市值变化。",
        "calculation": "同样每单位跌 1，基线持有 170 单位、现金组持有 130 单位，所以分别减记 170 和 130。",
        "difference": "换持现金后实付增 160，期末待付降 160。持有的证券减少也降低了重估敞口。",
        "hypothesis": "实际银行需要核实证券可变现速度和融资额度。",
    })
    expect(named(page, "region", ROLE)).to_have_count(0)
    hit(page, "再做一组对照")
    named(page, "radio", "分散信息来源").check()
    expect(page.get_by_role("slider")).to_have_count(0)
    expect(named(page, "button", "运行并验证")).to_be_disabled()
    named(page, "radio", "减少").check()
    hit(page, "运行并验证")
    expect(region).to_contain_text("总边数仍为 180")
    expect(region).to_contain_text("两组的初始现金、证券和贷款相同")
    metric(region, "累计申请", ["1517", "1477", "-40"])
    metric(region, "累计实付", ["1260", "1260", "0"])
    metric(region, "待付金额", ["257", "217", "-40"])
    metric(region, "净资产", ["-280", "-280", "0"])
    network = save(page, "network", {
        "rule": "每名储户只观察三名邻居；上一轮待付与急售信号也进入评分。",
        "calculation": "分散组 1477 − 1260 = 217 待付。",
        "difference": "只改信息关系，D02 首次申请从第 2 轮推迟到第 4 轮；全体累计少申请 40，实付不变。",
        "hypothesis": "需核实真实储户的消息来源和实际提款阈值。",
    })
    assert cash["runEnvelopes"][0]["resultDigest"] == network["runEnvelopes"][0]["resultDigest"]
    assert network["runEnvelopes"][0]["inputs"]["network"] != network["runEnvelopes"][1]["inputs"]["network"]
    region.screenshot(path=str(OUT / "network-comparison.png"))
    snapshot(page, "comparison")
    return network["runEnvelopes"][1]["runId"]


def transfer(page):
    task = named(page, "region", ROLE)
    expect(task.get_by_text("初始净资产 =", exact=False)).to_have_count(0)
    named(task, "radio", "净资产为正，今日最多能支付 10，至少留下 8 待付。").check()
    hit(task, "提交迁移作答")
    expect(task.get_by_text("独立作答 · 正确", exact=False)).to_be_visible()
    expect(task.get_by_text("初始净资产 =", exact=False)).to_be_visible()
    named(task, "radio", "现金只有 10，低于申请 18，所以净资产一定为负。").check()
    hit(task, "提交迁移作答")
    expect(task.get_by_text("重复作答 · 需要复核", exact=False)).to_be_visible()
    page.reload()
    expect(task.get_by_text("独立作答 · 正确", exact=False)).to_be_visible()
    expect(task.get_by_text("重复作答 · 需要复核", exact=False)).to_be_visible()


def notes(page, network_id, export):
    notes_page = named(page, "heading", "实验笔记")
    expect(notes_page).to_be_visible()
    note = page.locator(".note-list > li").filter(has_text="分散信息来源")
    named(note, "link", "打开已保存的解释").press("Enter")
    expect(page.get_by_text("分散组 1477 − 1260 = 217 待付。", exact=True)).to_be_visible()
    named(page, "link", "查看基线原事件 2/1").press("Enter")
    expect(page.get_by_text("已核对保存的版本与运行摘要")).to_be_visible()
    metric(page.get_by_role("table"), "累计申请（", ["32", "72"])
    metric(page.get_by_role("table"), "累计实付（", ["32", "32"])
    named(page, "link", "返回已保存的解释").press("Enter")
    named(page, "link", re.compile("^查看政策组原事件")).press("Enter")
    expect(page.get_by_text(network_id, exact=True)).to_be_visible()
    expect(page.get_by_role("heading", level=1)).to_have_text("政策组原事件 · 第 4 轮 · 4/1")
    named(page, "link", "实验笔记").press("Enter")
    expect(named(page, "region", ROLE).get_by_text("独立作答 · 正确", exact=False)).to_be_visible()
    snapshot(page, "notes")
    if export:
        open_details(page, "备份与导入四阶学习")
        with page.expect_download() as downloaded:
            hit(page, "导出四阶学习备份")
        target = OUT / "student-backup.json"
        downloaded.value.save_as(target)
        backup = json.loads(target.read_text())
        assert len(backup["svbTransfer"]) == 2 and len(backup["entries"]) == 3
        return target


def student(browser, errors):
    context = browser.new_context(viewport={"width": WIDTH, "height": 880}, accept_downloads=True,
                                  reduced_motion="reduce")

    def guard(route):
        if route.request.method == "GET" and route.request.url.startswith(BASE + "/") and "/api/" not in route.request.url:
            route.continue_()
        else:
            errors.append(route.request.url)
            route.abort()

    context.route("**/*", guard)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    return context, page


if __name__ == "__main__":
    with sync_playwright() as playwright:
        engine = getattr(playwright, ENGINE)
        browser = engine.launch(**({"channel": "chrome"} if ENGINE == "chromium" else {}))
        errors = []
        original, page = student(browser, errors)
        entry(page)
        bridge(page)
        network_id = experiments(page)
        transfer(page)
        named(page, "link", "实验笔记").press("Enter")
        backup = notes(page, network_id, export=True)
        original.close()
        restored, page = student(browser, errors)
        page.goto(f"{BASE}/?view=notes")
        open_details(page, "备份与导入四阶学习")
        page.get_by_label("四阶学习备份", exact=True).set_input_files(backup)
        hit(page, "导入四阶学习备份")
        expect(page.get_by_text("青湾银行新增 2 次作答", exact=False)).to_be_visible()
        notes(page, network_id, export=False)
        page.goto(f"{BASE}/?lesson=svb_run")
        expect(named(page, "region", ROLE)).to_contain_text("独立作答 · 正确")
        expect(named(page, "region", "制度对照的账表与共同条件")).to_contain_text("分散信息来源的配对证据")
        restored.close()
        browser.close()
        assert not errors, errors
        print(f"{ENGINE} {WIDTH}px: SVB history, 60 actors, exact event links, both comparisons, independent and repeated attempts, offline backup and restore")
