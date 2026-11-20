"""Review saved explanations against their two cited Schelling frames."""

import re
from hmac import compare_digest

from ..emergence.schelling import MOVES
from ..lessons import load_case
from ..schelling import simulate
from .schelling_tutor import CASE_ID, classroom_replay, replay_digest


QUESTIONS = {
    "evidence": "两条事件分别支持主张的哪一部分？请指出记录中的具体行动或数值。",
    "mechanism": "哪条规则或学生决定触发了行动？请说明行动怎样改变了其他住户的邻域。",
    "calculation": "请写出同组邻接比例的分子和分母，再核对两条记录的时点与单位。",
    "conditions": "把这次运行的解释用于真实社区，需要先核实哪个条件？",
    "alternative": "还有什么能解释这组差异？下一次对照需要固定哪些条件才能检验它？",
}


def comparison_run(source, parent_id, parent, action):
    if source.run_id.startswith(parent_id + "~fork-v1:"):
        suffix = source.run_id.removeprefix(parent_id + "~fork-v1:")
        match = re.fullmatch(r"([1-9][0-9]{0,3}):(0|[1-9][0-9]{0,2})", suffix)
        if match is None:
            return None
        checkpoint, destination = map(int, match.groups())
        if checkpoint >= len(parent["events"]) or source.seq <= checkpoint:
            return None
        event = parent["events"][checkpoint]
        if event["event_type"] != "round_end":
            return None
        case = load_case(CASE_ID)
        try:
            run = simulate(case, "baseline", case["seed"], action, relocation=(event["round"], destination))
        except ValueError:
            return None
        if run["events"][checkpoint + 1].get("checkpoint_event") == checkpoint:
            return run
        return None

    scenario = source.run_id.rsplit("|", 1)[-1]
    if scenario in {"zero", "higher", "boundary"}:
        run_id, run = classroom_replay(action, scenario)
        if source.run_id == run_id and run["initial_hash"] == parent["initial_hash"]:
            return run
    return None


def source_block(source, run, label):
    if source.event_id is not None or source.seq >= len(run["events"]) or not compare_digest(
        source.digest, replay_digest(source.run_id, run, source.seq)
    ):
        return None
    event = run["events"][source.seq]
    metrics = run["snapshots"][source.seq]["metrics"]
    threshold = run["intervention"]["threshold"]
    text = (f"{label}事件 {source.seq}。阈值 {threshold}%，累计搬迁 {metrics['moves']} 次，"
            f"同组邻接 {metrics['similarity']}%，达标 {metrics['satisfied']}%。")
    if event["event_type"] in MOVES:
        decision = "学生选择" if event["event_type"] == "student_move" else "住户按阈值规则"
        same_before, total_before = event["before"]
        same_after, total_after = event["after"]
        text += (f"{event['actor_id']} {decision}搬迁，同组／已占邻格从 "
                 f"{same_before}/{total_before} 变为 {same_after}/{total_after}。")
    else:
        text += event["summary"]
    return {"text": text, "event_seqs": [source.seq]}


def evidence(query):
    fields = query.baseline.run_id.split("|")
    if len(fields) != 4 or fields[2] not in {"move", "stay"}:
        return None
    action = fields[2]
    baseline_id, baseline = classroom_replay(action)
    if baseline_id != query.baseline.run_id:
        return None
    first = source_block(query.baseline, baseline, "基线")
    if first is None:
        return None
    comparison = comparison_run(query.comparison, baseline_id, baseline, action)
    if comparison is None:
        return None
    label = "分支" if "~fork-v1:" in query.comparison.run_id else "政策组"
    second = source_block(query.comparison, comparison, label)
    if second is None:
        return None
    return first, second
