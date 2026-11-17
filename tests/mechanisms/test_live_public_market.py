import pytest

from services.simulation import gamestop, public_goods
from services.simulation.lessons import load_case


def run(module, case_id, decision=None):
    case = load_case(case_id)
    return module.simulate(case, "baseline", case["seed"], case["action"]["default"], decide=decision)


def select_action(module, case_id, choice):
    calls = []

    def decide(actor, stage, observation, allowed, default):
        assert choice in allowed and default in allowed
        calls.append((actor, stage, observation))
        return choice

    result = run(module, case_id, decide)
    assert len(calls) == 1
    actor, stage, observation = calls[0]
    selected = [event for event in result["events"] if event["event_type"] == "agent_action_selected"]
    assert len(selected) == 1
    marker = selected[0]
    assert (marker["actor_id"], marker["stage"], marker["action"]) == (actor, stage, choice)
    return result, marker, observation


def test_public_goods_selection_changes_the_simultaneous_round_and_ledger():
    outcomes = []
    for choice in ("0", "20"):
        result, marker, visible = select_action(public_goods, "public_goods", choice)
        timestamp = marker["seq"]
        earlier_contributions, earlier_settlement = result["events"][timestamp - 2:timestamp]
        contributions, settlement = result["events"][timestamp + 1:timestamp + 3]
        assert marker["actor_id"] == "P2" and marker["round"] == visible["round"] == 2
        assert visible["endowment_tokens"] == 20
        assert visible["previous_public_contributions"] == earlier_contributions["contributions"]
        assert visible["own_previous_payoff"] == earlier_settlement["net"]["P2"]
        assert "contributions" not in visible and "other_payoffs" not in visible
        assert contributions["contributions"]["P2"] == int(choice)
        expected_payoff = 20 - int(choice) + 0.4 * sum(contributions["contributions"].values())
        assert settlement["net"]["P2"] == pytest.approx(expected_payoff)
        outcomes.append(result)
    assert outcomes[0]["root_hash"] == outcomes[1]["root_hash"]
    assert outcomes[0]["metrics"]["total_contributions"] != outcomes[1]["metrics"]["total_contributions"]
    assert outcomes[0]["metrics"]["net_income"] != outcomes[1]["metrics"]["net_income"]


def test_market_selection_creates_only_a_funded_order_and_settles_at_resting_price():
    hold, mark_hold, _ = select_action(gamestop, "gamestop", "hold")
    buy, mark_buy, visible = select_action(gamestop, "gamestop", "buy_2")
    actor = mark_buy["actor_id"]
    assert actor == mark_hold["actor_id"] and mark_hold["time"] == mark_buy["time"] == 1
    assert set(visible["delivered_notices"]) == {"N1"}
    assert 2 * visible["max_buy_limit_cents"] <= visible["free_cash_cents"]
    assert not [event for event in hold["events"] if event["time"] == 1
                and event["event_type"] == "order_submitted" and event["actors"] == [actor]]
    order, trade = buy["events"][mark_buy["seq"] + 1:mark_buy["seq"] + 3]
    assert order["event_type"] == "order_submitted" and trade["event_type"] == "trade"
    assert (order["side"], order["quantity"], order["price_cents"]) == ("buy", 2, gamestop.BUY_LIMIT)
    assert trade["buyer"] == actor and trade["buy_order_id"] == order["order_id"]
    assert trade["price_cents"] == visible["public_ask_cents"]
    account = buy["snapshots"][trade["tick"]]["entities"][actor]
    assert account["现有股票（股）"] == visible["own_shares"] + 2
    assert account["现金（美元）"] * 100 == pytest.approx(visible["free_cash_cents"] - 2 * trade["price_cents"])
    assert buy["root_hash"] == hold["root_hash"]
    assert buy["metrics"]["discretionary_buys"] != hold["metrics"]["discretionary_buys"]


@pytest.mark.parametrize("module, case_id", [(public_goods, "public_goods"), (gamestop, "gamestop")])
def test_rule_choice_inside_live_keeps_offline_outcome(module, case_id):
    base = run(module, case_id)
    fallback = run(module, case_id, lambda actor, stage, observation, allowed, default: default)
    assert fallback["metrics"] == base["metrics"]
    assert fallback["root_hash"] == base["root_hash"]
    assert len(fallback["events"]) == len(base["events"]) + 1


@pytest.mark.parametrize("module, case_id, invalid", [(public_goods, "public_goods", "21"),
                                                       (gamestop, "gamestop", "buy_3")])
def test_model_cannot_submit_choice_outside_funding_or_endowment(module, case_id, invalid):
    with pytest.raises(ValueError, match="Unexpected"):
        run(module, case_id, lambda actor, stage, observation, allowed, default: invalid)
