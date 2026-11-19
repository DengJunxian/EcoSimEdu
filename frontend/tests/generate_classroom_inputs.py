"""Extract reproducible initial conditions and random inputs. No outcomes are stored."""
import base64
import hashlib
import json
import random
from argparse import ArgumentParser
from pathlib import Path

from services.simulation import auction, cascade, commons, matching, public_goods, schelling, svb

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/src/data"


def case_seed(case_id):
    return json.loads((ROOT / "cases" / case_id / "case.json").read_text())["seed"]


def schelling_inputs(seed):
    opening = schelling.initial_board(seed)
    ids = sorted(resident for resident in opening["grid"] if resident)
    keys = [f"{seed}:search:{round_no}:{resident}" for round_no in range(1, 9) for resident in ids]
    visits = []
    for round_no in range(1, 9):
        visit = ids.copy()
        random.Random(f"{seed}:visit:{round_no}").shuffle(visit)
        visits.append(visit)
    return {
        **opening,
        "visits": visits,
        "search_digests": base64.b64encode(b"".join(hashlib.sha512(key.encode()).digest() for key in keys)).decode(),
    }


def shared_inputs(offset=0):
    rng = random.Random(offset + case_seed("lemons_market"))
    qualities = list(range(1, 6)) * 6
    qualities.remove(5)
    rng.shuffle(qualities)
    rng = random.Random(offset + case_seed("information_cascade"))
    state = rng.choice(cascade.STATES)
    accuracy = cascade.Fraction(2, 3)
    signals = [cascade._draw(rng, state, accuracy) for _ in range(12)]
    rng = random.Random(offset + case_seed("public_goods"))
    targets = [10, rng.randint(10, 14), rng.randint(0, 3), rng.randint(13, 18)]
    noise = [[rng.randint(-2, 2) for _ in public_goods.PARTICIPANTS] for _ in range(10)]
    rng = random.Random(offset + case_seed("commons_governance"))
    users = [[rng.randint(2, 5), rng.randint(65, 95) / 100] for _ in commons.USERS]
    rng = random.Random(offset + case_seed("carbon_market"))
    firms = [[rng.randint(13, 24), rng.randint(2, 5) + i] for i in range(1, 9)]
    rng = random.Random(offset + case_seed("gamestop"))
    network = [f"关注投资者 {i}" for i in range(1, 6)]
    rng.shuffle(network)
    story_actors = [rng.choice([f"关注投资者 {i}" for i in range(1, 6)]) for _ in range(3)]
    rng = random.Random(offset + case_seed("flash_crash"))
    releases = [rng.randint(20, 26) for _ in range(12)]
    preferences, priorities = matching._profile(offset + case_seed("school_matching"))
    return {
        "qualities": [5, *qualities], "cascade": {"state": state, "signals": signals},
        "publicGoods": {"targets": targets, "noise": noise}, "commons": {"users": users},
        "firms": firms, "gamestop": {"network": network, "storyActors": story_actors},
        "flashCrash": releases, "schools": {"preferences": preferences, "priorities": priorities},
    }


def inputs():
    return schelling_inputs(case_seed("schelling_segregation")), shared_inputs()


def auction_inputs(seed):
    accounts = auction.initial_agents(seed)
    ids = [key for key in accounts if key != auction.CASE["player_id"]]
    rng = random.Random(seed ^ 0xDA14)
    rounds = []
    for _ in range(auction.CASE["rounds"]):
        rng.shuffle(ids)
        rounds.append([[actor, rng.randint(3, 18)] for actor in ids])
    return {"seed": seed, "accounts": accounts, "rounds": rounds}


def bank_inputs(seed):
    people = svb._depositors(seed)
    graph = svb._neighbors(people, seed, "concentrated")
    return {"seed": seed, "distributedOrder": list(graph), "people": [
        {"id": key, "group": person["group"], "deposit": person["deposit"],
         "payroll": person["payroll"], "payrollRound": person["payroll_round"],
         "protected": person["protected"], "threshold": person["threshold"], "neighbors": list(graph[key])}
        for key, person in people.items()
    ]}


def paired_inputs():
    offsets = (1, 2)
    return {
        "paired-inputs": {"classroom": [shared_inputs(offset) for offset in offsets],
                          "auction": [auction_inputs(case_seed("double_auction") + offset) for offset in offsets],
                          "svb": [bank_inputs(case_seed("svb_run") + offset) for offset in offsets]},
        "paired-schelling": [schelling_inputs(case_seed("schelling_segregation") + offset) for offset in offsets],
    }


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    command = parser.parse_args()
    datasets = {**dict(zip(("schelling-inputs", "classroom-inputs"), inputs(), strict=True)), **paired_inputs()}
    for name, data in datasets.items():
        path = OUT / f"{name}.json"
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
        if command.check:
            assert path.read_text() == payload, path
        elif not path.exists() or path.read_text() != payload:
            path.write_text(payload)
    print(f"{len(datasets)} input assets verified or generated")
