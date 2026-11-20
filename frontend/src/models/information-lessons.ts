import schoolCase from "../../../cases/school_matching/case.json" with { type: "json" };
import lemonsCase from "../../../cases/lemons_market/case.json" with { type: "json" };
import cascadeCase from "../../../cases/information_cascade/case.json" with { type: "json" };
import { cascade, lemons, matching } from "./information.ts";
import { defineCourse, eventAt, metric, windowOf } from "./course-lesson.ts";

export const schoolLesson = defineCourse("school_matching", schoolCase, {
  title: "把最想去的学校填在第一位吗？", role: "申请人 S01",
  story: "参照波士顿学区招生机制改革。你希望获得自己最喜欢的可入学学校，真实偏好是 A、B、C。三所学校各有 4 个席位，按公开优先序处理申请。",
  facts: [{ label: "真实偏好", value: "A > B > C" }, { label: "你的优先位次", value: "A 校第 6，B 校第 4" }],
  steps: ["提交志愿", "等待排序", "确认学校"],
  predict: { question: "首轮如果没有被选中，还能在延迟接受中申请下一志愿吗？", answers: ["可以", "申请到此结束"] },
  metrics: [metric("first_true_choice", "获真实第一志愿", "人"), metric("rejections", "累计拒绝", "份"),
    metric("applications", "累计申请", "份"), metric("true_blocking_pairs", "按真实偏好的阻挡对", "对")],
  policy: { id: "immediate", label: "录取方式", names: ["延迟接受", "即时接受"],
    note: "保持相同学生、志愿、学校优先序和容量。即时接受将已获席位的承诺固定下来。" },
  rule: "学生若被拒可申请下一志愿。延迟接受让暂留者和新申请者重新排序；即时接受保留已经确认的席位。",
  explanation: "用一条申请记录和一次拒绝说明排序怎样影响分配，再说明真实偏好与提交志愿为何可能不同。",
  periodLabel: "录取阶段", periods: [0, 1, 2], phaseLabels: ["开局", "首轮处理", "最终录取"],
  selectFrame: (run, phase) => [eventAt("admissions_open"), eventAt("round_resolution"), eventAt("final_assignment")][phase](run),
}, (seed, action, scenario, params, input) => matching(seed, action, scenario, params.mechanism === "immediate", params.extra_a_seats, input));

export const lemonsLesson = defineCourse("lemons_market", lemonsCase, {
  title: "你知道质量，买家只看到均价。你还挂牌吗？", role: "卖家 S01",
  story: "参照 Akerlof 的二手车市场。你想成交并保住卖方剩余。你知道自己商品的质量和最低可接受价格，买方先观察挂牌商品的整体质量。",
  facts: [{ label: "你的商品质量和保留价", value: "5 · 5 代币" }, { label: "混合报价规则", value: "候选池平均质量 × 1.2" }],
  steps: ["选择挂牌", "查看报价", "等待交割"],
  predict: { question: "如果统一报价低于你的保留价，你会以该报价成交吗？", answers: ["不卖，退出报价池", "挂牌后就必须成交"] },
  metrics: [metric("traded", "实际成交", "件"), metric("quoted_pool_price", "混合池暂定价", "代币"),
    metric("willing_supply", "愿售商品", "件"), metric("willing_quality", "愿售商品均值", ""),
    metric("net_surplus", "净剩余", "代币")],
  policy: { id: "certified", label: "第三方核验", names: ["统一混合报价", "可付费认证"],
    note: "每件核验费用 0.5 代币。能覆盖该费用的卖家可以按已证实的质量单独报价。" },
  rule: "低报价淘汰保留价更高的卖家，下一轮用剩下的候选池重新计算暂定报价。实际只在最后交割一次。",
  explanation: "选一条报价和退出记录，说明退出怎样改变后续报价。比较两组交易量时也要提到核验的资源成本。",
  periodLabel: "市场阶段", periods: [0, 1, 2], phaseLabels: ["开市", "首轮报价", "结算"],
  selectFrame: (run, phase) => [eventAt("market_open"), eventAt("offer_iteration"), eventAt("settlement")][phase](run),
}, (seed, action, scenario, params, input) => lemons(seed, action, scenario, params.certification_fee, input));

export const cascadeLesson = defineCourse("information_cascade", cascadeCase, {
  title: "别人选择相同，你的私信号还重要吗？", role: "第 3 位参与者 D03",
  story: "参照信息级联实验。你要猜抽样来自哪个箱子。先声明如何用公开行动和你的私人抽样，再由课堂按你的策略作选择。",
  facts: [{ label: "开局先验", value: "A、B 各 50%" }, { label: "每次抽样指向真箱的概率", value: "2/3" }],
  steps: ["声明策略", "收到抽样", "公布选择"],
  predict: { question: "若一人无论收到什么信号都选 A，公布 A 会带来新的抽样证据吗？", answers: ["不会", "会"] },
  metrics: [metric("cascade_decisions", "级联决定数", "人"), metric("public_a_pct", "公开 A 箱后验", "%"),
    metric("revealing_decisions", "带来新信息的决定", "次"), metric("correct_pct", "终场正确率", "%")],
  policy: { id: "private", label: "行动揭示口径", names: ["公布前序行动", "隐藏前序行动"],
    note: "箱子、抽样和你的策略保持。仅改动后继者能否观察前人的选择。" },
  rule: "行动是否区分私信号决定它能否更新公开后验。无新信号的相同行动不会叠加成独立证据。",
  explanation: "用实际后验和两种私信号的选择说明，为什么一次选择能或不能改变下一人的信念。",
  periodLabel: "决定序次和终场揭晓", periods: windowOf(0, 13),
}, (seed, action, scenario, params, input) => cascade(seed, action, scenario, params.observe_actions, input));
