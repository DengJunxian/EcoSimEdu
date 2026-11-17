"""Published parameter domains and canonical effective configurations."""
from .auction import CASE


def choices(label, unit, values, path, rule, values_labels=None):
    return {"label": label, "unit": unit, "values": values, "value_labels": values_labels or {},
            "mechanism": path, "constraint": rule}


SPECS = {
    "double_auction": {
        "demand_shift": choices("每件买方价值上移", "代币／件", [0, 6, 12, 18], "auction.run_auction/initial",
                                "共同生成根保持不变，调整每单位买方价值。"),
        "fee": choices("每方交易费", "代币／件", list(range(13)), "auction.run_auction/quote",
                       "报价与交易费合计不得超过学生价值与现金。平台到账纳入总剩余。"),
    },
    "svb_run": {
        "cash_reallocation": choices("证券换现金", "资金单位", [0, 200, 400, 600], "svb.simulate/opening",
                                     "按期初价格等额扣减证券市值，初始权益不变。"),
        "network": choices("储户观察网", "", ["concentrated", "distributed"], "svb._neighbors",
                           "每名储户观察三人，人口、资产和外生冲击保持。",
                           {"concentrated": "集中", "distributed": "分散"}),
    },
    "schelling_segregation": {
        "threshold": choices("最低同组邻居比例", "%", [0, 10, 20, 30, 40, 50], "schelling.satisfied",
                             "空位不计入已占邻居，无邻居时达到阈值。"),
        "initial_layout": choices("社区初态", "", ["seeded", "mixed", "segregated"], "schelling.initial_board",
                                  "两组各 170 人、60 个空位。布局比较单独固定阈值。",
                                  {"seeded": "原始随机布局", "mixed": "交错混合", "segregated": "左右分区"}),
    },
    "information_cascade": {
        "observe_actions": choices("公开前序选择", "", [True, False], "cascade.simulate/decision",
                                   "同一组私人信号，仅改变是否可见前序公开行动。"),
        "verification_turn": choices("独立证据公布", "决策序位", [None, 4, 7, 10], "cascade.simulate/verification",
                                    "公布只影响之后的决策。空值表示无公布。"),
    },
    "public_goods": {
        "unit_cost": choices("每次制裁的个人成本", "代币", [None, 1, 2, 4], "public_goods.simulate/settlement",
                             "空值关闭制裁。支出与被罚分别从对应主体账户扣减。"),
    },
    "commons_governance": {
        "institution": choices("取用制度", "", ["open", "quota", "community"], "commons.simulate",
                               "分别应用实际的开放、总配额或社区监测规则。",
                               {"open": "开放", "quota": "配额", "community": "社区监测"}),
    },
    "lemons_market": {
        "information": choices("质量信息制度", "", ["pooled", "informed", "certified"], "lemons.simulate",
                               "认证费只在认证制度适用。", {"pooled": "混合报价", "informed": "可见质量", "certified": "认证"}),
        "certification_fee": choices("认证成本", "代币／件", [0, 0.5, 1], "lemons.simulate/certification",
                                     "正认证费要求认证制度，并计入认证交易的资源成本。"),
    },
    "school_matching": {
        "mechanism": choices("录取机制", "", ["deferred", "immediate"], "matching.match",
                             "始终遵守容量。原始偏好、申报和优先级保持。",
                             {"deferred": "延迟接受", "immediate": "即时接受"}),
        "extra_a_seats": choices("A 校新增席位", "席", [0, 1, 2], "matching.simulate/capacities",
                                 "只增 A 校容量，对比共同的申请轮次。"),
    },
    "beer_game": {
        "delay": choices("交货延迟", "周", [1, 2, 3], "beer.starting_state",
                         "改变延迟时对应重建开局在途管线，需求冲击保持。"),
        "share_demand": choices("共享终端需求", "", [False, True], "beer.run_chain/forecast",
                                "需求共享改变预测可见信息。"),
        "policy": choices("订货规则", "", ["heuristic", "track_orders", "order_up_to"], "beer.decide",
                          "规则应用于学生明确提交的周订单以外的决策。",
                          {"heuristic": "启发式", "track_orders": "追踪未到货", "order_up_to": "补至库存目标"}),
    },
    "carbon_market": {
        "cap": choices("总配额", "单位", [56, 64, 72, 80, 88], "carbon.simulate/abatement",
                       "整数消减依同一总量与成本排序。"),
        "policy": choices("减排制度", "", ["trade", "uniform"], "carbon.simulate/abatement",
                          "交易基准用全局边际排序配置。", {"trade": "可交易配额", "uniform": "均匀分摊"}),
        "allocation": choices("初始分配依据", "", ["emissions", "cost"], "carbon.simulate/issuance",
                              "改变初始权利，结算成本与资源成本分别计算。",
                              {"emissions": "按排放", "cost": "按成本"}),
    },
    "flash_crash": {
        "depth_multiplier": choices("基础深度倍数", "倍", [1, 2, 3], "flash_crash.simulate/order_book",
                                    "同时调整真实可用库存、现金和挂单。"),
        "withdraw_on_inventory": choices("触及库存后撤单", "", [False, True], "flash_crash.simulate/cancel",
                                         "撤去实际在簿的订单。"),
        "pause_steps": choices("触发后暂停", "模型步", [0, 5, 10, 15], "flash_crash.simulate/pause",
                               "0 表示关闭，暂停把待执行释放留在队列。"),
    },
    "gamestop": {
        "social_weight": choices("社会信号权重", "", [0, 1], "gamestop.simulate/message",
                                 "信号改变自动动作规则，交易量仍由撮合确定。"),
        "loan_supply": choices("可借券数量", "股", [0, 10], "gamestop.simulate/loan",
                               "实际借券受可交割库存上限约束。"),
        "offer_depth": choices("卖方深度倍数", "倍", [1, 2], "gamestop.simulate/order_book",
                              "订单深度与可用资产一并校验。"),
    },
}

ORDER_WEEKS = {str(index) for index in range(1, 41)}
CONTRIBUTION_ROUNDS = {str(index) for index in range(1, 11)}
EXTENDED_ENGINES = {"schelling_segregation": "schelling/2", "beer_game": "beer/2", "public_goods": "public-goods/2"}


class InvalidParameters(ValueError):
    pass


def baseline(case):
    opening = next(row for row in case["scenarios"] if row["id"] == "baseline")
    return preset_values(case, opening)


def preset_values(case, row):
    if case["case_id"] == CASE["case_id"]:
        return {key: row[key] for key in ("demand_shift", "fee")}
    return row["parameters"].copy()


def describe(case):
    case_id = case["case_id"]
    defaults = baseline(case)
    return {
        "case_id": case_id, "default_seed": case["seed"],
        "presets": [{"id": row["id"], "label": row["label"], "values": preset_values(case, row)}
                    for row in case["scenarios"]],
        "parameters": [
            {"id": key, **spec, "default": defaults.get(key, "seeded" if key == "initial_layout" else None),
             "value_type": type(spec["values"][-1]).__name__, "null_allowed": None in spec["values"],
             "provider_kinds": ["rule"],
             "comparison_class": "initial_treatment" if key in
             {"cash_reallocation", "network", "initial_layout", "demand_shift", "extra_a_seats", "delay", "cap", "allocation"}
             else "policy_comparison"}
            for key, spec in SPECS[case_id].items()
        ],
        "student_actions": case.get("action"),
        "auction_limits": {"maximum": CASE["player_value"], "default_bid": CASE["preset_bid"]} if case_id == CASE["case_id"] else None,
        "weekly_order_plan": {"weeks": 40, "min": 0, "max": 40} if case_id == "beer_game" else None,
        "round_contribution_plan": {"rounds": 10, "min": 0, "max": 20} if case_id == "public_goods" else None,
    }


def effective(case, scenario, patch, bid):
    case_id = case["case_id"]
    preset = next(row for row in case["scenarios"] if row["id"] == scenario)
    existing = preset_values(case, preset)
    values = {**existing, **patch}
    for key, value in patch.items():
        spec = SPECS[case_id].get(key)
        if spec is None or not any(type(value) is type(allowed) and value == allowed for allowed in spec["values"]):
            raise InvalidParameters(f"参数 {key} 超出该课程公布的取值。")
    if case_id == "lemons_market" and values["certification_fee"] and values["information"] != "certified":
        raise InvalidParameters("正认证费要求启用认证制度。")
    if case_id == "double_auction" and bid + values["fee"] > min(
            CASE["player_value"] + values["demand_shift"], CASE["initial_cash"]):
        raise InvalidParameters("学生报价与费用合计超过本场私人价值或现金。")
    if values.get("initial_layout") == "seeded":
        del values["initial_layout"]
    return values


def with_parameters(case, scenario, parameters):
    return {**case, "scenarios": [
        {**row, "parameters": parameters} if row["id"] == scenario else row
        for row in case["scenarios"]
    ]}


def comparison_intervention(base, branch):
    left, right = (run["result"]["intervention"] for run in (base, branch))
    defaults = baseline_case_parameters(base["case_id"])
    return {key: {"baseline": left.get(key, defaults.get(key)), "branch": right.get(key, defaults.get(key))}
            for key in sorted(left.keys() | right.keys()) if left.get(key, defaults.get(key)) != right.get(key, defaults.get(key))}


def seed_plan(case_id, seed):
    return {"seed": seed, "strategy": "named_substreams" if case_id == "schelling_segregation" else "reference_engine"}


def baseline_case_parameters(case_id):
    from .lessons import load_case

    return {"initial_layout": "seeded", **baseline(load_case(case_id))}
