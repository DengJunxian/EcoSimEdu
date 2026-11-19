import flashCase from "../../../cases/flash_crash/case.json" with { type: "json" };
import gameCase from "../../../cases/gamestop/case.json" with { type: "json" };
import { flashCrash, gamestop, maker } from "./markets.ts";
import { defineCourse, metric, windowOf } from "./course-lesson.ts";

export const flashLesson = defineCourse("flash_crash", flashCase, {
  title: "持有多少库存时，你会撤单？", role: maker,
  story: "以 2010 年闪电崩盘为背景。你是提供买方流动性的做市者，大额卖出程序即将进入这个教学市场。",
  facts: [{ label: "开局持股", value: "55 股" }, { label: "你有两档买单", value: "每档 18 股" }],
  steps: ["设置阈值", "承接卖单", "查看撤单"],
  predict: { question: "如果你撤回仍在簿上的买单，眼下的买方深度怎么变？", answers: ["减少", "增加"] },
  metrics: [metric("program_filled", "程序累计成交", "股"), metric("bid_depth", "买方挂单深度", "股"),
    metric("last_price", "最近成交价", "美元"), metric("program_queued", "等待提交的计划", "股"),
    metric("low_price", "盘中最低成交价", "美元")],
  priceMetric: "last_price",
  policy: { id: "no_withdrawal", label: "库存触发的撤单", names: ["允许撤单", "持续报价"],
    note: "卖出计划、初始持仓和你的库存阈值沿用基线。对照仅取消库存触发的撤单。" },
  rule: "先撮合这批卖单，再检查做市者的净增库存。撤回的是剩余挂单；被撤股票不会记入成交。",
  explanation: "引用一笔成交和撤单记录，解释同样的卖出计划如何遇到不同的可成交买量。",
  periodLabel: "市场模型步收尾", periods: windowOf(0, 200),
}, (seed, action, scenario, params) => flashCrash(seed, action, scenario, params.withdraw_on_inventory));

export const gameLesson = defineCourse("gamestop", gameCase, {
  title: "听到热议，你会用现金跟进吗？", role: "学生投资者",
  story: "以 2021 年 GameStop 交易热潮为背景。你看到讨论升温，决定是否在有限现金下提交第一张买单。",
  facts: [{ label: "可用现金", value: "160 美元" }, { label: "小额买单", value: "2 股 × 12 美元限价" }],
  steps: ["选择首单", "看报价", "查回补"],
  predict: { question: "消息被转发时，最近成交价在该事件上会怎样？", answers: ["仍需等实际成交才更新", "转发直接记为新成交价"] },
  metrics: [metric("forced_cover", "累计强制回补", "股"), metric("last_price", "最近成交价", "美元"),
    metric("social_buys", "关注买入实际成交", "股"), metric("short_interest", "未交还借券", "股"), metric("reach", "触达投资者", "人")],
  priceMetric: "last_price",
  policy: { id: "no_social", label: "消息进入下单决策", names: ["使用关注权重", "取消关注权重"],
    note: "相同话题照常传播，借券数量和学生下单决定保持。对照只取消消息对关注账户下单量的权重。" },
  rule: "转发沿用同一来源编号。价格由真实成交更新。担保现金低于按成交价估值的借券义务的 170% 时，触发回补规则。",
  explanation: "指认一条消息与一笔实际成交，说明借券账户为什么可能发出回补订单，以及订单是否实际成交。",
  periodLabel: "交易轮收尾", periods: windowOf(0, 10),
}, (seed, action, scenario, params) => gamestop(seed, action, scenario, params.social_weight));
