from playwright.sync_api import expect, sync_playwright


def test_reload_reconciles_paid_run_without_starting_another(local_app, chromium_options):
    case_id = "information_cascade"
    run_id = "1d4e6d78-3ae9-45ed-8931-b42b37287e6f"
    expected = {"case_id": case_id, "run_id": run_id, "execution_status": "running"}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": 390, "height": 900})
        starts = []

        def route(r):
            url = r.request.url
            if url.endswith("/api/live"):
                r.fulfill(json={"available": True, "attempts_per_run": 2, "test_limits": {"USD": 100},
                                "providers": [{"provider": "openai", "model": "gpt-6-luna", "currency": "USD",
                                               "max_per_attempt": 0.5}]})
            elif url.endswith(f"/api/runs/{run_id}"):
                r.fulfill(json=expected)
            elif url.endswith(f"/api/runs/{run_id}/cancel"):
                expected["execution_status"] = "cancelled"
                r.fulfill(json=expected)
            elif url.endswith("/start"):
                starts.append(url)
                r.abort()
            else:
                r.continue_()
        page.route("**/*", route)
        page.goto(f"{local_app}/?case={case_id}")
        page.get_by_role("button", name="开始实验").click()
        page.get_by_role("radio", name="不确定", exact=True).check()
        page.get_by_role("button", name="选择行动").click()
        page.evaluate("([caseId, runId]) => localStorage.setItem('civitas/live/' + caseId, runId)", [case_id, run_id])
        page.reload()
        page.get_by_text("高级实验 · 模型决策", exact=True).click()
        expect(page.get_by_role("button", name="等待高级实验…")).to_be_disabled()
        page.get_by_role("button", name="取消", exact=True).click()
        expect(page.get_by_text("实验已取消。")).to_be_visible()
        expect(page.get_by_role("button", name="运行高级实验")).to_be_enabled()
        assert not starts
        browser.close()


def test_model_lab_reads_local_capability_and_preserves_offline_access(local_app, chromium_options):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**chromium_options)
        page = browser.new_page(viewport={"width": 320, "height": 900})
        posts = []
        page.on("request", lambda request: posts.append(request.url) if request.method == "POST" else None)
        page.goto(local_app)
        page.get_by_role("link", name="模型实验").click()
        expect(page.get_by_role("heading", name="模型实验")).to_be_visible()
        expect(page.get_by_role("combobox", name="案例").locator("option")).to_have_count(4)
        expect(page.get_by_text("本机尚未启用模型服务。", exact=False)).to_be_visible()
        expect(page.get_by_role("button", name="运行高级实验")).to_have_count(0)
        case_picker = page.get_by_role("combobox", name="案例")
        case_picker.focus()
        case_picker.select_option("public_goods")
        expect(case_picker).to_be_focused()
        page.reload()
        expect(page.get_by_role("combobox", name="案例")).to_have_value("public_goods")
        expect(page.get_by_role("combobox").last.locator("option")).to_have_count(3)
        assert page.locator("body").evaluate("(el) => el.scrollWidth <= innerWidth")
        page.get_by_role("link", name="返回课程").click()
        expect(page.get_by_role("button", name="开始实验")).to_be_visible()
        assert not posts
        browser.close()
