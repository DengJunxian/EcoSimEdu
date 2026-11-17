# 复用边界

| 能力 | 分级 | 入口与复用 |
|---|---|---|
| 限价单撮合 | 实现且本次验证 | `core/exchange/order_book.OrderBook.add_order`。课内启用独立 `MarketRuleSchema`，经订单 ID 关联成交并结算。 |
| 社会传播 | 实现且本次局部验证 | `core/social/contagion.SocialContagionEngine.step`。重复五步一致。后续信息课可评估使用。 |
| 旧三组回放 | 实现且本次局部验证 | `load_competition_scenario` + `advance_competition_demo`。保留演示用途。首课从教学规则重新生成主体/互动记录。 |
| 实验/事件持久化与旧主循环 | 已实现，整链待验证 | `core/experiment_manifest.py`、`core/events/`、根仿真入口。教学首课先采用 SQLite 和小型不可变结果。 |
| 宏观主体 | 部分实现 | `core/macro/{household,firm,bank}.py` 的信号输出，后续独立构建领域账本。 |
| 规则贴模型名、示意图 | 原型占位 | `core/system/runner.py` 与旧 UI 的示意数据，限定在原研究演示上下文。 |
| 学生端、课程 Provider | 上游未实现，本轮新增 | `student-web/`、`services/simulation/`、`cases/double_auction/`。 |
