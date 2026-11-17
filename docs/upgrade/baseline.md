# UP00 基线与行为修复

开始时实际 HEAD 为 `585ffcbaaeb292f0addc10331ae7dae0c57ebd84`，分支 `codex/ecosim-education`。审查快照 `dc288b82001a332ae6cddbc0d3bc29f4556a5a67` 在本地可读，实际 HEAD 是其祖先。教学代码、案例与测试位于未跟踪工作树。按实际文件内容比对审查提交的 106 个 `student-web/`、`services/`、`cases/`、`tests/` 路径，进入 UP00 时其中 105 个文件一致，已有的 `cases/data-assets.json` 差异保留。已有配置与研究代码修改保留。

## 本轮验证

| 命令 | 结果 |
|---|---|
| `npm --prefix student-web run build` | UP00 前的工作树基线构建通过。修复后的独立阶段副本也构建通过。 |
| `.venv/bin/python -m pytest -q tests/mechanisms tests/contracts` | 工作树基线 212 项通过。 |
| `.venv/bin/python -m scripts.case_seed_matrix` | 十二课 820 个情景与种子组合各重算两次，与已保存的复现回执一致。 |
| `.venv/bin/python -m pytest -q tests/e2e/test_guided_replay.py tests/e2e/test_accessible_evidence.py` | 在 macOS 本机 Chrome 和独立临时 SQLite 中检验，阶段副本和集成工作树各 5 项通过。两个新增 SVB 回归在升级前失败。同步核对旧 SVB、拍卖与 Schelling 深链和键盘行为。 |
| `.venv/bin/python -m pytest -q tests/e2e/test_course_catalog.py tests/e2e/test_student_learning.py tests/e2e/test_release_paths.py` | UP01 导航接入后的旧课堂与发布路径，31 项通过。 |

附件中的 59 组独立后端复核为审查时证据。

## SVB 如何复核

运行 `.venv/bin/python -m uvicorn services.simulation.api:app --host 127.0.0.1 --port 8776`，进入 `/?case=svb_run`。开始实验，预测“不确定”，以默认行动运行后进入「追踪申请与到账」。

1. 事件 0 的现金为 100。引导图在原版已画至事件 53，纵轴采用全程范围 0–290。修复后图表与数据表只使用当前及先前帧，刻度随已显示序列计算。点「查看全程」可主动复盘并导出完整记录。旧的保存运行深链直接进入复盘。
2. 选择 D01，点「固定 D01」，播放到首批提款申请，拖动时间轴或按 Home、End。主体身份持续保留，数值来自当前位置。缺少主体快照时显示当前事件没有状态记录。
3. 回到事件 0，向离线助手查询「事件 4 的银行现金」。引导时助手返回范围提示，复盘后可以查询。重新回到引导时，早先查询取得的未来事件答复随之隐藏。

基准样本用 `svb_run` 配置的默认种子和行动。事件、快照按事件序号一一对应，54 个事件覆盖开局和 20 个经济轮次。每个快照有 63 个主体，其中 D01 状态存在于 54 个快照，D01 只在 8 个事件的参与者字段中出现。播放和跳转原先清空主体选择，指标图原先接收整条帧序列。Schelling 的稀疏帧实测用于核对缺失展示。

UP03 接续共享选择与经济时钟。UP00 的固定主体状态属于当前回放视图，暂不随刷新迁移。服务端导师边界属于引导请求，完整运行和原始事件继续可由复盘入口读取。
