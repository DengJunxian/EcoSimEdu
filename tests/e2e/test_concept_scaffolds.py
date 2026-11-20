import json
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

from test_lesson_flow import answer, checkpoint, complete, hit, phase


TOPICS = [
    ("schelling_segregation", "denominators", "百分比与分母", [5], [5, 60]),
    ("schelling_segregation", "paired-randomness", "单变量对照与随机性", None,
     "每个种子内固定幼苗、天气和观测时点，仅改变浇水次数，再比较多对差值。"),
    ("svb_run", "stock-flow", "存量与流量", [13], [37, 7]),
    ("svb_run", "conditional-information", "概率与条件信息", [40], [75]),
    ("double_auction", "marginal-total", "边际与总量", [14], [-2, 21]),
]


def open_topic(page, title):
    entry = page.locator(".concept-scaffolds > summary")
    entry.press("Enter")
    hit(page.locator(".concept-scaffolds"), title)
    lesson = page.get_by_role("region", name=title, exact=True)
    expect(lesson.get_by_role("heading", name="直观例子")).to_be_focused()
    expect(lesson.get_by_role("button", name="看完整示范")).to_be_enabled()
    return lesson, entry


def save_archive(page, base):
    page.goto(base + "/explore/?view=notes")
    backup = page.locator(".progress-backup")
    backup.locator("summary").press("Enter")
    with page.expect_download() as downloaded:
        hit(backup, "导出完整学习档案")
    return Path(downloaded.value.path())


@pytest.mark.parametrize("case,topic,title,step,check", TOPICS, ids=[row[1] for row in TOPICS])
def test_concept_scaffold_stages_save_exact_help_and_attempts(
    local_app, launch_education_browser, audit_education, case, topic, title, step, check
):
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        context = browser.new_context(viewport={"width": 320, "height": 890}, accept_downloads=True)
        requests = []
        context.on("request", lambda request: requests.append(request.url))
        context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/")
                      and "/api/" not in route.request.url else route.abort())
        page = context.new_page()
        url = local_app + f"/explore/?lesson={case}&flow=v3"
        page.goto(url)
        phase(page, 0)
        lesson, entry = open_topic(page, title)
        if step is None:
            hit(lesson, "跳过示范")
            hit(lesson, "跳到新情境题")
        else:
            hit(lesson, "看完整示范")
            expect(lesson.get_by_role("heading", name="完整示范")).to_be_focused()
            hit(lesson, "试做一小步")
            expect(lesson.get_by_role("heading", name="完成一小步")).to_be_focused()
            answer(lesson, step, practice=False)
            expect(lesson.get_by_role("heading", name="核对正确")).to_be_focused()
            hit(lesson, "做新情境题")
        expect(lesson.get_by_role("heading", name="新情境独立题")).to_be_focused()
        audit_education(page, f"scaffold-{topic}", ".concept-scaffolds")
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
        hinted = topic == "conditional-information"
        if hinted:
            hit(lesson, "看提示")
        answer(lesson, check, practice=False)
        expect(lesson.get_by_role("heading", name="核对正确")).to_be_focused()
        expect(lesson.get_by_text("有帮助或暴露未知。" if hinted else "首次无本题帮助。", exact=True)).to_be_visible()
        hit(lesson, "返回本课")
        expect(entry).to_be_focused()
        expect(lesson).to_have_count(0)
        phase(page, 0)

        archive = save_archive(page, local_app)
        indexed = json.loads(archive.read_text())["indexed"]
        attempts = {row["item_id"]: row for row in indexed["attempts"]}
        first, second = f"micro-{topic}-step", f"micro-{topic}-check"
        assert set(attempts) == ({first, second} if step is not None else {second})
        assert not indexed["records"]["reviews"]
        session, = indexed["records"]["sessions"]
        assert not session["phase_cursor"] and "current_activity_id" not in session
        assert session["activity_states"][first] == ("skipped" if step is None else "submitted")
        if step is not None:
            assert attempts[first]["exposure"]["exemplar_seen"] and attempts[first]["evidence_class"] == "assisted"
        assert not attempts[second]["exposure"]["exemplar_seen"]
        assert attempts[second]["exposure"]["max_hint_level"] == int(hinted)
        assert all(row["assessment_role"] == "practice" and row["evaluation"]["result"] == "correct"
                   for row in attempts.values())

        if topic == "denominators":
            other = browser.new_context(viewport={"width": 320, "height": 890})
            restored = other.new_page()
            restored.goto(local_app + "/explore/?view=notes")
            backup = restored.locator(".progress-backup")
            backup.locator("summary").press("Enter")
            backup.get_by_label("四阶学习备份").set_input_files(archive)
            hit(backup, "导入四阶学习备份")
            expect(backup.get_by_role("status")).to_contain_text("2 次作答")
            restored.goto(url)
            reopened, _ = open_topic(restored, title)
            hit(reopened, "跳过示范")
            hit(reopened, "跳到新情境题")
            answer(reopened, check, practice=False)
            expect(reopened.get_by_text("已见同题反馈。", exact=True)).to_be_visible()
            other.close()
        assert all(request.startswith(local_app + "/") and "/api/" not in request for request in requests)


def test_micro_lesson_returns_to_the_same_unsubmitted_course_question(local_app, launch_education_browser):
    case = "double_auction"
    with sync_playwright() as playwright, launch_education_browser(playwright) as browser:
        page = browser.new_page(viewport={"width": 390, "height": 890})
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/")
                   and "/api/" not in route.request.url else route.abort())

        def visit_micro(task, independent):
            first = task.get_by_role("spinbutton").first
            first.fill("6")
            previous = checkpoint(page, case)
            lesson, _ = open_topic(page, "边际与总量")
            hit(lesson, "跳过示范")
            hit(lesson, "跳到新情境题")
            answer(lesson, [-2, 21], practice=False)
            hit(lesson, "返回本课")
            phase(page, 6)
            assert checkpoint(page, case) == previous
            expect(first).to_have_value("6")
            expect(page.get_by_role("button", name="进入迁移与复习")).to_have_count(0)
            answer(task, independent)

        complete(page, local_app, case, prepare_review=visit_micro)
