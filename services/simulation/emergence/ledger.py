"""Trace public transitions from each existing classroom ledger."""

from types import SimpleNamespace

from ..auction_view import project_auction
from ..flagship_view import project_flagship
from ..lessons import load_case
from ..projection import metric_registry
from .schemas import EmergenceTrace, Focus, TraceEdge, TraceNode, source_ref


def _node(identifier, kind, label, refs, **fields):
    return TraceNode(id=identifier, kind=kind, label=label, source_refs=refs, **fields)


def _auction(run, seq, perspective, actor):
    view = project_auction(run, seq)
    event = view["events"][seq]
    focus = actor or (event.get("buyer_id") or event.get("actor_id") or "B01")
    account = view["frame"]["accounts"].get(focus)
    ref = source_ref(run, event)
    nodes, edges = [], []
    if account:
        nodes.append(_node("actor", "actor_state",
                           f"{focus} · 现金 {account['cash']} 代币，持有 {account['goods']} 件",
                           [ref], actor_id=focus))
    if perspective == "system" and (settlement := view["settlement"]):
        for side, label in (("buy", "买单"), ("sell", "卖单")):
            order = settlement[side]
            nodes.append(_node(side, "relation", f"{label} {order['order_id']} · {order['actor_id']} · 报价 {order['price']}",
                               [source_ref(run, order), ref]))
        maker = settlement["maker_order_id"]
        edges.append(TraceEdge(source="buy", target="sell", kind="model_rule",
                               label=f"两张报价实际撮合，成交价取先到簿的订单 {maker} 的价格。",
                               source_refs=[*nodes[-2].source_refs[:1], *nodes[-1].source_refs[:1], ref]))
    return event, nodes, edges


def _groups(run, seq, perspective, actor):
    view = project_flagship(run, seq)
    events = view["events"]
    event = events[seq]
    frame = view["frame"]
    public_goods = run["case_id"] == "public_goods"
    focus = actor or ("P1" if public_goods else "零售商")
    state = frame["entities"].get(focus, {})
    ref = source_ref(run, event)
    nodes, edges = [], []
    fields = ("本轮净收益", "累计净收益") if public_goods else ("期末库存", "期末积压", "本周下单", "本周到货")
    for field in fields:
        if state.get(field) is not None:
            nodes.append(_node(f"actor:{field}", "actor_state", f"{focus} · {field}", [ref],
                               actor_id=focus, value=state[field], unit="代币" if public_goods else "件"))
    if perspective == "role":
        return event, nodes, edges
    for i, relation in enumerate(frame.get("relations", [])):
        if actor and actor not in (relation["from"], relation["to"]):
            continue
        origin = relation.get("origin_seq")
        refs = [source_ref(run, events[origin]), ref] if type(origin) is int and 0 <= origin < seq else [ref]
        nodes.append(_node(f"relation:{i}", "relation",
                           f'{relation["from"]} → {relation["to"]} · {relation["label"]}', refs))
    if public_goods and event.get("event_type") == "settlement":
        gross, cost, fines, net = (sum(event[key].values()) for key in ("gross", "outgoing", "fines", "net"))
        if abs(gross - cost - fines - net) < 1e-9:
            nodes.append(_node("round_net", "group_metric", "小组本轮净收益", [ref], value=net, unit="代币"))
            edges.append(TraceEdge(source="round_net", target="metric", kind="accounting_identity",
                                   label=f"本轮全组毛收益 {gross:g} − 施罚成本 {cost:g} − 扣损 {fines:g} ＝ 净收益 {net:g}。",
                                   source_refs=[ref]))
    if not public_goods and seq and state:
        before = view["previous"]["entities"][focus]["期末库存"]
        arrived = state["本周到货"]
        shipped = (event["delivered"] - events[seq - 1]["delivered"] if focus == "零售商" else
                   sum(batch["amount"] for batch in event["dispatches"] if batch["sender"] == focus))
        if before + arrived - shipped == state["期末库存"]:
            edges.append(TraceEdge(source="actor:期末库存", target="metric", kind="accounting_identity",
                                   label=f"{focus} · 周初库存 {before} ＋ 实际到货 {arrived} − 真实发货 {shipped}"
                                         f" ＝ 期末库存 {state['期末库存']} 件。",
                                   source_refs=[source_ref(run, events[seq - 1]), ref]))
    return event, nodes, edges


def trace(run, seq, as_of_seq, metric_id, perspective, actor=None):
    case_id = run["case_id"]
    case = load_case(case_id)
    is_auction = case_id == "double_auction"
    adapter = ADAPTERS[case_id]
    project = _auction if is_auction else _groups
    event, nodes, edges = project(run, seq, perspective, (actor or adapter.ROLE_ACTOR) if perspective == "role" else actor)
    ref = source_ref(run, event)
    descriptor = adapter.METRICS[metric_id]
    if perspective == "system":
        frame = run["result"]["snapshots"][seq]
        value = frame.get("metrics", frame).get(metric_id)
        units = {item["id"]: item["unit"] for item in metric_registry(case)}
        nodes.append(_node("metric", "system_metric", descriptor, [ref], metric_id=metric_id,
                           value=value, unit=units[metric_id]))
    clock = "week" if case_id == "beer_game" else "round"
    status = "exact_identity" if edges and edges[0].kind == "accounting_identity" else "rule_trace" if edges else "partial"
    return EmergenceTrace(case_id=case_id, run_id=ref.run_id, result_hash=ref.result_hash, as_of_seq=as_of_seq,
                          perspective=perspective, focus=Focus(event_seq=seq, metric_id=metric_id, clock=clock,
                                                               economic_time=event.get(clock)),
                          evidence_level=status, nodes=nodes, edges=edges, notes=[])


ADAPTERS = {
    case_id: SimpleNamespace(ROLE_ACTOR=actor, trace=trace,
                             METRICS={item["id"]: item["label"] for item in metric_registry(load_case(case_id))
                                      if item["id"] != "surplus"})
    for case_id, actor in (("double_auction", "B01"), ("public_goods", "P1"), ("beer_game", "零售商"))
}
