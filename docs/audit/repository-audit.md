# WP00 仓库基线复核

工作区 `EcosimEdu` 最初仅有 `.git`，`main` 尚无提交、远端和跟踪文件。适用的用户规则由会话提供，沿上游目录检查未发现文件型 AGENTS.md。执行包指定的 Demo 远端 HEAD 与 2026-11-16 审计 SHA 一致。经按 SHA 获取，在 `codex/ecosim-education` 检出 `585ffcbaaeb292f0addc10331ae7dae0c57ebd84`，当时工作树干净。其他 Civitas 研究仓库独立。仅进行了 Git 读取和本地修改。

宿主 macOS arm64，默认 Python 3.14.7。本轮使用隔离 Python 3.12.13，Node 26.0.0、npm 11.12.1，学生端使用独立锁定依赖。旧 requirements-lock.txt 记录 Windows/Python 3.14.2。旧整套依赖安装与完整 Streamlit 交互验收仍待执行。

## 可复跑证据

```sh
.venv/bin/python -m scripts.audit_education_baseline
```

[结果](baseline.json)记录当次 266 跟踪文件、204 个 Python 文件 AST 解析成功。重点源路径按[复用表](reuse-map.md)检查。执行了撮合（两笔同价先后、部分成交、撤单、FOK）、传播（同种子五步、区间检查）、三组演示完整推进、分布/数据真实性检查、IOC 和配置哈希边界。检测时禁止 socket connect。

| 审计项 | 本次证据与处理 |
|---|---|
| 演示与运行模式 | `core/competition_demo.py` 逐资产播放 12 步、5 条叙事，行情/叙事步键完整。表缺少来源字段、主体与关系记录。DEMO/LIVE 是演示入口状态，SMART/DEEP 是旧引擎层模式。 |
| 新闻 | `data/seed_events.jsonl` 的事件粒度为一条种子记录。13,665 个不同 ID 共 5 种标准化标题、原文与 `source_url`，每个 mock 地址出现 2,733 次。教学来源登记来自课程来源表。 |
| 默认凭证 | 通过 AST 确认上游非空默认值存在。当前工作树移除了配置、LLM 客户端与 API 后端三处默认回退，可接收正常服务端环境配置。历史提交仍有原始内容。课程撮合的市场默认值与环境配置分离，有进程级导入隔离测试。 |
| 调度与模型标签 | `core/system/runner.py` 的 R1/7B 示例方法实际调用规则并改写模型标签与延迟。根 `simulation_runner.py` 的 IPC 调度器为另一实现。首课高级模式返回明确不可用。 |
| 演示对象 | `ui/components/scenario_diff.py` 的默认变体来自漂移和扰动。回放组件缺买入量时使用 52% 比例。 `ui/dashboard.py` 主动生成并标识 synthetic tape。新课程走独立订单/账本证据链。 |
| 复现 | 旧 `core/reproducibility.config_hash` 对两个 `max_tokens` 值产生碰撞，`core/society/network.py` 有全局 `random.sample` 路径。课程使用局部 RNG 与完整、安全的显式参数和结果摘要。 |
| 生命周期 | 空簿 IOC 不休眠但状态仍为 pending。在新教学规则中精确限定为 LIMIT。旧 IOC 状态及全局随机、哈希实现保留在旧演示范围，待调用方专项验证。 |
| 宏观与 CSAD | `core/macro` 代码为信号更新。CSAD 是横截面离散指标，旧仪表盘中用作羊群效应名称。本轮没有宏观账本验收与 CSAD 识别验证。 |

语法扫描涵盖全部 204 个旧 Python 文件。人工链路核查聚焦 LOB/Schema、传播状态、宏观信号、配置/哈希、回放、两个调度入口及相关 UI。旧认知、世界、政策与事件整链、数据飞轮、C++、Ray、IPC、完整 Streamlit 浏览器流程和真实模型均待运行验证。旧项目的规划产物与当前本地课内验收相互独立。
