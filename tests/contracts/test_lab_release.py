from pathlib import Path
import sqlite3

import pytest

from scripts.lab_backup import copy_database
from services.simulation.auction import digest
from services.simulation.api import VERSION
from test_education_api import call


def test_health_and_teacher_preset(local_app):
    health = call(local_app, "/api/health")
    assert health == {"status": "ready", "version": VERSION, "published_cases": 12, "live_configured": False}
    basic = call(local_app, "/api/cases/double_auction/presets")
    assert basic["provider_kind"] == "rule" and basic["student_choice"] == {"bid": 96}
    assert len(basic["presets"]) >= 3
    live_case = call(local_app, "/api/cases/public_goods/presets")
    assert live_case["provider_kind"] == "rule" and live_case["student_choice"]["action"]


def test_backup_recovers_saved_run_and_budget(tmp_path: Path):
    root = tmp_path / "active.sqlite3"
    data = {"case": "tiny-fixture", "metrics": [1, 0, None]}
    import json

    with sqlite3.connect(root) as connection:
        connection.execute("CREATE TABLE runs(id TEXT, request TEXT, status TEXT, result TEXT)")
        connection.execute("CREATE TABLE live_attempts(id INTEGER, reservation INTEGER, consumed INTEGER)")
        connection.execute("INSERT INTO live_attempts VALUES (1,500000,27)")
        connection.execute("INSERT INTO runs VALUES(?, ?, ?, ?)",
                           ("pilot", "{}", "completed", json.dumps({"result": data, "result_hash": digest(data)})))
    copy = tmp_path / "backups" / "ledger.sqlite3"
    restore = tmp_path / "restored.sqlite3"
    assert copy_database(root, copy) == 1
    assert copy_database(copy, restore) == 1
    with sqlite3.connect(restore) as connection:
        assert json.loads(connection.execute("SELECT result FROM runs").fetchone()[0])["result"] == data
        assert connection.execute("SELECT consumed FROM live_attempts").fetchone() == (27,)
    with pytest.raises(FileExistsError):
        copy_database(copy, restore)
    with sqlite3.connect(root) as connection:
        connection.execute("UPDATE runs SET result=?", (json.dumps({"result": data, "result_hash": "wrong"}),))
    broken = tmp_path / "broken.sqlite3"
    with pytest.raises(ValueError, match="digest failed"):
        copy_database(root, broken)
    assert not broken.exists()
