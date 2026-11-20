"""Review against the two cited records in the classroom order book."""

import re
from hmac import compare_digest

from ..auction import BOUNDARIES, CASE, SCENARIOS, digest, run_auction
from .schelling_review import QUESTIONS as COMMON_QUESTIONS

QUESTIONS = {**COMMON_QUESTIONS,
             "mechanism": "从这条记录能核对哪一侧的报价或订单变化？若有成交，哪张在簿单决定成交价？",
             "calculation": "请用原事件中的报价或账表核算差值，说明价差、成交量和费用各用什么单位。",
             "conditions": "把这组结果用于真实市场，需要核对哪项撮合规则、费用或报价条件？"}

BOOK_METRICS = ("best_bid", "best_ask", "volume", "surplus", "platform_cash")


def source_block(source, run, version, label):
    seq = source.seq
    if source.event_id is not None or seq >= len(run["events"]):
        return None
    rows = [[event, frame["orders"], [frame[key] for key in BOOK_METRICS]]
            for event, frame in zip(run["events"][:seq + 1], run["snapshots"][:seq + 1], strict=True)]
    if not compare_digest(source.digest, digest(["auction-review/1", source.run_id, *version, rows])):
        return None
    event = run["events"][seq]
    names = {"market_open": "开盘", "market_close": "收盘", "order_submitted": "挂单",
             "order_rejected": "报价被拒", "order_cancelled": "撤单", "trade": "成交"}
    kind = event["event_type"]
    text = f"{label}事件 {seq}，{names[kind]}。"
    if kind == "trade":
        text += (f"{event['buy_order_id']} 和 {event['sell_order_id']} 以在簿单 {event['maker_order_id']} 的 "
                 f"{event['price']} 代币成交 {event['quantity']} 件，平台收取 {event['platform_fee']} 代币。")
    elif "order_id" in event:
        text += f"{event['actor_id']} 的订单 {event['order_id']}。"
        if "price" in event:
            text += f"报价 {event['price']} 代币。"
        if event.get("source") == "student" and "checkpoint_event" in event:
            text += "学生主动撤单。"
    quotes = ["／".join("空" if price is None else str(price) for price in values[:2])
              for _, _, values in rows[-2:]]
    _, _, volume, surplus, _ = rows[-1][2]
    text += (f"买一／卖一 {'→'.join(quotes)}（代币），事件后累计成交 {volume} 件，总剩余 {surplus} 代币。"
             f"单边费 {run['intervention']['fee']} 代币。")
    return {"text": text, "event_seqs": [seq]}


def evidence(query):
    seed = CASE["seed"]
    match = re.fullmatch(fr"double-auction/browser-v1/{seed}/(base|boundary)/([1-9][0-9]{{0,2}})/0",
                         query.baseline.run_id)
    if match is None:
        return None
    market, raw_bid = match.groups()
    bid = int(raw_bid)
    base_shift = BOUNDARIES[CASE["case_id"]]["parameters"]["demand_shift"] if market == "boundary" else 0
    if bid > CASE["player_value"] + base_shift:
        return None
    fee = SCENARIOS["fee"]["fee"]
    base_id = query.baseline.run_id
    prefix = base_id.removesuffix("/0")
    policies = {f"{prefix}/{fee}": (base_shift, fee)}
    if market == "base":
        policies[f"{prefix}/demand"] = (SCENARIOS["demand"]["demand_shift"], 0)
    branch_id = query.comparison.run_id
    fork = re.fullmatch(re.escape(base_id) + r"~fork-v1:([1-9][0-9]{0,3}):cancel-open-order", branch_id)
    checkpoint = int(fork[1]) if fork else None
    if checkpoint is not None:
        if query.comparison.seq <= checkpoint:
            return None
        shift, cost = base_shift, 0
    elif branch_id in policies:
        shift, cost = policies[branch_id]
    else:
        return None
    version = (query.case_version, query.content_version)
    base = run_auction("baseline", seed, bid, parameters={"demand_shift": base_shift, "fee": 0})
    first = source_block(query.baseline, base, version, "基线")
    if first is None:
        return None
    try:
        comparison = run_auction("baseline", seed, bid, parameters={"demand_shift": shift, "fee": cost},
                                 cancel_after=checkpoint)
    except ValueError:
        return None
    second = source_block(query.comparison, comparison, version, "分支" if fork else "政策组")
    return (first, second) if second is not None else None
