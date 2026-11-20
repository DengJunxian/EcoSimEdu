# 六课领域面板的技能执行记录

| 技能 | 本轮实际操作 | 可复核产出 |
| --- | --- | --- |
| Impeccable | 用现有设计上下文检查 `ModelClassroom.tsx`。沿用原领域组件和教学样式，在四阶视图内检查布局、焦点及表格与控件的窄屏适配。源码 `detect --json` 返回空结果。检查了 320 px 闪电崩盘和 390 px 碳配额实跑截图。 | [课堂布局](../../../frontend/src/domain-classroom.css)，[界面验收](../../v2/executions/V2-domain-panels.md) |
| Playwright | 核对 `npx` 并使用技能的 CLI 打开公共品课堂和查看快照。沿用仓库浏览器测试，用已安装的 Chrome 和 Playwright WebKit 逐课驱动事件、反事实、迁移、笔记和备份。用键盘激活回查控件并断言焦点，在可见领域面板加载本地 axe 规则。 | [六课验收脚本](../../../frontend/tests/domain_panels_browser.py)，[逐课实走](../../v2/executions/V2-domain-panels.md#逐课实走) |

领域事件与政策结果由已有浏览器模型生成，沿用仓库内的 Python 与 TypeScript 对账、来源校验和摘要测试。产品复核逐条对应六课学生任务，保留现有题目及评分口径。浏览器语义采用键盘与自动规则验证，实机旁白和真实学生试用单列为待验证项。
