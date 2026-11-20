# EcoSimEdu V2 发布说明

## 启动

在仓库根目录使用 Python 3.12、uv 和 Node.js 22.18 或更新版本。依赖安装使用锁文件。预构建归档可直接使用其中的两套前端资源。

```sh
uv venv --python 3.12 .venv
uv pip sync --python .venv/bin/python requirements-edu.lock
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix student-web ci
npm --prefix student-web run build
.venv/bin/python -m uvicorn services.simulation.api:app --host 127.0.0.1 --port 8776
```

- 学生从 [课程地图](http://127.0.0.1:8776/explore/) 进入十二课。提交原判断后观察真实模型事件，完成配对对照和解释，再做独立应用与迁移。提交独立应用题后，次日在同一浏览器的 [复习页](http://127.0.0.1:8776/explore/?view=review) 打开新题。
- 教师打开 [教师工作台](http://127.0.0.1:8776/teach)，选课后选择 10、20 或 40 分钟，下载包含案例版本、种子、规则预设及展示阶段的 JSON。用「打开隔离展示课堂」进行演示。示范解由教师显式打开。用「查看学生解释作品」导入本课的解释 JSON 并核对两条来源。
- 历史学习从 [原实验室](http://127.0.0.1:8776/) 或 [原笔记页](http://127.0.0.1:8776/notes) 进入。旧端 URL 和 SQLite 仍由原路由和运行库解析。保持旧地址使用原浏览器档案，换地址前按 [备份与迁移](migration.md) 备份。
- 模型配置在原实验室首页的 [本机设置](http://127.0.0.1:8776/#model-api)。课堂和规则对照可在关闭在线能力时使用。服务与前端同源运行，课堂文件由本机服务提供。

## 本版交付

十二课具有同源四阶路径、离线规则运行、定向证据、合法配对反事实、解释和正式练习。三门旗舰提供显微镜与事件反向定位。学校匹配、柠檬市场和信息级联有领域画布与来源题。公共品、公地治理、碳配额、啤酒游戏、GameStop 和闪电崩盘在四阶课堂使用各自的领域面板回查事件和核对政策账目。原七阶入口也可打开相应领域视图。 [六课领域面板验收](../executions/V2-domain-panels.md)

新增教师作品核对读取当前版本的解释导出，其事件和摘要由本地规则重算。导入文件在当前页面内处理。SVB 到闪电崩盘的双来源教师复核继续走原专用往返。恢复续学时会核对写入所基于的保存值，陈旧标签保留较新的检查点。拍卖需求处理的事件账按实际费用记账。

- [统一架构](architecture.md)与[原接口契约](../contracts.md)
- [十二课教学验收](courses.md)与[产品及工程验收](quality.md)
- [备份与迁移](migration.md)
- [真实学生试用协议与课堂量表](teaching-study.md)
- [已知边界与下一版本路线图](roadmap.md)

V2 是产品版名称。本机 API 沿用 `1.1.0-rc.4` 的兼容标识。测试证明的是本地软件行为和内部教学任务流程。真实学生效果的估计等待试用数据。
