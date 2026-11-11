# 金融研究与 Insight 平台：金融机构应该自建什么，应该采购什么？

**文档类型：** 行业产品分析与平台建设白皮书  
**研究基准日：** 2026-11-11  
**适用对象：** 银行、资产管理公司、券商、财富管理机构、保险资管及其他需要开展金融研究、投资分析和风险洞察的机构  
**主要视角：** 以机构内部 Research Workbench 与 Insight 产品为目标，兼顾投研、组合管理、风险和企业战略研究  
**证据说明：** 厂商产品能力以官方页面为主；监管部分以监管机构原文为主；学术部分包含 2026 年 arXiv 预印本，不能视为同行评审结论或生产环境验证

---

## 核心判断

Claude 和 OpenAI 都已经跨过了“通用大模型加一个金融 Prompt”的阶段。Anthropic 发布了面向金融服务的工作流模板、金融数据连接器和 Managed Agent 运行方式；OpenAI 在 2026 年 9 月推出 ChatGPT for Financial Services，将内置金融数据、GPT-6 Astra、金融分析和 Office 模板放进同一产品。与此同时，Bloomberg、FactSet、AlphaSense、S&P Global 等专业厂商也在将数据、分析与 AI 工作流结合。

因此，一家金融机构今天从零建设平台，不能把“财报摘要、公司问答、估值模型初稿、同行比较、研究报告生成”当成自己的长期竞争壁垒。这些能力正在成为模型厂商和金融数据供应商的标准产品。

真正值得机构长期持有的，是自己的研究记忆、分析方法、业务语义、投资假设、组合上下文、客户与风险约束、历史判断及其结果，以及能够在任意时点复现的证据和计算链。平台的产出也不应只是一次性的问答，而应是持续更新、经过验证、能关联业务影响并进入工作流程的 Insight。

建议把产品定位成一个机构级 Research Intelligence Platform，面向用户提供两个入口：供分析师主动探索的 Research Workbench，以及面向投资经理、风险人员和管理层持续推送的 Insight Hub。两者共享同一套可信数据、研究记忆、授权、计算、证据和治理底座。

## 1. 市场已经走到哪里

### 1.1 Claude：从金融 Skill 扩展到金融工作流产品

Anthropic 的金融服务方案已经包含专门的 Financial Analysis 能力、数据连接器和面向金融工作的 Agent 模板。其公开的金融服务生态连接 Box、Daloopa、FactSet、Morningstar、Palantir、PitchBook、S&P Global、Snowflake 等数据或企业平台，覆盖公司基本面、估值、研究、私募市场及企业内部数据。官方描述强调分析结果能够链接回来源材料，便于复核。参见 [Claude for Financial Services](https://www.anthropic.com/news/claude-for-financial-services)。

2026 年发布的十个金融 Agent 模板更接近实际岗位工作：Pitch Builder、Meeting Preparer、Earnings Reviewer、Model Builder、Market Researcher、Valuation Reviewer、General Ledger Reconciler、Month-end Closer、Statement Auditor 和 KYC Screener。每个模板将 Skill、数据 Connector 与专项 Subagent 组合起来；同一工作流可以作为 Claude Cowork / Claude Code 插件使用，也可以参考 Managed Agents cookbook 在 Claude Platform 上运行。Managed Agent 的公开介绍还包含长时任务、单工具权限、托管凭证库和 Agent 审计日志等能力。用户仍然需要审阅、修改和批准面向客户、正式文件或业务动作的结果。参见 [Agents for Financial Services](https://www.anthropic.com/news/finance-agents)。

Anthropic 的公开仓库 [anthropics/financial-services](https://github.com/anthropics/financial-services) 把这些资产组织为可复用的插件和 Skill。金融分析插件覆盖 Comps、DCF、LBO、三表模型和 Excel 检查；其他垂直插件覆盖投行、股票研究和私募股权工作。仓库也明确鼓励机构替换数据连接器、加入公司自身上下文、调整模型和流程标准。

**对金融机构的含义：** Claude 的金融 Skill 已经能显著压缩通用工作流从零搭建的时间。机构可以把它作为分析师个人效率工具、标准流程模板和原型起点。但公开 Skill 本身并不包含本机构完整的历史投研判断、内部研究方法、数据许可边界、投资组合上下文和业务审批责任。它是可复用的工作流资产，不等于机构自己的 Research Intelligence Core。

### 1.2 OpenAI：金融服务已经成为独立产品形态

OpenAI 于 2026 年 9 月 10 日发布 [ChatGPT for Financial Services](https://openai.com/index/introducing-chatgpt-financial-services/)。它不是单纯把通用 ChatGPT 加上金融系统提示词，而是一个面向金融机构的 ChatGPT Work 体验，整合金融数据、GPT-6 Astra 推理、金融研究、财务模型和机构定制材料。

产品内置或合作引入的数据包括 Daloopa、PitchBook、LSEG News、Crunchbase 和 Fiscal.ai，覆盖财报、财务报表、公司基本面、私募公司与融资信息等。OpenAI 表示这些数据由其基础设施索引和托管，以支持检索、时延和细粒度引用；对于机构已有的 S&P Capital IQ、LSEG、MSCI、Dow Jones Factiva、Moody's 等订阅，也在推进共享登录和 entitlement 集成。它还公布了超过 50 个连接器的生态，包含 Datasite、Box、Preqin、FactSet、Intapp 等。

产品将金融研究和产出物放在同一个工作环境：研究人员可以检查财务数字对应的来源表格和注释，比较不同期间的指标，生成图表，并使用管理员发布的 Excel、Word、PowerPoint 模板形成公司分析、估值模型和 Pitchbook。安全能力建立在 ChatGPT Enterprise 的 SAML SSO、SCIM、RBAC、传输和静态加密、工作区保留配置等基础上；官方还说明企业数据默认不用于训练模型，支持的工作区日志可通过 Compliance Platform 导出。产品目前面向符合条件的金融机构提供，不能假设所有企业账户都自动拥有相同数据与功能。

**对金融机构的含义：** OpenAI 已经把“模型 + 金融数据 + 引用 + 财务工作流 + Office 交付物”整合成产品。若自建项目的目标只是提供一个更好用的金融 ChatGPT，投入产出比会快速恶化。可以考虑把 ChatGPT for Financial Services 作为现成的分析师工作环境或试点工具，但仍需独立评估数据托管位置、现有订阅识别方式、许可范围、保留策略、工作区隔离和内部系统可集成程度。

### 1.3 专业金融研究产品：竞争壁垒来自数据、分析和工作流的组合

| 产品 | 公开产品定位与能力 | 对自建平台的启示 |
| --- | --- | --- |
| [Bloomberg AI / Terminal](https://professional.bloomberg.com/products/bloomberg-terminal/ai/) | 将 AI 放在 Bloomberg 自有市场数据、新闻、分析和 Terminal 工作流之上；Bloomberg Intelligence 提供公司、行业、政府、信用、诉讼和宏观研究。 | 其优势不只是聊天能力，而是金融数据覆盖、标准化、长期积累的专业内容以及已有用户工作流。不要试图复制一个完整 Bloomberg Terminal。 |
| [FactSet Intelligence](https://www.factset.com/ai) | 把 Connected Data、Advanced Analytics 和 Intelligent Workflows 作为统一 AI 栈；公开介绍 Agent-ready knowledge bases、投资组合分析、财富管理工作流以及通过 MCP 对外开放 Fundamentals、Estimates、Ownership、M&A、Pricing 等数据 API。 | 数据、分析和工作流必须一起设计。对外部模型开放结构化数据 API 是可采用的集成模式，而不是把所有数据复制到自有模型上下文。 |
| [AlphaSense](https://www.alpha-sense.com/solutions/generative-ai-industry-company-research/) | 以大量专业内容、公司和行业研究为基础，提供 Generative Search、Deep Research、片段级引用、跨文档综合，以及按公司和研究问题构建的 Generative Grid；可配置并定期运行工作流 Agent。 | 跨文档比较和持续研究任务，比单份文件摘要更接近真实研究工作的价值。内部研究内容也应成为一等内容源。 |
| [S&P Capital IQ Pro](https://www.spglobal.com/market-intelligence/en/solutions/products/sp-capital-iq-pro) | 以公司、财务、交易、市场数据和专业分析为基础，扩展 ChatIQ 及 Excel 辅助能力。 | 标准化基本面和数据定义是金融 AI 的底层资产，不能寄希望于 LLM 自行对齐不同公司的指标口径。 |
| [LSEG](https://www.lseg.com/) / Reuters 数据生态 | 提供市场数据、新闻、研究和分析内容，并与模型平台合作开放内容访问。 | 需要将内容许可、用户订阅 entitlement 和数据使用目的纳入接入架构，而不是仅实现一个通用连接器。 |

这些是各厂商公开材料所描述的能力，不是独立生产成熟度评估。产品页面能证明厂商公开支持某种能力，但不能单独证明不同机构部署后的准确率、可用性、总拥有成本或规模化效果。实际选型仍需要拿机构自己的任务、合同、数据和用户进行验证。

### 1.4 市场能力的分界线

现在可以把市场分成三层：

- **基础模型和通用工作助手：** Claude、OpenAI 等提供通用推理、文档处理、工具调用、工作流模板、Office 交互和模型升级能力。
- **金融内容和分析产品：** Bloomberg、FactSet、S&P、LSEG、AlphaSense、Morningstar、PitchBook、Daloopa 等提供专业数据、分析、内容或特定研究流程。
- **金融机构的内部研究与洞察产品：** 需要组织内部的数据、业务语义、研究历史、权限关系、投资方法、风险偏好、工作流程和决策结果。

前两层的供应商能力越来越强，第三层仍然需要金融机构自己定义。自建平台不需要取代每家供应商，而应把它们变成可替换的数据与模型能力，并在机构独有的上下文之上形成更完整的产品。

## 2. 自建平台的差异化应该是什么

### 2.1 保存机构自己的研究记忆，而不只是文档

内部研究库不能只是一个允许向量检索的 PDF 仓库。对机构而言，更有价值的是把研究材料转化为持续维护的研究对象：分析师对某家公司或发行人的观点、历史假设、关键驱动因素、估值方法、风险项、催化剂、观察指标、同业选择理由、管理层承诺、历史预测和后续实际结果。

例如，分析师在一次财报后更新了收入增长、毛利率和资本支出假设。系统应知道这不是一篇新文件而已，而是原有投资 Thesis 的一次变化：哪些假设发生变化，哪些原判断被支持或推翻，哪些模型输入需要更新，哪些投资组合受到影响，哪些后续事件值得观察。下一次财报发布时，系统要从之前的判断继续，而不是把所有材料重新总结一遍。

这需要一套可版本化的 Research Memory / Thesis Ledger。它可以从最小的关系模型开始，逐渐扩展为实体关系图；不应一开始就为了“Graph”而建设一个庞大的知识图谱项目。重点是让研究事实、分析师观点、待验证假设和未来可能性在数据层面有明确区别，并且能够追踪其创建人、来源、有效时间和变更历史。

### 2.2 建立时间点正确的金融事实

金融分析的一个根本问题是：在某个决策时点，研究人员究竟能知道什么？

一份年报可能在财务年度结束后数月才披露；后来发布的重述、补充文件、公司更名、行业分类变更或证券代码调整，都可能改变当前数据视图。回测或历史研究若直接读取今天的最新数据，就可能把未来信息带回过去。模型的预训练知识也可能泄漏已经发生的历史结果。

平台需要同时管理来源时间和业务时间，包括：

| 时间和版本字段 | 代表什么 | 为什么重要 |
| --- | --- | --- |
| Published / Released At | 来源公开或正式发布的时间 | 确定该信息何时能够被市场和分析师获得 |
| Observed / Ingested At | 平台实际接收到该数据的时间 | 判断系统当时是否已经拥有这条信息 |
| Effective / Valid Time | 数据在业务上生效的时间区间 | 处理评级、实体关系、指标定义或政策的历史变化 |
| Version / Supersedes | 原始文件或数据记录的版本及其替代关系 | 保留更正、重述和历史复盘能力 |
| As-of Time | 本次研究允许使用的信息截止时间 | 阻止模型、检索和计算读取未来数据 |

“最新值”与“在 2025 年 3 月 31 日当时可见的值”必须是两种不同查询。不能仅靠在 Prompt 中写“不要使用未来信息”来保证 Point-in-Time Correctness。数据服务和检索层应真正按时间过滤，测试集也应冻结当时可见的来源版本。

2026 年的 [Investor's Last Exam 预印本](https://arxiv.org/abs/2610.38342) 将这一问题放进了专业股票研究评测：其基准使用了 343 万份文档版本，并将任务评分关联到来源、计算和假设。论文报告，整体研究能力得分较高的系统，在 Forecast & Model 子项仍存在明显差距。这提醒我们，能够总结已经发生的事情，与在当时信息约束下形成可靠预测，是不同的能力。

### 2.3 把金融语义和计算放在平台，而不是交给模型临场猜测

平台需要建立自己的 Issuer / Legal Entity / Security / Instrument / Fund / Portfolio / Benchmark / Industry / Event 等实体关联，并维护证券标识、发行主体、上市地、币种、财务年度、报告期间、资产类别和同业集合。

金融指标也需要统一口径。Revenue、ARR、Net Interest Margin、Net Debt、Adjusted EBITDA、Free Cash Flow 等指标不应只有一个字符串名称。它们应绑定公式或定义、来源、币种、报告期间、GAAP / Non-GAAP 基础、合并范围、调整项、可比性状态及更新时间。不同供应商提供的同名指标不一定具有相同定义；即使同一公司也可能在不同报告中更改呈现方式。

LLM 适合帮助解释定义、发现潜在口径冲突和提出需要核查的项目，不应成为财务数字的权威计算器。比率、DCF、WACC、现金流折现、债务桥、收益率、FX 换算和组合敞口，应由确定性的 SQL / Python / 领域计算服务执行。模型可以选择分析方法、解释计算结果、提出情景，但必须使用经过验证的输入和公式版本。

这也意味着语义层不应与某个数据仓库绑定。可以在 Snowflake、PostgreSQL、数据目录或应用领域服务中实现不同部分，但对上层提供稳定的 Metric / Entity / Period 查询合同。仓库可以更换，业务语义不能跟着消失。

### 2.4 研究证据需要达到“主张级”，而不是“文档级”

一个报告末尾有十条参考链接，不代表其每个重要结论都有支持。一个数字出现在正确的文件中，也不代表其报告期间、币种、单位和计算口径正确。金融研究系统需要把输出拆成可以复核的 Claim，并将每条重要 Claim 绑定到实际证据和计算过程。

例如：

- 原始事实：某季度收入为某金额，来源是哪个版本的 10-Q、哪张表、哪一行。
- 标准化事实：系统将原始披露映射到哪个标准指标，使用什么币种和合并口径。
- 派生计算：同比增长率由哪两个值计算，使用哪个公式和舍入规则。
- 分析判断：收入增长放缓是否挑战原投资 Thesis，依赖哪些经营假设。
- 预测或建议：未来收入区间及其情景、概率、风险和假设是什么。

这些状态不能混成一个“AI 结论”。至少应支持 Verified、Partially Verified、Unverified、Conflicted、Not Applicable 等验证状态；对于缺少证据的结论，系统应允许明确返回“无法核实”，而不是强行补齐。

2026 年 11 月 3 日发布的 [LLM-Generated Investment Research Memos Need Validation 预印本](https://arxiv.org/abs/2611.04375) 给出了值得重视的实验结果：研究者生成 1,440 份投研备忘录，拆出 77,272 条金融陈述，并对照官方披露进行验证。各 Agent 的单条陈述被直接反驳比例约为 1.17%–1.77%，但约 36.94%–41.11% 的整份备忘录至少含有一条被反驳的陈述。错误类型包括时间、单位、上下文和概念。作者还强调，缺少证据和被证据直接反驳是不同状态。

这项研究是预印本，实验的公司、期间、Agent 和来源范围有限，不能直接代表所有机构的生产错误率。但其方法论很有参考价值：评估一份研究交付物时，不能只看平均 Claim Accuracy，还要看整份报告中是否至少存在一条关键错误、错误严重程度和人工复核成本。

### 2.5 让 Insight 连接到业务上下文和结果

同一个行业事件，对不同业务团队的意义可能完全不同。某公司公布资本开支上升，对股票研究人员可能意味着增长机会或 FCF 压力；对信用分析人员可能意味着杠杆和偿债能力变化；对组合经理则需要结合持仓规模、风险预算和投资 Thesis 判断优先级。

平台必须知道用户能看到哪些组合、账户、客户和研究内容，以及每项信息可以用于什么用途。Insight 的排序也应基于重要性，而不是简单按发布时间、热度或相似度排序。一个小的业务变化，如果挑战了核心投资假设，可能比市场上当天讨论很多的新闻更重要。

Insight 还要记录后续处理：谁查看了、是否确认、是否形成研究更新、是否触发风险审查、是否被忽略、后续实际结果如何。这样机构才会积累自己的反馈闭环，而不是只积累更多 AI 生成文本。

## 3. 产品形态：Research Workbench 与 Insight Hub

### 3.1 Research Workbench：研究人员主动探索和形成结论

Research Workbench 是研究人员的主工作台，适合支持公司、行业、宏观、信用、私募市场和组合研究。它应围绕研究对象和问题组织上下文，而不是把每次对话当作孤立会话。

一个典型的公司研究页面，应让分析师看到公司概况、结构化财务指标、重要披露、行业和同业关系、内部研究文档、历史 Thesis、分析师模型与当前关注事项。自然语言问题可以作为入口，但检索结果需要区分结构化数据、公开文件、授权的第三方内容和内部研究材料。

对“为什么本季度毛利率下降”这类问题，平台应先确定所指期间和指标口径，再找到相关披露、分部表格、管理层解释、同业变化和内部模型假设。模型负责将证据组织成分析，并指出支持和反对当前解释的事实。涉及具体金额、增长率或估值的部分，调用确定性计算服务。

Workbench 的主要输出是研究笔记、财报更新、行业比较、情景分析、估值模型输入和投资委员会材料草稿。文档生成应继承机构模板和规范，但不应以“自动生成 Word/PPT”作为平台唯一的完成标志。

### 3.2 Insight Hub：把重要变化送到应该处理的人面前

Insight Hub 面向组合经理、风险团队、研究主管、客户团队和管理层。用户不应每天重新问“今天有什么新闻”，而应看到与自己负责的组合、行业、发行人、风险约束和研究判断相关的变化。

一条有用的 Insight 至少要回答：发生了什么变化；与此前的基准相比哪里不同；为什么重要；它支持还是挑战哪条历史假设；有哪些相反证据；对哪些组合或业务范围可能产生影响；还有哪些信息未知；接下来由谁复核或采取行动。

这类 Insight 应作为持久化业务对象保存，不能只存在聊天记录中。一个简化的对象结构如下：

~~~json
{
  "insight_id": "INS-2026-000123",
  "subject": {
    "issuer_id": "ISSUER-001",
    "security_id": "SECURITY-001",
    "portfolio_ids": ["PORT-001"]
  },
  "as_of": "2026-11-11T16:00:00Z",
  "trigger": {
    "type": "earnings",
    "source_id": "DOC-2026-Q3-001"
  },
  "change": {
    "metric": "gross_margin",
    "value_before": "42.1%",
    "value_after": "39.8%",
    "basis": "reported quarterly, consolidated"
  },
  "thesis_delta": {
    "stance": "challenges",
    "explanation": "毛利率下降幅度超过原模型假设"
  },
  "evidence": [
    {
      "claim_id": "CLM-001",
      "source_version": "DOC-2026-Q3-001-v1",
      "page_or_cell": "p.18/table-6"
    }
  ],
  "counter_evidence": [],
  "assumptions": [],
  "status": "needs_review",
  "owner": "RESEARCH-TEAM-A"
}
~~~

示例中的值只是说明对象结构，不代表任何真实证券或组合。生产设计还需要增加来源时间、许可标签、实体映射版本、计算 ID、模型与 Prompt 版本、人工修订历史、审批决定、分发范围和审计事件。

Insight Hub 的差异化最终体现在三件事上：能够持续追踪重要变化；能够解释变化与机构自身研究和敞口的关系；能够推动合适的人在合适的工作流程中完成复核和后续处理。

### 3.3 不同金融机构应选择不同的首批产品场景

| 机构类型 | 优先研究对象 | 高价值 Insight | 建议的第一批场景 |
| --- | --- | --- | --- |
| 资产管理 / 公募 / 对冲基金 | 发行人、股票、债券、行业、组合与投资 Thesis | 财报变化、盈利预期偏差、投资假设失效、组合集中度与事件风险 | 覆盖公司财报分析与 Thesis 更新 |
| 券商 / 投资银行 | 公司、行业、交易、融资、客户与交易流程 | 交易事件、估值差异、客户机会、行业变化、尽调缺口 | 行业研究、客户会议准备、尽调材料分析 |
| 财富管理 | 客户、家庭资产、产品、组合与投资目标 | 组合偏离、客户风险暴露、产品或市场变化与客户目标的关系 | 顾问会前准备和投资组合解释 |
| 银行 / 信用机构 | 借款人、集团实体、授信、抵押品、行业和现金流 | 财务恶化、契约风险、评级迁移信号、负面事件与集中度 | 商业客户财报监控和信用审查材料准备 |
| 保险资管 | 发行人、债券、久期、负债匹配、偿付能力与风险限额 | 信用事件、利率和利差变化、资产负债匹配偏差 | 固收发行人监控与组合风险说明 |

同一套平台底座可以复用，但首个产品不能试图覆盖所有业务线。不同机构的核心数据、决策责任、许可范围和风险等级差异很大。应先选择一个高频、可验证、业务责任清楚的研究工作流，再扩展到更多资产类别和产品线。

## 4. 参考架构：把可信研究能力做成机构资产

### 4.1 数据与内容接入

数据接入层需要支持公开披露、监管文件、市场数据、宏观统计、第三方研究、财务基本面、新闻、内部投研文档、会议材料、组合数据和机构业务系统。每个来源都应登记授权主体、数据许可、用户范围、允许的处理方式、保留规则、更新时间、来源质量和访问接口。

数据接入不应一开始就复制所有供应商数据到企业自己的数据湖或向量库。对有严格许可限制的数据，优先通过供应商 API、MCP 或授权检索接口按需访问，并保留来源引用。确实需要缓存、索引或向量化时，应先确认合同是否允许这些处理以及缓存、派生内容和导出的边界。

对可留存内容，保存原始文档或允许的原始快照、版本、元数据和解析结果。解析后的段落和表格必须能指回原始文件的位置。扫描 PDF、复杂表格、图片和图表需要适当的文档理解与多模态处理，但抽取结果不能自动被视为权威财务事实。

### 4.2 可信数据基础层

核心数据层至少需要以下几个相互关联的能力：

- **实体与标识主数据：** 发行人、法律实体、证券、债券、基金、组合、客户、行业、基准以及它们的历史关系。
- **金融指标与期间语义：** 指标定义、公式、报告期间、财务年度、币种、单位、合并范围、会计口径、调整项及数据来源。
- **时间和版本管理：** 公布时间、接收时间、生效时间、来源版本、重述和替代关系，以及可复现的 As-of 查询。
- **研究与观点存储：** 研究笔记、投资 Thesis、模型假设、情景、风险、催化剂、历史预测、分析师修改与复核结果。
- **访问与许可元数据：** 数据源授权、用户 / Desk / 业务单元 entitlement、信息隔离策略和允许的下游用途。

这些内容可以由关系数据库、数据仓库、文档索引、搜索服务和图数据库共同实现。不要因为研究中存在实体关系就将所有内容强行放进图数据库；先保证主键、关系、版本、查询合同和变更历史可靠，再按多跳研究场景引入图能力。

### 4.3 多路检索，而不是单一向量 RAG

金融研究并非所有问题都需要向量检索。对明确的财务数字和期间，直接查询标准化指标或供应商 API 更可靠；对精确术语、条款编号、证券代码和披露用语，需要词法检索；对语义相似的研究主题，可以使用向量检索；对于跨公司、跨期间和实体关系问题，则可能需要知识图谱或显式关系查询。

建议建立统一的 Retrieval Broker，按问题类型和所需证据路由到不同检索方式。先做高召回的候选检索，再通过规则或重排提升相关性；但不能假定越多 Agent、越多重排阶段就越准确。每个检索阶段都需要被独立评测，并检查是否因为过滤过严漏掉关键反面证据。

[FinRAG-QA 预印本](https://arxiv.org/abs/2609.03654) 评估了跨银行年度报告和 Pillar 3 报告的金融问答，数据集包含 24 家银行的 209 份报告和 999 个问题。论文报告，针对文档语境增强的 chunk 与金融领域检索模型能提高检索质量；但在初始候选检索已经较强的设置下，Cross-Encoder 重排并不总能带来提升，甚至可能降低效果。该论文的模型实验主要使用 2024–2025 年可用模型，不能作为当前模型的直接性能结论。它更适合支持一个架构判断：检索链路要通过消融实验决定每个步骤是否有价值，而不是堆叠组件。

### 4.4 研究计算与证据服务

独立的 Financial Calculation Service 承担可重复计算，包括财务比率、增长率、估值、现金流、收益率、情景模型、FX 转换和组合敞口。输入数据、公式、参数和输出需要版本化。模型只能通过类型明确的工具调用这些服务，不能直接生成一串看似合理的数值然后被下游当作结果使用。

Claim & Evidence Service 负责维护每个重要主张与原始证据之间的关联。每条证据应带有来源 ID、版本、页码 / 表格 / 单元格 / 文本范围、来源许可、检索时间和授权上下文。派生数字还要关联计算 ID、输入值和公式版本。

对于每份研究交付物，系统应能显示哪些陈述已经核实，哪些仅部分支持，哪些来源冲突，哪些属于分析师判断，哪些是模型假设或预测。模型生成的置信度分数不能代替证据验证，也不能自动决定一份报告是否可对外发布。

### 4.5 Agent 与工作流运行层

Agent 运行层负责把检索、计算、分析和输出组织成可恢复的工作流。任务状态、步骤输入输出、模型选择、工具调用、人工审批和失败重试都需要被明确管理。

较稳定的金融流程应采用显式状态图：确定性节点负责校验输入、权限、期间、计算、状态转换和审计记录；LLM 节点负责理解问题、解释材料、形成假设、比较论据和草拟文本。只有在任务确实存在开放式探索、动态计划或多角色独立分析需求时，才让 Agent 自主规划更多步骤。

人工复核应是流程状态的一部分，而非最后页面上一个随意添加的按钮。被暂停的任务要能够保存状态、等待审批、恢复执行，并确保重复提交不会产生多次业务效果。对组合写入、客户沟通、正式研究发布、信用审批或交易指令等有影响的动作，LLM 不能直接绕过领域服务和权限检查。

### 4.6 应用层与系统集成

Workbench 和 Insight Hub 共享底层能力，但面向的工作方式不同。Workbench 以主动查询、研究对象、分析过程和文档产出为中心；Insight Hub 以事件、优先级、责任人、状态和处理结果为中心。

应用需要与现有研究管理、Portfolio Management、OMS、RMS、CRM、文档管理、邮件、数据仓库和办公工具集成。写回任何权威业务系统时，都应通过受控 API 和业务工作流执行，保留原始输入、审批、幂等键和执行回执。研究平台可以提供建议和草稿，但不能因为某个 Agent 生成了一个动作，就认为权威系统应接受它。

## 5. 什么应该自建，什么应该采购

### 5.1 自建的核心资产

| 能力 | 建议 | 原因 |
| --- | --- | --- |
| 内部研究记忆、Thesis Ledger、观点和假设历史 | 自建 | 这是机构知识和投资过程的独特积累，不应只存在于某家模型供应商的会话里。 |
| 实体主数据、金融指标语义和业务术语 | 自建或统一治理 | 必须符合机构自己的资产、组合、指标和报告口径，并能跨数据仓库和模型使用。 |
| Point-in-Time Evidence Store 和 Claim Ledger | 自建 | 需要保存历史可见性、来源版本、证据位置、计算链及研究输出版本。 |
| 数据授权、Entitlement、Information Barrier 和 Policy | 自建为权威边界 | 这些决定谁可以看到什么、数据能用于什么，以及结果能否被分发或执行，不能依赖 Prompt 或模型自觉遵守。 |
| 金融计算、估值方法和业务分析函数 | 自建 / 受控领域库 | 关键财务计算必须可重复、可测试、可回放。可复用成熟数值库，不必自己实现底层数学。 |
| Insight 生成规则、重要性排序和研究反馈闭环 | 自建 | 价值来自机构的组合上下文、风险偏好、研究假设和后续结果。 |
| 企业评测集、模型路由与发布门禁 | 自建治理 | 要按真实业务问题验证模型、检索和工作流，而不是只看厂商通用 Benchmark。 |
| 关键业务状态和审计记录 | 自建权威记录 | 研究审批、发布、客户沟通和业务动作需要机构自身能控制的留痕与回放。 |

### 5.2 应该采购或直接采用的能力

| 能力 | 建议采用的来源 | 自建边界 |
| --- | --- | --- |
| Frontier LLM | Claude、OpenAI，必要时其他合规供应商 | 维护统一模型接口、路由、评测、降级和合同约束，不训练一个通用大模型来重复供应商工作。 |
| 金融市场与专业内容 | Bloomberg、FactSet、S&P、LSEG、Morningstar、PitchBook、Daloopa、AlphaSense 等现有许可 | 做好数据目录、Entitlement、语义映射和按需调用；不复制无权存储或再分发的内容。 |
| 通用文档解析、搜索和存储 | 成熟 OCR / 文档解析、全文检索、向量数据库、关系数据库和对象存储 | 为金融表格、复杂披露和证据定位补充领域适配及评测。 |
| Agent 工作流框架 | LangGraph 或供应商 Agent Runtime | 工作流定义、业务状态、权限与审批契约由机构掌握。 |
| Trace 与评测平台 | LangSmith、OpenTelemetry 生态及企业监控工具 | 观测工具可以被替换；合规要求的权威记录和关键事件副本不能只存在第三方 SaaS。 |
| Office 与产出物生成 | Claude / ChatGPT Office 能力、机构模板和办公套件 API | 机构模板、发布权限、数据范围和最终文件的责任归属由内部治理。 |
| 身份与密钥管理 | 企业 IAM、Secrets Manager、KMS 等 | 身份、角色、工作负载和数据访问的权威判断由企业控制。 |

一个重要边界是：供应商提供金融数据并不代表平台获得了无限使用权。检索、索引、Embedding、缓存、摘要、派生数据、模型上下文、导出和分发，可能属于不同授权范围。接入评估必须把这些权利逐项问清楚。

## 6. Claude、OpenAI 和 LangChain 应该怎样分工

### 6.1 Claude：快速获得专业工作流和分析师体验

Claude 的金融插件适合用于验证业务流程、提升个人效率，以及把成熟的研究模板快速带入团队。可以先挑选 Earnings Reviewer、Market Researcher、Model Builder 或 Valuation Reviewer 等与业务匹配的模板，再替换为机构自己的数据连接器、模型方法和报告模板。

如果机构希望将任务嵌入内部系统，需要区分 Cowork / Claude Code 插件与 API / Managed Agent 方式的运行边界。桌面插件适合与分析师现有 Excel、PowerPoint 等工作方式协同；服务端长任务、批量流程和统一运营则需要经过正式的 Agent Runtime、权限和审计设计。两种方式不是同一个部署形态。

建议把 Claude 用作模型能力和研究工作流的一种实现，不要让 Claude Skill 文件变成平台的唯一业务定义。Skill 可以携带任务说明、步骤和输出标准，但金融指标口径、数据许可、工作流状态、权限策略和审计事件必须由内部服务定义。

### 6.2 OpenAI：利用现成金融产品，也保留 API 嵌入路径

ChatGPT for Financial Services 可以作为研究团队的现成工作环境进行评估，尤其适合需要快速获得金融数据、引用、分析和 Office 文档产出能力的团队。它的设计合作伙伴包括 Morgan Stanley 和 Evercore，说明产品从投行和股票研究工作流切入；OpenAI 也明确表示后续会继续扩展其他金融服务类别。

对平台团队而言，OpenAI API 更适合将模型推理、工具调用和结构化结果嵌入机构自己的 Workbench 或 Insight Hub。此时仍要通过内部服务提供授权后的上下文和工具，避免用户绕开企业数据边界直接查询不该访问的内容。

ChatGPT Financial Services 内建数据的索引和托管安排，可能与企业已有供应商合同、地区要求、许可限制和内部保留制度产生不同影响。采购前应确认具体数据源、用户 entitlement 识别方式、内容使用权、数据所在位置、日志保留、信息隔离、删除和退出机制。不能仅凭“Enterprise”或“金融服务”产品名称推断所有机构控制要求都已满足。

### 6.3 LangChain / LangGraph：用于自有工作流运行时，而不是金融数据产品

[LangGraph](https://docs.langchain.com/oss/python/langgraph/overview) 是用于构建长时间、有状态 Agent 工作流的低层运行时，提供图状态、持久化、流式执行和 Human-in-the-loop 能力。其 [Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) 可以暂停执行、持久化状态，等待人工输入后再继续运行。LangChain 官方将 LangGraph 定位为 Agent 编排运行时，将 [LangSmith](https://docs.langchain.com/langsmith/observability) 定位为跨框架的 Trace、评测、Prompt 和部署平台。

适合使用 LangGraph 的情况是：机构需要拥有工作流代码和状态控制，希望在一个流程中组合确定性计算、企业内部工具、Claude / OpenAI 模型、人工审批和异常恢复，并且有团队愿意承担运行时的维护、升级和故障处理。

不应把 LangGraph 当作金融领域语义、数据授权或合规状态系统，也不应因为使用了 LangSmith 就认为拥有完整的监管审计记录。生产平台需要把关键流程事件、输入输出、数据版本、模型版本、工具结果、权限判定和审批动作写入机构控制的权威存储。LangSmith 可以用作可观测和评测工具，但必须明确其数据处理合同、部署方式和日志保留边界。

### 6.4 不要先建一个多 Agent 大系统

研究任务经常被设计成 Researcher、Analyst、Risk Agent、Reviewer、Writer 等多个 Agent 相互对话。角色划分容易理解，但多 Agent 不一定能提高结果质量；如果各 Agent 共享同一批错误证据，或在串行过滤中提前丢掉关键材料，增加角色只会放大错误传播、延迟和成本。

[PRISM 金融检索预印本](https://arxiv.org/abs/2511.14130) 对金融文档检索配置的实验显示，复杂多 Agent 排序链存在过度过滤和级联错误的风险，较简单的配置在其测试中能够达到相当甚至更好的表现。其对照设计也存在配置不完全对称等限制，因此不能据此断言单 Agent 在所有任务中都更好；它足以说明“多 Agent 必然更强”没有证据支持。

建议先实现可观察的状态图和明确的节点合同。遇到确实需要不同知识或独立观点的任务，再增加专项 Agent，并用相同数据、同一评测集和相同预算进行消融比较。

## 7. 安全、治理与监管边界

### 7.1 先判断业务用途，再决定控制强度

金融研究平台可能只做内部资料搜索，也可能进一步生成投资建议、信用意见、客户材料或交易指令。不同用途的影响和风险并不相同。将 AI 用于内部信息检索，不意味着后续将输出转给客户、用于投资决策或自动执行时仍然属于同一风险等级。

美国 FINRA 在 [2026 Annual Regulatory Oversight Report 的 GenAI 专章](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai) 明确指出，技术中立的 FINRA 规则和证券法律在采用 GenAI 时仍然适用，并提到监督、通信、记录保存和公平交易等义务。FINRA 观察到的主要使用场景包括摘要和信息提取，也建议机构建立监督和治理流程，开展准确性、隐私、安全和偏见测试，并持续监控模型、Prompt、输出和版本。

美国银行监管机构在 2026 年 4 月 17 日发布了修订后的模型风险管理指导，见 [Federal Reserve SR 26-2](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm) 和 [OCC Bulletin 2026-13](https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-13.html)。新指导取代了 2011 年 SR 11-7 等旧指导，强调结合机构规模、复杂度、模型风险和实际使用方式实行风险导向的模型风险管理。不能继续把 SR 11-7 当作当前唯一有效的指导文本，也不能推断所有 LLM 检索问答都自动等同于传统意义上的量化模型；应按实际用途和决策影响进行适用性判断。

新加坡 MAS 在 2026 年 10 月 7 日发布 [金融机构 AI 风险管理指引](https://www.mas.gov.sg/regulation/guidelines/guidelines-on-artificial-intelligence-risk-management-for-financial-institutions)，适用于金融机构使用的各种 AI 技术，并允许机构根据风险规模和业务复杂度配置治理方式。英国 FCA 也发布了 [AI in financial services: good practice and areas for improvement](https://www.fca.org.uk/publications/good-poor-practice/ai-financial-services)，强调既有监管规则仍适用于机构使用 AI 的活动。以上文件在司法辖区、法律性质和适用对象上不同，跨国机构不能用一套通用“AI 合规检查表”替代本地法律和监管分析。

### 7.2 权限边界不能只靠 Prompt、Skill 或 MCP

检索和工具访问前必须执行真实的用户身份、业务角色、数据来源许可和信息隔离检查。RAG 不能把用户没有权利访问的文件带进模型上下文；Agent 不能通过换一种工具、调用另一个 MCP 或让子 Agent 查询而绕开权限。

建议将授权放在内部 Retrieval / Tool Gateway 及领域服务中执行，并在数据返回时保留访问决策和授权上下文。工具清单中的某个 MCP Server 可以被注册、审核和限权，但 MCP 只是连接和调用协议，不是自动成立的安全边界。

对投行、研究、资产管理、财富和客户团队，应按业务需要设计 Information Barrier。材料从内部检索进入模型上下文后，生成结果的可见范围和可分发范围仍需受控，不能因为模型已经看过材料，就将其视为可以对所有员工或客户开放。

### 7.3 记录一次研究运行所需的证据

一份可审计的研究结果，应能够还原本次任务的用户身份与角色、任务目的、As-of 时间、检索数据版本、数据授权判定、原文证据位置、结构化查询和计算输入输出、Prompt 与模型版本、工具调用、生成结果、人工修改、审核人、审批决定和后续分发范围。

普通 Trace 是排障和质量分析的起点，不等于完整审计证据。日志可能缺字段、被采样、过期或允许修改；如果需要把某些事件作为业务记录，应将其写入机构管理的持久化、访问受控、具备保留与防篡改策略的存储。平台应明确哪些属于观测数据，哪些属于法定或内部正式记录。

### 7.4 高风险动作必须脱离 LLM 自主控制

平台可以自动发现事件、准备材料、生成研究草稿和提出工作建议。是否允许直接发布客户研究、发送投资建议、执行组合交易、调整信用额度或完成审批，应由具体业务规则、授权、独立验证和人工决策共同决定。模型输出不能作为权限依据，模型的“自信”也不能替代风险审批。

## 8. 建设路线图：先形成一个可用的研究闭环，再扩展平台

建议按 12–18 个月分阶段推进。时间是规划窗口，不是供应商交付承诺；实际周期取决于数据许可、内部研究数据质量、遗留系统接口和业务团队投入。

| 阶段 | 目标 | 关键交付 | 放行条件 |
| --- | --- | --- | --- |
| 0：发现与基线（0–6 周） | 确定业务价值、数据边界和可验证任务 | 选定一个业务团队与覆盖范围；整理数据源、许可和用户 entitlement；访谈研究人员；建立 50–100 个真实任务的评测集；记录现有耗时和错误类型 | 明确业务 Owner、数据 Owner、风险 Owner；用例许可与权限可行；评测任务能够复现 |
| 1：Research Workbench MVP（6–12 周） | 完成从问题到证据支持的研究 | 接入一组公开披露和已授权金融数据；支持结构化查询、全文 / 词法 / 向量检索；提供来源定位、As-of 时间和确定性计算；输出研究草稿 | 关键事实能回到原始证据；指标期间、币种、单位和会计口径经过测试；未授权数据无法进入检索结果 |
| 2：Research Memory（3–6 个月） | 让系统理解机构此前研究和分析假设 | 公司 / 发行人研究主页；Thesis Ledger；分析师笔记和假设版本；财报更新流程；模型变更建议和审阅记录 | 能回答“与上次研究相比变化了什么”；历史判断与最新观点不覆盖丢失；人工修订可回放 |
| 3：Insight Hub（6–9 个月） | 把研究变化推送给相关角色 | Watchlist / Portfolio 关联；事件识别；重要性和 Thesis Delta；Insight 对象；责任人、状态、反馈和审计 | 告警误报率、漏报率和优先级获得业务认可；每条重要 Insight 有证据和处理路径；角色隔离有效 |
| 4：跨业务扩展（9–18 个月） | 扩展资产类别、团队和端到端工作流 | 信用、私募、财富或投行工作流；组合风险分析；自动生成机构模板材料；更多数据源和领域 Agent；受控业务系统写回 | 每个新增场景重新完成风险分类、许可核验和评测；关键动作经领域授权和审批；运行成本和服务质量满足业务要求 |

### 8.1 首个试点应该选什么

对于资产管理或研究机构，建议从一个固定覆盖范围内的上市公司财报分析与 Thesis 更新开始。这个流程高频、材料有较明确的来源、结构化财务数据和文本披露同时存在，也能看到研究结论是否随时间变化。它适合检验文件解析、检索、指标口径、来源定位、历史假设和分析师复核的完整链路。

建议先选 1–2 个行业、30–100 家发行人作为受控范围。数字是试点规划的建议起点，不代表行业标准或成熟度要求；应依据团队覆盖情况和数据授权调整。先让分析师使用研究助手，结果只用于内部研究，不自动向客户发布、不直接进入交易执行，也不承担信用审批等高影响决策。若机构主要业务是商业银行、财富或保险，则应把试点换成该机构中同等高频、可验证、责任边界明确的研究场景。

### 8.2 每个阶段应该怎样衡量

不要用 Prompt 数、Token 数或 Agent 数量衡量产品价值。平台的指标应同时覆盖正确性、研究效率、用户行为、业务影响和运营成本。

**证据与数据质量：** 关键事实的来源覆盖率、来源定位准确率、引用与主张的一致性、数据期间 / 单位 / 币种 / 会计口径错误率、冲突发现率、未知状态处理率，以及历史 As-of 回放正确性。

**研究质量：** Claim 级 Verified / Partially Verified / Unverified / Refuted 分布；整份备忘录至少存在一条重大反驳的比例；关键结论的反面证据覆盖；估值输入和公式校验；分析师对 Thesis 变化的采纳、修改或拒绝情况。

**工作效率：** 从研究问题到可复核草稿的时间、分析师实际修改时长、重复研究时间、每份研究材料的成本，以及因证据不足而返工的次数。

**Insight 质量：** Precision、Recall、误报 / 漏报、重要事件到达用户的延迟、用户确认率、进入后续工作流的比例、不同角色的相关性，以及 Insight 是否改善了既有研究过程。告警量大不等于洞察价值高。

**平台运营：** 单次研究成本、检索与模型延迟、失败恢复率、模型 / Prompt / 数据源变更后的回归结果、权限拒绝与异常访问、第三方数据调用成本及许可问题。

所有业务目标应在试点开始时依据当前基线和风险偏好设定。对于高影响研究材料，关键事实有明确来源并可复核应作为设计门槛；但不应在没有基线、没有标注数据的情况下，随意承诺一个看似精确的准确率或节省时间比例。

## 9. 评测体系：模型、检索和工作流必须一起评估

### 9.1 不要只比较模型排行榜

[AgenticFinBench](https://arxiv.org/abs/2611.04813) 是 2026 年 11 月发布的金融 Agent 预印本，覆盖 230 个真实请求任务、8 个类别、两种语言和四个复杂度等级，并比较 18 种模型与 Agent Harness 配置。论文报告，仅评估任务完成度而不审计事实，可能高估系统表现；在其测试中，Harness 对证据落地差异的影响高于模型差异（28.6% 对 8.8%），而复杂任务的质量分也低于直接检索任务。

这项结果并不意味着 Harness 在所有情况下都比模型重要，任务集合也不是生产流量的随机样本。它支持一个更实用的评估原则：应比较完整的模型、Prompt、工具、检索、状态管理和验证组合，而不应只比较 Claude 与 GPT 的单次问答。

### 9.2 企业自己的金融评测集应覆盖这些任务

| 任务族 | 代表性问题 | 必须验证的内容 |
| --- | --- | --- |
| 基础事实查询 | 某公司最近一季收入和负债是多少？ | 来源、版本、报告期间、单位、币种、合并范围 |
| 数值与公式分析 | 毛利率、净负债、FCF 和同比增长如何变化？ | 输入值、公式、舍入、口径一致性 |
| 跨文件研究 | 管理层说法与财报脚注、投资者演示是否一致？ | 跨文档引用、冲突发现、来源可信度 |
| 跨期比较 | 相比过去 3 年，该公司的利润率是否改善？ | 历史版本、财年对齐、重述和结构变化 |
| 同业分析 | 公司 A 与 B 的资本回报率和杠杆谁更好？ | 同期、同口径、同单位、可比性限制 |
| 事件因果分析 | 某次监管变化可能通过什么路径影响利润？ | 事实与假设区分、因果链证据、反面解释 |
| 投资 Thesis 更新 | 新披露是否挑战上一次投资假设？ | 历史研究关联、假设变更和证据完整性 |
| 组合影响 | 某个事件影响哪些组合与风险敞口？ | 用户和组合 entitlement、敞口计算、信息隔离 |
| 研究报告验证 | 一份投研备忘录中哪些陈述缺证、冲突或被反驳？ | Claim 级和 Memo 级质量、错误严重度 |
| Point-in-Time 回放 | 在历史日期当时可获得哪些资料？ | 来源时间、数据版本、模型预训练记忆污染风险 |

### 9.3 模型选型需要按任务建立 Pareto Frontier

同一个模型未必在表格理解、长文综合、精确引用、复杂数值任务和成本方面都占优。建议对 Claude、OpenAI 及候选模型使用相同的题目、相同的证据包、相同的工具和相同的输出契约，分别测量：

- 正确性：事实、数值、口径、计算和分析结论是否成立。
- 证据：引用是否能支持主张，是否遗漏关键反面证据。
- 稳定性：重复执行、模型升级和 Prompt 变更后的结果变化。
- 运行成本：Token、数据调用、重试、人工复核和计算资源。
- 时效：查询、研究、审批和生成材料所需的端到端时间。
- 安全：越权读取、Prompt Injection、跨团队泄漏、恶意文档和错误工具调用。

每个模型都要有实际任务分布下的能力配置，而不是一个笼统的“最强模型”标签。模型版本升级时，应运行企业基准集回归测试；当某家供应商的质量或成本不再满足要求时，应能调整路由而不重写业务逻辑。

## 10. 主要架构决策和不建议做的事

**不要建设一个通用 Bloomberg 替代品。** 市场数据覆盖、新闻分发、标准化指标和专业内容是长期积累的产品能力，自建平台更应该利用已有供应商，把差异化放在机构自己的研究上下文和业务流程。

**不要把金融 Skill 当作平台本身。** Skill 是模型可执行的任务说明和工作规范。业务语义、数据许可、访问控制、权威状态和审计不能只靠一组 Markdown 文件。

**不要将 LLM 作为权威财务计算器。** 金融计算需要输入、公式、期间和单位的确定性校验。模型负责选取和解释计算过程，不负责凭自然语言生成权威数字。

**不要把 RAG 等同于正确。** 检索到相关段落只是开始；还要验证是否来自正确期间和版本、是否能支持完整主张、是否存在反面证据，以及结构化数值是否与来源一致。

**不要在第一阶段引入大量多 Agent。** 应先用单一或少数模型调用、确定性工作流和独立校验建立基线。多 Agent 只有在对照评测证明质量增益大于错误传播、运行成本和维护复杂度时才值得引入。

**不要将 Trace 视为审计系统。** 可观测平台适合开发、调试和质量评估；业务责任、版本化记录和审计事件必须由机构自己确定权威存储和保留规则。

**不要用“人类在环”作为抽象口号。** 每个复核节点要定义触发条件、审批角色、允许修改范围、拒绝后的状态、恢复方式和最终责任人。否则审批按钮并不能提供有效控制。

## 11. 推荐的目标状态

目标产品不是让分析师把所有问题都交给某一个模型，而是让机构拥有一个统一、可信、可替换的金融研究能力层。

分析师可以通过 Workbench 研究任何被授权的公司、行业或资产；系统能够组合公开披露、专业金融数据和内部研究记忆，明确区分事实、计算、判断和假设。研究结论可以更新到 Thesis Ledger，历史版本仍可回放。市场事件、公司披露和组合变化会触发 Insight Hub，按角色、敞口和研究重要性推送给需要处理的人。洞察在被确认、修改、拒绝或转入工作流后，留下可验证的过程和结果。

Claude 和 OpenAI 提供模型能力、部分金融工作流、数据连接和办公产品；金融数据供应商提供专业内容和分析接口；LangGraph 等框架可以承担自有工作流运行时。企业持续掌握的则是实体与指标语义、内部研究记忆、时间点证据、计算规则、数据授权、研究与审批状态、洞察分发和反馈数据。

如果这些内部资产没有形成，平台只是把供应商的聊天能力包一层 UI；如果这些资产建立起来，模型供应商可以持续替换，研究流程也不会随某一家模型的升级、降价或产品改版而失去连续性。

---

## 参考资料

### 官方产品与工程文档

1. Anthropic, [Claude for Financial Services](https://www.anthropic.com/news/claude-for-financial-services)。
2. Anthropic, [Agents for Financial Services](https://www.anthropic.com/news/finance-agents)。
3. Anthropic, [Financial Services Plugins and Skills](https://github.com/anthropics/financial-services)。
4. OpenAI, [Introducing ChatGPT for Financial Services](https://openai.com/index/introducing-chatgpt-financial-services/), 2026-09-10。
5. Bloomberg, [Bloomberg AI](https://professional.bloomberg.com/products/bloomberg-terminal/ai/)。
6. FactSet, [FactSet Intelligence / AI Solutions](https://www.factset.com/ai)。
7. AlphaSense, [Generative AI for Industry and Company Research](https://www.alpha-sense.com/solutions/generative-ai-industry-company-research/)。
8. S&P Global, [Capital IQ Pro](https://www.spglobal.com/market-intelligence/en/solutions/products/sp-capital-iq-pro)。
9. LangChain, [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)。
10. LangChain, [LangGraph Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)。
11. LangChain, [LangSmith Observability](https://docs.langchain.com/langsmith/observability)。

### 监管与指导材料

12. FINRA, [2026 Annual Regulatory Oversight Report: GenAI](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai)。
13. Federal Reserve, [SR 26-2: Revised Guidance on Model Risk Management](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm), 2026-04-17。
14. OCC, [Bulletin 2026-13: Model Risk Management—Revised Guidance](https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-13.html), 2026-04-17。
15. MAS, [Guidelines on Artificial Intelligence Risk Management for Financial Institutions](https://www.mas.gov.sg/regulation/guidelines/guidelines-on-artificial-intelligence-risk-management-for-financial-institutions), 2026-10-07。
16. FCA, [AI in financial services: good practice and areas for improvement](https://www.fca.org.uk/publications/good-poor-practice/ai-financial-services)。

### 最新研究（预印本，研究结论应结合论文范围解读）

17. [AgenticFinBench: Benchmarking Financial Agents on Diverse Tasks from Real-World Requests](https://arxiv.org/abs/2611.04813), 2026-11。
18. [LLM-Generated Investment Research Memos Need Validation](https://arxiv.org/abs/2611.04375), 2026-11-03。
19. [Investor's Last Exam: Can AI Agents Do Equity Investment Without Seeing the Future?](https://arxiv.org/abs/2610.38342), 2026-10。
20. [Enhancing Financial Question Answering: A Novel Benchmark Dataset of Banks' Financial Statements](https://arxiv.org/abs/2609.03654), 2026-09。
21. [PRISM: Prompt-Refined In-Context System Modelling for Financial Retrieval](https://arxiv.org/abs/2511.14130)。
22. [FinReflectKG / MultiHop: Financial QA Benchmark for Reasoning with Knowledge Graph Evidence](https://arxiv.org/abs/2510.02906)。

**研究限制：** 厂商网页主要用于确认公开产品能力和供应商自述，不用于证明跨机构的实际效果；厂商发布的 Benchmark 使用不同任务集和评分方法，不能直接横向排名。以上 2026 年最新学术资料多数为预印本，样本范围、评测者、数据来源和实验模型均有限，适合作为架构设计和企业评测集的参考，不应直接作为生产性能承诺。
