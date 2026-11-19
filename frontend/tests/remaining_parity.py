"""Run each supported choice and policy independently in both classroom engines."""
import json
import math
import subprocess
from collections import Counter
from pathlib import Path

from services.simulation import beer, carbon, cascade, commons, flash_crash
from services.simulation import gamestop, lemons, matching, public_goods, schelling
from frontend.tests.generate_classroom_inputs import inputs

ROOT = Path(__file__).resolve().parents[2]
CASES = {
    "school_matching": (matching, 0, 1),
    "lemons_market": (lemons, 0, 1),
    "information_cascade": (cascade, 0, 1),
    "schelling_segregation": (schelling, 30, 50),
    "public_goods": (public_goods, 0, 1),
    "commons_governance": (commons, 0, 1),
    "carbon_market": (carbon, 0, 1),
    "beer_game": (beer, 0, 1),
    "gamestop": (gamestop, 0, 1),
    "flash_crash": (flash_crash, 0, 1),
}
# Additional semantic fields alongside the full metrics at every event.
EVIDENCE = {
    "school_matching": ("proposals", "held", "rejected", "assignments", "submitted_blocking", "true_blocking"),
    "lemons_market": ("certified", "fee", "exited", "willing_pool", "transactions"),
    "information_cascade": ("signal", "choice", "policy", "choice_if_private_a", "choice_if_private_b",
                            "public_a_before_pct", "public_a_after_pct", "private_a_after_pct", "cascade",
                            "information_added", "state", "correct_count"),
    "schelling_segregation": ("actor_id", "origin", "destination", "before", "after", "changed_neighbors", "terminal"),
    "public_goods": ("contributions", "public_return", "net", "outgoing", "fines"),
    "commons_governance": ("start_stock", "remaining_stock", "allocations", "requests", "plans", "growth", "next_stock"),
    "carbon_market": ("issue", "abatement", "emissions", "buyer", "seller", "permits", "payment", "firm"),
    "beer_game": ("arrivals", "dispatches", "orders", "production", "demand_received", "delivered", "produced",
                  "in_transit_batches"),
    "gamestop": ("order_id", "maker_id", "buy_order_id", "sell_order_id", "quantity", "price_cents",
                 "actor_id", "message_id", "origin_seq", "debt", "remaining_debt", "mark_cents"),
    "flash_crash": ("order_id", "maker_id", "buy_order_id", "sell_order_id", "quantity", "price_cents",
                    "actor_id", "excess", "limit", "active_orders", "plan_shares"),
}


def assert_matches(received, expected, label):
    if isinstance(received, dict):
        assert isinstance(expected, dict), (label, received, expected)
        for key in received:
            assert key in expected, (label, key)
            assert_matches(received[key], expected[key], f"{label}.{key}")
    elif isinstance(received, list):
        assert len(received) == len(expected), (label, len(received), len(expected))
        for i, (a, b) in enumerate(zip(received, expected, strict=True)):
            assert_matches(a, b, f"{label}[{i}]")
    elif isinstance(received, float):
        assert isinstance(expected, (int, float)) and math.isclose(received, expected, abs_tol=1e-9), (label, received, expected)
    else:
        assert received == expected, (label, received, expected)


def main():
    for name, data in zip(("schelling", "classroom"), inputs(), strict=True):
        assert json.loads((ROOT / "frontend/src/data" / f"{name}-inputs.json").read_text()) == data

    definitions = {key: json.loads((ROOT / "cases" / key / "case.json").read_text()) for key in CASES}
    requests = [{"id": key, "choices": [item["id"], "prediction-0"], "policy": policy}
                for key, (_, baseline, comparison) in CASES.items()
                for item in definitions[key]["action"]["options"] for policy in (baseline, comparison)]
    report = subprocess.run(["node", "frontend/tests/remaining_parity.mjs", "--pipe"], cwd=ROOT,
                            input=json.dumps(requests), text=True, capture_output=True, check=True)
    counts = Counter()
    for request, line in zip(requests, report.stdout.splitlines(), strict=True):
        browser = json.loads(line)
        key = request["id"]
        action = request["choices"][0]
        case = definitions[key]
        label = f"{key}/{action}/{browser['scenario']}"
        actual = CASES[key][0].simulate(case, browser["scenario"], case["seed"], action)
        assert browser["seed"] == case["seed"], label
        assert len(browser["metrics"]) == len(actual["events"]), (label, len(browser["metrics"]), len(actual["events"]))
        for event, expected, metrics, snapshot in zip(browser["records"], actual["events"], browser["metrics"],
                                                       actual["snapshots"], strict=True):
            assert event["event_type"] == expected["event_type"], (label, event, expected)
            assert event["seq"] == expected["seq"], (label, event, expected)
            assert metrics.keys() == snapshot["metrics"].keys(), (label, event, metrics, snapshot["metrics"])
            assert_matches(metrics, snapshot["metrics"], f"{label}.{event['seq']}.metrics")
            data = event.get("data", {})
            for field in EVIDENCE[key]:
                if field in expected:
                    assert field in data, (label, event["seq"], field)
                    assert_matches(data[field], expected[field], f"{label}.{event['seq']}.{field}")
        counts[key] += len(actual["events"])
    for key in CASES:
        print(f"{key}: {counts[key]} event frames matched")
    print(f"{len(requests)} paired trajectories, {sum(counts.values())} frames matched")


if __name__ == "__main__":
    main()
