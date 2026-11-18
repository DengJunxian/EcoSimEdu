# 首批六课的运行证据

本表以落盘规则 Run 为范围。所有事件先按同一 `run_id`、`result_hash` 和揭示游标核对。成员状态不一定逐帧齐备，缺失保持空值。汇总指标按机制定义，不能以相邻事件顺序代替归因。

| 课程／模型源 | 主体与互动事件 | 宏观指标与时钟 | 后续反馈、合法处理和边界 |
| --- | --- | --- | --- |
| Schelling · `schelling.py` | 全网格 `grid.cells`，`move/student_move` 的原址、新址、移居者与 `changed_neighbors` | 满意住户 ÷ 住户，同组占用邻接对 ÷ 所有占用邻接对，`round_end` | 邻居变化进下一次阈值判断；阈值、合法初态。稀疏 `entities` 不能代表全图，同类率不等于满意率 |
| SVB · `svb.py` / `svb_view.py` | 储户存款与已知邻居，`messages.origin_seq`、`requests`、`support`、`sale`、`payments`、`queue` | 现金、累计申请/实付、待付及权益，清结算轮次 | 已见消息、出售、队列进入风险评分；现金再配置与网络参数。网络连边只代表通路，消息需要源事件 |
| 信息级联 · `cascade.py` / `cooperation_view.py` | `decision.visible_action_ids`、公共核验、公开前后验和信息增量 | `public_a_pct`、信息性行动/级联数、决策序位 | 后续只见当时合法观察；可改变公开行动/独立核验/私信号准确率，私信号按角色和揭晓阶段投影 |
| 双向拍卖 · `auction.py` / `auction_view.py` | 买卖订单、撤单和拒单、成交的两侧订单 ID、快照账户 | 最近成交价、累计成交、累计剩余，报价轮次 | 最近价格与账户约束影响后续报价；需求、费用可对照。总剩余、支付转移与价格机制分别解释 |
| 公共物品 · `public_goods.py` | `contributions` 同时公开投入，`settlement` 提供 gross、net、outgoing、fines 和制裁边 | 当轮/累计贡献、群体累计净收益和制裁消耗，结算轮次 | 前轮投入影响下一轮条件合作，成本开关改变制裁，预先决定的学生贡献计划保留 |
| 啤酒游戏 · `beer.py` | 角色库存、欠单与预测，`week_end` 订货、发运及实际到货；能定位的批次保留 `origin_seq` | 零售库存/积压、在途、成本、工厂订单和方差比，周 | 本周需求与库存位置共同决定订货，可按合法延迟、协作与订单计划测试。无需求波动时方差比为空 |

来源层次以服务中的 `parameter_specs.py`、`projection.py`、对应 case 定义和 `test_emergence_visibility.py` 为准。矩阵登记源字段与教学边界，逐案精确分解在相应工作包验证。
