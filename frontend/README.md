# EcoSimEdu 渐进课堂

[课程地图](http://127.0.0.1:8776/explore/)按四条学习路径编排十二课。十二门课均在浏览器内计算和回放，基础教学只需本地静态文件。每张课程卡也能打开原课堂与进度。高级实验、复习、跨课作答和教师复核继续在原学生端使用。

## 启动与验证

需要 Node.js 22.18 或更新版本。第一次安装依赖需要可用的 npm 缓存或网络。运行依赖和原学生端设置见[学生实验室指南](../STUDENT_LAB.md)。

```sh
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix student-web ci
npm --prefix student-web run build
.venv/bin/python -m uvicorn services.simulation.api:app --host 127.0.0.1 --port 8776
```

打开[课程地图](http://127.0.0.1:8776/explore/)或[原学生实验室](http://127.0.0.1:8776/)。两个站内入口共用同一服务。课堂本身由浏览器规则运行，原版笔记、复习和模型设置使用同源路由。Vite 使用相对资产路径，构建产物也可由本机静态服务提供，用于打开旧来源中的四阶备份。FastAPI 在启动时发现两套构建目录。

在 [四阶实验笔记](http://127.0.0.1:8776/explore/?view=notes) 展开「备份与导入四阶学习」。换过端口的用户应先在原浏览器档案和原地址导出，再到新地址导入。两边键值相同时会去重。同键不同内容时保留目标已有记录，原记录所在的地址和导出文件仍可使用。

如果原独立静态版本没有备份按钮，请在原静态服务上提供本次的 `frontend/dist`。例如原地址是 `http://127.0.0.1:8878/`，停止自己启动的旧静态服务后，用以下命令在该端口提供新版静态文件，再访问 `http://127.0.0.1:8878/?view=notes` 导出。主机名、协议、端口和浏览器档案都应与保存时一致。

```sh
.venv/bin/python -m http.server 8878 --bind 127.0.0.1 --directory frontend/dist
```

原实验室的 IndexedDB 作答、旧课堂笔记和 SQLite 运行库各有相应备份与恢复入口。[原实验室换地址步骤](../STUDENT_LAB.md#换地址后恢复已有学习)

用项目现有 Python Playwright 环境复跑课程地图和两种宽度的新四阶课堂。

```sh
.venv/bin/python frontend/tests/map_browser.py
.venv/bin/python frontend/tests/map_browser.py http://127.0.0.1:8776/explore/ webkit
.venv/bin/python frontend/tests/continue_browser.py http://127.0.0.1:8776/explore/ webkit
.venv/bin/python frontend/tests/remaining_browser.py http://127.0.0.1:8776/explore/ webkit
.venv/bin/python -m frontend.tests.remaining_parity
.venv/bin/python frontend/tests/auction_browser.py
.venv/bin/python -m frontend.tests.auction_parity
.venv/bin/python frontend/tests/svb_browser.py
.venv/bin/python -m frontend.tests.svb_parity
.venv/bin/python frontend/tests/browser.py
```

## 课程接入接口

| 模块 | 调用方提供 | 模块处理 |
| --- | --- | --- |
| [课程与状态机](src/lesson.ts) | `Lesson` 提供角色信息、决策、状态图例、主指标、单个政策条件和 `run({ seed, choices, policy })` | 逐阶段解锁。播放、暂停、单步前进、回退与重置共用一个位置。重置回放位置时保留已揭示范围。 |
| [微观图与透视卡](src/visuals.tsx) | 当前 `Frame`、稳定个体 ID、被选的宏观指标 | 从实际事件高亮个体，展示状态、约束、局部信号、行动理由和可回查的信号时点。 |
| [宏观联动](src/Studio.tsx)和[曲线](src/MetricChart.tsx) | 当前帧和已揭示的帧序列，首项指标为主指标 | 曲线或表格指向同一帧。暂停标记由课程模型产生。当期净变化和引用上一轮状态的行动采用各自的记录。 |
| [预测与对照](src/Counterfactual.tsx) | 合法政策区间、已选政策、学生预测 | 使用同一种子和同一组入场决策运行政策组。基线冻结，结果保留本轮预测。两列曲线共享纵轴尺度。 |

课程模型输出有序 `Frame[]`。轮次索引从 0 开始且连续，每帧给出可见个体状态、指标、真实计算得到的事件列表和可选暂停标记。每个事件的 `deltas` 记录对该帧指标的贡献。`priorSignal` 指向个体决策实际使用的较早指标值。随机抽样按种子和稳定个体索引分配，避免政策分支改变后续个体的随机输入。旧服务的原始运行 ID、内容版本、哈希及证据指针依旧由原入口解析。

## 双向拍卖

在 [基准课堂](http://127.0.0.1:8776/explore/?lesson=double_auction)填写 B01 的整数限价，再预测能否买到。阶段二按订单事件回放。阶段三价格曲线只标记真正的成交点，每笔成交可回查两张报价。在簿单按规则决定成交价，后续自动报价可回指计算时采用的最近成交价。阶段四先预测每方每件收费 6 代币对期末成交量的影响，再按开盘、四个交易轮末及收盘对齐，导出时保留双侧的原始事件时钟。

[供需无交叠](http://127.0.0.1:8776/explore/?lesson=double_auction&market=no-overlap) 将买方估值下调 65，沿用原案例的边界条件。选 35 可在事件 3 看到最高买价 35 和最低卖价 78。收盘所有有效单撤回，成交量为 0，成交价未定义，效率因可实现剩余上界为零而未定义。该分支可以另做同种子收费对照。

[开局资产](src/data/auction-opening.json)只保存原引擎固定种子 1962 的初始角色、随机下单顺序和报价噪声输入。[浏览器内核](src/auction.ts)实时计算交叉、定价、结算和撤单。双向拍卖运行可导出 JSON，`double-auction/browser-v1` 身份与原课保存的记录分开。实验来源使用原[案例定义](../cases/double_auction/case.json)。

## SVB 案例

课堂复用[原案例定义](../cases/svb_run/case.json)的规则和历史来源。[开局资产](src/data/svb-opening.json)只保存原 Python 教学引擎在种子 20230309 下生成的 60 名合成储户和集中观察网络。`svb_parity` 每次从旧引擎重新生成开局进行核对。[浏览器内核](src/svb.ts)现场计算每轮的申请、支持借款、证券急售、按序结算和轮末账表，保留独立的 `svb/browser-v1` 运行身份。画布每页显示 30 位储户，宏观值汇总全部 60 位。时间轴以教学轮次为单位，每轮内可逐项查阅申请与到账事件。

政策选项将价值 400 的证券在冲击前改持现金，初始资产总额、存款和权益相同。这一改动同时改变即期现金和重估敞口。对照固定种子、观察网络和入场决策，并比较第 20 轮末的待付金额。初始预测、模型规则、算术恒等式和同种子配对差异各有可见标识。课内人数、金额、阶段和政策效果均为模型结果。历史来源可在 Stage 1 查阅。[美联储监管复盘](https://www.federalreserve.gov/publications/2023-April-SVB-Executive-Summary.htm) · [2023 年 3 月 12 日三机构联合声明](https://www.federalreserve.gov/newsevents/pressreleases/monetary20230312b.htm)

金融价格与涨跌幅使用红涨绿跌，并配有数值和符号。首屏展示具体角色与首个决策，宏观曲线按阶段加载。Step 3 将学校匹配接在双向拍卖后，将碳配额市场接在公共品博弈或公地治理后。其余十课的浏览器内核与学科验收见[迁移与验收清单](MIGRATION.md)。

## 学生作品与模型实验

十二门四阶课堂在本浏览器保存阶段、原始决定、已揭示范围和回放位置。首页的「继续上次学习」回到该位置，播放保持暂停。「从头再练」开始一轮新练习。基准拍卖与无交叠实验各自续学。

政策对照完成后，可保存解释或导出两次运行及引用。首页和课堂的「实验笔记」直接打开解释及两侧原事件。原课堂的笔记、运行和复习进度仍可从「原版实验笔记与学习记录」进入。

课程地图的「配置模型 API」打开原学生端的本地表单。基础规则运行、作答和导出在浏览器内完成。需要供应商时，原学生端负责配置、授权和模型实验。

技术参考 [Vite](https://vite.dev/guide/)、[Tailwind CSS Vite 集成](https://tailwindcss.com/docs/installation/using-vite)、[ECharts 按需导入](https://echarts.apache.org/handbook/en/basics/import/)
