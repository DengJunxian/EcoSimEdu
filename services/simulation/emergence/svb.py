"""Read-only banking flows and checks on the classroom's settlement ledger."""
from ..lessons import load_case
from .schemas import EmergenceTrace, Focus, TraceEdge, TraceNode, source_ref


METRICS = {"cash": "银行现金", "equity": "银行权益", "queued": "待付金额"}
ROLE_ACTOR = "D01"
BANK_FIELDS = ("现金", "证券市值", "贷款", "存款负债", "支持借款负债")


def trace(run, seq, as_of_seq, metric_id, perspective, actor=None):
    result = run["result"]
    events, frames = result["events"], result["snapshots"]
    event, frame = events[seq], frames[seq]
    ref = source_ref(run, event)
    kind, round_no = event["event_type"], event["round"]
    identity = dict(case_id=run["case_id"], run_id=ref.run_id, result_hash=ref.result_hash, as_of_seq=as_of_seq,
                    perspective=perspective, focus=Focus(event_seq=seq, metric_id=metric_id, clock="round",
                                                        economic_time=round_no))
    actor = ROLE_ACTOR if perspective == "role" else actor
    actor_state = frame["entities"].get(actor, {})
    nodes, edges, notes = [], [], []
    if actor_state:
        balance, pending = (actor_state.get(key) for key in ("存款余额", "等待支付"))
        nodes.append(TraceNode(id="depositor", kind="actor_state", actor_id=actor,
                               label=f"{actor} · 存款 {balance} · 本人待付 {pending}", source_refs=[ref]))
    if perspective == "role":
        return EmergenceTrace(**identity, evidence_level="partial", nodes=nodes, edges=edges, notes=[
            "储户镜头仅显示 D01 自己的账户。"
        ])

    nodes.append(TraceNode(id="event", kind="event", label=event["summary"], source_refs=[ref]))
    for i, message in enumerate(event.get("messages", [])):
        if actor and actor not in (message["from"], message["to"]):
            continue
        origin = events[message["origin_seq"]]
        source = source_ref(run, origin, message["from"])
        node = TraceNode(id=f"message:{i}", kind="relation", actor_id=message["to"],
                         label=f'{message["from"]} → {message["to"]} · 观察到提款申请',
                         source_refs=[source, ref])
        nodes.append(node)
        edges.append(TraceEdge(source=node.id, target="event", kind="observed_transition",
                               label="消息指向真实的源申请事件", source_refs=[source, ref]))

    for field, verb, amount_key in (("requests", "申请", "requested"), ("payments", "到账", "amount"),
                                    ("pending", "待付", "remaining")):
        for row in event.get(field, []):
            if actor and actor != row["person"]:
                continue
            nodes.append(TraceNode(id=row["request_id"], kind="relation", actor_id=row["person"],
                                   label=f'{row["request_id"]} · {verb} {row[amount_key]}',
                                   source_refs=[ref]))

    if actor_state and "风险评分" in actor_state and kind in {"messages", "requests", "sale", "support", "payments", "queue"}:
        rules = load_case(run["case_id"])["rules"]
        prior = max((before["seq"] for before in events[:seq] if before["round"] < round_no), default=0)
        sale = next((before for before in events[:seq]
                     if before["round"] == round_no - 1 and before["event_type"] == "sale"), None)
        observed = actor_state["已观察储户数"]
        terms = (rules["public_risk"], observed * rules["neighbor_signal"],
                 rules["sale_signal"] if sale else 0, rules["queue_signal"] if frames[prior]["metrics"]["queued"] else 0)
        score, threshold = actor_state["风险评分"], actor_state["行动阈值"]
        if sum(terms) == score:
            refs = [source_ref(run, events[prior]), ref]
            if sale:
                refs.insert(0, source_ref(run, sale))
            rule = " + ".join(map(str, terms))
            edges.append(TraceEdge(source="event", target="depositor", kind="model_rule",
                                   label=f'{actor} 的风险评分 {rule} = {score}，行动阈值 {threshold}。'
                                         "依次计入公共项、已见邻居、上一轮急售与当时待付信号。",
                                   source_refs=refs))
            notes.append("风险分进入防御性申请规则。触发还取决于可用资金、保障额和此前是否已经申请。")

    metrics = frame["metrics"]
    bank = frame["entities"]["BANK"]
    cash, securities, loans, deposits, borrowing = (bank[key] for key in BANK_FIELDS)
    verified = cash + securities + loans - deposits - borrowing == metrics["equity"]
    for metric, label in METRICS.items():
        nodes.append(TraceNode(id=metric, kind="system_metric", metric_id=metric,
                               label=label, value=metrics[metric], unit="资金单位", source_refs=[ref]))
    if verified:
        edges.append(TraceEdge(source="event", target="equity", kind="accounting_identity",
                               label=f'权益 = {cash} + {securities} + {loans} − {deposits} − {borrowing} = {metrics["equity"]}',
                               source_refs=[ref]))
    if metrics["requested"] - metrics["paid"] == metrics["queued"]:
        edges.append(TraceEdge(source="event", target="queued", kind="accounting_identity",
                               label=f'累计申请 {metrics["requested"]} − 累计实付 {metrics["paid"]} = 待付 {metrics["queued"]}',
                               source_refs=[ref]))
    else:
        verified = False
    if seq:
        previous_cash = frames[seq - 1]["metrics"]["cash"]
        previous_ref = source_ref(run, events[seq - 1])
        nodes.append(TraceNode(id="previous-cash", kind="system_metric", metric_id="cash", label="上帧银行现金",
                               value=previous_cash, unit="资金单位", source_refs=[previous_ref]))
        draw, sale_cash = event.get("draw", 0), event.get("proceeds", 0)
        paid = sum(row["amount"] for row in event.get("payments", []))
        if cash - previous_cash == draw + sale_cash - paid:
            edges.append(TraceEdge(source="previous-cash", target="cash", kind="accounting_identity",
                                   label=f"现金 {previous_cash} + 借入 {draw} + 实售收入 {sale_cash} − 实付 {paid} = {cash}",
                                   source_refs=[previous_ref, ref]))
        else:
            verified = False
    if not verified:
        notes.append("部分账表字段或资金变化没有通过复算。")
    return EmergenceTrace(**identity, evidence_level="exact_identity" if verified else "partial",
                          nodes=nodes, edges=edges, notes=notes)
