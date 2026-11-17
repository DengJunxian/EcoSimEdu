import json
from contextlib import closing
from uuid import uuid4

import pytest
from fastapi import HTTPException

from services.simulation import api
from services.simulation.auction import digest


@pytest.mark.parametrize("storage", ["small", "legacy-large", "canonical-large"])
def test_event_lookup_independent_of_frames(monkeypatch, tmp_path, storage):
    monkeypatch.setenv("CIVITAS_EDU_DB", str(tmp_path / "runs.sqlite3"))
    if storage != "small":
        monkeypatch.setattr(api, "EVENT_CACHE_BYTES", 0)
    identifier = uuid4()
    request = {"case_id": "svb_run", "case_version": "1.0.0"}
    events = [{"seq": seq, "tick": tick, "event_type": "synthetic"}
              for seq, tick in enumerate((0, 0, 40))]
    result = {"events": events, "snapshots": [{"tick": 0}]}
    stored = {"case_version": "1.0.0", "result_hash": digest(result), "result": result}
    encoded = (api.encode_result("1.0.0", "offline_simulation", result)
               if storage == "canonical-large" else json.dumps(stored))
    with closing(api.connect()) as connection, connection:
        connection.execute("INSERT INTO runs VALUES (?, ?, 'completed', ?)",
                           (str(identifier), json.dumps(request), encoded))
    assert api.read_event(identifier, 1)["event"] == events[1]
    run = api.get_run(identifier)
    assert run["result"] == result and run["result_hash"] == digest(result) and "format" not in run
    assert api.read_event(identifier, 1)["snapshot_tick"] == 0
    assert api.read_event(identifier, 2)["snapshot_tick"] is None
    assert api.seek(identifier, 0) == result["snapshots"][0]
    for seq in (-1, 3):
        with pytest.raises(HTTPException) as error:
            api.read_event(identifier, seq)
        assert (error.value.status_code, error.value.detail) == (404, "EVENT_NOT_AVAILABLE")
        with pytest.raises(HTTPException) as error:
            api.seek(identifier, seq)
        assert (error.value.status_code, error.value.detail) == (404, "SNAPSHOT_NOT_AVAILABLE")
    with closing(api.connect()) as connection, connection:
        tick = '"tick":0' if storage == "canonical-large" else '"tick": 0'
        corrupt = encoded.replace(tick, '"tick":99', 1)
        assert corrupt != encoded
        connection.execute("UPDATE runs SET result=? WHERE id=?", (corrupt, str(identifier)))
    for endpoint, offset in ((api.read_event, 1), (api.seek, 0)):
        with pytest.raises(HTTPException) as error:
            endpoint(identifier, offset)
        assert (error.value.status_code, error.value.detail) == (409, "RUN_INTEGRITY_ERROR")
