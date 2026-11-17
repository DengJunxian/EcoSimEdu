# 1.0.0-rc.2 补充验收

基于 [1.0.0-rc.1 交付](acceptance-report.md)，本轮复验窄屏和组合规模。课程输入、经济模型和已保存运行沿用原版本。

## 可访问性

390px 时，Schelling 和 SVB 的笔记证据下拉框会被长选项撑宽整页。现在控件随内容列宽收缩。三条主路径的窄屏回归检查直接断言页面宽度，并继续完成对照、证据和笔记。

| 浏览器与 WEB 状态 | 结果 |
|---|---|
| Chrome 157.0.8103.78，1440、1280、768、390px | 双向拍卖、Schelling、SVB 的七阶段共 84 次扫描，无自动规则违规及页面级横向溢出。 |
| Edge 152.0.4191.53，390px | 同三课七阶段共 21 次扫描，无自动规则违规及页面级横向溢出。 |
| 人工判断和辅助技术 | axe 的待人工判断项包含局部颜色对比、命名、ARIA 与目标尺寸，分别保留在扫描收据。全面符合性和屏幕阅读器矩阵待验。 |

使用 axe-core 4.14.0 的 WCAG 2.0 至 2.2 A/AA 自动规则。完整验收还需要人工和辅助技术走查。对照 [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)、[Chrome 收据](rc2-accessibility-chrome.json)、[Edge 收据](rc2-accessibility-edge.json)。

## 规模和响应时间

同一份合成运行含 500 主体 × 300 帧、单帧 5000 条关系和 100,000 条事件。实际服务加载完整运行，通过结果哈希校验，实际浏览器展开 5000 条关系。当前契约按帧定位，99,700 条额外事件只随整包传输及校验，未逐条通过时间轴定位。采样结果针对现有列表视图。

| 本机 Chrome 与回环 API，均 30 次 | p50（ms） | p95（ms） |
|---|---:|---:|
| 组合样本的 API seek | 148.920 | 163.754 |
| 浏览器切到关系密集帧 | 12.065 | 16.202 |
| 在密集帧展开 5000 条关系 | 86.304 | 102.298 |
| 12 课案例库筛选 | 2.041 | 2.702 |

机器为 Mac17,3、macOS 27.0、arm64、24 GiB。组合样本打开共享事件页的一次测量为 858.947 ms，原生闪电崩盘轨迹的 API seek p95 为 4.156 ms。当前课件的 41 条轨迹及早期独立压力样本见 [RC1 性能](performance.json)，本轮见[组合样本收据](rc2-performance.json)。

## 安装与浏览器回归

macOS 从空目录解包，用本机依赖缓存安装锁定版本，225 项契约、机制与 Chrome E2E 全部通过。初次全量运行的一条键盘测试在异步标题焦点迁移前发送按键，调整为等待标题获得焦点，再核对答错后可继续。

Linux ARM64 在 Colima 的 `python:3.12-slim` 容器，从独立归档安装锁定依赖。Python 3.12.13 下通过 192 项契约和机制测试，复算 12 课的 41 条默认轨迹和 6 条反馈链。测试含回环健康检查与持久化接口。Linux 图形浏览器和 Windows 待验。验收输出见[安装与测试收据](rc2-install.json)。

## 复跑

```sh
.venv/bin/python -m scripts.benchmark_student_lab --combined
.venv/bin/python -m scripts.audit_student_accessibility --axe /path/to/axe.min.js --output /tmp/civitas-chrome-a11y.json
.venv/bin/python -m scripts.audit_student_accessibility --axe /path/to/axe.min.js --channel msedge --width 390 --output /tmp/civitas-edge-a11y.json
```

扫描使用安装者提供的 axe-core 4.14.0 资源，只在测试浏览器中注入。应用运行依赖锁不含 axe。设计和检查沿用已读 Impeccable 和 Playwright，从两处真实布局问题回到共享 CSS，并在课堂路径上做回归；报告保留可见表格、可复跑快照和明确阈值。
