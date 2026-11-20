"""Create or verify a standalone local teaching archive from an explicit file set."""
from argparse import ArgumentParser
from gzip import GzipFile
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
from subprocess import check_output
from tarfile import TarInfo, open as tar_open

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "RELEASE_MANIFEST.json"
CORE = [
    "core/__init__.py", "core/market_defaults.py", "core/types.py", "core/utils.py",
    *[f"core/exchange/{name}.py" for name in
      ("__init__", "evolution", "market_rules", "order_book", "session_rules", "trade_tape")],
]
SCRIPTS = ["audit_orca", "audit_student_accessibility", "benchmark_student_lab", "case_seed_matrix", "check_boundaries",
           "check_course_provenance", "check_lesson_catalog", "check_learning_packages", "generate_auction_presets",
           "generate_case_packages", "lab_backup", "package_student_lab", "validate_live_lab"]
KEY_PATTERN = re.compile(
    rb"sk-proj-[A-Za-z0-9_-]{40,}|sk-[0-9a-f]{32}\b|gh[pousr]_[A-Za-z0-9]{25,}|"
    rb"AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
)


def payload():
    paths = {ROOT / path for path in CORE}
    paths.update(ROOT / f"scripts/{name}.py" for name in SCRIPTS)
    paths.update(ROOT / name for name in ("PRODUCT.md", "STUDENT_LAB.md", "requirements-edu.lock",
                                          "requirements-edu-dev.lock", "docs/release/check_feedback.py"))
    for prefix, extensions in {
        "cases": {".json", ".md", ".gz"}, "content": {".json", ".ts", ".tsx", ".css"}, "docs": {".md", ".json", ".txt"},
        "schemas": {".json"}, "services/simulation": {".py"}, "tests": {".py", ".json"},
        "student-web/src": {".tsx", ".ts", ".css"}, "student-web/dist": {".html", ".js", ".css"},
        "frontend/src": {".tsx", ".ts", ".css", ".json"}, "frontend/dist": {".html", ".js", ".css"},
        "frontend/tests": {".mjs", ".py"},
    }.items():
        paths.update(path for path in (ROOT / prefix).rglob("*")
                     if path.is_file() and path.suffix in extensions and not path.name.startswith("."))
    paths.update(ROOT / "student-web" / name for name in ("build.js", "index.html", "package.json", "package-lock.json", "tsconfig.json"))
    paths.update(ROOT / "frontend" / name for name in ("vite.config.ts", "index.html", "package.json",
                                                        "package-lock.json", "tsconfig.json", "README.md", "MIGRATION.md"))
    for app in ("student-web", "frontend"):
        if ROOT / app / "dist/index.html" not in paths:
            raise SystemExit(f"Build {app} assets first.")
    return sorted(paths)


def checksum(data):
    return sha256(data).hexdigest()


def pack(output):
    from services.simulation.api import VERSION
    from services.simulation.lessons import CATALOG, load_case

    output.parent.mkdir(parents=True, exist_ok=True)
    entries = {}
    contents = {}
    for path in payload():
        name = path.relative_to(ROOT).as_posix()
        if path.is_symlink() or not path.is_relative_to(ROOT) or not path.resolve().is_relative_to(ROOT):
            raise SystemExit(f"Unexpected file path: {name}")
        data = path.read_bytes()
        if KEY_PATTERN.search(data):
            raise SystemExit(f"Credential-shaped content found in {name}")
        entries[name] = {"bytes": len(data), "sha256": checksum(data)}
        contents[name] = data
    source = {name: record for name, record in entries.items() if not name.startswith(("student-web/dist/", "frontend/dist/"))}
    manifest = {
        "release_version": VERSION,
        "upstream_head": check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "source_tree_sha256": checksum(json.dumps(source, sort_keys=True, separators=(",", ":")).encode()),
        "cases": [{"id": key, "version": load_case(key)["version"]} for key in CATALOG],
        "files": entries,
    }
    contents[MANIFEST] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    prefix = f"Civitas_Economica_Student_Lab_{VERSION}"
    with output.open("wb") as out, GzipFile(filename="", mode="wb", fileobj=out, mtime=0) as stream, \
            tar_open(fileobj=stream, mode="w") as archive:
        for filename, data in sorted(contents.items()):
            member = TarInfo(f"{prefix}/{filename}")
            member.size, member.mode = len(data), 0o644
            archive.addfile(member, BytesIO(data))
    digest = checksum(output.read_bytes())
    output.with_suffix(output.suffix + ".sha256").write_text(f"{digest}  {output.name}\n")
    print(f"{len(entries)} checked files, {len(CATALOG)} courses, archive SHA-256 {digest}")
    print(f"Source tree SHA-256 {manifest['source_tree_sha256']}")


def verify():
    manifest = json.loads((ROOT / MANIFEST).read_text())
    for name, expected in manifest["files"].items():
        path = ROOT / name
        if not path.is_file() or not path.resolve().is_relative_to(ROOT) or path.is_symlink():
            raise SystemExit(f"Missing or unsafe path: {name}")
        data = path.read_bytes()
        if len(data) != expected["bytes"] or checksum(data) != expected["sha256"]:
            raise SystemExit(f"Integrity failure: {name}")
    print(f"{manifest['release_version']}: {len(manifest['files'])} file checksums verified")


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--output", type=Path)
    mode.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.verify:
        verify()
    else:
        pack(args.output)
