"""Generate a deterministic 20-seed regression receipt for all published cases."""
from argparse import ArgumentParser
import json
from pathlib import Path
from statistics import median

from services.simulation.auction import CASE, digest, run_auction
from services.simulation.lessons import CATALOG, load_case, simulate

OUTPUT = Path("docs/release/seed-matrix.json")


def summarize(samples):
    metrics = {}
    for key in samples[0]:
        if not all(s[key] is None or type(s[key]) in (int, float) for s in samples):
            continue
        values = [s[key] for s in samples if s[key] is not None]
        metrics[key] = {"observed": len(values), "minimum": min(values, default=None),
                        "median": median(values) if values else None, "maximum": max(values, default=None)}
    return metrics


def generate():
    records = {}
    total = 0
    for case_id in CATALOG:
        definition = load_case(case_id)
        seeds = [definition["seed"] + offset for offset in range(20)]
        runs = []
        shared = {}
        for scenario in definition["scenarios"]:
            checksums, metrics = [], []
            for seed in seeds:
                name = scenario["id"]
                if case_id == CASE["case_id"]:
                    first = run_auction(name, seed, definition["preset_bid"])
                    second = run_auction(name, seed, definition["preset_bid"])
                else:
                    action = definition["action"]["default"]
                    first = simulate(definition, name, seed, action)
                    second = simulate(definition, name, seed, action)
                hash_ = digest(first)
                assert hash_ == digest(second), (case_id, name, seed)
                assert shared.setdefault(seed, first["root_hash"]) == first["root_hash"], (case_id, name, seed)
                checksums.append(hash_)
                metrics.append(first["metrics"])
                total += 1
            runs.append({"scenario": scenario["id"], "result_hashes_in_seed_order": checksums,
                         "metrics": summarize(metrics)})
        records[case_id] = {"case_version": definition["version"], "seeds": seeds, "scenarios": runs}
    return {"seed_count_per_case": 20, "repetitions": 2, "paired_scenario_seed_runs": total, "cases": records}


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    receipt = generate()
    serialized = json.dumps(receipt, ensure_ascii=False, indent=2) + "\n"
    if args.write:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(serialized)
    elif OUTPUT.read_text() != serialized:
        raise SystemExit("Seed receipt differs")
    print(f"{receipt['paired_scenario_seed_runs']} scenarios/seeds reproduced twice")
