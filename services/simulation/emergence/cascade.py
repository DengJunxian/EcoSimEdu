"""Sequential evidence with the classroom's existing visibility policy."""
from ..cooperation_view import STUDENT
from ..flagship_view import project_flagship
from .schemas import EmergenceTrace, Focus, TraceEdge, TraceNode, source_ref


METRICS = {"public_a_pct": "A 箱公共后验", "public_choice_a_pct": "公开选择 A 的比例"}
ROLE_ACTOR = STUDENT


def trace(run, seq, as_of_seq, metric_id, perspective, actor=None):
    view = project_flagship(run, seq)
    event = view["events"][-1]
    ref = source_ref(run, event)
    decision = event["event_type"] == "decision"
    is_role = perspective == "role"
    own_move = decision and ROLE_ACTOR in event["actors"]
    nodes, edges, notes = [], [], []
    if is_role:
        if own_move and "signal" in event:
            nodes.append(TraceNode(id="decision", actor_id=ROLE_ACTOR, kind="actor_state",
                                   label=f'本人抽样 {event["signal"]}，选择 {event["choice"]}。', source_refs=[ref]))
        else:
            notes.append("本观察点没有该角色的行动记录。")
    elif decision:
        actor = event["actors"][0]
        label = "公开选择" if view["intervention"]["observe_actions"] else "选择（仅模型观察者可见）"
        nodes.append(TraceNode(id="decision", actor_id=actor, kind="actor_state",
                               label=f'{actor} {label} {event["choice"]}', source_refs=[source_ref(run, event, actor)]))
    if decision and (own_move or not is_role):
        sources = [ref]
        for earlier in view["events"][:-1]:
            if earlier["event_type"] == "verification" and earlier["origin_id"] in event["observed_origin_ids"]:
                source = source_ref(run, earlier, "V01")
                sources.append(source)
                nodes.append(TraceNode(id=f'verification:{earlier["seq"]}', kind="relation",
                                       label="本次决策已观察共同核验", source_refs=[source, ref]))
            if earlier["event_type"] != "decision" or earlier["actors"][0] not in event["visible_action_ids"]:
                continue
            source = source_ref(run, earlier, earlier["actors"][0])
            sources.append(source)
            nodes.append(TraceNode(id=f'action:{earlier["seq"]}', kind="relation",
                                   label=f'{earlier["actors"][0]} 可见行动 {earlier["choice"]}', source_refs=[source, ref]))
        if metric_id == "public_a_pct":
            for name, field in (("行动前", "public_a_before_pct"), ("行动后", "public_a_after_pct")):
                nodes.append(TraceNode(id=field, kind="system_metric", metric_id=metric_id,
                                       label=f"{name} A 箱公共后验", value=event[field], unit="%", source_refs=[ref]))
            rule = ("这次行动使公共后验更新。" if event["information_added"] else
                    "这次行动没有更新公共后验。")
            edges.append(TraceEdge(source="decision", target="public_a_after_pct", kind="model_rule",
                                   label=rule, source_refs=sources))
    elif not is_role:
        nodes.append(TraceNode(id=metric_id, kind="system_metric", metric_id=metric_id, label=METRICS[metric_id],
                               value=view["public_choice_a_pct"][seq] if metric_id == "public_choice_a_pct" else
                               view["series"][seq]["metrics"][metric_id], unit="%", source_refs=[ref]))
        notes.append("这里没有一位主体的公开决策，模型指标仍可核对。")
    if metric_id == "public_choice_a_pct" and decision and not is_role:
        decisions = [event for event in view["events"] if event["event_type"] == "decision"
                     and view["intervention"]["observe_actions"]]
        nodes.append(TraceNode(id=metric_id, kind="system_metric", metric_id=metric_id, label=METRICS[metric_id],
                               value=view["public_choice_a_pct"][seq], unit="%", source_refs=[ref]))
        if decisions:
            count_a = sum(event["choice"] == "A" for event in decisions)
            edges.append(TraceEdge(source="decision", target=metric_id, kind="accounting_identity",
                                   label=f"选 A 的公开行动 {count_a} 条 ÷ 已公开行动 {len(decisions)} 条。",
                                   source_refs=[source_ref(run, event) for event in decisions]))
        else:
            notes.append("本场策略隐藏前人的行动，公开选择的比例缺失。")
    return EmergenceTrace(case_id=run["case_id"], run_id=ref.run_id, result_hash=ref.result_hash,
                          as_of_seq=as_of_seq, perspective=perspective,
                          focus=Focus(event_seq=seq, metric_id=metric_id, clock="turn", economic_time=event.get("turn")),
                          evidence_level=("exact_identity" if metric_id == "public_choice_a_pct" else "rule_trace")
                          if edges else "partial", nodes=nodes, edges=edges, notes=notes)
