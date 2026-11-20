# Civitas Economica 学生实验室

学生实验室开放十二门基础课。课程包括双向拍卖、居住隔离、硅谷银行挤兑、信息级联、公共品博弈、公地治理、柠檬市场、学校匹配、啤酒游戏、碳配额市场、闪电崩盘和 GameStop。每课支持七阶段学习、本地规则运行、至少两组配对对照、事件追踪与学习笔记。每课包含一条独立可运行的边界实验，双向拍卖另提供预计算回放。

## 本机启动

安装 uv 后，独立候选包中的 `start-student-lab.command` 或 `start-student-lab.cmd` 会按锁文件启动本机服务。`UVICORN_PORT` 可选择端口，默认 8776。源码构建和文件校验见 [候选包说明](docs/v3/10-release.md)。

用浏览器打开 [学习首页](http://127.0.0.1:8776/)或同源的[渐进课堂](http://127.0.0.1:8776/explore/)。可直接进入[新版双向拍卖](http://127.0.0.1:8776/learn/double_auction)、[SVB 挤兑](http://127.0.0.1:8776/learn/svb_run)或[居住隔离](http://127.0.0.1:8776/learn/schelling_segregation)，在[案例库](http://127.0.0.1:8776/cases)选择其他课程，在[实验笔记](http://127.0.0.1:8776/notes)查看新旧记录、导出或恢复新版 JSON。原版双向拍卖仍可通过[旧课堂入口](http://127.0.0.1:8776/?case=double_auction)打开。

升级后如已有服务在运行，请用原服务的环境配置、端口和数据库路径重启。浏览器按来源存储课堂草稿，同一主机名和端口才能读到原有本地进度。

## 首次安装

进入解压后的目录。依赖未缓存时，首次安装需要连接依赖源。使用 Python 3.12。

```sh
uv venv --python 3.12 .venv
uv pip sync --python .venv/bin/python requirements-edu.lock
```

从源码检出或修改学生端后，使用 Node 22.18+ 重新构建两套前端。

```sh
npm --prefix student-web ci
npm --prefix student-web run build
npm --prefix frontend ci
npm --prefix frontend run build
```

安装并构建之后，学习仅需浏览器和本地 Python 服务。服务使用 `.civitas-edu/runs.sqlite3` 保存运行，可用 `CIVITAS_EDU_DB` 指定其他路径。浏览器本地保存学习笔记。跨浏览器恢复需要原始笔记 JSON 和原数据库。可在笔记页和实验工作台分别导出学习记录和完整运行。工作台的事件链接可在同一服务恢复观测时点。对照页的同步观察点以课程的期次、轮次或阶段为准。

## 换地址后恢复已有学习

在既有学习地址启动统一版，原浏览器档案会继续使用该地址的原站点存储。四阶与原课堂的记录格式各自保留。换主机名、协议、端口或浏览器档案时，按记录类型显式携带备份。

1. 从原四阶静态地址的「实验笔记」导出四阶学习备份，在统一版的 `/explore/?view=notes` 导入。[旧独立静态地址的导出步骤](frontend/README.md#启动与验证)
2. 从旧服务的 `/notes` 导出「作答记录」及各课「原始记录」。到统一版的 `/notes` 恢复 IndexedDB 作答及七阶笔记。更早的原通用课堂笔记从 `/?case=案例ID` 恢复。目标已有同一课堂的有效通用草稿时，先备份或使用另一浏览器档案。
3. 笔记引用的运行由原 SQLite 保存。新服务继续使用原数据库，或用已有备份工具复制到一个新的数据库文件。恢复笔记前先核对运行链接。两个运行库都已有记录时，分别保留并用对应服务打开。[数据库备份与恢复](docs/developer-guide.md#备份恢复与校验)

备份和导入均由用户发起，原站点的浏览器记录保留在原档案。已安装的单前端旧包可继续打开原实验室。构建两套前端并重启本地服务后，`/explore/` 才提供渐进课堂。

## 参数对照

[参数对照](http://127.0.0.1:8776/compare)开放十二门课的有界模型参数，使用同一行动和种子生成配对运行。Schelling 可比较两种初态，啤酒游戏可预提交逐周订单，公共品可预提交逐轮贡献。同步观察点可查看两组主体和原事件。可以追加四个连续种子并导出全部运行。

## 高级实验与学习助手

四门课的原版高级实验和[多角色模型实验](http://127.0.0.1:8776/experiments/multi-role)均为可选项。多角色页的「运行规则参考」离线可用。启用供应商分支需要服务端凭证和对应开关。多角色分支同时要求金额限额；用户确认后启动才可能产生费用。环境参数见[开发指南](docs/developer-guide.md)。

离线学习助手从课程和已揭示的运行证据提供分层提示。在线排序是独立的可选功能，未配置或失败时仍给出离线解释。多角色模型的本轮证据来自本地规则与受控供应商。四课原版的单角色真实回执见 [WP08 验收](docs/audit/wp08-verification.md)。
## 重跑验收

```sh
uv pip sync --python .venv/bin/python requirements-edu-dev.lock
.venv/bin/python -m scripts.generate_auction_presets --check
.venv/bin/python -m scripts.check_lesson_catalog --milestone m3
.venv/bin/python -m scripts.case_seed_matrix
.venv/bin/python -m scripts.check_boundaries
.venv/bin/python -m scripts.check_course_provenance
.venv/bin/python -m pytest -q tests/contracts tests/mechanisms tests/e2e
```

来源原文定位、教学资产版本和再分发范围见[来源与数据资产核验](docs/audit/source-asset-verification.md)。E2E 默认使用本机 Google Chrome 和独立数据库。Linux Chromium 的复跑方式见[开发指南](docs/developer-guide.md)。完整仓库可用 `.venv/bin/python -m scripts.audit_education_baseline` 复跑 WP00，旧应用使用自身依赖并通过 `streamlit run app.py` 启动。操作与证据见[用户指南](docs/user-guide.md)、[开发指南](docs/developer-guide.md)和[升级验收](docs/upgrade/acceptance.md)。

## 教育升级 1.1 候选版

案例详情展示学习目标。十二课保留原运行方式，在解释和笔记阶段加入自编练习、题目反馈及迁移任务。作答存在此浏览器的 IndexedDB。可从实验笔记导出作答记录，课堂的运行引用依赖原 SQLite 数据库。

复习、概念、跨课任务和教学活动页均可在本机打开。教学展示使用独立档案。参数对照中的实验计划会在运行前保存，结果处可把同一观察点的两组运行带回课堂解释卡。解释卡的结构检查和事件引用核对各有状态。

发布前运行 `python -m scripts.check_learning_packages`。1.1.0-rc.3 的实测与已知边界见[本地候选验收](docs/education-upgrade/release-acceptance.md)。

## Emergence Studio 候选版

启动本机服务后，从首页的「从微观到宏观」进入十二课机制索引。新手可以从居住隔离开始，保留入场预测，沿 A001 的动作、受影响邻居和两项全图指标追踪一次真实搬迁。图表的数据表支持键盘反查。完成基准回放后可用相同种子和阈值重跑另一种初态，引用两侧记录并导出解释卡。

硅谷银行、信息级联、双向拍卖、公共物品和啤酒游戏也提供机制证据或双向回查。解释卡记录引用用途及是否使用结构提示，浏览器原有作答、笔记及归档保持可恢复。课程与解释均可在本机运行。查看[专项进度](docs/emergence/progress.md)与[验收说明](docs/emergence/09_acceptance.md)。

原事件页和完整运行导出用于本机复盘。课堂证据按选定时点读取。单机实验室适合观察和学习，可用的账号隔离与考试安全需要另行部署设计。
