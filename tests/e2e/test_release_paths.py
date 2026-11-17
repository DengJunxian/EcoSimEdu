"""Final task-oriented checks for keyboard use and local storage recovery."""
from playwright.sync_api import expect, sync_playwright
import pytest

from services.simulation.lessons import load_case

KEYBOARD_CASES = ["double_auction", "schelling_segregation", "svb_run"]


@pytest.mark.parametrize("case_id", KEYBOARD_CASES)
def test_core_workflows_by_keyboard(local_app, case_id, chromium_options):
    case = load_case(case_id)
    is_auction = case_id == "double_auction"
    outbound = []
    with sync_playwright() as p:
        browser = p.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": 390, "height": 900}, accept_downloads=True)

        def local(route):
            if route.request.url.startswith(local_app + "/"):
                route.continue_()
            else:
                outbound.append(route.request.url)
                route.abort()

        context.route("**/*", local)
        page = context.new_page()
        page.goto(local_app + f"/?case={case_id}")

        def activate(name):
            button = page.get_by_role("button", name=name, exact=True).first
            expect(button).to_be_enabled()
            button.focus()
            expect(button).to_be_focused()
            button.press("Enter")

        def expect_stage_focus(stage):
            title = next(lesson["title"] for lesson in case["lessons"] if lesson["id"] == stage)
            expect(page.get_by_role("heading", name=title, exact=True)).to_be_focused()

        activate("开始实验")
        expect_stage_focus("predict")
        radio = page.get_by_role("radio", name=case["questions"]["prediction"]["options"]["unknown"], exact=True)
        radio.focus()
        radio.press("Space")
        activate("去报价" if is_auction else "选择行动")
        expect_stage_focus("bid")
        activate("运行实验")
        expect_stage_focus("observe")
        first = "跳到下一笔成交" if is_auction else "跳到下一条证据"
        cite = "引用此笔成交" if is_auction else "引用此事件"
        for _ in range(2):
            activate(first)
            activate(cite)
        activate("揭示全市场价值" if is_auction else "解释结果")
        expect_stage_focus("explain")
        question = case["questions"]["explain"]
        wrong = next(answer for key, answer in question["options"].items() if key != question["answer"])
        radio = page.get_by_role("radio", name=wrong, exact=True)
        radio.focus()
        radio.press("Space")
        expect(page.get_by_text(question["feedback"], exact=True)).to_be_visible()
        activate("比较反事实")
        expect_stage_focus("compare")
        for scenario in case["scenarios"][1:]:
            activate("运行对照")
            expect(page.get_by_role("row", name=scenario["label"], exact=False)).not_to_contain_text("待运行")
        activate("写实验笔记")
        expect_stage_focus("notebook")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        for part in ["观察", "机制解释", "成立条件", "迁移"]:
            page.get_by_role("textbox", name=part, exact=part != "迁移").fill("引用运行证据并按当前模型条件解释。")
        activate("完成学习")
        expect(page.get_by_role("button", name="已完成学习", exact=True)).to_be_disabled()
        with page.expect_download() as note:
            activate("导出实验笔记")
        assert note.value.suggested_filename.endswith(".json")
        page.reload()
        expect(page.get_by_role("button", name="已完成学习", exact=True)).to_be_visible()
        assert not outbound
        browser.close()


def test_unknown_course_and_storage_full_stay_actionable(local_app, chromium_options):
    with sync_playwright() as p:
        browser = p.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": 390, "height": 850})
        context.add_init_script("""
const write = Storage.prototype.setItem;
Storage.prototype.setItem = function(key, value) {
  if (key.startsWith('civitas/')) throw new DOMException('quota', 'QuotaExceededError');
  return write.call(this, key, value);
};
""")
        page = context.new_page()
        page.goto(local_app + "/?case=not-in-the-catalog")
        expect(page.get_by_role("heading", name="课程不可用")).to_be_visible()
        page.get_by_role("link", name="返回案例库").click()
        page.get_by_role("link", name="双向拍卖 价格是怎样形成的？").click()
        page.get_by_role("link", name="打开原版课堂").click()
        page.get_by_role("button", name="开始实验").click()
        expect(page.get_by_text("浏览器无法保存草稿。", exact=False)).to_be_visible()
        page.get_by_role("radio", name="不确定").check()
        page.get_by_role("button", name="去报价").click()
        page.get_by_role("button", name="运行实验", exact=True).click()
        expect(page.get_by_role("heading", name="观察撮合")).to_be_visible()
        browser.close()
