# Civitas Economica 教学实施状态

2026-11-17 RC10 新增从课程进入的[模型实验台](release/rc10-model-lab.md)，四门课支持期末规则对照和导出。四门课均已用 GPT-6 Luna 从浏览器实际运行、回放并导出。[其余三课实调收据](release/rc10-live-three-courses.md)

2026-11-17 完成十二课[来源和数据资产核验](audit/source-asset-verification.md)，记录 20 条出处、25 项文件和未核实的公开许可。

2026-11-17 发布 RC9 本地候选版，十二课各有一条可运行、回放和导出的独立边界实验。[边界验收与复跑](release/rc9-verification.md)

2026-11-17 依据初始 Master Prompt 和 WP00–WP10 重新签查，交付 1.0.0-rc.8 本地候选版。[原始范围复核及继续计划](audit/original-scope-recheck.md)为当前状态总索引。下列较早收据保留各阶段实测数据。

2026-11-16 交付 1.0.0-rc.7 本地候选版。[RC7 Orca 朗读和操作](release/rc7-verification.md)记录实际语音与浏览器回执。[RC6 无障碍交互](release/rc6-verification.md)补齐坐标选格、图表表格、焦点和 320px 回流。[RC5 大运行冷读](release/rc5-verification.md)覆盖新格式的首次和重复定位。[RC4 大运行与 Linux Chromium](release/rc4-verification.md)记录补充验收。[RC3 逐事件定位](release/rc3-verification.md)复用现有运行与快照。[RC2 补充验收](release/rc2-verification.md)覆盖窄屏、组合规模及 Linux ARM64。[WP09–10 最终验收](release/acceptance-report.md)记录通过和未验证项。[M3 验收](audit/m3-verification.md)记录本轮运行、测试与余项。[M1](audit/m1-verification.md)与[M2](audit/m2-verification.md)保留各阶段原始证据。当前工作位于 `codex/ecosim-education`，基线为 `585ffcbaaeb292f0addc10331ae7dae0c57ebd84`。

| 工作包 | 状态 | 交付与边界 |
|---|---|---|
| WP00 | partial · 基线已复跑 | [复核、差异和复用决定](audit/repository-audit.md)，204 个旧 Python 文件解析、撮合/传播/三组旧演示烟测。完整旧应用、IPC、C++、Ray 与实际模型走查待验。 |
| WP01 | done · M1 范围 | [PRD](product/prd.md)、[任务路径](product/journeys.md)、[版本范围](product/release-scope.md)。四条路径的产品定位已登记，十二门课的运行状态见 WP06。 |
| WP02 | partial · 首课内容通过 | [首课内容与模型](content-review.md)。十二课内容与来源随案例包交付。[26 条候选来源](release/candidate-catalog.md)及[六维矩阵](cases/candidate-matrix.md)已复核，十二课独立边界已验证，20 条来源和 25 项数据文件已登记及核验；底层外部数据及部分公开许可未核实。 |
| WP03 | done · 首课原型通过 | [学生端](../student-web/)、[设计与交互](design/design-system.md)，真实 Chrome 四档与独立走查。 |
| WP04 | partial · 首课规则与回放通过 | [本地 API](../services/simulation/api.py)、[Schema](../schemas/double_auction.run.schema.json)、[决策记录](decisions/0001-first-lesson.md)。四课 Live 已于 WP08 通过基准实测。长运行执行暂停、续跑和持久化检查点待补。 |
| WP05 | done · 首课端到端通过 | [学习状态](learning-state.md)和[真实浏览器测试](../tests/e2e/test_student_learning.py)。同数据库恢复；跨库迁移待实现。 |
| WP06A | done · 六课基础闭环 | [发布目录](../cases/catalog.json)，六课各三组配对运行，[M2 验收](audit/m2-verification.md)。 |
| WP06B | done · 十二课基础闭环 | 新增柠檬市场、学校匹配、啤酒游戏、碳配额市场、闪电崩盘与 GameStop。全目录离线和边界实验通过。 |
| WP07 | partial · 基础联动与同步对照通过 | 十二课按真实课程时标对齐，同时返回原事件键、参数差异与缺值。指标抽样端点受测。事件定位及指定大样本通过实测，持续检查点和快照增量存储仍待补。 |
| WP08 | done · 四课基准单角色实测 | OpenAI GPT-6 Luna 四课真实动作均已执行并留痕。离线学习助手、两币种预算、状态恢复与重放已验收。DeepSeek 真实账户待验证。[验收](audit/wp08-verification.md) |
| WP09 | done · 本机整合通过 | [使用指南](user-guide.md)、[性能收据](release/performance.json)、[界面及体验走查](skills/executions/WP09.md)。组合样本的快照和事件直达通过实测，完整 AA 待验。 |
| WP10 | partial · 本地候选版已验收 | [验收矩阵](release/acceptance-report.md)、[安装收据](release/fresh-install.json)、[真实 API 回执](release/real-api-receipt.json)。Windows、课堂效果及扩大真实模型范围待验。 |

实际使用的技能和方法记录于 [WP00–WP10](skills/executions/)。
