"""Verify inputs, every emitted event, order snapshots, and accounts against Python."""
from pathlib import Path
import json
import random
import subprocess

from services.simulation.auction import BOUNDARIES, CASE, initial_agents, run_auction
from services.simulation.ai.auction_review import source_block
from services.simulation.ai.explanation_review import Source
from services.simulation.domain import case_packages

ROOT = Path(__file__).resolve().parents[2]
opening = json.loads((ROOT / "frontend/src/data/auction-opening.json").read_text())
package = case_packages()["double_auction"]
version = (package.caseVersion, package.browserContentVersion)
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
import { auctionCheckpoint, auctionLesson, forkAuction } from './frontend/src/auction.ts';
import { auctionExplanationSource } from './frontend/src/learning/tutor/financial-review-evidence.ts';
const inputs = JSON.parse(process.argv[1]);
const data = await Promise.all(inputs.map(async ([seed, boundary, bid, policy]) => {
  const lesson = auctionLesson(boundary);
  const project = async run => ({ ceiling: run.ceiling, frames: run.frames.map(({record, book, accounts, metrics}) =>
    ({record, book, accounts, metrics})),
    reviewSource: await auctionExplanationSource(run, run.frames.at(-1).tick, lesson.casePackage) });
  const execute = seed === lesson.seed ? lesson.run : await lesson.prepareSeed(seed);
  const run = execute({seed, choices: [String(bid), 'yes'], policy});
  const points = run.frames.filter(frame => auctionCheckpoint(run, frame.tick));
  const checks = [points[0], points.find(frame => frame.metrics.volume > 0), points.at(-1)];
  return { baseline: await project(run), forks: await Promise.all([...new Set(checks.filter(Boolean))].map(async frame =>
    ({checkpoint: frame.tick, ...await project(forkAuction(run, frame.tick))}))) };
}));
process.stdout.write(JSON.stringify(data));
"""
browser = json.loads(subprocess.check_output(
    ["node", "--input-type=module", "-e", script, json.dumps(pairs)], cwd=ROOT))
def compare(result, legacy, label):
    assert source_block(Source.model_validate(result["reviewSource"]), legacy, version, "回放"), label
    assert result["ceiling"] == legacy["metrics"]["ceiling"]
    last_price = None
    for frame, event, snapshot in zip(result["frames"], legacy["events"], legacy["snapshots"], strict=True):
        assert frame["record"] == event, (label, event["seq"])
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
    for field in ("volume", "surplus", "platform_cash", "participant_surplus", "efficiency"):
        assert metrics[field] == legacy["metrics"][field], field
    return len(result["frames"])


frames_checked = branch_frames = branch_count = 0
for (match_seed, boundary, bid, policy), result in zip(pairs, browser, strict=True):
    demand = next(scenario for scenario in CASE["scenarios"] if scenario["id"] == "demand")
    shift = BOUNDARIES["double_auction"]["parameters"]["demand_shift"] if boundary else demand["demand_shift"] if policy == -1 else 0
    fee = 0 if policy == -1 else policy
    params = {"demand_shift": shift, "fee": fee}
    label = (match_seed, boundary, bid, policy)
    legacy = run_auction("baseline", match_seed, bid, parameters=params)
    frames_checked += compare(result["baseline"], legacy, label)
    for branch in result["forks"]:
        tick = branch["checkpoint"]
        reference = run_auction("baseline", match_seed, bid, parameters=params, cancel_after=tick)
        assert branch["frames"][:tick + 1] == result["baseline"]["frames"][:tick + 1]
        assert reference["events"][:tick + 1] == legacy["events"][:tick + 1]
        branch_frames += compare(branch, reference, (*label, tick))
        branch_count += 1
    print(f"seed={match_seed}, boundary={boundary}, bid={bid}, fee={fee}: {len(result['baseline']['frames'])} baseline frames, {len(result['forks'])} branches")
print(f"{frames_checked} matching event, book and account frames across {len(pairs)} paths")
print(f"{branch_count} student cancellation branches with {branch_frames} matching frames; all review prefixes matched")
