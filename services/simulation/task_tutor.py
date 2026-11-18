"""Scene-specific, reveal-bounded tutor. Observations come from classroom projections."""

from __future__ import annotations

import math
import re

from .auction_view import project_auction
from .flagship_view import project_flagship
from .lesson_scenes import load_lesson_scenes
from .learning_content import load_learning_package
from .projection import frame_metrics, metric_registry
from .tutor import EVENT_NUMBER, HISTORICAL_CUES, SYSTEM_REQUEST, _id_mentioned, _normalize, answer_tutor
from .tutor_hints import HINTS, SPECIAL_HINTS

_UUID = re.compile(r"\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b")
_ACTOR = re.compile(r"(?<![a-z0-9])[a-z]{1,2}\d{1,4}(?![a-z0-9])")
_ASSERTED_NUMBER = re.compile(r"(?:等于|为|变成|是|=|有|达到)\s*([+-]?\d+(?:\.\d+)?)")
_METRIC_ASSERTION = re.compile(
    rf"(?:{EVENT_NUMBER.pattern}\s*(?:中|的)?\s*[,，]?\s*|当前\s*)?"
    r"(?P<metric>[\w ]+?)\s*(?:等于|为|是|=)\s*"
    r"(?P<number>[+-]?\d+(?:\.\d+)?)\s*(?P<unit>[^\d\s?。,.!+-]*?)\s*(?:吗|么)?[?。.!]?"
)
_PRIVATE_METRICS = {"surplus", "platform_cash"}
_FACT_CUES = ("多少", "什么数", "发生了", "发生什么", "第几个", "我看到", "开局的数据", "有没有发生", "当前事件")
_ROLE_CUES = ("我是谁", "扮演", "我的角色", "我的任务", "我的身份", "我能做", "我的权限", "我负责")
_CONCEPT_CUES = ("什么是", "是什么", "指什么", "含义", "怎么定义", "指的是")
_PRIVATE_CUES = ("私有", "私人", "私信号", "隐藏", "底牌", "保留价", "意愿价格", "卖家成本", "买家估值")
_BOUNDARY_CUES = ("现实", "真实数据", "实时", "可推广", "可不可以推广", "有什么限制", "什么条件", "成立范围", "边界", "必然", "总会", "保证", "一定")
_COMPARE_CUES = ("对照", "比较", "相比", "增持现金", "增加缓冲", "更多现金", "提高现金", "反事实", "若把", "改成", "其他都")
_PREDICT_CUES = ("预测", "已经都", "猜", "估计会", "预判", "会怎样", "会不会", "可能会", "会发生什么", "能成交吗")
_MECHANISM_CUES = ("为什么", "怎么会", "怎么导致", "怎样导致", "如何产生", "缘由", "原因", "动机", "如何影响", "怎么传", "有什么后果", "有什么影响")
_NOTE_CUES = ("笔记", "复盘", "总结", "写解释", "自评", "评估我的")
_MECHANISM_EVENTS = {
    "double_auction": {"order_submitted", "order_cancelled", "trade"},
    "svb_run": {"queue", "payments", "sale", "requests"},
    "schelling_segregation": {"move", "student_move", "round_end"},
    "public_goods": {"settlement"},
    "beer_game": {"weekly_settlement", "settlement", "week_end"},
}
_DOMAINS = {
    "double_auction": ("报价", "买单", "卖单", "成交", "挂单", "剩余", "费用", "撮合", "市场"),
    "svb_run": ("工资", "到账", "取款", "提款", "兑付", "邻居", "银行", "挤兑", "净资产", "现金", "排队", "待付"),
    "schelling_segregation": ("住户", "居民", "邻居", "迁居", "阈值", "搬", "邻接", "隔离", "分居"),
    "public_goods": ("投入", "合作", "搭便车", "贡献", "禀赋", "惩罚", "小组", "公共池"),
    "beer_game": ("订单", "订货", "波动", "需求", "积压", "在途", "库存", "到货", "上游", "下游"),
    "information_cascade": ("抽样", "级联", "信号", "线索", "后验", "选择", "箱", "公开行动"),
    "lemons_market": ("质量", "挂牌", "报价", "卖家", "签约", "成交", "逆向选择"),
    "commons_governance": ("资源", "再生", "监督", "共同池", "管护", "提取", "取用"),
    "carbon_market": ("配额", "排放", "减排", "成交", "贸易", "碳价"),
    "school_matching": ("学生", "学校", "志愿", "优先", "匹配", "暂留", "阻挡", "名额"),
    "flash_crash": ("做市", "闪崩", "价格", "深度", "订单", "流动性", "撤单"),
    "gamestop": ("回补", "价格", "担保", "空头", "做空", "消息", "杠杆", "转发", "借股"),
}
_GENERIC = ("提示", "下一步", "怎么办", "自身", "本课", "当前", "这里", "为什么这样", "怎样对照", "对照时")
_MISCONCEPTIONS = {
    "double_auction": (("立即成交", "肯定成交"), "提交买单只表示进入撮合流程。先看可成交卖价和排队优先级。"),
    "svb_run": (("破产", "资不抵债", "净资产为负"), "待付队列记录清结算的流动性约束。判断账面净资产还要看单独的净资产指标。"),
    "public_goods": (("搭便车更好", "贡献没有用"), "保留投入可能增加个人收益。判断全组收益要另算所有成员收到的回报。"),
}


def _has(question, cues):
    return any(cue in question for cue in cues)


def _intent(question):
    if _has(question, _ROLE_CUES):
        return "role"
    if _has(question, _CONCEPT_CUES) and not (_has(question, ("当前事件", "本轮事件")) or EVENT_NUMBER.search(question)):
        return "concept"
    if _has(question, _BOUNDARY_CUES):
        return "boundary"
    if _has(question, _COMPARE_CUES):
        return "comparison"
    if _has(question, _MECHANISM_CUES):
        return "mechanism"
    if _has(question, _PREDICT_CUES):
        return "prediction"
    if _has(question, _FACT_CUES) or EVENT_NUMBER.search(question):
        return "mechanism"
    if _has(question, _NOTE_CUES + ("提示", "下一步", "卡住", "怎么办")):
        return "mechanism"
    return None


def _reply(intent, level, claim, action, *, kind="model", citations=(), scope=None):
    return {
        "kind": kind, "answer": claim, "claim": claim, "hint_level": level, "intent": intent,
        "evidence_ids": [item["id"] for item in citations], "citations": list(citations),
        "next_action": action, "unsupported_scope": scope, "delivery": "offline",
    }


def _event_ref(run, event):
    return {"kind": "event", "run_id": str(run["run_id"]), "tick": event["tick"], "seq": event["seq"],
            "id": f'{run["run_id"]}:{event["seq"]}', "label": f'定位事件 {event["seq"]}'}


def _observation(case, event, view, question):
    """Allowlisted public values. Never read participant objects or raw event summaries."""
    if event["event_type"] in {"initial", "opening", "init"} or event["tick"] == 0:
        return None
    metrics = frame_metrics(view["frame"])
    values = []
    registry = metric_registry(case)
    matched = [entry for entry in registry if _normalize(entry["label"]) in question
               or _id_mentioned(entry["id"], question)]
    for entry in matched or registry:
        if entry["id"] in _PRIVATE_METRICS:
            continue
        number = metrics.get(entry["id"])
        if type(number) in (int, float) and math.isfinite(number):
            values.append(f'{entry["label"]}为 {number} {entry["unit"]}')
    return f'所选模拟事件 {event["seq"]} 中，' + "，".join(values) + "。" if values else None


def _project(case_id, run, tick):
    if case_id == "double_auction":
        return project_auction(run, tick)
    return project_flagship(run, tick)


def _learning_help(case_id, scene, context, level):
    package = load_learning_package(case_id)
    if package is None:
        return None
    activity = next((row for row in package["activities"] if row["id"] == context.activity_id
                     and row["phase"] == scene), None)
    if not activity or context.item_id not in activity["assessment_item_ids"]:
        return None
    item = next((row for row in package["items"] if row["id"] == context.item_id
                 and row["version"] == context.item_version), None)
    if not item:
        return None
    feedback = item["feedback"]
    if context.explanation_draft is not None:
        fields = {"claim": "论断", "micro": "主体行动", "aggregation": "互动结果", "conditions": "成立条件",
                  "alternative_explanation": "替代解释"}
        missing = [label for key, label in fields.items() if not context.explanation_draft.get(key, "").strip()]
        claim = "可以补上" + "、".join(missing) + "。" if missing else "草稿包含论断、机制、条件和替代解释。"
        action = "选一条已引用事件，指出它如何支持一个具体机制步骤。"
        reply = _reply("learning", level, claim, action, scope="structure_only")
        reply["coach_options"] = {
            "evidence": action,
            "conditions": ("哪项条件一变，你的结论就需要重新检验？"
                           if not context.explanation_draft.get("conditions", "").strip()
                           else "给一个保留你已写条件的反例，解释还需要查哪个运行事件。"),
        }
        return reply
    if level == 3:
        return _reply("learning", level, feedback["explanation"], "换一个新条件再次作答。", scope="authored_exercise")
    evaluator = item["evaluator"]
    expected = evaluator.get("answers", evaluator.get("answer"))
    response = context.response
    if response is None or expected is None:
        return _reply("learning", level, feedback["hint"], "先写一步，再提交核对。", scope="authored_exercise")
    if response == expected:
        return _reply("learning", level, "这次作答符合本题判据。", "试着说明这一步为什么成立。",
                      scope="authored_exercise")
    if item["kind"] == "numeric" and isinstance(response, list) and len(response) == len(expected):
        fields = item["response_schema"]["fields"]
        mismatches = "、".join(field["label"] for field, value, target in zip(fields, response, expected) if value != target)
        claim = f"先核对{mismatches}。{feedback['hint']}"
    else:
        claim = feedback["hint"]
    return _reply("learning", level, claim, "按题目的条件修订后再提交。", scope="authored_exercise")


def task_answer(case, context, run):
    case_id = case["case_id"]
    question = _normalize(context.question)
    intent = _intent(question)
    level = context.hint_level
    generic_action = "在当前场景选一个观察项，或问本课规则如何影响它。"

    def decline(message, scope, action=generic_action):
        return _reply(intent, level, message, action, kind="insufficient", scope=scope)

    if not question or SYSTEM_REQUEST.search(question):
        return decline("请提出关于当前课程、任务或模拟证据的问题。", "out_of_scope")

    # Earlier scenes cannot be turned into a backdoor to a stored outcome.
    tick = context.tick if context.scene not in {"intro", "predict", "bid"} else None
    view = _project(case_id, run, tick) if run is not None and tick is not None else None
    events = {event["seq"]: event for event in view["events"]} if view else {}
    run_id = str(run["run_id"]) if run else None
    if set(_UUID.findall(question)) - {run_id} or any(str(ref.run_id) != run_id for ref in context.evidence):
        return decline("这条引用属于另一份运行。", "cross_run", "从当前运行重新选择证据。")
    if any(ref.seq not in events for ref in context.evidence):
        return decline("本场景的已揭示记录没有这条证据。", "event_unavailable")

    event_ticks = set(EVENT_NUMBER.findall(question))
    if len(event_ticks) > 1 or any("." in value for value in event_ticks):
        return decline("请每次核对一个事件编号。", "event_unavailable")
    event_tick = int(next(iter(event_ticks))) if event_ticks else None
    if event_tick is not None and (tick is None or not 0 <= event_tick <= tick or event_tick not in events):
        return decline("当前回放时点还没有揭示指定事件。", "event_unavailable",
                       "继续回放到该事件，或改查当前事件。")

    scenes = load_lesson_scenes(case_id)["scenes"]
    scene = next(item for item in scenes if item["id"] == context.scene)
    role = scene.get("role") or next((item["role"] for item in scenes if item.get("role")), {})
    player = _normalize(role.get("actor_id") or case.get("player_id") or "")
    allowed_actors = {player}
    if view:
        frame = view["frame"]
        allowed_actors.update(_normalize(actor) for actor in (frame.get("entities") or frame.get("accounts") or {}))
        allowed_actors.update(actor.casefold() for event in events.values() for actor in event.get("actors", [])
                              if isinstance(actor, str))
    if _has(question, HISTORICAL_CUES + ("来源", "出处")):
        historical = answer_tutor(case, question)
        if historical["kind"] == "history":
            refs = [{**item, "id": f'source:{item["source_id"]}'} for item in historical["citations"]]
            return _reply("boundary", level, historical["answer"], "打开来源，核对它支持哪项历史背景。",
                          kind="history", citations=refs)
        return decline("当前课程资料无法核对所指来源。", "source_unavailable",
                       "用课内登记的来源名称或编号查询。")

    mentioned_actors = set(_ACTOR.findall(question))
    actors = set(mentioned_actors)
    if context.actor:
        actors.add(_normalize(context.actor))
    if actors - allowed_actors:
        return decline("当前课堂画面无法核对所指主体。", "actor_unavailable", "选择画面上可见的主体再查询。")
    if case_id == "double_auction" and _has(question, ("一样", "相同", "同价")) and _has(question, ("买家", "多赚", "剩余")):
        return _reply("comparison", level,
                      "相同成交价只对齐支出的一部分。买方剩余还取决于各笔的买方价值及买方承担的费用。",
                      "先从成交记录核对买方身份，再到结算解释核对允许揭示的价值和费用。",
                      scope="private_information")
    if _has(question, _PRIVATE_CUES) and (intent != "concept" or actors - {player}):
        return decline("导师使用当前场景的公开事件和规则。", "private_information",
                       "改问公开动作、成交记录或相关规则。")

    if context.learning_context is not None and question in {"给我本题提示", "核对解释结构"}:
        response = _learning_help(case_id, context.scene, context.learning_context, level)
        return response or decline("当前活动或题目版本无法核对。", "learning_context_unavailable")

    if _ASSERTED_NUMBER.search(question):
        assertion = _METRIC_ASSERTION.fullmatch(question)
        entry = next((entry for entry in metric_registry(case) if assertion
                      and assertion["metric"].strip() in {_normalize(entry["label"]), entry["id"]}
                      and entry["id"] not in _PRIVATE_METRICS), None)
        if not entry or mentioned_actors:
            return decline("请指定一个公开指标，例如「当前银行现金为 0 吗」。", "unverified_number")
        if assertion["unit"] and assertion["unit"] != _normalize(entry["unit"]):
            return decline(f'「{entry["label"]}」以{entry["unit"]}计，请按该单位重新核对。', "metric_unit_mismatch")
        selected_tick = tick if event_tick is None else event_tick
        event = events.get(selected_tick)
        if not event or event["tick"] == 0:
            return decline("当前范围还没有可核对的结果事件。", "event_unavailable")
        selected = view if selected_tick == tick else _project(case_id, run, selected_tick)
        value = frame_metrics(selected["frame"]).get(entry["id"])
        if type(value) not in (int, float) or not math.isfinite(value):
            return decline("该事件没有这个指标的可见数值。", "event_unavailable")
        matches = math.isclose(float(assertion["number"]), value, rel_tol=entry.get("relative_tolerance", 0),
                               abs_tol=entry.get("absolute_tolerance", 0))
        verdict = "与记录一致" if matches else "与记录有差异"
        return _reply("mechanism", level,
                      f'所问数值{verdict}。事件 {event["seq"]} 的{entry["label"]}为 {value} {entry["unit"]}。',
                      "打开事件核对指标和单位。", kind="observation", citations=[_event_ref(run, event)])

    hints = HINTS[case_id]
    if case_id == "svb_run":
        if _has(question, ("邻居", "别人提款", "其他人提款", "别人取钱", "观察到提款", "挤兑传染", "别人取款")):
            hints = SPECIAL_HINTS["bank_network"]
        elif _has(question, _COMPARE_CUES):
            hints = SPECIAL_HINTS["bank_buffer"]

    if _has(question, _NOTE_CUES) and context.scene == "notebook":
        return _reply("mechanism", level, "自评时分别检查论点、证据、作用机制和成立条件。",
                      "为一句论点定位一个已记录事件，再补一句条件。")
    if intent == "role":
        claim = f'{role["label"]}。{role["goal"]}' if role else case["lessons"][0]["prompt"]
        return _reply(intent, level, claim, hints[0])
    if intent == "concept":
        concept = answer_tutor(case, question)
        if concept["kind"] == "concept":
            refs = [{**item, "id": f'concept:{item["label"]}'} for item in concept["citations"]]
            return _reply(intent, level, concept["answer"], hints[0], kind="concept", citations=refs)
    if intent == "boundary":
        boundary = scenes[-1].get("rubric") or case["questions"]["transfer"]["rubric"]
        return _reply(intent, level, boundary,
                      "指出哪项参数或信息条件变化后，需要重新验证。", scope="model_boundary")

    premise = _MISCONCEPTIONS.get(case_id)
    if premise and _has(question, premise[0]) and _has(question, ("都", "是不是", "所以", "等于", "肯定")):
        return _reply("mechanism", level, premise[1], hints[0], scope="premise_to_check")

    if event_tick is not None or (_has(question, _FACT_CUES) and intent == "mechanism"):
        if mentioned_actors:
            return decline("导师可核对公共指标。指定主体的可见变化请在观察面板核对。", "actor_metric_unavailable")
        selected_tick = tick if event_tick is None else event_tick
        if view and selected_tick in events:
            target_view = view if selected_tick == tick else _project(case_id, run, selected_tick)
            event = events[selected_tick]
            observation = _observation(case, event, target_view, question)
            if observation:
                return _reply(intent, level, observation, hints[0], kind="observation", citations=[_event_ref(run, event)])
        return decline("当前范围还没有可核对的结果事件。", "event_unavailable", hints[0])

    if intent is None or not _has(question, _DOMAINS[case_id] + _GENERIC + _NOTE_CUES):
        return decline("现有课程提示没有覆盖这个问法。", "unsupported_question")

    action = hints[0]
    scope = None
    if intent == "prediction":
        if context.prediction:
            action = "保留已记录的预测，回放时用一个事件核对依据。"
        else:
            action = "先选一个预测，把判断依据写成可观察的条件。"
    elif intent == "comparison":
        action = ("政策对照固定相关初态，只改待检验规则。初始处理先说明改了哪部分初态，"
                  "例如资产组合或空间布局，并记录其余共同条件。两类实验都按同一经济时钟对齐。"
                  "如果多个因素一起变化，只能解释组合差异。")
        scope = "paired_evidence_required"
    citations = []
    claim = hints[level - 1]
    if intent == "mechanism" and view:
        matching = _MECHANISM_EVENTS.get(case_id, set())
        candidate = next((events[ref.seq] for ref in reversed(context.evidence)
                          if events[ref.seq]["event_type"] in matching), None)
        if candidate is None:
            candidate = next((event for event in reversed(view["events"]) if event["event_type"] in matching), None)
        if candidate:
            citations = [_event_ref(run, candidate)]
            action = "跳到相关观察点，核对这条规则涉及的变量。"
            if case_id == "svb_run" and candidate["tick"] == tick and candidate["event_type"] == "queue":
                metrics = frame_metrics(view["frame"])
                claim += (f'当前银行现金为 {metrics["cash"]}，待付为 {metrics["queued"]}，'
                          f'净资产为 {metrics["equity"]}，均以资金单位计。')
                actor = context.actor or player.upper()
                rows = [row for row in candidate["pending"] if _normalize(row["person"]) == _normalize(actor)]
                if rows:
                    claim += f'其中 {rows[0]["person"]} 的待付金额为 {sum(row["remaining"] for row in rows)}。'
        else:
            scope = "mechanism_event_unavailable"
    return _reply(intent, level, claim, action, scope=scope, citations=citations)
