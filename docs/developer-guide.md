# 开发、配置与本地交付

两套学生端 React 构建产物由同一个 FastAPI 服务提供，原实验室使用 `/`，渐进课堂使用 `/explore/`。Python 3.12 运行依赖锁见 `requirements-edu.lock`，测试依赖锁见 `requirements-edu-dev.lock`。使用两套锁文件分别运行 `npm --prefix student-web ci`、`npm --prefix frontend ci` 和对应的 `run build`，再启动服务。默认 SQLite 文件为 `.civitas-edu/runs.sqlite3`，可用 `CIVITAS_EDU_DB` 设置绝对路径。服务监听 `127.0.0.1`。

## 模型配置示例

```sh
# 默认关闭。配置启用时，将模型凭证通过本机凭证管理方式注入同一个服务进程。
CIVITAS_LIVE_ENABLED=0 .venv/bin/python -m uvicorn services.simulation.api:app --host 127.0.0.1 --port 8776
```

启用时设置 `CIVITAS_LIVE_ENABLED=1`，向启动进程注入 `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY`。同时具备两者时先选 OpenAI。OpenAI 的模型为 `gpt-6-luna`，DeepSeek 接口的模型配置为 `deepseek-flash`。供应商选择、两币种预算、未知用量预留与重试见[调用实现](../services/simulation/live.py)。预算按单库累计，备份须保留同一账本。服务启动前可用 `CIVITAS_LIVE_TIMEOUT_SECONDS` 设置 Live 请求的 socket 超时，接受 1–30 秒整数，默认 12 秒。超时仍采用已有的有限重试与账本处理。计费口径见[模型回执](release/real-api-receipt.json)，最终费用以供应商账单为准。

## 修改课程与复跑数据

- 发布课在 `cases/catalog.json` 登记，通过同目录课程定义指定数据身份、来源、动作、种子、情景、问题与七阶段。引擎应对同种子、同行动和同初态执行机制，然后生成真实事件、快照与指标。契约见 [Schema](../schemas/)。
- `.venv/bin/python -m scripts.check_lesson_catalog --milestone m3` 验证目录和冻结运行。双向拍卖预设用 `.venv/bin/python -m scripts.generate_auction_presets --check` 验证。
- `.venv/bin/python -m scripts.case_seed_matrix` 复跑固定 20 种子。用 `PYTHONPATH=. .venv/bin/python docs/release/check_feedback.py` 核对反馈事件。用 `.venv/bin/python -m scripts.benchmark_student_lab --stress` 测本机性能。
- `.venv/bin/python -m pytest -q tests/contracts tests/mechanisms tests/e2e` 运行验收。E2E 默认使用本机 Google Chrome。Linux 可用 `CIVITAS_TEST_CHROMIUM` 指定系统 Chromium，设置 `CIVITAS_TEST_HEADED=1` 并由 Xvfb 提供图形显示。测试服务使用独立库并关闭高级 API；模型真调用脚本需要显式运行和独立费用授权。

## 事件与快照链接

`/?case=…&run=…&tick=…` 打开快照回放。独立的 `/?case=…&run=…&event=…` 按运行内原始序号打开事件。API `/api/runs/{id}/events/{seq}` 返回事件正文、总数、结果哈希和可空的关联快照序号。用原结果做哈希校验，既有快照和 trace 接口继续使用原契约。

## 备份、恢复与校验

```sh
.venv/bin/python -m scripts.lab_backup .civitas-edu/runs.sqlite3 ./lab-backup.sqlite3
.venv/bin/python -m scripts.lab_backup ./lab-backup.sqlite3 ./lab-restored.sqlite3
CIVITAS_EDU_DB="$PWD/lab-restored.sqlite3" .venv/bin/python -m uvicorn services.simulation.api:app --host 127.0.0.1 --port 8776
```

备份命令通过 SQLite 一致性快照复制数据库，验证 SQLite 完整性以及每个已保存结果的哈希；已存在的目标路径会保留。恢复时先验证新文件，再暂停原服务并重启到新库。复制外部相关状态时先核对目标数据和版本。新版课堂在 `/notes` 导入原始 JSON，旧版保留各自的导入入口。新版导入在写浏览器之前校验运行身份、版本、有效结果、引用指针和已有草稿。失败时保留原文件和本机记录。笔记中的引用依赖同一次 SQLite 备份。

对独立发布包先在同目录运行 `shasum -a 256 -c <归档名>.sha256`，解压后运行 `python3 -m scripts.package_student_lab --verify`。清单记录发布版本、原仓库 HEAD、打包源码树哈希、课程版本与逐文件哈希。归档自带生产构建，重新构建使用锁文件。原版 Streamlit Demo 和旧仓库审计在完整仓库中运行。最新安装与兼容测试结果见[升级验收](upgrade/acceptance.md)。

## 模型实验台接入

页面入口为 `/?view=model`。读取 `GET /api/live` 获取可选课程和服务配置。用户点击运行后，经 `POST /api/runs` 创建 `provider_kind=live` 的基准实验，再经 `POST /api/runs/{id}/start` 启动。供应商凭证由服务进程持有，浏览器只请求本地服务。API 文档可在本机 `/docs` 查看。

`GET /api/runs/{id}/rule-reference` 读取已完成的高级实验，按其原始行动和种子重算本地规则基准。接口核对课程和引擎版本、共同生成根、初始状态与干预参数。响应提供两组期末指标、原运行哈希和规则对照哈希。刷新、回看和导出均使用已保存的模型结果。服务端规则回退仍可生成对照，页面显示回退身份。取消运行可回看已保存内容，期末对照仅检索已完成运行。

## 多角色模型实验

`/experiments/multi-role` 使用 `/api/v2/model-lab`。规则参考始终使用本机引擎。供应商分支另外要求 `CIVITAS_L2_ENABLED=1`、服务端凭证以及 `CIVITAS_L2_MAX_USD_MICROS` 或 `CIVITAS_L2_MAX_CNY_MICROS` 的正金额限额。前端确认一次实验后才能启动付费分支。

SQLite 备份包含多角色运行及请求台账。进程存活时可暂停和继续，重启后可回看已提交前缀。同条件规则对照、原事件和使用回执可通过多角色页面导出。真供应商验收和故障模拟的范围见[升级验收](upgrade/acceptance.md)。

## 课堂证据助手

`POST /api/tutor` 携带场景时会使用场景导师。普通查询完全离线。配置 `CIVITAS_TUTOR_ONLINE_ENABLED=1` 和服务端凭证后，公开证据查询可由用户另行请求在线提示排序。模型输入使用已核对的公开证据摘要，输出只能选择既定顺序。预算、幂等和未知用量与模型实验共用同一库。
