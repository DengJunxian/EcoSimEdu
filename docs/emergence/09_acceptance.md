# EM09 本地候选验收

候选版本为 1.1.0-rc.4，工作副本 HEAD `585ffcbaaeb292f0addc10331ae7dae0c57ebd84`。候选版从原工作副本增量构建，不需要迁移或重置数据库。六门核心课的引擎源码与本机 rc.3 固定副本一致。

## 规格审查

独立复算新生成的六个规则运行，检查 Schelling 局部与宏观计数、SVB 现金／队列／权益与源申请、级联公共后验、拍卖撮合订单与剩余、公共物品结算和啤酒游戏库存与方差口径。实测规则复算通过。审查后补齐公共物品的同伴平均投入和净收益反查、啤酒游戏的样本周与环节反查，以及信息级联的共同核验来源。解释卡向学习者显示证据用途，保存结构提示状态和所选来源。开放机制解释由人复核。

## 工程标准审查

- 初态对照在旧笔记显示和 JSON 恢复中曾被当作未知运行。两处现使用共享验证，按配对 API、实际处理、Run/hash/seq 与同轮次记录核对。
- 信息级联的源引用曾把引导用户带到全运行观察者页。新证据镜头使用原位回放跳转，保持揭示范围。隐藏行动的记录标签与领域规则一致。
- 原旧 URL、原课堂进度、原始 Run 导出仍可打开。角色投影和引导 UI 有时点／字段遮罩；单机服务的原始导出和手工请求仍可用于完整观察。此包没有账号级考试权限边界。

## 本机重跑

```sh
npm --prefix student-web run build
python -m scripts.check_learning_packages
python -m pytest -q tests/contracts tests/mechanisms tests/e2e
CIVITAS_ED_WEBKIT=1 python -m pytest -q tests/e2e/test_education_activities.py -k 'not parameter_experiment'
```

实际终版测试结果见下表及本地 `output/education/emergence/` 日志。浏览器证据存于 `output/playwright/emergence/`。性能数据是单机同一固定时点的轻量样本。原生读屏的专项补验见文末。

| 项目 | 实测结果 |
| --- | --- |
| 终版构建 | TypeScript 和 Vite 通过 |
| 课堂复查 | 核心功能定向 20 项通过，含配对笔记恢复与同课揭示边界 |
| 全量合同、机制和浏览器回归 | 444 passed，302.48s |
| WebKit 专项 | 5 passed，1 deselected，28.18s |
| 课程内容与原结果 | 12 份 v3、36 个目标、41 个确定性运行、12 个边界及 4 个拍卖预设复跑通过 |
| 来源完整性 | 20 条课程引用、51 个数据资产摘要通过。数据清单仅更新六份新增活动的学习包摘要 |
| 尺寸与自动可访问性 | Chrome 158，320px／1440px 共 4 次 axe 扫描，零自动违规、零页面横溢。Schelling 色彩对比留有人工核查项 |
| 同机 Trace 响应 | 每例 15 次 HTTP 查询，Schelling／SVB／信息级联 p95 分别为 9.14／11.08／1.34 ms |
| 本机就绪 | 1.1.0-rc.4，十二课，外部 Live 未配置，机制索引返回 HTTP 200 |

独立人工教学盲评、真实学生效果、外部部署与 Live 提供商未验收。表中 Chromium、WebKit、课程验证和性能数据来自本地候选版的实际测试。

[同一份 rc.4 的浏览器与轴标补验](10_browser_verification.md)新增原生 Safari 路径，并确认 Chrome、Edge 和 Playwright WebKit 的机制闭环。Schelling 的 SVG 文字对比度人工复核项已按渲染颜色核算。

[系统旁白补验](11_voiceover_verification.md)确认了 Chrome 的 5 项原生字幕，原生 Safari 另有 4 项确认，覆盖指标事件按钮、完整反查标题、解释卡展开及论断输入。Chrome 反查标题的字幕曾截断编号，完整编号已在 Safari 旁白字幕中复现。两组证据的范围限于 Schelling 的这批交互。
