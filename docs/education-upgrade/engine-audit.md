# EcoSimEdu 当前工程与学习数据能力审计

日期：2026-11-18。固定基线：`bfe31dd945eaff3cac7c92a580974ad1e3cd45e2`。审查范围：当前教学内容契约、学习状态、参数实验、课堂助手与 L2；不修改仓库，不调用外部模型 API。

## 结论

本轮不应再安排一次“把十二课做成真仿真、增加回放与领域课堂”的重建。当前版本已具备十二个有效 lesson-v2 包、真实离线规则模型、领域视图、分选项反馈、入场预测保留与事后匹配、带来源标识的笔记、真实参数对照、经济时钟对齐，以及四案多角色 L2 的执行与成本协议。**新的主要约束在学习诊断：产品能记录学生做过什么，但尚不能可靠表达学生已经能独立解释什么、哪里误解、何时需要再练、能否迁移。**

这是能力边界判断，不是当前核心仿真失效。此次重新运行 `tests/mechanisms` 与 `tests/contracts`：**309 passed，36.44 秒**；一个第三方 pytest 弃用警告。测试运行使用测试自己的临时数据库；未复用根代理的 UI 数据库，未访问付费 API。前端浏览器体验由父代理另行检查，本报告不把编译或历史截图当作浏览器验收。

## 证据等级

- **本轮实测**：309 项测试，以及 `engine_probe.py` 输出 `engine_probe.json`。
- **代码静态确认**：读取当前固定提交中的实现与契约，具体位置列于下文。
- **历史验收收据**：`docs/upgrade/acceptance.md`、`progress.md` 中的 412 项、VoiceOver、外部环境记录；不计作本轮重新完成。
- **未验证**：真实供应商 L2 调用、真实在线助手网络调用、跨进程执行续跑、真实学习效果。仓库也明确将当前 UP10 的真实多角色供应商验收保留为未完成。

## 1. 应保留和复用的当前能力

| 能力 | 证据与当前状态 | 下一轮复用方式 |
| --- | --- | --- |
| 12 课内容包 | 本轮加载并校验全部通过；84 个 scene、74 道题、136 个选项已有 `criterion`；`lesson_scenes.py:157–200` | 复用题目、选项反馈和来源；补 concept/item ID 与诊断关联，避免重写十二课内容 |
| 真实预测闭环 | `flagship-lesson.tsx:325–337,349–372` 保留原预测，按事件 selector 判断发生/尚未发生/结束未发生，并支持修订 | 作为预测证据，不把一次猜中直接记作概念掌握 |
| 多尺度来源定位 | `flagship_view.py:11–70` 截取已揭示 frame/events/series；`flagship-study.ts:5–18` 保留 run/hash/version/seq/tick | 新学习证据直接引用现有 SourceRef；不另造不相容的“证据链接” |
| 笔记与对照引用校验 | `flagship-notes.tsx:14–50`、`auction-notes.tsx:21–53` 对照权威运行核验 hash、版本、事件与经济对照点 | 保留严格引用真实性；把“证据已核对”和“论证充分”作为两种状态 |
| 十二课参数实验 | `parameter_specs.py:10–92,138–154` 公布允许值并验证跨参数约束；`parameter-lab.tsx:92–125` 真正启动成对规则运行 | 为参数台补实验问题、控制变量检查和结果解释任务，而非再做一套参数 UI |
| 不同初始条件比较 | `parameter_specs.py:123–128` 已区分 `initial_treatment` 与 `policy_comparison`；结果保留两侧 initial_hash | 用已有元数据解释哪些条件被改变、哪些共同输入保持；不一律要求初态完全相同 |
| 五个种子核对 | `parameter-lab.tsx:96,113–121,213–216` 以同一组连续种子配对，展示五组差异 | 作为小样本稳健性探索；不可称总体显著性、概率规律或因果识别证明 |
| 离线课堂助手 | `task_tutor.py` 有 role/concept/prediction/mechanism/comparison/boundary、三层提示、揭示范围与引用约束 | 复用范围限制和上下文组包，增强错误诊断与作答反馈 |
| 四案 L2 | `live_l2.py:15,105–113,125–240,243–315,401–450`；公共物品、SVB、信息级联、GameStop，冻结批次、合法动作、账本、prefix、预算、reference | 作为进阶研究区；下一轮主教学投入不应被更多实时调用挤占 |

L2 当前是已有真实执行接口、通过注入 transport 的契约验证，并非已经验证过真实供应商多角色教学效果。`read()` 明确区分 rule/model/hybrid、计划/到达/模型提交/回退覆盖；保留这些诚实口径。恢复为 process-local，同进程暂停继续；进程退出转 interrupted，未实现续算，这是明示边界，不是本轮新故障。

## 2. 主要教育限制与优先级

### E1：七阶段已经可用，但内容契约仍把“一阶段”绑定为“一个场景”

`lesson_scenes.py:213–230` 强制 scene.id 和 legacy_stage 都逐一等于原七阶段，且 next_scene 必须是下一阶段。`FieldStudy`/解析还限定 unlocked ≤ 6（`flagship-study.ts:38–51`）；前端大量 `stage === n`（`flagship-lesson.tsx:349,460–477`）。

本轮把 SVB 解释阶段后增加一个合法字段构成的补救场景，校验报：`scene IDs and legacy stage IDs must preserve the seven-stage order`。因此当前版本并不能仅通过配置加入“先看例题→自己做→错了做两分钟补救→回主线”的活动序列。

**建议 P1**：保留七个教学阶段作为分组和旧版迁移锚点，新增阶段内活动列表。先支持主线、一个可返回的补救活动和一题迁移练习，不开发任意工作流图编辑器。领域可视化通过 `phase` 访问现有 adapter，不再依赖第几个 scene 的数字位置。

### E2：有答案反馈，尚无可解释的学习证据状态

现有 `criterion` 已填入 136 个选项，不应再说没有判定内容。问题在于前端的 `SceneQuestion` 不暴露 criterion，作答处理仅更新 first/latest/original 并立即显示反馈（`flagship-types.ts`、`flagship-lesson.tsx:301–336`）。阶段推进检查预测是否选项、回放是否结束、对照是否运行，不检查概念理解（`flagship-lesson.tsx:461–480`）。

`FieldStudy`（`flagship-study.ts:10–18`）和 `AuctionStudy`（`auction-study.ts:63–78`）具有逐课进度和笔记，但没有全量尝试、每次作答时刻、提示暴露、概念 ID、误解 ID、题目变式、独立/辅助条件及复习计划。`knowledge-map.json` 目前是四个路径的有序案例数组加每课概念词列表，尚不是前置关系/学习证据图。

**建议 P0**：先加题目级事件记录和明确的证据状态：未尝试、练习中、有独立应用证据；独立迁移和待复习使用另外的标签。记录具体来源与时间，不显示伪精确“掌握率 87%”。完成课程与概念证据分别记录；允许学生继续探索，错误不应把课堂改成正式考试。

### E3：当前笔记核验解决“引用真不真”，不解决“解释对不对”

笔记组件核对 run/hash/event 是实质优点。但解释与成立条件仍是 textarea，自评依据是文本 rubric。`TutorRequest`（`api.py:76–88`）没有笔记文本、当前题目答案、尝试历史或 rubric 维度；`TutorPanel`（`tutor.tsx:63–70`）也仅传 case/scene/actor/prediction/evidence。

本轮用一段正确的流动性解释和一段“有待付说明所有银行必定资不抵债”的错误解释发问，两者都命中 `task_tutor.py:193–195`，返回同一自评模板，没有分析其论点。

**建议 P0**：把笔记拆为可填写的“论点→一条证据→机制→条件→另一解释”，先给确定性的结构反馈和可核验算式反馈；概念错误用明确题目和已编写误解规则诊断。高级 AI 可审阅这份结构化回答，但必须标明依据与不确定项，不能仅凭证据链接存在就说论证正确。

### E4：在线助手有真实接口，但当前在线增益仅为两段文字排序

`tutor_online.py:9–12,21–27,59–74` 只允许模型从 `observation_first` / `inspection_first` 选择；`_render()` 不改答案内容，只附 ordering 和 delivery。`api.py:240–247` 还把在线机会限制在已验证 observation。应准确称“在线组织已核对提示”，不能在产品定位中承诺目前已实现自由对话、个性化诊断或开放式经济学解释。

**建议 P1**：优先完整离线反馈。若加入模型，首先服务“解释草稿的针对性追问”和“基于当前误解推荐下一活动”，把 API 成本用于实际教学价值；仍用 EvidencePack、成本账本、合法输出 Schema 与引用验证，不把账本和经济结算交给 LLM。

### E5：助手部分范围控制过于粗，阻碍正常学习对话

1. `task_tutor.py:182–184` 对任何“为/是/等于 + 数字”直接拒绝。本轮在银行现金确为 0 的事件 9，问“银行现金为 0 吗？”仍拒绝；去掉数字问当前现金则正确引用事件并答 0。应先匹配指标与已揭示值、单位及容差，无法匹配才回退，不把合法数值核对全部当作无依据。
2. `task_tutor.py:235–237` 对所有 comparison 统一建议“保持初始状态一致，只改一项规则”。实际 SVB 现金再配置、Schelling 初态布局、供需价值上移等是合法 initial treatment。应读取 `comparison_class` 和实际 treatments，教学生区分共同生成条件、初始处理和运行中政策。
3. 硬编码误解纠正只覆盖三案（`task_tutor.py:49–53`）；扩展时应内容化进案例包，关联具体误解和补救活动，避免在 Python 文件中不断累积自然语言关键字。

### E6：已有可调实验尚未形成“学生自己设计实验”的评价闭环

`parameter-lab.tsx` 提供真实参数、共同输入、五种子、逐周/逐轮预提交动作和同步对照。它没有记录学生问题、待检验方向、控制变量理由、反证标准和实验后结论。改变多个参数是允许的，也没有解释何时无法将差异归到某单一处理。

**建议 P1**：在现有参数台上提供一个轻量“实验卡”：问题、预测、处理变量、保持条件、观察指标、反证条件、结果与结论。显示实际 treatments 并提示多因素对照的解释边界；不必先实现实时分叉、自定义全部模型或大型 DOE 系统。

## 3. 最小教育增强的实现接口

### 数据与内容

以下是最小实现方向。后续具体字段以 `education-contracts.md` 的十对象契约为准；其中明确拆出 LearningOutcome、ExplanationCard、ReviewSchedule、Recommendation，并统一三个旗舰及学习状态。

1. **ConceptDefinition**：稳定 id、可观察学习目标、前置概念、常见误解、应用案例、推荐补救活动。复用现有 48 个课内概念词时先合并同义词，不能把词条数量当成独立知识点数量。
2. **AssessmentItem**：item_id/version、goal_ids/concept_ids、variant_id、类型、答案契约、deterministic evaluator、各误解反馈、可用提示、需要的 EvidenceSelector。先支持选择/排序/数值/结构化机制链；开放文本先做结构反馈。
3. **LearningAttempt**：event_id、occurred_at、case_id、content_version、activity_id、item_id/variant_id、response、result、hint_level、feedback_seen、attempt_kind、run_ref[]。不保留原始隐藏 agent 私有状态。
4. **LearnerEvidence**：从 Attempts 派生的证据状态、最近独立证据、最近迁移证据、复习时间、推荐活动与理由。先用透明规则，不用缺乏实证校准的复杂知识追踪概率。
5. **LessonActivity**：stable activity id、phase、kind、goals、content、assessment_ref、可选 remediation_ref 与 next。保留旧 stage 映射，避免迁移丢失已有答案、笔记和运行。

学习事件属于学生浏览器内的学习状态，经济运行仍由现有 SQLite 与结果哈希维护。可用一个小的 IndexedDB learner repository 支持追加记录、事务迁移和导入导出；若选择 localStorage，也应定义容量和截断规则，不能悄悄覆盖首次或独立证据。无需账号、班级、云同步或 LMS 才能完成该闭环。

### 推荐增量顺序

| 增量 | 范围与复用 | 验收 |
| --- | --- | --- |
| 1. 学习证据骨架 | 三个旗舰：双向拍卖、SVB、Schelling；复用现有 criterion、SourceRef、预测和 Notes | 错误选择产生可解释误解标记；看提示后的改正不冒充独立证据；旧笔记不丢 |
| 2. 活动层与补救 | 七 phase 保留；每课增加一段 worked example、一道独立题和一题迁移 | 新活动不破坏 guided 揭示、领域视图和旧 URL；补救后可返回主线 |
| 3. 复习与迁移 | 本地复习队列；不同题目变式；跨课概念应用 | 同一道题看反馈后反复点对不会直接提升状态；未知概念与迁移失败显示合理下一步 |
| 4. 十二课扩展 | 使用案例内容契约批量补目标、题目、误解、解释 rubric | 12/12 全程无 API 可完成；每课至少一个独立证据任务，一项边界/迁移任务 |
| 5. 参数探究与助手 | 现有参数台加实验卡；修数值核对和 initial treatment 提示；可选 AI 解释审阅 | 记录真实 treatments；多因素不能声称单一原因；助手只引用已揭示来源 |

### 必要测试，不用测试数量替代教学验收

- 错误作答 → 定位误解 → 提示 → 变式再答 → 独立证据 → 一段跨案例迁移，全链可追溯。
- 课堂走完但从未完成独立任务，状态应为“完成体验，仍有待验证目标”，不能标全部掌握。
- 题目内容更新后旧尝试仍保留原 version；旧版七阶段笔记迁移保留原来源。
- 延迟复习和迁移题先不显示答案/提示；再次打开不会重置原尝试。
- 数值反馈验证单位、容差、frame/tick；有效数值不被一律拒绝，未观察数据不泄漏。
- 实验卡真实记录运行参数、共同输入与对照类型；五个种子结果不被包装成总体置信区间。
- AI 反馈只引用真实证据且不自动确认学生解释正确；无 Key、超时、坏输出回到本地任务反馈。
- 三个旗舰新活动通过后再推广十二课；维持本轮已通过的机制/契约回归及父代理核心浏览器验收。

## 4. Skill 使用证据

实际读取并采用 `data-analytics:analyze-data-quality`，以及 analysis-quality、source-selection、metric-definitions、shared-skill-instructions 四个配套文件。采用的方法是先界定数据用途与粒度，再检查完整性、版本/引用完整性、已揭示范围、数据来源、指标含义和声明是否被代码/实测支持。

具体执行产物：当前全部 lesson 内容计数与校验、七阶段约束探针、Tutor 输入/输出对照、309 项离线测试日志、每项结论的代码位置和证据等级。没有声称执行未安装的教育设计/产品管理 Skill，没有把 Skill 名称作为能力证据，没有安装外部脚本。

## 5. 可追溯产物

- `engine_probe.py`：可复现只读探针。
- `engine_probe.json`：12 课内容计数、契约拒绝、五个 tutor probes、L2 支持范围。
- `engine_tests.log`：本轮 309 项机制/契约测试完整输出。
- `engine_evidence.json`：证据与建议的结构化索引。

本报告所有代码引用相对于 `/workspace/scratch/174f3b0df579/ecosimedu_20261118`。最后 `git status --short` 为空，源代码保持未修改。
