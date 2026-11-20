import os

from playwright.sync_api import expect, sync_playwright


def test_first_relocation_tutor_uses_visible_evidence_and_survives_offline(local_app, launch_education_browser):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        for width, action, seq, ratio in ((390, "搬到标记的空格", 1, "5/7 变为 3/7"), (1440, "留在原地", 2, "1/6 变为 3/6")):
            profile = browser.new_context(viewport={"width": width, "height": 850})
            profile.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/")
                          else route.abort())
            page = profile.new_page()
            calls = []
            page.on("request", lambda req: calls.append(req.post_data_json)
                    if req.url.endswith("/api/ai/tutor/stream") else None)
            page.goto(local_app + "/explore/?lesson=schelling_segregation")
            page.get_by_role("button", name=action, exact=True).press("Enter")
            page.locator("fieldset.decision-card").get_by_role("button").first.press("Enter")
            page.get_by_role("button", name="观察个体决策").press("Enter")
            tutor = page.locator("details.relocation-tutor")
            expect(tutor).to_have_count(0)
            for tick in range(seq):
                page.get_by_role("button", name="单步前进").press("Enter")
                if tick < seq - 1:
                    expect(tutor).to_have_count(0)
            expect(page.get_by_label("这次搬迁和全局变化")).to_contain_text(f"事件 {seq}")
            tutor.get_by_text("讲解这次搬迁", exact=True).press("Enter")
            button = tutor.get_by_role("button", name="请求 AI 讲解")
            assert not calls
            button.press("Enter")
            expect(tutor.get_by_role("status").filter(has_text="作者讲解 · 当前没有有效的模型连接。")).to_be_visible()
            assert len(calls) == 1 and calls[0]["event_seq"] == seq and calls[0]["confirm"] is True
            assert "grid" not in calls[0] and "prediction" not in calls[0]
            expect(tutor.locator("ol li").first).to_contain_text(ratio)
            if width == 390 and (output := os.environ.get("CIVITAS_RELOCATION_TUTOR_SCREENSHOT")):
                tutor.scroll_into_view_if_needed()
                tutor.screenshot(path=output)
            assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
            tutor.get_by_role("button", name=f"核对搬迁前 · 事件 {seq - 1}").press("Enter")
            expect(tutor).to_have_count(0)
            bar = page.get_by_role("region", name="共用回放控制")
            expect(bar).to_contain_text(f"事件 {seq - 1} · 已暂停")
            expect(bar.locator("p[tabindex]")).to_be_focused()
            page.get_by_role("button", name="单步前进").press("Enter")
            tutor.get_by_text("讲解这次搬迁", exact=True).press("Enter")
            page.route("**/api/ai/tutor/stream", lambda route: route.abort())
            button.press("Enter")
            expect(tutor.get_by_role("status")).to_contain_text("可以继续使用上方的原事件和作者讲解")
            expect(page.get_by_label("这次搬迁和全局变化")).to_be_visible()
            profile.close()
        browser.close()


def test_later_tutor_follows_focus_after_rewind_resume_and_perspective(local_app, launch_education_browser):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        page = browser.new_page(viewport={"width": 390, "height": 850})
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/")
                   else route.abort())
        requests = []
        page.on("request", lambda request: requests.append((request.url.rsplit("/", 1)[-1], request.post_data_json))
                if "/api/ai/tutor" in request.url else None)
        page.goto(local_app + "/explore/?lesson=schelling_segregation")
        page.get_by_role("button", name="搬到标记的空格", exact=True).press("Enter")
        page.locator("fieldset.decision-card").get_by_role("button").first.press("Enter")
        page.get_by_role("button", name="观察个体决策").press("Enter")
        page.get_by_role("button", name="查看 A001").press("Enter")
        step = page.get_by_role("button", name="单步前进")
        step.press("Enter")
        page.get_by_role("button", name="观察群体变化").press("Enter")
        bar = page.get_by_role("region", name="共用回放控制")
        expect(bar).to_contain_text("事件 0 · 已暂停")
        tutor = page.locator("details.relocation-tutor")
        expect(tutor).to_have_count(0)
        for _ in range(3):
            step.press("Enter")
        expect(bar).to_contain_text("事件 3 · 已暂停")
        assert not requests

        def ask(seq, question=None):
            tutor.locator("summary").press("Enter")
            if question:
                tutor.get_by_role("combobox", name="讲解方式").select_option("question")
                tutor.get_by_role("textbox", name="关于当前材料的问题").fill(question)
            tutor.get_by_role("button", name="请求 AI 讲解").press("Enter")
            expect(tutor.get_by_role("status").filter(has_text="作者讲解 · 当前没有有效的模型连接。")).to_be_visible()
            expect(tutor.get_by_role("link", name=f"核对本次搬迁 · 事件 {seq}")).to_be_visible()
            scope, query = requests[-2:]
            assert scope[0] == "scope" and query[0] == "stream"
            assert scope[1]["event_seq"] == query[1]["event_seq"] == seq
            assert scope[1]["stage"] == 3 and scope[1]["perspective"] == "system"
            assert "revealed_until" not in scope[1] and query[1]["grant"]

        ask(3, "这户为什么搬家？")
        expect(tutor.locator("ol")).to_contain_text("在原址低于 30% 阈值")
        tutor.get_by_role("button", name="核对搬迁前 · 事件 2").press("Enter")
        expect(bar).to_contain_text("事件 2 · 已暂停")
        expect(bar.locator("p[tabindex]")).to_be_focused()
        expect(tutor.locator("ol")).not_to_be_visible()
        ask(2)
        saved = page.evaluate("Object.entries(localStorage).find(([key]) => key.endsWith(':schelling_segregation'))?.[1]")
        page.reload()
        expect(bar).to_contain_text("事件 2 · 已暂停")
        expect(tutor.locator("ol")).not_to_be_visible()
        ask(2)
        assert page.evaluate("Object.entries(localStorage).find(([key]) => key.endsWith(':schelling_segregation'))?.[1]") == saved

        page.locator("#microscope summary").press("Enter")
        page.get_by_role("radio", name="我的角色").check()
        expect(tutor).to_have_count(0)
        assert len(requests) == 6
        page.get_by_role("radio", name="系统观察者").check()
        expect(tutor).to_have_count(1)
        expect(tutor.locator("ol")).not_to_be_visible()

        held = []
        page.route("**/api/ai/tutor/scope", lambda route: held.append(route))
        tutor.locator("summary").press("Enter")
        with page.expect_request("**/api/ai/tutor/scope"):
            tutor.get_by_role("button", name="请求 AI 讲解").press("Enter")
        expect(tutor.get_by_role("status")).to_contain_text("正在核对事件")
        step.press("Enter")
        expect(bar).to_contain_text("事件 3 · 已暂停")
        expect(tutor.locator("ol")).not_to_be_visible()
        assert len(held) == 1 and [name for name, _ in requests].count("stream") == 3
        browser.close()


def test_schelling_story_and_counterfactual_tutor_follow_learning_stage(local_app, launch_education_browser):
    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        page = browser.new_page(viewport={"width": 390, "height": 850})
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(local_app + "/")
                   else route.abort())
        calls = []
        page.on("request", lambda request: calls.append(request.post_data_json)
                if request.url.endswith("/api/ai/tutor/stream") else None)
        page.goto(local_app + "/explore/?lesson=schelling_segregation")
        story = page.locator("details.story-tutor")
        pair = page.locator("details.pair-tutor")
        expect(story).to_have_count(1)
        expect(pair).to_have_count(0)
        assert not calls

        def ask(tutor, stage, question=None):
            tutor.locator("summary").click()
            if question:
                tutor.get_by_role("combobox", name="讲解方式").select_option("question")
                tutor.get_by_role("textbox", name="关于当前材料的问题").fill(question)
            tutor.get_by_role("button", name="请求 AI 讲解").press("Enter")
            expect(tutor.get_by_role("status").filter(has_text="作者讲解 · 当前没有有效的模型连接。")).to_be_visible()
            assert calls[-1]["stage"] == stage and "prediction" not in calls[-1]

        ask(story, 1)
        expect(story.locator("ol")).to_contain_text("居民 A001")
        assert "run_id" not in calls[-1] and "event_seq" not in calls[-1]
        story.get_by_role("link", name="核对案例资料与模型假设").press("Enter")
        expect(page.locator("#opening-case-materials")).to_have_attribute("open", "")
        if output := os.environ.get("CIVITAS_STORY_TUTOR_SCREENSHOT"):
            story.screenshot(path=output)

        page.get_by_role("button", name="搬到标记的空格", exact=True).press("Enter")
        page.locator("fieldset.decision-card").get_by_role("button").first.press("Enter")
        page.get_by_role("button", name="观察个体决策").press("Enter")
        expect(story).to_have_count(0)
        page.get_by_role("button", name="查看 A001").press("Enter")
        page.get_by_role("button", name="单步前进").press("Enter")
        page.get_by_role("button", name="观察群体变化").press("Enter")
        page.get_by_role("button", name="查看运行收尾").press("Enter")
        page.get_by_role("button", name="试一项政策").press("Enter")
        panel = page.get_by_role("region", name="预测后运行")
        run = panel.get_by_role("button", name="运行并验证")
        expect(pair).to_have_count(0)
        panel.get_by_role("slider").fill("50")
        expect(run).to_be_disabled()
        panel.get_by_role("radio", name="增加", exact=True).check()
        expect(pair).to_have_count(0)
        run.press("Enter")
        expect(pair).to_have_count(1)
        ask(pair, 4)
        expect(pair.locator("ol")).to_contain_text("84.55% 变为 92.71%")
        focus = calls[-1]
        assert focus["run_id"].endswith("|move|baseline") and focus["comparison_run_id"].endswith("|move|higher")
        for side, label, seq in (("baseline", "基线", focus["event_seq"]),
                                 ("comparison", "干预", focus["comparison_event_seq"])):
            pair.get_by_role("link", name=f"核对{label}收尾 · 事件 {seq}").press("Enter")
            expect(page.locator(f"#schelling-{side}-close")).to_contain_text(f"事件 {seq}")
            assert page.evaluate("location.hash") == f"#schelling-{side}-close"
        if output := os.environ.get("CIVITAS_PAIR_TUTOR_SCREENSHOT"):
            pair.screenshot(path=output)
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")

        page.reload()
        expect(panel.get_by_role("radio", name="增加", exact=True)).to_be_checked()
        expect(pair.locator("ol")).not_to_be_visible()
        ask(pair, 4)
        assert calls[-1]["comparison_digest"] == focus["comparison_digest"]
        panel.get_by_role("button", name="再做一组对照").press("Enter")
        expect(pair).to_have_count(0)
        panel.get_by_role("radio", name="最低比例 0%", exact=True).check()
        expect(run).to_be_disabled()
        panel.get_by_role("radio", name="减少", exact=True).check()
        run.press("Enter")
        ask(pair, 4, "干预组为什么停止？")
        expect(pair.locator("ol")).to_contain_text("干预组全体居民达标")
        assert calls[-1]["comparison_run_id"].endswith("|move|zero")
        assert calls[-1]["comparison_digest"] != focus["comparison_digest"]
        browser.close()


def test_free_question_uses_current_material_and_recovers_from_a_broken_stream(local_app, launch_education_browser):
    import json

    with sync_playwright() as playwright:
        browser = launch_education_browser(playwright)
        page = browser.new_page(viewport={"width": 390, "height": 850})
        page.goto(local_app + "/explore/?lesson=schelling_segregation")
        tutor = page.locator("details.story-tutor")
        tutor.locator("summary").click()
        tutor.get_by_role("combobox", name="讲解方式").select_option("question")
        question = tutor.get_by_role("textbox", name="关于当前材料的问题")
        send = tutor.get_by_role("button", name="请求 AI 讲解")
        expect(send).to_be_disabled()
        question.fill("空格需要计入邻居比例吗？")
        expect(send).to_be_enabled()
        with page.expect_response("**/api/ai/tutor/stream") as stream:
            send.press("Enter")
        assert stream.value.headers["content-type"].startswith("application/x-ndjson")
        expect(tutor.locator("ol li")).to_have_count(2)
        expect(tutor.locator("ol")).to_contain_text("开局阈值")
        question.fill("最后全图同组邻接比例是多少？")
        send.press("Enter")
        expect(tutor.get_by_role("status")).to_contain_text("当前材料不足以回答这个问题")
        expect(tutor.locator("ol")).to_have_count(0)
        expect(tutor.get_by_text("现在可以问", exact=False)).to_be_visible()

        question.fill("我的角色是谁？")
        path = "**/api/ai/tutor/stream"
        send.press("Enter")
        expect(tutor.locator("ol")).to_contain_text("居民 A001")
        expect(send).to_be_enabled()

        def incomplete(route):
            actual = route.fetch().text()
            events = [json.loads(line) for line in actual.splitlines()]
            assert events[-1]["type"] == "done"
            route.fulfill(status=200, content_type="application/x-ndjson",
                          body="\n".join(json.dumps(event) for event in events[:-1]) + "\n")

        page.route(path, incomplete)
        send.press("Enter")
        expect(tutor.get_by_role("status")).to_contain_text("可以继续使用本页的故事与模型规则")
        expect(tutor.locator("ol")).to_have_count(0)
        expect(question).to_have_value("我的角色是谁？")
        page.unroute(path)
        held = []
        page.route(path, lambda route: held.append(route))
        with page.expect_request(path):
            send.press("Enter")
        stop = tutor.get_by_role("button", name="停止接收")
        stop.press("Enter")
        expect(send).to_be_focused()
        expect(tutor.get_by_role("status")).to_contain_text("已停止接收讲解")
        assert page.evaluate("Object.values(localStorage).every(value => !value.includes('我的角色是谁'))")
        if output := os.environ.get("CIVITAS_STUDY_QUESTION_SCREENSHOT"):
            tutor.screenshot(path=output)
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
        assert len(held) == 1
        browser.close()
