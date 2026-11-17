import json
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

from services.simulation.lessons import CATALOG, load_case


@pytest.mark.parametrize("width", [390, 1440])
def test_lab_tools_persist_and_open_real_experiment(local_app, width, chromium_options):
    auction = load_case("double_auction")
    course = load_case("school_matching")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        context = browser.new_context(viewport={"width": width, "height": 900}, accept_downloads=True)
        external, errors, model_requests = [], [], []

        def local_only(route):
            if not route.request.url.startswith(local_app + "/"):
                external.append(route.request.url)
                route.abort()
                return
            if route.request.method == "POST" and "/api/live" in route.request.url:
                model_requests.append(route.request.url)
                route.abort()
                return
            route.continue_()

        context.route("**/*", local_only)
        page = context.new_page()
        page.set_default_timeout(6500)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(local_app)
        lab = page.get_by_role("region", name="实验室工具")
        directory = lab.get_by_role("navigation", name="课程目录")
        expect(directory.get_by_role("link")).to_have_count(len(CATALOG))

        lab.get_by_label("学习路径", exact=True).select_option("制度设计")
        expect(directory.get_by_role("link")).to_have_count(5)
        search = lab.get_by_label("搜索课程", exact=True)
        search.fill(course["title"])
        expect(directory.get_by_role("link", name=course["title"], exact=True)).to_be_visible()
        expect(directory.get_by_role("link")).to_have_count(1)
        search.fill("不存在的课程")
        expect(directory.get_by_role("status")).to_have_text("没有符合条件的课程。")
        search.fill(course["title"])
        star = directory.get_by_role("button", name=f"收藏{course['title']}", exact=True)
        star.focus()
        star.press("Space")
        expect(star).to_have_attribute("aria-pressed", "true")
        page.reload()
        lab.get_by_role("button", name="收藏", exact=True).click()
        saved = lab.get_by_role("navigation", name="收藏的课程")
        expect(saved.get_by_role("link", name=course["title"], exact=True)).to_be_visible()

        lab.get_by_role("button", name="概念", exact=True).click()
        lab.get_by_role("searchbox", name="搜索概念").fill(auction["glossary"][0]["term"])
        expect(lab.get_by_text(auction["glossary"][0]["definition"], exact=True)).to_be_visible()

        lab.get_by_role("button", name="设置与帮助", exact=True).click()
        teacher = lab.get_by_role("checkbox", name="教师模式")
        teacher.check()
        page.reload()
        lab.get_by_role("button", name="设置与帮助", exact=True).click()
        expect(teacher).to_be_checked()
        with page.expect_download() as download:
            lab.get_by_role("button", name="导出本课实验预设").click()
        exported = json.loads(Path(download.value.path()).read_text())
        assert exported == {
            "case_id": auction["case_id"], "case_version": auction["version"], "seed": auction["seed"],
            "provider_kind": "rule", "student_choice": {"bid": auction["preset_bid"]},
            "presets": [{key: value for key, value in scene.items() if key != "description"}
                          for scene in auction["scenarios"]],
        }
        lab.get_by_text("如何保留或接续实验？", exact=True).click()
        expect(lab.get_by_text("同一浏览器可从", exact=False)).to_be_visible()
        teacher.uncheck()
        expect(lab.get_by_role("button", name="导出本课实验预设")).to_have_count(0)

        lab.get_by_role("button", name="我的实验", exact=True).click()
        expect(lab.get_by_text("此浏览器还没有已开始的课程。")).to_be_visible()
        page.get_by_role("button", name="开始实验", exact=True).click()
        page.get_by_role("radio", name=auction["questions"]["prediction"]["options"]["no"], exact=True).check()
        page.get_by_role("button", name="去报价", exact=True).click()
        page.get_by_role("button", name="运行实验", exact=True).click()
        expect(page.get_by_role("heading", name=auction["lessons"][3]["title"], exact=True)).to_be_visible()
        page.get_by_role("button", name="Civitas Economica").click()
        lab.get_by_role("button", name="我的实验", exact=True).click()
        expect(lab.get_by_text(f"进行中 · {auction['lessons'][3]['title']}", exact=True)).to_be_visible()
        lab.get_by_role("link", name=auction["scenarios"][0]["label"], exact=True).click()
        expect(page.get_by_role("heading", name=auction["title"], exact=True)).to_be_visible()
        assert page.locator("body").evaluate("(el) => el.scrollWidth <= innerWidth")
        assert not external and not errors and not model_requests
        browser.close()
