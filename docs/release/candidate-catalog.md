# Civitas Economica 候选案例事实库

2026-11-16 按交付包 Part D 第 D2 节与其 `evidence/case_sources.json` 建档。C01–C12 对照仓库的 [12 课发布清单](../../cases/catalog.json)；课程列链接到实际课件。C13–C26 为资料登记，开课和实验运行未实现。事实列写来源可支持的结论，便于核对原文与教学范围。[候选六维评分与重算](../cases/candidate-matrix.md)

十二门正式课的文献页段、资产版本及许可见[来源与数据资产核验](../audit/source-asset-verification.md)。

课程背景的证据类别和教学结果的数据来源分别登记。12 课的初始参数、预计算轨迹和规则运行记录均来自本地教学模型；其中可能含参考史实与制度口径。历史逐笔数据、原始受试者数据和行政微观数据均未随课附带。后续使用原文、图表、底层数据或第三方复用材料前，应逐项核对相应权利声明。本库只发放引用链接与概述。读取网页、摘要或存档 PDF 不构成课程授予文件再分发权。

| ID | 候选与证据类别 | 可核查事实及其范围 | 课件 | 证据 |
| --- | --- | --- | --- | --- |
| C01 | 硅谷银行挤兑（2023）· 历史事件 | 美联储复盘记录，银行在 3 月 9 日遇到逾 400 亿美元提款流出，次日被关闭。复盘讨论未保险存款集中及管理弱点。Diamond–Dybvig 提供多均衡机制参考；模拟中的网络及火售价格为教学设定。 | [svb_run](../../cases/svb_run/case.json) | [S01 美联储复盘](https://www.federalreserve.gov/publications/2023-April-SVB-Executive-Summary.htm) · [S29 论文档案](https://knowledge.uchicago.edu/records/3sa4m-hvw53) |
| C02 | Smith 双向拍卖（1962）· 实验研究 | Smith 在实验室人为分配买家价值和卖家成本，允许提交买价及卖价，比较成交价和竞争均衡。课堂订单与均衡由独立模型生成。 | [double_auction](../../cases/double_auction/case.json) | [S02 原文存档](https://lorko.sk/wp-content/uploads/2023/08/Smith1962.pdf) |
| C03 | Schelling 隔离（1971）· 理论模型 | 原文展示局部邻居构成偏好如何在搬迁模型中产生更明显的空间分隔。课堂阈值和布局为参数；研究对象是机制而非真实地区居民动机。 | [schelling_segregation](../../cases/schelling_segregation/case.json) | [S04 原文，UC Berkeley 讲义存档](https://www.stat.berkeley.edu/~aldous/157/Papers/Schelling_Seg_Models.pdf) |
| C04 | 公共物品与成本性惩罚（2000）· 实验研究 | Fehr 与 Gächter 比较有、无惩罚机会的公共物品实验。实验中参与者会付代价惩罚较低贡献者；课堂扣罚与净收益必须由各运行核对。 | [public_goods](../../cases/public_goods/case.json) | [S05 AEA 期刊摘要](https://www.aeaweb.org/articles?id=10.1257/aer.90.4.980) |
| C05 | Ostrom 公共资源治理 · 田野研究／制度研究 | Ostrom 以案例与制度研究论述共有资源可由多种制度组合治理，并讨论多中心安排。课堂水域、存量动态和监测成本为教学设定。 | [commons_governance](../../cases/commons_governance/case.json) | [S06 AEA 期刊摘要](https://www.aeaweb.org/articles?id=10.1257/aer.100.3.641) |
| C06 | 信息级联（1997）· 实验研究 | Anderson 与 Holt 用私人抽样、公开推断的顺序实验观察信息级联。课堂抽样和消息可见性由模型生成。 | [information_cascade](../../cases/information_cascade/case.json) | [S07 原文，UCSD 存档](https://econweb.ucsd.edu/~jandreoni/Econ264/papers/Holt%20Anderson%20AER%201997.pdf) |
| C07 | Akerlof 柠檬市场（1970）· 理论模型 | Akerlof 以二手车阐释质量信息不对称怎样削弱市场并使优质卖方退出。课堂退出数量及认证反事实来自参数化演示。 | [lemons_market](../../cases/lemons_market/case.json) | [S08 正式论文 DOI](https://doi.org/10.2307/1879431) · [原文，PIMS 存档](https://pims.math.ca/files/Akerlof1970.pdf) |
| C08 | Boston 学校匹配改革（2005）· 真实制度／实证研究 | 研究者用 Boston 数据分析原学额分配机制中的策略填报。Boston 于 2005 年选择基于延迟接受的机制。教学比较使用自建小规模偏好和优先级。 | [school_matching](../../cases/school_matching/case.json) | [S09 作者存档全文](https://web.stanford.edu/~alroth/papers/bostonMay182006.pdf) |
| C09 | 美国闪电崩盘（2010）· 历史事件 | SEC 与 CFTC 联合报告记录 2010 年 5 月 6 日期货与股票市场价格及流动性变化，讨论卖单、市场深度和跨市场联动。课堂订单流为简化模拟。 | [flash_crash](../../cases/flash_crash/case.json) | [S10 SEC／CFTC 联合报告](https://www.sec.gov/news/report/2010/marketevents-report.pdf) |
| C10 | GameStop（2021）· 历史事件 | SEC 工作人员报告记录价格、成交、空头活动及市场结构。报告指出回补需求曾推高价格，但在更长时期维持升幅的还有其他买入动力。课堂注意力和保证金规则只用于比较假定机制。 | [gamestop](../../cases/gamestop/case.json) | [S11 SEC 工作人员报告](https://www.sec.gov/files/staff-report-equity-options-market-struction-conditions-early-2021.pdf) |
| C11 | Beer Game 与牛鞭效应（1989）· 实验研究 | Sterman 用生产分销互动实验研究库存管理中的反馈误判；游戏分角色处理订货与延迟到货。课堂各环节订单与库存由模拟生成。 | [beer_game](../../cases/beer_game/case.json) | [S12 INFORMS 期刊摘要](https://pubsonline.informs.org/doi/10.1287/mnsc.35.3.321) · [S13 Sterman 的 MIT 游戏介绍](https://web.mit.edu/jsterman/www/SDG/beergame.html) |
| C12 | EU ETS（2005 年启动）· 真实制度 | 欧盟委员会说明制度以总量上限及配额交易为基础，配额逐期收紧。课堂价格、排放与减排成本来自合成企业，税收是教学对照。 | [carbon_market](../../cases/carbon_market/case.json) | [S14 欧盟委员会 EU ETS 说明](https://climate.ec.europa.eu/areas-action/carbon-markets/about-eu-ets_en) |
| C13 | 全球金融危机（2008）· 历史事件 | 美国金融危机调查委员会的多数报告认为危机本可避免，涉及监管、治理和风险管理。委员会存档同时保留异议；源材料聚焦美国，不足以量化其他国家损失。 | 资料登记 | [S15 GovInfo 书目](https://www.govinfo.gov/app/details/GPO-FCIC/summary) · [委员会网站的联储存档](https://fraser.stlouisfed.org/files/docs/historical/fct/fcic/fcic_agenda7a_20110124.pdf) · [委员发布日陈述](https://corpgov.law.harvard.edu/2011/01/27/the-financial-crisis-inquiry-commission-report/) |
| C14 | A 股熔断启停（2016）· 历史事件／规则 | 上交所 2016 年 1 月 7 日公告规定，自 1 月 8 日起暂停实施指数熔断机制。公告支持规则变更及生效日期；“磁吸效应”仍需独立证据。 | 资料登记 | [S16 上交所公告](https://www.sse.com.cn/aboutus/mediacenter/hotandd/c/c_20160107_4033450.shtml) |
| C15 | 重复囚徒困境与合作演化 · 理论／计算实验 | Axelrod 与 Hamilton 分析在重复互动中以对方先前行动为条件的互惠策略；持续合作取决于互动延续等条件。论文论述包括生物演化背景。 | 资料登记 | [S17 原文，UMD 存档](https://science.umd.edu/faculty/wilkinson/BIOL608W/Axelrod%26Hamilton81.pdf) |
| C16 | 肾脏配对交换 · 真实制度／机制研究 | Roth、Sönmez、Ünver 的原文用患者和活体供体兼容关系研究配对交换与分配机制。来源支持机制；当前不存在医院或病患数据接入。 | 资料登记 | [S18 作者存档全文](https://web.stanford.edu/~alroth/papers/kidney.qje.pdf) |
| C17 | 伦敦拥堵收费（2003 年启动）· 真实制度／政策评估 | TfL 第六次年度报告记录项目的实施和监测，包含交通与拥堵趋势。报告中的同期变化可能还受道路容量、施工等条件影响。 | 资料登记 | [S19 TfL 第六次年度报告](https://content.tfl.gov.uk/central-london-congestion-charging-impacts-monitoring-sixth-annual-report.pdf) |
| C18 | 美国 2001 年退税消费反应 · 政策事件／实证研究 | Johnson、Parker、Souleles 利用发放时序差异估计家庭支出响应；来源支持该次政策样本的消费估计，教学设想中的更广义收入循环需另行估计。 | 资料登记 | [S20 AEA 期刊摘要](https://www.aeaweb.org/articles?id=10.1257/aer.96.5.1589) |
| C19 | 货币政策传导 · 真实制度／官方机制 | ECB 说明政策利率通过市场及银行传至储蓄、消费和投资，传导时滞长短及强度不确定。官方说明不含单一固定时滞参数。 | 资料登记 | [S21 ECB 传导机制说明](https://www.ecb.europa.eu/mopo/intro/transmission/html/index.en.html) |
| C20 | COVID-19 全球供应链研究（2020）· 真实事件／计算研究 | 原作者建模评估疫情控制如何引起跨国供应链影响，输出为模型估计。尚未引入企业级实际供应链账目。 | 资料登记 | [S22 UCL 作者接受稿档案](https://discovery.ucl.ac.uk/id/eprint/10099676/) |
| C21 | MusicLab 人工文化市场（2006）· 在线实验 | Salganik、Dodds、Watts 在人工音乐市场操纵他人下载信息的可见性；在该实验中，较强社会影响增加流行度的不均等和结果不可预测性。 | 资料登记 | [S23 原文及补充材料，作者存档](https://www.princeton.edu/~mjs3/salganik_dodds_watts06_full.pdf) |
| C22 | 共同价值拍卖赢家诅咒（1986）· 实验研究 | Kagel 与 Levin 比较共同价值拍卖中的竞标人数量和公共信息条件。公共信息效果依竞标行为而异；来源未导入课堂估值。 | 资料登记 | [S24 AER 原文存档](https://kylewoodward.com/blog-data/pdfs/references/kagel%2Blevin-the-american-economic-review-1986A.pdf) |
| C23 | 信任与互惠（1995）· 实验研究 | Berg、Dickhaut、McCabe 的投资实验把发送的资金乘以 3 交给匿名对方，由对方决定返还多少。动作共同反映对另一人的预期及行为动机；纯信任、风险态度等需要额外识别。 | 资料登记 | [S25 Ohio State 存档，原文扫描件](https://bpb-us-w2.wpmucdn.com/u.osu.edu/dist/8/36875/files/2023/08/Berg-Dickhaut-McCabe.pdf) |
| C24 | 最后通牒议价（1982）· 实验研究 | Güth、Schmittberger、Schwarze 的早期实验比较分配者报价与接受者拒绝。作者后续回顾记载，行为系统性偏离只最大化金钱收益的预测；原实验分组和效应数值待复核原文。 | 资料登记 | [S26 RePEc 原论文书目](https://ideas.repec.org/a/eee/jeborg/v3y1982i4p367-388.html) · [原作者事后回顾，LMU 存档](https://epub.ub.uni-muenchen.de/18176/1/Kocher_18176.pdf) |
| C25 | 中国全国碳市场首周期（2021）· 真实制度 | 生态环境部记录全国碳市场 2021 年 7 月 16 日上线启动交易，首周期履约覆盖发电行业。该行独立于 C12 中的欧盟制度和授课配置。 | 资料登记 | [S27 生态环境部首周期通报](https://www.mee.gov.cn/ywgz/ydqhbh/wsqtkz/202112/t20211231_965906.shtml) |
| C26 | FCC 频谱拍卖（1994）· 真实制度 | FCC 第 1 号拍卖针对十张全国窄带个人通信服务牌照，委员会文件记录申请条件、申请表解释与豁免。教学设计中的互补性和效率需使用具体规则另测。 | 资料登记 | [S28 同场拍卖的 FCC 命令 DA 94-768](https://docs.fcc.gov/public/attachments/DA-94-768A1.pdf) |

## 原入口访问差异

以下为本轮检索工具的观测。替代入口指向上表，不据此判断原站点对其他访问者的状态。

| 来源 | 原入口或原文件 | 本轮观测与证据保留 |
| --- | --- | --- |
| S02、S03 | [芝加哥大学出版社 PDF](https://www.journals.uchicago.edu/doi/pdf/10.1086/258609) · [Nobel 自述](https://www.nobelprize.org/prizes/economic-sciences/2002/smith/biographical/) | 直接打开均 403；核对 Smith 原论文镜像。 |
| S04 | [期刊 DOI](https://doi.org/10.1080/0022250X.1971.9989794) | 直接打开 403；核对 UC Berkeley 存档全文。 |
| S06 | [Nobel 演讲稿](https://www.nobelprize.org/uploads/2018/06/ostrom_lecture.pdf) | 直接打开 403；核对作者同题演讲的 AEA 发表摘要。 |
| S08 | [期刊 DOI](https://doi.org/10.2307/1879431) | 期刊跳转 500；论文书目经期刊索引确认，核对 PIMS 存档原文第 II 节。存档保留 JSTOR 及出版社的复用限制声明。 |
| S09 | [NBER 页面](https://www.nber.org/papers/w11965) | 页面及其直链全文均 403；搜索索引可定位书目，核对作者在 Stanford 的存档全文。 |
| S15 | [GovInfo 页面](https://www.govinfo.gov/app/details/GPO-FCIC/summary) · [报告 PDF](https://www.govinfo.gov/content/pkg/GPO-FCIC/pdf/GPO-FCIC.pdf) | 原页未抽取正文，原 PDF 超时；核对联储档案中的委员会网站和报告发布当天一名委员的陈述。 |
| S17 | [PubMed 页面](https://pubmed.ncbi.nlm.nih.gov/7466396/) | 原页仅提取一行；核对 UMD 存档原文。 |
| S18 | [Oxford 期刊原入口](https://academic.oup.com/qje/article-abstract/119/2/457/1894508) | 出版商跳转 500，Harvard 存档一度 429；核对作者 Stanford 全文。 |
| S22 | [Nature 原入口](https://www.nature.com/articles/s41562-020-0896-8) | 身份验证跳转 500；核对 UCL 原稿档案及同一 DOI。档案明确要求查阅出版商的复用条款。 |
| S23 | [Wharton 原入口](https://marketing.wharton.upenn.edu/wp-content/uploads/2018/09/09.18.2018-Watts-Duncan-PAPER-1-s_d_w_Science.pdf) | 原入口未取回文本；核对 Princeton 作者存档原文。 |
| S25 | [ScienceDirect 原入口](https://www.sciencedirect.com/science/article/pii/S0899825685710275) | 直接打开 403；原文扫描档直开未提取文本，经公开搜索索引打开同一存档后核对原文实验流程。 |
| S26 | [ScienceDirect 原入口](https://www.sciencedirect.com/science/article/pii/0167268182900117) | 直接打开 403；原文的 [Levine 存档](https://www.dklevine.com/archive/refs4291.pdf) 超时；书目和作者回顾可核对，原实验全文未复核。 |
| S28 | [FCC-94-219 原入口](https://docs.fcc.gov/public/attachments/FCC-94-219A1.pdf) | 直接打开 403；核对同一拍卖案的官方命令 DA 94-768。 |

已登记 26 条，映射到 12 个已发布课程，其余 14 条资料登记无启动入口。课程机制的离线运行证据见 [反馈链核验](feedback-audit.md)。
