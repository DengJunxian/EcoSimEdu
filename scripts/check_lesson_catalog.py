"""Validate and regenerate a compact result receipt for the published catalog."""
import argparse
import json
import math

from services.simulation.auction import CASE, ROOT, digest, run_auction
from services.simulation.lessons import CATALOG, load_case, simulate

STEPS = ["intro", "predict", "bid", "observe", "explain", "compare", "notebook"]


def receipt(case_ids=CATALOG):
    output = {}
    for case_id in case_ids:
        lesson = load_case(case_id)
        assert lesson["case_id"] == case_id and lesson["version"]
        assert len({source["id"] for source in lesson["sources"]}) == len(lesson["sources"])
        assert all(source["url"].startswith("https://") and source["supports"] for source in lesson["sources"])
        assert [stage["id"] for stage in lesson["lessons"]] == STEPS
        assert lesson["scenarios"][0]["id"] == "baseline" and len(lesson["scenarios"]) >= 3
        assert len({scenario["id"] for scenario in lesson["scenarios"]}) == len(lesson["scenarios"])
        assert set(lesson["questions"]["prediction"]["options"]) >= {"yes", "no", "unknown"}
        assert lesson["questions"]["explain"]["answer"] in lesson["questions"]["explain"]["options"]
        assert lesson["minimum_evidence"] >= 2
        legacy = case_id == CASE["case_id"]
        rows = []
        root = None
        for scenario in lesson["scenarios"]:
            key = scenario["id"]
            action = lesson["preset_bid"] if legacy else lesson["action"]["default"]
            run = (run_auction(key, lesson["seed"], action) if legacy
                   else simulate(lesson, key, lesson["seed"], action))
            assert run["engine_version"] and digest(run["initial"]) == run["initial_hash"]
            root = root or run["root_hash"]
            assert root == run["root_hash"]
            assert len(run["snapshots"]) == len(run["events"]) and run["events"]
            kinds = {"trade"} if legacy else set(lesson["evidence_types"])
            eligible = [e for e in run["events"] if e["event_type"] in kinds]
            assert len(eligible) >= lesson["minimum_evidence"]
            for i, (event, frame) in enumerate(zip(run["events"], run["snapshots"], strict=True)):
                assert event["seq"] == event["tick"] == frame["tick"] == i
                if not legacy:
                    assert event["summary"]
                    assert set(frame["metrics"]) == {metric["id"] for metric in lesson["metrics"]}
                    assert all(value is None or isinstance(value, (int, float)) and math.isfinite(value)
                               for value in frame["metrics"].values())
                    if "relations" in frame:
                        assert all(edge["from"] and edge["to"] and edge["label"] for edge in frame["relations"])
            if not legacy:
                assert run["metrics"] == run["snapshots"][-1]["metrics"]
                assert run["intervention"] == scenario["parameters"]
            rows.append({"scenario": key, "seed": lesson["seed"], "action": action, "intervention": run["intervention"],
                         "events": len(run["events"]), "citable": len(eligible), "engine": run["engine_version"],
                         "root_hash": root, "initial_hash": run["initial_hash"], "result_hash": digest(run),
                         "metrics": run["metrics"]})
        output[case_id] = rows
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--milestone", choices=("m2", "m3"))
    args = parser.parse_args()
    milestone = args.milestone or ("m3" if len(CATALOG) >= 12 else "m2")
    count = {"m2": 6, "m3": 12}[milestone]
    if len(CATALOG) < count:
        raise SystemExit(f"{milestone} requires {count} published cases")
    output = ROOT / f"docs/audit/{milestone}-runs.json"
    runs = receipt(CATALOG[:count])
    serialized = json.dumps(runs, ensure_ascii=False, indent=2) + "\n"
    if args.write:
        output.write_text(serialized)
    elif output.read_text() != serialized:
        raise SystemExit("Catalog verification receipt differs")
    print(f"{len(runs)} cases, {sum(map(len, runs.values()))} deterministic runs")
