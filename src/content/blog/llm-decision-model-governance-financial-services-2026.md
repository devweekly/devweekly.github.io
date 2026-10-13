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

## 十二、最终判断：把一次模型调用升级为一项受控业务能力

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

### 与工程评测的衔接

- [大模型结果如何测试和验证：Anthropic 与 OpenAI 的方法论](./llm-eval-and-verification) —— 如何构造可重复实验、衡量失败并建立回归门禁。
