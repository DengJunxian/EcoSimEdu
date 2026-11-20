import json
import os
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from shutil import copytree
from threading import Thread
from pathlib import Path

import pytest


@pytest.fixture
def chromium_options():
    options = {"headless": os.environ.get("CIVITAS_TEST_HEADED") != "1"}
    if executable := os.environ.get("CIVITAS_TEST_CHROMIUM"):
        return {**options, "executable_path": executable}
    return {**options, "channel": "chrome"}


@pytest.fixture
def launch_education_browser(chromium_options):
    def launch(playwright):
        if os.environ.get("CIVITAS_ED_WEBKIT") == "1":
            return playwright.webkit.launch(headless=chromium_options["headless"])
        return playwright.chromium.launch(**chromium_options)

    return launch


@pytest.fixture(scope="session")
def offline_classroom_app(request, tmp_path_factory):
    if not (directory := os.environ.get("CIVITAS_V3_PAGES_DIR")):
        yield request.getfixturevalue("local_app")
        return
    source = Path(directory)
    if not (source / "index.html").is_file():
        pytest.fail(f"Static classroom build not found at {source}")
    root = tmp_path_factory.mktemp("classroom-pages")
    copytree(source, root / "explore")

    class PagesHandler(SimpleHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

    handler = partial(PagesHandler, directory=root)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            worker.join(timeout=5)


def luminance(color):
    match = re.fullmatch(r"rgb\((\d+), (\d+), (\d+)\)", color)
    assert match, f"Expected an opaque RGB color, got {color}"
    channels = [int(channel) / 255 for channel in match.groups()]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return sum(channel * weight for channel, weight in zip(linear, (0.2126, 0.7152, 0.0722), strict=True))


@pytest.fixture
def audit_education():
    def audit(page, name, selector='[aria-label="课堂练习"]'):
        axe = os.environ.get("CIVITAS_ED_AXE")
        if not axe:
            return
        if not page.evaluate("Boolean(window.axe)"):
            page.add_script_tag(path=axe)
        report = page.evaluate("""async selector => {
            const scope = document.querySelector(selector);
            if (!scope) throw new Error("Missing audit scope " + selector);
            const result = await axe.run(scope, {runOnly: {type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"]}});
            const findings = rows => rows.map(row => ({id: row.id, impact: row.impact,
                nodes: row.nodes.map(node => ({target: node.target, summary: node.failureSummary}))}));
            return {version: axe.version, violations: findings(result.violations), manuals: findings(result.incomplete)};
        }""", selector)
        if name.startswith("emer-"):
            axis_colors = page.locator(selector).locator(".lesson-series text").evaluate_all("""labels =>
                labels.map(label => {
                    let ancestor = label.parentElement;
                    while (ancestor && getComputedStyle(ancestor).backgroundColor === "rgba(0, 0, 0, 0)") {
                        ancestor = ancestor.parentElement;
                    }
                    return {label: label.textContent, foreground: getComputedStyle(label).fill,
                        background: ancestor && getComputedStyle(ancestor).backgroundColor};
                })""")
            for axis in axis_colors:
                dark, light = sorted(luminance(axis[key]) for key in ("foreground", "background"))
                axis["ratio"] = round((light + 0.05) / (dark + 0.05), 4)
                assert axis["ratio"] >= 4.5, axis
            report["svg_axis_contrast"] = axis_colors
        if out := os.environ.get("CIVITAS_ED_PERFORMANCE"):
            Path(out, f"axe-{name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        assert not any(issue["impact"] in {"serious", "critical"} for issue in report["violations"]), report

    return audit
