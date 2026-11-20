"""Run each supported choice and policy independently in both classroom engines."""
import json
import math
import subprocess
from collections import Counter
from pathlib import Path

from services.simulation import beer, carbon, cascade, commons, flash_crash
from services.simulation import gamestop, lemons, matching, public_goods, schelling
from services.simulation.ai import course_event_tutor, schelling_tutor
from services.simulation.domain import case_packages
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
    "schelling_segregation": ("actor_id", "origin", "destination", "before", "after", "changed_neighbors", "terminal", "checkpoint_event"),
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
    boundaries = json.loads((ROOT / "cases" / "boundaries.json").read_text())
    spatial = definitions["schelling_segregation"]
    spatial["scenarios"].append({"id": "boundary", "parameters": boundaries["schelling_segregation"]["parameters"]})
    requests = [{"id": key, "choices": [item["id"], "prediction-0"], "policy": policy}
                for key, (_, baseline, comparison) in CASES.items()
                for item in definitions[key]["action"]["options"] for policy in (baseline, comparison)]
    requests += [{"id": "schelling_segregation", "choices": [item["id"], "prediction-0"], "policy": policy}
                 for item in spatial["action"]["options"] for policy in (0, boundaries["schelling_segregation"]["parameters"]["threshold"])]
    requests += [
        {"id": key, "seed": definitions[key]["seed"] + offset,
         "choices": [definitions[key]["action"]["default"], "prediction-0"], "policy": policy}
        for key, (_, baseline, comparison) in CASES.items() if key != "beer_game"
        for offset in (1, 2) for policy in (baseline, comparison)
    ]
    for action in ("move", "stay"):
        for scenario, policy in (("baseline", 30), ("higher", 50)):
            parent = schelling.simulate(spatial, scenario, spatial["seed"], action)
            for row, following in zip(parent["events"], parent["events"][1:]):
                if row["event_type"] != "round_end" or following["event_type"] == "market_close":
                    continue
                board = parent["snapshots"][row["seq"]]["grid"]["cells"]
                origin = board.index("A001")
                destinations = [cell for cell, occupant in enumerate(board) if occupant is None and
                                schelling.satisfied(schelling.counts(board, schelling.SIZE, cell, "A001", origin), policy)]
                if destinations:
                    requests.append({"id": spatial["case_id"], "choices": [action, "prediction-0"], "policy": policy,
                                     "relocation": {"checkpoint": row["seq"], "round": row["round"],
                                                    "destination": destinations[0]}})

    report = subprocess.run(["node", "frontend/tests/remaining_parity.mjs", "--pipe"], cwd=ROOT,
                            input=json.dumps(requests), text=True, capture_output=True, check=True)
    counts = Counter()
    tutor_count = tutor_closes = 0
    event_focus_count = 0
    fork_count = fork_frames = 0
    for request, line in zip(requests, report.stdout.splitlines(), strict=True):
        browser = json.loads(line)
        key = request["id"]
        action = request["choices"][0]
        case = definitions[key]
        label = f"{key}/{action}/{browser['scenario']}"
        seed = request.get("seed", case["seed"])
        relocation = request.get("relocation")
        if relocation:
            label += f"/fork:{relocation['checkpoint']}:{relocation['destination']}"
            actual = schelling.simulate(case, browser["scenario"], seed, action,
                                        relocation=(relocation["round"], relocation["destination"]))
            run_id = (f"{key}/{schelling_tutor.ENGINE}|{seed}|{action}|{browser['scenario']}"
                      f"~fork-v1:{relocation['checkpoint']}:{relocation['destination']}")
            seq = actual["events"][-1]["seq"]
            assert browser["reviewSource"] == {
                "run_id": run_id, "seq": seq, "digest": schelling_tutor.replay_digest(run_id, actual, seq),
            }, label
            fork_count += 1
            fork_frames += len(actual["events"])
        else:
            actual = CASES[key][0].simulate(case, browser["scenario"], seed, action)
        assert browser["seed"] == seed, label
        assert len(browser["metrics"]) == len(actual["events"]), (label, len(browser["metrics"]), len(actual["events"]))
        for event, expected, metrics, snapshot in zip(browser["records"], actual["events"], browser["metrics"],
                                                       actual["snapshots"], strict=True):
            assert event["event_type"] == expected["event_type"], (label, event, expected)
            assert event["seq"] == expected["seq"], (label, event, expected)
            assert metrics.keys() == snapshot["metrics"].keys(), (label, event, metrics, snapshot["metrics"])
            assert_matches(metrics, snapshot["metrics"], f"{label}.{event['seq']}.metrics")
            if key == "schelling_segregation":
                assert browser["grids"][event["seq"]] == snapshot["grid"], (label, event["seq"], "board")
            data = event.get("data", {})
            for field in EVIDENCE[key]:
                if field in expected:
                    assert field in data, (label, event["seq"], field)
                    assert_matches(data[field], expected[field], f"{label}.{event['seq']}.{field}")
        if not relocation and key == schelling_tutor.CASE_ID and seed == case["seed"]:
            scenario = browser["scenario"]
            run_id = f"{key}/{schelling_tutor.ENGINE}|{seed}|{action}|{scenario}"
            close = browser["tutorClose"]
            assert (close["run_id"], close["seq"]) == (run_id, actual["events"][-1]["seq"]), label
            assert close["digest"] == schelling_tutor.completion_digest(run_id, actual), label
            tutor_closes += 1
            if scenario == "baseline":
                seqs = [event["seq"] for event in actual["events"] if event["event_type"] in schelling_tutor.MOVES]
                for seq, anchor in zip(seqs, browser["tutorAnchors"], strict=True):
                    assert (anchor["run_id"], anchor["event_seq"]) == (run_id, seq), (label, seq)
                    assert anchor["digest"] == schelling_tutor.replay_digest(run_id, actual, seq), (label, seq)
                    tutor_count += 1
        elif (key in course_event_tutor.guides() and seed == case["seed"]
              and browser["scenario"] in {"baseline", course_event_tutor.guides()[key]["policy"]}):
            package = case_packages()[key]
            versions = (package.caseVersion, package.browserContentVersion)
            run_id = f"{key}/browser-v1|{seed}|{action}|{browser['scenario']}"
            seqs = [event["seq"] for event in actual["events"]
                    if event["seq"] > 0 and event["event_type"] in course_event_tutor.guides()[key]["events"]]
            for seq, focus in zip(seqs, browser["publicFocuses"], strict=True):
                assert (focus["run_id"], focus["event_seq"]) == (run_id, seq), (label, seq)
                assert focus["digest"] == course_event_tutor.prefix_digest(key, run_id, versions, actual, seq), (label, seq)
                event_focus_count += 1
        counts[key] += len(actual["events"])
    for key in CASES:
        print(f"{key}: {counts[key]} event frames matched")
    print(f"{len(requests)} paired trajectories, {sum(counts.values())} frames matched")
    print(f"{fork_count} inter-round Schelling branches, {fork_frames} frames and full review prefixes matched")
    print(f"{tutor_count} Schelling relocation prefixes and {tutor_closes} closing records matched")
    print(f"{event_focus_count} selected public event prefixes matched across nine courses")


if __name__ == "__main__":
    main()
