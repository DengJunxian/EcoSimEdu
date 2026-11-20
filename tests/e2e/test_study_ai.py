import json
import os

from playwright.sync_api import expect, sync_playwright


def test_study_ai_onboarding(local_app, launch_education_browser):
    fake_key = "this-is-a-fake-study-api-key"
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        for width in (320, 390, 768, 1440):
            context = browser.new_context(viewport={"width": width, "height": 850})
            calls = []
            response = {"active": None, "checking": False, "tests_remaining": 5}

            def network(route):
                if not route.request.url.startswith(local_app + "/"):
                    route.abort()
                    return
                if route.request.url.endswith("/api/ai/test"):
                    data = route.request.post_data_json
                    assert data == {"provider": "openai", "api_key": fake_key, "confirm": True}
                    failure = not calls
                    calls.append(data["provider"])
                    response.update(active={"provider": "openai", "model": "model-fixture",
                                            "reason": "auth_failed" if failure else None, "usage": None},
                                    tests_remaining=5 - len(calls))
                    route.fulfill(json=response)
                elif route.request.url.endswith("/api/ai/status") and calls:
                    route.fulfill(json=response)
                elif route.request.method == "DELETE" and route.request.url.endswith("/api/ai/session"):
                    response.update(active=None, tests_remaining=5)
                    route.fulfill(json=response)
                else:
                    route.continue_()

            context.route("**/*", network)
            page = context.new_page()
            page.goto(local_app + "/explore/")
            expect(page.get_by_role("article")).to_have_count(12)
            page.get_by_role("button", name="暂用离线").press("Enter")
            expect(page.get_by_role("link", name="从双向拍卖开始")).to_be_focused()
            page.reload()
            expect(page.get_by_role("link", name="连接 AI")).to_have_count(0)
            assert not calls
            page.get_by_role("link", name="AI 导师", exact=True).press("Enter")
            key = page.get_by_label("API 密钥")
            expect(key).to_have_attribute("type", "password")
            assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
            if width == 390 and (output := os.environ.get("CIVITAS_STUDY_AI_SCREENSHOT")):
                page.screenshot(path=output)

            key.fill(fake_key)
            page.get_by_label("供应商").select_option("deepseek")
            expect(key).to_have_value("")
            page.get_by_label("供应商").select_option("openai")
            for result in ("测试未通过", "连接测试通过"):
                key.fill(fake_key)
                page.get_by_role("button", name="发送一次连接测试").press("Enter")
                expect(page.get_by_role("status").get_by_text(result, exact=False)).to_be_visible()
                expect(key).to_have_value("")
            page.reload()
            expect(page.get_by_role("status").get_by_text("连接测试通过", exact=False)).to_be_visible()
            page.get_by_role("button", name="清除本次连接").press("Enter")
            expect(page.get_by_role("button", name="清除本次连接")).to_have_count(0)
            expect(key).to_be_focused()
            storage = page.evaluate("""async () => ({
                local: {...localStorage}, session: {...sessionStorage},
                cookies: document.cookie, databases: await indexedDB.databases(),
            })""")
            assert fake_key not in json.dumps(storage) + page.url + page.content()
            assert len(calls) == 2
            page.get_by_role("link", name="开始居住隔离课程").press("Enter")
            expect(page).to_have_url(local_app + "/explore/?lesson=schelling_segregation&flow=v3")
            expect(page.get_by_role("link", name="AI 导师", exact=True)).to_be_visible()
            context.close()
        browser.close()
