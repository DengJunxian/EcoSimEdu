"""Match each cited browser transaction to an independently replayed SVB ledger."""

import re
from hmac import compare_digest

from ..auction import digest
from ..lessons import load_case
from ..svb import simulate
from .schelling_review import QUESTIONS as COMMON_QUESTIONS

QUESTIONS = {**COMMON_QUESTIONS,
             "mechanism": "这笔记录反映了哪一步？请说明它怎样影响待付、现金、权益或下一轮储户行动。",
             "calculation": "请用这两笔事件的前后账表核算一项变化，并说明为什么现金与权益的变化可能不同。",
             "conditions": "把这组结果用于真实银行，需要另外核实哪项资金来源、存款结构或保障条件？"}

METRICS = ("cash", "requested", "paid", "queued", "equity", "price", "sold", "deposits", "borrowing")


def atomic_events(run):
    # Python logs batches; the browser exposes their individual transactions in queue order.
    for event in run["events"]:
        step, kind = event["round"], event["event_type"]
        if kind == "revaluation":
            old, new = event["old_price"], event["new_price"]
            yield step, kind, None, {"price": new - old, "equity": -event["mark_loss"]}, f"证券标价由 {old} 降至 {new}。"
        elif kind == "student_deferred":
            actor, amount = event["actor_id"], event["amount_deferred"]
            yield step, "decision", actor, {}, f"{actor} 暂缓申请 {amount} 资金单位的防御性提款。"
        elif kind == "requests":
            for row in event["requests"]:
                actor, amount = row["person"], row["requested"]
                text = f"{actor} 申请 {amount}，其中工资款 {row['payroll']}、防御性提款 {row['protective']}。"
                yield step, "request", actor, {"requested": amount, "queued": amount}, text
        elif kind == "support":
            amount = event["draw"]
            yield step, kind, None, {"cash": amount, "borrowing": amount}, f"借入 {amount}，现金与借款负债同增。"
        elif kind == "sale":
            units, amount, loss = event["units"], event["proceeds"], event["realized_loss"]
            yield step, kind, None, {"sold": units, "cash": amount, "equity": -loss}, f"急售证券 {units} 单位，到手现金 {amount}，折价损失 {loss}。"
        elif kind == "payments":
            for row in event["payments"]:
                actor, amount = row["person"], row["amount"]
                text = f"{actor} 到账 {amount}，现金和存款负债等额减少。"
                yield step, "payment", actor, {"cash": -amount, "deposits": -amount, "paid": amount, "queued": -amount}, text


def source_block(source, run, version, label):
    if not source.event_id:
        return None
    step, position = map(int, source.event_id.split("/"))
    if step != source.seq:
        return None
    opening = run["snapshots"][0]
    bank = opening["entities"]["BANK"]
    totals = opening["metrics"] | {"price": bank["证券现价"], "sold": 0,
                                   "deposits": bank["存款负债"], "borrowing": bank["支持借款负债"]}
    start = [totals[key] for key in METRICS]
    rows = []
    current_step, within_round = 0, 0
    for tick, kind, actor, changes, text in atomic_events(run):
        if tick > step:
            break
        if tick != current_step:
            current_step, within_round = tick, 0
        within_round += 1
        rows.append([tick, kind, actor, [changes.get(key, 0) for key in METRICS]])
        before = totals.copy()
        for key, value in changes.items():
            totals[key] += value
        if tick == step and within_round == position:
            if not compare_digest(source.digest, digest(["svb-review/1", source.run_id, *version, start, rows])):
                return None
            pairs = (("cash", "现金"), ("queued", "待付"), ("equity", "权益"))
            ledger = "，".join(f"{name} {before[key]}→{totals[key]}" for key, name in pairs)
            return {"text": f"{label}事件 {source.event_id}。{text} 该笔前后（资金单位）{ledger}。",
                    "event_seqs": [tick], "event_ids": [source.event_id]}
    return None


def evidence(query):
    case = load_case("svb_run")
    seed = case["seed"]
    actions = {option["id"]: f"svb/browser-v1/{seed}/{option['id']}/0" for option in case["action"]["options"]}
    action = next((name for name, run_id in actions.items() if run_id == query.baseline.run_id), None)
    if action is None:
        return None
    base_id = actions[action]
    buffer = next(scenario["parameters"]["cash_reallocation"] for scenario in case["scenarios"]
                  if scenario["id"] == "liquidity_buffer")
    prefix = base_id.removesuffix("/0")
    policies = {f"{prefix}/network": "network", f"{prefix}/{buffer}": "liquidity_buffer"}
    branch_id = query.comparison.run_id
    fork = re.fullmatch(re.escape(base_id) + r"~fork-v1:([1-9][0-9]{0,2}):defer-protective", branch_id)
    checkpoint = int(fork[1]) if fork else None
    if checkpoint is not None:
        if query.comparison.seq <= checkpoint:
            return None
        scenario = "baseline"
    elif branch_id in policies:
        scenario = policies[branch_id]
    else:
        return None
    version = (query.case_version, query.content_version)
    first = source_block(query.baseline, simulate(case, "baseline", seed, action), version, "基线")
    if first is None:
        return None
    try:
        comparison = simulate(case, scenario, seed, action, defer_after=checkpoint)
    except ValueError:
        return None
    second = source_block(query.comparison, comparison, version, "分支" if fork else "政策组")
    return (first, second) if second is not None else None
