# Civitas Economica 学生实验室

学生实验室开放十二门基础课。课程包括双向拍卖、居住隔离、硅谷银行挤兑、信息级联、公共品博弈、公地治理、柠檬市场、学校匹配、啤酒游戏、碳配额市场、闪电崩盘和 GameStop。每课支持七阶段学习、本地规则运行、至少两组配对对照、事件追踪与学习笔记。每课包含一条独立可运行的边界实验，双向拍卖另提供预计算回放。

## 本机启动

当前工作区可直接运行以下命令。独立交付包含预构建前端，首次使用时先安装锁定的 Python 依赖。

```sh
.venv/bin/python -m uvicorn services.simulation.api:app --host 127.0.0.1 --port 8776
```

用浏览器打开 [学生实验室](http://127.0.0.1:8776/)。

## 首次安装

进入解压后的目录。依赖未缓存时，首次安装需要连接依赖源。使用 Python 3.12。

```sh
uv venv --python 3.12 .venv
uv pip sync --python .venv/bin/python requirements-edu.lock
```

从源码检出或修改学生端后，使用 Node 22.12+（本次使用 Node 26）重新构建。

```sh
npm --prefix student-web ci
npm --prefix student-web run build
```

安装并构建之后，学习仅需浏览器和本地 Python 服务。服务使用 `.civitas-edu/runs.sqlite3` 保存运行，可用 `CIVITAS_EDU_DB` 指定其他路径。浏览器本地保存学习笔记，恢复引用需要原数据库。可在笔记页和实验工作台分别导出学习记录和完整运行。工作台的事件链接可在同一服务恢复观测时点。对照页的同步观察点以课程的期次、轮次或阶段为准。

## 高级实验与学习助手

四门课的行动步骤提供高级实验。设置服务端环境变量 CIVITAS_LIVE_ENABLED=1 后，只使用服务端配置的 OPENAI_API_KEY 或 DEEPSEEK_API_KEY。OpenAI 可用时优先使用 GPT-6 Luna。实时基准实验预算由本地数据库记录，点击「运行高级实验」才可能产生模型费用。现有进度和普通规则实验可继续本地使用。离线学习助手使用课程、术语和已保存运行作为证据。四门课的真实回执、费用口径与限制见 [WP08 验收](docs/audit/wp08-verification.md)。

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

来源原文定位、教学资产版本和再分发范围见[来源与数据资产核验](docs/audit/source-asset-verification.md)。E2E 默认使用本机 Google Chrome 和独立数据库。Linux Chromium 的复跑方式见[开发指南](docs/developer-guide.md)。完整仓库可用 `.venv/bin/python -m scripts.audit_education_baseline` 复跑 WP00，旧应用使用自身依赖并通过 `streamlit run app.py` 启动。操作与证据见[用户指南](docs/user-guide.md)、[开发指南](docs/developer-guide.md)和[交付验收](docs/release/acceptance-report.md)。
