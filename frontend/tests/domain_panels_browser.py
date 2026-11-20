"""Follow each domain panel's original evidence, then submit the authored transfer offline."""
from pathlib import Path
import json
import re
import sys
from urllib.parse import urljoin

from playwright.sync_api import expect, sync_playwright

import progressive_pedagogy_browser as learning
import remaining_browser as remaining
from workbench_probe import run_bar, show_pane

BASE, ENGINE, WIDTH = learning.BASE, learning.ENGINE, learning.WIDTH
OUT = Path("output/playwright/v2-domain-panels") / f"{ENGINE}-{WIDTH}"
F = learning.find
hit = learning.hit
cases = {
    "public_goods": ("公共池与小组账本", "pg-kitchen", [-2]),
    "commons_governance": ("资源与管护账本", "commons-aquifer", "按本地补给季节改写增长项，继续按取用余额记账"),
    "carbon_market": ("减排与配额登记簿", "carbon-proportional", "有效总量是否随产量变动"),
    "beer_game": ("订单与实物在途", "beer-delivery", "实物盘点保持原库存，同时在未到货订单账上记录"),
    "gamestop": ("消息、订单与借券账", "gme-booking", "以付款记录与订单 ID 关联"),
    "flash_crash": ("库存冲击与深度阶梯", "flash-venues", "用同步时钟和实际路由匹配事件"),
}


def seek(page, panel, label, tick, *, moves=True):
    if isinstance(label, str):
        hit(panel, label)
    else:
        panel.get_by_role("button", name=label).press("Enter")
    expect(run_bar(page)).to_contain_text(f"事件 {tick} · 已暂停")
    if moves:
        expect(run_bar(page).locator("p")).to_be_focused()


def world(page, case_id):
    show_pane(page, "经济世界")
    panel = F(page, "region", cases[case_id][0])
    expect(panel).to_be_visible()
    return panel


def public_goods(page, panel):
    expect(panel).to_contain_text("四笔贡献合计 29 代币，每人公共回报 11.6")
    expect(panel).to_contain_text("97.4 净收益")
    hit(panel, "P3")
    expect(panel).to_contain_text("P3 的本轮账本")
    seek(page, panel, "回看贡献公开", 1)
    expect(panel).to_contain_text("施罚、受罚和净收益要等本轮结算")
    expect(panel).not_to_contain_text("97.4 净收益")
    hit(page, "单步前进")
    panel.get_by_text("从群体净收益反查结算", exact=True).press("Enter")
    seek(page, panel, re.compile(r"第 1 轮 · 全组净收益 97.4"), 2, moves=False)
    hit(page, "单步前进")
    hit(page, "单步前进")
    hit(panel, "P3")
    panel.get_by_text("看投入怎样反馈到下一轮", exact=True).press("Enter")
    seek(page, panel, "查上轮结算 · 事件 2", 2)
    expect(panel).to_contain_text("P3 的本轮账本")


def commons(page, panel):
    expect(panel).to_contain_text("实际取用 74 单位")
    expect(panel).to_contain_text("本期再生仍待结算")
    expect(panel).not_to_contain_text("138.55")
    hit(page, "单步前进")
    expect(panel).to_contain_text("取用后余量 106 + 再生")
    F(panel, "combobox", "查看使用者").select_option("F02")
    seek(page, panel, "回看取用", 1)
    expect(F(panel, "combobox", "查看使用者")).to_have_value("F02")
    hit(page, "单步前进")
    seek(page, panel, "回查本期再生 · 事件 2", 2, moves=False)


def carbon(page, panel):
    expect(panel.get_by_text("88 张", exact=True)).to_be_visible()
    expect(panel.get_by_role("button", name=re.compile("看首次转移"))).to_have_count(0)
    hit(page, "单步前进")
    seek(page, panel, "看首次转移 · 事件 2", 2, moves=False)
    expect(panel).to_contain_text("涉及编号 A0009、A0010、A0011、A0012")
    panel.get_by_text("追踪一张初始配额", exact=True).press("Enter")
    F(panel, "combobox", "选择配额编号").select_option("A0009")
    seek(page, panel, "回查配额发行 · 事件 0", 0)
    expect(panel).not_to_contain_text("涉及编号 A0009、A0010")
    hit(page, "查看运行收尾")
    seek(page, panel, "看首次缴回 · 事件 9", 9)
    expect(panel).to_contain_text("F01 缴回 4 张")


def beer(page, panel):
    expect(panel).to_contain_text("第 5 周")
    expect(F(panel, "button", "定位第 6 周批发收到订单")).to_have_count(0)
    hit(page, "单步前进")
    seek(page, panel, "定位第 6 周批发收到订单", 6, moves=False)
    ledger = F(panel, "region", "批发商 的周账本")
    expect(ledger).to_contain_text("本周需求8")
    expect(panel).to_contain_text("分销商 到 批发商，实际到货 4 件")
    seek(page, panel, "回查第 4 周发货 · 事件 4", 4)
    expect(ledger).to_contain_text("第 4 周")


def gamestop(page, panel):
    expect(run_bar(page)).to_contain_text("事件 117 · 已暂停")
    expect(panel).to_contain_text("17.80 美元估值 10 股")
    for _ in range(4):
        hit(page, "单步前进")
    seek(page, panel, "定位实际还券", 121, moves=False)
    expect(panel).to_contain_text("交还 2 股，义务剩余 8 股")
    F(panel, "combobox", "查看话题").select_option("N1")
    seek(page, panel, "关注投资者 5 · 第 1 轮", 34)
    expect(panel).to_contain_text("收到 N1，来源为事件 33")
    seek(page, panel, "回查原话题 · 事件 33", 33)
    expect(F(panel, "button", "关注投资者 5 · 第 1 轮")).to_have_count(0)


def flash(page, panel):
    expect(run_bar(page)).to_contain_text("事件 149 · 已暂停")
    expect(panel).to_contain_text("净增 18 股，阈值 12 股")
    expect(F(panel, "group", "可见的买卖档位").get_by_role("table")).to_be_visible()
    expect(panel.get_by_role("button", name=re.compile(r"^O3 ·"))).to_have_count(0)
    hit(page, "单步前进")
    expect(panel).to_contain_text("261 → 243 股")
    expect(panel).to_contain_text("本笔撤单18 股")
    seek(page, panel, re.compile(r"^O3 · 买 9.78 美元 · 事件 3$"), 3)
    expect(panel).to_contain_text("提交买单 18 股")
    expect(F(panel, "button", "定位库存事件")).to_have_count(0)


def inspect(page, case_id, *, micro=False):
    panel = world(page, case_id)
    if micro:
        return
    path = {"public_goods": public_goods, "commons_governance": commons, "carbon_market": carbon,
            "beer_game": beer, "gamestop": gamestop, "flash_crash": flash}
    path[case_id](page, panel)
    learning.audit(page, panel, case_id)
    expect(page.locator("main")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), case_id
    panel.scroll_into_view_if_needed()
    page.screenshot(path=OUT / f"{case_id}-evidence.png")


def transfer(page, case_id, work):
    label, item_id, answer = cases[case_id]
    pair = F(page, "region", "两组运行的领域对照")
    expect(F(pair, "region", "同一供应链环节对照" if case_id == "beer_game" else label)).to_be_visible()
    policy = work["runEnvelopes"]
    assert policy[0]["seed"] == policy[1]["seed"]
    assert policy[0]["inputs"]["choices"] == policy[1]["inputs"]["choices"]
    assert policy[0]["inputs"]["policy"] != policy[1]["inputs"]["policy"]
    assert all(side["origin"] == "browser_rule_engine" for side in policy)
    journey = F(page, "region", "独立练习与学习证据")
    expect(journey).to_be_visible()
    F(journey, "radio", "迁移到新情境").check()
    assessment = F(journey, "region", "课堂练习")
    expect(assessment.locator(".education-feedback")).to_have_count(0)
    if isinstance(answer, list):
        learning.number_answer(assessment, answer)
    else:
        F(assessment, "radio", answer).check()
        hit(assessment, "提交作答")
    expect(F(assessment, "heading", "核对正确")).to_be_visible()
    expect(assessment.get_by_text("首次无本题帮助。", exact=True)).to_be_visible()
    F(page, "link", "在实验笔记打开已保存的解释").press("Enter")
    check_source(page, work["sourceEvidence"][0], "基线")
    print(f"{ENGINE} {WIDTH}px {case_id}: domain evidence, paired policy, original source, {item_id} independent", flush=True)


def check_source(page, source, arm):
    follow(page, F(page, "link", f"查看{arm}原事件 {source['event']['eventId']}"))
    expect(page.get_by_text(source["runId"], exact=True)).to_be_visible()
    expect(page.get_by_text("已核对保存的版本与运行摘要", exact=True)).to_be_visible()
    expect(page.get_by_role("table", name="原事件前后数值")).to_be_visible()


def attempts(backup):
    return {row["id"]: {key: value for key, value in row.items() if key not in ("local_profile_id", "session_id")}
            for row in backup["indexed"]["attempts"]}


def follow(page, link):
    expect(link).to_be_visible()
    destination = urljoin(page.url, link.get_attribute("href"))
    link.press("Enter")
    expect(page).to_have_url(destination)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    learning.OUT = OUT
    remaining.OUTPUT = OUT
    errors = []
    saved = {}
    with sync_playwright() as pw, getattr(pw, ENGINE).launch(**learning.LAUNCH) as browser:
        with browser.new_context(**learning.OPTIONS) as context:
            page = learning.prepare(context, 20, errors)
            for case_id in (sys.argv[4:] or cases):
                work = remaining.walk(page, case_id, WIDTH, inspect)
                transfer(page, case_id, work)
                saved[case_id] = work["sourceEvidence"][1]
            archive_panel = learning.archive_panel(page)
            backup = learning.download(archive_panel, "导出完整学习档案")
            expected = {cases[case_id][1] for case_id in (sys.argv[4:] or cases)}
            actual = {row["item_id"] for row in backup["indexed"]["attempts"]
                      if row["assessment_role"] == "transfer" and row["evidence_class"] == "independent"
                      and row["evaluation"]["result"] == "correct"}
            assert expected == actual, (expected, actual)
        with browser.new_context(**learning.OPTIONS) as context:
            page = learning.prepare(context, 21, errors)
            archive_panel = learning.archive_panel(page)
            learning.upload(archive_panel, backup)
            expect(archive_panel.get_by_role("status")).to_contain_text("档案已导入")
            restored = learning.download(archive_panel, "导出完整学习档案")
            before, after = attempts(backup), attempts(restored)
            assert before.keys() == after.keys()
            for attempt_id, record in before.items():
                changed = {key for key in record.keys() | after[attempt_id].keys()
                           if record.get(key) != after[attempt_id].get(key)}
                assert not changed, changed
            assert dict(restored["progressive"]["entries"]) == dict(backup["progressive"]["entries"])
            assert restored["teaching"] == backup["teaching"]
            expect(page.locator(".note-list > li")).to_have_count(len(saved))
            for case_id, source in saved.items():
                if not page.url.endswith("/?view=notes"):
                    page.goto(f"{BASE}/?view=notes")
                page.locator(".flagship-records").wait_for(state="attached")
                title = json.loads(Path(f"cases/{case_id}/case.json").read_text())["title"]
                note = page.locator(".note-list > li").filter(has=F(page, "heading", title))
                follow(page, F(note, "link", "打开已保存的解释"))
                check_source(page, source, "政策组")
            print(f"{ENGINE} {WIDTH}px: restored {len(expected)} transfer records and saved run sources in a clean profile")
        assert not errors, errors
