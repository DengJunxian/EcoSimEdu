# M1 双向拍卖验收记录

2026-11-16。开发验证环境为 macOS arm64、Python 3.12.13、Node 26.0.0、npm 11.12.1、真实 Chrome。生产依赖锁额外在新建 Python 3.12.11 环境以缓存离线同步，14 个运行依赖安装成功，程序可导入且已构建学生端可挂载。

| 可复跑命令 | 通过结果 |
|---|---|
| `.venv/bin/python -m scripts.audit_education_baseline` | [基线 JSON](baseline.json)，204 文件解析、旧 LOB/传播/三组回放与两项旧边界 |
| `.venv/bin/python -m scripts.generate_auction_presets --check` | [三组摘要与哈希](auction-presets.txt)，生成结果与固定资产一致 |
| `npm --prefix student-web run build` | TypeScript 检查与 Vite 生产构建通过 |
| `.venv/bin/python -m pytest -q tests/contracts tests/mechanisms tests/e2e` | 21 项通过（14 机制与导入隔离、3 API 契约、4 Chrome E2E） |
| `git diff --check` | 通过 |

E2E 在 1440、1280、768、390 像素无外部请求完成学习。浏览器覆盖键盘启动、错答与不确定、首笔成交停顿、同一事件角色/订单、反事实比较、两条证据、刷新、无效报价草稿恢复、终态后原报价重试、笔记导入与导出。机制测试跨种子与报价边界，验证现金/库存/费用、无交叠市场、确定性、排序剩余上界及课内规则。API 验证未知预设、Live 不可用、并发幂等、取消后终态、跳转和导出 Schema。

设置 `CIVITAS_SCREENSHOTS=.civitas-edu/screenshots` 可捕获四档的首页、工作台、对照、笔记，现有截图也保存在该目录。独立走查提出报价草稿被误判、终态重试、窄屏指标、证据门槛四项问题。修复后四项复核通过。桌面比较图保留截图时的滚动位置。

实际验证中禁止使用外部模型。课内执行为原子同步计算，取消适用于已创建尚未启动的运行；播放暂停独立。旧 Streamlit 整体、可挂起和恢复的长时间运行、跨数据库笔记迁移、WP06–WP10 全产品范围和用户学习成效仍待后续验收。
