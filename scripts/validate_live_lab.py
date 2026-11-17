"""Run the four explicitly configured live canaries and save sanitized receipts."""
from argparse import ArgumentParser
import json
from pathlib import Path
from socket import AF_INET, SOCK_STREAM, socket
from threading import Thread
from time import monotonic, sleep
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from uvicorn import Config, Server

from services.simulation.api import app
from services.simulation.lessons import load_case, simulate

RECEIPT = Path(".civitas-edu/wp08-canary.json")


def call(base, path, payload=None):
    request = Request(base + path, data=None if payload is None else json.dumps(payload).encode(),
                      headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=55) as response:
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"Local application rejected {path} with HTTP {error.code}") from None


def run_canaries(base):
    capabilities = call(base, "/api/live")
    if not capabilities["available"]:
        raise SystemExit("Paid provider not configured. No request sent.")
    entries = []
    for case_id in capabilities["cases"]:
        lesson = load_case(case_id)
        action = lesson["action"]["default"]
        created = call(base, "/api/runs", {"request_id": str(uuid4()), "case_id": case_id,
                       "scenario_id": "baseline", "seed": lesson["seed"], "action": action, "provider_kind": "live"})
        run_id = created["run_id"]
        path = f"/api/runs/{run_id}"
        run = call(base, path + "/start", {})
        result = run["result"]
        metadata = result["live"]
        decision = metadata["decisions"][0]
        direct = call(base, path + f"/trace/{decision['event_seq']}")
        assert direct["event"]["action"] == decision["action"]
        assert call(base, path + "/export") == run
        assert call(base, path + "/start", {}) == run
        comparison = simulate(lesson, "baseline", lesson["seed"], action)
        assert comparison["root_hash"] == result["root_hash"]
        entries.append({"case_id": case_id, "case_version": run["case_version"], "run_id": run_id,
                        "seed": lesson["seed"], "action": action, "result_hash": run["result_hash"],
                        "model_metrics_differ_from_rule": comparison["metrics"] != result["metrics"], **metadata})
        # No benefit from repeating an account-wide refusal for each lesson.
        if metadata["selected_by_model"] == 0 and decision["attempts"] and all(
            a["reason"] in {"auth_failed", "access_denied", "model_unavailable", "payment_required"}
            for a in decision["attempts"]
        ):
            break
    return entries


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=RECEIPT)
    args = parser.parse_args()
    with socket(AF_INET, SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        base = f"http://127.0.0.1:{listener.getsockname()[1]}"
        server = Server(Config(app, log_level="error", access_log=False))
        thread = Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        try:
            deadline = monotonic() + 8
            while not server.started and thread.is_alive() and monotonic() < deadline:
                sleep(.05)
            if not server.started:
                raise SystemExit("The local canary server did not start.")
            entries = run_canaries(base)
            args.output.parent.mkdir(exist_ok=True, parents=True)
            args.output.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n")
            accepted = sum(entry["selected_by_model"] for entry in entries)
            print(f"Cases completed: {len(entries)}/4. Accepted provider decisions: {accepted}/4.")
            print(f"Sanitized receipt: {args.output}")
            if accepted != 4:
                raise SystemExit(2)
        finally:
            server.should_exit = True
            thread.join(6)


if __name__ == "__main__":
    main()
