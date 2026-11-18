"""Drive a running Orca and headed Chromium on the same isolated X session."""
from argparse import ArgumentParser
import json
from pathlib import Path
from subprocess import check_call, check_output
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

from scripts.benchmark_student_lab import call, local_server
from services.simulation.lesson_scenes import load_lesson_scenes
from services.simulation.lessons import load_case


def key(*keys):
    check_call(["xdotool", "key", "--clearmodifiers", "--delay", "100", *keys])


def open_run(page, url, case_id):
    case = load_case(case_id)
    request = {"case_id": case_id, "request_id": str(uuid4()), "scenario_id": "baseline",
               "provider_kind": "rule", "seed": case["seed"]}
    request.update({"bid": case["preset_bid"]} if case_id == "double_auction"
                   else {"action": case["action"]["default"]})
    run_id = call(url, "/api/runs", request)["run_id"]
    result = call(url, f"/api/runs/{run_id}/start", {})["result"]
    return f"{url}/?case={case_id}&run={run_id}", result


def audit_education(page, url, navigate, observe, focus):
    task = page.get_by_role("region", name="课堂练习")

    def button(label):
        return page.get_by_role("button", name=label, exact=True)

    navigate(url + "/learn/double_auction", button("领取买家身份"))
    button("领取买家身份").click()
    page.get_by_role("radio", name="不确定", exact=True).check()
    button("去报价").click()
    page.get_by_label("开局限价").fill("1")
    page.get_by_role("checkbox", name="我接受这笔单会留到成交或收盘").check()
    button("提交开局报价").click()
    button("快进到收盘").click()
    button("进入剩余解释").click()
    seller = task.get_by_role("spinbutton", name="卖方剩余（代币）")
    platform = task.get_by_role("spinbutton", name="平台收入（代币）")
    observe("auction_amount_label", lambda: focus(seller), ["卖方剩余", "代币"])
    observe("auction_tab_amount", lambda: key("Tab"), ["平台收入", "代币"])
    expect(platform).to_be_focused()
    seller.fill("12")
    platform.fill("2")
    focus(button("提交作答"))
    observe("auction_wrong_answer", lambda: key("Return"), ["再核对这一步"])
    expect(task.get_by_text("再核对这一步", exact=True)).to_be_visible()
    focus(button("看完整例题"))
    observe("auction_example_focus", lambda: key("Return"), ["看一个完整例题"])
    expect(task.get_by_role("heading", name="看一个完整例题")).to_be_focused()
    focus(button("返回原题"))
    observe("auction_return_focus", lambda: key("Return"), ["练习 heading"])
    expect(task.get_by_role("heading", name="练习", exact=True)).to_be_focused()

    for case, name, amount, wrong, phrase in [
        ("svb_run", "现金（资金单位）", "15", ["55", "18"], "现金"),
        ("schelling_segregation", "已占邻居数（人）", "8", ["60"], "已占邻居数"),
    ]:
        scenes = load_lesson_scenes(case)["scenes"]
        question = next(item for item in scenes[1]["questions"] if item.get("kind") == "prediction")
        uncertain = next(item["label"] for item in question["options"] if item["id"] == "unknown")
        navigate(f"{url}/learn/{case}", button("开始学习"))
        button("开始学习").click()
        page.get_by_role("group", name=question["prompt"], exact=True).get_by_role(
            "radio", name=uncertain, exact=True).check()
        button("选择行动").click()
        button("运行基础实验").click()
        button("快进到结束").click()
        button("进入解释").click()
        inputs = task.get_by_role("spinbutton")
        observe(f"{case}_amount_label", lambda: focus(task.get_by_role("spinbutton", name=name)), [phrase])
        for index, value in enumerate([amount, *wrong]):
            inputs.nth(index).fill(value)
        focus(button("提交作答"))
        observe(f"{case}_wrong_answer", lambda: key("Return"), ["再核对这一步"])
        expect(task.get_by_text("再核对这一步", exact=True)).to_be_visible()

    teaching = page.get_by_role("heading", name="双向拍卖教学活动")
    observe("teaching_title", lambda: navigate(url + "/teach?case=double_auction", teaching), ["双向拍卖教学活动 · EcoSimEdu"])
    observe("teaching_demo_link", lambda: focus(page.get_by_role("link", name="打开隔离展示课堂")), ["打开隔离展示课堂"])


def audit(log, executable, education=False):
    with TemporaryDirectory(prefix="civitas-orca-") as tmp, \
            local_server(Path(tmp) / "runs.sqlite3") as (url, _, _), sync_playwright() as p:
        browser = p.chromium.launch(executable_path=executable, headless=False,
                                    args=["--force-renderer-accessibility"])
        context = browser.new_context(viewport={"width": 390, "height": 850})
        context.route("**/*", lambda route: route.continue_()
                      if route.request.url.startswith(url + "/") else route.abort())
        page = context.new_page()
        records = []

        def observe(name, action, expected):
            with log.open("rb", buffering=0) as speech:
                start = speech.seek(0, 2)
                action()
                deadline = monotonic() + 8
                while monotonic() < deadline:
                    speech.seek(start)
                    pending = speech.read().decode("utf-8", errors="replace")
                    utterances = []
                    # The Orca debug entry records speech handed to its speech backend.
                    for line in pending.splitlines():
                        if "SPEECH OUTPUT:" in line:
                            utterances.append(line.split("SPEECH OUTPUT:", 1)[1].split(" {'established'", 1)[0].strip())
                    text = " ".join(utterances)
                    if all(phrase in text for phrase in expected):
                        break
                    sleep(0.1)
                records.append({"task": name, "required_phrases": expected, "spoken": utterances,
                                "passed": all(phrase in text for phrase in expected)})

        def navigate(address, ready):
            page.goto(address)
            ready.wait_for()
            page.bring_to_front()
            window = check_output(["xdotool", "search", "--onlyvisible", "--name", "Civitas Economica"],
                                  text=True, timeout=5).splitlines()[-1]
            check_call(["xdotool", "windowactivate", "--sync", window], timeout=5)
            sleep(0.8)

        def focus(locator):
            locator.focus()
            expect(locator).to_be_focused()
            sleep(0.25)

        if education:
            audit_education(page, url, navigate, observe, focus)
            version = browser.version
            browser.close()
            return {"browser": version, "scope": "education-upgrade", "viewport_width": 390, "observations": records}

        address, result = open_run(page, url, "svb_run")
        end = len(result["snapshots"]) - 1
        slider = page.get_by_role("slider", name="事件时间轴")
        observe("svb_title", lambda: navigate(address + f"&tick={end - 2}", slider), ["硅谷银行挤兑", "实验回放"])
        observe("svb_timeline", lambda: focus(slider), ["事件时间轴", f"事件 {end - 2}"])
        observe("svb_timeline_right", lambda: key("Right"), [f"事件 {end - 1}"])
        expect(slider).to_have_value(str(end - 1))
        next_step = page.get_by_role("button", name="下一步", exact=True)
        observe("svb_next", lambda: focus(next_step), ["下一步"])
        key("Return")
        expect(next_step).to_be_disabled()
        expect(next_step).to_be_focused()
        expect(slider).to_have_value(str(end))
        observe("svb_boundary", lambda: key("KP_Enter"), ["下一步", "grayed"])

        address, result = open_run(page, url, "schelling_segregation")
        toggle = page.get_by_text("按行列选格", exact=True)
        navigate(address + "&tick=0", toggle)
        focus(toggle)
        key("Return")
        row = page.get_by_role("combobox", name="行", exact=True)
        column = page.get_by_role("combobox", name="列", exact=True)
        observe("schelling_row", lambda: focus(row), ["行"])
        key("Insert+a", "Insert+a")
        key("space", "Home", "Down", "Return")
        expect(row).to_have_value("1")
        observe("schelling_column", lambda: focus(column), ["列"])
        grid = result["snapshots"][0]["grid"]
        resident = grid["cells"][grid["size"] + 1] or "空位"
        observe("schelling_coordinates_changed", lambda: key("space", "Home", "Down", "Return"),
                [resident, "第 2 行第 2 列"])
        expect(column).to_have_value("1")

        address, result = open_run(page, url, "double_auction")
        trades = [event for event in result["events"] if event["event_type"] == "trade"]
        event = trades[-1]
        toggle = page.get_by_text("查看成交价格表", exact=True)
        navigate(address + f"&tick={event['tick']}", toggle)
        focus(toggle)
        key("Return")
        table = page.get_by_role("table", name="已播放成交价格（代币 / 件）")
        expect(table).to_be_visible()
        key("Insert+a", "Insert+a", "Insert+a")
        observe("auction_table", lambda: key("t"), ["已播放成交价格"])
        observe("auction_table_value", lambda: key("alt+shift+End"),
                [f"事件 {event['seq']}", "价格", str(event["price"])])
        first = trades[0]["seq"]
        entry = table.get_by_role("button", name=f"事件 {first}", exact=True)
        focus(entry)
        key("Return")
        expect(page.get_by_role("slider", name="事件时间轴")).to_have_value(str(first))
        browser.close()
        return {"browser": browser.version, "viewport_width": 390, "observations": records}


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--speech-log", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    parser.add_argument("--education", action="store_true", help="Walk the upgraded classroom and teaching page.")
    args = parser.parse_args()
    report = audit(args.speech_log, args.chromium, args.education)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if not all(row["passed"] for row in report["observations"]):
        raise SystemExit(1)
