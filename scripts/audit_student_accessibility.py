"""Scan the three core learning paths in an offline Chrome profile."""
from argparse import ArgumentParser
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from scripts.benchmark_student_lab import local_server
from services.simulation.lessons import load_case

RULES = {"type": "tag", "values": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]}


def audit(axe, channel, widths):
    with TemporaryDirectory(prefix="civitas-a11y-") as tmp, \
            local_server(Path(tmp) / "audit.sqlite") as (url, _, _), sync_playwright() as p:
        browser = p.chromium.launch(channel=channel)
        records = []
        axe_version = None
        for width in widths:
            for case_id in ("double_auction", "schelling_segregation", "svb_run"):
                course = load_case(case_id)
                context = browser.new_context(viewport={"width": width, "height": 900})
                context.route("**/*", lambda route: route.continue_()
                              if route.request.url.startswith(url + "/") else route.abort())
                page = context.new_page()
                page.add_init_script(path=axe)
                page.goto(f"{url}/?case={case_id}")

                def button(name):
                    return page.get_by_role("button", name=name, exact=True).first

                def scan(stage):
                    result = page.evaluate("rules => axe.run({runOnly: rules})", RULES)
                    issues = [{key: row[key] for key in ("id", "impact")} |
                              {"nodes": [{"target": node["target"], "summary": node["failureSummary"]}
                                         for node in row["nodes"]]} for row in result["violations"]]
                    records.append({"case": case_id, "width": width, "stage": stage, "violations": issues,
                                    "manual_review_rules": [row["id"] for row in result["incomplete"]],
                                    "horizontal_overflow": page.evaluate(
                                        "document.documentElement.scrollWidth > window.innerWidth")})

                auction = case_id == "double_auction"
                button("开始实验").wait_for()
                axe_version = page.evaluate("axe.version")
                scan("intro")
                button("开始实验").click()
                page.get_by_role("radio", name=course["questions"]["prediction"]["options"]["unknown"], exact=True).check()
                scan("prediction")
                button("去报价" if auction else "选择行动").click()
                button("运行实验").wait_for()
                scan("action")
                if case_id == "schelling_segregation":
                    page.get_by_text("按行列选格", exact=True).click()
                    scan("action_coordinates")
                button("运行实验").click()
                for _ in range(2):
                    button("跳到下一笔成交" if auction else "跳到下一条证据").click()
                    button("引用此笔成交" if auction else "引用此事件").click()
                scan("observation")
                page.get_by_text("查看成交价格表" if auction else "查看指标数据", exact=True).click()
                scan("observation_data_table")
                button("揭示全市场价值" if auction else "解释结果").click()
                button("比较反事实").wait_for()
                question = course["questions"]["explain"]
                page.get_by_role("radio", name=question["options"][question["answer"]], exact=True).check()
                scan("explanation")
                button("比较反事实").click()
                for scenario in course["scenarios"][1:]:
                    button("运行对照").click()
                    expect(page.get_by_role("row", name=scenario["label"], exact=False)).not_to_contain_text("待运行")
                scan("comparison")
                button("写实验笔记").click()
                button("完成学习").wait_for()
                scan("notes")
                context.close()
        return {"browser": channel, "version": browser.version, "axe": axe_version, "records": records}


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--axe", type=Path, required=True)
    parser.add_argument("--channel", default="chrome")
    parser.add_argument("--width", type=int, nargs="+", default=[1440, 1280, 768, 390])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.axe, args.channel, args.width)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    records = report["records"]
    print(f"{len(records)} scans, {sum(bool(row['violations']) for row in records)} with violations, "
          f"{sum(row['horizontal_overflow'] for row in records)} with viewport overflow")
