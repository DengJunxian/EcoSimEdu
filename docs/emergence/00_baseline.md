# EM00 基线与课堂揭示边界

当前分支 `codex/ecosim-education`，HEAD `585ffcbaaeb292f0addc10331ae7dae0c57ebd84`。该工作副本已有未提交的教学代码、数据和文档，本轮以实际工作副本为基线。附件中的审计提交只用于定位历史。五份指定文件均从两份随附 Markdown 的 `SOURCE` 章节全文读取。附件的架构和验收用于实施，工作范围和权限来自用户请求与 AGENTS.md。

## 实际能力

- 教学端 API 为 FastAPI，离线运行由 SQLite 保存。服务用规范化结果摘要检查负载完整性。已发布十二课，包含领域界面、固定种子回放和七段教学流程。
- `run_id` 标识运行，`result_hash` 标识其结果。当前规则事件的 `seq` 与 `tick` 同步，课堂按游标取帧。两次运行对照仍须通过比较接口按经济时钟匹配。
- React/TypeScript 经 Vite 构建。课堂草稿和学习尝试走现有浏览器存储，保留旧路由和既有数据格式。
- 本轮 Python 3.12.11、Node 26.0.0、npm 11.12.1。锁文件为 `requirements-edu.lock`、`requirements-edu-dev.lock`、`student-web/package-lock.json`。

## 课堂揭示审计

| 视图 | 实测边界 |
| --- | --- |
| 通用课堂引导投影 | 事件和序列到当前游标，前帧为上一事件，未到末尾时无结束序号 |
| SVB | `details.series` 在当前工作副本已随游标截断，未来首次待付检查点不外泄，拓扑是观察者的开局模型结构 |
| 信息级联 | 揭晓前移除他人的抽签、抽签标识及实际私人后验，公开行动和公开后验可供追踪。指定的结束事件揭晓答案 |
| 双向拍卖 | 中途的引导结算仅给订单来源和公共撮合证据，累计剩余、买家价值和卖家成本按原解释流程揭示 |
| 离线导师 | 带 `reveal_until` 的旧请求原本能从原始帧读到拍卖的累计总剩余。修复后使用同一课堂投影，无揭示上限的旧复盘查询仍能复核全部原始指标 |

完整 Run/Export、原始快照、实验对照是原有本地观察者和归档路径。课堂投影提供教学提示的揭示边界。当前单机架构不提供基于学生账号的防篡改考试隔离。

## 接口交接

`services/simulation/emergence/schemas.py` 和同名 JSON Schema 固定首版 Trace 与现有 SourceRef 字段风格。Trace 既验证所选事件不超过揭示上限，也校验引用属于同一运行与摘要。历史资料和模型结果分别标识。公共类型预留模型规则、状态转移、恒等式、配对差异和解释假设语义，EM01 只实现 Schelling 所需查询。

错误使用现有 HTTP 约定。未知运行返回 404，不适用或不可用的运行返回 409，字段不合法返回 422。有效范围内但没有搬迁时返回真实事件/指标及空搬迁链。

## 本轮验证

- 修改前 `python -m pytest -q tests/contracts tests/mechanisms tests/e2e` 429 passed（321.47s）。
- 新回归先重现一次失效，导师回答了第一笔成交的累计总剩余 35 代币。修复后运行 `python -m pytest -q tests/contracts/test_emergence_visibility.py tests/contracts/test_svb_classroom.py tests/contracts/test_cooperation_visibility.py tests/contracts/test_auction_classroom.py`，13 passed。
- JSON Schema 经 Draft 2020-12 元模式验证。附件提供了契约草案，交付目录中未找到单独的 Schema 文件，本仓库版本由服务端类型生成。
- 远端部署、公开多用户权限和真实学生样本超出本阶段证据。
