"""Cross-check the browser engine against the repository's independent Python SVB engine."""
from pathlib import Path
import json
import subprocess

from services.simulation.svb import _depositors, _neighbors, simulate
from services.simulation.ai.explanation_review import Source
from services.simulation.ai.svb_review import source_block
from services.simulation.domain import case_packages


ROOT = Path(__file__).resolve().parents[2]
CASE = json.loads((ROOT / "cases/svb_run/case.json").read_text())
package = case_packages()["svb_run"]
version = (package.caseVersion, package.browserContentVersion)
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
def compare(people, action, name, python, browser):
    assert source_block(Source.model_validate(browser["reviewSource"]), python, version, "回放"), (action, name)
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

    return len(browser["frames"])


checks = branch_checks = branches = 0
for seed in (CASE["seed"], CASE["seed"] + 1, CASE["seed"] + 2):
    people = _depositors(seed)
    for action in ("withdraw_now", "withdraw_later"):
        for name, policy in scenario.items():
            original = simulate(CASE, name, seed, action)
            pairs = json.loads(subprocess.check_output(
                ["node", "--input-type=module", "-e", """
import { forkSvb, svbCheckpoint, svbLesson } from './frontend/src/svb.ts';
import { svbExplanationSource } from './frontend/src/learning/tutor/financial-review-evidence.ts';
const [seed, action, policy] = process.argv.slice(1);
const run = Number(seed) === svbLesson.seed ? svbLesson.run : await svbLesson.prepareSeed(Number(seed));
const baseline = run({seed: Number(seed), choices: [action, 'at-payment'], policy: Number(policy)});
const point = baseline.frames.map(frame => svbCheckpoint(baseline, frame.tick)).find(Boolean);
const project = async world => {
  const last = world.frames.findLast(frame => frame.events.length > 0);
  return { ...world, reviewSource: await svbExplanationSource(world, last.tick, last.events.at(-1).id, svbLesson.casePackage) };
};
process.stdout.write(JSON.stringify({baseline: await project(baseline), point,
  branch: point && await project(forkSvb(baseline, point.tick))}));
""", str(seed), action, str(policy)], cwd=ROOT))
            baseline = pairs["baseline"]
            checks += compare(people, action, name, original, baseline)
            eligible = next(((event["round"] - 1, row["protective"]) for event in original["events"] for row in event.get("requests", [])
                             if row["person"] == CASE["player_id"] and row["protective"]), None)
            if eligible is None:
                assert "point" not in pairs and "branch" not in pairs
                continue
            tick, amount = eligible
            assert pairs["point"] == {"tick": tick, "available": amount}
            branch = pairs["branch"]
            assert branch["frames"][:tick + 1] == baseline["frames"][:tick + 1]
            assert branch["observations"][:tick + 1] == baseline["observations"][:tick + 1]
            reference = simulate(CASE, name, seed, action, defer_after=tick)
            branch_checks += compare(people, action, name, reference, branch)
            decision = next(event for event in branch["frames"][tick + 1]["events"] if event["kind"] == "decision")
            logged = next(event for event in reference["events"] if event["event_type"] == "student_deferred")
            assert decision["actorId"] == logged["actor_id"] and not decision["deltas"]
            assert logged["checkpoint_round"] == tick and logged["amount_deferred"] == amount
            branches += 1
            print(f"{seed} {action} {name}: baseline and deferred round {tick + 1} matched")
print(f"Verified opening data and {checks} frames across {len(scenario) * 6} baseline/policy paths.")
print(f"Verified {branches} checkpoint branches and {branch_checks} frames across Python and browser; all review prefixes matched.")
