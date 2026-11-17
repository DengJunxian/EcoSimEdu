# 1.0.0-rc.7 Orca 屏幕阅读器验收

在 Debian 13 ARM64 的隔离 Xvfb/Openbox 会话运行 Chromium 156.0.8078.79 与 Orca 48.1。AT-SPI2 2.56.2 提供无障碍事件，Speech Dispatcher 0.12.0 和合成器输出送入 PulseAudio 虚拟音频设备。安装完成后断开容器网桥，课程与数据服务走容器内回环地址。浏览器视口为 390px。

## 缺陷与修复

- RC6 中用 Orca 打开 SVB 回放，完成载入时读出了“双向拍卖”。RC7 根据课程和页面类型设置标题，回放和独立事件页可区分。
- RC6 交互逻辑在行或列改动时立即更新地图。第一次实际操作中，Orca 在列菜单关闭时略过最终的格子状态。RC7 保留视觉上的即时更新，将坐标选择的朗读消息移到菜单收起后的独立 live region。

## 实测软件输出

| 动作 | Orca 的语音文本或已核对的后续状态 |
|---|---|
| 打开 SVB 回放 | 读出“硅谷银行挤兑 · 实验回放 · Civitas Economica”。 |
| 时间轴聚焦与右移 | 读出时间轴名称和事件 51。按右键后读出“事件 52，末条为 53”。 |
| 到达末条 | 按回车从 52 到 53，焦点继续留在「下一步」。Orca 的位置查询读出该按钮为停用状态。 |
| Schelling 行与列 | 分别读出行、列控件。用 X11 键盘事件打开原生菜单并改为第 2 行、第 2 列，收起后读出“A136 · 第 2 行第 2 列。同组邻居 3/7。” |
| 双向拍卖成交数据 | Orca 的表格导航找到成交价格表，读出“事件 123”、价格列标题及“95”。从表中按回车选取首条成交，时间轴同步到该事件。 |

共 10 项语音断言通过。另保留波形文件及其 SHA-256，单声道 PCM 片段时长 10.49 秒。语音文本取自 Orca 的合成输出日志，原始试验 UUID 不纳入收据。[Orca 收据](rc7-orca.json)

## 归档回归

macOS ARM64 从空目录解包后通过 233 项契约、机制和浏览器测试，重算 12 课和 41 条固定轨迹。活跃服务核对了旧 SVB 回放的新标题和已存模型决策，模型调用账本保持 8 条。[安装收据](rc7-install.json)

## 复跑

在测试用户的隔离 X11 会话中启动图形 Chromium、AT-SPI、Orca 和语音设备。浏览器与 Orca 须共享同一 `DISPLAY` 与 D-Bus 会话。运行 `orca --debug-file /tmp/orca-civitas.log --enable=speech`，启动后从含测试依赖的解包目录执行：

```sh
.venv/bin/python -m scripts.audit_orca --speech-log /tmp/orca-civitas.log --output /tmp/orca-civitas.json
```

脚本通过 Playwright 定位和核对控件，由 xdotool 发送操作按键。Orca 的位置查询、焦点模式和表格导航使用 GNOME 的快捷键。波形来自同一会话的 PulseAudio 监视设备。[GNOME 阅读命令](https://help.gnome.org/orca/commands_reading.html)、[表格导航命令](https://help.gnome.org/orca/commands_structural_navigation.html#tables)

本次采用已读的 Playwright、Impeccable 和两份 anti-defensive-writing 说明。结果覆盖这组 Orca/Chromium 任务。VoiceOver、NVDA、不同语言与语音配置、全面 WCAG 2.2 AA 和课堂辅助技术体验待验。
