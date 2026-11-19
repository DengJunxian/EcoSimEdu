import beerCase from "../../../cases/beer_game/case.json" with { type: "json" };
import carbonCase from "../../../cases/carbon_market/case.json" with { type: "json" };
import { beer, carbon } from "./allocation.ts";
import { defineCourse, metric, windowOf } from "./course-lesson.ts";

export const beerLesson = defineCourse("beer_game", beerCase, {
  title: "顾客突然多买 4 件，你会多订多少？", role: "零售商 · 第 5 周",
  story: "参照 MIT 啤酒游戏。终端每周需求由 4 件升至 8 件。你看到需求和库存，但新订单不会即时到货。",
  facts: [{ label: "开局各环节库存", value: "12 件" }, { label: "订单与货物", value: "订单 1 周传上游，发货 2 周到达" }],
  steps: ["决定订货", "等上游收到", "核对到货"],
  predict: { question: "这周提交的新订单，能当成这周已经到达的库存吗？", answers: ["不能", "可以直接加入当周库存"] },
  metrics: [metric("factory_variance_ratio", "工厂订单方差 ÷ 终端需求方差", "倍"),
    metric("factory_order", "工厂周投产", "件"), metric("retail_backlog", "零售积压", "件"),
    metric("retail_stock", "零售库存", "件"), metric("in_transit", "在途货物", "件")],
  target: "factory_order",
  policy: { id: "shared", label: "需求信息", names: ["只看本环节订单", "全链共享终端需求"],
    note: "同样的需求冲击、运输时间、产能和第 5 周零售订单。对照只改变预测使用的需求信号。" },
  rule: "每周先到货、履约，再更新本环节需求预测和下单。在途货物在到达周才计入可用库存。",
  explanation: "引用实际下单和到货周，解释为什么上游波动可能和最终消费需求不同。",
  periodLabel: "自然周末", periods: windowOf(0, 40),
}, (seed, action, scenario, params) => beer(seed, action, scenario, params.share_demand));

export const carbonLesson = defineCourse("carbon_market", carbonCase, {
  title: "多拿几张免费配额，是否就能多排放？", role: "企业 F01",
  story: "参照总量控制与碳交易。你代表一家企业参与免费配额初始分配，然后通过减排和交易满足缴回义务。",
  facts: [{ label: "配额单位", value: "每张覆盖 1 吨" }, { label: "基线发行总量", value: "88 张" }],
  steps: ["初始分配", "减排交易", "缴回配额"],
  predict: { question: "只将现有配额从 F08 转给 F01，市场总配额会增加吗？", answers: ["总量不变", "发行总量增加"] },
  metrics: [metric("abatement_cost", "总减排成本", "代币"), metric("planned_emissions", "计划排放", "吨"),
    metric("surrendered", "累计缴回", "张"), metric("permits_moved", "交易转移", "张"),
    metric("price", "配额清算价", "代币每张")],
  target: "planned_emissions", priceMetric: "price",
  policy: { id: "tighten", label: "发行总量", names: ["88 张", "56 张"],
    note: "企业成本、基准排放和免费配额调整请求沿用基线。收紧总量后配额分布、减排与交易重新计算。" },
  rule: "按各吨边际减排成本排序。清算只转移登记过的配额编号，最终每吨排放缴回一张。",
  explanation: "引用一次编号转移和一次缴回，区分减排资源成本与支付给其他企业的交易款。",
  periodLabel: "发行、减排、清算、缴回", periods: [0, 1, 2, 3],
}, (seed, action, scenario, params) => carbon(seed, action, scenario, params.cap));
