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
