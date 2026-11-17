"""A finite pooling market with one settlement after price discovery."""

from fractions import Fraction
import random

from .auction import digest

PREMIUM = Fraction(6, 5)
STUDENT = "S01"


def _pool_rounds(qualities):
    candidates = dict(qualities)
    while candidates:
        mean = Fraction(sum(candidates.values()), len(candidates))
        price = PREMIUM * mean
        willing = {actor: quality for actor, quality in candidates.items() if quality <= price}
        yield price, willing
        if willing == candidates:
            return
        candidates = willing


def simulate(case, scenario_id, seed, action):
    if action not in {"list", "keep"}:
        raise ValueError("Unknown listing choice")
    parameters = next(s["parameters"] for s in case["scenarios"] if s["id"] == scenario_id)
    information = parameters["information"]
    fee = Fraction(str(parameters["certification_fee"]))
    quality_values = list(range(1, 6)) * 6
    quality_values.remove(5)
    random.Random(seed).shuffle(quality_values)
    qualities = {f"S{i:02d}": quality for i, quality in enumerate([5, *quality_values], start=1)}
    initial = {"seed": seed, "student": STUDENT, "qualities": qualities, "premium": float(PREMIUM)}
    stock = {actor: quality for actor, quality in qualities.items() if actor != STUDENT or action == "list"}

    audited = {
        actor: quality for actor, quality in stock.items()
        if information == "certified" and (PREMIUM - 1) * quality >= fee
    }
    visible = dict(stock) if information == "informed" else audited
    hidden = {actor: quality for actor, quality in stock.items() if actor not in visible}
    events, snapshots = [], []
    metrics = {
        "quoted_pool_price": None,
        "willing_quality": None,
        "willing_supply": len(stock),
        "traded": 0,
        "certification_cost": 0.0,
        "net_surplus": None,
    }

    def record(event_type, summary, *, willing, actors=(), relations=(), expose=False, **details):
        index = len(events)
        events.append({
            "seq": index, "tick": index, "event_type": event_type, "summary": summary,
            "actors": list(actors), **details,
        })
        entities = {}
        for actor in qualities:
            row = {"挂牌": actor in stock, "当前愿售": actor in willing}
            if expose and actor in visible:
                row["买方可见的核验质量"] = visible[actor]
                row["个别报价"] = float(PREMIUM * visible[actor])
            if event_type == "settlement":
                row["复盘质量"] = qualities[actor]
                row["实际成交"] = actor in willing
            entities[actor] = row
        entities["B01"] = {"已知挂牌数": len(stock), "可见单件质量数": len(visible) if expose else 0}
        snapshots.append({"tick": index, "metrics": dict(metrics), "entities": entities, "relations": list(relations)})

    record(
        "market_open", f"30 位卖家各有一件商品。{len(stock)} 位选择挂牌，买家先观察公开的质量分布。",
        willing=stock, actors=[STUDENT, "B01"], listed=len(stock),
        listed_quality_distribution={str(q): sum(value == q for value in stock.values()) for q in range(1, 6)},
    )
    if audited:
        metrics["certification_cost"] = float(fee * len(audited))
        record(
            "certification", f"{len(audited)} 件商品通过核验并退出混合报价池，合计花费 {float(fee * len(audited)):g} 代币。",
            willing=stock, actors=audited, expose=True,
            relations=[{"from": "V01", "to": actor, "label": "第三方核验质量"} for actor in audited],
            certified=list(audited), fee=float(fee),
        )

    price = None
    remaining = dict(hidden)
    rounds = _pool_rounds(hidden) if hidden else [(None, {})]
    for iteration, (price, willing_pool) in enumerate(rounds, start=1):
        exits = [actor for actor in remaining if actor not in willing_pool]
        remaining = willing_pool
        willing = visible | willing_pool
        metrics.update(
            quoted_pool_price=float(price) if price is not None else None,
            willing_quality=sum(willing.values()) / len(willing) if willing else None,
            willing_supply=len(willing),
        )
        if price is None:
            summary = f"{len(willing)} 件商品收到按核验质量计算的个别报价，本轮没有混合报价。"
        else:
            summary = f"统一暂定报价 {float(price):.2f} 代币，混合池有 {len(willing_pool)} 件愿售，{len(exits)} 件退出。"
        record(
            "offer_iteration", summary, willing=willing, actors=exits or ["B01"], expose=True,
            relations=[{"from": "B01", "to": actor, "label": "暂定报价"} for actor in willing],
            iteration=iteration, exited=exits, willing_pool=list(willing_pool), listed_stock=len(stock),
        )

    transactions = []
    for actor, quality in (visible | remaining).items():
        deal_price = PREMIUM * quality if actor in visible else price
        verification_cost = fee if actor in audited else Fraction(0)
        transactions.append({
            "seller": actor, "buyer": "B01", "quality_revealed_for_review": quality,
            "price": float(deal_price), "seller_gain": float(deal_price - quality - verification_cost),
            "buyer_gain": float(PREMIUM * quality - deal_price), "certification_cost": float(verification_cost),
        })
    total_cost = fee * len(audited)
    gains = (PREMIUM - 1) * sum((visible | remaining).values()) - total_cost
    metrics.update(traded=len(transactions), net_surplus=float(gains))
    record(
        "settlement", f"定价完成，市场一次性交割 {len(transactions)} 件，计入核验费用后的净剩余为 {float(gains):g} 代币。",
        willing=visible | remaining, actors=[STUDENT, "B01"], expose=True, transactions=transactions,
        relations=[{"from": row["seller"], "to": row["buyer"], "label": "最终交割"} for row in transactions],
        status="settled" if transactions else "no_trade",
    )
    return {
        "engine_version": "lemons-market/1", "initial": initial, "root_hash": digest(initial),
        "initial_hash": digest(initial), "intervention": parameters, "events": events, "snapshots": snapshots,
        "metrics": snapshots[-1]["metrics"],
    }
