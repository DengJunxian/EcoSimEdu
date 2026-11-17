"""Measure browser and API latency on an isolated SQLite database."""
from argparse import ArgumentParser
from contextlib import closing, contextmanager
from gzip import compress
import json
from math import ceil
import os
from pathlib import Path
from platform import machine, platform
from socket import socket
import sqlite3
from statistics import median
from subprocess import DEVNULL, PIPE, Popen, TimeoutExpired, check_output
from sys import executable
from tempfile import TemporaryDirectory
from time import perf_counter, sleep
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

from services.simulation.api import CANONICAL_RESULT_PREFIX, EVENT_CACHE_BYTES, encode_result
from services.simulation.auction import CASE, digest, run_auction
from services.simulation.lessons import CATALOG, load_case, simulate

SAMPLES = 30


def distribution(numbers):
    ordered = sorted(numbers)
    return {"n": len(ordered), "p50_ms": round(median(ordered), 3),
            "p95_ms": round(ordered[ceil(.95 * len(ordered)) - 1], 3)}


def milliseconds(start):
    return (perf_counter() - start) * 1000


def call(url, path, data=None):
    req = Request(url + path, data=None if data is None else json.dumps(data).encode(),
                  headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=20) as response:
        return json.load(response)


@contextmanager
def local_server(db):
    env = {k: v for k, v in os.environ.items() if k not in {"CIVITAS_LIVE_ENABLED", "OPENAI_API_KEY", "DEEPSEEK_API_KEY"}}
    env["CIVITAS_EDU_DB"] = str(db)
    with socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = str(listener.getsockname()[1])
    url = "http://127.0.0.1:" + port
    start = perf_counter()
    server = Popen([executable, "-m", "uvicorn", "services.simulation.api:app", "--host", "127.0.0.1",
                    "--port", port, "--no-access-log"], env=env, stdout=DEVNULL, stderr=PIPE)
    try:
        while server.poll() is None and milliseconds(start) < 6000:
            try:
                if call(url, "/api/health")["status"] == "ready":
                    break
            except OSError:
                sleep(.02)
        else:
            raise RuntimeError("Isolated lab failed its health check")
        yield url, server.pid, round(milliseconds(start), 3)
    finally:
        server.terminate()
        try:
            server.wait(5)
        except TimeoutExpired:
            server.kill()
            server.wait()


def fixture(db, ticks, agents_per_frame):
    identifier = str(uuid4())
    entities = {f"A{index}": {"cash": index, "groups": index % 4} for index in range(agents_per_frame)}
    result = {
        "events": [{"seq": index, "tick": index, "event_type": "benchmark"} for index in range(ticks)],
        "snapshots": [{"tick": index, "metrics": {"score": index % 97}, "entities": entities}
                      for index in range(ticks)],
    }
    stored = json.dumps({"case_version": "benchmark", "result_hash": digest(result), "result": result})
    with closing(sqlite3.connect(db)) as conn, conn:
        conn.execute("INSERT INTO runs VALUES (?, ?, 'completed', ?)",
                     (identifier, json.dumps({"case_id": "benchmark", "provider_kind": "rule"}), stored))
    return identifier, len(stored)


def seek_benchmark(url, run_id, end):
    paths = [f"/api/runs/{run_id}/snapshots/{(i * 997 + 2) % end}" for i in range(SAMPLES)]
    times = []
    for path in paths:
        start = perf_counter()
        frame = call(url, path)
        assert frame["tick"] == int(path.split("/")[-1])
        times.append(milliseconds(start))
    return distribution(times)


def browser_benchmark(url, run):
    cold, warm, move, filters = [], [], [], []
    with sync_playwright() as client:
        browser = client.chromium.launch(channel="chrome")
        for _ in range(SAMPLES):
            context = browser.new_context(viewport={"width": 1440, "height": 960})
            context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(url + "/") else route.abort())
            page = context.new_page()
            start = perf_counter()
            page.goto(url, wait_until="domcontentloaded")
            page.get_by_role("button", name="开始实验").wait_for(state="visible")
            cold.append(milliseconds(start))
            context.close()
        context = browser.new_context(viewport={"width": 1440, "height": 960})
        page = context.new_page()
        for _ in range(SAMPLES):
            start = perf_counter()
            page.goto(url + "/?case=beer_game", wait_until="domcontentloaded")
            page.get_by_role("button", name="开始实验").wait_for(state="visible")
            warm.append(milliseconds(start))
        page.goto(url)
        search = page.get_by_role("searchbox", name="搜索课程")
        for _ in range(SAMPLES):
            search.fill("")
            expect(page.get_by_role("navigation", name="课程目录").get_by_role("link")).to_have_count(12)
            start = perf_counter()
            search.fill("啤酒")
            expect(page.get_by_role("navigation", name="课程目录").get_by_role("link")).to_have_count(1)
            filters.append(milliseconds(start))
        page.goto(f"{url}/?case=flash_crash&run={run['run_id']}&tick=0")
        slider = page.get_by_role("slider")
        slider.wait_for()
        for i in range(SAMPLES):
            start = perf_counter()
            slider.press("ArrowRight")
            page.get_by_role("heading", name=f"事件 {i + 1}", exact=True).wait_for(state="visible")
            move.append(milliseconds(start))
        cdp = context.new_cdp_session(page)
        cdp.send("Performance.enable")
        metrics = {metric["name"]: metric["value"] for metric in cdp.send("Performance.getMetrics")["metrics"]}
        return {"chrome": browser.version, "cold_profile_first_interactive": distribution(cold),
                "warm_case_first_interactive": distribution(warm),
                "event_keyboard_feedback": distribution(move), "catalog_filter": distribution(filters),
                "trace_js_heap_bytes": int(metrics["JSHeapUsedSize"])}


def data_benchmark():
    sizes = []
    for key in CATALOG:
        case = load_case(key)
        for scenario in case["scenarios"]:
            if key == CASE["case_id"]:
                result = run_auction(scenario["id"], case["seed"], case["preset_bid"])
            else:
                result = simulate(case, scenario["id"], case["seed"], case["action"]["default"])
            encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()
            sizes.append({"case_id": key, "scenario_id": scenario["id"], "events": len(result["events"]),
                          "gzip_bytes": len(compress(encoded, mtime=0))})
    return {"default_trajectories": len(sizes), "largest_gzip": max(sizes, key=lambda size: size["gzip_bytes"]),
            "total_gzip_bytes": sum(size["gzip_bytes"] for size in sizes)}


def combined_benchmark(url, db, oversized=False):
    case = load_case("svb_run")
    identifier = str(uuid4())
    actors = {f"P{i:03}": {"balance": i + 1} for i in range(500)}
    relations = [{"from": actor, "to": f"P{(i + step) % 500:03}", "label": "合成关系"}
                 for i, actor in enumerate(actors) for step in range(1, 11)]
    frames = [{"tick": tick, "metrics": {case["metrics"][0]["id"]: tick}, "entities": actors,
               "relations": relations if tick == 150 else []} for tick in range(300)]
    events = [{"seq": seq, "tick": seq if seq < 300 else seq % 300, "event_type": "benchmark",
               "summary": "组合压力测试的合成事件"} for seq in range(100_000)]
    if oversized:
        for event in events:
            event["synthetic_payload"] = "synthetic event payload " * 8
    result = {"snapshots": frames, "events": events}
    result_hash = digest(result)
    request = {"case_id": case["case_id"], "case_version": case["version"],
               "provider_kind": "rule", "scenario_id": "baseline"}
    encoded = encode_result(case["version"], "offline_simulation", result)
    stored_bytes = len(encoded.encode())
    peer_id = str(uuid4())
    if oversized:
        assert stored_bytes > EVENT_CACHE_BYTES and encoded.encode().startswith(CANONICAL_RESULT_PREFIX)
    with closing(sqlite3.connect(db)) as conn, conn:
        conn.execute("INSERT INTO runs VALUES (?, ?, 'completed', ?)",
                     (identifier, json.dumps(request), encoded))
        if oversized:
            # Only envelope bytes differ. Alternating rows forces a miss in the one-entry verification cache.
            peer = encode_result(case["version"], "precomputed_simulation", result)
            conn.execute("INSERT INTO runs VALUES (?, ?, 'completed', ?)",
                         (peer_id, json.dumps(request), peer))
    event_positions = [i * (len(events) - 1) // (SAMPLES - 1) for i in range(SAMPLES)]
    start = perf_counter()
    first = call(url, f"/api/runs/{identifier}/events/99999")
    cold_event_ms = milliseconds(start)
    assert first["event"] == events[-1]
    event_times, response_bytes = [], []
    for seq in event_positions:
        start = perf_counter()
        with urlopen(f"{url}/api/runs/{identifier}/events/{seq}", timeout=20) as response:
            body = response.read()
        event = json.loads(body)
        assert event["event"] == events[seq] and event["event_count"] == 100_000
        assert event["result_hash"] == result_hash and event["snapshot_tick"] == events[seq]["tick"]
        event_times.append(milliseconds(start))
        response_bytes.append(len(body))
    for seq in (-1, len(events)):
        try:
            call(url, f"/api/runs/{identifier}/events/{seq}")
        except HTTPError as error:
            assert error.code == 404 and json.load(error)["detail"] == "EVENT_NOT_AVAILABLE"
        else:
            raise AssertionError("Out-of-range event was returned")
    seek = seek_benchmark(url, identifier, len(frames))
    cold = {}
    alternating = [peer_id if i % 2 == 0 else identifier for i in range(SAMPLES)]
    if oversized:
        for label in ("events", "snapshots"):
            elapsed = []
            for run, seq in zip(alternating, event_positions):
                index = seq if label == "events" else seq % len(frames)
                start = perf_counter()
                row = call(url, f"/api/runs/{run}/{label}/{index}")
                elapsed.append(milliseconds(start))
                expected = events[index] if label == "events" else frames[index]
                assert (row["event"] if label == "events" else row) == expected
            cold[f"cold_api_{label}"] = distribution(elapsed)
    frame = call(url, f"/api/runs/{identifier}/snapshots/150")
    assert len(frame["entities"]) == 500 and len(frame["relations"]) == 5000

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        page = browser.new_page()
        start = perf_counter()
        page.goto(f"{url}/?case=svb_run&run={identifier}&tick=150")
        slider = page.get_by_role("slider")
        slider.wait_for()
        initial = milliseconds(start)
        start = perf_counter()
        page.get_by_text("主体关系", exact=True).click()
        rows = page.get_by_role("list", name="当前事件的全部关系").get_by_role("listitem")
        rows.first.wait_for()
        open_ms = milliseconds(start)
        count = rows.count()
        assert count == len(relations)
        move, opens = [], []
        for _ in range(SAMPLES):
            slider.press("ArrowLeft")
            page.get_by_role("heading", name="事件 149", exact=True).wait_for()
            start = perf_counter()
            slider.press("ArrowRight")
            page.get_by_role("heading", name="事件 150", exact=True).wait_for()
            move.append(milliseconds(start))
            start = perf_counter()
            page.get_by_text("主体关系", exact=True).click()
            rows.last.wait_for()
            opens.append(milliseconds(start))
        browser_event_times, large_lookup = [], f"{url}/?case=svb_run&run={identifier}&event="
        full_run_requests = []
        page.on("request", lambda request: full_run_requests.append(request.url)
                if request.url in {f"{url}/api/runs/{identifier}", f"{url}/api/runs/{peer_id}"} else None)
        for seq in event_positions:
            start = perf_counter()
            page.goto(large_lookup + str(seq), wait_until="domcontentloaded")
            page.get_by_role("heading", name=f"事件 {seq}", exact=True).wait_for()
            browser_event_times.append(milliseconds(start))
        if oversized:
            elapsed = []
            for run, seq in zip(alternating, event_positions):
                start = perf_counter()
                page.goto(f"{url}/?case=svb_run&run={run}&event={seq}", wait_until="domcontentloaded")
                page.get_by_role("heading", name=f"事件 {seq}", exact=True).wait_for()
                elapsed.append(milliseconds(start))
            cold["cold_browser_event_link"] = distribution(elapsed)
        assert not full_run_requests
        expect(page.get_by_role("link", name="查看关联快照 99")).to_be_visible()
        expect(page.get_by_role("link", name="下一条事件")).to_have_count(0)
        return {"stored_bytes": stored_bytes, "agents_per_frame": len(actors), "frames": len(frames), "events_total": len(events),
                "events_beyond_one_per_frame": len(events) - len(frames), "relations_at_frame_150": len(relations),
                "event_sequence_samples": event_positions, "api_event_lookup": distribution(event_times),
                "first_api_event_lookup_ms": round(cold_event_ms, 3),
                "event_response_bytes_max": max(response_bytes),
                "browser_direct_event_link": distribution(browser_event_times),
                "browser_full_run_requests_on_event_links": len(full_run_requests),
                "api_seek": seek, "shared_trace_ready_ms": round(initial, 3),
                "initial_relations_open_ms": round(open_ms, 3), "browser_seek": distribution(move),
                "relationship_open": distribution(opens), "visible_relationship_rows_when_opened": count, **cold}


def measure(stress, combined=False, oversized=False):
    with TemporaryDirectory(prefix="civitas-bench-") as directory:
        db = Path(directory) / "bench.sqlite3"
        with local_server(db) as (url, pid, readiness_ms):
            case = load_case("flash_crash")
            start = perf_counter()
            stored = call(url, "/api/runs", {"case_id": case["case_id"], "request_id": str(uuid4()),
                          "provider_kind": "rule", "seed": case["seed"], "scenario_id": "baseline",
                          "action": case["action"]["default"]})
            run = call(url, f"/api/runs/{stored['run_id']}/start", {})
            result = {"platform": platform(), "architecture": machine(), "server_cold_health_ms": readiness_ms,
                      "rule_flash_create_and_run_ms": round(milliseconds(start), 3),
                      "data": data_benchmark(), "flash_events": len(run["result"]["events"])}
            result["native_flash_seek"] = seek_benchmark(url, run["run_id"], result["flash_events"])
            result["browser"] = browser_benchmark(url, run)
            if stress:
                for name, ticks, actors in (("fixture_500_agents_300_frames", 300, 500),
                                            ("fixture_100000_events", 100_000, 0)):
                    identifier, size = fixture(db, ticks, actors)
                    result[name] = {"stored_bytes": size, "events": ticks, "agents_per_frame": actors,
                                    "seek": seek_benchmark(url, identifier, ticks)}
            if combined or oversized:
                result["combined_fixture"] = combined_benchmark(url, db, oversized)
            result["service_rss_at_end_bytes"] = int(check_output(["ps", "-o", "rss=", "-p", str(pid)])) * 1024
            return result


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--stress", action="store_true")
    parser.add_argument("--combined", action="store_true")
    parser.add_argument("--oversized", action="store_true", help="Add a combined fixture above the event cache limit.")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    serialized = json.dumps(measure(args.stress, args.combined, args.oversized), ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(serialized)
    print(serialized, end="")
