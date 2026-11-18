# 教育升级进度

2026-11-18 实施于 `codex/ecosim-education`，HEAD 为 `585ffcbaaeb292f0addc10331ae7dae0c57ebd84`，以下成果位于含既有教学文件的工作树。审计锚点为 `bfe31dd9`。

| ED | 状态 | 学生成果 | 本轮验证和后续 |
|---|---|---|---|
| ED00 | verified | 已揭示数值核对、初始处理与政策对照方法 | 309 项基线，4 项反例复现，修复后 313 项机制/契约与 4 条 Chrome 通过。 [执行记录](../skills/executions/ED00.md) |
| ED01 | verified | 十二课课前展示目标、概念与作品 | 36 项目标、12 份 v3、内容校验、独立参考解与 v2 API 兼容。 [执行记录](../skills/executions/ED01.md) |
| ED02 | verified | 尝试与暴露追加、历史版本留档、可移植备份 | Chrome 验证错答及重答、失败保留输入、旧版归档、相同 ID 冲突和先看未答暴露。运行身份需原库。 [执行记录](../skills/executions/ED02.md) |
| ED03 | verified | 拍卖完整例题、补救返回、独立题与迁移 | 限价 1 和 96 分别验证未成交与成交。刷新保留活动、预测、运行、时点及固定主体。 [执行记录](../skills/executions/ED03.md) |
| ED04 | verified | 三个旗舰共用作答并保留领域解释 | 原三类练习写入档案，三旗舰随机种子及领域回归复跑。独立教学新题与运行证据另有身份。 [执行记录](../skills/executions/ED04.md) |
| ED05 | verified | 四路径、概念索引、日期驱动的短复习 | Chrome 复习跨日、暂停恢复、陈旧标签页与证据验证。另在上海、洛杉矶、奥克兰测试本地日跨午夜。真实学生的长期复习表现待验证。 [执行记录](../skills/executions/ED05.md) |
| ED06 | verified | 参数实验与同源解释卡、三组跨课自查 | 浏览器执行计划、两组真实规则结果、带回解释、回读引用及草稿。引用核对和机制自评各自呈现。 [执行记录](../skills/executions/ED06.md) |
| ED07 | verified | 针对实际答案的离线反馈、可选追问 | 错单位、非法活动、坏模型选项、超时和离线回退通过。真实供应商本轮待验。 [执行记录](../skills/executions/ED07.md) |
| ED08 | verified | 其余九课的独立题、错误反馈、迁移与复习 | 九条 Chrome 路径、学科参考解、作者契约和数据资产校验通过。 [执行记录](../skills/executions/ED08.md) |
| ED09 | verified | 隔离展示、教学预设、导航、记录入口和可朗读的课堂反馈 | rc.3 修复作答焦点与旧焦点请求竞争。Safari 加 VoiceOver 11 项、Chrome 加 VoiceOver 10 项、Edge 9 项及 WebKit 5 项通过。 [收尾](closeout.md) · [字幕记录](ed09-rc3-voiceover.json) · [执行记录](../skills/executions/ED09.md) |
| ED10 | verified | 1.1.0-rc.3 十二课本地候选包 | 独立解包回归 429 项通过。浏览器、内容来源、性能与未验项见发布记录。 [发布验收](release-acceptance.md) · [执行记录](../skills/executions/ED10.md) |

## 验收范围

verified 对应本轮本地离线实现与记录所列检查。implemented 已接线，还需补足对应验证。运行验证与学生学习效果分开登记。继续保留已有 UP/RC 历史收据及候选资料。

[发布验收](release-acceptance.md) · [来源与题目审阅](content-review.md) · [追溯](traceability.md)
