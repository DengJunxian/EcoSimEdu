"""Verify the six event chains documented in feedback-audit.md offline."""
import json
from pathlib import Path

from services.simulation.auction import digest
from services.simulation.lessons import load_case, simulate

RECEIPT = Path(__file__).resolve().parents[1] / "audit" / "m3-runs.json"


def replay(receipt, case_id, scenario="baseline"):
    lesson = load_case(case_id)
    recorded = next(row for row in receipt[case_id] if row["scenario"] == scenario)
    result = simulate(lesson, scenario, recorded["seed"], recorded["action"])
    assert digest(result) == recorded["result_hash"], (case_id, scenario)
    return result["events"], result["snapshots"]


def check_svb(receipt):
    events, frames = replay(receipt, "svb_run")
    assert events[2]["action"] == "withdraw_now"
    assert events[3]["requests"][0]["request_id"] == "D01-01"
    assert next(row for row in events[5]["messages"]
                if row["from"] == "D01" and row["to"] == "D02")["origin_seq"] == 3
    request = next(row for row in events[6]["requests"] if row["person"] == "D02")
    assert request["protective"] == 40 and request["observation_seqs"] == [3]
    assert frames[6]["metrics"]["queued"] == 325
    assert events[7]["realized_loss"] == 75 and frames[7]["metrics"]["equity"] == 155
    assert frames[9]["metrics"]["queued"] == 107
    assert any(row["origin_seq"] == 6 for row in events[10]["messages"])
    assert any(6 in row["observation_seqs"] for row in events[11]["requests"])


def check_schelling(receipt):
    events, frames = replay(receipt, "schelling_segregation")
    assert events[3]["actor_id"] == "B022" and events[3]["before"] == [1, 5]
    effect = next(row for row in events[3]["changed_neighbors"] if row["actor"] == "B052")
    assert effect["before"] == (1, 3) and effect["after"] == (0, 2)
    assert frames[2]["metrics"]["similarity"] == 50.52
    assert frames[3]["metrics"]["similarity"] == 50.81
    assert events[49]["actor_id"] == "B052" and events[49]["source"] == "rule"
    assert events[49]["before"] == [0, 2] and events[49]["after"] == [2, 6]
    assert frames[-1]["metrics"]["similarity"] == 81.11


def check_public_goods(receipt):
    baseline, baseline_frames = replay(receipt, "public_goods")
    events, frames = replay(receipt, "public_goods", "low_cost")
    assert events[1]["contributions"] == baseline[1]["contributions"]
    assert events[1]["contributions"]["P3"] == 2 and events[1]["public_return"] == 15.6
    assert events[2]["sanctions"] == [
        {"from": "P4", "to": "P3", "points": 2, "cost": 2, "fine": 6.0}
    ]
    assert frames[2]["metrics"]["net_income"] == 95.4
    assert events[3]["contributions"]["P3"] == 2 and baseline[3]["contributions"]["P3"] == 0
    assert frames[-1]["metrics"]["total_contributions"] == 405
    assert baseline_frames[-1]["metrics"]["total_contributions"] == 379
    assert frames[-1]["metrics"]["net_income"] == 963.0
    assert baseline_frames[-1]["metrics"]["net_income"] == 1027.4


def check_commons(receipt):
    events, frames = replay(receipt, "commons_governance")
    assert events[1]["requests"]["F01"] == events[1]["allocations"]["F01"] == 1
    assert sum(events[1]["allocations"].values()) == 75
    assert events[1]["start_stock"] == 180 and events[1]["remaining_stock"] == 105
    assert events[2]["next_stock"] == events[3]["start_stock"] == 137.484375
    assert events[3]["plans"]["F05"] == 3 and events[1]["plans"]["F05"] == 4
    assert frames[3]["metrics"]["harvest"] == 62 and frames[-1]["metrics"]["stock"] == 0


def check_cascade(receipt):
    events, frames = replay(receipt, "information_cascade")
    assert events[1]["signal"] == events[2]["signal"] == "B"
    assert events[2]["public_a_after_pct"] == 20.0
    assert events[3]["visible_action_ids"] == ["D01", "D02"]
    assert events[3]["signal"] == "A" and events[3]["choice"] == "B"
    assert events[3]["choice_if_private_a"] == events[3]["choice_if_private_b"] == "B"
    assert events[3]["information_added"] is False
    assert "D03" in events[4]["visible_action_ids"]
    assert events[3]["public_a_after_pct"] == events[4]["public_a_before_pct"] == 20.0
    assert frames[13]["metrics"]["cascade_decisions"] == 10 and events[13]["correct_count"] == 0


def check_beer_game(receipt):
    events, frames = replay(receipt, "beer_game")
    assert events[5]["orders"]["零售商"] == events[6]["demand_received"]["批发商"] == 12
    assert events[6]["dispatches"][0] == events[8]["arrivals"][0] == {
        "sender": "批发商", "receiver": "零售商", "amount": 12, "sent": 6, "due": 8, "origin_seq": 6
    }
    assert frames[7]["metrics"]["retail_stock"] == 0 and frames[8]["metrics"]["retail_stock"] == 4
    assert events[8]["production"] == 12 and events[9]["production"] == 20
    assert events[17]["arrivals"][0]["origin_seq"] == 15
    assert events[17]["demand_received"]["零售商"] == 8 and events[17]["orders"]["零售商"] == 3
    assert frames[17]["metrics"]["retail_stock"] == 20
    assert frames[-1]["metrics"]["factory_variance_ratio"] > 57


if __name__ == "__main__":
    receipt = json.loads(RECEIPT.read_text())
    checks = (check_svb, check_schelling, check_public_goods, check_commons, check_cascade, check_beer_game)
    for check in checks:
        check(receipt)
    print(f"{len(checks)} mechanism chains verified against M3 run hashes")
