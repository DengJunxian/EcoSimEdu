"""Generate the offline CasePackage index and V2 interchange schemas from the course sources."""
from argparse import ArgumentParser
from pathlib import Path
import json

from services.simulation.domain import CasePackage, Evidence, RunEnvelope
from services.simulation.lessons import CATALOG, load_case
from services.simulation.projection import CLOCKS, metric_registry

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "cases/case-packages-v1.json"
# Observation key, comparison key, and aggregation for each published classroom.
ROLES = {
    "double_auction": ("price", "volume", "cumulative"),
    "schelling_segregation": ("similarity", "similarity", "final"),
    "svb_run": ("queued", "queued", "final"),
    "information_cascade": ("public_a_pct", "cascade_decisions", "cumulative"),
    "public_goods": ("net_income", "net_income", "cumulative"),
    "commons_governance": ("stock", "stock", "final"),
    "lemons_market": ("quoted_pool_price", "traded", "cumulative"),
    "school_matching": ("rejections", "first_true_choice", "final"),
    "beer_game": ("factory_order", "factory_variance_ratio", "final"),
    "carbon_market": ("planned_emissions", "abatement_cost", "final"),
    "flash_crash": ("bid_depth", "program_filled", "cumulative"),
    "gamestop": ("last_price", "forced_cover", "cumulative"),
}
MODELS = {
    "double_auction": ("十名买家与十名卖家由固定种子生成。", 20,
                       "现金、库存与私有保留价值约束报价。买卖交叉时采用在簿订单价格，同价按到达先后撮合。"),
    "schelling_segregation": ("20×20 网格中的 A、B 两组合成住户和 60 处空位。", 340,
                            "同组比例按已占邻格计算。低于当前阈值的住户搜索合格空位。"),
    "svb_run": ("三组各 20 名虚构储户，另有教学银行与现金、证券交易对手。", 60,
                "提款先申请后支付。现金不足时依次使用支持借款和证券急售，净资产按当期账表计量。"),
    "information_cascade": ("课内参与者的箱子、信号和行动由合成开局及规则生成。", None,
                            "公开后验由可见行动的似然更新，私人抽样和终场答案有独立揭示边界。"),
    "public_goods": ("使用合成参与者及公开资金池。", None, "同时贡献后结算公共回报及惩罚资源成本。"),
    "commons_governance": ("水域及使用者是教学设定。", None, "每期依次申请、分配、取用与自然再生。"),
    "lemons_market": ("货品、质量和保留价由教学模型生成。", None, "混合池报价读取愿售集合，核验可形成独立报价。"),
    "school_matching": ("学生、偏好、优先序和席位均为合成。", None, "学校按优先序处理申请，制度不同会改变是否允许替换暂留席位。"),
    "beer_game": ("四个合成供应链环节由局部信息下单。", 4, "库存随到货与实际发货变动，订单具备信息与运输时滞。"),
    "carbon_market": ("企业、减排成本与配额来自教学模型。", None, "履约需按实际排放缴回配额，交易规则影响其持有者。"),
    "flash_crash": ("40 个合成账户与单一教学资产。", 40, "库存约束可触发撤单，只有真实模型撮合更新成交价。"),
    "gamestop": ("20 个合成账户与单一教学资产。", 20, "消息、账本约束与借券义务影响订单，价格由实际教学成交更新。"),
}
FACTS = {
    "svb_run": [("2023 年 3 月 8 日，硅谷银行集团宣布调整资产负债表。", ["S01"]),
                ("3 月 9 日的实际存款流出超过 400 亿历史美元。", ["S01"]),
                ("加州监管机构于 2023 年 3 月 10 日关闭硅谷银行。", ["S01"]),
                ("3 月 12 日三机构公布处置安排，保障该行全部存款人。", ["SVB-RESOLUTION"])],
    "flash_crash": [("2010 年 5 月 6 日，美国期货及证券市场出现急跌和回升。", ["S10"])],
    "gamestop": [("SEC 工作人员报告记录了 2021 年 1 月的 GameStop 交易热潮。", ["S11"])],
    "school_matching": [("2005 年波士顿学校委员会决定更换公校匹配机制。", ["S09"])],
    "carbon_market": [("欧盟碳排放交易体系于 2005 年启动。", ["S14"])],
}
EXTRA_METRICS = {
    "double_auction": {
        "price": ("本笔成交价", "代币/件"),
        "best_bid": ("最高在簿买价", "代币"), "best_ask": ("最低在簿卖价", "代币"),
        "platform_cash": ("平台现金", "代币"), "participant_surplus": ("参与者剩余", "代币"),
        "efficiency": ("配置效率", "比例"),
    },
    "svb_run": {
        "price": ("证券标价", "资金单位/证券单位"), "deposits": ("未偿存款", "资金单位"),
        "borrowing": ("支持借款", "资金单位"), "loans": ("贷款资产", "资金单位"),
        "units": ("持有证券", "证券单位"), "sold": ("累计出售证券", "证券单位"),
        "marketValue": ("持有证券市值", "资金单位"), "marketCash": ("证券对手现金", "资金单位"),
        "supportCash": ("支持机构现金", "资金单位"),
    },
}
DEFINITIONS = {
    ("double_auction", "price"): ("当前事件的实际成交价格。", "当前事件没有成交。"),
    ("double_auction", "last_price"): ("截至当前时点最近一笔实际成交的价格。", "截至该时点尚未成交。"),
    ("double_auction", "best_bid"): ("尚在订单簿内的最高买价。", "买方订单簿为空。"),
    ("double_auction", "best_ask"): ("尚在订单簿内的最低卖价。", "卖方订单簿为空。"),
    ("double_auction", "efficiency"): ("实际总剩余除以最大可实现总剩余。", "可实现总剩余为零。"),
    ("svb_run", "queued"): ("累计申请减累计实付。", "该时点缺少申请或实付记录。"),
    ("svb_run", "equity"): ("现金加证券市值与贷款，减存款负债和借款。", "该时点缺少账表记录。"),
    ("schelling_segregation", "similarity"): ("同组占用邻接计数除以全部已占邻接计数。", "没有已占邻接。"),
    ("double_auction", "volume"): ("截至该事件累计成交的物品件数。", "该时点缺少市场快照。"),
    ("information_cascade", "public_a_pct"): ("用已公开可见的行动与核验信息更新的 A 箱概率。", "该时点公共后验未记录。"),
    ("information_cascade", "cascade_decisions"): ("累计行动不随两种私信号变化的级联决定人数。", "该时点缺少决定记录。"),
    ("school_matching", "rejections"): ("截至该轮所有学校累计发出的拒绝份数。", "该时点缺少申请批次。"),
    ("school_matching", "first_true_choice"): ("最终分到真实第一志愿的学生数。", "最终分配尚未结算。"),
    ("lemons_market", "quoted_pool_price"): ("当前候选混合池质量均值乘本课报价系数。", "混合报价池为空。"),
    ("lemons_market", "traded"): ("实际交割的商品总件数，暂定报价不计成交。", "该时点缺少市场记录。"),
    ("public_goods", "net_income"): ("截至当前轮各参与者结算后的余额之和。", "该时点缺少公共池结算账表。"),
    ("commons_governance", "stock"): ("该阶段水域实际记录的存量，期末值取最后一次再生后的记录。", "该时点缺少存量记录。"),
    ("carbon_market", "planned_emissions"): ("各企业按当期减排方案报出的计划排放总量。", "减排方案尚无合计。"),
    ("carbon_market", "abatement_cost"): ("各企业减排资源成本的合计，配额支付另有记录。", "该时点尚无成本合计。"),
    ("beer_game", "factory_order"): ("工厂在该周发出的订货量。", "该时点无工厂周订单。"),
    ("flash_crash", "bid_depth"): ("模型时点仍在订单簿上的买方股数。", "该时点缺少买盘快照。"),
    ("flash_crash", "program_filled"): ("累计实际执行的程序性卖出股数。", "该时点缺少程序订单执行记录。"),
    ("gamestop", "last_price"): ("截至该时点最近一次模型成交的每股价格。", "该时点尚无模型成交价。"),
    ("gamestop", "forced_cover"): ("按回补义务实际完成的累计买入股数。", "该时点缺少账户记录。"),
    ("beer_game", "factory_variance_ratio"): ("工厂订单方差与终端需求方差之比。", "终端需求方差为零或该时点尚无可比较方差。"),
}


def build_packages():
    sources = json.loads((ROOT / "cases/sources.json").read_text())["sources"]
    packages = []
    for case_id in CATALOG:
        case = load_case(case_id)
        course_dir = ROOT / "cases" / case_id
        learning = json.loads((course_dir / "learning-v3.json").read_text())
        refs = [source for source in sources if source["case_id"] == case_id]
        approved = set(learning["source_ids"])
        assert approved <= {source["source_id"] for source in refs}
        people, count, assumption = MODELS[case_id]
        observed, comparison, statistic = ROLES[case_id]
        clock = case.get("alignment") or CLOCKS[case_id]
        fields = [*metric_registry(case), *(
            {"id": key, "label": label, "unit": unit}
            for key, (label, unit) in EXTRA_METRICS.get(case_id, {}).items()
        )]
        metrics = []
        for metric in fields:
            label = metric["label"]
            definition, undefined = DEFINITIONS.get(
                (case_id, metric["id"]), (f"该观察时点模型记录的{label}。", "该时点无适用观测值。"))
            metrics.append({**{key: metric[key] for key in ("id", "label", "unit")},
                            "definition": definition, "undefinedReason": undefined})
        assert {observed, comparison} <= {metric["id"] for metric in metrics}
        packages.append(CasePackage(
            caseId=case_id, caseVersion=case["version"], browserContentVersion="browser-classroom/1",
            learningContentVersion=learning["content_version"], title=case["title"], identity=case["identity"],
            identityLabel=case["identity_label"], background=case["background"],
            historicalFacts=[{"text": text, "sourceIds": ids} for text, ids in FACTS.get(case_id, [])],
            sourceReferences=[{"id": source["source_id"], "title": source["title"], "url": source["course_url"],
                               **{key: source[key] for key in ("locator", "support", "limits")}} for source in refs],
            modelAssumptions=[assumption], syntheticPopulation={"description": people, "count": count},
            dataProvenance={"originalSourceData": [{"sourceId": row["source_id"], **row["underlying_external_data"]}
                                                   for row in refs]},
            rights=[{"sourceId": row["source_id"], "status": row["rights"]["status"], "detail": row["rights"]["detail"],
                     "evidenceUrl": row["rights"]["evidence_url"], "distribution": row["course_distribution"]} for row in refs],
            learningOutcomes=learning["outcomes"], metrics=metrics,
            browserMetricRoles={"observation": observed, "comparison": comparison, "statistic": statistic},
            archivedMetricRoles={"observation": "last_price" if case_id == "double_auction" else observed,
                                 "comparison": comparison, "statistic": "final"},
            clock={"id": clock["field"], "label": clock["axis_label"]},
        ).model_dump())
    return packages


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    check = parser.parse_args().check
    outputs = {INDEX: build_packages()}
    for name, model in (("case-package", CasePackage), ("run-envelope", RunEnvelope), ("evidence", Evidence)):
        outputs[ROOT / f"schemas/{name}.schema.json"] = {
            "$schema": "https://json-schema.org/draft/2020-12/schema", **model.model_json_schema(),
        }
    for path, result in outputs.items():
        text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if check:
            assert path.read_text() == text, f"Regenerate {path.relative_to(ROOT)}"
        else:
            path.write_text(text)
    print("12 CasePackages and three domain schemas checked" if check else "Generated 12 CasePackages and three domain schemas")


if __name__ == "__main__":
    main()
