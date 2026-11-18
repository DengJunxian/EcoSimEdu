"""Published classroom rules and constraints for the evidence workbench."""

from .. import parameter_specs
from ..lesson_scenes import ENGINE_VERSIONS
from ..projection import CLOCKS, metric_registry


SPECS = {
    "schelling_segregation": {
        "module": "schelling.py", "micro": ["位置", "同组及已占邻居数", "满意阈值"],
        "rules": ["不满意者可以迁往满足阈值的可用空位。学生开局行动另记。"],
        "edges": ["空间邻接", "搬迁引起的邻居集合变化"],
        "events": ["student_move", "move"],
        "macro": {"satisfied": "达到阈值的居民 ÷ 居民总数", "similarity": "同组邻接对 ÷ 所有已占邻接对"},
        "feedback": "原址与新址的邻居构成进入下一次决策。",
        "limit": "区间内可核对搬迁，不能从总变化识别某位住户的独立贡献。",
    },
    "svb_run": {
        "module": "svb.py", "micro": ["储户余额", "工资需求", "风险评分与阈值"],
        "rules": ["观察到的提款消息、上轮急售和轮初队列进入风险评分。"],
        "edges": ["消息", "提款申请", "实际兑付", "证券变现", "支持借款"],
        "events": ["messages", "requests", "payments", "sale", "support", "queue"],
        "macro": {"cash": "银行账上现金", "queued": "累计申请减累计实付",
                  "equity": "现金＋按现价计的证券＋贷款−存款−支持负债"},
        "feedback": "上一轮的出售与本轮开始时的待付进入风险评分。",
        "limit": "消息来源支持模型路径，历史上的挤兑还需外部证据。",
    },
    "information_cascade": {
        "module": "cascade.py", "micro": ["自身线索", "可观察的前序行动", "决策序位"],
        "rules": ["使用行动似然更新公共后验。发生共同核验时单独更新。"],
        "edges": ["实际已观察的公开行动", "共同核验"],
        "events": ["decision", "verification"],
        "macro": {"public_a_pct": "按事件的似然比更新 A 箱公共后验",
                  "public_choice_a_pct": "选 A 的已公开决策 ÷ 已公开决策数"},
        "feedback": "已公开决策及其可识别信息进入后续决策。",
        "limit": "前人的私人抽样受提示阶段及角色的信息约束。",
    },
    "double_auction": {
        "module": "auction.py", "micro": ["自身估值或成本", "现金", "可交割数量", "报价"],
        "rules": ["验资、价格时间优先撮合，并按原挂单价格结算。"],
        "edges": ["订单", "撤单", "买卖匹配", "账户转移"],
        "events": ["order_submitted", "order_cancelled", "order_rejected", "trade"],
        "macro": {"last_price": "最近一笔实际成交价", "volume": "累计成交件数",
                  "surplus": "买方剩余＋卖方剩余＋平台收入"},
        "feedback": "成交改变账户、可用数量及随后报价的参考价格。",
        "limit": "公共 Trace 遮罩私人估值和剩余，解释阶段沿用课堂原权限。",
    },
    "public_goods": {
        "module": "public_goods.py", "micro": ["贡献", "毛收益", "施罚成本", "受罚扣损"],
        "rules": ["四份贡献同时公开。使用真实结算核对制裁和净收益。"],
        "edges": ["向公共池贡献", "定向施罚"],
        "events": ["contributions", "settlement"],
        "macro": {"contributions": "本轮贡献加总", "net_income": "所有参与者截至当前的累计净收益之和"},
        "feedback": "上一轮同伴贡献和受罚状态进入后续自动策略。",
        "limit": "按模型既有自动策略解释，模型结果不提供独立声誉效应。",
    },
    "beer_game": {
        "module": "beer.py", "micro": ["各环节库存", "积压", "已订未到", "下单", "到货"],
        "rules": ["库存按实际发货、实际到货逐周结算。"],
        "edges": ["订货", "发货", "实际到货"],
        "events": ["week_end"],
        "macro": {"retail_stock": "零售周末实物库存", "retail_backlog": "零售周末尚未交付件数",
                  "factory_variance_ratio": "工厂订单总体方差 ÷ 同周终端需求总体方差"},
        "feedback": "需求预测、库存位置和积压进入下一周订货。",
        "limit": "缺少批次来源保留缺失。零分母时方差比不可计算。",
    },
    "commons_governance": {
        "module": "commons.py", "micro": ["取用申请", "个人限额", "监督与处罚"],
        "rules": ["取用受当前存量和制度限制。取用后的存量在再生事件按规则更新。"],
        "edges": ["申请取用", "实际分配", "监督"], "events": ["withdrawal", "growth"],
        "macro": {"stock": "当前可取用存量", "harvest": "本期实际取用量", "growth": "本期自然再生量"},
        "feedback": "一阶段的净取用与再生共同决定下一阶段存量。",
        "limit": "同一时期的取用量和再生量来自不同事件。",
    },
    "lemons_market": {
        "module": "lemons.py", "micro": ["商品质量", "保留成本", "买方当时可见的信息"],
        "rules": ["卖方按报价和保留成本选择是否继续参与。交割另行记账。"],
        "edges": ["报价", "退出", "认证", "交割"], "events": ["offer_iteration", "certification", "settlement"],
        "macro": {"willing_supply": "当前报价下愿意出售的商品数量", "traded": "实际交割数量",
                  "net_surplus": "交割的价值差扣除制度资源成本"},
        "feedback": "卖方退出改变后续报价所面对的质量构成。",
        "limit": "单看报价不足以判断实际交割；质量与终局的揭示仍按课内时点。",
    },
    "school_matching": {
        "module": "matching.py", "micro": ["申报志愿", "学校优先序", "当前申请去向"],
        "rules": ["学校按容量和优先序暂时保留，未被保留的申请者继续申请。"],
        "edges": ["申请", "暂时保留", "拒绝"], "events": ["round_proposals", "round_resolution", "final_assignment"],
        "macro": {"rejections": "记录中的拒绝次数", "submitted_blocking_pairs": "相对申报偏好的阻挡对数量"},
        "feedback": "被拒绝的申请者在下一轮按自己的志愿顺序继续申请。",
        "limit": "稳定性须注明按真实偏好或申报偏好计算。",
    },
    "flash_crash": {
        "module": "flash_crash.py", "micro": ["有效挂单", "资金与库存", "撤单阈值"],
        "rules": ["实际成交与撤单都会扣减未成交挂单，只有成交更新成交量。"],
        "edges": ["卖出计划", "成交", "撤单"], "events": ["trade", "cancel", "inventory_limit"],
        "macro": {"bid_depth": "有效买单剩余股数之和", "volume": "累计完成撮合的股数"},
        "feedback": "持仓达到模型限额后可触发撤回未成交买单。",
        "limit": "模型的单资产订单簿不能解释历史中的全部跨市场传导。",
    },
    "gamestop": {
        "module": "gamestop.py", "micro": ["消息可见性", "交易资金", "借券交还义务"],
        "rules": ["消息转发按来源追溯，交易按原订单验证，借券交付与持仓分别记账。"],
        "edges": ["消息", "订单撮合", "借券", "回补"], "events": ["message", "forward", "trade", "loan", "margin_call"],
        "macro": {"short_interest": "尚未交还的借券股数", "forced_cover": "规则触发的实际回补股数"},
        "feedback": "当前借券义务及价格进入保证金和回补约束。",
        "limit": "消息到达不能独立证明现实参与者的交易动机。",
    },
    "carbon_market": {
        "module": "carbon.py", "micro": ["减排成本", "初始配额", "履约需求"],
        "rules": ["教学基准按集中排序配置减排与配额转移，再核对履约。"],
        "edges": ["配额发放", "转移", "缴回"], "events": ["issuance", "transfer", "surrender"],
        "macro": {"planned_emissions": "配置后的计划排放量之和", "abatement_cost": "实际配置的减排资源成本"},
        "feedback": "初始配额和减排选择进入后续履约账本。",
        "limit": "集中排序的教学价格不能当成分散订单簿撮合形成的价格。",
    },
}


def describe(case):
    spec = SPECS[case["case_id"]]
    clock = case.get("alignment") or CLOCKS[case["case_id"]]
    descriptors = {row["id"]: row for row in metric_registry(case)}
    if case["case_id"] == "information_cascade":
        descriptors["public_choice_a_pct"] = {"id": "public_choice_a_pct", "label": "公开选择 A 的比例", "unit": "%"}
    return {
        "case_id": case["case_id"], "economic_clock": clock,
        "micro_state_fields": spec["micro"], "observable_policy": "按运行的角色及已揭示事件投影。",
        "decision_rules": [{"file": spec["module"], "version": ENGINE_VERSIONS[case["case_id"]], "description": rule}
                           for rule in spec["rules"]],
        "interaction_edges": spec["edges"], "meso_aggregates": spec["events"],
        "macro_metrics": [{**descriptors[metric], "definition": formula} for metric, formula in spec["macro"].items()],
        "feedback_links": [spec["feedback"]],
        "supported_interventions": parameter_specs.describe(case)["parameters"], "evidence_limits": [spec["limit"]],
    }
