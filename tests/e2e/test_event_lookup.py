from uuid import uuid4

from playwright.sync_api import expect, sync_playwright


def test_find_event_by_number_and_keep_existing_frame_link(local_app, chromium_options):
    with sync_playwright() as p:
        browser = p.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": 390, "height": 850})
        response = page.request.post(local_app + "/api/runs", data={
            "request_id": str(uuid4()), "case_id": "double_auction", "scenario_id": "baseline",
            "provider_kind": "replay", "seed": 1962, "bid": 96,
        })
        assert response.status == 201
        identifier = response.json()["run_id"]
        assert page.request.post(f"{local_app}/api/runs/{identifier}/start", data={}).ok
        base = f"{local_app}/?case=double_auction&run={identifier}"
        page.goto(base + "&tick=0")
        expect(page).to_have_title("双向拍卖 · 实验回放 · Civitas Economica")
        page.get_by_role("link", name="按事件序号查看").click()
        expect(page).to_have_title("双向拍卖 · 运行事件 · Civitas Economica")
        expect(page.get_by_role("heading", name="事件 0", exact=True)).to_be_visible()
        expect(page.get_by_role("link", name="上一条事件")).to_have_count(0)
        number = page.get_by_role("spinbutton", name="事件序号")
        number.fill("2")
        number.press("Enter")
        expect(page.get_by_role("heading", name="事件 2", exact=True)).to_be_visible()
        page.get_by_role("link", name="上一条事件").click()
        expect(page.get_by_role("heading", name="事件 1", exact=True)).to_be_visible()
        page.get_by_role("link", name="查看关联快照 1").click()
        expect(page.get_by_role("link", name="按事件序号查看")).to_have_attribute("href", f"/?case=double_auction&run={identifier}&event=1")
        page.goto(base + "&event=100000")
        expect(page.get_by_role("alert")).to_have_text("该运行没有这一事件序号。")
        page.goto(base.replace("double_auction", "svb_run") + "&event=1")
        expect(page.get_by_role("alert")).to_have_text("链接中的事件与当前课程或版本不符。")
        browser.close()
