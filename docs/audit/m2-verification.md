# M2 六课本地验收

## 版本与运行

2026-11-16，macOS arm64，Python 3.12.13，Node 26.0.0，使用本机 Google Chrome。保留 M1 的本地服务地址与 SQLite 库。浏览器记录以课程 ID 和版本为键。课内规则执行不加载旧 LLM 配置。

| 层级 | 实际产出 | 验收范围 |
|---|---|---|
| 内容 | [发布目录](../../cases/catalog.json)，每课的 case.json 和 model.md | 六课各有七阶段、学生动作、两组反事实、可用事件与来源登记 |
| 运行 | [18 组基准与对照](m2-runs.json) | 精确重算运行摘要与根状态。同一次实验的事件、时标和快照一一对应。对照身份独立 |
| 契约 | [API 测试](../../tests/contracts/test_catalog.py)，[输出 Schema](../../schemas/lesson.run.schema.json) | 保存、重试、配对、事件前后状态、双拍成交源订单、跨课程拒绝 |
| 浏览器 | [新增五课](../../tests/e2e/test_course_catalog.py)，[双拍回归](../../tests/e2e/test_student_learning.py) | 五课各在 1440 和 390 px 完成，双拍在 1440、1280、768、390 px 完成。所有路径阻断外网请求 |
| 离线 | 六课直接生成与服务导入 | 禁用 socket.connect 后 18 组均可计算，未导入旧凭证配置。模型 API 调用为 0 |

完整回归结果为 65 项通过，包括 40 项机制、11 项 API 契约和 14 项真实 Chrome E2E。TypeScript、Vite、Impeccable 机械检测和 git diff --check 通过。

## 机制复核

- 居住隔离核对人口、群组、占用、空邻居、满格边界和每次搬迁合法性，独立枚举邻接对重算分化指标。
- SVB 逐事件对账，区分流动性不足与净资产变化，核对等值迁移初始资产构成与独立网络干预。
- 信息级联以独立信号路径穷举核对似然，检查信息来源去重与未来行动不可见。浏览器可查看两种信号下的行动及其似然，隐藏行动情景中的全缺值仍保留指标选择。
- 公共品检查施罚预算、受罚截断与群体收益等式，复算十个固定种子的 30 个情景摘要。
- 公地检查取用、再生、归零、监测预算及比例分配，复算四个固定种子的 16 个情景摘要。

## 复跑

```sh
npm --prefix student-web run build
.venv/bin/python -m scripts.generate_auction_presets --check
.venv/bin/python -m scripts.check_lesson_catalog --milestone m2
.venv/bin/python -m pytest -q tests/contracts tests/mechanisms tests/e2e
git diff --check
```

设置 `CIVITAS_SCREENSHOTS=.civitas-edu/m2-screenshots` 可保留观察和对照图。本轮截图与日志位于 .civitas-edu。独立复核的问题包括全缺值导致切换控制消失、信息级联证据项缺少视图、事件深链版本校验、重新选择基准后旧文字需核对。已在共享外壳修复，浏览器测试覆盖缺值切回、行动似然和保留草稿重跑。

M2 完成范围为六门基础课。Schelling 的可操作实验卡固定空置率和棋盘尺寸。WP07 已具备单运行联动、事件链接、来源事件与配对末值/参数差异，跨情景同步时间轴及投影性能验收仍在后续范围。笔记和事件链接的恢复使用原本地数据库。
