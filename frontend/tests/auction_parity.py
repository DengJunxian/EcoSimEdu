"""Verify inputs, every emitted event, order snapshots, and accounts against Python."""
from pathlib import Path
import json
import random
import subprocess

from services.simulation.auction import BOUNDARIES, CASE, initial_agents, run_auction

ROOT = Path(__file__).resolve().parents[2]
opening = json.loads((ROOT / "frontend/src/data/auction-opening.json").read_text())
seed = CASE["seed"]
assert opening["seed"] == seed
assert opening["accounts"] == initial_agents(seed)
ids = [key for key in opening["accounts"] if key != CASE["player_id"]]
rng = random.Random(seed ^ 0xDA14)
for expected in opening["rounds"]:
    rng.shuffle(ids)
    assert [[key, rng.randint(3, 18)] for key in ids] == expected

cases = [(False, bid, fee) for bid in (1, 96, 108) for fee in (0, 6)]
cases += [(True, 35, fee) for fee in (0, 6)]
cases += [(False, bid, -1) for bid in (1, 96, 108)]
pairs = [(seed, *scenario) for scenario in cases] + [
    (seed + offset, boundary, 35 if boundary else 96, policy)
    for offset in (1, 2) for boundary, policy in ((False, 0), (False, 6), (False, -1), (True, 0), (True, 6))
]
script = """
import { auctionLesson } from './frontend/src/auction.ts';
const inputs = JSON.parse(process.argv[1]);
const data = await Promise.all(inputs.map(async ([seed, boundary, bid, policy]) => {
  const lesson = auctionLesson(boundary);
  const execute = seed === lesson.seed ? lesson.run : await lesson.prepareSeed(seed);
  const run = execute({seed, choices: [String(bid), 'yes'], policy});
  return { ceiling: run.ceiling, frames: run.frames.map(({record, book, accounts, metrics}) =>
    ({record, book, accounts, metrics})) };
}));
process.stdout.write(JSON.stringify(data));
"""
browser = json.loads(subprocess.check_output(
    ["node", "--input-type=module", "-e", script, json.dumps(pairs)], cwd=ROOT))
frames_checked = 0
for selected_seed, result in zip(pairs, browser, strict=True):
    match_seed, boundary, bid, policy = selected_seed
    demand = next(scenario for scenario in CASE["scenarios"] if scenario["id"] == "demand")
    shift = BOUNDARIES["double_auction"]["parameters"]["demand_shift"] if boundary else demand["demand_shift"] if policy == -1 else 0
    fee = 0 if policy == -1 else policy
    legacy = run_auction("baseline", match_seed, bid, parameters={"demand_shift": shift, "fee": fee})
    assert result["ceiling"] == legacy["metrics"]["ceiling"]
    last_price = None
    for frame, event, snapshot in zip(result["frames"], legacy["events"], legacy["snapshots"], strict=True):
        assert frame["record"] == event, (boundary, bid, fee, event["seq"])
        assert frame["book"] == snapshot["orders"] and frame["accounts"] == snapshot["accounts"], event["seq"]
        metrics = frame["metrics"]
        for field in ("best_bid", "best_ask", "volume", "surplus", "platform_cash"):
            assert metrics[field] == snapshot[field], (field, event["seq"])
        if event["event_type"] == "trade":
            last_price = metrics["price"]
            assert last_price == event["price"]
        else:
            assert metrics["price"] is None
        assert last_price == snapshot["last_price"]
        frames_checked += 1
    for field in ("volume", "surplus", "platform_cash", "participant_surplus", "efficiency"):
        assert metrics[field] == legacy["metrics"][field], field
    print(f"seed={match_seed}, boundary={boundary}, bid={bid}, fee={fee}: {len(result['frames'])} frames")
print(f"{frames_checked} matching event, book and account frames across {len(pairs)} paths")
