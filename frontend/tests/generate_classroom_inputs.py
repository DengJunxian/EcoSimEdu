"""Extract reproducible initial conditions and random inputs. No outcomes are stored."""
import base64
import hashlib
import json
import random
from pathlib import Path

from services.simulation import cascade, commons, matching, public_goods, schelling

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/src/data"


def case_seed(case_id):
    return json.loads((ROOT / "cases" / case_id / "case.json").read_text())["seed"]


def schelling_inputs():
    seed = case_seed("schelling_segregation")
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


def inputs():
    board = schelling_inputs()
    rng = random.Random(case_seed("lemons_market"))
    qualities = list(range(1, 6)) * 6
    qualities.remove(5)
    rng.shuffle(qualities)
    rng = random.Random(case_seed("information_cascade"))
    state = rng.choice(cascade.STATES)
    accuracy = cascade.Fraction(2, 3)
    signals = [cascade._draw(rng, state, accuracy) for _ in range(12)]
    rng = random.Random(case_seed("public_goods"))
    targets = [10, rng.randint(10, 14), rng.randint(0, 3), rng.randint(13, 18)]
    noise = [[rng.randint(-2, 2) for _ in public_goods.PARTICIPANTS] for _ in range(10)]
    rng = random.Random(case_seed("commons_governance"))
    users = [[rng.randint(2, 5), rng.randint(65, 95) / 100] for _ in commons.USERS]
    rng = random.Random(case_seed("carbon_market"))
    firms = [[rng.randint(13, 24), rng.randint(2, 5) + i] for i in range(1, 9)]
    rng = random.Random(case_seed("gamestop"))
    network = [f"关注投资者 {i}" for i in range(1, 6)]
    rng.shuffle(network)
    story_actors = [rng.choice([f"关注投资者 {i}" for i in range(1, 6)]) for _ in range(3)]
    rng = random.Random(case_seed("flash_crash"))
    releases = [rng.randint(20, 26) for _ in range(12)]
    preferences, priorities = matching._profile(case_seed("school_matching"))
    return board, {
        "qualities": [5, *qualities], "cascade": {"state": state, "signals": signals},
        "publicGoods": {"targets": targets, "noise": noise}, "commons": {"users": users},
        "firms": firms, "gamestop": {"network": network, "storyActors": story_actors},
        "flashCrash": releases, "schools": {"preferences": preferences, "priorities": priorities},
    }


if __name__ == "__main__":
    for name, data in zip(("schelling", "classroom"), inputs(), strict=True):
        (OUT / f"{name}-inputs.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
