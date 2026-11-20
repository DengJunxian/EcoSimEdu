from datetime import datetime, timezone
import json
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

from test_auction_fork import verify_auction_fork
from test_lesson_flow import REVIEW_QUESTIONS, answer, model_app, phase
from test_schelling_fork import verify_fork
from test_svb_fork import verify_svb_fork


CASES = [
    ("schelling_segregation", verify_fork, "1", "74", "A001 从"),
    ("svb_run", verify_svb_fork, "3/1", "3/1", "D01 你选择本轮暂缓"),
    ("double_auction", verify_auction_fork, "4", "3", "B01 撤回 O001"),
]
ALTERNATIVE = "先核对两组是否在同一经济时点采用相同的汇总口径。"


def verify_fork_explanation(browser, base, case, width=390, inspect=None, model_key=None, audit=None):
    case_id, run, original, branch, event = case
    context = browser.new_context(viewport={"width": width, "height": 890}, accept_downloads=True)
    context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/")
                  and (model_key or "/api/" not in route.request.url) else route.abort())
    page = context.new_page()
    page.clock.set_fixed_time(datetime(2026, 11, 20, 2, tzinfo=timezone.utc))

    def hit(scope, label):
        scope.get_by_role("button", name=label, exact=True).press("Enter")

    if model_key:
        page.goto(base + "/explore/?view=ai")
        page.get_by_label("API 密钥").fill(model_key)
        hit(page, "发送一次连接测试")
        expect(page.get_by_role("status").filter(has_text="连接测试通过")).to_be_visible()

    run(page, base)
    if case_id == "double_auction":
        panel = page.get_by_role("region", name="预测后运行")
        panel.get_by_role("slider").press("End")
        panel.get_by_role("radio", name="减少", exact=True).check()
        hit(panel, "运行并验证")
        hit(page, "进入独立解释")
        expect(page.get_by_label("政策组证据")).to_be_visible()
        hit(page, "更换解释所用的对照")
    hit(page, "用中途分支写解释")
    classroom = page.url
    expect(page.get_by_role("heading", level=1)).to_have_text("独立解释")
    page.reload()
    expect(page.get_by_role("heading", level=1)).to_have_text("独立解释")
    form = page.get_by_role("region", name="用两次运行解释机制")
    form.get_by_label("无干预证据").select_option(original)
    form.get_by_label("分支证据").select_option(branch)
    for name, value in {
        "claim": "按同一种子重算后，两个轨迹可以在共同条件下比较。",
        "rule": "记录学生中途动作，再沿用原来的行动规则。",
        "calculation": "核对两条指定的原始记录及对应的读数。",
        "difference": "同一开局和轮序下比较中途动作后的差异。",
        "hypothesis": "推广前需要确认真实制度及样本条件。",
        "alternative": ALTERNATIVE,
    }.items():
        form.locator(f"[name={name}]").fill(value)
    hit(form, "保存解释")
    expect(form.get_by_role("status").filter(has_text="解释已保存在本浏览器")).to_contain_text(f"分支事件 {branch}")
    expect(page.get_by_role("button", name="进入迁移与复习")).to_have_count(0)
    coach = form.get_by_role("region", name="自评与导师建议")
    hit(coach, "用两条原证据生成自查")
    expect(coach).to_contain_text(f"比较基线事件 {original}")
    expect(coach).to_contain_text(f"分支事件 {branch}")
    expect(page.get_by_role("button", name="进入迁移与复习")).to_have_count(0)
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    if inspect:
        inspect(page, form)

    with page.expect_download() as downloaded:
        hit(form, "导出含解释的结果")
    work = Path(downloaded.value.path())
    data = json.loads(work.read_text())
    reference = data["sourceEvidence"]
    assert reference[0]["runId"] != reference[1]["runId"]
    assert [ref["event"]["eventId"] for ref in reference] == [original, branch]
    assert data["runEnvelopes"][1]["inputs"]["parentRunId"] == reference[0]["runId"]
    assert data["explanation"]["alternative"] == ALTERNATIVE

    form.get_by_role("link", name="在实验笔记打开已保存的解释").press("Enter")
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    expect(page.get_by_text(ALTERNATIVE, exact=True)).to_be_visible()
    expect(page.get_by_text("原动作预测", exact=False)).to_be_visible()
    note_url = page.url
    if model_key:
        panel = page.locator("details").filter(has=page.get_by_text("在线解释审阅", exact=True))
        panel.locator("summary").press("Enter")
        with page.expect_request("**/api/ai/review/explanation") as sent:
            hit(panel, "请 AI 审阅")
        expect(panel.get_by_role("status")).to_contain_text(f"AI 选出的追问 · {REVIEW_QUESTIONS[case_id]}")
        payload = sent.value.post_data_json
        cited = payload["comparison"]
        if case_id == "svb_run":
            invalid = cited | {"event_id": f"{cited['seq']}/2"}
        else:
            invalid = cited | {"seq": cited["seq"] - 1}
        rejected = page.request.post(sent.value.url, data=payload | {"comparison": invalid}, headers={"Origin": base})
        assert rejected.status == 409
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
        if audit:
            audit(page, f"explanation-review-{case_id}", ".study-reflection details")
        panel.get_by_role("link", name="查看追问的分支证据").press("Enter")
        expect(page.get_by_role("region", name="原始记录")).to_contain_text(event)
        page.get_by_role("link", name="返回已保存的解释").press("Enter")
    page.get_by_role("link", name=f"查看分支原事件 {branch}").press("Enter")
    expect(page.get_by_role("heading", level=1)).to_contain_text("分支原事件")
    expect(page.get_by_role("region", name="原始记录")).to_contain_text(event)
    page.get_by_role("link", name="返回已保存的解释").press("Enter")
    page.get_by_role("navigation", name="笔记入口").get_by_role("link", name="全部解释").press("Enter")
    backup = page.locator(".progress-backup")
    backup.locator("summary").press("Enter")
    with page.expect_download() as copied:
        hit(backup, "导出完整学习档案")
    archive = Path(copied.value.path())
    bundle = json.loads(archive.read_text())
    assert not bundle["indexed"]["attempts"]

    other = browser.new_context(viewport={"width": width, "height": 890})
    restored = other.new_page()
    restored.goto(base + "/explore/?view=notes")
    backup = restored.locator(".progress-backup")
    backup.locator("summary").press("Enter")
    backup.get_by_label("四阶学习备份").set_input_files(archive)
    hit(backup, "导入四阶学习备份")
    expect(backup.get_by_role("status")).to_contain_text("档案已导入")
    restored.goto(note_url)
    expect(restored.get_by_text(ALTERNATIVE, exact=True)).to_be_visible()
    if model_key:
        panel = restored.locator("details").filter(has=restored.get_by_text("在线解释审阅", exact=True))
        panel.locator("summary").press("Enter")
        hit(panel, "请 AI 审阅")
        expect(panel.get_by_role("status")).to_contain_text("作者自查")
        expect(panel.get_by_role("link", name="打开 AI 连接设置")).to_be_visible()
        assert restored.evaluate("document.documentElement.scrollWidth === innerWidth")
    restored.get_by_role("link", name="核对建议的分支事件").press("Enter")
    expect(restored.get_by_role("region", name="原始记录")).to_contain_text(event)

    restored.goto(base + f"/explore/?lesson={case_id}&view=teacher-work")
    upload = restored.get_by_label("学生解释作品")
    upload.set_input_files(work)
    hit(restored, "核对并查看作品")
    expect(restored.get_by_role("heading", name="已核对两条运行来源")).to_be_focused()
    expect(restored.get_by_role("region", name="分支原事件")).to_contain_text(event)
    data["runEnvelopes"][1]["inputs"]["fork"]["checkpoint"] = 0
    upload.set_input_files({"name": "broken.json", "mimeType": "application/json", "buffer": json.dumps(data).encode()})
    hit(restored, "核对并查看作品")
    expect(restored.get_by_role("alert")).to_contain_text("无法核对这份作品")
    expect(restored.get_by_role("heading", name="已核对两条运行来源")).to_have_count(0)
    other.close()
    if case_id == "double_auction":
        page.goto(classroom)
        expect(page.get_by_label("分支证据")).to_have_value(branch)
        task = page.get_by_role("region", name="课堂练习", exact=True)
        skip = task.get_by_role("button", name="跳过本题", exact=True)
        expect(skip).to_be_enabled()
        skip.press("Enter")
        expect(task.get_by_role("heading", name="独立应用", exact=False)).to_be_visible()
        answer(task, [6, 9, 6, 21])
        hit(page, "进入迁移与复习")
        phase(page, 7)
        page.reload()
        phase(page, 7)
        answer(task, [4, 16])
        page.clock.set_fixed_time(datetime(2026, 11, 21, 3, tzinfo=timezone.utc))
        page.reload()
        expect(page.get_by_role("region", name="独立练习与学习证据")).to_contain_text("待复习")
        page.get_by_role("link", name="查看本机复习安排").press("Enter")
        expect(page.locator("main .education-task").get_by_role("heading", name="双向拍卖")).to_be_visible()
    context.close()


@pytest.mark.parametrize("case", CASES, ids=[case[0] for case in CASES])
def test_fork_notes_and_teacher_sources(local_app, launch_education_browser, case):
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        verify_fork_explanation(browser, local_app, case)


@pytest.mark.parametrize("case", CASES, ids=[case[0] for case in CASES])
def test_saved_fork_uses_online_review(model_app, launch_education_browser, audit_education, case):
    base, key, calls = model_app
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        verify_fork_explanation(browser, base, case, width=320, model_key=key, audit=audit_education)
    assert [call["intent"] for call in calls] == ["review_explanation"]
    review = calls[0]
    assert review["explanation"]["alternative"] == ALTERNATIVE
    original, branch = case[2:4]
    blocks = review["blocks"]
    assert [block["event_seqs"] for block in blocks.values()] == [[int(ref.split("/")[0])] for ref in (original, branch)]
    if case[0] == "svb_run":
        assert [block["event_ids"] for block in blocks.values()] == [[original], [branch]]
        assert "D01 暂缓申请" in blocks["comparison"]["text"]
        assert "该笔前后" in blocks["comparison"]["text"]
    if case[0] == "double_auction":
        assert "B01 的订单 O001" in blocks["comparison"]["text"]
        assert "学生主动撤单" in blocks["comparison"]["text"]
