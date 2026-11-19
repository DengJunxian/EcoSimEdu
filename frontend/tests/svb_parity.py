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
}
keys = ("cash", "queued", "requested", "paid", "equity", "sale_loss")
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
        requests, payments = {}, {}
        for event in python["events"]:
            tick = event["round"]
            snapshots[tick] = python["snapshots"][event["seq"]]
            if "requests" in event:
                requests[tick] = [(item["person"], item["requested"]) for item in event["requests"]]
            if "payments" in event:
                payments[tick] = [(item["person"], item["amount"]) for item in event["payments"]]
        reference = snapshots[0]
        for frame in browser["frames"]:
            tick = frame["tick"]
            reference = snapshots.get(tick, reference)
            assert {key: frame["metrics"][key] for key in keys} == reference["metrics"], (action, name, tick)
            for kind, rows, metric in (("request", requests, "requested"), ("payment", payments, "paid")):
                events = [(event["actorId"], event["deltas"][metric]) for event in frame["events"] if event["kind"] == kind]
                assert events == rows.get(tick, []), (action, name, tick, kind)
            checks += 1
        print(f"{action} {name}: {len(browser['frames'])} frames with matching amounts and ordered events")
print(f"Verified opening data and {checks} frames across {len(scenario) * 2} paths.")
