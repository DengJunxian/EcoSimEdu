# rc.4 浏览器与坐标轴补验

本轮对同一份 rc.4 产品构建补验。在当前工作副本逐项核对了 229 个前端源码及构建文件、服务端文件、课程内容和 Schema，均与已交付离线包的 SHA-256 一致。补验新增的浏览器断言在当前工作副本。此前的 444 项全量结果保留在 EM09 报告。

| 实测范围 | Chrome | Edge | Playwright WebKit |
| --- | --- | --- | --- |
| Schelling 显微镜、机制索引、既有教学活动回归 | 9 项通过 | 9 项通过 | 9 项通过 |
| 专项 axe 4.14.0 扫描 | 5 次，0 违规 | 5 次，0 违规 | 5 次，0 违规 |
| Schelling SVG 坐标轴文字对比度 | 6.49:1 | 6.49:1 | 6.49:1 |

专项扫描包含 320px 机制索引，以及 390px 和 1440px 的搬迁与解释卡界面。Schelling 断言覆盖指针反查、用键盘从指标表回到事件 0、焦点移动、无搬迁提示、配对笔记的导出恢复和解释卡保存。axe 把 SVG 轴标列为人工复核项，因为无法判定图形背景。按实际渲染样式测量轴标前景 `rgb(75, 93, 83)` 与背景 `rgb(248, 246, 238)`，两种宽度的轴标观测均为 6.49:1，高于普通文字 4.5:1 的检查阈值。

## 原生 Safari 27.0

使用独立回环地址、临时 SQLite、本地规则和单独窗口。从机制索引进入课堂，看到首次自动搬迁事件 2 及网格指标复算。指标表反查事件 0 后，Safari 的焦点落在「搬迁与邻域 · 事件 0」，页面提示该点没有搬迁记录。完成回放后运行交错布局对照，第 1 轮两侧链接分别指向基准事件 74、分支事件 17。引用按钮变为「已引用初态对照」。已关闭测试窗口及临时服务，课堂浏览器设置保持原样。

## 复跑

在当前工作副本使用以下命令。设置 `CIVITAS_ED_AXE` 为本机 axe 脚本路径，可选地设置 `CIVITAS_ED_PERFORMANCE` 保存 JSON。默认使用 Chrome。Edge 使用 `CIVITAS_TEST_CHROMIUM` 指向 Edge 可执行文件。WebKit 使用 `CIVITAS_ED_WEBKIT=1`。

```sh
.venv/bin/python -m pytest -q tests/e2e/test_emergence_microscope.py tests/e2e/test_emergence_index.py tests/e2e/test_education_activities.py
```

日志、axe 结果、原生 Safari 运行凭证和截图在 `output/playwright/emergence/followup/`。Safari 使用浏览器界面和可访问性树验收，Safari 的系统旁白播报仍未验证。Chrome 的系统字幕另见[旁白补验](11_voiceover_verification.md)。
