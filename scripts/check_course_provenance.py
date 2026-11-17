"""Validate course source coverage and reproduce the versioned data asset inventory."""

from argparse import ArgumentParser
from contextlib import closing
from datetime import date
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3
from tarfile import open as open_tar

from services.simulation.api import lookup
from services.simulation.auction import ROOT, digest
from services.simulation.lessons import CATALOG, MODULES, load_case
from services.simulation.live import LIVE_CASES

SOURCE_FILE = ROOT / "cases/sources.json"
ASSET_FILE = ROOT / "cases/data-assets.json"
LIVE_RECEIPTS = ("docs/audit/wp08-real-canary.json", "docs/release/real-api-receipt.json")


def read(path):
    return json.loads(path.read_text())


def validate_sources():
    registry = read(SOURCE_FILE)
    assert registry["schema_version"] == 1 and date.fromisoformat(registry["checked_at"])
    expected = {(case_id, source["id"]): source["url"]
                for case_id in CATALOG for source in load_case(case_id)["sources"]}
    rows = registry["sources"]
    recorded = {(row["case_id"], row["source_id"]): row["course_url"] for row in rows}
    assert len(recorded) == len(rows) and recorded == expected, "Course/source references differ"
    for row in rows:
        for key in ("title", "creator", "edition", "locator", "support", "limits", "access_note"):
            assert row[key].strip(), (row["source_id"], key)
        assert row["published"] or row["date_note"]
        assert row["access"] in {"original_full_text", "original_page", "publisher_abstract", "metadata_only"}
        assert row["examined_url"].startswith("https://")
        rights = row["rights"]
        assert rights["status"] in {"stated_terms", "copyright_notice", "unconfirmed"}
        assert rights["detail"].strip() and rights["evidence_url"].startswith("https://")
        assert row["course_distribution"] == "link_and_paraphrase"
        external = row["underlying_external_data"]
        assert external["distribution"] == "not_included" and external["version"] is None
        assert (external["acquisition"], external["license_status"]) in {
            ("not_acquired", "unconfirmed"), ("not_applicable", "not_applicable"),
        }
        if fingerprint := row.get("examined_file_sha256"):
            assert re.fullmatch(r"[a-f0-9]{64}", fingerprint), row["source_id"]
    return rows


def inventory():
    files = []

    def register(path, kind, version, scope, grain, method, verify=None):
        data = (ROOT / path).read_bytes()
        files.append({
            "path": path, "kind": kind, "version": version, "cases": list(scope),
            "grain": grain, "method": method, "verify": verify,
            "bytes": len(data), "sha256": sha256(data).hexdigest(),
            "distribution": "included_in_local_teaching_package",
            "license_status": "project_public_license_unconfirmed",
        })

    register("cases/catalog.json", "teaching_input", "RC9", CATALOG, "每门发布课一个 ID",
             "项目维护的课程序列")
    register("cases/boundaries.json", "teaching_input", "RC9", CATALOG, "每课一个固定边界输入",
             "项目手工定义的动作及规则参数", "python -m scripts.check_boundaries")
    for case_id in CATALOG:
        case = load_case(case_id)
        path = f"cases/{case_id}/case.json"
        register(path, "teaching_input", case["version"], [case_id], "每课一份定义",
                 "项目编写的教学文案、动作、规则参数和固定种子",
                 "python -m scripts.check_lesson_catalog --milestone m3")

    register("cases/double_auction/presets.json.gz", "precomputed_simulation", "RC9 / double-auction/1",
             ["double_auction"], "每个冻结情景一条含事件、快照与指标的轨迹",
             "从课件种子和固定报价运行撮合模型，按情景键封装为确定性 gzip",
             "python -m scripts.generate_auction_presets --check")
    for case_id, test in (("public_goods", "test_public_goods_lesson"), ("commons_governance", "test_commons_lesson")):
        path = f"cases/{case_id}/replicates.json"
        case_version = read(ROOT / path)["case_version"]
        register(path, "computed_rule_receipt", case_version, [case_id], "每种子与情景一组期末指标及结果哈希",
                 "按文件所列种子、动作与情景重跑课程模型，保存指标和运行哈希",
                 f"python -m pytest -q tests/mechanisms/{test}.py -k regenerated")

    register("docs/audit/m2-runs.json", "computed_rule_receipt", "M2 frozen", CATALOG[:6],
             "每课每个必做情景一组结果摘要", "固定种子、默认动作和配对条件下计算",
             "python -m scripts.check_lesson_catalog --milestone m2")
    register("docs/audit/m3-runs.json", "computed_rule_receipt", "M3 frozen", CATALOG,
             "每课每个发布对照情景一组指标和哈希", "固定种子、默认动作和配对条件下计算",
             "python -m scripts.check_lesson_catalog --milestone m3")
    register("docs/release/seed-matrix.json", "computed_rule_receipt", "M3 / 20-seed matrix", CATALOG,
             "每课每情景一组跨种子摘要和逐种子哈希", "每课 20 个连续种子，每个情景、种子组合本地计算两次",
             "python -m scripts.case_seed_matrix")
    register("docs/release/rc9-boundaries.json", "computed_rule_receipt", "RC9", CATALOG,
             "每课边界一组结果", "从固定边界参数、种子和动作计算并检查机制断言",
             "python -m scripts.check_boundaries")
    for path, version, grain in (
        (LIVE_RECEIPTS[0], "WP08 initial canary", "初次联通的四门课轨迹摘要"),
        (LIVE_RECEIPTS[1], "WP08 release canary", "四课各一条 Live 轨迹摘要"),
    ):
        cases = sorted({row["case_id"] for row in read(ROOT / path)}, key=CATALOG.index)
        register(path, "live_simulation_receipt", version, cases, grain,
                 "实际的 OpenAI 请求和本地规则结算，保存动作、用量和哈希；供应商原始响应正文只留哈希")

    for path, version in (
        ("docs/release/backup-and-replay.json", "WP10 backup replay"),
        ("docs/release/rc3-saved-events.json", "RC3 saved events"),
    ):
        register(path, "local_replay_audit", version, LIVE_CASES, "一次 SQLite 恢复与离线回放检查",
                 "验证已保存运行可回放与账本计数；只登记汇总证据")

    course_lineage = []
    results = read(ROOT / "docs/audit/m3-runs.json")
    boundaries = read(ROOT / "docs/release/rc9-boundaries.json")
    for case_id in CATALOG:
        definition = load_case(case_id)
        engine = f"services/simulation/{MODULES.get(case_id, 'auction')}.py"
        versions = {record["engine"] for record in results[case_id]}
        assert versions == {next(row["engine_version"] for row in boundaries if row["case_id"] == case_id)}
        course_lineage.append({
            "case_id": case_id, "case_version": definition["version"],
            "source_ids": [row["id"] for row in definition["sources"]],
            "seed": definition["seed"], "engine_version": versions.pop(), "engine_path": engine,
            "engine_sha256": sha256((ROOT / engine).read_bytes()).hexdigest(),
            "historical_dataset": None,
            "records": [entry["path"] for entry in files if case_id in entry["cases"]],
        })
    assert set(files_entry["path"] for files_entry in files if files_entry["path"].startswith("cases/")) == {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "cases").rglob("*")
        if path.suffix in {".json", ".gz"} and path not in {SOURCE_FILE, ASSET_FILE}
    }, "Unregistered data file in cases/"
    return {"schema_version": 1, "content_release": "1.0.0-rc.9", "courses": course_lineage, "files": files,
            "runtime_records": [
                {"kind": "computed_rule", "export_origin": "offline_simulation", "cases": list(CATALOG),
                 "method": "指定版本的课件、引擎、种子、情景和学生动作；运行时计算"},
                {"kind": "precomputed_simulation", "export_origin": "precomputed_simulation", "cases": ["double_auction"],
                 "method": "读取已登记的 gzip 预设；保留原结果哈希"},
                {"kind": "live_simulation", "export_origin": "live_simulation", "cases": list(LIVE_CASES),
                 "method": "真实供应商动作与本地结算；读取保存的运行不再请求供应商"},
            ],
            "runtime_storage": {"format": "SQLite / canonical-result/1 or legacy JSON",
                                "version": "case_version + engine_version + result_hash",
                                "distribution": "user_local_only; database_not_in_archive",
                                "license_status": "public_reuse_unconfirmed"}}


def verify_saved_live(path):
    receipts = [row for file in LIVE_RECEIPTS for row in read(ROOT / file)]
    assert len({row["run_id"] for row in receipts}) == len(receipts)
    with closing(sqlite3.connect(path.resolve(strict=True).as_uri() + "?mode=ro", uri=True)) as conn:
        assert conn.execute("PRAGMA quick_check").fetchall() == [("ok",)]
        for row in receipts:
            run = lookup(conn, row["run_id"])
            assert run["origin"] == "live_simulation" and run["execution_status"] == "completed"
            assert all(run[key] == row[key] for key in ("case_id", "case_version", "seed", "action", "result_hash"))
            assert digest(run["result"]) == row["result_hash"]
    return len(receipts)


def verify_archive(path, inventory_files):
    with open_tar(path, "r:gz") as archive:
        names = [member.name for member in archive.getmembers() if member.isfile()]
        prefix = names[0].split("/", 1)[0] + "/"
        assert all(name.startswith(prefix) for name in names)
        names = {name.removeprefix(prefix) for name in names}
        manifest = json.load(archive.extractfile(prefix + "RELEASE_MANIFEST.json"))
        assert names == manifest["files"].keys() | {"RELEASE_MANIFEST.json"}
        data_files = {item["path"]: item["sha256"] for item in inventory_files}
        for name in sorted(names - {"RELEASE_MANIFEST.json"}):
            assert Path(name).suffix in {".py", ".md", ".json", ".gz", ".txt", ".tsx", ".ts", ".css", ".html", ".js", ".lock"}
            assert not name.startswith(".civitas-edu/") and (not name.endswith(".gz") or name in data_files)
            contents = archive.extractfile(prefix + name).read()
            manifest_entry = manifest["files"][name]
            assert len(contents) == manifest_entry["bytes"]
            assert sha256(contents).hexdigest() == manifest_entry["sha256"]
            if name in data_files:
                assert manifest_entry["sha256"] == data_files[name], name
        assert data_files.keys() <= names
        return len(manifest["files"])


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--archive", type=Path, help="Verify the included asset files against a lab archive")
    parser.add_argument("--database", type=Path, help="Verify historical Live result receipts using a read-only database")
    args = parser.parse_args()
    sources = validate_sources()
    manifest = inventory()
    if args.write:
        ASSET_FILE.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    elif read(ASSET_FILE) != manifest:
        raise SystemExit("Course asset inventory changed. Review provenance then regenerate it.")
    print(f"{len(CATALOG)} courses; {len(sources)} source references; {len(manifest['files'])} data asset checksums")
    if args.archive:
        print(f"{verify_archive(args.archive, manifest['files'])} archive file checksums and all data assets verified")
    if args.database:
        print(f"{verify_saved_live(args.database)} saved Live result hashes verified read-only")


if __name__ == "__main__":
    main()
