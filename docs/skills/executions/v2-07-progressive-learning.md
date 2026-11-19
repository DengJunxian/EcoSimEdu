# V2-07 · Skills 执行记录

- **Playwright**。用 CLI 确认本地学生入口，用现有 Python Playwright 录入真实拍卖选择、提示和作答。独立持久档案模拟关窗和次日重开。导入使用实际下载的档案，验证错误评分、配额故障、原档恢复、证据摘要和复习。网络规则只允许本地同源静态资源。[复跑脚本](../../../frontend/tests/progressive_pedagogy_browser.py) · [运行日志](../../../output/playwright/v2-07/)
- **Impeccable**。读取项目上下文和适配规范，检查预判反馈、独立练习跳转和次日首页顺序。按实际界面核对 390px 和 1180px 的字段、键盘按钮和焦点。增加从解释卡到独立练习的直接入口，并在操作中核对标题及读序。[代码检查](../../../output/playwright/v2-07/impeccable.json) · [次日首页截图](../../../output/playwright/v2-07/chromium-390/03-next-day-home.png)
- **Test Scenarios**。将整体验收覆盖到正确通过、错误补救、重复作答、复习、数据故障、恢复和历史兼容，逐项检查实际浏览器和归档的状态。用原课内评估器核对首次、辅助、重复三个作答类别。[阶段验收与边界](../../v2/executions/V2-07.md)
