# EcoSimEdu V2 回归与验收矩阵

每行关联 [问题编号](baseline-audit.md#发现与最小处理策略)、现有入口、迁移后的可观察行为及回归执行方式。「现有」指基线中的测试或本轮复现。「新增」是以后实际修改该模块时需要覆盖的场景。

| ID | 范围与现有入口 | V2 回归判据 | 证据入口 |
| --- | --- | --- | --- |
| A01 | B01、B09 · `main.tsx`、`classroom-routes.ts`、旧端路由和 FastAPI 静态挂载 | 12 个四阶与原 URL 可达。保留 `case/run/event/tick`、`scene/explore/demo`、旧边界、旧笔记和模型入口。缺失/无效链接显示原错误和恢复操作。 | 现有 [map browser](../../frontend/tests/map_browser.py)、[旧路由导航](../../tests/e2e/test_upgrade_navigation.py)、[事件链接](../../tests/e2e/test_event_lookup.py)。新增按实际运行来源逐跳验收。 |
| A02 | B07、B08 · `lesson.ts`、`Studio.tsx`、12 份 v3 包 | 支持先提交原判断与行动、再揭示运行；观察阶段能选真实主体，后续预测先于政策计算。跳过正式题不生成作答或掌握。原 Activity ID 与首次答案可查。 | 现有 [状态机](../../frontend/tests/lesson.test.mjs)、[四阶浏览器](../../frontend/tests/remaining_browser.py)、[学习活动](../../tests/e2e/test_education_activities.py)。 |
| A03 | B01、B02、B03 · `learning-store`、`learner-repository`、`migration` | 同档案跨天恢复原位置、选择和揭示。跨来源有原地址与显式归档。陈旧标签不得使最新记录悄然倒退，主动退回仍可保存。损坏和旧版本保持原值并说明处理状态。 | 现有 [续学浏览器](../../frontend/tests/continue_browser.py)、[旧笔记与检查点](../../frontend/tests/learning-store.test.mjs)、[教育活动](../../tests/e2e/test_education_activities.py)。新增双标签竞争、失效记录恢复路径，复现见 [本轮记录](executions/V2-00.md)。 |
| A04 | B02、B10 · `Lesson.run`、`Recorder`、`api.py`、两个格式的 Run | 保留源命名空间、版本、种子、原 ID 和事件号。相同 ID 内容不一致显式标记。完整包与前缀保留各自摘要。旧 UUID 与历史完整 Run 正常打开。 | 现有 [运行契约](../../tests/contracts/test_education_api.py)、[事件契约](../../tests/contracts/test_event_contract.py)、[前缀与执行恢复](../../tests/contracts/test_l2_execution.py)、[逐帧](../../frontend/tests/remaining_parity.py)。新增同 ID 异内容与旧缓存试验。 |
| A05 | B04、B06、B11 · `Studio`、`MetricChart`、`run-evidence`、服务端 Trace | 图、表、主体、区间和原事件焦点一致。SVB 轮次可下钻真实子事件。Schelling 非空区间每条能回真实邻域，空区间保留说明。六课 Trace 维持引用完整性。 | 现有 [拍卖](../../frontend/tests/auction_browser.py)、[SVB](../../frontend/tests/svb_browser.py)、[住区显微镜](../../tests/e2e/test_emergence_microscope.py)、[Trace 扩展](../../tests/contracts/test_emergence_extensions.py)。新增跨投影/子事件精确回链。 |
| A06 | B06 · `transition('locate')`、`flagship_view`、Trace 投影 | 未来事件无法从引导入口定位。回到例题或改变焦点保持已见上限。级联私人数据、拍卖私有估值与剩余按原阶段遮罩。完整复盘显式进入并可读取原数据。 | 现有 [四阶揭示测试](../../frontend/tests/remaining.test.mjs)、[Trace 揭示](../../tests/contracts/test_emergence_visibility.py)、[级联遮罩](../../tests/contracts/test_cooperation_visibility.py)、[拍卖投影](../../tests/contracts/test_auction_classroom.py)。 |
| A07 | B05 · `course-lesson.ts`、`Counterfactual`、`projection.py` 和参数对照 | 相同经济时钟对齐，原序号独立保存。公开种子、共同根、初态与实际合法处理。空值不填零，同末态保留路径差异，多种子显示样本数。 | 现有 [对照契约](../../tests/contracts/test_projection.py)、[参数合同](../../tests/contracts/test_parameter_lab.py)、[参数浏览器](../../tests/e2e/test_parameter_lab_browser.py)、[十课对照](../../frontend/tests/remaining.test.mjs)。新增显示轴与双侧原序的一致性。 |
| A08 | B07、B09 · 两套部署、12 案例、两类引擎 | 新版只加载同源静态资源即可完成各课。原版只依赖回环本地服务。无重叠的拍卖留空未定义指标。对照执行时保留双方的模型守恒、时点与可重复输入。 | 现有 [旧十二课](../../tests/e2e/test_course_catalog.py)、[边界路径](../../tests/e2e/test_boundary_paths.py)、[旧机制包](../../tests/mechanisms/test_published_lessons.py)、[浏览器拍卖](../../frontend/tests/auction.test.mjs)、[逐帧](../../frontend/tests/auction_parity.py)。 |
| A09 | B08 · `Investigation`、归档、`transfer-record`、教师页 | 一次学生解释可找回原记录，独立迁移按原判据计入。学生导出、教师独立浏览器导入并查证两源、复核、学生导回保持版本/帮助/评分。缺一源时保留作答且不评分。 | 现有 [两来源往返](../../tests/e2e/test_emergence_transfer.py)、[学习活动](../../tests/e2e/test_education_activities.py)、[学习包](../../tests/contracts/test_learning_content.py)。 |
| A10 | B01、B07、B08 · 内容目录、学习归档、旧笔记、复习 | 12 课与 36 目标建立来源关联。历史事实、教材、理论、合成输入和模型输出保留标识。原档和新档可读，保留暴露、未提交帮助、首次答案、不同版本和冲突回滚。 | 现有 [课件契约](../../tests/contracts/test_learning_content.py)、[来源登记](../../scripts/check_course_provenance.py)、[渐进练习、归档和次日复习](../../frontend/tests/progressive_pedagogy_browser.py)、[归档与跨日活动](../../tests/e2e/test_education_activities.py)、[原课堂恢复](../../tests/e2e/test_auction_scenes.py)。 |
| A11 | B10 · `api.py`、`live_client/live_l2`、旧模型页 | 未配置、关闭、来路错误或授权不足时保留规则模式。真实密钥处于服务器。原 Live 与 L2 的状态和幂等保持。V2 本地验收用测试替身覆盖供应商分支。 | 现有 [本地模型](../../tests/contracts/test_local_model.py)、[在线状态](../../tests/contracts/test_live_service.py)、[L2](../../tests/contracts/test_l2_execution.py)、[键盘与模型设置](../../tests/e2e/test_live_panel.py)。 |
| A12 | B05、B11 · `MetricChart`、原图表表格、窄屏暂停 | 1180px 和 390px 键盘、画布及表格都能查看源证据，并操作下一步。窄屏暂停时证据和下一步同时可见。模型曲线保留空值和金融红涨绿跌的对应文字。 | 现有 [学生活动](../../frontend/tests/continue_browser.py)、[十课验证](../../frontend/tests/remaining_browser.py)、[显微镜](../../tests/e2e/test_emergence_microscope.py)。如后续改动控件朗读结构，追加原生读屏验收。 |

## 最小学生验收

选择课与原场景，提交预测和行动，选定真实微观主体。走一次暂停、事件原地反查和从群体状态到行为反馈的观察。改变一个合法条件前保存预测。核对两边实际参数和原事件。以正式独立迁移作答闭合，若流程含教师复核，从另一个浏览器档案按真实来源完成返回。以旧版记录重开、错误或空证据、关闭模型的结果作为互补检查。

提交前在同一测试环境跑新旧构建、前端契约、受影响 Python 契约/机制以及浏览器路径。引用实际运行日志中的模式、宽度和通过项。能力存在、当前测试通过、人工教学评价和未验证边界分别登记。[V2-00 实测](executions/V2-00.md)
