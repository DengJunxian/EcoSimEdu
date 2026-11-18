"""Cross-scale evidence for a real recorded relocation."""
from ..schelling import counts, neighborhood, satisfied
from .schemas import EmergenceTrace, Focus, TraceEdge, TraceNode, source_ref


MOVES = {"student_move", "move"}
METRICS = {"similarity": "同类邻接率", "satisfied": "居民满意率"}
ROLE_ACTOR = "A001"


def grid_metrics(frame, threshold):
    grid = frame.get("grid")
    if not grid:
        return {}
    cells, size = grid["cells"], grid["size"]
    occupied = {i: occupant for i, occupant in enumerate(cells) if occupant}
    same_pairs = total_pairs = satisfied_residents = 0
    for cell, occupant in occupied.items():
        neighbors = [i for i in neighborhood(size, cell) if i in occupied]
        similar = [i for i in neighbors if occupied[i][0] == occupant[0]]
        total_pairs += sum(i > cell for i in neighbors)
        same_pairs += sum(i > cell for i in similar)
        satisfied_residents += 100 * len(similar) >= threshold * len(neighbors)
    return {
        "similarity": round(same_pairs * 100 / total_pairs, 2) if total_pairs else None,
        "satisfied": round(satisfied_residents * 100 / len(occupied), 2) if occupied else None,
    }


def trace(run, seq, as_of_seq, metric_id, perspective, actor=None):
    result = run["result"]
    event = result["events"][seq]
    ref = source_ref(run, event)
    focus = Focus(event_seq=seq, metric_id=metric_id, clock="round", economic_time=event.get("round"))
    identity = dict(case_id=run["case_id"], run_id=ref.run_id, result_hash=ref.result_hash,
                    as_of_seq=as_of_seq, perspective=perspective, focus=focus)
    threshold = result["intervention"]["threshold"]
    if perspective == "role":
        actor = ROLE_ACTOR
    grid = result["snapshots"][seq].get("grid")
    personal = []
    if actor and grid and actor in grid["cells"]:
        cell = grid["cells"].index(actor)
        row, column = divmod(cell, grid["size"])
        profile = counts(grid["cells"], grid["size"], cell, actor)
        state = "达到阈值" if satisfied(profile, threshold) else "未达阈值"
        personal.append(TraceNode(id="focus-resident", kind="actor_state", actor_id=actor,
                                  label=f"{actor} · 第 {row + 1} 行第 {column + 1} 列 · "
                                        f"同组／已占邻居 {profile[0]}/{profile[1]} · {state}",
                                  source_refs=[ref]))
    if perspective == "role":
        return EmergenceTrace(**identity, evidence_level="partial", nodes=personal, edges=[],
                              notes=["居民镜头展示 A001 自己的邻域和阈值状态。"])
    relocation = event["event_type"] in MOVES
    nodes = [TraceNode(id="event", kind="event", label=event["summary"], source_refs=[ref]), *personal]
    edges = []
    notes = []
    if relocation:
        mover = event["actor_id"]
        nodes.append(TraceNode(id="mover", kind="actor_state", actor_id=mover,
                               label=mover, source_refs=[source_ref(run, event, mover)]))
        automatic = event["event_type"] == "move"
        edges.append(TraceEdge(source="mover", target="event", kind="model_rule" if automatic else "observed_transition",
                               label=("原址未达阈值，迁入使其达到阈值的可用空位。" if automatic
                                      else "学生选择迁入预留空位。"), source_refs=[ref]))
        for change in event["changed_neighbors"]:
            actor = change["actor"]
            related = source_ref(run, event, actor)
            nodes.append(TraceNode(id=actor, kind="relation", actor_id=actor,
                                   label=f"{actor} 的邻居集合受到影响", source_refs=[related]))
            edges.append(TraceEdge(source="event", target=actor, kind="observed_transition",
                                   label="本次搬迁记录了前后邻域", source_refs=[related]))
    else:
        notes.append("该点没有搬迁；可以查看这一时刻的系统指标。")

    verified = relocation
    ticks = (seq - 1, seq) if relocation else (seq,)
    for tick in ticks:
        frame = result["snapshots"][tick]
        frame_ref = source_ref(run, result["events"][tick])
        recomputed = grid_metrics(frame, threshold)
        for metric, label in METRICS.items():
            value = frame["metrics"].get(metric)
            node_id = f"{metric}:{tick}"
            nodes.append(TraceNode(id=node_id, kind="system_metric", label=label, metric_id=metric,
                                   value=value, unit="%", source_refs=[frame_ref]))
            if relocation and value is not None and value == recomputed.get(metric):
                edges.append(TraceEdge(source="event", target=node_id, kind="accounting_identity",
                                       label="已从该帧全部居民和占用邻接对复算",
                                       source_refs=[frame_ref, ref] if tick != seq else [ref]))
            else:
                verified = False
    if relocation and not verified:
        notes.append("当前记录或指标缺少复算依据。")
    return EmergenceTrace(**identity, evidence_level="exact_identity" if verified else "partial",
                          nodes=nodes, edges=edges, notes=notes)
