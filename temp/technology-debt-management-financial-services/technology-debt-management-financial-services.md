# 金融服务企业的 Technology Debt Management：从 EOL 清单到企业级技术债治理

**研究基准日：2026 年 11 月 11 日**  
**适用读者：** 金融服务企业 CIO / CTO、Enterprise Architecture、Technology Risk、IT Portfolio、平台工程与基础设施管理团队

## 摘要

金融机构通常已经有 EOL 台账、漏洞清单、架构例外、项目 backlog 和 CMDB，却很难回答一个更重要的问题：企业究竟承担了多少由历史技术决策累积而来的风险与未来成本？某个系统继续运行在停止支持的数据库上，某个平台依赖一段长期 workaround，某个业务域重复建设了非战略技术，或者一个架构例外被批准后多年没有重新评估。这些事项分散在不同系统里，责任人、风险接受、资金安排和退出计划也不在同一条治理链上。

这类问题适合用 **Enterprise Technology Debt Management** 描述。它比传统软件工程中的 Technical Debt 更宽，管理对象包括应用、平台、基础设施、数据、集成、供应商依赖和运营流程。债务本身并不等于缺陷，也不意味着必须立即偿还；它表示企业当前选择继续承受某种技术约束，并因此承担可识别的风险、成本或战略机会损失。治理的目标是让这些代价可见、可比较、有人负责，并且在接受风险时设置有效期限和复审条件。

监管材料已经明确描述了其中的主要风险。美国 OCC 在 2023 年的 Semiannual Risk Perspective 中讨论了银行的技术基础设施投资，指出老旧技术、EOL 系统、复杂架构和缺乏清晰技术战略会导致长期使用遗留系统；并明确提到系统升级延期会增加 tech debt，合并银行简单拼接系统产生的 workaround 和人工流程也会累积债务。加拿大 OSFI 的 Guideline B-13 要求受监管机构维护技术资产清单、记录关键资产依赖、持续评估技术货币状态，并管理偏离和例外。欧盟 DORA 则定义了 legacy ICT systems，并要求金融实体识别、分类和记录 ICT 资产及其依赖，对遗留系统定期进行专项风险评估。需要准确区分的是：这些监管文件要求的是资产、生命周期、风险、例外和韧性管理，并没有普遍规定企业必须购买名为 Technology Debt Management 的产品或建立一个同名台账。

产品方面，SAP LeanIX、Ardoq、ServiceNow Enterprise Architecture / Technology Portfolio Management 和 OrbusInfinity 已经提供了不同程度的技术生命周期、应用依赖或债务治理能力。CAST Highlight 更偏向从应用代码与软件组合中分析技术债，不应被当成企业级债务治理系统。开源候选中，Turbo EA、Essential Project 和 iTop 的定位差异很大：前两者偏企业架构建模，iTop 偏 CMDB / ITSM；它们都不能在没有扩展的情况下被视为完整的金融机构技术债治理产品。

本文建议把债务记录建成独立的治理对象，关联资产、业务能力、风险、架构决策、例外批准和 remediation initiative。已有 CMDB、EA、ITSM 或 GRC 平台时，应优先复用其权威数据，而不是再造一份资产目录。PoC 的重点也不应是 Dashboard 是否漂亮，而应验证依赖关系是否可信、例外是否可追溯、风险接受是否有到期机制，以及债务能否进入实际预算和交付流程。

## 1. 这里所说的 Technology Debt 是什么

传统 Technical Debt 常从软件设计和代码质量出发，描述为了短期交付而采用某种实现方式，未来需要付出额外修改成本。这个概念对于代码层面的可维护性问题很有用，但企业 IT 的债务远不止代码。

金融机构中常见的情形包括：应用仍运行在厂商已停止支持的操作系统或数据库版本上；平台采用了企业架构标准之外的产品，且没有退出路线；由于上游系统限制，团队长期维护人工文件交换或定制脚本；某个关键服务依赖少数员工掌握的操作步骤；系统合并后保留了多套重复平台；云服务采用了难以迁移的专有能力，却没有经过充分评估的退出策略。这些问题可能没有直接的软件缺陷，却会增加故障概率、维护成本、审计难度、变更风险和未来迁移成本。

可以把 Technology Debt 定义为：

> 企业因历史技术选择、架构约束、生命周期滞后或临时运营安排，持续承担额外成本、风险或战略限制，并且需要通过明确决策进行接受、缓解、偿还或退出的技术负债。

这个定义有两个边界。第一，债务不等于所有技术风险。一个正常支持、符合标准且有合理商业理由的技术选择，不应仅仅因为它不是最新技术就被登记为债务。第二，债务不等于必须立即整改。某个老旧核心系统可能暂时无法替换，但只要风险被识别、接受权限正确、补偿控制有效、退出路径可信，就可以被治理；真正的问题是企业是否在不知情或无授权的情况下长期承受风险。

### 1.1 债务分类

| 类别 | 典型情况 | 需要回答的问题 |
|---|---|---|
| Technology Obsolescence | EOL / EOS 操作系统、数据库、中间件、硬件或云服务版本 | 厂商支持何时结束？延长支持是否真实可用？ |
| Architecture Debt | 违反目标架构、重复平台、紧耦合、缺少分层或边界 | 当前设计对变更、扩展和韧性造成什么限制？ |
| Strategic Misalignment | 使用非战略技术、绕过标准采购或建立重复技术栈 | 为什么偏离标准？是否仍有业务理由？ |
| Workaround / Operational Debt | 人工操作、临时脚本、特殊批处理、手工对账和例外运维 | 是否存在单点人员依赖、控制绕过或不可重复流程？ |
| Integration Debt | 点对点接口、旧协议、重复转换、缺少契约治理 | 上游或下游变化时，影响范围和变更成本有多大？ |
| Data Debt | 重复数据、数据定义冲突、脆弱的数据同步、缺乏 lineage | 数据错误如何传播到业务和监管报告？ |
| Security Debt | 无法修补的组件、过时加密、缺少安全能力或长期漏洞例外 | 是否存在有效补偿控制？风险是否超过容忍度？ |
| Vendor / Dependency Debt | 供应商锁定、无人维护组件、支持能力下降、第三方集中度 | 是否有可执行的替代和退出方案？ |

分类用于分析，不应变成互斥的标签集合。同一事项可以有一个主类别和多个影响维度。例如，一个停止支持的数据库可能同时造成安全债务、架构债务和供应商依赖风险。记录时应避免把同一根因拆成多条独立债务，导致组合报表重复计数。

### 1.2 Workaround 何时应登记为债务

Workaround 并非天然有问题。临时人工步骤可能是合理的业务连续性控制，也可能是系统上线期间的短期过渡。是否登记为债务，取决于它是否形成了持续性负担：是否长期存在、是否偏离目标架构或控制基线、是否依赖人工记忆、是否增加故障或操作风险、是否缺少责任人和退出条件。

例如，每日由运营人员从系统 A 导出文件、手工修改字段后导入系统 B。如果这是经批准、可追踪、带双人复核且有明确退役日期的临时安排，它属于受控过渡方案。如果持续多年，操作人员轮换后流程无法稳定执行，且没有自动化计划，就应作为 Operational / Integration Debt 登记。登记的重点不是“人工”二字，而是由该安排产生的风险和未来成本。

## 2. 监管背景：要求管理风险，不是要求购买某个债务产品

### 2.1 美国：OCC 与 FFIEC

OCC 的 *Semiannual Risk Perspective – Spring 2023* 专门讨论了银行技术基础设施投资。文件指出，老旧技术和 EOL 系统可能因为升级成本、复杂架构或缺乏清晰技术战略而持续运行，增加运营中断、安全漏洞和维护困难；升级延期会增加 tech debt。OCC 还举出并购后简单拼接系统、增加 workaround 和人工流程的情况。这份材料是监管机构对行业风险的观察，不是一个要求银行按某种固定模型建立债务登记系统的法规。

来源：[OCC Semiannual Risk Perspective, Spring 2023（PDF）](https://www.occ.treas.gov/publications-and-resources/publications/semiannual-risk-perspective/files/pub-semiannual-risk-perspective-spring-2023.pdf)

FFIEC 的 IT Examination Handbook 进一步提供了生命周期管理的检查视角。其 Information Security booklet 的 End-of-Life Management 部分要求管理层规划系统生命周期及 EOL 的安全和业务影响，维护系统和应用清单，跟踪厂商支持状态，对接近淘汰的系统进行风险评估，并规划替换。若 EOL 系统必须继续运行，应采用补偿控制并制定替换计划。该材料发布于 2016 年，使用时应同时核对 FFIEC 当前 Handbook 的版本与后续更新；FFIEC 在 2021 年发布 Architecture, Infrastructure, and Operations booklet，并于 2024 年更新 Development, Acquisition, and Maintenance booklet。

来源：[FFIEC IT Examination Handbook – Information Security（EOL Management）](https://www.ffiec.gov/press/PDF/FFIEC_IT_Handbook_Information_Security_Booklet.pdf)；[FFIEC 2021 Architecture, Infrastructure, and Operations 更新说明](https://www.ffiec.gov/news/press-releases/2021/pr-06-30)；[FFIEC 2024 Development, Acquisition, and Maintenance 更新说明](https://www.ffiec.gov/news/press-releases/2024/pr-09-29)

### 2.2 加拿大：OSFI Guideline B-13

OSFI 于 2022 年发布 Guideline B-13，适用于其监管范围内的联邦金融机构。B-13 要求机构建立技术与网络风险管理框架，明确风险偏好、风险分类、责任、监控和例外管理流程。其 Principle 5 要求维护支持业务流程的技术资产清单，记录资产分类和关键依赖，安全处置生命周期结束的资产，并持续评估技术货币状态；对未打补丁、过时或不受支持资产，应主动规划缓解措施，并在厂商维护停止前替换或升级。

B-13 的适用性应按机构监管身份和业务范围判断，不能把加拿大监管指引直接描述为美国银行的法律义务。对跨境集团而言，它仍然是建立统一技术风险控制模型的重要参考。

来源：[OSFI Guideline B-13 – Technology and Cyber Risk Management](https://www.osfi-bsif.gc.ca/en/guidance/guidance-library/technology-cyber-risk-management)

### 2.3 欧盟：DORA 对 Legacy ICT Systems 的明确要求

DORA（Regulation (EU) 2022/2554）自 2025 年 1 月 17 日起适用。它把 legacy ICT system 定义为已经达到生命周期终点、因技术或商业原因无法升级或修复，或供应商不再支持，但仍在金融实体中使用并支持业务功能的 ICT 系统。

DORA Article 8 要求金融实体识别、分类并记录 ICT 支持的业务功能、信息资产和 ICT 资产及其依赖；对资产和依赖关系的分类及相关文档至少每年审查。Article 8 还要求持续识别 ICT 风险来源。DORA 的相关条款进一步要求非微型企业定期、至少每年对所有 legacy ICT systems 进行专项 ICT 风险评估，并在连接技术、应用或系统之前及之后进行评估。

这比泛泛地“关注老旧系统”更具体：遗留系统需要有可识别的资产记录、业务关联、依赖关系和风险评估证据。它并不规定必须采用某个厂商的 debt register，也不意味着只要建立债务台账就自动符合 DORA。

来源：[Regulation (EU) 2022/2554 – DORA，EUR-Lex](https://eur-lex.europa.eu/eli/reg/2022/2554/oj?uri=CELEX%3A32022R2554)

### 2.4 第三方与云服务依赖

技术债务也可能来自供应商关系：旧平台依赖某个供应商的专有接口、厂商支持能力下降、合同终止后无法迁移，或者关键服务缺乏经过测试的退出路径。OSFI 的 Third-Party Risk Management Guideline 要求风险管理覆盖第三方安排的整个生命周期，从采购和尽调到潜在退出，并关注技术、网络安全、集中度、业务连续性和战略风险。DORA 对支持关键或重要功能的 ICT 第三方服务也要求机构制定和测试退出策略。

来源：[OSFI Third-Party Risk Management Guideline](https://www.osfi-bsif.gc.ca/en/guidance/guidance-library/third-party-risk-management-guideline)；[DORA Article 11，EUR-Lex](https://eur-lex.europa.eu/eli/reg/2022/2554/oj?uri=CELEX%3A32022R2554)

### 2.5 监管要求与内部治理的映射

| 治理主题 | 监管材料中的依据 | 对 Technology Debt Management 的设计含义 |
|---|---|---|
| 资产清单和依赖 | OSFI B-13、DORA Article 8、FFIEC Handbook | Debt Item 必须关联权威资产及其依赖，不能只存自由文本 |
| 生命周期 / EOL | OSFI B-13、FFIEC EOL Management、DORA legacy ICT 定义 | 记录供应商支持日期、内部退役日期、数据来源和置信度 |
| 风险评估 | DORA、OSFI B-13 | 债务风险要关联机构风险框架，不能用一个技术分数代替风险评估 |
| 例外管理 | OSFI B-13 明确提及 exception management；FFIEC EOL 补偿控制 | 风险接受需有授权人、补偿控制、复审日期和证据 |
| 第三方依赖与退出 | OSFI TPRM、DORA | 记录合同、供应商、替代方案、退出策略和测试结果 |
| 业务韧性 | OCC 风险观察、DORA | 用业务服务和关键功能衡量影响，而不是只按技术组件数量排序 |

## 3. 产品分析：现有产品能覆盖到哪里

不同产品对“债务”的理解并不相同。EA 产品通常从应用、技术组件和业务能力关系出发；ITSM / ITAM 产品从配置项、软件产品和生命周期出发；代码分析产品从源代码和依赖库出发。选型前应先确认企业想治理的是哪一层债务，避免把某个产品擅长的局部问题误认为完整的企业级解决方案。

### 3.1 SAP LeanIX

SAP LeanIX 的 Technology Risk and Compliance 能力面向技术过时风险。官方文档说明，它可以通过 ServiceNow 集成或自定义 CMDB 集成发现 IT 组件，关联应用，并使用 Reference Catalog 中的供应商生命周期信息跟踪版本和支持状态。文档还区分供应商生命周期和企业内部生命周期，使企业能够在供应商支持结束后，根据运营依赖和内部战略设置不同的内部时间线。

其优势是把技术组件生命周期与应用组合、技术标准和架构关系放在同一 EA 语境下。对于已有 LeanIX 的机构，优先评估现有 Technology Fact Sheet、Application、Lifecycle、Risk 和 Technology Risk & Compliance 能力，通常比另建资产库更合理。

边界在于：自动化程度取决于 CMDB 数据质量、产品目录覆盖率和集成配置。目录中没有的产品版本、定制组件或特殊 workaround 仍需要补充数据。供应商生命周期数据也不能代替内部风险评估和风险接受。采购评估时应确认 Technology Risk and Compliance 的实际许可范围、Reference Catalog 覆盖范围、数据更新频率、区域可用性和集成限制。

官方资料：[SAP LeanIX – Obsolescence Risk Management Capabilities](https://help.sap.com/docs/leanix/ea/obsolescence-risk-management-capabilities)；[IT Components in the Reference Catalog](https://help.sap.com/docs/leanix/ea/it-components-in-reference-catalog)；[Obsolescence Risk Statuses and Views](https://help.sap.com/docs/leanix/ea/technology-obsolescence-risk-statuses-and-views-in-reports)

### 3.2 Ardoq

Ardoq 的优势是提供了明确的 Technical Debt Management Solution 和 Debt Item metamodel。官方文档将债务建模为独立组件，并允许它影响 Application、Application Module、Data Store、Technology Service 和 Server。Debt Item 可以关联受影响资产、质量特征、相关风险和 remediation initiative。

它还提供了债务偿还成本、持续承受债务的当前影响成本、最坏影响、业务关键性和建议动作等字段。其成本估算采用区间而非要求每个团队填报精确金额，例如“最多一周”“最多一个月”“超过六个月”，再通过可配置计算逻辑转成估算值。这种做法承认早期组合治理的数据通常只是估算，不应制造虚假的财务精度。

Ardoq 的文档也明确说明了依赖条件：至少需要 Application Lifecycle Management Solution 中的应用模型；更细的分析还依赖 Technology Portfolio、Application Risk Management、Business Capability 等模型。换言之，Debt Management Solution 并不是脱离 EA Repository 的独立登记表，它的价值来自已有图谱关系。

适合场景：企业希望把技术债作为 EA Repository 中的一等对象，进行影响分析、组合优先级和偿还规划。需要验证的部分包括当前订阅与 Solution 许可、工作流自动化范围、风险目录集成、数据导入和模型维护成本。

官方资料：[Ardoq Technical Debt Management – Purpose, Scope and Rationale](https://help.ardoq.com/en/articles/171964-technical-debt-management-purpose-scope-and-rationale)；[Technical Debt Management Metamodel](https://help.ardoq.com/en/articles/171953-technical-debt-management-metamodel)

### 3.3 ServiceNow Enterprise Architecture / Technology Portfolio Management

ServiceNow 的 Technology Portfolio Management（TPM）围绕软件和硬件产品的生命周期管理。官方文档说明，企业可以跟踪内部生命周期和供应商生命周期，并将应用服务关联到实际运行的技术模型。Enterprise Architecture Workspace 的 Technology Portfolio 视图包含 TRM catalog、Technical Debt、TPM lifecycles、TPM risk 和 technology portfolio audit 等入口。

这个能力对于已经把 CMDB、ITAM、SAM 和 ITSM 放在 ServiceNow 的机构很有吸引力：发现到的技术组件可以映射到应用服务，生命周期风险可以形成升级或退役需求，后续 remediation 工作也能沿用现有流程。TPM 的生命周期信息有许可和插件前提；ServiceNow 文档明确指出，软件生命周期数据展示需要 Software Asset Management Foundation 或 Software Asset Management Professional 插件。

ServiceNow 的优势是运营流程和配置项数据；风险在于模块、插件、版本和数据模型之间的依赖。不能仅凭“我们已经买了 ServiceNow”就假定具备完整 TPM / EA 能力。PoC 应使用当前实例和目标 release 验证字段、插件、集成、报表和审计轨迹。

官方资料：[Technology Portfolio view](https://www.servicenow.com/docs/r/application-portfolio-management/eaw-technology-portfolio-view.html)；[View technology lifecycle details](https://www.servicenow.com/docs/r/application-portfolio-management/eaw-view-tech-lifecycle.html)；[Technology Portfolio Management](https://www.servicenow.com/docs/r/yokohama/application-portfolio-management/technology-portfolio-management.html)

### 3.4 OrbusInfinity

OrbusSoftware 将 OrbusInfinity 的 Technical Debt Management 作为明确的企业 IT Portfolio 用例。其官方产品页描述了债务清单、分类、风险优先级、EOL 与升级 backlog、组合热图、remediation roadmap 和管理层报告。它覆盖应用、架构、数据、集成和基础设施等债务类别。

从产品定位看，OrbusInfinity 与“跨企业技术组合治理”这一需求匹配度较高，值得纳入 shortlist。但目前可引用的主要证据是厂商产品说明。产品页描述的功能不能直接证明在某家金融机构中已经形成成熟、可审计的风险接受流程，也不能证明它能替代 GRC 或 ITSM。评估时应要求厂商演示从发现债务到批准例外、设置到期日、关联风险、生成 remediation 计划、关闭并保留证据的完整流程。

官方资料：[OrbusInfinity – Technical Debt Management](https://www.orbussoftware.com/solutions/use-case/technical-debt-management)

### 3.5 CAST Highlight

CAST Highlight 更偏软件组合分析。其官方介绍覆盖应用健康、技术债、软件组件老化、开源风险、云迁移障碍和现代化机会，并强调从源代码和软件组成中获取事实。它可以帮助识别代码与依赖层面的债务，尤其适合应用组合扫描和现代化评估。

但它不能单独覆盖所有企业技术债：人工 workaround、架构例外、平台标准偏离、风险接受和基础设施生命周期需要其他数据源。应把 CAST Highlight 视为代码与软件组成分析的数据提供者，而不是 EA / Technology Risk Governance 的唯一系统。

官方资料：[CAST Highlight Overview](https://www.castsoftware.com/highlight)；[CAST Highlight Pricing and Package Scope](https://www.castsoftware.com/highlight/pricing)

### 3.6 产品能力对照

| 产品 | 主要切入点 | 明确可验证的能力 | 主要边界 |
|---|---|---|---|
| SAP LeanIX | EA / 技术组合 | 技术组件目录、供应商生命周期、应用影响、过时风险视图 | workaround 和特殊例外需要建模；依赖目录和 CMDB 质量 |
| Ardoq | EA 图谱 / Debt Item | 债务对象、受影响资产、成本估算、风险和 remediation 关联 | 依赖 EA 模型及相关 Solution；数据模型需维护 |
| ServiceNow EA / TPM | CMDB / ITAM / 技术生命周期 | 技术产品生命周期、TRM、TPM 风险和 Technical Debt 入口 | 插件、许可、release 和配置依赖明显 |
| OrbusInfinity | IT Portfolio / 债务治理 | 厂商声明支持债务清单、分类、优先级、热图和 roadmap | 公开材料主要是产品能力声明，需现场验证治理细节 |
| CAST Highlight | 源码 / 软件组合分析 | 代码技术债、开源组件风险、组件老化、现代化分析 | 不能替代企业级风险接受、架构例外和资产治理 |

不建议用一个“功能覆盖率百分比”给这些产品排名，因为它们的建模边界不同。更有效的选型方式是拿同一组真实场景做脚本化演示：EOL 数据库、非战略平台、长期人工 workaround、供应商锁定、无法修补的关键组件，以及一项已批准但即将到期的架构例外。每个场景都要求产品展示资产关联、业务影响、责任人、风险决定、证据、到期提醒和 remediation 闭环。

## 4. 开源与自托管项目

开源项目需要区分“可以承载企业架构数据”“可以扩展为债务治理”和“已经提供完整债务治理产品”三个层次。下面几个项目值得评估，但没有一个可以在未经扩展和控制验证的情况下直接作为银行级治理系统。

### 4.1 Turbo EA

Turbo EA 是一个自托管 Enterprise Architecture Management 项目，提供应用、业务能力、技术和战略等架构对象之间的关系建模，支持可配置 metamodel，并在项目介绍中列出架构决策记录、架构风险登记和治理相关能力。它可以作为构建 Technology Debt 模型的基础：增加 Debt Item 类型，关联 Application、Technology、Business Capability、Risk、Architecture Decision 和 Initiative。

许可证必须特别注意。项目采用 Functional Source License 1.1 with MIT Future License（FSL-1.1-MIT）；官方 FAQ 说明，内部自托管和内部商业使用允许，但限制将其转售或作为竞争性托管服务提供；每个 release 两年后自动转为 MIT，v1.66.x 及以前版本已经是 MIT。金融机构内部使用前仍应由法务核对具体版本、依赖组件和分发方式，不能把它简单标成“无条件 MIT 开源”。

官方资料：[Turbo EA](https://www.turbo-ea.org/)；[Turbo EA FAQ – License](https://www.turbo-ea.org/faq)；[GitHub Repository](https://github.com/vincentmakes/turbo-ea)

### 4.2 Essential Project

Essential Project 是基于本体模型的企业架构工具体系，包含 Essential Meta-Model、Viewer 和 Import Utility。官方资料说明它可以建立架构对象关系、发布目录和依赖视图，并通过 API / XML 与 CMDB、项目管理、安全工具等系统集成。它适合研究企业架构知识库和自定义报告。

需要纠正一个常见误解：公开的 Essential Viewer GitHub 仓库是 GPL-3.0 许可的 Viewer 应用，并不等于完整的、具有所有商业功能的开源 EA 平台。官方产品页面将 Essential Open Source、Essential Cloud 和 Essential Docker 分开描述。当前公开材料可以证明它具备 EA metamodel、Viewer 和导入能力，但不足以证明开箱即用地具备完整的 Technical Debt Register、风险接受和 remediation workflow。若采用，应把 Debt Item、Exception、Risk Acceptance 和 Remediation 等治理能力作为需要设计和验证的扩展。

官方资料：[Essential Project Products](https://enterprise-architecture.org/products/)；[Essential Open Source Download](https://enterprise-architecture.org/products/essential-open-source/essential-os-download/)；[essential_viewer GitHub](https://github.com/essentialproject/essential_viewer)

### 4.3 iTop

iTop 是成熟的开源 CMDB / ITSM 工具，能够管理配置项、服务和依赖关系。它适合作为技术资产与服务关系的数据源，也可以通过扩展模型记录资产生命周期、例外或风险引用。

但 iTop 的核心定位是 CMDB / ITSM，不是 Enterprise Technology Debt Governance。需要补充 Debt Item 模型、战略偏离、风险接受、到期复审、remediation 计划和组合报告。其 GitHub 仓库标注 AGPL-3.0；部署、修改和对外提供服务的法律影响应由法务结合实际使用方式评估。

官方资料：[Combodo iTop GitHub](https://github.com/Combodo/iTop)

### 4.4 开源方案比较

| 项目 | 定位 | 可复用能力 | 需要自行补充 |
|---|---|---|---|
| Turbo EA | EA Repository | 可配置 metamodel、架构关系、ADR、架构风险 | 专门的 Debt Item 生命周期、风险接受和审计流程 |
| Essential | EA Ontology / Viewer | 企业架构模型、依赖视图、导入和 API 集成 | Debt Register、例外治理、偿还工作流和控制证据 |
| iTop | CMDB / ITSM | 配置项、服务、依赖、运营流程 | 战略对齐、债务量化、风险接受和组合治理 |

不建议把 OpenEA 作为当前 shortlist 中的成熟产品：本次检索没有获得足以确认其项目身份、维护状态、许可证和生产能力的权威证据。它不应仅凭名称或零散介绍进入金融机构 PoC。对开源项目，至少要核对 GitHub 仓库归属、许可证、最近 release、维护活跃度、依赖组件、漏洞响应、升级路径和商业支持选项。

## 5. 建议的数据模型：Debt Item 是治理对象，不是资产副本

技术债务平台不应该复制 CMDB、EA 或 GRC 中的资产主数据。Debt Item 应保存债务本身的描述、判断、责任和处理状态，再通过稳定 ID 关联权威系统中的应用、技术组件、业务服务、风险、例外和项目。

核心关系如下：

- 一个 Debt Item 可以影响多个 Application、Technology Component、Infrastructure Asset 或 Business Service。
- 一个 Application 可以受到多笔 Debt Item 影响。
- 一个 Debt Item 可以关联一个或多个 Risk，也可以关联一个 Architecture Decision 或 Standard Deviation。
- 一个 Debt Item 可以有多次 Risk Acceptance / Exception 决定；每次决定都有审批人、有效期和证据。
- 一个 Debt Item 可以关联一个或多个 Remediation Initiative；同一项目也可能偿还多笔相关债务。
- 一个 Debt Item 的状态变化必须保留历史记录，不能通过覆盖字段抹去过去的风险接受和延期决定。

### 5.1 核心实体

| 实体 | 关键字段 | 数据所有权建议 |
|---|---|---|
| Debt Item | ID、描述、类别、根因、发现日期、状态、来源、置信度 | Debt Governance |
| Asset Reference | 外部资产 ID、资产类型、关系角色、影响范围 | CMDB / EA / ITAM |
| Business Impact | Business Service、Capability、Criticality、客户影响 | EA / Service Portfolio |
| Technology Standard | 标准、版本、适用范围、批准状态、生效日期 | Architecture Governance |
| Exception / Acceptance | 决定、理由、风险接受人、批准时间、有效期、复审日期 | GRC / Exception Management |
| Risk Link | Risk ID、风险类型、固有风险、剩余风险、控制引用 | Enterprise Risk / GRC |
| Remediation Initiative | Initiative ID、预算、负责人、里程碑、状态 | PPM / Jira / ServiceNow |
| Evidence | 文档、扫描结果、供应商公告、评估记录、审计证据 | 原始系统 / Evidence Store |
| Debt Event | 状态变化、审批、延期、重新评估、关闭记录 | Debt Governance Audit Log |

Debt Item 至少需要记录以下内容：债务类别、根因、受影响资产、业务关键性、技术战略偏离、供应商生命周期、当前影响、最坏合理影响、补偿控制、责任人、风险接受人、处理决定、目标日期、复审日期、证据和数据来源。对于估算值，应同时保存估算区间、估算依据和最后确认时间，不要只保存一个看似精确的金额。

### 5.2 数据质量和去重

资产 ID 和 Debt ID 应分开。CMDB 中一个数据库实例可能支持多个应用，一个技术组件也可能在多个环境中部署；Debt Item 描述的是共同根因或共同决策，不应为每个受影响应用机械复制一条债务。反过来，同一数据库版本的 EOL 可能在不同业务服务上形成不同风险，风险接受和 remediation 也可能不同。此时可以保留一个技术根因记录，并在影响关系上记录应用、环境和业务关键性；如果处理决定和风险责任不同，再拆分为可独立治理的 Debt Item。

每条自动发现的数据都应记录来源系统、来源对象 ID、提取时间、数据更新时间和映射置信度。EOL 数据尤其需要区分厂商官方生命周期、第三方目录推断和内部维护日期。缺少支持日期不应自动解释为“仍受支持”；它应形成数据质量问题或待核实状态。

## 6. 生命周期与风险接受

Debt Item 的状态机需要区分技术处置状态和风险决定。一个债务可以处于“风险已接受、整改尚未开始”的状态，也可能“正在整改但风险仍然未接受”。把这些信息压缩成单一的 Open / Closed 字段，会导致管理层无法判断企业是否真的控制了风险。

建议的生命周期：

1. **Identified**：由扫描、架构评审、EOL 数据、审计发现或团队申报创建。
2. **Validated**：确认不是重复记录，明确根因、资产关系、数据来源和影响范围。
3. **Assessed**：完成业务影响、技术风险、战略偏离和成本评估。
4. **Decisioned**：选择 Remediate、Mitigate、Accept Temporarily、Retire / Replace 或 Reject / Not a Debt，并记录决定依据。
5. **In Progress**：执行风险缓解、升级、迁移、替换或退役。
6. **Verified**：验证资产状态、补偿控制或目标架构已经达到要求。
7. **Closed**：关闭债务记录，保留证据和完整事件历史。

### 6.1 风险接受不是永久豁免

风险接受必须是有期限的治理决定。至少需要明确接受风险的授权角色、适用资产和环境、接受理由、剩余风险、补偿控制、控制有效性证据、有效期、复审日期和触发重新评估的事件。接受人不应仅仅是负责技术交付的团队负责人；风险责任应由机构风险框架中拥有相应授权的 Business / Technology Risk Owner 承担。

对于高风险债务，应设置硬性复审条件，例如供应商停止安全更新、漏洞严重性上升、关键业务服务变更、控制失效、发生相关事故、业务关键性提升或退出方案失效。延期不应只是把 Target Date 往后移动；必须重新评估风险、说明原计划为何未完成、评估补偿控制是否仍有效，并重新取得适当授权。

风险接受与 remediation 也不应互相替代。即使企业接受短期剩余风险，也可以同时批准预算和路线图，逐步偿还债务。相反，已经启动整改项目并不意味着当前风险自动降低；在新版本上线、旧资产退役和控制验证完成之前，债务仍然存在。

## 7. 优先级：不要用一个未经解释的 Debt Score 排序

债务优先级至少需要考虑业务影响、风险暴露、时间紧迫性和偿还成本。把这些维度简单相乘生成一个总分，容易掩盖监管、客户和关键业务服务上的硬约束。更合理的方式是先设强制升级条件，再对其余事项进行组合排序。

### 7.1 先设置强制门槛

以下情况应进入强制审查或风险升级队列，不应被低成本或低技术复杂度抵消：

- 关键或重要业务服务依赖已停止安全支持的组件，且缺乏有效补偿控制。
- 存在超过风险容忍度的未缓解漏洞或安全配置偏离。
- 监管、审计或内部控制发现要求在指定期限内整改。
- 关键供应商或云服务的退出路径不可执行，或集中度风险超过阈值。
- workaround 影响关键业务操作，却没有可验证的复核、对账或恢复机制。
- 风险接受已过期，或者责任人、补偿控制和证据无法确认。

### 7.2 其余债务按多维度比较

| 维度 | 评估问题 | 建议证据 |
|---|---|---|
| Business Criticality | 影响哪些关键业务服务、客户和监管职能？ | Business Service / Capability Mapping |
| Risk Exposure | 发生故障、安全事件或控制失效的可能性和后果？ | Risk Assessment、Incident、Vulnerability |
| Time Urgency | 厂商支持结束、合同到期或风险接受到期还有多久？ | Vendor Lifecycle、Contract、Exception |
| Strategic Fit | 与批准的技术标准和目标架构偏离程度如何？ | TRM、Architecture Principles、ADR |
| Operational Burden | 人工操作、特殊支持、恢复和变更成本有多高？ | 工单、操作日志、值班记录 |
| Remediation Effort | 需要多少成本、时间和依赖？ | 估算区间、项目计划、供应商报价 |
| Dependency Leverage | 一次整改能否消除多个应用或业务服务的共同风险？ | Dependency Graph |

可以采用 P0 / P1 / P2 / P3 管理队列：P0 表示超出风险容忍度或存在紧迫监管/安全事项；P1 表示关键业务风险或近期 EOL；P2 表示有明显成本、架构或战略偏离但可计划处理；P3 表示低影响、可接受且有复审安排的债务。具体阈值应由机构风险偏好和业务关键性定义，不能把这套示例直接当作监管评级。

财务分析应把“继续承受债务的成本”和“偿还债务的成本”分开。继续承受成本可包括扩展支持费用、额外运维人力、重复控制、故障损失和审计整改成本；偿还成本则包括迁移、测试、并行运行、培训和退出成本。对金额无法精确估算的项目，采用区间和假设比填写一个伪精确数字更可靠。

## 8. 目标架构与系统集成

Technology Debt Management 最适合作为治理层，连接现有数据和工作系统。它不应接管 CMDB 的资产主数据，也不应取代 GRC 的风险登记或 Jira / ServiceNow 的交付执行。

![Technology Debt Governance reference architecture](../../public/diagrams/technology-debt-management/technology-debt-governance.svg)

图中五类数据源负责提供资产、架构标准、生命周期、安全风险和交付状态。Debt Governance 层负责把这些信号合并成可治理的 Debt Item，连接风险接受与整改计划，再把组合状态反馈给管理层。独立 HTML 版本：[Technology Debt Governance Architecture](../../public/diagrams/technology-debt-management/technology-debt-governance.html)。

### 8.1 系统职责边界

| 系统 | 应负责什么 | 不应被要求负责什么 |
|---|---|---|
| CMDB / ITAM | 资产身份、配置、部署位置、生命周期和依赖 | 判断某个架构偏离是否值得接受 |
| EA / Technology Portfolio | 应用、业务能力、技术标准、目标架构和依赖关系 | 替代 GRC 风险授权 |
| Vendor / Lifecycle Catalog | 产品版本、厂商支持、EOL / EOS 日期 | 解释资产在本企业的业务影响 |
| Vulnerability / Security | 漏洞、补丁状态、安全控制和例外 | 单独决定企业技术投资优先级 |
| GRC / Risk | 风险分类、风险所有者、接受和控制证据 | 管理技术整改任务的全部工程细节 |
| ITSM / PPM / Jira | Change、Problem、Remediation Initiative、预算和交付状态 | 成为企业唯一技术债务登记库 |
| Debt Governance | Debt Item、关联关系、决策历史、优先级、到期复审和组合视图 | 复制所有来源系统的主数据 |

集成可以先从批量导入和定期同步开始，不必一开始就构建复杂的实时事件总线。关键是每个字段明确系统-of-record、同步方向、更新频率和冲突处理规则。对于风险接受、批准、延期和关闭等治理事件，应保留不可覆盖的审计事件记录；对资产状态和生命周期数据，则允许按来源系统刷新。

### 8.2 关键集成场景

- CMDB 发现新资产或关系变化时，检查是否落入已知债务影响范围。
- 生命周期目录更新厂商支持日期时，重新计算 EOL 暴露窗口，并触发受影响应用的评估。
- Vulnerability Management 发现无法修补的关键漏洞时，关联已有 Debt Item；若不存在，则创建待验证的债务候选。
- 架构评审批准标准偏离时，自动创建或更新 Exception / Debt Item，并记录决策引用。
- Remediation Initiative 进入生产完成状态后，Debt Governance 不应立即自动关闭债务，而应等待资产版本、控制证据和业务验证确认。
- 风险接受到期、补偿控制失效或整改里程碑延期时，触发重新评估和授权流程。

## 9. 管理视图：同一套数据服务不同决策

CIO / CTO 需要知道企业债务集中在哪些业务领域、哪些平台、哪些供应商和哪些关键服务，以及未来几个预算周期需要多少现代化投资。管理层视图应关注风险趋势、债务年龄、超期风险接受、EOL 暴露和整改资金，而不是只统计登记了多少条债务。

Enterprise Architect 需要查看哪些应用违反技术标准、哪些技术组件被重复使用、哪些架构决策形成长期约束，以及一个平台替换会影响哪些业务能力。Technology Risk / Operational Risk 关注的是剩余风险、补偿控制、接受权限、审计证据和风险到期情况。平台工程与应用团队则需要看到具体资产、责任人、升级路径、依赖项目和下一步动作。

建议的核心指标包括：

| 指标 | 计算口径 | 解释 |
|---|---|---|
| Unsupported Asset Exposure | 关键业务服务所依赖的 unsupported 资产数量 / 覆盖率 | 不能只看资产总量，还要按业务关键性加权展示 |
| EOL Horizon | 未来 90 / 180 / 365 天进入 EOS / EOL 的资产与应用数量 | 用于规划升级窗口和预算 |
| Expired Risk Acceptance | 已超过有效期的接受决定数量 | 这是治理失效信号，不应被“已接受风险”状态隐藏 |
| Debt Aging | 按发现日期统计债务年龄分布 | 识别长期未处理和反复延期事项 |
| Strategic Deviation | 未批准或已过期的标准偏离数量 | 区分正式批准的例外与未经授权的偏离 |
| Remediation Delivery | 按计划完成、延期、重新打开的债务比例 | 关注实际偿还，而不是项目启动数量 |
| Critical Service Concentration | 关键业务服务依赖的高风险债务数量 | 揭示共同技术组件造成的集中风险 |
| Data Coverage | 有可信资产关系、生命周期和责任人的债务比例 | 避免把未知数据误报为低风险 |

指标应明确分母、时间窗口和数据完整性。比如“95% 的债务已接受或已处理”并不能说明风险很低：如果接受已经过期，或者资产依赖关系不完整，这个百分比就会产生误导。

## 10. 实施路径与 PoC 验收

不建议第一阶段就尝试把全企业所有技术债务一次性录入。先选一个资产关系较清楚、又能体现跨系统治理价值的技术域，例如数据库平台、Windows / Linux 基础设施、集成平台或某个关键业务服务。

### 10.1 分阶段实施

**阶段一：定义范围和数据契约。** 选定债务分类、状态、责任角色、风险接受规则和最小字段。明确 CMDB、EA、GRC 和 ITSM 中哪些对象是权威记录，定义外部 ID 和同步规则。先选一个技术域，避免一开始追求全量覆盖。

**阶段二：建立可追溯的 Debt Register。** 导入应用、技术组件、业务服务、供应商生命周期和现有例外数据。对每条债务保留来源、最后更新时间和置信度。先解决重复资产、孤立关系和过期生命周期信息，不要在低质量数据上做高精度评分。

**阶段三：跑通风险接受和整改闭环。** 选择几类真实事项，包括 EOL 数据库、非战略平台、长期 workaround 和供应商退出风险。验证从发现、评估、授权、补偿控制、复审到整改验证的完整流程。对已接受风险设置到期和事件触发复审。

**阶段四：接入组合投资和管理报告。** 将债务偿还计划映射到 PPM / 项目预算，建立关键业务服务风险视图和技术组合热图。只有在数据质量和工作流稳定后，再增加自动发现和实时同步。

### 10.2 PoC 场景与验收标准

| PoC 场景 | 必须验证的行为 | 通过标准 |
|---|---|---|
| EOL 数据库支持多个应用 | 从技术组件追踪到应用和业务服务 | 能识别完整影响范围，并显示生命周期来源与更新时间 |
| 非战略技术平台 | 关联 Technology Standard 和偏离决定 | 能区分未批准偏离、有效例外和过期例外 |
| 长期人工 workaround | 关联操作流程、风险、控制和责任人 | 能记录持续成本、控制证据、退出计划和复审日期 |
| 风险接受到期 | 触发重新评估和升级 | 过期状态不可被普通“Open / Accepted”掩盖，保留审批历史 |
| 整改项目完成 | 与 ITSM / PPM 状态同步 | 项目完成不自动等于债务关闭；需资产和控制证据验证 |
| 资产数据缺失 | 处理未知版本、无责任人和断裂依赖 | 未知数据进入数据质量队列，不被默认为无风险 |

PoC 还应验证权限与审计：债务创建者不能自行批准高风险接受；风险接受人必须有授权；延期需要重新说明理由；关闭操作必须保留证据；历史决定不能被覆盖。对外部 SaaS 产品，还应评估数据驻留、访问控制、SSO / SCIM、审计日志导出、加密、灾备、供应商风险和退出能力。

## 11. 选型结论

如果机构已经使用 ServiceNow，并且 CMDB、SAM、ITSM 和 EA 数据质量较好，应优先评估 ServiceNow Enterprise Architecture / TPM 的现有能力，先确认所需插件、许可和版本，再决定是否需要外部 EA 平台。它的优势在于配置项与运营流程的连接。

如果机构已有 SAP LeanIX，且主要问题是技术组件 EOL、应用影响分析和技术组合风险，优先评估 LeanIX Technology Risk and Compliance，并验证目录覆盖率和 CMDB 集成。对于希望把 Debt Item、影响成本、风险和 remediation initiative 纳入 EA 图谱的机构，Ardoq 的公开 metamodel 最值得细看。OrbusInfinity 的产品定位直接覆盖企业级技术债务治理，但应以场景演示和合同能力核实厂商声明。CAST Highlight 可作为源码和软件组成分析的补充工具。

如果必须自托管，Turbo EA 值得作为可配置 EA Repository 的 PoC 起点；Essential 适合研究本体建模与架构视图；iTop 更适合作为 CMDB / ITSM 数据来源。三者都需要补充或集成金融机构所需的风险接受、例外复审、证据管理和偿还闭环。开源许可也必须按具体版本和部署方式进行法务审查。

最终决策不应是“哪家产品有 Technical Debt 菜单”，而应是：哪套现有系统能以最低的数据复制成本，建立资产到业务影响的可信关系，并把风险决定、补偿控制、预算和整改结果留在可审计的治理链中。若现有平台已经能满足这些要求，扩展现有平台通常比引入新的独立产品更稳妥；如果现有系统缺少 EA 关系模型或跨域治理能力，再考虑引入专门的 EA / Debt 平台。

## 参考资料

### 监管与行业材料

1. [OCC – Semiannual Risk Perspective, Spring 2023](https://www.occ.treas.gov/publications-and-resources/publications/semiannual-risk-perspective/files/pub-semiannual-risk-perspective-spring-2023.pdf)（技术基础设施、EOL、workaround 与 tech debt 的行业风险观察）。
2. [FFIEC – IT Examination Handbook, Information Security](https://www.ffiec.gov/press/PDF/FFIEC_IT_Handbook_Information_Security_Booklet.pdf)（EOL Management；应结合当前 Handbook 更新核对）。
3. [FFIEC – Architecture, Infrastructure, and Operations, 2021](https://www.ffiec.gov/news/press-releases/2021/pr-06-30)。
4. [FFIEC – Development, Acquisition, and Maintenance, 2024](https://www.ffiec.gov/news/press-releases/2024/pr-09-29)。
5. [OSFI – Guideline B-13: Technology and Cyber Risk Management](https://www.osfi-bsif.gc.ca/en/guidance/guidance-library/technology-cyber-risk-management)（2022）。
6. [OSFI – Third-Party Risk Management Guideline](https://www.osfi-bsif.gc.ca/en/guidance/guidance-library/third-party-risk-management-guideline)。
7. [EU – Regulation (EU) 2022/2554, Digital Operational Resilience Act (DORA)](https://eur-lex.europa.eu/eli/reg/2022/2554/oj?uri=CELEX%3A32022R2554)。

### 产品与开源项目官方资料

8. [SAP LeanIX – Obsolescence Risk Management Capabilities](https://help.sap.com/docs/leanix/ea/obsolescence-risk-management-capabilities)。
9. [SAP LeanIX – IT Components in Reference Catalog](https://help.sap.com/docs/leanix/ea/it-components-in-reference-catalog)。
10. [Ardoq – Technical Debt Management: Purpose, Scope and Rationale](https://help.ardoq.com/en/articles/171964-technical-debt-management-purpose-scope-and-rationale)。
11. [Ardoq – Technical Debt Management Metamodel](https://help.ardoq.com/en/articles/171953-technical-debt-management-metamodel)。
12. [ServiceNow – Exploring Technology Portfolio View](https://www.servicenow.com/docs/r/application-portfolio-management/eaw-technology-portfolio-view.html)。
13. [ServiceNow – View Technology Lifecycle Details](https://www.servicenow.com/docs/r/application-portfolio-management/eaw-view-tech-lifecycle.html)。
14. [OrbusInfinity – Technical Debt Management](https://www.orbussoftware.com/solutions/use-case/technical-debt-management)。
15. [CAST Highlight](https://www.castsoftware.com/highlight)。
16. [Turbo EA](https://www.turbo-ea.org/)；[FAQ / License](https://www.turbo-ea.org/faq)；[GitHub](https://github.com/vincentmakes/turbo-ea)。
17. [Essential Project Products](https://enterprise-architecture.org/products/)；[Essential Open Source Download](https://enterprise-architecture.org/products/essential-open-source/essential-os-download/)；[GitHub Viewer](https://github.com/essentialproject/essential_viewer)。
18. [iTop – GitHub Repository](https://github.com/Combodo/iTop)。

**证据边界：** 监管材料用于说明风险管理和控制预期，不构成对某一商业产品的认可。厂商文档用于确认公开声明的功能，不足以证明产品在所有金融机构场景中的成熟度或实施成效。开源项目的许可证、release 和功能应在采购或部署决策前按目标版本再次核对。本报告没有获得足够独立公开证据证明上述产品在同一金融机构场景下的成本、部署周期或风险降低效果，因此不对这些指标作定量排名。
