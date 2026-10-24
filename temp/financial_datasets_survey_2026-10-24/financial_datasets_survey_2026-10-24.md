# 金融数据集综述：面向人工智能与机器学习的金融数据地图

**发布时间：2026 年 10 月 24 日**  
**研究基准日：2026 年 10 月 24 日**  
**适用对象：** 金融领域的 AI/ML 研究者、量化团队、数据平台工程师、Solution Architect、风险与合规团队。

## 摘要

金融 AI 的主要瓶颈经常不是模型，而是能否取得足够长、时间口径正确、覆盖退市与历史修订、标签可信且许可允许使用的数据。日频 OHLCV 足以验证部分量化研究流程，却不能替代逐笔成交、完整订单簿、历史证券主数据、基金账簿、真实支付授权事件或经过调查确认的欺诈标签。将“能下载 CSV”视为“可用于生产建模”，是金融数据工程中最常见的误区之一。

本文按金融业务域梳理可用于 AI/ML 的开放数据、免费但有限制的数据、商业数据、机构订阅和通常无法公开取得的数据；归纳代表性论文与开源项目依赖的数据集；比较价格信息的公开程度；并给出数据采集、清洗、标准化、点时回放、回测、防泄漏、质量控制与生产运营的实施方法。文中的价格状态按研究基准日整理；商业授权和服务套餐可能随时间、用户数、地区、用途和分发范围变化，签约前须向供应方复核。

一个需要特别注意的许可例子是 FRED：其服务条款允许许多个人、教育和非商业用途，但目前公开条款对使用 FRED 服务或内容训练 AI/机器学习系统作出限制。因此，“免费宏观数据”并不等于“可直接拿来训练模型”；必须逐项核对底层数据来源、版权标识和具体许可，必要时取得书面授权。[FRED 服务条款](https://fred.stlouisfed.org/legal/)

## 1. 先统一分类：免费、开放和可商用不是同义词

推荐在数据目录中分开记录三个维度，而不是只设一个 free/paid 字段。

| 维度 | 应记录的值 | 为什么重要 |
|---|---|---|
| 访问成本 | 免费、免费额度、按量付费、固定订阅、机构订阅、询价、内部数据 | 决定预算与采集架构 |
| 使用许可 | 开放许可、研究用途、个人用途、商业用途需许可、禁止再分发、条款不明 | 决定训练、部署、展示、缓存、对外提供结果是否被允许 |
| 数据能力 | 实时/延迟/日终、历史深度、频率、市场覆盖、历史版本、修订记录、标签质量 | 决定数据是否满足真实任务 |

本文采用以下标记：**开放/公开**指可以从官方渠道访问，但仍需遵守该来源许可；**免费但受限**指有免费访问但有速率、用途或再分发限制；**商业/机构订阅**指需要购买或获得机构授权；**公开价格**指供应商有价目表；**询价/价格未公开**指未能从官方公开渠道确认可直接采用的价格；**内部/受限**指真实数据通常掌握在银行、基金、经纪商、支付机构或监管机构内部。即使研究论文附带下载链接，也不能据此推断原始内容拥有开放商用许可。

## 2. 金融数据全景：按业务域选择数据

| 金融领域 | 常见 ML 任务 | 优先考察的数据集/来源 | 访问及价格概况 | 主要缺口或风险 |
|---|---|---|---|---|
| 股票、ETF、指数 | 收益/波动预测、因子研究、组合构建 | SEC、交易所数据、Nasdaq Data Link、Alpha Vantage、Tiingo、Massive、QuantConnect、Yahoo Finance/yfinance | 从免费、免费额度到按月/按量付费；高级历史与实时数据多需付费 | 公司行动、退市股票、历史成分、延迟与许可差异 |
| 中国 A 股、港股及跨市场 | 价格预测、因子、交易策略 | AkShare、Baostock、Tushare、JoinQuant、RiceQuant、交易所及商业终端 | 部分接口可免费试用，额度/积分/套餐因供应方变化；商业数据通常需授权 | 第三方封装不等于底层数据开放许可；停牌、复权和历史成分口径 |
| 逐笔成交、盘口与订单簿 | 成交方向、盘口预测、市场冲击、执行策略 | FI-2010、LOBSTER、Nasdaq TotalView-ITCH、NYSE TAQ、Cboe DataShop、CME DataMine | FI-2010 可公开获取；LOBSTER 有正式访问与价格规则；交易所历史数据常收费/询价 | 订单簿重建、纳秒时间戳、队列位置和订单事件完整性 |
| 期权、期货、利率衍生品 | 波动率曲面、Greeks、定价、对冲 | OptionMetrics IvyDB、Cboe、OPRA、CME DataMine、ORATS、交易所期权链 | 多为商业授权或机构订阅；具体价格常按市场、历史深度和再分发范围询价 | 合约生命周期、陈旧报价、行权价单位、公司行动调整 |
| 公司债、国债、信用利差 | 债券估值、收益率预测、信用迁移 | FINRA TRACE、WRDS TRACE、Mergent FISD、Treasury.gov、BIS、ECB、央行数据 | 官方宏观/国债统计常免费；交易级债券数据的完整历史及研究许可可能收费 | 净价/全价、应计利息、交易量、评级历史和流动性偏差 |
| 财务报表与基本面 | 违约风险、价值因子、财报问答、文本抽取 | SEC EDGAR/XBRL、FinTabNet、FinQA、Compustat、Capital IQ、Worldscope | SEC 公共资料免费；Compustat 等商业数据库通常机构订阅/询价 | 财年日期不等于发布时间；重述、标签与历史版本可能泄漏未来信息 |
| 基金持仓、所有权与资金流 | 持仓变化、风格漂移、申赎流量、机构持仓研究 | SEC Form 13F、Form N-PORT、Registered Fund Statistics、CRSP Mutual Fund、Morningstar、LSEG、FactSet | 部分申报公开；基金数据库多需机构订阅或询价 | 披露滞后，13F 不代表完整仓位，也不能还原真实逐笔交易 |
| 基金会计、NAV 与估值对账 | NAV break 分类、应计异常、现金/费用差异、对账工单优先级 | 内部基金会计账簿、管理人/托管人文件；公开 N-PORT/NAV 仅可作为有限代理 | 真实总账、分录和根因标签通常属于内部或受合同限制的数据 | 开放数据几乎不能替代完整账簿、处理轨迹和已确认 break 根因 |
| 信用、贷款、抵押贷款 | 违约概率、损失率、额度、早偿/拖欠 | UCI German Credit、Taiwan Credit Card Default、Taiwanese Bankruptcy、LendingClub 历史数据、Home Credit、HMDA、Fannie Mae/Freddie Mac Performance Data | UCI/Kaggle/政府数据的下载条件各异；商业贷款数据需授权 | 小型/合成数据与真实授信分布不同；偏差、拒绝推断与政策变化 |
| 支付、卡交易与欺诈 | 实时欺诈、账户接管、异常交易、AML 告警排序 | ULB Credit Card Fraud、IEEE-CIS、PaySim、BankSim、AMLSim、Bank Account Fraud (BAF) | 学术/竞赛或合成数据相对易得；真实支付流通常内部持有 | 严重类别不平衡、标签延迟、客户/商户实体关系和生产分布差异 |
| 新闻、公告和市场情绪 | 情绪、事件抽取、价格反应、检索增强研究 | Financial PhraseBank、FiQA、FNSPID、SEC filings、公开 RSS/公告 | 学术数据集可获取；新闻全文和专业事件数据多为商业订阅 | 新闻版权、发布时间/采集时间、重复转载和事件泄漏 |
| 金融 NLP、表格与问答 | 财报数值推理、表格理解、RAG、信息抽取 | FinQA、FinTabNet、TAT-QA、ConvFinQA、ENTRANT、FPB、FiQA | 数据集常可公开研究；源文件许可仍需单独审查 | PDF/OCR 误差、表格层级、单位/币种、数值推理链的正确性 |
| 宏观、利率与跨国统计 | 利率/通胀/就业预测、资产配置、宏观因子 | FRED/ALFRED、World Bank Open Data、IMF、OECD、ECB Data Portal、BIS、各国统计局 | 许多官方 API 免费；许可和源头版权不同。FRED 对 AI/ML 的限制尤其需要注意 | 发布与修订时点、统计定义变更、频率转换和不同国家口径差异 |
| ESG、气候与另类数据 | ESG 风险、事件风险、供应链和需求预测 | SEC/公司披露、CDP、MSCI ESG、Sustainalytics、LSEG ESG、RepRisk、卫星/客流/消费数据 | 免费披露 + 商业评级/另类数据并存；多数商业价格询价 | 供应商方法论不一致、历史回溯、覆盖偏差、版权和敏感数据治理 |
| 证券主数据与实体解析 | Security Master、跨源映射、公司行动、参考数据异常 | OpenFIGI、GLEIF LEI、SEC CIK、交易所上市/退市公告、Nasdaq Historical Daily Maintenance | 多数基础查询/注册数据可免费访问；历史完整性及商业参考数据可能付费 | Ticker 会变化/复用，单靠代码不能作为永久身份；历史有效时间非常关键 |

## 3. 可优先启动的开放数据与基准

### 3.1 市场价格、宏观和证券参考数据

- **SEC EDGAR、Company Facts 与 XBRL 数据集。** 公司申报、10-K/10-Q/8-K、结构化财务事实以及部分机构持仓数据的首选官方入口。SEC 的 API 不需要 API key；官方说明当前公平访问请求上限为每秒 10 次，并提供可批量下载的 nightly ZIP。要遵守 SEC 的访问规则，保留 CIK、accession number、form、filing date、accepted time 和原始文件。入口：[EDGAR API 文档](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)、[访问 EDGAR 数据](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)、[SEC 数据库](https://www.sec.gov/data-research/open-data-sec)。
- **Form 13F 与 Form N-PORT。** 适合研究申报披露的机构/基金持仓和变化，不能当成实时交易流水。需处理季度披露、修订申报、报告期与实际公开时间的差别。入口：[13F 数据集](https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets)、[N-PORT 数据集](https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets)。
- **World Bank Open Data、IMF、OECD、ECB、BIS 和国家统计局。** 常能免费取得宏观与金融统计，适合宏观因子研究；应逐个记录授权、修订机制和发布日期，而不是把所有“官方数据”默认视为同一许可。World Bank：[开放数据](https://data.worldbank.org/)；ECB：[Data Portal](https://data.ecb.europa.eu/)；BIS：[Statistics](https://www.bis.org/statistics/)；IMF：[Data](https://www.imf.org/en/Data)；OECD：[Data Explorer](https://data-explorer.oecd.org/)。
- **FRED/ALFRED。** 数据覆盖广，有 API 与历史版本能力，适合教学、查看和部分获许可的研究流程。但其当前服务条款明确限制将 FRED 服务或内容用于 AI/ML 系统训练，也有第三方版权系列。用于模型前必须先取得适用许可，或选择允许此类用途的原始提供方。[服务条款](https://fred.stlouisfed.org/legal/)、[API 文档](https://fred.stlouisfed.org/docs/api/fred/overview.html)。
- **OpenFIGI 与 GLEIF。** OpenFIGI 用于将不同金融标识映射到 FIGI 等标识；GLEIF 提供 LEI 及其参考信息。它们是标识解析入口，不是完整的历史证券主数据、证券生命周期或供应商 golden copy。入口：[OpenFIGI API](https://www.openfigi.com/api/documentation)、[GLEIF API 与数据](https://www.gleif.org/en/lei-data/gleif-api)。

### 3.2 学术研究和 NLP 基准

| 数据集 | 主要任务/内容 | 原论文或项目 | 使用时的限制 |
|---|---|---|---|
| FI-2010 | 限价订单簿分类、短期中间价方向预测 | [数据与相关研究入口](https://www.google.com/search?q=FI-2010+limit+order+book+dataset+paper)；常见订单簿深度学习基准 | 覆盖市场、证券数量和期间有限；同一基准反复训练不能证明跨市场泛化 |
| LOBSTER | Nasdaq 历史订单簿事件、提交/撤销/成交、不同深度盘口 | [官方数据入口](https://vdc.univie.ac.at/data-access/lobster) | 有学术访问与许可规则；不是可无条件商用的数据集 |
| Financial PhraseBank | 金融新闻句子的正/中/负情绪标签，约 4.8k 句 | Malo 等，*Good debt or bad debt: Detecting semantic orientations in economic texts*；常用于 FinBERT 情绪评估 | 数据来源和许可可能是研究用途/非商业，使用前查看原始分发条款，不要依赖不明来源的镜像 |
| FiQA | 金融意见挖掘、问题回答和情绪打分 | [FiQA 任务入口](https://sites.google.com/view/fiqa/home) | 任务赛数据各部分的条款和再分发权需逐项确认 |
| FNSPID | 时间对齐的新闻和股票价格；论文报告约 29.7m 价格记录、15.7m 新闻记录，覆盖 4,775 家 S&P 500 公司、1999–2023 | [论文](https://arxiv.org/abs/2402.06698)、[代码/数据](https://github.com/Zdong104/FNSPID) | 规模大不等于新闻文本拥有开放再分发权；保留源网站和抓取规则 |
| FinQA | 基于财报文本与表格的数值问答，带可执行推理程序 | Chen 等，EMNLP 2021；[论文](https://aclanthology.org/2021.emnlp-main.300/)、[项目](https://github.com/czyssrs/FinQA)、[数据说明与许可](https://finqasite.github.io/about.html) | 应评估答案和推理程序；数值、表格行与单位对齐很重要 |
| FinTabNet | S&P 500 年报中的财务表格与单元格结构标注 | Zheng 等，*Global Table Extractor*；[IBM 数据入口](https://developer.ibm.com/exchanges/data/all/financial-tables/) | PDF/HTML 源文件的原始权利与数据集标注许可应分开审查 |
| TAT-QA | 表格 + 文本混合的财报问答和数值推理 | [论文与代码](https://github.com/NExTplusplus/TAT-QA) | 验证集和测试集应保留原始切分；不要在生成提示模板时使用测试答案 |
| ConvFinQA | 基于财务报告的多轮对话式数值推理 | [论文/项目](https://github.com/czyssrs/ConvFinQA) | 多轮上下文中要区分问题历史、证据表和答案泄漏 |
| ENTRANT | 百万级财务表格、面向表格理解预训练 | [论文与数据说明](https://pmc.ncbi.nlm.nih.gov/articles/PMC11322654/) | 大量表格不等同于高质量监督标签；仍需做来源去重和报告级切分 |
| UCI Taiwan Credit Card Default | 约 30,000 个客户的违约预测经典基准 | [UCI 数据页](https://archive.ics.uci.edu/)（按数据集名检索） | 适合教学/基线，但不是现代全生命周期授信系统的代表 |
| UCI Taiwanese Bankruptcy Prediction | 财务比率和企业破产分类 | [UCI 数据页](https://archive.ics.uci.edu/dataset/572/taiwanese+bankruptcy+prediction) | 年份、行业与样本选择可能造成分布偏差 |
| ULB Credit Card Fraud | 欧洲持卡人交易、强烈类别不平衡、匿名/PCA 特征 | [公开数据介绍与常见入口](https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud) | 常被用于入门欺诈检测，但匿名字段限制业务可解释性；应确认该副本条款 |
| IEEE-CIS Fraud Detection | 竞赛型线上交易欺诈特征 | [Kaggle 竞赛](https://www.kaggle.com/competitions/ieee-fraud-detection) | 有复杂匿名特征和标签不平衡；随机切分或过采样很容易高估效果 |
| PaySim / BankSim | 模拟移动支付/银行交易，带合成欺诈标签 | [PaySim 论文/项目入口](https://github.com/EdgarLopezPhd/PaySim) | 可用于流程、异常检测和合成数据实验，不应被描述为真实生产交易 |
| Home Credit Default Risk | 消费者贷款申请、历史信贷行为与违约目标 | [Kaggle 竞赛](https://www.kaggle.com/competitions/home-credit-default-risk) | 需遵守平台条款；验证特征时防止多张表的未来状态泄漏到申请时点 |

表中的“公开”只描述访问路径，并不自动给出商用权利。尤其是金融新闻、竞赛数据与商业公司申报加工集，应保存原始许可链接和下载时的条款快照。

## 4. 商业数据市场：数据类别、供应方与价格透明度

### 4.1 市场、行情和衍生品

| 供应方/产品 | 常见内容 | 价格状态（2026-10-24） | 适合场景与采购检查点 |
|---|---|---|---|
| Bloomberg Terminal / Data License / B-PIPE | 多资产行情、历史数据、新闻、参考数据、估值和分析 | Terminal、数据许可和实时 feed 是不同产品；企业价格通常按账户/产品/用途报价，未能确认单一官方公开总价 | 买方需分别询问工作站席位、API/bulk、实时、历史、外部分发与 AI 训练权 |
| LSEG / Refinitiv Workspace 与数据服务 | 多资产行情、新闻、参考数据、估值、分析师预测 | 组合与许可通常需要销售报价；不应把 Workspace 席位费当成全部数据/API 费用 | 确认新闻全文、历史修订、API 速率、衍生品覆盖和数据存储权 |
| FactSet / S&P Capital IQ | 基本面、预估、持仓、企业和市场数据 | 多数企业级 API/批量数据按产品与合同询价 | 研究时需确认实体映射、历史版本、IBES/估值/持仓的数据组件是否另收费 |
| CRSP、Compustat、IBES、OptionMetrics（常经 WRDS 访问） | 股票回报、证券主数据、基本面、分析师预测、期权 | 机构/学术订阅；具体价格受机构和内容包影响，无法给出通用公开价 | 研究许可是否可用于商业产品；检查 CRSP-Compustat link table、退市回报和历史版本 |
| Nasdaq Data Link | 开放和高级金融、经济及另类数据集；API 与批量导出 | 平台和开放数据集可免费使用；Premium 数据按数据集订阅/报价，单一总价不存在 | 逐个 dataset 核对频率、历史深度、许可与再分发。官方介绍：[数据与账户](https://data.nasdaq.com/sign-up) |
| Alpha Vantage | 股票、外汇、加密资产、基本面和经济指标 API | 有免费额度及公开付费套餐；限制随套餐与服务调整，应以官网价格页为准 | 原型和轻量采集；确认实时/延迟、调用额度、商业用途与完整历史 |
| Tiingo、Massive（Polygon.io 品牌转型后的数据服务）、Intrinio、Financial Modeling Prep | 行情、基本面、公司行动、期权/新闻等各自不同的 API 产品 | 部分套餐公开标价，企业、实时、深历史或附加数据通常另行确认 | 不应只比较月费；比较 API 限额、历史回补、调整价格、交易所许可和数据展示权 |
| QuantConnect 数据集 | 股票、期货、期权、外汇、加密资产及研究/回测数据 | 不同数据集可能免费或订阅，具体在数据目录查看 | 便于研究和回测流程，但要核对数据来源、实时能力及从平台导出到其他系统的许可 |
| LOBSTER | Nasdaq TotalView-ITCH 重建的订单簿，时间戳最高可到纳秒、支持不同深度 | 有正式价格表。可查到的官方学术价目表（2024-03-02）列有机构年度方案 £4,897、首年设置费 £500（未含 VAT）；不是经确认的 2026 当前报价，采购时需再次核对 | 高质量订单簿研究；确认机构资格、账户数、历史区间、存储和商用权。[官方访问页](https://vdc.univie.ac.at/data-access/lobster)、[历史价目表 PDF](https://lobsterdata.com/info/docs/legal/LOBSTER_priceList.pdf) |
| NYSE TAQ、Nasdaq TotalView、OPRA、Cboe DataShop、CME DataMine | 交易所/合并行情、逐笔成交、订单事件、期权与期货历史数据 | 产品、分辨率、市场、历史年份、用户和分发方式不同，通常需查看官方价目表或询价 | 适合高频/执行研究；采购前把 exchange entitlement、实时/历史数据、存储和衍生产品条款写入清单 |
| FINRA TRACE 与 WRDS TRACE | 美国公司债交易报告/成交数据 | 部分公共数据和 API 可访问；完整历史、研究产品和商业使用可能受费用/资格限制 | 估值、流动性和信用交易研究；确认交易范围、延迟发布、历史覆盖与债券 ID 映射 |

#### 4.1.1 可查到公开标价的例子

以下是供应方官方页面在研究基准日可检索到的价格样例，旨在提供量级参考，而不是跨厂商等价比较。订阅价格、计费周期、市场数据交易所费用和授权范围可能调整；“个人使用”套餐不能默认用于公司生产系统或对外展示。

| 产品/套餐 | 官网可见价格或限制 | 必须同时注意的条件 |
|---|---|---|
| Alpha Vantage | 官方页面说明普通免费额度为每日 25 次 API 请求；Premium 有多个月付/年付档位，但当前网页检索结果未可靠呈现各档具体金额，因此不臆造数字 | [官方价格页](https://www.alphavantage.co/premium/)；确认实时/15 分钟延迟数据、premium 函数、请求速率与商业用途 |
| Massive / Options API | Basic 免费；Starter US$29/月；Developer US$79/月；Advanced US$199/月 | 官方页面标注为非专业个人使用方案；历史年限、是否实时、报价/成交覆盖各档不同。企业商业用途需另查 business plans。[官方价格页](https://www.massive.com/pricing?product=options) |
| Massive / Financials & Ratios、Stocks Advanced | Financials & Ratios US$29/月；Stocks Advanced US$199/月（官网列示为个人使用） | 价格是相应产品套餐，不代表可获得完整交易所原始 feed 或再分发权。[官方价格页](https://www.massive.com/pricing) |
| Intrinio | Individual US$150/月，限个人使用；Startup 起价 US$333/月，官网注明按阶段递增；Enterprise US$1,250/月起 | Individual 不含再分发/展示权；Startup 包含商业使用/展示权但条款和数据 feed 仍需核对。Mutual Fund、News 等部分数据列为 Enterprise 产品。[官方价格页](https://intrinio.com/pricing) |
| Financial Modeling Prep（FMP） | Basic 免费（250 次/日）；Starter US$19/月、Premium US$49/月、Ultimate US$99/月，页面价格按年付计费展示 | 该价格页为个人套餐示例；官网另有商业/企业计划。显示或再分发需要另签数据展示与许可协议。[个人价格页](https://site.financialmodelingprep.com/datasets/market-data-real-time)、[商业计划说明](https://site.financialmodelingprep.com/developer/docs/pricing?planType=commercial) |
| LOBSTER academic subscription | 可访问的官方历史价目表（标注日期 2024-03-02）列出学术机构一年期方案 £4,897，首年设置费 £500，均不含 VAT | 这是历史公开价目表，不能认定为 2026 年现行价格；当前方案、机构资格、账户数和商用权限需询价确认。[官方历史价格表 PDF](https://lobsterdata.com/info/docs/legal/LOBSTER_priceList.pdf) |
| CME DataMine：EBS NDF Level 2 OFF SEF 示例产品 | 搜索时官方目录对该具体历史产品列示 Complete History US$130,000，月订阅 US$2,600/月、年订阅页面列示 US$28,080/年 | 该数字仅对应所列产品及历史区间，不是 CME 所有数据产品的通用价格。采购时应复核目录中的实际数据范围、许可和当前报价。[官方产品目录](https://datamine.new.cmegroup.com/catalog/dataset/cf4d1ced48d84561a06d5b81675168aa) |
| Nasdaq Data Link Premium | 开放数据集可免费访问；Premium 按数据集购买，官方要求注册后查看每个产品的价格和许可 | 没有统一的“Nasdaq Data Link 总价”。应按数据集逐个评估历史深度、频率、商业训练、存储和再分发。[官方注册及定价说明](https://data.nasdaq.com/sign-up) |
| Bloomberg、LSEG、FactSet、CRSP/Compustat、Morningstar、专业新闻和另类数据 | 未能从官方公开页面确认可普遍适用的完整机构/API总价，通常需按内容、席位、市场、历史深度与用途询价 | 应分别询问终端、API、bulk、实时、历史、模型训练、derived data、对外展示及再分发权益；第三方文章的估价不能替代正式报价 |

采购时要把软件价格和数据授权价格分开。免费的 Python SDK、开源回测平台或 API wrapper 仅表示工具代码可能开放，不会自动开放底层交易所、新闻、基本面或另类数据的版权与商用权。

### 4.2 基本面、新闻、基金、信用与另类数据

| 供应方/产品 | 常见数据 | 价格状态 | 风险和核对项 |
|---|---|---|---|
| Morningstar Direct / Data | 基金、持仓、绩效、分类和 ESG 等 | 企业订阅/询价 | 不同数据库、地区、用户及展示权限可能分开授权 |
| MSCI ESG、Sustainalytics、LSEG ESG、RepRisk、CDP 企业数据 | ESG、气候、争议事件与公司披露 | 多数商业评级或批量/API 数据需要询价；部分披露可公开取得 | 方法论版本、历史修订、覆盖范围和评分差异需要记录，不宜把不同评级视为同一个标签 |
| Dow Jones Factiva、RavenPack、Bloomberg News、LSEG News Analytics、LexisNexis | 专业新闻、事件分类、情绪、实体映射 | 通常商业授权/询价；全文、摘要、派生分数可能具有不同再分发权 | “有 API”不等于允许把全文用于基础模型训练；确认训练、缓存、embedding 和输出保留条款 |
| ORBIS / Bureau van Dijk、Dun & Bradstreet、PitchBook、Crunchbase | 企业、集团关系、私人公司、交易和另类公司数据 | 商业合同；API/批量和衍生使用通常另计，公开统一价不一定存在 | 关注历史实体关系、来源覆盖、私企数据合法使用和更新频率 |
| 信用局、贷款服务商、征信/反欺诈平台 | 信用文件、设备、身份、账户关系和风险标签 | 按地区、查询量和业务合同定价 | 高敏感个人数据必须满足目的限定、隐私、保留周期、可解释性与公平性要求 |
| 支付、卡组织、银行和券商内部数据 | 交易授权、拒绝码、争议、订单、成交、总账、调查案件 | 通常不能公开采购完整真实数据；要靠机构内部授权、脱敏或受控计算 | 不能用公开价格/订单簿替代真实客户级交易、完整路由和已确认根因标签 |

**价格调查建议。** 采购清单应至少分别列出：基础席位、API、历史批量数据、实时 feed、延迟行情、公司行动/参考数据、新闻全文、数据存储期限、衍生数据、内部模型训练、跨团队访问、对外展示和再分发。厂商可能给出一个“平台报价”，但数据许可仍按组件或用途分层。若官方没有公开价目表，本文一律标记为“询价/未能确认官方公开价”，不以论坛或第三方博客的传闻数字作为确定报价。

## 5. 重要论文、数据集与项目的对应关系

金融 AI 文献很容易出现“只比较模型、不比较数据处理”的问题。以下列出有代表性的论文/项目、其明确数据依赖以及可以复现到什么程度；其中商业数据论文可能无法完全复现原始结果。

| 论文/项目 | 主要研究方向 | 对应数据集/数据来源 | 复现时需注意 |
|---|---|---|---|
| Gu、Kelly、Xiu，*Empirical Asset Pricing via Machine Learning*（2020） | 机器学习在资产定价中的预测能力 | 美国股票历史回报、公司特征、财务和分析师等数据；研究传统上依赖 CRSP、Compustat、IBES 等数据库组件 | 数据链接、月末/披露时点、退市回报、样本股票可投资性与因子构造会显著影响复现 |
| *Qlib: An AI-oriented Quantitative Investment Platform*（Microsoft Research，2020） | 可复现的量化研究工作流、模型训练和策略回测 | Qlib 提供 Alpha158、Alpha360 等数据格式/特征集，并有中国与美国市场数据配置 | Qlib 是研究平台，不意味着所有数据源的许可自动相同；下载的预处理数据也需看来源 |
| *FinRL* 与 *FinRL-Meta*（NeurIPS 2020/2022，及后续数据论文） | 强化学习、资产配置与交易环境 | 通过数据处理器连接 AkShare、Alpaca、Baostock、Binance、Tushare、QuantConnect、Yahoo Finance、WRDS 等来源，实际可用性依服务配置而异 | 统一训练/测试/交易链路很重要；不同数据供应商、复权与缺失处理会让同一策略的结果不可直接比较 |
| *DeepLOB*（Zhang 等，2019）及订单簿深度学习研究 | 从 LOB/盘口时序预测短期价格方向 | FI-2010 是经常使用的公开订单簿基准；其他工作会使用交易所或供应商订单簿数据 | FI-2010 适合验证算法但样本规模、市场和期间有限；不同论文的标签 horizon 和切分不可直接混比 |
| *FinBERT: Financial Sentiment Analysis with Pre-trained Language Models*（Araci，2019/2020 版本） | 金融文本情绪分类 | Financial PhraseBank 等金融情绪数据集是常见微调/评估材料 | 句子级情绪不等于资产收益预测；应做领域、来源和时间外测试 |
| *FNSPID: A Comprehensive Financial News Dataset in Time Series*（2024） | 新闻与股票价格时间对齐、情绪辅助预测 | FNSPID 的股票价格和时间对齐新闻记录 | 必须检查新闻首次可见时间、重复转载和未来修订；公开下载不自动解决新闻版权 |
| *FinQA: A Dataset of Numerical Reasoning over Financial Data*（EMNLP 2021） | 基于表格/文本的财务数值推理 | 从 S&P 500 公司财报/FinTabNet 构建的问答与推理程序 | 应报告程序执行正确率及数值答案正确率；表格标题、单位和会计期间是证据的一部分 |
| FinTabNet / Table Transformer 类工作 | 财务表格检测、结构识别与提取 | 年报 PDF/HTML 中带表格结构标注的页面/表格 | 文档重复、视觉分辨率、单元格跨行跨列、PDF 源文件许可会影响结果 |
| BloombergGPT（Bloomberg，2023） | 金融语言模型预训练 | Bloomberg 自有金融文本与通用文本混合语料；论文披露语料规模与组成，但原始语料并非公开数据集 | 公开论文不等于能重现训练集；对外使用需有自己的授权语料和可审计数据来源 |
| FinGPT 系列开源研究 | 金融开源模型、情绪和数据流水线 | 使用公开金融数据与任务基准，常见包括 Financial PhraseBank、FiQA 及新闻/行情类数据 | 具体仓库和论文版本的数据集组合不同，应按 commit、脚本与模型卡核对，而非只凭项目名称 |
| ULB、IEEE-CIS、PaySim 上的欺诈检测论文 | 卡交易/电商欺诈/移动支付反欺诈 | 各自竞赛/研究数据；PaySim 是模拟数据，ULB 是匿名化特征，IEEE-CIS 是竞赛型特征表 | 随机拆分可能把相似客户/模式泄漏到测试集；一定要进行时间外、业务实体隔离和成本敏感评估 |
| 信用违约研究（UCI、Home Credit、LendingClub 等） | 违约分类、授信评分、解释与公平性 | 小型 UCI 基准、公开竞赛数据、部分历史贷款表现数据 | 目标定义、观察窗口、拒绝样本、政策变更与样本选择偏差通常比模型类型影响更大 |

补充入口：微软 Qlib 的数据组件说明：[Qlib data](https://github.com/microsoft/qlib/blob/main/docs/component/data.rst)；Qlib 原论文：[Microsoft Research](https://www.microsoft.com/en-us/research/publication/qlib-an-ai-oriented-quantitative-investment-platform/)；FinRL-Meta 论文和数据源说明：[项目仓库](https://github.com/AI4Finance-Foundation/FinRL-Meta)；FinQA 原论文：[ACL Anthology](https://aclanthology.org/2021.emnlp-main.300/)；FNSPID 原论文：[arXiv](https://arxiv.org/abs/2402.06698)。

### 5.1 不要把“论文使用了某个数据库”理解为全部原始数据可下载

学术论文通常只描述数据采购或处理后样本，不会公开整个 CRSP、Compustat、Bloomberg、交易所订单簿或专业新闻语料。复现论文时应区分四种情况：完全开放的数据和代码；公开数据但需要自行构建预处理流程；需要研究机构订阅的商业数据；只公开指标或部分匿名化样本的研究。对于第三、四类情况，应尽量复现方法、时间切分和评估流程，而不是声称已经复现原论文的全部数据与结果。

## 6. 金融数据的采集与标准化

### 6.1 建议采用分层数据管道

推荐以“原始证据可追溯”为原则，至少分为三层：

1. **Raw / Bronze：** 原样保存供应方响应、文件、下载时间、请求参数、HTTP 元信息、许可版本和内容哈希；只追加，不在原始层覆盖旧内容。
2. **Canonical / Silver：** 将多个源映射到稳定业务实体、标准单位、时间戳与业务事件模型；清洗规则可重复执行，记录来源字段和转换版本。
3. **Feature / Gold：** 面向具体任务生成特征、标签、训练样本和点时快照；每个训练集要能回溯到输入数据版本、转换代码版本和标签定义。

金融数据建议把事件发生时间（event time）、信息首次可用时间（available/known time）、采集入库时间（ingestion time）与业务有效时间（valid time）分开。只存一个 timestamp 不足以处理补报、延迟、历史修订、财报重述和交易纠错。回测必须按当时市场参与者真正能够看到的信息重建输入。

### 6.2 关键行业标准与标识符

| 标准/标识 | 主要用途 | 应用注意事项 |
|---|---|---|
| ISO 20022 | 支付、现金管理、证券和金融机构间消息模型 | 统一的是消息语义与结构，不代表每家机构的内部字段和代码表完全一致 |
| FIX Protocol | 订单、执行报告、交易前后流程和市场连接 | 订单 ID、ClOrdID、ExecID、撤改单链路和重复消息应保留 |
| FpML | OTC 衍生品交易的产品/交易语义 | 适用于衍生品事件与合同数据；还需映射内部风险、估值和结算模型 |
| XBRL 与 US GAAP/IFRS Taxonomy | 财报事实、上下文、单位、标签与披露 | 一个数值须连同 concept、period、unit、dimensions、filing 和 restatement 解释 |
| LEI / GLEIF | 法人实体的全球标识 | 区分法律实体与证券；集团结构需要有效时间和关系版本 |
| ISIN、CUSIP、FIGI、MIC | 证券标识、市场/交易场所标识 | 需明确标识的作用域、分配规则、变更和历史映射；Ticker 不能替代永久 ID |
| ISO 4217 | 货币代码 | 金额必须同时携带币种；不能在缺少汇率时混加不同币种 |
| 交易所日历/时区 | 交易日、半日市、节假日和夏令时处理 | UTC 与本地交易所时间都应保留；不能用自然日补齐所有市场的缺失记录 |

标准文档可能需要购买或受知识产权约束，但在架构中采用其术语、代码和语义仍能降低跨系统误解。标准名本身不代表所有实现符合标准；需要验证对方的具体版本和字段子集。

### 6.3 采集框架与数据工具

| 工具/项目 | 常见作用 | 边界 |
|---|---|---|
| OpenBB Platform | 聚合多金融数据提供方并提供研究接口 | 是访问/分析平台，不是所有连接器背后数据的统一许可 |
| FinRL / FinRL-Meta | 多数据源清洗、特征处理、交易环境、训练与回测 | 适合算法原型和 benchmark；真实生产前需确认源质量、成本和许可 |
| Microsoft Qlib | 金融研究、特征处理、数据集管理、模型训练和策略回测 | 预处理数据与因子研究依赖市场覆盖和样本构造，需要单独审计 |
| AkShare / BaoStock / Tushare | 中国市场数据采集接口或 Python SDK | 尤其需要逐项核对服务条款、点数/限额和底层数据源许可 |
| CCXT | 统一多加密交易所 API 接口 | 是 API 适配层，不是完整历史数据仓库；交易所可用接口和保留期限不同 |
| SEC 官方 API / bulk ZIP | 公司申报、XBRL 和公司事实 | 遵守公平访问政策，优先采用官方 bulk 数据而非无节制抓取 |
| pandas / Polars / DuckDB / PyArrow | 数据整理、列式文件处理和本地分析 | 要通过数据契约和类型校验管理单位、时区、nullable 字段及精度 |
| Great Expectations / Soda / Pandera / dbt tests | 数据质量规则、schema、分布和业务约束测试 | 工具不能替团队定义正确的业务口径；核心断言必须由数据所有者确认 |
| Parquet + 对象存储 + Iceberg/Delta Lake | 版本化历史、批流数据分层与可重复读取 | 数据时间旅行不自动等于正确的金融 point-in-time 数据；还要保留业务有效时间和首次可见时间 |
| Airflow / Dagster 等编排工具 | 定时采集、回补、重试、任务依赖和告警 | 采集任务需幂等、有限重试、速率限制、延迟监控与失败补偿 |

### 6.4 金融数据清洗的关键规则

**价格和收益。** 原始价格与调整后价格应同时保存，并将调整因子及其来源独立记录。拆股、现金分红、特别分红、配股、退市与证券合并需要明确处理。模型标签应声明预测的是 raw price、adjusted price、总回报还是相对基准超额收益。避免用今天回算的复权序列不加说明地模拟历史时点的真实可见信息。

**时间与修订。** 对财报，period end、filed date、accepted time、首次发布以及后续重述不是同一时点；对宏观数据，初值、修订值和最终值必须分开。对成交和订单，要保留交易所本地时区、UTC、序号或更高精度时间戳。先按稳定业务主键去重，不能仅按“时间+数值相同”直接删除重复事件。

**缺失值语义。** “没有成交”“停牌”“市场休市”“供应商没有返回”“行情延迟”“字段不适用”是不同状态。不能把所有缺失值补成零，也不能把盘中没有交易自动当作采集失败。低频与高频数据的缺失机制可能完全不同；插值/前向填充必须记录业务规则并只在允许的输入窗口内执行。

**实体与历史映射。** 不能把 ticker 当永久实体键。使用 CIK、FIGI、ISIN、CUSIP、LEI 或内部 surrogate key 建立映射，并维护 valid_from、valid_to、known_at、source、mapping confidence 和人工裁决。证券变更、退市、公司更名、跨市场挂牌和债券到期都应作为事件，而不是简单覆盖旧行。

**财务报表与会计数据。** 保存概念名、单位、币种、上下文、合并/母公司口径、期间类型和来源。同比、环比和比率计算要处理分母为零、符号变化以及会计重分类。模型学到的“异常”可能是报告口径变化，不一定是财务风险。

**交易、支付与欺诈。** 区分授权、清算、结算、退款、撤销、拒付/争议和调查确认结果；为标签保存 label_created_at、label_matured_at、label_source。最近发生的交易若尚未进入争议窗口，不应简单标为正常。匿名化字段、合成标签、SMOTE/CTGAN 等产生的样本要与真实样本和真实线上指标明确区分。

**跨系统对账。** 使用业务链路 ID 关联订单、成交、分配、结算、现金与总账事件。匹配容差、货币精度、应计规则、日历和截止时间应由业务控制定义，而不是让模型取代确定性会计约束。对账标签至少分为“候选差异”“人工确认差异”“确认根因”“解决动作”和“已关闭”，不能混成单一异常标签。

## 7. 训练数据构造与评估：金融研究的最低要求

1. **Point-in-time（点时数据）。** 每条特征都应能回答“在预测时点，这个值是否已经公开并可被系统读取”。在财报、基金持仓、新闻、分析师预测、宏观数据和公司行动中，尤其不能拿最终修订值回填历史。
2. **避免幸存者偏差。** 股票池必须包含当时可投资的证券，包括退市、破产、并购和更名证券。不能只对今天仍在指数中的公司回测几十年前的策略。
3. **时间切分优先于随机切分。** 按时间建立 train/validation/test，必要时使用 walk-forward；在标签预测窗口重叠时考虑 purging/embargo。对欺诈和信用任务，进一步按账户、客户、商户或发行人隔离，防止同一实体高度相关样本在训练和测试间泄漏。
4. **所有预处理只在训练集拟合。** 标准化、缺失填充、降维、特征筛选、词表、采样和概率校准都要防止从未来测试数据学习统计量。滑窗生成后的行不能再随意随机切分。
5. **强基线和增量贡献。** 金融表格任务至少比较规则/逻辑回归/GBDT（如 LightGBM、XGBoost）与深度模型；时间序列比较 last-value、季节性、线性模型；NLP 比较词典/传统分类器与金融预训练模型。用 ablation 证明复杂模型带来的是增量价值，而非更大的参数量。
6. **评估业务成本而不只评估准确率。** 量化投资关注净交易成本后收益、Sharpe、最大回撤、换手率、容量和分组稳定性；欺诈关注 PR-AUC、Precision@K、固定调查预算下 Recall、误拒成本、欺诈金额覆盖率和校准；信用风险关注 ROC/PR、校准、稳定性、公平性与经济损失；数据质量关注告警召回、误报、金额重要性和检测延迟。
7. **记录实验血缘。** 每个训练集需要数据快照/清单、供应方和许可、抓取时间、处理代码 commit、特征版本、label window、切分策略、随机种子、模型与指标版本。实验结果若无法复算，就不应作为正式研究结论。

### 7.1 推荐的数据契约

每个标准化事件至少考虑以下字段（按数据域增减）：source、source_record_id、entity_id、instrument_id、event_time、available_at、ingested_at、valid_from、valid_to、revision_id、currency、unit、exchange_timezone、data_status、license_id、raw_payload_hash、quality_flags、schema_version。所有字段都不必出现在所有表里，但事件时间、可见时间、实体身份、来源和版本信息应当成为统一治理的一部分。

建议将“数据集版本”定义为：数据源与许可快照 + 原始文件清单/哈希 + 标准化 schema 版本 + 清洗代码版本 + 标签定义版本 + 时间切分清单。不要把“同一张表当前有多少行”当作可复现的数据版本。

## 8. 生产级数据治理与业界实践

### 8.1 许可是数据架构的一部分

数据目录至少要记录：许可主体、许可范围、允许用途、地域、可访问用户、存储位置、留存期限、训练用途、派生数据与 embedding 是否算再分发、输出展示规则、下游模型部署场景、合同到期日以及删除/退出机制。商业数据常把“内部研究”“模型训练”“生产决策”“外部客户展示”“再分发”视为不同权益。需要对供应商数据建立访问控制和血缘标签，确保禁止用途不会经 ETL、feature store 或模型服务被绕开。

### 8.2 金融数据质量控制应分层

- **技术完整性：** 文件/接口是否完整，schema 是否改变，记录数和哈希是否异常，时区/精度是否符合约定。
- **业务有效性：** 证券是否有效、单位和币种是否合理、交易日与结算日规则是否一致、价格/数量/金额是否满足业务约束。
- **时间正确性：** 事件时间、发布时间、首次可见时间、入库时间以及修订版本是否合理。
- **统计稳定性：** 分布、缺失、来源占比、极端值、数据延迟和标签成熟度是否异常。
- **业务结果验证：** 与独立来源对账、样本抽查、人工裁决、控制总额以及历史回放能否吻合。

### 8.3 推荐的生产交付流程

1. 先写数据集说明、用途、许可和风险评估；取得授权后才采集。
2. 构建采集器，支持增量同步、回补、速率限制、幂等写入、重试退避、断点续传和数据删除要求。
3. 保存原始数据与元数据；标准化处理可重跑但不能覆盖原始证据。
4. 建立 schema 与业务规则测试，监控数据延迟、记录数、缺失率、重复率、分布漂移和历史修订。
5. 生成训练样本时执行 point-in-time join、实体映射和防泄漏切分；训练完成后保存完整数据与实验 manifest。
6. 预生产先做回放、影子测试或低风险试点；线上监测输入漂移、预测质量、业务损失和来源可用性，保留回滚路径。
7. 与供应商变更、数据许可到期、API 字段变更和业务口径升级联动；数据产品必须有 owner、SLA、质量 SLO 和事故处理机制。

## 9. 哪些关键领域目前没有足够开放数据？

| 业务任务 | 公开数据能覆盖什么 | 关键缺失 | 可行起点 |
|---|---|---|---|
| 真实基金会计/NAV break 根因 | 公开基金持仓、部分 NAV/财报、合成异常 | 管理人/托管人总账、应计规则、定价源差异、真实 break 工单及根因 | 定义脱敏 schema，用合成数据验证数据契约与流程；寻找受控机构样本验证标签 |
| 真实机构执行成本/Implementation Shortfall | 公开逐笔成交/盘口可构造市场状态代理 | 机构订单意图、到达/决策价、路由、撤改单、部分成交和完整执行结果 | 先用 LOBSTER 做短期价格反应代理；明确不等同于真实执行成本 |
| 订单成交概率与排队位置 | 公开 LOB 重建与部分订单事件 | 订单自身的排队优先级、路由、改价/撤单、成交归属 | 使用公开盘口构建代理仿真，并对模拟成交标签单独报告 |
| 内部交易合规和 AML 调查 | 合成 AML/交易网络、部分公开处罚/公告 | 客户/账户关系、真实交易网络、调查选择过程、已确认案件结论 | 先用 AMLSim/合成数据验证管道与模型接口，生产效果需内部已授权数据 |
| 多供应商历史证券主数据冲突 | OpenFIGI、LEI、申报和交易所公告 | 商业供应商原始差异、完整历史版本、字段级人工裁决 | 建立历史有效时间模型；合成字段冲突用于流程测试，人工复核作为标签 |
| 期权历史曲面与真实报价错误 | 部分公开报价或有限 API | 高质量历史期权链、陈旧报价标记、独立估值、确认错误标签 | 选定授权的历史期权数据，先做静态套利约束和规则基线 |
| 真实拒贷样本和授信决策反事实 | 部分贷款表现、公开信用基准 | 被拒绝申请人的潜在还款结果、政策规则和人工审批记录 | 明确拒绝推断与选择偏差；不能只靠 Kaggle 已获批样本得出政策结论 |

合成数据对开发非常有价值：可以验证模式、数据质量规则、并发与延迟、模型接口和评估脚本。但合成分布通常由生成器预设；模型在合成标签上表现好，不能证明它在真实金融数据上有效。公开数据中缺失的关键业务字段也不能通过“加大 Transformer”补回来。

## 10. 建议的选型路线

| 阶段 | 建议组合 | 目标 |
|---|---|---|
| 个人学习/概念验证 | SEC 数据与部分官方宏观数据（先审许可）、UCI、FPB/FiQA、FinQA、公开市场日频数据、FI-2010 | 验证数据模型、任务定义、基线与评价流程 |
| 研究型团队 | 上述数据 + 有明确许可的数据集 + Qlib/FinRL + DuckDB/Polars + Parquet + 自动数据质量测试 | 提升可复现性，隔离数据来源与算法贡献 |
| 大学/机构量化研究 | WRDS（按权限选择 CRSP/Compustat/IBES/TRACE/OptionMetrics 等）、交易所/LOBSTER 历史数据、受控研究环境 | 做可靠的资产定价、微观结构和跨数据域研究 |
| 金融机构生产 | 经签约的行情/新闻/基本面供应商 + 内部订单/交易/基金账簿/标签 + 数据目录、血缘、权限和审计 | 支持实时风控、交易决策、定价、对账、模型监控与合规审计 |

不建议一开始采购“最全的数据终端”，也不建议把免费的多源 API 直接拼成未经治理的生产数据集。较优顺序是：先定义业务决策与预测时点，再列出必需字段和标签，核对公开数据是否能满足，最后只为无法从开放数据取得且确实有增量价值的部分采购授权。对商业数据试用期，应预先设置覆盖率、历史完整性、重述/回补、时间戳准确度和下游用途验收指标。

## 11. 供应方与许可的参考入口

- [SEC Open Data](https://www.sec.gov/data-research/open-data-sec)、[EDGAR API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)、[SEC Fair Access](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [FRED 服务条款](https://fred.stlouisfed.org/legal/)、[FRED API](https://fred.stlouisfed.org/docs/api/fred/overview.html)
- [World Bank Open Data](https://data.worldbank.org/)、[IMF Data](https://www.imf.org/en/Data)、[ECB Data Portal](https://data.ecb.europa.eu/)、[BIS Statistics](https://www.bis.org/statistics/)
- [Nasdaq Data Link](https://data.nasdaq.com/sign-up)、[OpenFIGI API](https://www.openfigi.com/api/documentation)、[GLEIF](https://www.gleif.org/en/lei-data/gleif-api)
- [LOBSTER access](https://vdc.univie.ac.at/data-access/lobster)、[LOBSTER historical price list PDF](https://lobsterdata.com/info/docs/legal/LOBSTER_priceList.pdf)
- [Qlib](https://github.com/microsoft/qlib)、[FinRL-Meta](https://github.com/AI4Finance-Foundation/FinRL-Meta)、[OpenBB](https://github.com/OpenBB-finance/OpenBB)
- [FNSPID paper](https://arxiv.org/abs/2402.06698)、[FinQA paper](https://aclanthology.org/2021.emnlp-main.300/)、[FinQA project](https://github.com/czyssrs/FinQA)、[FinTabNet dataset overview](https://codewithpapers.app/dataset/fintabnet)
- [WRDS datasets overview](https://wrds-www.wharton.upenn.edu/pages/about/data-vendors/)、[FINRA Developer Center](https://developer.finra.org/docs)

## 12. 结论

金融数据集的选择应从任务与可用信息出发，而不是从模型或供应商名称出发。日频价格适合快速验证量化框架；财报/XBRL 适合基本面与金融问答；Financial PhraseBank、FiQA 和 FNSPID 适合情绪与新闻时序研究；FI-2010、LOBSTER 和交易所数据适合微观结构；公开信用/欺诈基准适合入门与方法比较。但真实基金会计、订单执行、支付风控、合规调查和多供应商历史主数据通常需要内部或商业数据，公开代理数据只解决一部分问题。

在采购与建模前必须同时回答四个问题：数据从哪里来、在预测时点何时可见、标签代表什么真实业务结论、许可证是否覆盖预定的训练和部署用途。随后建立不可变原始层、统一历史身份和时间语义、数据质量测试、无泄漏时间切分、强基线、实验血缘和生产监控。只有这些基础可信，复杂模型的离线提升才有可能转化为可验证的业务价值。

*免责声明：本文为截至 2026 年 10 月 24 日的研究综述，不构成数据许可或法律意见。商业数据价格和使用权随合同而异；在训练模型、存储原始数据、构建 embedding、内部推广或向客户展示结果前，必须以供应商当前条款和正式合同为准。*
