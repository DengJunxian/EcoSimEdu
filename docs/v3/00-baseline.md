# WP00 · V2 基线

2026-11-20。远程 `main` 与附件审阅提交 `72c5dd35ecc19e3d27fb97f3dcc194ca1e9cab7d` 一致。V3 在独立工作树 `EcosimEdu-V3`、分支 `codex/ecosimedu-v3` 实施。原目录在 `585ffcbaaeb292f0addc10331ae7dae0c57ebd84` 上有大量本地教学文件和修改。验收在 Python 3.12.13、Node 26.0.0 下使用临时 SQLite 和浏览器档案。

## 已有能力与文件去向

| 现有文件或目录 | V2 核查 | V3 去向 |
| --- | --- | --- |
| `frontend/src/CourseMap.tsx`、`StudentHeader.tsx`、`classroom-routes.ts` | `/explore/` 为渐进课堂。四条路径、十二课、原链接和继续学习已接通。 | 在渐进首页加可跳过的配置，课堂头部提供设置入口。 |
| `frontend/src/lesson.ts`、`Studio.tsx`、领域课堂 | 已有四阶状态、回放、局部证据和原预测。 | 八阶段编排复用状态机和课件。验证旧检查点后逐项接入。 |
| `frontend/src/run-evidence.ts`、`services/simulation/projection.py`、`api.py` | 浏览器规则 ID 和存档 UUID 各有身份。已有事件和投影检查。 | AI 请求采用运行描述符或存档 ID。服务端核对并裁剪。 |
| `TraceMicroscope.tsx`、`microscope.ts`、领域面板 | 三旗舰显微镜、其余领域面板和十二课机制索引已有实现。 | 复用真实事件和导航，按课程补齐四层解释及逆向定位。 |
| `cases/catalog.json`、`cases/*/learning-v3.json`、`student-web/src/learning/` | 十二门稳定 Case ID、36 项学习目标、既有独立证据和复习记录。 | 用原作答和帮助曝光契约接入阶段编排，保留原生导入导出。 |
| `student-web/src/app/local-model.tsx`、`live_client.py`、`tutor_online.py` | 旧在线能力使用进程全局配置。原在线导师提供受限排序和追问。 | 保持旧接口。V3 新增独立会话，复用固定供应商传输及用量解析。 |
| `ExperimentWorkbench.tsx`、`parameter_specs.py`、`live_l2.py` | 配对、多种子和四课高级多角色模型实验具备入口。 | 先复用，检查点和多轮实时分叉按课建立可复现合同。 |
| `student-web/`、`/learn/*`、`/notes`、`/teach`、`app.py` | 原课堂、教师、笔记及研究应用各有调用者和数据。 | 保留入口。重复的业务实现仅在兼容迁移验收后评估。 |

已有逐课机制与数据名单见 [十二课验收](../v2/release/courses.md)、[V2 质量](../v2/release/quality.md)、[数据迁移](../v2/release/migration.md)。

## 本轮复跑

- 两套学生端生产构建通过。Node 渐进课堂测试 57 项通过。
- Python 合同和机制测试 344 项通过。
- 拍卖 21 条轨迹共 3132 帧通过 Python/TS 一致性。其余十课 92 条配对轨迹共 6228 帧通过。
- SVB 18 条轨迹共 378 帧的金额与事件顺序一致。合计 131 条 Python/TS 轨迹及 9738 帧。
- 本机 Chromium 在 1180px 和 390px 走通十二门渐进课，核查课内决策、观察、反事实及证据。课程地图验证全部十二个原课堂链接。三旗舰独立作答、迁移、次日复习、教师隔离展示与篡改拒绝通过。另复查拍卖成交取证、SVB 资金链和多标签冲突恢复。

复跑入口

```sh
npm --prefix frontend run build
npm --prefix frontend test
npm --prefix student-web run build
python -m pytest -q tests/contracts tests/mechanisms
PYTHONPATH=. python frontend/tests/auction_parity.py
PYTHONPATH=. python frontend/tests/svb_parity.py
PYTHONPATH=. python frontend/tests/remaining_parity.py
python frontend/tests/map_browser.py http://127.0.0.1:8776/explore
python frontend/tests/auction_browser.py http://127.0.0.1:8776/explore
python frontend/tests/svb_browser.py http://127.0.0.1:8776/explore
python frontend/tests/remaining_browser.py http://127.0.0.1:8776/explore
python frontend/tests/release_browser.py http://127.0.0.1:8776/explore
```
