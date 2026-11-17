"""Seeded attention, funding and securities-borrow experiments."""
from random import Random

from .market_tape import MarketTape

STUDENT = "学生投资者"
SHORT = "借券账户"
LENDER = "出借账户"
DEALERS = tuple(f"报价者 {i}" for i in range(1, 5))
VALUE = tuple(f"估值投资者 {i}" for i in range(1, 5))
MOMENTUM = tuple(f"趋势投资者 {i}" for i in range(1, 5))
SOCIAL = tuple(f"关注投资者 {i}" for i in range(1, 6))
BUY_LIMIT = 2_000


def simulate(case, scenario_id, seed, action, *, decide=None):
    parameters = next(item["parameters"] for item in case["scenarios"] if item["id"] == scenario_id)
    if action not in {"buy", "observe"}:
        raise ValueError("unknown student choice")
    rng = Random(seed)
    existing = (*DEALERS, *VALUE, *MOMENTUM, *SOCIAL, STUDENT)
    accounts = {actor: {"cash": 16_000, "shares": 28 if actor in DEALERS else 4} for actor in existing}
    accounts[SHORT] = {"cash": 14_000, "shares": 0, "debt": 0}
    accounts[LENDER] = {"cash": 0, "shares": 18}
    network = list(SOCIAL)
    rng.shuffle(network)
    successor = dict(zip(network, network[1:] + network[:1]))
    stories = [{"time": time, "tone": tone, "actor": rng.choice(SOCIAL), "message_id": f"N{time}"}
               for time, tone in [(1, 1), (4, 1), (8, -1)]]
    root = {"accounts": accounts, "exogenous_events": stories, "network": successor, "action": action}
    initial = {**root, "borrow_available": parameters["loan_supply"]}
    cover_count = other_buys = social_buys = 0
    seen = {actor: {} for actor in SOCIAL}
    tape = MarketTape(root, initial, parameters, "gamestop/1", lambda: {
        "short_interest": tape.accounts[SHORT]["debt"], "forced_cover": cover_count,
        "discretionary_buys": other_buys, "social_buys": social_buys,
        "reach": sum(bool(origins) for origins in seen.values()),
    })

    def discretionary(amount, purpose):
        nonlocal other_buys, social_buys
        other_buys += amount
        if purpose == "转发关注":
            social_buys += amount

    def buy(actor, quantity, limit, purpose):
        lots = min(quantity, tape.available(actor, "buy") // limit)
        if lots:
            tape.submit(actor, "buy", limit, lots, purpose, immediate=True,
                        after_fill=lambda filled: discretionary(filled, purpose))

    def cover(mark):
        nonlocal cover_count
        borrower = tape.accounts[SHORT]
        debt = borrower["debt"]
        if not debt or borrower["cash"] * 100 >= 170 * debt * mark:
            return
        tape.emit("margin_call",
                  f"按成交价 {mark / 100:.2f} 美元估值，{debt} 股义务触发维持担保要求。",
                  [SHORT, LENDER], mark_cents=mark, maintenance_percent=170, debt=debt,
                  collateral_cents=borrower["cash"])
        limit = min(19_900, borrower["cash"] // debt)
        if limit < 100:
            tape.emit("cover_blocked", "抵押现金不足以提交覆盖全部未平仓股数的限价买单。",
                      [SHORT, LENDER], debt=debt, collateral_cents=borrower["cash"])
            return

        def filled(amount):
            nonlocal cover_count
            cover_count += amount

        acquired = tape.submit(SHORT, "buy", limit, debt, "强制回补", immediate=True, after_fill=filled)
        if acquired:
            borrower["shares"] -= acquired
            borrower["debt"] -= acquired
            tape.accounts[LENDER]["shares"] += acquired
            tape.emit("return", f"借券账户向出借账户交还 {acquired} 股，义务剩余 {borrower['debt']} 股。",
                      [SHORT, LENDER], [{"from": SHORT, "to": LENDER, "label": "借券交还"}],
                      quantity=acquired, remaining_debt=borrower["debt"])

    tape.emit("opening", "开局共有 20 个账户。先登记报价、现金和可供实际借出的股票。", [SHORT, LENDER, STUDENT])
    for i, actor in enumerate(DEALERS):
        tape.submit(actor, "buy", 998 - 3 * i, 8, "盘初被动买量")
    for i, ask in enumerate((1_002, 1_045, 1_090, 1_145, 1_210, 1_290, 1_380, 1_490, 1_620, 1_780)):
        tape.submit(DEALERS[i % len(DEALERS)], "sell", ask, 4 * parameters["offer_depth"], "盘初被动卖量")

    borrowing = parameters["loan_supply"]
    borrower = tape.accounts[SHORT]
    if borrowing > 0:
        if tape.available(LENDER, "sell") < borrowing or borrower["cash"] * 100 < borrowing * 1000 * 120:
            raise ValueError("loan exceeds stock or initial collateral")
        tape.accounts[LENDER]["shares"] -= borrowing
        borrower["shares"] += borrowing
        borrower["debt"] += borrowing
        tape.emit("loan", f"出借账户实际交付 {borrowing} 股。借券账户登记等量交还义务。",
                  [SHORT, LENDER], [{"from": LENDER, "to": SHORT, "label": "股票借出交付"}],
                  quantity=borrowing, debt=borrowing, collateral_cents=borrower["cash"])
        executed = tape.submit(SHORT, "sell", 100, borrowing, "借券卖出", immediate=True)
        remainder = borrowing - executed
        if remainder:
            borrower["shares"] -= remainder
            borrower["debt"] -= remainder
            tape.accounts[LENDER]["shares"] += remainder
            tape.emit("return", f"{remainder} 股借入后未卖出，已退还给出借账户。",
                      [SHORT, LENDER], quantity=remainder, remaining_debt=borrower["debt"])
    else:
        tape.emit("loan_blocked", "制度的可借股票为零。借券账户未提交卖单。",
                  [SHORT, LENDER], quantity=0)

    pending = []
    last_close = int(round(tape.last * 100)) if tape.last is not None else 1_000
    price_change = 0
    for time in range(1, 11):
        tape.clock = time
        for item in stories:
            if item["time"] == time:
                origin = tape.emit("message", f"{item['message_id']} 是本轮公开的教学话题。",
                                   [item["actor"]], message_id=item["message_id"], tone=item["tone"])
                pending.append((item, item["actor"], origin))
        current, pending = pending, []
        for item, actor, origin in current:
            publication = item["message_id"]
            if publication in seen[actor]:
                continue
            seen[actor][publication] = item["tone"]
            tape.emit("forward", f"{actor} 看到 {publication}。后续转发沿用同一来源编号。",
                      [actor], [{"from": item["actor"], "to": actor, "label": "看到同一话题", "origin_seq": origin}],
                      message_id=publication, origin_seq=origin, tone=item["tone"])
            pending.append((item, successor[actor], origin))

        if time == 1:
            tape.emit("student", "你提交小额买单。" if action == "buy" else "你保留现金并观察。",
                      [STUDENT], action=action)
            if action == "buy":
                buy(STUDENT, 2, 1_200, "学生自主买入")

        for actor in VALUE:
            if tape.book.get_best_ask() is not None and tape.book.get_best_ask() <= 1_020:
                buy(actor, 1, 1_020, "估值买入")
        for actor in MOMENTUM:
            if price_change >= 35:
                buy(actor, 1, BUY_LIMIT, "价格趋势买入")
        for actor in SOCIAL:
            attention = sum(seen[actor].values()) * parameters["social_weight"]
            if decide is not None and time == 1 and actor == stories[0]["actor"]:
                stage = "first_attention_order"
                free_cash = tape.available(actor, "buy")
                max_lots = min(2, free_cash // BUY_LIMIT)
                rule_lots = max(0, min(attention, max_lots))
                allowed = {"hold": "保留现金并观察"}
                allowed.update({f"buy_{lots}": f"用 20 美元/股限价买 {lots} 股" for lots in range(1, max_lots + 1)})
                observation = {
                    "market_round": time,
                    "role": "关注投资者",
                    "free_cash_cents": free_cash,
                    "own_shares": tape.accounts[actor]["shares"],
                    "public_bid_cents": tape.book.get_best_bid(),
                    "public_ask_cents": tape.book.get_best_ask(),
                    "public_last_trade_cents": None if tape.last is None else round(tape.last * 100),
                    "delivered_notices": dict(seen[actor]) if parameters["social_weight"] else {},
                    "max_buy_limit_cents": BUY_LIMIT,
                }
                chosen = decide(actor, stage, observation, allowed, f"buy_{rule_lots}" if rule_lots else "hold")
                if not isinstance(chosen, str) or chosen not in allowed:
                    raise ValueError("Unexpected funded buy choice")
                quantity = 0 if chosen == "hold" else int(chosen.removeprefix("buy_"))
                tape.emit("agent_action_selected", f"{actor} 选择{allowed[chosen]}。",
                          [actor], actor_id=actor, stage=stage, action=chosen, quantity=quantity)
                if quantity:
                    purpose = "转发关注" if attention > 0 else "关注账户自主买入"
                    buy(actor, quantity, BUY_LIMIT, purpose)
            elif attention > 0:
                buy(actor, min(attention, 2), BUY_LIMIT, "转发关注")

        mark = int(round(tape.last * 100)) if tape.last is not None else 1_000
        cover(mark)
        close = int(round(tape.last * 100)) if tape.last is not None else 1_000
        price_change = close - last_close
        last_close = close
        tape.emit("period_end", f"第 {time} 轮结束。保留本场逐笔成交、关注与借券记录。", [SHORT, LENDER, STUDENT])
    return tape.result()
