import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


FIXTURE = json.loads((Path(__file__).resolve().parents[1] / "fixtures/progressive-note-8fc8971.json").read_text())


def test_legacy_note_opens_both_verified_sources_and_rejects_unknown_version(local_app, launch_education_browser):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        page = browser.new_page(viewport={"width": 390, "height": 900})
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/explore/") else route.abort())
        url = local_app + "/explore/?view=notes"
        page.goto(url)
        page.evaluate("([key, raw]) => localStorage.setItem(key, raw)", [FIXTURE["storageKey"], FIXTURE["storedValue"]])
        page.reload()
        page.get_by_role("link", name="打开已保存的解释").press("Enter")

        for title in ("基线", "政策组"):
            page.get_by_role("link", name=f"查看{title}原事件 4").press("Enter")
            expect(page.get_by_role("heading", level=1)).to_have_text(f"{title}原事件 · 事件 4")
            expect(page.get_by_text("与基线版本的运行摘要一致")).to_be_visible()
            expect(page.get_by_text("涉及主体 B01、S02")).to_be_visible()
            expect(page.get_by_text("原来源事件 1、3")).to_be_visible()
            price = page.get_by_role("row").filter(has_text="成交价（代币/件）")
            expect(price.get_by_role("cell")).to_have_text(["未定义", "96"])
            page.get_by_role("link", name="返回已保存的解释").press("Enter")

        assert page.evaluate("key => localStorage.getItem(key)", FIXTURE["storageKey"]) == FIXTURE["storedValue"]
        page.evaluate("""key => {
          const original = JSON.parse(localStorage.getItem(key));
          localStorage.setItem(key, JSON.stringify({...original, evidence: {baseline: {versions: {engine: 'unknown'}}}}));
        }""", FIXTURE["storageKey"])
        page.reload()
        page.get_by_role("link", name="查看基线原事件 4").press("Enter")
        expect(page.get_by_role("heading", level=1)).to_have_text("原证据不可验证")
        expect(page.get_by_text("涉及主体 B01、S02")).to_have_count(0)
        page.get_by_role("link", name="返回已保存的解释").press("Enter")
        expect(page.get_by_text("在簿订单决定本次价格。")).to_be_visible()
        browser.close()
