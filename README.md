# EcoSimEdu

EcoSimEdu V2 是面向经济学入门学生的本地互动教学平台。十二门四阶课堂覆盖个体决策、群体观察、反事实和证据解释。完成解释后，可做独立应用、迁移和次日复习。双向拍卖、硅谷银行挤兑和居住隔离提供逐事件的微观与宏观追踪。

公共品、公地治理、碳配额、啤酒游戏、GameStop 和闪电崩盘可在四阶课堂查看各自的账本或市场面板，从领域证据回查原事件，并在政策实验中读取两组运行的收尾账目。

浏览器规则课堂只依赖本地文件与 HTTP 服务。原实验室仍提供十二课的七阶入口、边界实验、原运行回放和 JSON 导出。四门原实验室课程可选择模型实验，支持同条件规则对照。高级模型由本机服务管理凭证、可用性和预算，基础课程可独立运行。

教师从「教师工作台」选择案例和演示时长，导出预设，在隔离课堂控制播放，按需揭示示范解。学生解释作品可按文件核对两条来源。SVB 与闪电崩盘的双来源迁移和教师复核支持专用 JSON 往返。

[V2 发布说明](docs/v2/release/README.md) · [十二课验收](docs/v2/release/courses.md) · [备份与迁移](docs/v2/release/migration.md) · [性能与无障碍](docs/v2/release/quality.md)

## 本机启动

需要 Python 3.12、uv 和 Node.js 22.18 或更高版本。

```sh
uv venv --python 3.12 .venv
uv pip sync --python .venv/bin/python requirements-edu.lock
npm --prefix student-web ci
npm --prefix student-web run build
npm --prefix frontend ci
npm --prefix frontend run build
.venv/bin/python -m uvicorn services.simulation.api:app --host 127.0.0.1 --port 8776
```

打开 [渐进课堂](http://127.0.0.1:8776/explore/) 或同一地址下的 [学生实验室](http://127.0.0.1:8776/)。也可打开[教师工作台](http://127.0.0.1:8776/teach)。详细操作、API 配置和验收见 [学生实验室指南](STUDENT_LAB.md)、[开发指南](docs/developer-guide.md)和 [实施状态](docs/progress.md)。[模型实调记录](docs/release/rc10-live-three-courses.md)列出逐课用量与结果。

本仓库包含教学源代码、课程配置、合成样本和经过公开发布处理的验证回执。课堂运行由新安装的本地实例生成，历史数据库和旧事件缓存随各自的本机环境保留。公开回执保留指标、用量和哈希，供应商请求及响应标识已清除。旧 RC9 与 RC10 归档回执仍对应各自的原始本地归档。

## 原金融市场仿真平台

以下为原 Streamlit 研究应用的运行说明。研究应用使用独立的依赖和启动入口。

数治观澜是一个面向金融政策预评估与市场演化分析的多智能体仿真平台。项目将自然语言政策、新闻事件、历史行情、异质投资者行为、A 股交易规则和监管动作组织到同一条可复现链路中，用于观察政策冲击如何通过预期、情绪、流动性和订单流传导到市场结果。

项目遵循“LLM 负责解释与结构化，仿真系统负责市场事实”的设计原则。大模型参与政策解析、智能体认知、证据解释和报告摘要；价格路径、成交量、K 线和风险指标由智能体订单、撮合内核、trade tape 与指标计算模块生成。

## 核心能力

- 政策文本结构化：将自然语言政策解析为政策类型、作用对象、强度、时滞、衰减曲线、传导渠道和置信度等可执行字段。
- 多智能体市场推演：构建风险偏好、资金规模、羊群倾向、基准压力和信息处理能力不同的市场主体，并将主体分歧映射为订单意图。
- A 股市场微结构：支持交易时段、开盘集合竞价、连续竞价、涨跌停、最小价格变动、委托延迟、撤单和 K 线聚合等规则。
- 历史验证与事件回放：以上证指数等市场基准为参照，结合历史新闻和事件窗口，评估仿真路径、风险响应和方向一致性。
- 行为金融诊断：输出 CSAD、恐慌度、羊群强度、波动聚集、回撤、微观结构和流动性指标，解释市场变化背后的行为机制。
- 监管反事实分析：对不同干预时机和强度构造对照世界，比较风险、成本、流动性副作用和稳定效果。
- 数据飞轮与事件图谱：支持新闻源、事件存储、GraphML 图结构和种子事件数据，为回放、分析和扩展提供数据底座。
- 结果归档：生成实验摘要、分析报告、图表索引、证据链和可复现元数据，便于后续复盘与研究沉淀。

## 系统架构

| 路径 | 说明 |
| --- | --- |
| `app.py` | Streamlit 前端入口，组织系统总览、政策实验、历史验证和研判分析。 |
| `agents/` | 交易智能体、快慢智能体内核、角色化分析师、认知记忆、群体画像和报告智能体。 |
| `core/` | 市场引擎、撮合内核、历史新闻服务、回测、行为金融、监管沙箱、复现登记、事件存储和模型路由。 |
| `core/exchange/` | A 股交易会话、订单簿、trade tape、K 线聚合以及可选 C++ 撮合扩展。 |
| `engine/` | 仿真循环、智能体调度和市场撮合流程。 |
| `policy/` | 政策结构化解析、事件编译、传导模型和政策引擎。 |
| `ui/` | 政策实验、历史回放、行为诊断、监管优化、报告导出和可视化组件。 |
| `data_flywheel/` | 新闻源接入、文本因子抽取、事件图谱、种子事件存储和数据管线。 |
| `data/` | 政策模板、市场组成、历史新闻缓存、事件图和轻量事件存储。 |
| `demo_scenarios/` | 内置分析场景与历史案例，用于无外部依赖的快速运行。 |
| `theme/`、`static/` | 前端主题、界面配置和静态资源。 |

## 工作流

1. 输入政策文本、选择政策模板或加载内置场景。
2. 政策解析模块生成结构化政策包和传导链。
3. 多智能体系统根据画像、风险偏好、市场状态和政策冲击形成交易意图。
4. 市场内核执行撮合并生成成交记录、价格路径、成交量和 K 线。
5. 评估模块计算路径拟合、事件响应、风险、微观结构和行为金融指标。
6. 监管优化模块运行反事实对照，输出候选干预方案和权衡结果。
7. 归档模块沉淀报告、图表、证据链和复现元数据。

## 默认成果展示

应用启动后默认进入“成果展示”窗口。该窗口按“政策输入—会话推演—机制解释—反事实评估—历史验证—结果归档”的逻辑，编排项目真实运行界面；点击图片可查看原始尺寸。页面中的默认实验仍可通过内部政策编译、市场推演和因子回测 API 独立复现。

也可以不启动前端，直接运行同一条内部链路并导出 JSON 结果：

```bash
python scripts/run_default_showcase.py
```

默认产物写入 `outputs/default_showcase/default_showcase_run.json`。

## 运行环境

- Python 3.11 及以上版本。
- Windows、macOS 和 Linux 均可运行，建议使用独立虚拟环境。
- 在线模型 API Key 为可选配置；未配置时系统会进入离线确定性回退链路，核心界面、内置场景和基础分析仍可运行。

## 安装

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Windows PowerShell：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

如果需要使用锁定依赖环境，可改用：

```bash
pip install -r requirements-lock.txt
```

## 启动

```bash
python -m streamlit run app.py --server.port 8501
```

启动后访问：

```text
http://127.0.0.1:8501
```

也可以通过 `main.py` 进行环境检查后启动界面：

```bash
python main.py
```

## 可选配置

项目会读取本地 `.env` 或 shell 环境变量。`.env` 不应提交到版本库，可参考 `.env.example`：

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
ZHIPUAI_API_KEY=your_zhipu_api_key
LLM_DEFAULT_PROVIDER=auto
LLM_TIMEOUT_SECONDS=20
LLM_MAX_RETRIES=2
CIVITAS_RANDOM_SEED=42
CIVITAS_INFERENCE_MODE=lite
```

常用配置项：

- `DEEPSEEK_API_KEY`：DeepSeek 在线模型密钥。
- `ZHIPUAI_API_KEY` / `ZHIPU_API_KEY`：智谱在线模型密钥。
- `LLM_DEFAULT_PROVIDER`：模型路由策略，默认 `auto`。
- `CIVITAS_INFERENCE_MODE`：推理档位，可选 `lite`、`standard`、`enterprise`。
- `CIVITAS_DISABLE_SYNTHETIC_MARKET_FALLBACK`：设为 `true` 时，外部行情源失败会直接报错；默认使用合成行情兜底。
- `CIVITAS_LOCAL_MODEL_PATH`：本地推理模型路径。
- `CIVITAS_VLLM_MODEL`：企业档位下的 vLLM 模型名称。

## 可选 C++ 撮合扩展

项目默认可以使用 Python 订单簿回退实现。若需要启用 C++ 限价订单簿扩展，可在安装依赖后执行：

```bash
python setup.py build_ext --inplace
```

扩展不可用时，系统会继续使用 Python 撮合路径或给出明确错误信息，不影响主要功能的使用。

## 数据与产物

- `data/policy_templates.json` 提供政策模板。
- `data/seed_events.jsonl` 和 `data/event_graph.graphml` 提供种子事件和事件图谱。历史新闻缓存 `data/history_news_cache.jsonl` 由研究应用生成，随对应本地环境保存。
- `demo_scenarios/` 提供税费调整、谣言冲击、监管稳定干预和历史案例等内置场景。
- 运行过程中生成的报告、图表和缓存通常写入 `outputs/`、`tmp/`、`artifacts/` 或运行时配置指定目录，这些内容不作为源码提交。

## 快速校验

```bash
python -m compileall -q .
python -c "import app; assert hasattr(app, 'main')"
```

前端校验：

```bash
python -m streamlit run app.py --server.port 8501
```

## 应用边界

本项目适用于金融科技教学、政策冲击研究、复杂系统仿真、行为金融实验和监管方案预评估等场景。系统输出用于分析和研究，不构成投资建议，也不承诺对未来市场价格进行精确预测。

## 学生实验室

十二门四阶课堂、续学和原事件回查见[渐进课堂](frontend/README.md)。原学生实验室的安装、启动和验证见[学生实验室](STUDENT_LAB.md)。
