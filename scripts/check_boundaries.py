"""Recompute the 12 published boundary experiments and verify their event evidence."""

from argparse import ArgumentParser
from collections import Counter, defaultdict
import json

from services.simulation.auction import BOUNDARIES, ROOT, digest, run_auction
from services.simulation.lessons import CATALOG, load_case, simulate

RECEIPT = ROOT / "docs/release/rc9-boundaries.json"


def evidence(case_id, result):
    events = defaultdict(list)
    for index, (event, frame) in enumerate(zip(result["events"], result["snapshots"], strict=True)):
        assert event["seq"] == event["tick"] == frame["tick"] == index
        events[event["event_type"]].append(event)
    frames, metrics = result["snapshots"], result["metrics"]

    match case_id:
        case "double_auction":
            highest, lowest = max(result["demand"]), min(result["supply"])
            assert highest < lowest
            assert metrics["volume"] == metrics["ceiling"] == metrics["surplus"] == 0
            assert all(metrics[key] is None for key in ("price_min", "price_max", "price_band", "efficiency"))
            sides = Counter(event["side"] for event in events["order_submitted"])
            assert set(sides) == {"buy", "sell"} and not events["trade"]
            assert all(frame["last_price"] is None and frame["volume"] == 0 for frame in frames)
            assert frames[0]["accounts"] == frames[-1]["accounts"]
            return {"highest_buyer_value": highest, "lowest_seller_cost": lowest, "submitted": dict(sides)}
        case "schelling_segregation":
            moves = events["move"]
            assert moves and all(move["after"][0] == move["after"][1] for move in moves)
            assert metrics["remaining"] > 0 and events["market_close"][0]["terminal"] == "blocked"
            return {"automatic_moves": len(moves), "terminal": "blocked"}
        case "svb_run":
            request, sale, payment = (events[key][0] for key in ("requests", "sale", "payments"))
            assert frames[0]["metrics"]["cash"] == 0
            assert request["seq"] < sale["seq"] < payment["seq"] and sale["proceeds"] > 0
            assert metrics["paid"] > 0 and metrics["requested"] == metrics["paid"] + metrics["queued"]
            return {"opening_cash": 0, "first_sale_proceeds": sale["proceeds"],
                    "request_sale_payment_seqs": [request["seq"], sale["seq"], payment["seq"]]}
        case "information_cascade":
            decisions = events["decision"]
            assert len(decisions) == 12
            assert all(event["private_a_after_pct"] == event["public_a_after_pct"] == 50
                       and event["action_likelihood_given_a"] == event["action_likelihood_given_b"]
                       and not event["information_added"] and not event["cascade"] for event in decisions)
            assert metrics["cascade_start"] is None and not events["verification"]
            return {"decisions": len(decisions), "private_and_public_posterior_pct": 50}
        case "public_goods":
            settlements = events["settlement"]
            assert events["contributions"][0]["contributions"]["P1"] == 0
            assert result["intervention"]["unit_cost"] > 4 and len(settlements) == 10
            assert all(not event["sanctions"] and event["gross"] == event["net"] for event in settlements)
            assert metrics["sanction_cost"] == 0
            return {"first_student_contribution": 0, "settlements_without_sanctions": len(settlements)}
        case "commons_governance":
            withdrawals, growth = events["withdrawal"], events["growth"]
            assert len(withdrawals) == len(growth) == 12 and withdrawals[0]["requests"]["F01"] == 4
            assert all(sum(event["allocations"].values()) == 0 for event in withdrawals)
            assert all(event["growth"] == event["next_stock"] == 0 for event in growth)
            return {"first_student_request": 4, "periods_with_zero_withdrawal_and_growth": len(growth)}
        case "lemons_market":
            frames_with_quality = sum(frame["entities"]["B01"]["可见单件质量数"] != 0 for frame in frames)
            assert not events["certification"] and not frames_with_quality
            assert metrics["certification_cost"] == 0 and metrics["traded"] > 0
            assert all(tx["price"] == metrics["quoted_pool_price"] and tx["certification_cost"] == 0
                       for tx in events["settlement"][0]["transactions"])
            return {"certified": 0, "pooled_quote_rounds": len(events["offer_iteration"])}
        case "school_matching":
            opening = events["admissions_open"][0]
            assert opening["capacities"]["A"] == 0
            rejections = sum(item["school"] == "A" for event in events["round_resolution"] for item in event["rejected"])
            assignments = events["final_assignment"][0]["assignments"]
            assert rejections > 0 and "A" not in assignments.values()
            assert all(not event["held"]["A"] for event in events["round_resolution"])
            unmatched = len(opening["submitted"].keys() - assignments.keys())
            assert unmatched == 4
            return {"a_rejections": rejections, "a_assignments": 0, "unmatched": unmatched}
        case "beer_game":
            weeks = events["week_end"]
            assert len(weeks) == 40 and {event["demand_received"]["零售商"] for event in weeks} == {4}
            assert weeks[4]["orders"]["零售商"] == 8 and len({event["orders"]["工厂"] for event in weeks}) > 1
            assert all(frame["metrics"]["factory_variance_ratio"] is None for frame in frames)
            return {"weeks": len(weeks), "weekly_customer_demand": 4, "week_5_retail_order": 8}
        case "carbon_market":
            assert not events["transfer"] and not any(events["issuance"][0]["issue"].values())
            assert len(events["surrender"]) == 8 and all(not event["permits"] and event["emissions"] == 0
                                                         for event in events["surrender"])
            assert metrics["price"] is None and metrics["planned_emissions"] == 0
            marginal_cost = events["phase_end"][1]["max_marginal_abatement_cost"]
            assert marginal_cost > 0 and metrics["abatement_cost"] > 0
            return {"firms_surrendering_zero_permits": len(events["surrender"]), "max_marginal_abatement_cost": marginal_cost}
        case "flash_crash":
            released = sum(event["quantity"] for event in events["release"])
            assert len(events["pause"]) == 1 and not events["resume"]
            assert metrics["program_filled"] == 0 and metrics["program_queued"] == released > 0
            assert events["trade"] and all("卖出程序" not in event["actors"] for event in events["trade"])
            return {"released_shares": released, "background_trades": len(events["trade"])}
        case "gamestop":
            assert len(events["loan_blocked"]) == 1 and events["loan_blocked"][0]["quantity"] == 0
            assert not events["loan"] and events["trade"] and metrics["volume"] > 0
            assert all(frame["metrics"]["short_interest"] == frame["metrics"]["forced_cover"] == 0 for frame in frames)
            return {"loan_blocked_seq": events["loan_blocked"][0]["seq"], "ordinary_trades": len(events["trade"])}
    raise AssertionError(f"Missing verified boundary: {case_id}")


def audit():
    assert set(BOUNDARIES) == set(CATALOG)
    rows = []
    for case_id in CATALOG:
        definition = load_case(case_id)
        config = BOUNDARIES[case_id]
        seed = definition["seed"]
        assert "boundary" not in {scenario["id"] for scenario in definition["scenarios"]}
        if case_id == "double_auction":
            bid = config["bid"]
            result = run_auction("boundary", seed, bid)
            assert digest(run_auction("boundary", seed, bid)) == digest(result)
        else:
            action = config["action"]
            result = simulate(definition, "boundary", seed, action)
            assert digest(simulate(definition, "boundary", seed, action)) == digest(result)
        rows.append({
            "case_id": case_id, "case_version": definition["version"], "scenario_id": "boundary",
            "label": config["label"], "seed": seed, "input": {key: config[key] for key in ("bid", "action") if key in config},
            "parameters": config["parameters"], "engine_version": result["engine_version"],
            "result_hash": digest(result), "events": len(result["events"]), "final_metrics": result["metrics"],
            "evidence": evidence(case_id, result),
        })
    return rows


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    actual = json.dumps(audit(), ensure_ascii=False, indent=2) + "\n"
    if args.write:
        RECEIPT.write_text(actual)
    elif RECEIPT.read_text() != actual:
        raise SystemExit(f"Boundary evidence differs: {RECEIPT}")
    print(f"{len(CATALOG)} boundary experiments recomputed twice and verified")
