"""Verify that the map loads offline and opens the published classrooms."""
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[2]
cases = json.loads((ROOT / "cases/catalog.json").read_text())
base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8776/explore").rstrip("/")
parsed = urlsplit(base)
origin = f"{parsed.scheme}://{parsed.netloc}"
engine = sys.argv[2] if len(sys.argv) > 2 else "chromium"


def opening(case_id):
    scenes = json.loads((ROOT / f"cases/{case_id}/lesson-v2.json").read_text())["scenes"]
    return scenes[0]["title"]


with sync_playwright() as playwright:
    browser = getattr(playwright, engine).launch(**({"channel": "chrome"} if engine == "chromium" else {}))
    for width in (1180, 390):
        page = browser.new_page(viewport={"width": width, "height": 844}, reduced_motion="reduce")
        allow_legacy = False
        rejected, errors, requests = [], [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def rules(route):
            url = route.request.url
            requests.append(url)
            if route.request.method == "GET" and (url.startswith(base + "/") and "/api/" not in url
                    or allow_legacy and url.startswith(origin + "/")):
                route.continue_()
            else:
                rejected.append(url)
                route.abort()

        page.route("**/*", rules)
        page.goto(base + "/")
        expect(page.get_by_role("heading", level=1)).to_have_text("从一笔交易，看见经济系统")
        expect(page.get_by_role("link", name="从双向拍卖开始")).to_be_in_viewport()
        expect(page.locator(".map-path")).to_have_count(4)
        expect(page.get_by_role("article")).to_have_count(12)
        assert not any("Classroom" in url or "MetricChart" in url for url in requests), requests
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")

        page.keyboard.press("Alt+Tab" if engine == "webkit" else "Tab")
        skip = page.get_by_role("link", name="跳到主要内容")
        expect(skip).to_be_focused()
        skip.press("Enter")
        expect(page.locator("main")).to_be_focused()
        page.get_by_role("navigation", name="跳到一条学习路径").get_by_role(
            "link", name="复杂系统与宏观金融传导").press("Enter")
        assert page.evaluate("location.hash") == "#transmission"

        svb = page.get_by_role("article", name="硅谷银行挤兑")
        svb.get_by_text("先理解 存量与流量、库存位置与延迟").press("Enter")
        expect(svb.get_by_text("余额对应一个时点，流量对应一个区间。", exact=False)).to_be_visible()
        svb.get_by_role("link", name="啤酒游戏").press("Enter")
        assert page.evaluate("location.hash") == "#lesson-beer_game"
        expect(svb.get_by_role("link", name="原课堂与进度")).to_have_attribute("href", "/learn/svb_run")
        svb.get_by_role("link", name="打开四阶课堂 · 硅谷银行挤兑").press("Enter")
        expect(page.get_by_role("heading", level=1)).to_have_text("银行有资产，工资款为什么还没到账？")
        page.get_by_role("link", name="学习路径", exact=True).press("Enter")
        expect(page.get_by_role("article")).to_have_count(12)
        assert all(url.startswith(base + "/") for url in requests)

        if width == 1180:
            allow_legacy = True
            for case_id in cases:
                card = page.locator(f"#lesson-{case_id}")
                card.get_by_role("link", name="原课堂与进度", exact=True).click()
                expect(page).to_have_url(f"{origin}/learn/{case_id}?scene=intro")
                expect(page.get_by_role("heading", level=1)).to_have_text(opening(case_id))
                page.goto(base + "/")
            page.get_by_role("link", name="从双向拍卖开始").click()
            expect(page.get_by_role("heading", level=1)).to_have_text("你的报价会以什么价格成交？")
            page.goto(base + "/")
            page.get_by_role("link", name="实验笔记").click()
            expect(page).to_have_url(f"{base}/?view=notes")
            expect(page.get_by_role("heading", name="实验笔记")).to_be_visible()
            page.get_by_role("link", name="原版实验笔记与学习记录").click()
            expect(page).to_have_url(f"{origin}/notes")
            expect(page.get_by_role("heading", name="实验笔记")).to_be_visible()
            page.goto(base + "/")
            page.get_by_role("link", name="配置模型 API").press("Enter")
            expect(page).to_have_url(f"{origin}/#model-api")
            expect(page.get_by_label("API 密钥")).to_have_attribute("type", "password")
            page.goto(base + "/")
            page.get_by_role("link", name="复习", exact=True).press("Enter")
            expect(page).to_have_url(f"{origin}/review")
            expect(page.get_by_role("heading", name="复习", exact=True)).to_be_visible()
        assert not errors and not rejected, (errors, rejected)
        print(f"{engine} {width}px: offline map, concepts, and progressive classroom" +
              (", twelve existing classrooms and notes" if width == 1180 else ""))
        page.close()
    browser.close()
