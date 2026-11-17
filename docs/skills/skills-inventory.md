# 本轮技能发现

来源为本次宿主注入的 Skills 目录与实际本地文件。全表包含宿主多类技能；本项目按直接适用性选择以下可读、可执行的方法。技能文件本身由宿主管理。

| 名称 | 真实入口 | 范围与条件 | 本轮状态 |
|---|---|---|---|
| data-analytics:analyze-data-quality | `~/.codex/plugins/cache/openai-curated-remote/data-analytics/1.2.0/skills/analyze-data-quality/SKILL.md` | 表/事件/数据质量。数据在本地，采用可检查 Python 命令。 | 粒度、键、规范化去重、值域与外键走查已使用 |
| anti-defensive-writing（Kiterlin） | `~/.codex/skills/anti-defensive-writing/SKILL.md` | 实质写作；Markdown 指南，无额外运行依赖。 | 用于报告与课程内容 |
| anti-defensive-writing-skill（Adkid-Zephyr） | `~/.codex/skills/anti-defensive-writing-skill/SKILL.md` | 实质写作；以真实结果和适用条件组织论证。 | 用于模型解释与课程反馈 |
| impeccable 4.8.0 | `~/.agents/skills/impeccable/SKILL.md` | 学生端视觉、交互、响应式。可运行本地 launcher，已有产品规格决定方向。 | context、craft floor、检测器、实测走查 |
| playwright | 宿主目录 `~/.codex/skills/playwright/SKILL.md` | 浏览器自动化能力。当前工作包用独立 Python Playwright + 本地 Chrome，避免引入额外 CLI 会话。 | 技能目录可发现，测试依赖本身已运行 |

产品范围、审计和教学模型采用仓库合同测试、官方来源和操作脚本。旧 API、金融数据和大型行业研究与本轮离线切片无依赖。

## 2026-11-17 · UP00–UP04 宿主复核

下表记录本次读取并实际应用的能力，前文保留原工作包记录。以本机读到的说明和执行回执为准。

| 能力 | 本次可读来源 | 本次执行与验证 |
|---|---|---|
| mattpocock-skills:diagnosing-bugs 1.3.2 | 宿主缓存 mattpocock-skills/1.3.2/skills/engineering/diagnosing-bugs/SKILL.md | SVB 原版复现、定位共用回放、加入失败用例后复跑 |
| mattpocock-skills:codebase-design 1.3.2 | 宿主缓存 mattpocock-skills/1.3.2/skills/engineering/codebase-design/SKILL.md | 在既有运行 API 后增加课堂读取接口，原始订单索引集中复用 |
| data-analytics:analyze-data-quality 1.2.0 | 宿主缓存 data-analytics/1.2.0/skills/analyze-data-quality/SKILL.md | 事件与轮次两种粒度、订单引用和结算守恒、缺值、引导截断 |
| Impeccable 4.8.0 | ~/.agents/skills/impeccable/SKILL.md 与现有产品资料 | 纸白深绿延续，任务与订单可操作，窄屏与控件焦点复拍，检测器输出为空 |
| Playwright | ~/.codex/skills/playwright/SKILL.md 与 CLI 参考 | CLI 本机 Chrome 验证入口与操作。仓库的 Python Playwright 覆盖完整路径 |
| 两份 anti-defensive-writing | ~/.codex/skills/anti-defensive-writing/SKILL.md 与 ~/.codex/skills/anti-defensive-writing-skill/SKILL.md | 复核课堂与报告表述，保留无成交、费用转移和固定报价的适用条件 |

教学设计采用 UP02 的任务—选择—反馈—证据映射和 PhET 活动方法。拍卖经济事实来自现有模型、原始订单与结算。

UP05–UP06 复用同一宿主版本和既有产品风格。数据质量检查新增申请编号与批次支付、全部居民与稀疏参与者、同一经济轮末与结束事件三处粒度。Impeccable 检查关系编码、选择和焦点，Playwright 实测银行与社区的独立操作路径。技能的输入、实现和验证分别见 [UP05](executions/UP05.md) 与 [UP06](executions/UP06.md)。
