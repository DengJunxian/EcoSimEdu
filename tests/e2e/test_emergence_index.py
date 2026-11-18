from playwright.sync_api import expect, sync_playwright

from services.simulation.lessons import CATALOG


def test_mechanism_index_links_all_offline_classes_and_the_transfer_route(
    local_app, launch_education_browser, audit_education,
):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        page = browser.new_page(viewport={"width": 320, "height": 850})
        assert page.goto(local_app).ok
        page.get_by_role("link", name="从微观到宏观", exact=True).press("Enter")
        expect(page.get_by_role("heading", level=1)).to_have_text("从微观到宏观")
        courses = page.locator(".studio-index-group")
        links = courses.get_by_role("link")
        expect(links).to_have_count(12)
        assert {link.get_attribute("href") for link in links.all()} == {f"/learn/{case_id}" for case_id in CATALOG}
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        audit_education(page, "emer-index-320", "main")
        page.get_by_role("link", name="核对跨课推理").press("Enter")
        expect(page.get_by_role("heading", name="同一成交价背后的不同机制")).to_be_visible()
        page.get_by_role("radio", name="核对挂牌报价与退出事件，并查退出前各方可见的质量信息").check()
        expect(page.get_by_text("核对一致。用真实订单查撮合来源", exact=False)).to_be_visible()
        page.go_back()
        courses.get_by_role("link", name="居住隔离").press("Enter")
        expect(page.get_by_role("button", name="开始学习")).to_be_visible()
        browser.close()
