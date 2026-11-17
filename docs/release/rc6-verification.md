# 1.0.0-rc.6 无障碍交互验收

本轮以双向拍卖、Schelling 和 SVB 的核心学习路径作浏览器走查，并在 RC5 归档复现原问题。

| 核对项 | RC5 基线 | RC6 的行为 |
|---|---|---|
| 窄屏社区格子 | 390px 下单格约 15.55 × 15.55 CSS px。 | 保留方向键和地图点选，同时提供两个至少 44 × 44 CSS px 的原生行列选择控件。选格后的住户、位置和同组邻居比例来自原始快照。 |
| 图表数值 | 通用指标仅有当前数值文本，成交价原可由图上小点或回放读取。 | 成交价格表列出已播放成交。通用指标表显示选中事件及相邻记录，含单位和缺失值标记。表内事件按钮同步跳转，时间轴可继续访问其他事件。 |
| 边界和来源事件焦点 | 三课按「下一步」到末条后，Chrome 的焦点落到页面主体。 | 「下一步」在到达边界后保留焦点并处于不可执行状态。关联记录跳转后可用时间轴继续操作。时间轴提供稳定的名称和当前事件读值。 |
| 320px 回流 | 三个课程入口的文件导入控件将页面撑至 324px。 | 导入控件随可用列宽收缩，保留原生文件选择。 |

对照 W3C 的[目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)、[焦点顺序](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)和[非文本内容替代](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)。验收包含键盘、触摸模拟、DOM 几何与 Chrome/Edge 自动扫描。综合合规认证和屏幕阅读器实机朗读仍待验。

## 实测结果

macOS Chrome 157.0.8103.78 在 1440、1280、768、390、320px 扫描 125 个页面状态。Edge 152.0.4191.53 在 390px 扫描 25 个状态。axe 4.14.0 未报告自动规则违规，所有被测状态均无页面级横向溢出。收据保留对比度、名称、ARIA 和目标尺寸中需进一步人工判断的项目。[Chrome](rc6-axe-chrome.json)、[Edge](rc6-axe-edge.json)

干净解包通过 233 项契约、机制和浏览器测试，并复算 12 课的 41 条固定轨迹。活跃服务打开了真实已保存 SVB 事件和新数据表，模型调用账本仍为 8 条。[安装与测试收据](rc6-install.json)

## 可重跑检查

```sh
.venv/bin/python -m pytest -q tests/e2e/test_accessible_evidence.py
.venv/bin/python -m scripts.audit_student_accessibility --axe /path/to/axe.min.js --width 1440 1280 768 390 320 --output /tmp/civitas-rc6-chrome.json
.venv/bin/python -m scripts.audit_student_accessibility --axe /path/to/axe.min.js --channel msedge --width 390 --output /tmp/civitas-rc6-edge.json
```

使用已读的 Impeccable 与 Playwright 说明规划交互和执行验证。按两份已读 anti-defensive-writing 说明写明失败基线、实际环境、修复范围和未完成项。
