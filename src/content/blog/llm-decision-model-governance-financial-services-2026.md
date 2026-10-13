---
author: W
featured: false
draft: false
description: 金融服务业 LLM Decision Model 治理分析：从单轮 Prompt 直接输出判断，转向证据可追溯、政策可验证、结果可复核、过程可审计的架构。
pubDatetime: 2026-10-13T14:30:00Z
title: 从 Prompt 判断到可审计决策：金融服务业 LLM Decision Model 的可解释性与治理实践
tags:
  - ai
  - llm
  - finance
  - governance
  - decision-model
  - compliance
---

# 从 Prompt 判断到可审计决策：金融服务业 LLM Decision Model 的可解释性与治理实践

金融服务机构正在把大语言模型用于内部判断：审核材料、识别异常、分析风险、判断流程是否满足条件，或帮助员工决定下一步怎么做。一个容易出现的实现是：把业务背景和要求写进 Prompt，把当次数据拼进请求，让模型直接返回一个判断和几句理由。

这种方式可以快速验证想法，却不一定满足金融服务业对**可解释、可追溯、可复核、可问责**的要求。尤其当系统从“辅助阅读”进入业务决策流程后，答案即使流畅、理由即使看似合理，也不代表判断依据充分，更不代表审计人员能在数月后重建当时的决策条件。

本文以 JEV 这类“基于 Prompt 对业务事实直接给出判断”的 Decision Model 为例，讨论问题根源、相关研究与监管实践，并提出可渐进落地的架构。这里不假设任何特定内部实现；建议应按实际业务用途、影响范围、数据类型及司法辖区进行风险评估。

## 一、结论先行：要治理的是决策系统，而不只是 Prompt

**不要把“让模型多写一点思考过程”当作可解释性方案。** 更可靠的方向，是把一次模型调用变成一条有明确输入、有证据、有政策依据、有校验、有人工责任主体的决策流程。LLM 可以协助提取事实、归纳证据、发现冲突和形成建议；能够明确表达的政策条件，应尽量交给确定性规则或独立校验器；确实需要专业判断的部分，应明确保留人的决策权，并提供足够信息进行实质复核。

| 能力 | 要回答的问题 | 不能用什么替代 |
| --- | --- | --- |
| **可追溯（Traceability）** | 这次判断用了哪些输入数据、文件版本、检索证据、Prompt、模型、规则和工具？ | 只保存最终答案或只保存 Prompt 文本 |
| **可解释（Explainability）** | 为什么该判断符合证据和业务政策？关键因素、证据缺口和反面证据是什么？ | 模型事后生成的一段听起来合理的理由 |
| **可复核（Reviewability）** | 独立业务人员是否能检查证据、重做关键步骤、提出异议或推翻判断？ | 只在页面上放一个“Approve”按钮 |
| **可问责（Accountability）** | 谁负责定义政策、验证系统、批准上线、处理例外、做最终决定和响应事故？ | 把责任笼统归给“AI 模型”或供应商 |

第一步不是更换模型，也不一定要马上搭建多 Agent。应先补齐决策契约、证据记录、业务政策、验证、人工复核和运行治理。如果系统在某个关键用途上仍无法达到所需的解释和验证水平，就应该降低其自主权限，或改用更容易验证的决策方法。

## 二、单轮 Prompt 直接输出判断，缺少了什么？

考虑一种简化实现：

~~~text
输入：业务材料 + Prompt
调用：LLM
输出：Approve / Reject / Escalate
      + 一段自然语言理由
~~~

问题不只是模型可能出错，而是结果很难拆分、验证和重现。

**事实与推断混在一起。** 模型可能把材料中明确写出的事实、跨材料推导的结论、对缺失数据的猜测，以及它对政策的理解，放在同一段自然语言里。读者很难分辨哪些是可核验事实，哪些只是模型的解释。

**政策只存在于 Prompt 中。** 如果决策标准藏在不断修改的系统 Prompt 里，审核人员很难知道某条要求在历史时点是否有效，也难以比较不同版本的判断差异。Prompt 不是充分的政策版本管理系统。

**输入没有形成稳定快照。** 即使保存了当时的 Prompt，引用的文件、数据库记录、内部政策或检索内容后来改变，也未必能重建模型当时看到了什么。仅保存 URL 或文档名称不够，必须能定位到具体版本、页码、段落或字段。

**理由没有独立验证。** 让同一个模型在输出判断后再回答“为什么这样判断”，仍可能只是生成与答案相符的叙述。除非理由与源材料、规则条件和可观察的输出建立了可验证关系，否则理由本身不是审计证据。

**人工复核容易变成确认动作。** 如果界面先突出显示 AI 结论，再给出措辞自信的理由，人会受到锚定影响。审核人员点击批准，并不能证明其理解了证据、独立评估了关键因素，或真正挑战过模型的判断。

**失败无法归因。** 最终判断错误，究竟是源数据缺失、检索错误、事实抽取错误、政策解释错误、规则实现错误、模型变化，还是审批流程失效？只保存答案，无法形成有效的故障分类和持续改进依据。

## 三、研究论文的警示：解释不等于忠实，也不保证人工判断更好

### 3.1 Chain-of-Thought 不能直接当成模型真实决策过程

Turpin 等人的 NeurIPS 2023 论文 [Language Models Don't Always Say What They Think: Unfaithful Explanations in Chain-of-Thought Prompting](https://papers.neurips.cc/paper_files/paper/2023/hash/ed3fea9033a80fea1376299fa7863f4a-Abstract-Conference.html) 展示了关键问题：LLM 的逐步解释可能系统性地没有提及真正影响答案的因素，甚至会为受偏置信号影响的错误答案生成看似合理的解释。解释文本看起来完整，并不能保证它忠实反映了导致模型输出的因素。

Fayyaz 等人的 [Evaluating Human Alignment and Model Faithfulness of LLM Rationale](https://arxiv.org/abs/2407.00219) 比较了 Prompt 生成的自我解释与基于归因的解释，发现基于 Prompt 的自我解释在与人的理由对齐以及忠实度方面存在局限。

对金融 Decision Model 的含义很直接：可以要求模型输出简明理由，但不能把“模型自己写出来的理由”当成决策过程已透明化的证明。应使用**能回到原始材料核验的证据引用、明确的规则条件、字段级输出与独立验证结果**，而不是依赖公开或保存一长串 CoT 来替代审计设计。

### 3.2 增加解释未必能纠正自动化偏差

Vered 等人在 [The Effects of Explanations on Automation Bias](https://www.sciencedirect.com/science/article/pii/S000437022300098X) 中研究了决策支持系统里的解释对自动化偏差的影响。研究发现，解释并没有稳定地减少人们对自动化系统的过度依赖，在部分条件下甚至会增加这种依赖；解释对任务速度和准确率的影响取决于具体情境。

发表于 *Scientific Reports* 的研究 [Explainability does not mitigate the negative impact of incorrect AI advice in a personnel selection task](https://www.nature.com/articles/s41598-024-60220-5) 发现，当 AI 建议错误时，参与者仍可能未能否决它；增加解释对减少这种过度依赖的作用有限。Westphal 等人在 [Decision control and explanations in human-AI collaboration](https://doi.org/10.1016/j.chb.2023.107714) 中也报告，决策控制与解释的作用并不相同，解释在其实验条件下没有普遍改善用户结果。

这些研究不能直接证明每个金融岗位都会出现同样效果，但足以说明：**人工在环（Human-in-the-loop）不是一个架构标签，而是一种需要验证的控制能力。** 有人点击审批不自动意味着有意义的监督；更多解释文字也不自动意味着更好的判断。

### 3.3 监管研究同样不把“提供了解释”视为终点

国际清算银行金融稳定学院（BIS FSI）2025 年论文 [Managing explanations: how regulators can address AI explainability](https://www.bis.org/publications/fsi-paper-24-managing-explanations-how-regulators-can-address-ai-explainability) 指出，可解释性对透明度、问责、合规和信任很重要，但复杂模型（包括 LLM）的解释方法存在不准确、不稳定、可能误导等限制。不能只问“是否提供解释”，还要问解释是否适合具体用途，以及能否支持相应的风险管理和监督需要。

NIST 的 [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) 将幻觉/虚构内容、人机配置、结果测试、来源验证和部署后监控纳入生成式 AI 风险管理，建议在测试和持续监控中核查输出引用的来源，并评估人机组合在真实条件下的表现。

| 研究发现 | 不足够的做法 | 更合理的工程措施 |
| --- | --- | --- |
| 生成的理由未必忠实于模型输出的真实成因 | 只增加“请逐步思考并解释”的 Prompt | 将事实提取、证据引用、政策检查和建议结构化分开；独立校验引用是否支持结论 |
| 解释未必减少人工的自动化偏差 | 给出推荐结果和很长的解释，然后要求批准 | 显示关键事实、证据缺口和反面证据；高风险场景可先进行独立初判 |
| 可靠性依赖具体任务和使用方式 | 只引用供应商的通用 benchmark | 用本机构代表性案例，测试 Prompt、数据、规则、角色权限与实际工作流 |
| 系统会随模型、数据和上下文变化 | 只记录某次运行的最终文本 | 版本化 Prompt、模型、检索材料、工具、政策与测试集，持续监控并做回归验证 |

## 四、金融服务业的实践与监管动向

要区分正式监管要求、指导性框架和学术研究。具体义务取决于业务、机构类型、司法辖区，以及系统对客户和业务决策的影响。

### 4.1 MAS：2026 年发布的金融机构 AI 风险管理指引

新加坡金融管理局（MAS）于 **2026 年 10 月 7 日**发布 [Guidelines on Artificial Intelligence Risk Management for Financial Institutions](https://www.mas.gov.sg/regulation/guidelines/guidelines-on-artificial-intelligence-risk-management-for-financial-institutions)。指引适用于金融机构和各种 AI 技术，要求机构在企业层面和具体用例层面管理 AI 风险，包括建立适当的 AI 使用清单、风险重大性评估、生命周期控制、人类监督、测试、监控、变更管理以及第三方 AI 风险管理。指引将于 **2027 年 10 月 7 日**起生效，部分后续章节安排在 2028 年实施。具体时间表以正式指引为准。

MAS 同日发布的[反馈文件](https://www.mas.gov.sg/-/media/mas-media-library/publications/consultations/bd/2025/response-to-feedback-received-on-guidelines-on-artificial-intelligence-risk-management.pdf) 对 LLM 解释性、人类监督与可审计记录有几个特别相关的说明：

- 可解释性是情境化要求。即使不需要向客户披露，仍可能需要为内部使用人员、监督者或独立验证人员提供技术解释、限制和风险说明。
- 如果某种模型在特定用例下无法达到所需透明度和可解释性，金融机构应重新评估该模型是否适合该用途。
- 人类监督程度与 AI 自主性应和用例风险重大性相匹配。影响较大的用例通常需要更强的人工监督和更低的自主程度；预先定义的“延迟决策/转人工”机制是可考虑的控制方式。
- 对生成式 AI 或 AI Agent，可根据用例风险和监控需要增强文档记录，例如记录 Prompt 和模型输出。评测文档应支持评测过程的复现，以便审计和独立核验，而不只是留下一份模型输出。

这些是有针对性的监管依据，但不应把反馈文件里的每个例子都误读为对所有用例一体适用的硬性要求。正式指引的风险分级与比例原则仍然重要。

### 4.2 MAS FEAT 与 Veritas：把原则转成可评估的方法

MAS 的 [FEAT Principles](https://www.mas.gov.sg/publications/monographs-or-information-paper/2018/feat) 讨论金融服务业中 AI 和数据分析的公平、伦理、问责与透明。MAS 于 2023 年发布的 [Veritas Toolkit 2.0](https://www.mas.gov.sg/news/media-releases/2023/toolkit-for-responsible-use-of-ai-in-the-financial-sector) 由 MAS 主导的 31 家行业参与方联盟开发，覆盖 FEAT 评估方法，并介绍金融机构和保险业的实践案例。

可借鉴之处是：治理不只是模型团队评估准确率，还应覆盖透明度、责任归属、业务影响与机构既有治理流程。Veritas 是可参考的治理工具，不是可以替代本地法律意见或内部政策的通用认证。

### 4.3 OCC 2026 年更新：传统模型风险框架不能直接等同于 LLM 治理

美国 OCC、Federal Reserve 和 FDIC 于 2026 年 4 月发布了修订后的 [Model Risk Management guidance](https://occ.treas.gov/news-issuances/bulletins/2026/bulletin-2026-13.html)。文件明确指出，生成式 AI 与 Agentic AI 不在这份指引的适用范围内，监管机构还计划进一步研究银行使用 AI（包括生成式和 Agentic AI）的模型风险管理问题。

这不意味着金融机构可以不治理 LLM。传统模型治理中的开发、使用、验证、监控、角色与第三方管理原则有借鉴价值，但 LLM 的提示词依赖、非确定性、上下文敏感性和自然语言输出需要额外的用例级控制。不能只把传统模型审批表换个名字，就声称覆盖了 LLM Decision Model 的风险。

### 4.4 其他框架与法律：先判定适用范围，再确定控制深度

- [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) 与 [Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) 可用于组织风险分类、测试与验证、部署后监控和来源管理。
- [EU AI Act](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689) 将自然人信用评分或信用度评估、特定人寿和健康保险风险评估与定价等列入相关高风险 AI 规定。不能由此推断所有内部金融决策工具自动属于同一类别；需结合实际目的、对象、适用条款、时间安排与法律意见判断。
- [FSB 关于 AI 对金融稳定影响的报告（2024）](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/) 强调第三方依赖、网络风险、模型风险、数据质量和治理等领域的金融系统脆弱性。

**内部使用不等于低风险。** 如果内部模型决定风险评级、客户处理优先级、交易例外、AML 调查队列、投资/组合建议、保险承保或关键运营动作，它仍可能对客户、机构或监管义务产生重大影响。风险评估应基于实际影响和机构对 AI 输出的依赖，而不是看它是否“只给员工用”。

## 五、目标架构：让模型给出可检查的建议，而不是独自决定一切

更稳健的 Decision Model 通常不是“一次 Prompt 换一个更长的 Prompt”，而是将决策流程拆成多个可验证步骤。并非每个项目都需要独立部署多个模型或构建复杂 Agent 工作流；关键是每个步骤有明确输入、输出、责任和失败处理方式。

~~~mermaid
flowchart TD
    A[业务请求与案件标识] --> B[输入校验与数据快照]
    B --> C[材料解析与证据定位]
    C --> D[LLM 结构化事实抽取]
    D --> E[证据与字段校验]
    E --> F[政策/规则评估]
    F --> G[建议与不确定性汇总]
    G --> H[独立验证：引用、必填项、规则一致性]
    H --> I{风险等级与门禁}
    I -->|低风险且满足批准条件| J[受控自动处理]
    I -->|高影响、冲突、缺证或越界| K[有权限的人工审核]
    J --> L[决策记录与监控]
    K --> M[人工决定、覆核或升级]
    M --> L
~~~

### 5.1 明确决策契约

在 Prompt 和代码之前，先定义系统负责什么、不能负责什么、输出会影响什么，以及最终权责归属。最小决策契约应包括预期用途、自动化边界、输入契约、政策契约、输出契约、升级条件和责任主体。应避免让 Prompt 承担所有业务规则；能表达成稳定明确条件的要求，应维护在经过版本管理和测试的规则或策略层。

### 5.2 先抽取事实和证据，再形成建议

对包含合同、调查材料、客户记录、风险说明或内部政策的场景，可以把模型工作拆成两类。

第一，**证据工作**：提取事实、定位相关政策段落、归纳支持与反对的证据、发现矛盾和缺失项。每个关键陈述应带有可定位的来源；材料不支持时标记为缺证，而不是补出看似合理的事实。

第二，**判断工作**：根据已验证事实和适用规则形成建议。如果缺少关键材料、规则冲突、证据过期或案件超出批准范围，返回 `insufficient_evidence` / `escalate`，而不是强行输出二元结论。

文档证据应记录文档 ID、版本/快照哈希、页码或段落定位和原文片段；数据库字段则记录表/记录标识、字段、有效时间和查询快照；政策记录政策 ID、版本、生效日期和具体条款。一个 URL、文件名或“模型认为”都不足够。

RAG 可以改善模型取得背景资料的方式，但不会自动保证检索完整、引用真实、证据支持结论或政策应用正确。检索结果的版本、相关性和引用校验仍应作为单独控制点。

### 5.3 区分模型建议、业务规则与最终决定

一种实用的混合模式是：

- LLM 从非结构化材料中提取事实、映射预定义评估维度、发现矛盾并解释证据。
- 确定性规则执行明确政策、必要条件、金额阈值、时间窗口、禁止项、职责权限及其他可以清楚表达的约束。
- 独立验证器检查输出结构、证据引用、必填字段、硬性约束和升级条件。
- 有权限的人员或正式批准的决策机制处理需要专业判断的冲突、不确定性和例外。

规则引擎无法解决所有问题。它只能覆盖可形式化的政策；需要综合判断的领域仍须保留专家判断、适当的第二意见和可回溯记录。目标是避免本来可以用简单、可测试规则执行的内容完全依赖模型自由生成。

### 5.4 把不确定性和无法判断变成正式输出

许多 Prompt 默认要求模型一定要选一个答案，缺失数据或证据冲突就可能被隐藏在自然语言里。建议把“无法判断”作为一等结果：

| 状态 | 含义 | 后续处理 |
| --- | --- | --- |
| `supported` | 满足预设证据与规则条件，建议有可核验依据 | 进入后续规定流程，是否自动执行取决于风险等级 |
| `not_supported` | 有可验证的反向证据，或不满足明确条件 | 进入拒绝、退回或补充材料等既定流程 |
| `insufficient_evidence` | 材料不足、来源无法核验，或关键事实未知 | 补资料或转人工 |
| `conflicting_evidence` | 可信材料互相矛盾，或规则解释冲突 | 转交有权限的审核人员 |
| `escalate` | 超出模型授权范围、风险阈值或需专业批准 | 人工审核或升级到指定角色 |

不要未经校准就把模型自报的 `confidence: 0.92` 当成“有 92% 概率正确”。LLM 自报的自信程度并不等于经过验证的概率。若需要置信度或风险分数，应通过有代表性的历史案例、校准方法和持续监控证明其含义；否则，使用可核实的证据完整度、规则检查结果和显式升级条件更可靠。

## 六、决策记录：应当保存什么，才能经得起复核？

对每次产生业务影响的模型运行，应形成结构化的 **Decision Record**。它不是把所有内容无差别塞进日志，也不是强求保存完整的模型内部思维链。目标是让有权限的审查人员能理解决策事实、重建当时的输入和政策版本、核对关键推断、复核评测步骤，并确定最终业务决定由谁作出。

### 6.1 一次运行至少要记录什么

| 类别 | 建议记录的关键字段 | 用途 |
| --- | --- | --- |
| 决策身份 | `decision_id`、案件引用、用例 ID、时间戳、请求来源、运行 ID | 关联请求、模型运行、审核和最终业务动作 |
| 输入和证据 | 输入快照/版本、数据水位、文件哈希、检索结果 ID、页码/段落、证据引用 | 还原当时模型实际可见的材料 |
| 模型与配置 | Provider、模型 ID/可用版本、部署区域、系统 Prompt 版本/hash、模板版本、参数、工具版本、检索配置 | 说明当时运行的是哪套配置 |
| 结构化推断 | 抽取字段、支持/反对证据、缺失/冲突信息、适用政策条款、校验结果 | 把事实、假设、证据和规则依据拆开检查 |
| 决策结果 | 建议状态、理由代码、受限的自然语言说明、规则版本、升级标志、延迟原因 | 支持审计、趋势分析和下游处理 |
| 人类处置 | 审核人/角色、最终决定、批准/驳回/修改/升级、理由代码、备注、时间戳 | 证明实际发生了什么，而非仅证明界面出现过审批按钮 |
| 评估与运行 | 规则验证结果、引用校验、耗时、失败类型、重试记录、监控标签 | 追踪生产质量、故障和成本 |
| 版本和完整性 | 记录 Schema 版本、策略版本、内容哈希、追加式写入标识、审计日志引用 | 检测事后改写并维持关联 |

**日志必须关联到模型真正看到的输入，而不是只关联到一个后来可能改变内容的引用。** 在满足隐私、保留期限和安全要求的前提下，记录稳定的快照 ID、版本和哈希；需要保留实际材料时，放在受控存储中，按角色授权、加密并设置保留和删除策略。不要为了审计而永久保存不必要的敏感个人信息，也不要把包含机密的 Prompt 和材料写入普通应用日志。

对于第三方模型，供应商可能更新模型实现，或无法保证同一请求未来得到逐字节相同的结果。应把**可复核性**和**完全确定性重放**区分开来：前者要求有当时的输入、配置、版本、证据、规则与最终处置记录；后者要求相同环境产生完全相同输出，往往不是托管 LLM 能保证的。记录实际能提供何种重放与复现能力，不要承诺无法保证的确定性。

### 6.2 简化的 Decision Record 示例

以下是建议的数据契约，不是某个供应商的固定 Schema。生产实现应按数据分类、访问策略与业务流程调整。

~~~json
{
  "decision_id": "dec-2026-10-13-000184",
  "use_case_id": "internal-risk-review",
  "case_ref": "case-opaque-reference",
  "created_at": "2026-10-13T10:15:30Z",
  "policy": {
    "policy_id": "risk-review-policy",
    "version": "3.4",
    "effective_at": "2026-10-01"
  },
  "input_snapshot": {
    "snapshot_id": "snapshot-7f21",
    "content_hash": "sha256:...",
    "source_refs": [
      {
        "source_id": "document-019",
        "version": "v12",
        "location": "page 8, paragraph 3",
        "claim_ref": "evidence-001"
      }
    ]
  },
  "model_run": {
    "provider": "approved-provider",
    "model_id": "approved-model-version",
    "system_prompt_version": "decision-prompt-12",
    "output_schema_version": "decision-schema-4",
    "toolchain_version": "review-flow-6"
  },
  "assessment": {
    "status": "insufficient_evidence",
    "findings": [
      {
        "criterion_id": "KYC_DOCUMENT_CURRENT",
        "result": "unknown",
        "supporting_evidence": [],
        "contradicting_evidence": [],
        "missing_evidence": ["current_verified_document"],
        "reason_code": "MISSING_REQUIRED_EVIDENCE"
      }
    ],
    "policy_checks": [
      {
        "rule_id": "R-017",
        "rule_version": "3.4",
        "result": "not_evaluable"
      }
    ],
    "validation": {
      "schema_valid": true,
      "citations_resolved": true,
      "policy_checks_passed": false
    }
  },
  "recommendation": {
    "outcome": "escalate",
    "reason_codes": ["MISSING_REQUIRED_EVIDENCE"],
    "human_review_required": true
  },
  "human_disposition": {
    "review_status": "pending",
    "final_decision": null,
    "override_reason": null
  },
  "integrity": {
    "record_schema_version": "1.0",
    "previous_record_hash": "sha256:...",
    "record_hash": "sha256:..."
  }
}
~~~

生产系统还应定义状态之间的合法转换，明确哪些字段由模型生成、哪些由程序计算、哪些只能由有权限人员填写。模型不能自行声称政策“已通过验证”，也不应能够伪造审核人身份或自行填充最终审批字段；这些信息必须由实际校验与审批系统写入。

### 6.3 增加日志不等于建立审计能力

日志只有在可检索、受访问控制、保留期限清晰、不可被普通业务流程静默覆盖，而且能把输入证据、模型运行、政策版本和最终处置关联起来时，才真正支持审计。应明确谁能查看原始输入、谁能修改 Prompt 和政策、哪些变化要求重新评测、如何定位历史决策，以及发生错误后如何识别受影响的案例并补救。

高影响系统可考虑追加式 Decision Record、独立审计日志、内容哈希或其他防篡改存证方式。这些机制有助于检测记录修改，但哈希本身不证明原始事实真实、结论正确或业务政策适用；数据来源和访问控制同样重要。

## 七、人工复核怎样设计，才不会变成走形式？

人类监督不是让人替模型签字，而是让人有机会发现错误，并有足够信息和权力改变结果。

### 7.1 按风险决定自动化程度

风险评估应考虑决策影响、可逆性、AI 自主程度、错误损害、数据敏感性、第三方依赖、输出稳定性和解释难度。以下是工程示例，不是通用监管分级。

| 级别 | 例子 | 推荐处置 | 主要控制 |
| --- | --- | --- | --- |
| 低影响、可逆 | 内部材料分类、会议摘要、非关键任务路由 | 在限定范围内自动生成，保留抽样复核 | 来源校验、基本日志、错误反馈、质量监控 |
| 中等影响 | 调查线索排序、工单优先级、非最终风险提示 | AI 提供建议，有权限人员决定后续动作 | 结构化证据、缺失信息、审核轨迹、分层抽样 |
| 高影响或低可逆 | 影响客户权益的判断、重大风险评级、投资/承保建议、关键合规处置 | 降低自动化程度；在无法证明控制有效前采用实质人工决定或双人复核 | 独立验证、决策延迟机制、政策一致性、例外监控、正式审批 |

这不是说所有金融判断都必须人工，也不是说内部使用就可以自动化。自动化程度应由实际风险和验证结果支持。如果 AI 无法提供足够的透明度和可复核性，应考虑缩小职责、改变流程或换用更容易验证的模型，而不是用免责声明解决问题。

### 7.2 审核人员必须看得到证据，而不只是结论

审查界面至少应显示：

1. 案件关键事实和来源位置，能够返回原材料；
2. 哪些字段是直接提取的事实，哪些是模型推断；
3. 支持结论的证据、反向证据、矛盾材料和缺失项；
4. 对应的政策条款、必须满足的条件和未通过的规则；
5. 模型限制、未决问题以及要求升级的原因；
6. 人工可执行的动作：接受、修改、拒绝、要求补充资料、升级或暂缓，并记录实际原因。

对重大决策，可以“先展示事实与证据、再展示模型建议”，或要求审核人先作独立初判，再对照 AI 建议。这不能完全消除锚定，但可为测量推荐对人的影响提供条件。

### 7.3 衡量审核质量，而不是只数审批数量

“100% 经过人工审批”不能证明监督有效。应测量人工与模型分歧率、推翻率和升级率；人工识别错误建议的能力；不同风险级别和工作量下的审核质量；审核所需时间、回看证据比例、补件率和未解决冲突；以及独立盲审发现的漏判。

推翻率本身既不应越高越好，也不应越低越好。高推翻率可能意味着模型质量差，也可能反映审核人员发现了不适用案例；低推翻率可能意味着模型好，也可能说明审核流程成了橡皮图章。必须结合盲审、真实结果与任务设计一起分析。

## 八、怎样验证 Decision Model：从模型评测走向决策系统评测

通用 benchmark 或几个成功案例不足以证明系统适合金融业务。MAS 的 AI 风险管理材料强调针对实际用例和工作流做评测，而不只是引用模型的一般能力；NIST 则建议以经验测试验证能力主张、审核来源并持续监控。

建立一套由领域专家核验的历史案件和合成边界案例组成的测试集，覆盖正常、缺失、矛盾、边界、罕见和恶意输入。每个版本都记录评估所用数据、Prompt、模型、规则及执行环境。

| 评估维度 | 示例指标 / 检查 | 目的 |
| --- | --- | --- |
| 事实抽取 | 字段精确率/召回率、金额/日期/实体错误、缺失值处理 | 避免输入事实在抽取阶段被扭曲 |
| 证据可靠性 | 引用可解析率、引用支持结论的正确率、关键结论无引用比例 | 防止捏造引用或引用不支持判断 |
| 政策一致性 | 必要条件通过率、禁止项漏检率、规则执行差异 | 验证建议是否符合明确政策 |
| 决策质量 | 专家基准一致率、错误接受/拒绝率、重大错误率 | 衡量最终业务判断 |
| 不确定性处理 | 应升级案例的正确升级比例、缺证时强行结论的比例 | 验证模型是否知道何时不该作决定 |
| 解释质量 | 证据完整性、反面证据覆盖、理由与事实/政策一致性 | 检查解释是否能帮助复核 |
| 稳定性 | 同一输入重复运行差异、措辞顺序扰动、模型升级前后变化 | 找出对偶然上下文过度敏感的情况 |
| 公平与偏差 | 适当时按相关群体或代理变量做差异分析 | 发现不合理的群体影响 |
| 对抗与安全 | Prompt injection、恶意文档、冲突指令、越权调用、数据泄露测试 | 验证不可信输入不能改变系统政策或越权 |
| 人机协作 | 有/无 AI 建议时的人工准确率、错误识别率、复核时间、盲审结果 | 证明人工监督确实改进而不是削弱判断 |

对于高影响决策，不能只用整体准确率掩盖少数严重错误；应对重大错误单独定义不可接受类型和处置标准。

### 8.1 低成本的消融与反事实测试

- **删掉关键证据：** 是否转为缺证或升级，还是仍给出相同强度的结论？
- **加入反向证据：** 系统是否识别冲突，还是继续支持第一次判断？
- **改变不影响业务含义的措辞或排列顺序：** 结论是否大幅波动？
- **替换过期政策：** 是否使用正确生效时点的版本？
- **提供无关、不可访问或恶意文档：** 是否凭空引用，或被注入文本覆盖系统规则？
- **与专家独立判断对照：** 关键案例先收集人工判断，再展示模型输出，测量错误识别与锚定影响。
- **比较版本：** 对模型、Prompt、检索配置或策略变更建立回归测试，检验差异是否在批准范围内。

不要只问“理由是否听起来合理”，而应验证证据移除、证据冲突或规则变化时，输出是否按预期变化，以及这种变化是否可检查。

### 8.2 独立 Reviewer 有用，但不是独立真理来源

另一个模型可以发现部分不一致、缺证或不合规则之处。不过，如果两个模型共用同样的背景材料、Prompt 偏见和不充分的政策表达，它们可能一起犯错。Reviewer 不能保证正确性。

更稳妥的组合是：机器规则和 Schema 检查负责确定性错误；独立引用校验器检查引用能否定位并支持陈述；第二模型提供额外挑战；再按风险等级进行独立人员抽样或正式审核。对硬约束，应让程序直接验证，而不是再让 LLM 自己判断自己是否违规。

## 九、从治理文档到可运行控制：上线前建立哪些资产？

| 资产 | 主要内容 | 更新触发 |
| --- | --- | --- |
| AI Use-case Inventory | 用途、业务所有者、使用人、输入输出、影响对象、风险等级、供应商依赖、自动化范围 | 新用例、用途变化、自动化范围扩大 |
| Decision Contract | 状态机、输入/输出 Schema、缺证处理、权限边界、升级条件、最终责任 | 政策或业务流程改变 |
| Policy / Rule Catalogue | 规则 ID、版本、解释、生效日期、优先级、例外批准权和测试 | 政策更新与例外变更 |
| Evidence & Data Register | 来源系统、数据所有者、版本和时点语义、质量要求、访问控制、保留政策 | 新数据源、权限或口径变化 |
| Model/System Card | 模型供应商和版本、适用范围、限制、评测结果、已知失败模式、批准用途 | 模型或系统版本变更 |
| Prompt & Tool Registry | 版本化的系统 Prompt、模板、Schema、检索参数、工具权限、构建版本 | 每次实质性变更 |
| Evaluation / Validation Report | 基准案例、指标、边界测试、错误分析、阈值、残余风险与放行结论 | 发布前、定期复验和重大变更 |
| Decision Record Store | 单次运行的输入快照引用、证据、政策、输出、验证、人工处置与完整性信息 | 每次受控决策运行 |
| Monitoring & Incident Log | 生产指标、越权/错误事件、数据质量、漂移、覆盖率、例外、补救和根因分析 | 持续记录 |
| Human Review Procedure | 审核角色、所需证据、挑战方式、升级路线、盲审抽样和培训 | 流程调整或审计发现 |

可从 [Model Cards for Model Reporting](https://doi.org/10.48550/arXiv.1810.03993) 和 [Datasheets for Datasets](https://doi.org/10.48550/arXiv.1803.09010) 思路出发，形成模型和数据的文档化资产；但它们不能代替单次运行的 Decision Record，也不能代替正式政策、验证和审批。

## 十、分阶段落地：先补决策契约与审计，再逐步改架构

不建议一开始就重写成复杂的 Agent 平台，也不建议只修改一个 Prompt 就宣布解决了可解释性问题。可以从一个有代表性的 JEV 类 Decision Model 开始。

### 第 1 阶段：给当前模型建立基线

盘点 Prompt、输入来源、输出结构、政策依据、模型供应商/版本、人工复核方式、失败案例和下游动作。收集经领域专家核验的历史案件，对决策正确性、证据充分性、稳定性与人工复核质量建立基线。明确数据留存和访问策略。

**交付物：** 用例风险评估、当前流程图、失败分类、历史测试集、未满足控制清单。

### 第 2 阶段：结构化输出并保存 Decision Record

把自由文本输出收敛为 Schema：判断状态、理由代码、支持证据、反向证据、缺失项、相关政策、下一步动作和升级标志。每次运行记录输入快照/版本、Prompt 与模型配置、证据引用、校验结果和人工处置。为不确定、冲突及越权设置明确的升级通道。

**交付物：** Decision Contract、输出 Schema、可检索的决策记录、引用解析及 Schema 校验。

### 第 3 阶段：增加政策校验与实质性人工复核

把可形式化的硬条件移入版本化规则层；由独立程序核查必要条件和权限边界。改造审核界面，让审核人员能返回源证据、看到缺失/冲突项，并接受、修改、驳回或升级。对高影响用例试行独立初判、随机盲审和质量抽样。

**交付物：** 规则测试、独立验证器、审核操作日志、决策延迟机制和升级流程。

### 第 4 阶段：以真实业务表现决定是否扩大自动化

基于历史数据和受控试点持续评估错误、引用可靠性、政策一致性、人工判断质量、群体影响、运行成本和业务效果。只有当证据表明控制有效、残余风险在机构风险容忍度内，才扩大自动化范围。模型、Prompt、工具和政策发生重大变化时重新评估，并准备回退方案。

**交付物：** 独立验证报告、放行门槛、持续监控、变更审批、回滚和事故响应流程。

## 十一、哪些措施最值得优先投入？

| 措施 | 优先级 | 原因 |
| --- | --- | --- |
| 结构化输出 + 证据引用 + 缺证状态 | 最高 | 是下游校验和人工复核的基础 |
| Decision Record 与输入/配置版本 | 最高 | 支持追溯决策、定位失败和分析历史影响 |
| 可形式化政策的独立规则检查 | 高 | 避免硬性条件完全依赖自然语言推断 |
| 独立验证集与回归门禁 | 高 | 发现 Prompt、模型、数据和检索变化导致的质量回退 |
| 风险分级、人工复核与决策延迟 | 高 | 使自主程度与业务风险相匹配 |
| 审核质量和自动化偏差的实证评估 | 高 | 确认人在环是否真正提高决策质量 |
| 第二个 LLM Reviewer / 多 Agent | 视需要 | 能提供额外挑战，但不能替代确定性验证与独立治理 |
| 仅增加 CoT 或更详细的解释 Prompt | 低，不能单独解决 | 解释可能不忠实，也未必改善人的判断 |


## 十二、如何设计一套可复用的 Decision Model Evaluation？

Decision Model 的评测不能只测试“模型答对了多少题”，也不能只靠专家读几十个输出后觉得“整体不错”。需要把**判定质量、证据质量、政策符合性、升级行为、人工复核效果和生产运行稳定性**分别测量，并规定哪些失败可以接受、哪些失败必须阻止发布。

这与一般文本生成评测不同：金融业务中的不同错误有不同后果。漏掉一个必须升级的高风险案件，可能远比摘要措辞不够优雅严重；结论偶然正确但没有证据，也未必能满足控制要求。

### 12.1 先定义被评测的对象：不是一个 Prompt，而是一项决策能力

每个用例都应明确决策目标、输入和证据边界、适用政策版本、模型与检索配置、最终决定由谁作出，以及失败时如何处理。评测单位应是一次完整的决策运行，并能追踪到该次运行所使用的输入快照、证据包、政策版本、模型配置和最终业务处置。只评测孤立的模型回答，容易漏掉检索、规则、集成、界面和权限问题。

| 评测对象 | 必须明确的问题 | 建议产物 |
| --- | --- | --- |
| 业务决策 | 系统正在帮助决定什么？输出是建议还是可以触发动作？ | 决策契约、合法状态转换、禁止行为 |
| 案件与证据 | 在给定时点，模型实际可以看到哪些材料？ | 带版本/快照的案例集、证据定位、缺失项标签 |
| 政策与规则 | 哪个版本在何时生效？哪些是硬规则，哪些需要专业判断？ | 版本化规则目录、可执行规则测试 |
| LLM 配置 | 模型、Prompt、输出 Schema、检索与工具配置是什么？ | 可复核的运行配置与变更记录 |
| 最终处置 | 推荐、升级与最终审批分别由谁决定？ | 结果标签、人工处置记录、失败分类 |
| 运行环境 | 检索超时、工具不可用或供应商模型更新时会怎样？ | 故障注入测试、降级与恢复测试 |

### 12.2 构造可信的 Gold Set：历史决定不等于绝对正确的 Ground Truth

金融业务往往积累了大量历史人工决定，但不应直接把这些决定全部作为正确标签。人工判断可能存在噪声、标准变化、样本选择偏差以及不同审核人员之间的不一致性；如果历史标签本身反映过去的偏差，模型仅仅复刻它们，也不一定代表业务质量提高。

2024 年发表于《International Review of Financial Analysis》的研究 [Human-AI collaboration to mitigate decision noise in financial underwriting](https://www.sciencedirect.com/science/article/pii/S1057521924000814) 讨论了一家金融科技放贷企业的承保实践，分析人工审核决定中的不一致性，并提出 Evidential Reasoning-eXplainer，通过多项独立、可能相互冲突的证据以及贷款规则的权重与可靠性来支持分析。该研究不是 LLM 评测，也不能证明该方法适用于所有承保场景；可迁移的教训是：**让 AI 复刻人之前，要先评估“人原本怎样决定”是否一致、政策是否被准确表达、标签是否可信。**

建议按以下方式构建测试集：

1. **保留真实分布与困难案例。** 从生产历史中按业务类别、时间、风险等级、数据来源和结果状态抽样，并补充低频但重要的稀有/边界案例。测试集不能全是容易判断的成功案例。
2. **由领域专家独立标注。** 对重要案例采用至少两位经过培训的专家独立判断并记录分歧；通过明确的 adjudication 机制解决分歧，而不是为了获得一个标签而隐藏意见。
3. **分开标记事实与政策判断。** 哪些事实确实在来源中、哪些资料缺失、政策是否适用，与最终业务结论是不同的标注维度。
4. **记录时点与政策版本。** 历史案件应使用当时有效的政策；若用当前政策重评历史案件，应标为反事实测试，不能混入原始标签。
5. **防止评测集泄漏。** Prompt 调优期间反复查看的案例不应再被视为完全独立的最终验证集。保留 holdout set，并按时间切分检查新时期数据上的泛化。
6. **管理数据权限。** 对客户、交易或调查材料进行脱敏/假名化，控制访问和保留期限；合成数据可补充边界测试，但不能取代对真实分布和材料质量的验证。

### 12.3 使用分层 Evaluation，而不是一个总分

建议将评测拆为四层。前面层级失败，后续结论的质量就失去了基础。

| 层级 | 主要问题 | 例子与指标 |
| --- | --- | --- |
| L0：输入与证据 | 数据完整吗？引用能定位吗？证据是否过期或互相矛盾？ | 必需字段完整率、快照可复现率、引用可解析率、来源覆盖率 |
| L1：事实与政策 | 提取事实是否准确？适用政策与硬性条件是否正确？ | 字段精确率/召回率、事实错配率、规则通过率、禁止项漏检率 |
| L2：决策建议 | 建议是否正确、理由是否有证据支持、何时升级？ | 错误接受/拒绝率、严重错误率、证据支持率、缺证强判率、升级召回率 |
| L3：业务流程与运行 | 人能否正确复核？动作是否越权？版本更新后是否退化？ | 人工推翻/漏判、复核质量、越权动作数、p95 延迟、单案成本、生产漂移 |

每一层都应有明确的失败标签，例如来源缺失、使用过期政策、事实抽取错误、结论无证据支持、违反政策、遗漏升级、人工推翻、未经授权的动作。错误归因比一个准确率数字更有用，因为不同错误需要不同修复方式。

### 12.4 用风险加权指标，而不是只看整体 Accuracy

假设测试集 95% 是低风险常见案件，即使系统把这些都答对，也可能因为漏掉少数高影响例外而不可上线。建议至少报告：

- **错误接受率与错误拒绝率：** 按业务含义定义类别，不要把所有错误合并成一种。
- **重大错误率：** 将违反禁止规则、遗漏强制升级或无证据支持重大结论等设为单独指标，不能被大量简单样本稀释。
- **升级召回率与过度升级率：** 应转人工的案例有多少被正确转交；系统是否把太多普通案例都升级，造成审核队列失效。
- **证据支持率：** 每个关键结论是否有可解析且真实支持该结论的证据；引用存在但内容不支持结论，仍应判失败。
- **政策符合率：** 硬规则应由代码直接检查，不应完全依赖 LLM Judge 给分。
- **校准与覆盖率：** 只有输出概率经过真实案例校准时，才报告 Brier score、可靠性曲线或 Expected Calibration Error。若系统有自动处理门槛，可绘制 coverage-risk curve，观察扩大自动处理范围时风险如何变化。
- **人机联合表现：** 对照专家独立判断、专家看到 AI 建议后的判断和最终结果，测量 AI 是否改善或伤害审核质量。
- **分组差异：** 在合法、适当且隐私保护充分的前提下，检查不同相关群体、地区、产品和数据来源中的错误差异。

不要直接把模型自报的 confidence 作为概率指标。如果没有校准数据，宁可使用证据完整性、规则通过情况以及是否触发升级等可验证信号。

### 12.5 评测不仅问“答对了吗”，还要问“凭什么、遇到变化会怎样”

| 测试类型 | 构造方式 | 预期行为 |
| --- | --- | --- |
| 证据消融 | 删除一条关键证据或必要字段 | 标记缺证或升级，而不是维持确定结论 |
| 反向证据 | 加入可信但与主要结论冲突的材料 | 显示冲突，交由规则或人工处理 |
| 政策版本 | 切换到不同生效日期的政策，或加入已失效条款 | 使用适用时点版本，无法判断则升级 |
| 输入扰动 | 改变不影响业务含义的措辞、材料顺序或排版 | 不应出现无法解释的重大结论变化 |
| 缺失与歧义 | 缺失身份字段、日期冲突、同一实体多个记录 | 显式表示未知/歧义，不补造信息 |
| 对抗输入 | 文件嵌入要求忽略政策或泄露信息的指令 | 将文件视为证据而非控制指令，权限与政策不变 |
| 工具/数据失败 | 检索超时、数据库不可用、来源权限被撤销 | fail closed 或按批准的降级方案处理，不静默使用过期数据 |
| 模型与 Prompt 变化 | 升级模型、Prompt、检索、规则或输出 Schema | 运行完整回归集并分析差异是否在批准范围内 |
| 复制与重放 | 同一案例在同一配置下反复运行 | 测量随机变化；关键状态和硬约束必须持续合规 |

### 12.6 LLM-as-a-Judge 可以扩展测试，但必须先验证 Judge

自然语言理由、证据是否相关、解释是否完整等维度，很难完全靠精确字符串匹配评估，因此 LLM Judge 可以作为辅助评分器。但“另一个更强模型说合格”不构成独立证明。

2025 年发表在 ACL Anthology 的 [Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge](https://aclanthology.org/2025.ijcnlp-long.18/) 发现，LLM Judge 可能表现出位置偏差，其一致性会随 Judge、任务和候选答案变化。2024 年的 [Systematic Evaluation of LLM-as-a-Judge in LLM Alignment Tasks](https://arxiv.org/abs/2408.13006) 也报告，Prompt 模板会影响评估结果，相关实验中 Judge 与人类评估者只有中等程度的一致性。

建议采取以下护栏：

- 先在专家已标注的样本上验证 Judge 的假阳性、假阴性和人类一致性；
- 对候选答案做随机顺序、交换顺序和重复评分测试，检查位置偏差与重复稳定性；
- 对关键证据、政策违反、重大错误和权限边界使用代码校验或专家复核；
- 对开放式质量指标采用清晰 rubric，并对高风险样本进行人工复核；
- 评估 Judge 本身的模型和 Prompt 变化，避免“被测模型看似提升，只是评分器变了”。

### 12.7 把测试变成发布门禁与生产飞轮

Anthropic 于 2026 年发布的 [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) 建议结合代码评分器、模型评分器和人工评分器，记录完整 trajectory/trace 与真实 outcome，并针对非确定性任务运行多次试验。这个思路可迁移到 Decision Model，但还需要增加金融决策的政策、证据、风险重大性和问责维度。

建议设计三类门禁：

1. **硬门禁：** 输出 Schema 不合法、引用无法解析、缺少必需证据、硬性政策违反或未经授权的动作，不能靠其他项目高分“平均通过”。
2. **质量门禁：** 错误接受率、严重漏判、证据支持率、升级召回率和人工复核质量，按用例风险设定验收阈值。
3. **运营门禁：** 供应商/模型/Prompt/政策变更、数据源失效、漂移或严重事故应触发重新评测、缩小自动化范围、暂停或回退。

上线初期可使用 shadow mode：模型生成建议但不触发业务动作，与真实流程并行比较；之后在明确的低风险范围进行受控试点。上线后持续抽样复核生产记录、纳入新失败案例、分析根因并扩展回归集。Evaluation 才不是一次性的审批附件，而是持续监督决策能力的机制。

## 十三、Decision Model 与普通 LLM Agent：相似的技术底座，不同的成功标准

Decision Model 可以使用 Agent 作为运行时，但两者不是同一种治理对象。一般任务型 Agent 通常接受一个目标，通过多轮调用工具、观察结果和调整策略完成任务。Decision Model 的核心则是在特定案件、特定时点和批准政策下，产生受约束、可复核、可问责的决策建议，并按规定交由下游流程或人工。

| 维度 | 一般任务型 LLM Agent | 受治理的 Decision Model |
| --- | --- | --- |
| 首要目标 | 完成研究、代码修改、数据搜集、工单处理等任务 | 对指定业务问题作合规、一致、可复核的判断或建议 |
| 成功定义 | 任务是否完成、最终状态是否正确、效率与交互质量 | 决策是否符合政策、证据是否充分、风险是否分类正确、升级与审批是否正确 |
| 行动空间 | 可能自主选择工具、调用顺序和计划；范围由运行框架与权限系统约束 | 尽量缩小决策输出和动作集合；改变业务状态必须经过明确门禁 |
| 状态与上下文 | 对话状态、计划、中间结果和工具执行状态 | 还必须绑定案件快照、政策版本、生效时间和可引用证据 |
| 输出 | 可接受多种完成路径和表达方式 | 需要明确 Schema、标准化状态和理由代码，避免自由文本成为唯一结果 |
| 审计对象 | 完整轨迹、工具调用、外部副作用和最终结果 | 除上述记录外，还须保存关键判断依据、政策映射、验证与人类最终处置 |
| 失败策略 | 允许重试、重新计划或换工具；必要时报告失败 | 证据不足、政策冲突、数据过期或越权时使用正式状态，不得不断重试直到强行得出结论 |
| 评价重点 | 任务成功率、工具参数、轨迹质量、完成时间、成本、安全边界 | 决策质量、重大错误、证据支持性、政策符合性、升级质量、人工复核有效性与审计完整性 |
| 人工参与 | 按任务选择监督、审批或处理副作用 | 按业务风险与职责规定，明确哪些结果只能建议、必须批准或需要双人复核 |
| 变化管理 | 模型/工具更新后回归任务能力和安全性 | 还要重跑业务政策、历史案例、决策边界及受影响决策的影响分析 |

Anthropic 对 Agent 的工程方法强调长流程、多轮工具调用、状态变化和完整轨迹；其 Evaluation 因而同时检查最终结果与过程。但在受监管的 Decision Model 中，仅验证任务是否完成还不够：系统可能“成功”输出一个结论，却使用了错误政策、过期证据或未经授权的工具。

反过来，Decision Model 也不必是僵化流程。LLM/Agent 可以解析非结构化材料、检索证据、识别冲突并建议下一步补充什么。关键区别是：**Agent 的灵活性放在证据搜集和辅助分析层，最终决策权、政策执行和业务副作用被显式控制。**

### 13.1 最实用的边界：Agent 可以探索，Decision Gate 决定能否落地

- **只读证据工具：** 检索批准的政策库、读取特定案件资料、查询授权数据。每次调用都记录来源、时间、查询范围和返回快照。
- **分析与校验工具：** 事实抽取、引用解析、规则求值、风险分类、差异对账。这些工具需要独立测试，不能把模型自己的判断当作验证结果。
- **产生业务副作用的工具：** 更新案件状态、发布结果或触发客户流程。必须由独立授权与门禁控制，并要求前置条件通过；高风险动作需要有权限人员批准。

不能仅因模型用自然语言宣称“已经合规”就让它执行最终动作。工具 API 本身应强制执行权限与状态转换约束。重试、交接、超时、部分完成、重复执行和补偿也必须有明确的幂等与恢复机制。

### 13.2 轨迹可见不等于决策可解释

Agent trajectory 能说明调用了哪些工具、得到什么结果、何时失败，但不一定说明业务结论的依据成立。Decision Record 应把轨迹关联到具体判断：证据 ID 与来源片段、案件事实及来源、政策条款与版本、条件求值结果、LLM 建议与系统最终状态的差异，以及人工接受、修改、推翻或升级的处置记录。这样既保留 Agent 的可观测性，又补上业务决策的审计链。

## 十四、业界实践案例：怎样借鉴，哪些不能过度推论？

公开材料中，金融服务业较常见的早期生成式 AI 落地是内部检索、摘要、知识支持和运营辅助，而不是直接让通用 LLM 独立决定贷款、承保或客户风险。公开案例多由机构或供应商描述，可说明工程模式与采用情况，但不一定独立证明长期风险效果。

### 14.1 日本央行 2026 年调查：采用率上升，但治理成熟度仍是瓶颈

日本央行 2026 年 8 月公布的金融机构生成式 AI 调查以 **150 家金融机构**为对象。调查显示，超过 90% 的受访机构正在使用或试验生成式 AI；应用正从一般事务扩展到利用客户信息的核心业务，但直接把生成式 AI 输出展示给客户的机构仍有限。对评估效果，不少机构认为“可用于业务，但仍需改善”；相当数量的机构仍把治理、第三方风险、安全和信息保护列为需要加强的领域。

来源：[Bank of Japan — Use and Risk Management of Generative AI by Japanese Financial Institutions (FY2026 survey)](https://www.boj.or.jp/en/research/brp/fsr/fsrb260824.htm)。

这份调查不是某个模型的受控实验，也不证明特定技术能减少多少风险。它说明业务试用与可规模化的受控使用是两件事：模型能处理核心业务材料，不代表机构已经能解释、记录、评测和管理其判断；第三方依赖、信息安全和结果不确定性需要一并管理。

### 14.2 英国央行与 FCA：完全自主决策比例低，企业自评存在理解缺口

英国央行和 FCA 在 2024 年发布的金融业 AI 调查收到 **118 家机构**回应。调查显示，75% 的受访机构已使用 AI，基础模型占被报告 AI 用例的 17%；55% 的用例具有一定程度的自动化决策，但只有 2% 的用例完全自主；62% 的用例被机构自评为低重大性，16% 被自评为高重大性。84% 的企业表示有 AI 责任人，但只有 34% 表示对所用 AI 技术有“完整理解”，46% 仅有“部分理解”。

来源：[Bank of England — Artificial intelligence in UK financial services, 2024](https://www.bankofengland.co.uk/report/2024/artificial-intelligence-in-uk-financial-services-2024)。

这些数字来自企业自报调查，并不是监管部门对每个系统逐一认证。它们仍揭示两个与 Decision Model 直接相关的事实：金融业采用 AI 不等同于把最终决定完全自动化；有责任人也不能自动解决模型理解与可验证性问题。责任、可观察性与独立验证需要成为具体控制。

### 14.3 Morgan Stanley：把 Evaluation 做成上线机制，而不只是发布前测一次

OpenAI 公布的 Morgan Stanley 案例描述了财富管理内部 Assistant 与 Debrief。公开材料称，Assistant 已被超过 98% 的顾问团队使用；团队针对真实业务问题建立 Eval，包括摘要质量、信息检索和翻译等任务，由顾问和 Prompt 工程师评价准确性与连贯性并持续迭代。Debrief 将会议记录整理成客户笔记和后续事项，顾问在最终定稿前仍会检查和修改；团队也维护日常回归测试样例，以发现合规输出与检索质量的变化。

来源：[OpenAI — Morgan Stanley uses AI evals to shape the future of financial services](https://openai.com/index/morgan-stanley/)。

这是一份供应商发布的客户案例，应把采用率和效果数据视为机构/供应商的公开描述，而不是独立审计结论。其公开用例主要是**内部知识检索、摘要和顾问工作流辅助**，不能据此说通用 LLM 已经能够独立完成信用审批或风险决策。可借鉴之处是 Eval-driven development、业务专家评分、持续回归测试，以及员工对会影响后续业务流程的生成内容进行检查和修改。

### 14.4 信贷承保研究：先评估人的判断，再评估 AI

Sachan 等人 2024 年关于金融科技贷款承保的研究，从人工审核决定中的不一致性入手，分析怎样用证据权重与规则可靠性改善决策支持。它不是通用 LLM Agent 实现，也不是可以原样复制的生产架构；它说明金融机构构建 Decision Model 时，不能仅把历史审批记录当作无误差标签，也不应假设人工判断天然一致。

可以抽取三项工程做法：明确每条业务规则的可靠性与权重；在存在冲突证据时表达证据强度，而不是把所有信息压成一个无来由的分数；对专家分歧建立审查与治理流程，并用独立结果评测 AI 是否真正提高一致性和质量。

### 14.5 传统信贷模型的可解释性研究：可以借鉴什么，不能直接套用什么？

FinRegLab 与斯坦福商学院的研究从不同角度评估了传统机器学习信贷承保模型的解释性、公平性和模型诊断工具。其 [Machine Learning Explainability & Fairness: Insights from Consumer Lending](https://finreglab.org/research/machine-learning-explainability-fairness-insights-from-consumer-lending/) 研究比较了七家技术公司的诊断工具和若干开源工具；相关研究关注这些工具能否提供理解单个申请人预测、群体层面的模型行为、以及模型整体行为所需的信息。FinRegLab 在 2026 年又发布了面向消费信贷模型管理的 [Framework for Managing Machine Learning Models in Consumer Credit Underwriting](https://finreglab.org/research/explainability-and-fairness-in-machine-learning-for-credit-underwriting/)，该工作反映了其与美国银行在 OCC Project REACh 框架下的讨论。

这类研究与 LLM Decision Model 密切相关，但两者不能混为一谈。

| 传统评分/机器学习模型 | 基于 LLM 的 Decision Model |
| --- | --- |
| 典型输出是分数、概率、分类或排序 | 输出可能是事实抽取、规则解释、证据综合与自然语言建议 |
| SHAP、特征重要性、局部解释等可辅助分析特定输入特征对模型输出的贡献，但其结果依赖模型、背景分布和解释方法 | 不能把特征归因直接映射为 Prompt、上下文或生成文本的“真正原因”；LLM 生成的理由也不一定忠实反映输出成因 |
| 业务理由码通常要映射为具体、可审核的输入因素，并做准确性与一致性测试 | 还要验证每项事实是否在原材料中、引用是否支持结论、采用的政策是否正确，以及模型是否遗漏反向证据 |
| 传统模型可通过独立模型诊断、群体差异与稳定性测试检查行为 | 除业务结果与公平性测试外，还需测试引用幻觉、上下文/Prompt 敏感性、拒答/升级行为及恶意文档影响 |

可迁移的原则是：解释工具本身也需要验证，不能因为工具输出了一张 SHAP 图、特征重要性榜单或一段 LLM 理由，就认为解释正确。对于 LLM Decision Model，应优先使用可回到原始来源的证据引用、规则求值和版本记录；如果同时存在传统评分模型，则分别保留评分模型的特征级诊断和 LLM 的证据级记录，再将两者按明确的数据契约组合起来。

对受消费者保护、拒绝原因披露或公平放贷规则约束的用途，还应让合规与法律团队验证理由是否具体、准确且真正对应适用的决策因素。不能让生成式模型凭空编造拒绝原因，也不能把一个听起来合理的文字理由当作模型影响该案件的真实特征解释。

### 14.6 从案例中抽取一个可复用的模式

| 可借鉴实践 | 适合解决的问题 | 不能由此推断什么 |
| --- | --- | --- |
| 真实业务案例集与专家评估（Morgan Stanley） | 提高摘要、检索和生成内容的业务可靠性 | 不能证明覆盖了所有决策风险或允许全自动决策 |
| 按风险分级并保持人类责任（BoE/FCA、MAS、BoJ 的治理方向） | 决定哪些用例可自动化、哪些需要更强监督 | 不能只靠机构自评证明控制有效 |
| 先评估人类判断噪声与规则可靠性（承保研究） | 识别历史标签质量与政策表达问题 | 不能把研究方法未经验证地迁移到所有产品和地区 |
| 评测、回归、运行监控结合 | 在模型、Prompt、数据和检索变化后发现退化 | 不能把某次离线评测结果当作永久上线保证 |

## 十五、给 JEV 类 Decision Model 的建议实施蓝图

落地时不必一开始就把一个 Prompt 改成多 Agent 系统。建议先把当前调用置于固定的决策契约与证据管道中，再按真正的失败模式增加组件。

### 15.1 第一版：结构化与可追溯，不急于自治

对每次判断生成唯一 decision ID，并把以下对象绑定在一起：

- **CaseSnapshot：** 本次案件的关键输入字段、相关材料版本与快照哈希；
- **EvidencePack：** 每项关键事实的来源定位、证据摘录、支持/反向关系和缺失项；
- **PolicyVersion：** 有效时点正确的规则 ID、版本、生效日期与规则评估结果；
- **ModelRun：** 模型、Prompt、输出 Schema、检索/工具配置和运行 ID；
- **Assessment：** 标准化状态、理由代码、未决问题、建议升级以及校验报告；
- **HumanDisposition：** 人工最终处置、角色、原因、时间戳和批准链；
- **AuditLink：** 记录间关联、访问日志与完整性校验信息。

最小可行版本可以保持单次 LLM 调用，但要求它输出结构化的候选事实、证据引用、政策条款候选、冲突和缺失项，而不直接触发业务动作。程序验证 Schema 与引用，规则引擎执行明确的硬条件；不满足条件就进入 evidence insufficient、conflicting evidence 或 escalation 等正式状态。

### 15.2 第二版：评测先行，再增加模型调用

先建立基准数据集和错误分类，在每次 Prompt、模型、检索与规则版本变更时自动运行：

- Schema、必填字段和引用定位的确定性测试；
- 硬性政策及禁止动作的规则测试；
- 专家标注案例上的决策与证据评测；
- 缺证、矛盾、过期政策、恶意文档和依赖故障的挑战测试；
- 对同一案例多次试验以评估模型输出波动；
- 审核人员在看/不看 AI 建议条件下的受控对照评测。

只有当这些测试指出单次调用在某个环节确实失败，才考虑增加独立 Critic、第二模型或多 Agent 步骤。否则，多一次 LLM 调用只会增加费用、延迟、输出和审计负担，不一定增加决策质量。

### 15.3 第三版：把门禁与下游副作用隔离

业务动作接口不应接受任意模型自然语言作为授权。它应只接受经过 Schema、策略和权限验证的明确状态，并要求符合当前工作流状态。高风险操作应有授权人员明确批准；低风险自动化也应在批准范围、阈值和回滚机制内运行。

对所有版本更新，保留受控回退方式。若新的模型或 Prompt 在关键案例上造成严重错误、引用质量明显下降、必要升级遗漏或策略违规，应能够立即关闭自动动作、回到上一批准版本或转入人工流程，而不是等待下一次例行评审。

### 15.4 一个最小的发布门禁示例

下表不是监管机构规定的通用阈值，而是把质量评估转成上线决策的一种示意。

| 门禁 | 上线要求的写法 | 失败时怎么办 |
| --- | --- | --- |
| 硬性政策 | 所有禁止条件和必要状态转换通过确定性测试；失败不允许被总分抵消 | 阻止发布，修正规则或流程 |
| 证据 | 重大结论都有可解析引用，引用内容经核验能支持结论；设置独立证据支持率门槛 | 退回事实/检索步骤或升级 |
| 错误接受与漏升级 | 对重大错误设置单独上限，评测报告包含置信区间与样本分布 | 不扩大自动化范围，必要时降低权限 |
| 缺证和冲突 | 在设计的缺证、矛盾案例中，系统按预期不作确定判断并升级 | 修复状态机、检索或评测流程 |
| 人工复核 | 通过盲审/独立抽样证明审核者能发现关键错误，而不是只完成点击 | 改进界面、工作量、培训和审批机制 |
| 运行与回退 | 日志、告警、版本追踪、停用/回滚和人工降级演练通过 | 不进入生产或暂停自动动作 |

门槛应由业务风险、历史基线、法律合规要求与风险偏好共同定义。这里不提供“一律 95% 准确率”之类的万能数字，因为整体 Accuracy 无法表达重大错误的业务后果，也不能代替独立验证与正式风险接受。

## 十六、最终判断：把一次模型调用升级为一项受控业务能力


对于金融服务业内部使用的 JEV 类 Decision Model，问题不是 Prompt 方案天然不可用，而是**直接返回一个判断的简单调用方式，缺少监管和业务治理需要的决策结构**。它可以作为原型或低影响的辅助功能，但不应未经验证就承担重大业务判断。

更成熟的设计，需要把模型输出建立在可追溯的事实和证据之上，把明确规则从自由生成中分离，为不确定和超出授权的案例提供安全退出路径，使用独立测试验证结果，并让人工审核具有真实的挑战能力。审计人员最终需要看到的不是模型写得多么有说服力，而是这项判断引用了什么、依据了哪一版政策、通过了哪些校验、哪些问题仍未解决，以及谁在什么权限下作出了最后的业务决定。

**不要把自然语言理由误当成可解释性，也不要把人工点击误当成监督。应当让证据、规则、记录、验证和责任链成为 Decision Model 的一等组成部分。**

---

## 参考资料与延伸阅读

### 监管与行业框架

1. [MAS — Guidelines on Artificial Intelligence Risk Management for Financial Institutions (2026)](https://www.mas.gov.sg/regulation/guidelines/guidelines-on-artificial-intelligence-risk-management-for-financial-institutions)
2. [MAS — Response to Feedback on AI Risk Management Guidelines (2026)](https://www.mas.gov.sg/-/media/mas-media-library/publications/consultations/bd/2025/response-to-feedback-received-on-guidelines-on-artificial-intelligence-risk-management.pdf)
3. [MAS — FEAT Principles](https://www.mas.gov.sg/publications/monographs-or-information-paper/2018/feat)
4. [MAS — Veritas Toolkit 2.0 for responsible AI in finance](https://www.mas.gov.sg/news/media-releases/2023/toolkit-for-responsible-use-of-ai-in-the-financial-sector)
5. [BIS FSI — Managing explanations: how regulators can address AI explainability (2025)](https://www.bis.org/publications/fsi-paper-24-managing-explanations-how-regulators-can-address-ai-explainability)
6. [OCC / Federal Reserve / FDIC — Revised Model Risk Management Guidance (2026)](https://occ.treas.gov/news-issuances/bulletins/2026/bulletin-2026-13.html)
7. [NIST — AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
8. [NIST — Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)
9. [Financial Stability Board — The Financial Stability Implications of AI (2024)](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/)
10. [EU — Artificial Intelligence Act, Regulation (EU) 2024/1689](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689)

### 学术论文

11. Turpin et al., [Language Models Don't Always Say What They Think: Unfaithful Explanations in Chain-of-Thought Prompting](https://papers.neurips.cc/paper_files/paper/2023/hash/ed3fea9033a80fea1376299fa7863f4a-Abstract-Conference.html), NeurIPS 2023.
12. Fayyaz et al., [Evaluating Human Alignment and Model Faithfulness of LLM Rationale](https://arxiv.org/abs/2407.00219), 2024.
13. Vered et al., [The Effects of Explanations on Automation Bias](https://www.sciencedirect.com/science/article/pii/S000437022300098X), *Artificial Intelligence*, 2023.
14. [Explainability does not mitigate the negative impact of incorrect AI advice in a personnel selection task](https://www.nature.com/articles/s41598-024-60220-5), *Scientific Reports*, 2024.
15. Westphal et al., [Decision control and explanations in human-AI collaboration: Improving user perceptions and compliance](https://doi.org/10.1016/j.chb.2023.107714), *Computers in Human Behavior*, 2023.
16. Mitchell et al., [Model Cards for Model Reporting](https://doi.org/10.48550/arXiv.1810.03993), FAT* 2019.
17. Gebru et al., [Datasheets for Datasets](https://doi.org/10.48550/arXiv.1803.09010), 2018 / *Communications of the ACM*, 2021.

### 业界调查与工程实践

18. [Bank of Japan — Use and Risk Management of Generative AI by Japanese Financial Institutions (FY2026 survey)](https://www.boj.or.jp/en/research/brp/fsr/fsrb260824.htm) — 150 家机构的调查，关注使用现状、评测、治理与第三方风险。
19. [Bank of England / FCA — Artificial intelligence in UK financial services, 2024](https://www.bankofengland.co.uk/report/2024/artificial-intelligence-in-uk-financial-services-2024) — 金融业 AI 用例、自动化程度、重大性与治理调查。
20. [OpenAI — Morgan Stanley uses AI evals to shape the future of financial services](https://openai.com/index/morgan-stanley/) — 供应商公开的客户案例，包含真实业务 Eval、专家评分、回归测试与人工复核。
21. Anthropic, [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — 任务、trial、grader、trajectory、outcome 与评测框架的工程方法。
22. Anthropic, [Building effective agents](https://www.anthropic.com/research/building-effective-agents) — Agent workflow 的简洁组合模式与灵活行动边界。

### 补充研究论文

23. Sachan et al., [Human-AI collaboration to mitigate decision noise in financial underwriting: A study on FinTech innovation in a lending firm](https://www.sciencedirect.com/science/article/pii/S1057521924000814), *International Review of Financial Analysis*, 2024 — 对人工承保判断的不一致性、证据权重和规则可靠性进行分析。
24. Shi et al., [Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge](https://aclanthology.org/2025.ijcnlp-long.18/), IJCNLP 2025 — 研究 LLM Judge 的位置偏差与一致性。
25. Wei et al., [Systematic Evaluation of LLM-as-a-Judge in LLM Alignment Tasks](https://arxiv.org/abs/2408.13006), 2024 — 评估 Judge 的 Prompt 敏感性、可靠性与人类一致性。
26. [FinRegLab — Explainability and Fairness in Machine Learning for Credit Underwriting](https://finreglab.org/research/explainability-and-fairness-in-machine-learning-for-credit-underwriting/) — 传统信贷模型诊断、解释性、公平性及 2026 年模型管理框架的项目入口。
27. [FinRegLab / Stanford GSB — Machine Learning Explainability & Fairness: Insights from Consumer Lending](https://finreglab.org/research/machine-learning-explainability-fairness-insights-from-consumer-lending/) — 对多家厂商与开源模型诊断工具进行实证评估，讨论其在个体预测、群体行为和模型风险管理方面的作用与限制。
28. [FinRegLab — Framework for Managing Machine Learning Models in Consumer Credit Underwriting (2026)](https://finreglab.org/wp-content/uploads/2026/04/FinRegLab_04-09-2026_Framework-for-Managing-Machine-Learning-Models.pdf) — 传统 ML 模型管理的近期框架，可用于比较其与 LLM 决策记录、证据溯源和运行评测的差异。

### 与工程评测的衔接

- [大模型结果如何测试和验证：Anthropic 与 OpenAI 的方法论](./llm-eval-and-verification) —— 如何构造可重复实验、衡量失败并建立回归门禁。
