# ED09 · 本地浏览器与读屏复测

当前 rc.3 的课堂焦点修复与 Safari 读屏验收见 [收尾验收](closeout.md)。以下是 rc.2 记录。

2026-11-18，基于工作树 HEAD `585ffcbaaeb292f0addc10331ae7dae0c57ebd84`。本轮修复随 `1.1.0-rc.2` 交付。测试通过本地规则运行进入课堂，使用隔离浏览器档案与 SQLite。教学题、实验结果、个人记录与展示继续沿用已有身份。

## 读屏中发现的问题

| 操作 | rc.1 的实际朗读 | rc.2 修复与复测 |
|---|---|---|
| 键盘提交错答 | 本次基线中，拍卖和 SVB 首先读了字段，漏读核对提示。Schelling 在同轮读出了提示。 | 持久挂载仅包含反馈标题的状态区，字段和解释可继续顺序阅读。三课均读出「再核对这一步」。 |
| 拍卖从例题返回 | 仍读「看一个完整例题」。 | 新标题进入浏览器的无障碍树后再移动焦点，实际读出「练习」。 |
| 打开教学活动页 | 仅读通用站点标题。 | 按当前案例设置页面标题，读出「双向拍卖教学活动」。复习、概念和跨课练习也有独立页面标题。 |

软件组合为 Debian 13 ARM64、Orca 48.1、AT-SPI 2.56.2 和 Chromium 156.0.8078.79。X11 会话由 Xvfb 与 Openbox 提供，Speech Dispatcher 使用 eSpeak NG 与空音频接收端。测试从录入、焦点和键盘操作触发，用 Orca 送往语音后端的日志核对输出。11 项观察从 rc.1 的 7 项通过增至 rc.2 的 11 项通过，含拍卖实际按 Tab 移至平台收入、例题双向跳转和隔离展示链接。见[语音观察原文](ed09-orca.json)。

## 可重复运行

```sh
# 已锁定 Python 测试依赖，并构建学生端。
.venv/bin/python -m pytest -q tests/contracts tests/mechanisms tests/e2e

# 安装独立 WebKit，不回收已有浏览器缓存。
PLAYWRIGHT_SKIP_BROWSER_GC=1 .venv/bin/python -m playwright install webkit
CIVITAS_ED_WEBKIT=1 .venv/bin/python -m pytest -q tests/e2e/test_education_activities.py

# Edge 路径可用此环境变量改成本机的安装路径。
CIVITAS_TEST_CHROMIUM='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' \
  .venv/bin/python -m pytest -q tests/e2e/test_education_activities.py tests/e2e/test_auction_scenes.py \
  -k 'education_activities or offline_from_price_to_notebook'
```

WebKit 复测可传 `CIVITAS_ED_AXE` 指向 axe-core 4.14.0 的 `axe.min.js`，以及 `CIVITAS_ED_PERFORMANCE` 指向现有的结果目录，以保存题目区扫描。320 CSS 像素的拍卖用例启用移动视口和触控，并通过 tap 打开例题。

Linux 读屏复测使用已有 AT-SPI 的 X11 会话、Orca、Speech Dispatcher、xdotool 和系统 Chromium。在同一 D-Bus 会话中启动 Orca 并为其调试日志启用行缓冲，然后运行以下命令。Orca 48.1 的 `--debug-file` 使用普通文件缓冲。本轮只在测试启动进程中用 Python `runpy` 启动 `/usr/bin/orca`，对该日志的 `open(path, "w")` 指定 `buffering=1`，以实时读取完整语音行。容器测试用非 root 用户，网络关闭。

```sh
.venv/bin/python -m scripts.audit_orca --education \
  --speech-log /tmp/orca-debug.log --output /tmp/orca-education.json
```

## 未验证项

三旗舰和教学展示已补做 [原生 Safari 实测](ed09-safari.md) 与 [Chrome 加 VoiceOver 字幕实测](ed09-voiceover.md)。Safari 加 VoiceOver 已确认教学页标题和展示链接，课堂播报仍待确认。实体手机与平板、TalkBack 和 NVDA 待验。Orca 覆盖所列任务，axe 覆盖四个题目区。真实学生课堂表现及需要单独授权的在线供应商实跑仍待验证。
