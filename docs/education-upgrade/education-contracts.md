# 教育能力增量契约：实现附件

> 下文保留交接时的提案。实际实现、已验证范围和当前源文件以 [进度](progress.md)、[状态说明](learning-state.md) 和 [追溯](traceability.md) 为准。提案示例从未作为学生记录导入。

**状态：架构提案，未接入生产。** 基于提交 `bfe31dd945eaff3cac7c92a580974ad1e3cd45e2`；配套 `contracts_example.json` 为合成示例，不是学生记录、历史数据或新增运行。首三个旗舰统一为双向拍卖、SVB、Schelling；以双向拍卖做纵向样板，再验证两种不同领域，随后推广十二课。

## 一、边界与落点

保留现有 Python 仿真服务、React 学生端、SQLite 运行库、领域视图与结果契约。教育增强增加内容声明和本地学习状态，不增加微服务、账号或教师管理。原 `lesson-v2.json`、`FieldStudy`、`AuctionStudy` 及旧 URL 继续可读；规则计算、预计算回放和 Live 仍遵守各自能力范围。

建议新增 `schemas/learning/*.schema.json`、`cases/<id>/learning-v3.json`、`content/concepts.json`；Python 在 `services/simulation/learning_content.py` 校验引用，前端在 `student-web/src/learning/` 增加 `activity-runtime`、`assessment`、`learner-repository`。这些是建议文件，不是现存模块。现有 `/api/cases/{id}/lesson` 默认继续返回 v2；可用显式 `schema_version=3` 请求新包。未升级案例继续走原课堂。

## 二、十个最小对象

| 对象 | 必需字段 | 约束与用途 |
| --- | --- | --- |
| ConceptDefinition | `id, version, label, definition, prerequisite_ids, misconception_codes` | 稳定概念 ID；前置关系无悬空、无环；定义与题目版本分离 |
| LearningOutcome | `id, version, concept_ids, performance, evidence_requirement` | 写可观察表现，如“根据现金和净资产区分流动性不足与资不抵债”；不能只写“理解银行” |
| AssessmentItem | `id, version, variant_id, family_id, outcome_ids, kind, prompt, context, response_schema, evaluator, feedback` | 类型先做单选、数值、机制排序、结构化解释；确定性评价声明 evaluator 版本；开放文本只做结构反馈，不能冒充语义评分 |
| LearningAttempt | `id, schema_version, local_profile_id, session_id, case_id, content_version, activity_id, item_id, item_version, variant_id, presented_order, response, submitted_at, exposure, assessment_role, evaluation, source_refs` | 一次正式提交为一条不可变记录；改答案产生新 attempt，不覆盖首次答案；结果保留 evaluator 版本 |
| LearnerEvidence | `outcome_id, rule_version, evidence_state, supporting_attempt_ids, unresolved_misconception_codes, transfer_status, updated_at` | 派生缓存，可从尝试重建；主状态未尝试/练习中/有独立应用证据，迁移为单独维度；不输出未经校准的掌握概率 |
| LessonActivity | `id, phase, kind, outcome_ids, content_ref, assessment_item_ids, next_activity_id, completion_rule` | 可选 `remediation_activity_id, return_activity_id`；只做主线及短补救，不支持任意脚本执行 |
| ExperimentCard | `id, version, case_id, question, hypothesis, treatment_plan, controlled_inputs, outcome_metric_ids, falsification, run_ids, actual_treatments, alignment_ref, conclusion, limitations, status` | 运行前保存预测；运行后由后端返回填实际参数差异和来源，不让学生手输“实际结果”冒充系统记录 |
| ExplanationCard | `id, version, case_id, content_version, outcome_ids, claim, source_refs, mechanism_steps, conditions, alternative_explanation, feedback, updated_at` | 结构化解释；反馈区分结构完整性、事实核对与尚待人工/独立任务验证的机制推理 |
| ReviewSchedule | `id, outcome_id, rule_version, due_at, based_on_attempt_ids, status` | 本地复习计划；到期只标待复习，不删除历史证据或把能力降为零 |
| Recommendation | `id, outcome_ids, activity_id, reason_code, source_attempt_ids, priority, created_at` | 简单可解释的下一步；显示推荐原因及可替代活动，允许学生自由选择 |

独立编写教学题统一使用 `AssessmentItem.context.kind = authored_model_exercise`；这不是历史观测或仿真实帧。真实运行绑定题使用独立的运行上下文与有效SourceRef。

评估选项使用稳定 `option_id`，选择题响应保存该 ID，排序题保存 ID 数组；展示顺序另存 `presented_order`。不能把“A/B”或数组下标当答案。选项换位置不产生新变式；题干、答案依据或反馈实质变化提升 item.version，旧尝试仍使用旧版本解释。

`LearningOutcome` 要与学习活动及评估任务建立映射。先给每个核心目标至少一个独立题和一个边界/迁移任务；是否新增更多题由具体错误覆盖决定，不能拿题数作为教育质量。

## 三、七 phase 与多 activity 状态

沿用 `intro → predict → bid → observe → explain → compare → notebook` 七个 phase，名称兼容旧实现；`bid` 在界面可显示本课的“选择行动”。每个 phase 可含多个活动，旧 scene 通过一对一 adapter 变成活动。

新 SessionState 保存 `current_activity_id, accessible_activity_ids, activity_states, return_stack, run_context, content_version`。活动状态使用 `available/in_progress/submitted/completed/skipped`；学习状态与概念证据分别计算。补救最多一层，明确返回点，不递归堆叠。`completed` 表示完成该活动要求，不等于答对或掌握。学习者可以带着“待验证目标”继续主线。

领域面板仍读取当前 phase 对应的旧索引 adapter，不立即重写十二个领域组件。只有活动编排脱离 `stage === 4` 之类的位置依赖。回放状态 `tick/revealed/pinned`、run 引用与活动切换分开存储；进入补救或复习不能增加 reveal 上限。修订预测必须保留第一次提交和当时信心。

## 四、提示与答案暴露的判据

一次学习尝试从显示题目开始，到首次提交结束。暴露事件在显示提示或答案**之前**写入本地事务；保存 `max_hint_level, answer_seen, exemplar_seen, prior_feedback_for_variant, solution_seen_at, exposure_unknown`。暴露作用域是题目/变式和当前尝试，不把此前学过相关概念当成作弊或自动判辅助。

- 提交前打开该题提示、示例解或答案：本次是 assisted。
- 该变式此前已展示答案/反馈，再次作答：repeated；不贡献新的独立证据。仅打乱选项不能改变此判定。
- 新变式在无本题提示、答案和暴露不明状态下首次提交：可标 independent；仍要满足目标证据要求。
- 迁移题必须由内容作者明确标为 transfer，并改变情境或机制应用条件；换数字不自动成为迁移。
- 预测碰巧正确不提升概念证据；学生需在后续任务给出机制或边界解释。

提示不能被禁用来“制造独立性”。学生始终可求助，只需诚实记录辅助条件。用户可自行修改本地数据，本方案用于自主学习而非认证考试，不承诺防作弊。

首版证据规则是可解释的产品规则：主状态使用 `not_attempted / practicing / independent_evidence`，对外为未尝试/练习中/有独立应用证据；独立任务达标才进入第三种。迁移使用单独 `transfer_status=not_assessed / evidenced / needs_more_evidence`，复习状态由 ReviewSchedule 提供。显示支持的尝试和日期；一次正确不宣布永久掌握。出现新错误保留已有证据，同时添加需再练目标，不删除过去表现。复习日期采用明示、可调整的简单间隔；不能宣称已验证的个性化记忆模型。

## 五、本地存储与兼容迁移

使用单一 IndexedDB `ecosimedu-learning`，最小 object stores 为 `sessions, attempts, exposures, evidence_cache, experiments, migration_backups`。匿名 local_profile_id 随浏览器生成，不要求姓名。经济运行继续留在现有 SQLite，学习记录保留 SourceRef。配额不足/事务失败须明确提示并允许导出，不能先显示“已保存”。

另把 ExplanationCard、ReviewSchedule、Recommendation 放入对应的同库集合；它们不建立新的服务。学习页显示“此浏览器的记录”，提供统一导出及删除入口。试用演示会话和自己的学习会话使用不同 profile，避免演示填满个人进度。导出文件包括内容版本、原始尝试、解释卡和迁移凭据；不导出 API Key。运行数据库需单独备份，导出说明必须说明引用与运行的关系。

迁移过程：读取旧 key → 用现有解析器验证 → 保留原 JSON 与摘要 → 在单个新库事务中创建会话、原笔记和 legacy 状态 → 校验后写 migration receipt。原 key 不删除，重复迁移按原 key+摘要幂等，失败可继续旧课堂。旧 stage/unlocked 只转成访问位置与可访问活动；first/latest 保留为 legacy_response，因缺少完整暴露历史，`exposure_unknown=true`，不生成独立证据或掌握状态。

内容版本变化保留原笔记和题目版本；有显式活动迁移表才续接新活动，否则提供导出与原版查看。导入先校验 schema、ID、版本及引用，合并按 attempt.id 去重，不覆盖另一条同 ID 不同内容的记录。来源数据库缺失时允许保留学习文字并标“运行待恢复”；不得用演示运行补齐旧来源。

区分四类版本：存储结构 schema_version、课程 content_version、题目 item.version、证据派生 rule_version。文案小改不能静默改变已提交答案的判定；评估器修正生成新 evaluation 版本并保留原结果及更正原因。不同题目版本是否可共同支持同一个目标，必须在内容包声明兼容关系。缓存重算不能重写尝试、首次预测、暴露事件或旧评价。

## 六、SourceRef 与实验设计复用

原 `flagship-study.ts:5–8` 的 `SourceRef` 原样复用：`run_id, case_version, engine_version, result_hash, seq, tick, event_type, actor?`。引用校验沿用 Notes/Restore 的 run/hash/event/主体匹配。AuctionEvidence 转为 SourceRef 时保留原 metric/unit/value 扩展，actor_id 显式映射 actor，不改历史对象。只有已核对来源才能用于运行事实评价；引用真实不代表学生因果解释成立。

L2 未完成前缀不能把 `prefix_hash` 填成 `result_hash`。首批学习证据使用标准已完成离线运行；高级运行先保留独立实验记录，后续通过专用完成结果适配器再接入正式证据判定。

ExperimentCard 从现有参数规格读取 `comparison_class`，从 `/compare` 读取 actual_treatments、两侧初态哈希与经济时钟。政策对照保持定义要求的共同初态；initial_treatment 明确哪一部分初态被处理、哪些种子/人口/冲击保持。多个处理同时改变时提示不能把差异唯一归到一个变量；五种子只称小样本稳健性探索，不包装为总体显著性。

## 七、Tutor 增量输入与两项修复

保留旧 TutorRequest；新增可选 `learning_context`，包含 `activity_id, item_id/version, response, exposure, attempt_summary, explanation_draft, rubric_id, experiment_card_id`。说明草稿限长；摘要只含本次目标需要的最近尝试，不默认发送全部笔记。服务器用案例/题目 ID 重新读取 rubric，不能信任客户端自报正确答案或来源。

数值问题先解析已登记指标、单位、时点，读取已揭示 frame：单位一致且数值满足该指标声明的绝对/相对容差才确认；有差异则指出来源与正确值；歧义就追问。不能取消未来、私有和跨运行限制，也不能仅凭字符串数字相等通过。浮点容差按指标定义，不统一给所有货币/人数同一容差。

对照提示按实际 comparison_class 生成，替换 `task_tutor.py:235–237` 的统一“初态相同”。开放解释优先给结构反馈和一条针对性追问；可选 LLM 返回结构化 claim/evidence_id/feedback_kind，来源不存在或越界就丢弃该条并回退本地。LLM 不改变运行数据或最终学习证据状态。

## 八、高价值验收

1. 同题错答→看反馈→改对，保留两条尝试且不新增独立证据；换选项顺序不改变判定。
2. 新变式独立通过、另一情境迁移通过，分别更新证据状态并能解释依据；预测正确不直接升级。
3. 七 phase 中增加补救活动后，返回位置、已揭示时点和 pin 不丢；旧 URL 与十二课回放回归通过。
4. migration 中途失败与重复执行不丢旧笔记，不把旧完成进度变成掌握率；版本不同不静默重评分。
5. 本地事务失败不显示保存成功；重复导入去重，冲突与缺失运行分别显示。
6. 现金确为 0 的合法询问可确认；未来数据、错单位、其他 run 与隐藏主体仍拒绝或追问。
7. 现金再配置/空间初态对照说明正确保持条件；多因素结果不能生成单因素归因。
8. 无 API、助手超时、坏引用时仍完成三个旗舰全部学习闭环；在线反馈不自动形成已掌握状态。

## 九、三个旗舰怎样证明契约有用

双向拍卖先检验“成交不等于获利、报价不等于成交”：首次选择后保留错误及反馈暴露，用新交易条件检验剩余计算和费用解释。需要区分学习者算对一个数字、能说明一笔交易的机制、能解释全市场资源配置三个目标，避免一项结果代替全部能力。

SVB 检验“现金不足与净资产不同”：把资产负债表和到期支付放入结构化解释卡，在现金再配置对照中明确变动的是资产构成。学生只有引用正净资产不能证明任何银行永远安全；只有看到待付也不能推出资不抵债。迁移任务可换成供应商的短期支付约束，并保留未知资产价值。

Schelling 检验“局部满意与总体分化不同”：让学生定位一个迁居怎样改变邻居条件，再比较相同阈值的两种初始布局。独立任务考察局部变量与总体指标的区别，迁移题检验结论依赖的邻域、空位和迁居规则；不得把该简化模型解释成现实群体偏好的测量。

三个旗舰使用同一尝试与证据契约，但保留各自的领域计算和解释要求。样板通过后再增加其他九课的目标映射、题目变式和误解规则。验收评审应抽取真实学习路径检查“推荐为什么出现、反馈指出了什么、学生怎样改进”，不能只检查 JSON 字段齐全或页面多了一张卡片。

## 十、实施衔接与专业流程

开发者先读取项目 AGENTS 和当前可用 Skills，再按任务分别选择实际可读的内容研究、数据质量、前端和测试能力；缺失能力采用常规工程方法并记录。内容作者先定义目标与误解，工程把它映射到真实指标和事件，可视化再决定如何让学生找到证据，测试最后核对行为和学习证据一致。每轮提交只宣称已经验证的阶段，样例或接口未接线时明确标为提案。

先提交兼容解析器和数据迁移，再在一个旗舰接活动运行时、作答与解释卡，然后跑不同领域的两个旗舰回归。禁止仅根据新 Schema 将旧答案批量判为正确，禁止通过补造运行来让迁移测试通过，禁止把在线助手输出直接写成权威能力判断。涉及版本和引用失败时优先保留原记录、给出恢复途径。

本附件的实施验收以运行证据为准；示例 JSON 能解析和引用自洽不等于功能已经开发、迁移已经发生或教育效果已经验证。
