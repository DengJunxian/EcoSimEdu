# 首课需求追踪

| ID | 实现 | 验证状态与证据 |
|---|---|---|
| M1-00 | [旧仓库审计](audit/repository-audit.md)、[复用图](audit/reuse-map.md) | 基线及重点机制局部通过，[记录](audit/baseline.json) |
| M1-01 | [案例包](../cases/double_auction/case.json)、[课程入口](../student-web/src/main.tsx) | E2E 跑通三次主要步骤进入结果、错误预测继续 |
| M1-02 | [规则撮合适配器](../services/simulation/auction.py)、[市场工作台](../student-web/src/main.tsx) | 撮合来源、守恒、剩余、时间序号及真实成交证据通过 |
| M1-03 | [本地运行 API](../services/simulation/api.py)、[运行合同](../schemas/double_auction.run.schema.json) | 同根条件留痕、明确干预、预设一致性、同参数幂等及失败重试通过 |
| M1-04 | [学习状态](../student-web/src/study.ts)、[浏览器测试](../tests/e2e/test_student_learning.py) | 两条不同证据、刷新与故障恢复、导入校验和笔记导出通过 |
| M1-05 | [安装与入口](../STUDENT_LAB.md)、[离线测试](../tests/mechanisms/test_double_auction.py) | 规则/replay 成功且未导入凭证配置，四档浏览器禁止外部请求后通路通过 |

## WP02 来源和数据资产

| 需求 | 产出与证据 |
|---|---|
| PR-02 / PR-09 出处与数据身份 | [20 条来源](../cases/sources.json)、[25 项文件的版本和生成链](../cases/data-assets.json)、[来源与资产验收](audit/source-asset-verification.md) |

## M2 与 WP07

| 需求 | 产出与证据 |
|---|---|
| M2-01 六门七阶段离线课 | [发布目录](../cases/catalog.json)，[新增五课浏览器验收](../tests/e2e/test_course_catalog.py)及 M1 回归 |
| M2-02 每课真实机制与两组反事实 | [18 组运行](audit/m2-runs.json)，[结果再生成检查](../scripts/check_lesson_catalog.py)及[机制测试](../tests/mechanisms/) |
| M2-03 配对条件、版本与跨课程边界 | [共享 API 契约测试](../tests/contracts/test_catalog.py)，[运行 JSON Schema](../schemas/lesson.run.schema.json) |
| M2-04 每课证据与笔记恢复 | 浏览器验证本地恢复、反事实分支与不同课程的导入校验 |
| WP07-01 真实事件、快照与链接 | [事件追踪 API](../services/simulation/api.py)，主体前后状态、空间格子、关系和订单指针。跨情景同步时间轴待后续。 |

## M3 与同步投影

| 需求 | 产出与证据 |
|---|---|
| M3-01 十二课可离线完成 | [课程目录](../cases/catalog.json)，新增与既有课共同纳入[真实浏览器验收](../tests/e2e/test_course_catalog.py) |
| M3-02 六个新机制 | [M3 验收与模型导航](audit/m3-verification.md)，[41 组确定性运行](audit/m3-runs.json) |
| M3-03 可选学生行动与证据完整性 | [全选项验证](../tests/mechanisms/test_published_lessons.py)，各项提供真实播放检查点、可引用事件与合理对齐 |
| WP07-02 共同时间轴与缺值 | [同步投影](../services/simulation/projection.py)，[契约测试](../tests/contracts/test_projection.py) |
| WP07-03 原事件与抽样 | 共享事件链接和指标抽样均保留源 tick，双拍、Schelling、SVB 共同回归 |


## WP08 真实模型与离线助手

| 需求 | 产出与证据 |
|---|---|
| 四课合法模型动作影响真实数值结算 | [真实 API 回执](audit/wp08-real-canary.json)，每条动作关联运行事件 |
| 受限观测、动作、两币种预算与状态恢复 | [供应商适配](../services/simulation/live_client.py)，[执行台账](../services/simulation/live.py)，[机制与 API 测试](../tests/contracts/test_live_service.py) |
| 模型结果可无费用重放 | [验收](audit/wp08-verification.md)，本地导出与只读重放 |
| 可引用的课程与运行答复 | [离线助手](../services/simulation/tutor.py)与 [真浏览器流程](../tests/e2e/test_course_catalog.py) |

## WP09–WP10 整合与交付

| 需求 | 实现与证据 |
|---|---|
| 本机导航、教师演示、探索与故障恢复 | [入口组件](../student-web/src/lab-tools.tsx)、[体验走查](../tests/e2e/test_lab_tools.py)、[三条路径](../tests/e2e/test_release_paths.py) |
| 来源、微宏链与 20 种子回归 | [候选事实库](release/candidate-catalog.md)、[反馈审计](release/feedback-audit.md)、[种子收据](release/seed-matrix.json) |
| 已见证据与离线答复 | [Tutor 60 题](release/tutor-acceptance-v1.json)、[断言](../tests/mechanisms/test_tutor_acceptance.py) |
| 实调、成本、可保存与断网重放 | [真实回执](release/real-api-receipt.json)、[恢复收据](release/backup-and-replay.json) |
| 清洁安装、冻结归档与性能限制 | [开发指南](developer-guide.md)、[性能收据](release/performance.json)、[验收](release/acceptance-report.md) |
| RC2 窄屏回流、组合性能、Linux ARM64 | [补充验收](release/rc2-verification.md) |
| RC3 同一运行逐事件查看、快照链接兼容、结果哈希 | [事件验收](release/rc3-verification.md) |
| RC4 过缓存上限的事件与快照定位、Linux 图形 Chromium | [规模与平台验收](release/rc4-verification.md) |
| RC5 大运行首次校验、原哈希保留与旧格式兼容 | [冷读验收](release/rc5-verification.md) |
| RC6 窄屏等效选格、图表表格、键盘焦点和 320px 回流 | [无障碍交互验收](release/rc6-verification.md) |
| RC7 标题、时间轴、坐标与表格的屏幕阅读器实测 | [Orca 验收](release/rc7-verification.md) |
| 原始交付包全量复核、六维评分、十二课角色与关系/指标复验 | [复核矩阵与续做计划](audit/original-scope-recheck.md) |
