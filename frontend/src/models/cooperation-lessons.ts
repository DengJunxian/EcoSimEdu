import commonsCase from "../../../cases/commons_governance/case.json" with { type: "json" };
import publicCase from "../../../cases/public_goods/case.json" with { type: "json" };
import { commons, publicGoods } from "./cooperation.ts";
import { defineCourse, metric, windowOf } from "./course-lesson.ts";

export const publicGoodsLesson = defineCourse("public_goods", publicCase, {
  title: "拿到 20 代币，你会贡献多少？", role: "参与者 P1",
  story: "参照公共品实验。你和三位同组同学各有 20 代币，同时决定贡献，未投入的部分自己保留。",
  facts: [{ label: "每人的资金", value: "20 代币" }, { label: "公共池增加 1 代币", value: "每人获 0.4 代币" }],
  steps: ["决定投入", "同时公开", "结算收益"],
  predict: { question: "其他人不变、无惩罚时，多投 1 代币，你本轮的个人收益怎么变？", answers: ["减少", "增加"] },
  metrics: [metric("net_income", "群体累计净收益", "代币"), metric("contributions", "本轮贡献", "代币"),
    metric("total_contributions", "累计贡献", "代币"), metric("sanction_cost", "累计惩罚损耗", "代币")],
  policy: { id: "low_cost", label: "惩罚规则", names: ["无惩罚", "低成本惩罚"],
    note: "P4 对贡献不足 8 的同伴施罚。每点施罚者支出 1 代币，受罚者最多被扣 3 代币。" },
  rule: "个人净收益 = 保留代币 + 0.4 × 本轮总贡献 − 施罚成本 − 受罚扣损。部分角色按上期同伴贡献或受罚情况调整。",
  explanation: "引用一条贡献和一条结算，说明同样一枚代币对个人和小组的收益为何不同。",
  periodLabel: "公共池每轮结算", periods: windowOf(0, 10),
}, (seed, action, scenario, params) => publicGoods(seed, action, scenario, params.unit_cost));

export const commonsLesson = defineCourse("commons_governance", commonsCase, {
  title: "共享水域里，你今天取用多少？", role: "使用者 F01",
  story: "参照对可再生公地的治理研究。24 位使用者共享一片水域。你获得当期取用收益，也会和其他人面对下一期库存。",
  facts: [{ label: "期初资源", value: "180 单位" }, { label: "每单位收益", value: "2 代币" }],
  steps: ["计划取用", "实际分配", "水域再生"],
  predict: { question: "取用后，下一期库存要用哪一个量开始计算？", answers: ["取用后的存量", "照用本期的期初存量"] },
  metrics: [metric("stock", "资源存量", "单位"), metric("harvest", "本期取用", "单位"),
    metric("growth", "本期再生", "单位"), metric("income", "累计收入", "代币")],
  policy: { id: "quota", label: "取用规则", names: ["开放取用", "每人每期限额 1"],
    note: "限额截断每位使用者获准申请量，资源再生规则和你的原计划仍保持。" },
  rule: "先分配现有存量，剩余量进入再生公式。下期的取用计划会受期初存量影响。",
  explanation: "用实际取用和再生两条记录写出存量恒等式，并解释这一期的选择怎样限制下一期。",
  periodLabel: "每期再生后存量", periods: windowOf(0, 12),
}, (seed, action, scenario, params) => commons(seed, action, scenario, params.institution === "quota"));
