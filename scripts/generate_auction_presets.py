"""Regenerate the exact replay assets from the frozen lesson settings."""
import argparse
import gzip
import json

from services.simulation.api import PRESETS
from services.simulation.auction import BOUNDARIES, CASE, SCENARIOS, digest, run_auction


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    presets = {}
    bids = {scenario: CASE["preset_bid"] for scenario in SCENARIOS}
    bids["boundary"] = BOUNDARIES[CASE["case_id"]]["bid"]
    for scenario, bid in bids.items():
        result = run_auction(scenario, CASE["seed"], bid)
        presets[scenario] = {"result_hash": digest(result), "result": result}
    serialized = json.dumps(presets, ensure_ascii=False, separators=(",", ":")) + "\n"
    if args.check:
        if gzip.decompress(PRESETS.read_bytes()).decode() != serialized:
            raise SystemExit("Replay assets differ from the deterministic recipe")
    else:
        PRESETS.write_bytes(gzip.compress(serialized.encode(), mtime=0))
    for scenario, stored in presets.items():
        print(scenario, stored["result_hash"], json.dumps(stored["result"]["metrics"], ensure_ascii=False))


if __name__ == "__main__":
    main()
