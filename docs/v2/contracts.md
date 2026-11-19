# V2 课程、运行、事件与证据契约

V2-02 在原发布契约上增加 CasePackage、RunEnvelope 与 Evidence。现有案例、教学活动、运行和 Trace 接口继续读原格式。新增结构供渐进课堂、备份作品及本机观察者使用，未修改撮合、结算或课程规则。[V2-00 ADR](architecture-adr.md) · [本轮执行记录](executions/V2-02.md)

## CasePackage

浏览器与 FastAPI 读取同一份 [CasePackage 索引](../../cases/case-packages-v1.json)。生成器从课程目录、各课 `case.json`、来源登记、v3 学习包及显式模型和指标声明构建索引。FastAPI 用 `GET /api/cases/{case_id}/package` 提供同一结构。原 `/api/cases/{case_id}/lesson` 的 v2 和 v3 响应保持原义。课程描述变更时通过生成器更新索引、Schema 和数据资产摘要。[生成器](../../scripts/generate_case_packages.py) · [CasePackage Schema](../../schemas/case-package.schema.json)

| 段落 | 字段与含义 |
| --- | --- |
| 课程身份 | `caseId`、`identity` 与 `identityLabel` 沿用原定义。支持历史事件、制度案例、理论模型、学术实验与实验研究。 |
| 资料 | `historicalFacts` 的每条事实关联来源 ID。`sourceReferences` 给出原课程链接、原文定位及支持范围。理论或实验案例可通过学术参考介绍机制，历史事实可以为空。 |
| 教学设定 | `modelAssumptions` 描述模型规则，`syntheticPopulation` 描述合成主体和已知数量。`dataProvenance` 保留来源数据是否取得、分发范围和许可证状态。 |
| 权利与目标 | `rights` 按原来源登记记录权利和分发依据；`learningOutcomes` 沿用发布 v3 学习目标。 |
| 版本 | `caseVersion`、`browserContentVersion` 与 `learningContentVersion` 分开。`browserContentVersion` 是四阶适配内容版本，v3 保留自身版本。 |
| 指标与时钟 | 每项指标有 ID、单位、定义和未定义原因。`browserMetricRoles` 与 `archivedMetricRoles` 各指定观察指标、比较指标与比较统计量。经济时钟有稳定 ID 和显示名。 |

| 旗舰 | 身份 | 主观察 | 期末比较 |
| --- | --- | --- | --- |
| 双向拍卖 | 学术实验 | 浏览器使用本笔实际成交价 `price`；原服务档案使用最近成交价 `last_price`。语义和缺值位置有差别。 | 累计成交件数 `volume` |
| SVB | 历史事件与合成储户模型 | 待付 `queued`，单位为模拟资金单位 | 最后清结算轮次待付 `queued` |
| Schelling | 理论模型与合成社区 | 同组占用邻接比例 `similarity`，单位为百分比 | 终止时同组占用邻接比例 `similarity` |

其余九课的兼容适配器读相同索引。它们继续使用各自模型的原参数和时间粒度。观察和比较指标各自通过 ID 定位，已定义数值中的零保持为零。记录中的 `null` 表示该观察值未定义，缺少指标键或缺少经济时点显示缺少记录。最终比较在任一侧缺少可比较值时不计算方向。

## RunEnvelope 与 EventEnvelope

浏览器在导出作品时添加 `runEnvelopes` 与 `eventEnvelopes`。已有 `observations` 和 v1 JSON 链接继续兼容。使用 `GET /api/runs/{key}/envelope` 获取服务器记录的标准表示。不希望读取其他版本的调用方可传 `case_version` 或 `engine_version`，不匹配时返回 409。原 `GET /api/runs/{key}`、事件读接口与导出沿用现有返回值。[浏览器适配器](../../frontend/src/run-evidence.ts) · [服务端适配器](../../services/simulation/domain.py) · [Run Schema](../../schemas/run-envelope.schema.json)

- **运行。** 保存原 `runId`、案例／引擎／课件版本、种子、原输入、来源、执行状态、结果摘要、指标角色和时钟。历史库未记录课件版本时保留 `null`。已登记案例的历史运行如果使用旧案例版本或未知引擎版本，读出时保留原 ID、结果摘要和指标元数据的缺失状态。
- **事件。** `eventId`、`runId`、原序号、帧游标、经济时点、主体 ID、事件类型及原始记录各自存放，显示文字另作摘要。拍卖成交引用两侧真实在簿订单提交事件。SVB 申请与实付沿用本就存在的轮内标识，如 `1/2`。这种事件没有独立全局序号，`sequence` 为 `null`。Schelling 保留真实搬迁记录、原位置以及变动邻居数据。
- **缺失关系。** 引用来自当前运行已有的源事件或订单 ID，两端都要在同一有效帧前缀内。缺少明确源事件时保留缺失状态。SVB 的轮末账表展示轮首与轮末数值。单笔付款用该付款事件的原始金额和增量表达，未给它生成单笔前后余额。

## Evidence 与历史兼容

`GET /api/runs/{key}/archive/evidence/{seq}?scope=archive` 是与原完整复盘入口等价的显式档案读取。它返回真实事件、原结果摘要和能核对的源事件指针。历史 SQLite 仍先走现有完整性检查，适配器只读取。引导式读取继续使用原课堂投影和 `as_of_seq` 约束。浏览器前缀证据记录 `asOf`，越界或不同运行的事件无法进入同一份 Evidence。[Evidence Schema](../../schemas/evidence.schema.json)

结果摘要有两种受版号约束的范围。服务端 `stored-result/v1` 使用原规范化完整结果的 SHA-256。浏览器 `browser-evidence/v1` 使用稳定键序，对运行 ID、种子、原帧指标、有关主体 ID、原事件日志、恒等式和拍卖原订单计算 SHA-256。两种摘要各自核对来源。配对结果继续保有两套 ID 与摘要，含相同种子也不交换证据。

新笔记保存两侧版本、运行摘要、事件 ID 和帧位置。重开时重新核对这些字段才展示原事件。旧笔记不带摘要，原值继续读取，来源需与 `8fc8971` 固定输入计算得到的已登记摘要匹配。目录覆盖当时 12 门课所支持的 **358 条运行**。旧 SVB 笔记只有轮次时展示真实轮次并保留轮内引用缺失。未登记或不匹配的运行显示「原证据不可验证」，可返回已保存的文字。[旧指纹生成器](../../frontend/tests/generate_legacy_fingerprints.mjs) · [来源核验](../../frontend/src/learning-store.ts)

## 复跑

```sh
python -m scripts.generate_case_packages --check
python -m scripts.check_course_provenance
npm --prefix frontend test
python -m pytest -q tests/contracts/test_domain_contracts.py tests/e2e/test_domain_notes.py
```

旧笔记测试使用在指定提交的浏览器页面实际保存的工程夹具。里面引用真实固定种子模型事件，作答文字用于验收。对照测试单独修改同 ID 重算的数值或主体以检查拒绝逻辑。[旧笔记夹具](../../tests/fixtures/progressive-note-8fc8971.json) · [浏览器回归](../../tests/e2e/test_domain_notes.py)
