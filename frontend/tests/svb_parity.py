"""Cross-check the browser engine against the repository's independent Python SVB engine."""
from pathlib import Path
import json
import subprocess

from services.simulation.svb import _depositors, _neighbors, simulate


ROOT = Path(__file__).resolve().parents[2]
CASE = json.loads((ROOT / "cases/svb_run/case.json").read_text())
opening = json.loads((ROOT / "frontend/src/data/svb-opening.json").read_text())
seed = CASE["seed"]
assert opening["seed"] == seed
people = _depositors(seed)
graph = _neighbors(people, seed, "concentrated")
assert opening["people"] == [
    {"id": key, "group": person["group"], "deposit": person["deposit"],
     "payroll": person["payroll"], "payrollRound": person["payroll_round"],
     "protected": person["protected"], "threshold": person["threshold"], "neighbors": list(graph[key])}
    for key, person in people.items()
]

scenario = {
    "baseline": 0,
    "liquidity_buffer": next(row["parameters"]["cash_reallocation"] for row in CASE["scenarios"]
                             if row["id"] == "liquidity_buffer"),
    "network": -1,
}
keys = ("cash", "queued", "requested", "paid", "equity", "sale_loss")
ledger = {"units": "证券单位", "price": "证券现价", "marketValue": "证券市值",
          "loans": "贷款", "deposits": "存款负债", "borrowing": "支持借款负债"}
checks = 0
for action in ("withdraw_now", "withdraw_later"):
    for name, policy in scenario.items():
        python = simulate(CASE, name, seed, action)
        browser = json.loads(subprocess.check_output(
            ["node", "--input-type=module", "-e", """
import { simulateSvb } from './frontend/src/svb.ts';
const [seed, action, policy] = process.argv.slice(1);
process.stdout.write(JSON.stringify(simulateSvb({seed: Number(seed), choices: [action, 'at-payment'], policy: Number(policy)})));
""", str(seed), action, str(policy)], cwd=ROOT))
        snapshots = {0: python["snapshots"][0]}
        requests, payments, messages = {}, {}, {}
        visible = {actor: set() for actor in people}
        assert browser["scenario"] == name
        assert {actor: tuple(values) for actor, values in browser["network"].items()} == python["initial"]["network"]
        for event in python["events"]:
            tick = event["round"]
            snapshots[tick] = python["snapshots"][event["seq"]]
            if "requests" in event:
                requests[tick] = [(item["person"], item["requested"]) for item in event["requests"]]
            if "payments" in event:
                payments[tick] = [(item["person"], item["amount"]) for item in event["payments"]]
            if "messages" in event:
                messages[tick] = event["messages"]
        reference = snapshots[0]
        originals = {}
        for frame in browser["frames"]:
            tick = frame["tick"]
            reference = snapshots.get(tick, reference)
            values = frame["metrics"]
            assert {key: values[key] for key in keys} == reference["metrics"], (action, name, tick)
            assert {key: values[key] for key in ledger} == {
                key: reference["entities"]["BANK"][label] for key, label in ledger.items()}
            assert values["sold"] == reference["entities"]["MARKET"]["证券单位"]
            assert values["marketCash"] == reference["entities"]["MARKET"]["现金"]
            assert values["supportCash"] == reference["entities"]["SUPPORT"]["现金"]
            assert [actor["id"] for actor in frame["actors"]] == list(people)
            for delivery in messages.get(tick, []):
                origin = python["events"][delivery["origin_seq"]]
                visible[delivery["to"]].add((delivery["from"], origin["round"]))
            if tick:
                assert set(browser["observations"][tick]) == set(people)
                for actor, observed in browser["observations"][tick].items():
                    assert {(ref["actorId"], ref["tick"]) for ref in observed} == visible[actor]
                    assert all(originals[ref["eventId"]] == (ref["actorId"], ref["tick"]) and ref["tick"] < tick
                               for ref in observed)
            for event in frame["events"]:
                if event["kind"] == "request":
                    originals[event["id"]] = (event["actorId"], tick)
            for kind, rows, metric in (("request", requests, "requested"), ("payment", payments, "paid")):
                events = [(event["actorId"], event["deltas"][metric]) for event in frame["events"] if event["kind"] == kind]
                assert events == rows.get(tick, []), (action, name, tick, kind)
            checks += 1
        print(f"{action} {name}: {len(browser['frames'])} frames with matching amounts and ordered events")
print(f"Verified opening data and {checks} frames across {len(scenario) * 2} paths.")
