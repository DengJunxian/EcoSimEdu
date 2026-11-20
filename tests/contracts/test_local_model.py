import json
from http.client import HTTPConnection
from socket import socket
from threading import Thread
from time import monotonic, sleep
from types import SimpleNamespace
from uuid import uuid4

import pytest
import uvicorn

from services.simulation import api, live_client
from services.simulation.lessons import load_case

KEY = "test-credential-do-not-persist"
ACTION = '{"action":"20"}'


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CIVITAS_EDU_DB", str(tmp_path / "runs.sqlite3"))
    monkeypatch.setenv("CIVITAS_LIVE_ENABLED", "0")
    monkeypatch.delenv("CIVITAS_L2_ENABLED", raising=False)
    monkeypatch.setattr(live_client, "_local", None)
    with socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(api.app, log_level="warning"))
        thread = Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        try:
            deadline = monotonic() + 3
            while not server.started and thread.is_alive() and monotonic() < deadline:
                sleep(.01)
            assert server.started
            yield Client(port)
        finally:
            server.should_exit = True
            thread.join(3)
        assert not thread.is_alive()
    db = tmp_path / "runs.sqlite3"
    if db.exists():
        assert KEY.encode() not in db.read_bytes()


class Client:
    def __init__(self, port):
        self.port = port
        self.base = f"http://127.0.0.1:{port}"

    def get(self, url):
        return self.request("GET", url)

    def post(self, url, json, headers=None):
        return self.request("POST", url, json, headers)

    def request(self, method, path, payload=None, headers=None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=8)
        try:
            body = None if payload is None else json.dumps(payload).encode()
            conn.request(method, path, body=body,
                         headers={"origin": self.base, "content-type": "application/json"} | (headers or {}))
            response = conn.getresponse()
            text = response.read().decode()
            return SimpleNamespace(status_code=response.status, headers=response.headers, text=text,
                                   json=lambda: json.loads(text))
        finally:
            conn.close()


def setup_model(client, name, **kwargs):
    response = client.post("/api/local-model", json={"provider": name, "api_key": KEY, **kwargs})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert KEY not in response.text
    return response.json()["active"]


def request_run(client, model_id=None):
    case = load_case("public_goods")
    return client.post("/api/runs", json={
        "request_id": str(uuid4()), "case_id": case["case_id"], "scenario_id": "baseline",
        "provider_kind": "live", "seed": case["seed"], "action": case["action"]["default"],
        "model_session_id": model_id,
    })


@pytest.mark.parametrize(("name", "host", "path", "auth", "cap"), [
    ("openai", "api.openai.com", "/v1/responses", "Authorization", "max_output_tokens"),
    ("deepseek", "api.deepseek.com", "/chat/completions", "Authorization", "max_tokens"),
    ("anthropic", "api.anthropic.com", "/v1/messages", "x-api-key", "max_tokens"),
    ("gemini", "generativelanguage.googleapis.com", "/v1beta/models/gemini-2.5-flash-lite:generateContent",
     "x-goog-api-key", "maxOutputTokens"),
    ("qwen", "ws-test123.cn-beijing.maas.aliyuncs.com", "/compatible-mode/v1/chat/completions",
     "Authorization", "max_tokens"),
    ("kimi", "api.moonshot.ai", "/v1/chat/completions", "Authorization", "max_completion_tokens"),
    ("glm", "open.bigmodel.cn", "/api/paas/v4/chat/completions", "Authorization", "max_tokens"),
    ("grok", "api.x.ai", "/v1/responses", "Authorization", "max_output_tokens"),
])
def test_local_configuration_drives_engine_and_replay(client, monkeypatch, name, host, path, auth, cap):
    sent = []

    class ProviderStub:
        status = 200

        def __init__(self, actual_host, timeout):
            assert actual_host == host
            assert timeout > 0

        def request(self, method, actual_path, *, body, headers):
            assert (method, actual_path) == ("POST", path)
            assert headers[auth] == (f"Bearer {KEY}" if auth == "Authorization" else KEY)
            assert KEY.encode() not in body
            payload = json.loads(body)
            assert payload.get("model", active["model"]) == active["model"]
            assert (payload.get("generationConfig") if name == "gemini" else payload)[cap] == (
                1024 if name in {"kimi", "grok"} else 192)
            assert "tools" not in payload
            if name == "anthropic":
                assert headers["anthropic-version"] == "2023-06-01"
            sent.append(payload)

        def getresponse(self):
            return self

        def getheader(self, name):
            return "request_demo"

        def read(self, size):
            frame = {"id": KEY, "model": active["model"]}
            if name in {"openai", "grok"}:
                frame.update(status="completed", output=[{"type": "message", "content": [
                    {"type": "output_text", "text": ACTION}]}], usage={"input_tokens": 400, "output_tokens": 12})
            elif name == "anthropic":
                frame.update(stop_reason="end_turn", content=[{"type": "text", "text": ACTION}],
                             usage={"input_tokens": 390, "cache_read_input_tokens": 10, "output_tokens": 12})
            elif name == "gemini":
                frame = {"modelVersion": active["model"], "responseId": KEY,
                         "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": ACTION}]}}],
                         "usageMetadata": {"promptTokenCount": 400, "candidatesTokenCount": 12}}
            else:
                frame.update(choices=[{"finish_reason": "stop", "message": {"content": ACTION}}],
                             usage={"prompt_tokens": 400, "completion_tokens": 12})
            return json.dumps(frame).encode()

        def close(self):
            pass

    monkeypatch.setattr(live_client, "HTTPSConnection", ProviderStub)
    extras = {"input_rate": "2", "output_rate": "8"} if name in {"kimi", "glm"} else {}
    if name == "qwen":
        extras["workspace"] = "ws-test123"
    active = setup_model(client, name, **extras)
    assert not sent
    assert client.get("/api/live").json()["providers"] == [active]
    assert client.get("/api/v2/model-lab").json()["providers"][0]["model_session_id"] == active["model_session_id"]
    assert request_run(client).status_code == 409
    created = request_run(client, active["model_session_id"])
    assert created.status_code == 201
    url = f"/api/runs/{created.json()['run_id']}"
    response = client.post(url + "/start", json={})
    assert response.status_code == 200
    receipt = response.json()["result"]["live"]
    assert receipt["selected_by_model"] == 1
    assert receipt["decisions"][0]["action"] == "20"
    assert receipt["decisions"][0]["attempts"][0]["response_id"] is None
    assert KEY not in client.get(url).text
    assert len(sent) == 1

    payload = {"request_id": str(uuid4()), "case_id": "public_goods", "mode": "live",
               "seed": load_case("public_goods")["seed"], "action": load_case("public_goods")["action"]["default"],
               "model_session_id": active["model_session_id"]}
    l2 = client.post("/api/v2/model-lab/runs", json=payload)
    assert l2.status_code == 201
    if name == "anthropic":
        l2_url = f"/api/v2/model-lab/runs/{l2.json()['run_id']}"
        assert client.post(l2_url + "/start", json={}).status_code == 202
        deadline = monotonic() + 4
        state = client.get(l2_url).json()
        while state["state"] == "running" and monotonic() < deadline:
            sleep(.05)
            state = client.get(l2_url).json()
        assert state["state"] == "completed" and state["coverage"]["model_committed"] > 0
        assert KEY not in client.get(l2_url + "/export").text
        l2 = client.post("/api/v2/model-lab/runs", json=payload | {"request_id": str(uuid4())})
    call_count = len(sent)
    pending = request_run(client, active["model_session_id"]).json()
    assert client.post("/api/local-model", json={}).json()["active"] is None
    assert client.post(f"/api/runs/{pending['run_id']}/start", json={}).status_code == 409
    assert client.post(f"/api/v2/model-lab/runs/{l2.json()['run_id']}/start", json={}).status_code == 409
    assert client.get(url).json() == response.json()
    assert len(sent) == call_count


def test_key_setup_rejects_cross_origin_nonlocal_and_invalid_payload_without_echo(client):
    payload = {"provider": "openai", "api_key": KEY}
    for headers in ({"origin": "http://elsewhere.invalid"}, {"host": "elsewhere.invalid"},
                    {"origin": ""}, {"sec-fetch-site": "cross-site"}):
        assert client.post("/api/local-model", json=payload, headers=headers).status_code == 403
    assert client.post("/api/local-model", json=payload, headers={"x-forwarded-for": "203.0.113.1"}).status_code == 403
    for invalid in (payload | {"base_url": "https://elsewhere.invalid"},
                    payload | {"api_key": KEY + "\r\nInjected"},
                    payload | {"provider": "kimi", "input_rate": "Infinity"},
                    payload | {"provider": "qwen", "workspace": "ws-test.example.com"}):
        response = client.post("/api/local-model", json=invalid)
        assert response.status_code == 422 and KEY not in response.text
    oversized = client.post("/api/local-model", json=payload | {"api_key": KEY * 200})
    assert oversized.status_code == 413 and KEY not in oversized.text
    assert client.get("/api/local-model").json()["active"] is None
