# 1.0.0-rc.4 大运行和 Linux 浏览器验收

继 [RC3 事件定位](rc3-verification.md)之后，本轮检查超过 24 MiB 的运行记录和 Linux 上的图形浏览器。十二门课的模型与数据定义沿用现有版本。

## 大运行定位

用同一份合成跟踪数据对照。运行含 100,000 条事件、500 个主体 × 300 帧、单帧 5,000 条关系，SQLite 中的完整记录大小为 36,226,307 bytes（约 34.5 MiB）。首尾及跨范围 30 个序号核对原始事件、运行哈希和快照关联。事件和快照测试同时覆盖损坏记录与越界。

RC4 首次访问大运行时仍完整解码并验证结果哈希。后续读取按整份当前记录的 SHA-256 指纹核对，使用 SQLite 提取请求的 JSON 片段。大运行的快速路径只驻留一个内容指纹。与核对过的原始字节有差别时，完整校验会重新执行。快照和事件 API 继续使用原返回契约。

复跑命令如下。

```sh
.venv/bin/python -m scripts.benchmark_student_lab --oversized
```

测试包括本机服务、SQLite 和实际 Chrome。这一规模为单用户串行实验。首读和重复定位有独立数据。整份运行仍可从既有回放入口载入，当前整份回放和导出继续按完整记录读取。

同一台 Mac17,3、macOS 27.0、Chrome 157.0.8103.78。每个重复指标各测 30 次。

| 重复操作 | RC3 p95（ms） | RC4 p95（ms） |
|---|---:|---:|
| 单事件 API | 251.553 | 62.029 |
| Chrome 直接打开事件链接 | 303.292 | 99.685 |
| 快照 API | 255.941 | 42.180 |

RC4 单次首次事件 API 读取为 252.601 ms，高于 200 ms 的交互目标。整份共享回放首次打开为 1.354 秒。服务进程结束时的 RSS 从约 1,895 MiB 降到 419 MiB，两者均为时点读数。[完整收据](rc4-performance.json)

## Linux 浏览器

测试环境为 Colima Linux ARM64 容器，使用 Debian 13、Python 3.12 和系统 Chromium。测试以普通用户运行 Chromium，在 Xvfb 图形显示中打开窗口。仍可在 macOS 使用已安装的 Google Chrome 运行相同测试。Windows、Linux 桌面环境的人工操作与辅助技术矩阵分别保留待验。

Linux 的 228 项测试全部通过。macOS 在空目录解包后也通过 228 项，复算 12 门课的 41 条固定轨迹。已开启的本机服务复核四份已存真实模型事件和关联快照，模型请求账本仍为 8 条。[安装与测试收据](rc4-install.json)

Linux 检查使用系统预装的软件包 `chromium`、`xvfb`、`xauth` 和 `fonts-noto-cjk`。安装锁定的 Python 测试依赖后复跑。

```sh
CIVITAS_TEST_CHROMIUM=/usr/bin/chromium CIVITAS_TEST_HEADED=1 \
  xvfb-run -a .venv/bin/python -m pytest -q tests/contracts tests/mechanisms tests/e2e
```

## 方法

沿用已读的 Playwright，用同一组学习路径和 SQLite 服务回归真实浏览器。分别报告过程内首读、重复定位与一次整页载入。报告沿用两份已读取的 anti-defensive-writing 说明，保留未过阈值与平台限制。课程源数据、历史运行及已有模型账本另从原库副本核对。
