---
author: SW
pubDatetime: 2026-11-17T12:00:00Z
title: "从 grep 到 Embedding：AI Agent 知识检索的架构分界线"
featured: false
draft: false
tags:
  - AI
  - AI Agent
  - RAG
  - Embedding
  - OpenSearch
  - Information Retrieval
  - AI Architecture
description: "本地 Agent 用 grep、glob、find 和 bash 已经能完成大量知识获取任务。什么时候才需要 Embedding、向量检索或 OpenSearch？从任务特征、召回率、延迟、权限和运维成本建立一套可执行的架构决策树。"
---

# 从 grep 到 Embedding：AI Agent 知识检索的架构分界线

**研究截止日期：2026 年 11 月 17 日**

本地使用 VS Code Copilot、Pi、Claude Code 这一类 AI Agent 时，很多知识获取任务并不需要 RAG。Agent 可以先用 `glob` 找文件，再用 `grep` 搜索术语或正则表达式，接着用 `find`、`bash`、`head`、`tail` 和文件读取逐步缩小范围。它不是一次性把整个目录塞进上下文，而是边探索、边读取、边修正搜索方向。

这套方式简单、透明，而且经常足够好。问题在于，很多知识库项目从一开始就把 Embedding、向量数据库、RAG Pipeline 当成默认配置，反而没有先回答一个更基础的问题：当前检索到底遇到了什么无法通过文件系统和文本搜索解决的问题？

**我的判断是：不要按文档数量决定是否上 Embedding，也不要按数据量决定是否上 OpenSearch。应该按查询任务的失败模式决定。** 而且，在判断 Embedding 之前，必须先把 LLM 的 Query Understanding、Query Decomposition 和 Query Expansion 算进去。用户用自然语言提出问题，并不意味着只能把原句交给 grep；Agent 可以把问题拆成多个概念维度，生成同义词、缩写、中英文表达、实体和子问题，再执行多轮词法或结构化检索。只有当这套动态检索仍存在可测量的语义召回缺口，或运行时探索无法满足延迟、并发和治理要求时，才需要进一步引入索引。Embedding 不等于 OpenSearch，全文检索也不等于向量检索。

## 1. 为什么 grep / glob / find 已经能做很多事

先看一个常见的本地开发任务：

> 找出这个项目里所有处理用户身份认证的逻辑，说明登录、Token 校验和权限判断分别在哪里实现，以及它们之间的调用关系。

Agent 并不一定需要一个向量索引。它可以从项目入口和目录结构开始：

```bash
find . -maxdepth 3 -type f
rg -n -i "auth|authenticate|authorization|token|session" .
rg -n "verifyToken|checkPermission|requireAuth" src test
```

随后读取候选文件、沿着函数调用关系继续搜索，必要时查看配置、测试和 Git 历史。搜索结果不够好时，它可以换关键词、扩大目录、追踪引用，直到形成一份有源文件依据的解释。

这不是传统意义上一次查询、一次返回 Top-K 文档的 RAG。它更像一个会使用工具的研究者：提出假设、执行搜索、检查证据、调整假设。检索过程本身是 Agent 的推理循环。

Anthropic 在 2025 年的 [Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) 中专门讨论了这一变化：很多 AI 应用过去会在推理前通过 Embedding 预先检索上下文，而 Agentic Search 可以保留文件路径、查询、链接等轻量引用，在需要时通过工具动态加载内容。文章以 Claude Code 为例，说明 Agent 可以用 Bash、glob、grep 等原语按需探索；同时也明确指出，运行时探索会比预计算检索慢，Agent 还需要合适的工具和搜索启发式，否则可能浪费上下文、走入死胡同。Anthropic 给出的方向不是“永远不用索引”，而是根据任务选择自主探索与预取上下文的边界。

这和工具的实际设计相符。Pi 的 [CLI 文档](https://docs.pi.dev/latest/cli) 将 `read`、`bash`、`grep`、`find`、`ls` 作为内置工具；VS Code Copilot 则同时提供文本搜索、Grep、文件名搜索、符号引用和语义搜索。Copilot 的文档也说明，Grep 不需要索引，而语义搜索需要工作区索引。换句话说，即使是提供语义索引的产品，也没有把精确文本搜索淘汰掉。

参考：[Pi CLI Tools](https://docs.pi.dev/latest/cli#tools)；[VS Code：How Copilot understands your workspace](https://code.visualstudio.com/docs/agents/reference/workspace-context)。

### 1.1 Agentic Search 的优势来自渐进式发现

文件系统不仅存放内容，也保存了有用的组织信息。目录层次、文件名、扩展名、时间戳、Git 历史、模块边界和相邻文件，都是检索线索。

例如，`src/auth/token.ts`、`tests/auth/token.test.ts`、`docs/security/token-lifecycle.md` 即使没有被 Embedding 模型编码，也已经通过路径和命名表达了部分语义。Agent 可以先找到实现，再读测试和文档，逐层构建理解。

这种方式有几个很实际的特点：

- **精确性高**：已知函数名、错误码、配置键、业务术语或文件路径时，文本搜索通常比语义相似度更直接。
- **内容更新立即可见**：不需要等待文档切片、Embedding 生成和索引刷新。只要文件已经写入，下一次搜索就能看到。
- **证据路径清楚**：结果可以直接落到文件、行号和 Git commit，便于验证。
- **基础设施少**：不需要单独维护向量模型、Embedding Pipeline、索引存储和检索服务。
- **Agent 可以自适应**：第一次搜索不完整时，可以换词、沿调用关系搜索，或读取更多上下文。

### 1.2 但它不是免费的

Agentic Search 把一部分检索工作从离线索引阶段移到了每次任务的运行时。

一次复杂探索可能包含十几次工具调用。每次调用都可能产生延迟、消耗 Token，并把搜索结果带入上下文。更重要的是，Agent 的搜索策略不一定稳定：同一个问题，模型可能选用不同关键词、搜索不同目录，甚至遗漏一个重要文件。

VS Code Copilot 的工作区文档明确提醒：Grep 或文本搜索返回的匹配内容可能直接进入对话上下文，即使 Agent 没有打开对应文件。生成文件、构建产物、日志和大数据文件会造成噪声，因此排除规则会直接影响搜索速度、相关性和 Token 消耗。

因此，Agentic Search 的主要成本不只是 `grep` 执行时间，而是：

```text
任务总成本 =
  工具调用延迟
  + 搜索结果进入上下文的 Token
  + Agent 反复探索的推理成本
  + 搜索遗漏和错误理解的返工成本
```

当这些成本仍然低于建立、维护和调用索引的成本时，就没有必要为了“架构完整”而引入 RAG。

## 2. 真正的分界线：查询任务，而不是文档规模

把检索任务拆开看，会更容易判断。

| 查询任务 | 典型问题 | 优先方案 |
| --- | --- | --- |
| 已知实体或术语 | 找到 `payment_status` 在哪里定义 | grep / 精确文本搜索 |
| 已知文件或路径模式 | 找到所有 ADR、配置文件、测试文件 | glob / find |
| 已知代码符号 | 谁调用了这个函数，在哪里实现 | LSP / Symbol / AST 索引 |
| 结构化属性过滤 | 找出 2024 年之后、某业务域、某状态的文档 | SQL / 元数据过滤 |
| 词汇不一致 | 用户说“客户退出”，文档写的是“关系终止” | LLM Query Expansion + 多路词法检索；验证后再考虑 Embedding |
| 自然语言语义发现 | 不知道术语，只能描述一个业务现象 | Semantic Search / Embedding |
| 大规模跨来源检索 | 同时搜索 Wiki、SharePoint、邮件、工单和文件库 | 统一检索层或联邦检索 |
| 高并发、低延迟检索 | 每个 Agent 请求都要稳定地检索大量内容 | 预计算索引 |
| 多模态内容检索 | 按图片、图表或扫描件的内容找资料 | OCR / 多模态 Embedding / 专用索引 |

有一个容易被忽略的区别：**代码搜索和企业知识搜索的难点并不完全相同。**

代码有大量稳定的结构信号：符号名、调用关系、import、类型、文件路径和测试关系。即使用户提出的是自然语言问题，Agent 也可以先把问题转成候选符号或代码概念，再通过 LSP、AST、grep 和文件读取验证。单纯的向量检索未必能准确回答“这个函数有哪些调用方”或“哪个实现覆盖了这个接口”。

企业文档则经常缺少统一的命名和结构。一个业务概念可能在政策文件中叫“客户关系终止”，在操作手册中叫“账户关闭”，在邮件中写成“客户退出流程”。如果用户不知道文档采用的词，精确搜索就可能漏掉内容。这才是语义检索更有价值的地方。

## 3. Decision Tree：从最简单的检索开始

下面这棵决策树针对的是“如何为 Agent 选择知识检索方式”，不是“是否要部署某个数据库”。

<iframe src="/diagrams/agentic-search-decision-2026.html" title="Agentic Search 与 Embedding 的检索决策树" width="100%" height="1120" loading="lazy" style="border:0;max-width:100%;"></iframe>

<small>图：先由 LLM 做查询理解与分解，再运行 Agentic Search；只有经过诊断、迭代后仍存在语义召回缺口，才试点 Embedding。<a href="/diagrams/agentic-search-decision-2026.html">单独打开图表</a>。</small>


这棵树的几个关键判断值得展开。

### 3.1 能精确定位，就不要先做语义检索

如果问题包含明确的代码符号、配置项、错误码、产品 ID、客户 ID、文档编号或法规条款号，优先使用精确检索。

例如：

- “查找所有调用 `calculate_nav` 的地方。”
- “找到包含规则编号 `INV-042` 的政策文件。”
- “哪些配置仍然使用旧的 `risk_model_version`？”
- “列出 2025 年之后更新过的全部投资限制政策。”

这些任务不需要 Embedding。对于最后一个问题，文件元数据或 SQL 过滤比向量搜索更自然。

不要为了统一架构而把所有查询都转成向量。向量相似度不是精确匹配的替代品。

### 3.2 LLM 可以先把自然语言问题变成一组检索任务

这里需要明确纠正一个容易产生误导的说法：“用户不知道应该枚举哪些关键词”并不等于“用户需要 Embedding”。

LLM 本身就可以承担 Query Understanding 和 Query Expansion。它理解用户的真实意图后，可以把一个宽泛的问题分解为若干概念维度，再为每个维度生成适合不同检索工具的查询表达。换句话说，Agent 不必把用户原句原封不动地交给 grep。

例如，用户问：

> 找出所有讨论客户资产在市场剧烈波动期间如何保持流动性的材料。

Agent 可以先生成一个结构化的查询计划：

| 概念维度 | 词法查询变体 | 可能的检索方式 |
| --- | --- | --- |
| 现金管理 | 现金缓冲、现金储备、Cash Buffer、Cash Reserve | grep / BM25 |
| 流动性风险 | 流动性风险、Liquidity Risk、Liquidity Management | grep / BM25 |
| 资产变现 | 资产变现能力、可变现资产、Asset Liquidation | grep / BM25 |
| 赎回压力 | 赎回压力、赎回风险、Redemption Pressure | grep / BM25 |
| 市场压力 | 市场压力、极端市场、Market Stress、Stress Scenario | grep / BM25 |
| 监管口径 | 流动性覆盖率、LCR、Liquidity Coverage Ratio | grep / BM25 |
| 相关业务实体 | 客户资产、客户组合、投资组合、Client Assets、Portfolio | grep / 元数据过滤 |

随后 Agent 可以并行或分批执行这些查询，合并、去重结果，读取候选文档，再根据命中情况决定下一轮搜索方向。例如，若命中材料集中在赎回管理，却没有覆盖资产变现和现金储备，Agent 可以补充查询；如果文档中出现新的业务术语，也可以把它加入下一轮搜索计划。

一个合理的运行时流程是：

```text
User Question
     |
LLM: intent + entities + concepts + constraints
     |
Query Decomposition / Expansion
     |
     +--> lexical queries (grep / BM25)
     +--> metadata filters (SQL / API)
     +--> structural queries (LSP / graph / relationships)
     |
Merge + Deduplicate + Read Evidence
     |
Coverage Check / Relevance Feedback
     |
     +--> enough evidence: answer with sources
     +--> gaps remain: generate targeted follow-up queries
```

这就是 Agentic Search 与传统“一次查询、一次 Top-K 召回”的重要区别：查询计划可以在运行时生成，也可以根据真实命中结果不断修正。LLM 不只是搜索框前面的自然语言接口，它还可以成为检索策略的规划器。

### 3.3 那么，LLM Query Expansion 为什么仍然不总是够用？

既然 LLM 可以生成同义词、子问题和多轮查询，Embedding 的价值就不能再被描述成“用户不知道该用什么关键词”。更准确的边界是：**LLM Query Expansion 只能检索它生成出来的表达；Embedding 提供了另一种不依赖显式词面重合的匹配信号。两者可以互补，而不是二选一。**

Query Expansion 的局限主要有几类：

1. **生成覆盖不是穷尽覆盖。** LLM 生成的是有限数量的候选词和子问题。它可能漏掉某个文档集合内部才使用的术语、历史缩写、团队黑话、特定供应商字段名，或者某个业务概念的非显然表达。
2. **模型知识不等于语料知识。** 模型可以知道一般金融领域的“流动性管理”，却未必知道某家机构内部把同一类流程命名为某个项目代号或操作简称。没有语料反馈时，生成的查询可能听起来合理，却没有命中目标语料的实际表达。
3. **词法检索仍然需要词面交集。** 即使查询扩展得很好，如果文档用一段上下文描述某种风险机制，却没有出现生成的关键词，grep / BM25 仍可能找不到它。多轮搜索能缓解，但不能保证覆盖所有隐含表达。
4. **查询越多，噪声也越多。** 把十几个相关词全部 OR 在一起，可能扩大召回，也可能引入大量主题相近但并不回答问题的材料。多路查询需要独立执行、保留查询来源，并在合并时控制重复和主题漂移。
5. **每次请求都要付出推理成本。** 动态生成查询、执行多轮工具调用、读取结果和判断覆盖，都发生在请求时。高频、并发、低延迟场景可能更适合预先构建索引，而不是每次都让 Agent 从头探索。

这不是说 Query Expansion 不可靠、Embedding 就天然可靠。研究结果反而提醒我们，查询扩展也需要评估。EMNLP 2024 的一项研究探索了 LLM 生成多个伪参考文本并融合查询的方式，发现它可以改善稀疏和稠密检索，但原始查询与扩展内容的权重平衡很重要。另一项跨数据集研究发现，扩展对较弱的检索器更可能有帮助，而对本来表现较强的检索器可能引入噪声、损害排序。也就是说，扩展并非越多越好。

参考：[Exploring the Best Practices of Query Expansion with Large Language Models (EMNLP Findings 2024)](https://aclanthology.org/2024.findings-emnlp.103/)；[When do Generative Query and Document Expansions Fail? (EACL Findings 2024)](https://aclanthology.org/2024.findings-eacl.134/)。

### 3.4 更准确的 Embedding 触发条件

Embedding 应该在以下情况中通过对照实验争取自己的位置：

- **语料特有表达无法被模型事先枚举。** 文档存在大量组织内部术语、隐含表达、历史叫法或跨语言表达，而且没有经济可维护的词典。
- **语义关系不是简单同义词。** 用户描述的是一个业务现象、因果机制或情境，文档从不同角度描述相关机制，无法通过有限的关键词列表覆盖。
- **多路查询仍然漏掉已知相关证据。** 用真实问题集标注相关文档，LLM 扩展 + BM25 / grep 仍存在稳定的 Recall 缺口，而 Dense Retrieval 能补回这些文档。
- **需要稳定的预计算召回。** 查询频率高、语料持续增长、每次动态探索的 P95 延迟或 Token 成本不可接受，需要把部分检索工作前移到离线索引阶段。

即使触发了这些条件，也不意味着要放弃 Agentic Search。可以保留 LLM 查询分解，再并行执行 BM25 和 Vector Search，融合结果后由 Agent 阅读原文、验证证据。

因此更准确的判断不是“用户不知道关键词，就用 Embedding”，而是：

**先让 LLM 尽可能把问题变成可执行的检索计划；如果词法与结构化检索在真实语料上仍有稳定的语义召回缺口，再用 Embedding 补足。**

### 3.5 一线 AI-native 项目的共同经验：先把文件系统用好

把 Anthropic、OpenAI、Manus、Pi 和 LangChain 的公开材料放在一起看，会发现它们并没有形成“所有 Agent 都应该使用 RAG”的共识。相反，多个 coding agent 和通用 agent 把少量文件系统与 Shell 原语作为默认能力，再按需扩展专用检索。

| 项目 / 团队 | 公开实践 | 对检索架构的启示 |
| --- | --- | --- |
| Anthropic / Claude Code | 在百万行级 monorepo、遗留系统和多仓库环境中，通过文件遍历、grep、引用追踪和本地实时内容导航；大规模部署建议分层 CLAUDE.md、排除生成文件、子目录作用域、LSP 和 MCP 结构化搜索 | 对代码先优化导航与符号级工具；仓库大不等于必须建立向量索引 |
| OpenAI / Codex CLI | Codex Prompting Guide 明确优先使用 rg / rg --files，优先专用 read/search 工具，能并行的文件搜索和读取应并行；同时允许按任务接入 semantic search 等自定义工具 | 先把基础检索工具和并行调用做好；语义搜索是可选能力，不是 Shell 搜索的替代品 |
| Manus | 将文件系统作为外部上下文和可恢复记忆；大型工具结果写入文件，消息中保留引用；用 Bash 和文件工具按需取回 | 搜索之外，上下文卸载和可恢复性同样重要 |
| Pi | 默认只给模型 read、write、edit、bash 四个核心工具；保持 minimal harness，不内置 sub-agent 和 plan mode，能力通过 Skills、Extensions 和 Packages 扩展 | 通用 Shell 能覆盖大量文件发现与处理任务；不必把每种搜索动作都做成复杂专用工具 |
| LangChain / Deep Agents | 内置 ls、glob、grep、分页 read_file；大结果卸载到文件并只返回路径和预览；对自定义 RAG 工具建议 retrieve、offload、delegate | 即使采用 RAG，也要控制结果进入主 Agent 上下文的数量 |

这些不是同一类证据。Anthropic、OpenAI、Manus 和 LangChain 的官方文章 / 文档反映的是产品团队公开的工程方法；Pi 的 GitHub 仓库可以直接验证其默认工具集；它们都不是一组严格控制变量的 grep-versus-embedding 性能基准。它们足以说明一线 Agent 团队如何设计默认检索方式，但不能据此宣称 grep 在任何语料规模上都优于向量检索。

Anthropic 的大代码库实践并没有停留在 grep。它建议用 LSP 提供 symbol-level navigation：在大量同名函数、跨语言调用和复杂引用关系中，LSP 可以直接返回定义和引用，避免 Agent 用 grep 扫出成百上千条匹配后再逐个打开文件。Anthropic 还提到企业团队通过 MCP 暴露结构化搜索。这说明优化路径通常是：

\`\`\`text
文件 / 目录发现
    -> 精确文本搜索
    -> 作用域与排除规则
    -> LSP / AST / 结构化搜索
    -> 必要时再增加全文或语义索引
\`\`\`

参考：[Anthropic: Claude Code at scale](https://claude.com/resources/articles/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start)；[OpenAI: Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)；[Manus: Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)；[Pi coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)；[LangChain: Context Engineering Starts with Retrieval](https://www.langchain.com/blog/context-engineering-starts-with-retrieval)。

### 3.6 grep / glob / find 能优化到什么程度？它的性能天花板在哪里？

需要把“搜索执行性能”和“检索质量”分开。ripgrep 已经是非常高效的本地文本扫描工具。对代码仓库这类文件系统语料，继续优化往往不应该从换 Embedding 模型开始，而应该先把搜索路径、文件集合、输出规模和工具调用方式做好。

**第一层：把文件扫描范围控制好。**

- 用 rg --files、fd 或 glob 先得到候选文件集合，再针对候选目录搜索；不要每次都从仓库根目录递归扫描。
- 尊重 .gitignore，显式排除 node_modules、dist、build、生成代码、二进制文件、依赖包、历史归档和无关日志。
- 按文件类型过滤；按目录、时间、大小或来源先过滤，再执行正文搜索。
- 已知符号、文件名或路径时，直接精确查找，不要把简单任务交给宽泛正则。
- 对 monorepo 使用目录地图和分层说明，让 Agent 先确定 package / service，再在局部目录搜索。

**第二层：减少每次搜索的固定开销。**

- 多个独立关键词或子问题可以并行执行，避免 Agent 一次只跑一个 grep、等待结果后再跑下一个。
- 用 rg -l 先取文件列表，用行号和少量上下文只取必要内容；避免第一轮就把所有匹配行和大段上下文塞进模型。
- 使用 count、max-count、文件数量上限、分页和排序策略，控制高频词造成的结果洪泛。
- 把完整搜索结果写到临时文件或 Artifact，主上下文只保留摘要、路径和少量预览；需要时再按需读取。
- 对重复任务缓存文件清单、文件元数据、解析结果和确定性查询结果；文件变更后按路径或内容哈希失效缓存。
- 如果工具调用开销明显高于搜索本身，可以把多次查询封装为一个批处理工具，或让 Agent 在一次 Bash 调用中执行多个独立查询。

**第三层：用更强的结构化工具解决 grep 本来就不擅长的问题。**

- 代码符号、调用关系和类型：LSP、AST、Tree-sitter、语言索引。
- 反复执行的大量词法查询：SQLite FTS5、Tantivy 或其他倒排索引。
- 文档标题、来源、日期、版本、业务域和权限：SQL / 元数据索引。
- 多来源、并发、服务级 SLA：集中式全文检索服务。
- 语义表达差异：Embedding / Dense Retrieval。
- 多跳实体关系：知识图谱或关系查询。

一个有价值的工程反例是 Atlarix 的团队：遇到文件监听器占用大量文件描述符、索引刷新反复读取仓库等问题后，团队重新评估索引的实际收益，最终删除检索索引，退回 ripgrep 驱动的 grep / glob。团队明确承认，词法检索无法发现用户没有说出的概念（例如搜 authentication 不一定能找到名为 verifyCredentials 的实现），但在代码这种共享标识符很多的语料中，实时、无索引维护的收益更大。索引不一定是单向升级，维护成本可能超过它带来的检索收益。

参考：[How We Deleted Our Retrieval Index and 5,246 Lines With It](https://www.atlarix.dev/blogs/how-we-deleted-our-retrieval-index)。

**纯 grep 的性能天花板不是单一的文件数量阈值。**

| 维度 | 优化后的 grep / Agentic Search 能力 | 无法靠继续加速 grep 消除的边界 |
| --- | --- | --- |
| 扫描速度 | 本地 SSD、ripgrep、文件类型过滤、ignore 规则、目录预筛选，单次搜索可做到毫秒至秒级，取决于语料和命中量 | 超大远程文件系统、跨区域数据源和大量小文件的网络 I/O 不会因更快的正则引擎而消失 |
| 结果数量 | 文件名模式、路径范围、精确词、正则、计数、上下文窗口和分页能有效控制输出 | 命中很多不等于相关；grep 不天然知道哪些结果最能回答问题 |
| 查询覆盖 | LLM Query Expansion、同义词、缩写、中英文、概念分解和迭代补查可以显著提高覆盖 | LLM 没有生成的语料特有表达，词法检索仍然无法命中；更多查询也会增加噪声和成本 |
| 相关性排序 | 可按命中次数、路径、文件权重、时间、BM25 或规则排序 | 词频和路径规则难以表达“没有相同词语但语义上回答了问题”的内容 |
| 结构理解 | LSP、AST、符号索引可解决代码定义、引用、类型和调用关系 | 通用文本 grep 不理解实体关系、因果链、文档版本依赖或跨来源业务关系 |
| 数据类型 | 配合 OCR、PDF / Office 解析器可搜索提取后的文本 | 图片、扫描件、复杂表格、图表和音视频需要专门解析或多模态检索 |
| 企业治理 | 文件权限、目录边界和来源过滤可用于受控工作区 | 跨系统 ACL、用户级 Entitlement、审计、索引隔离和高并发服务治理需要独立设计 |
| 运行成本 | 无 Embedding 生成、向量存储和索引同步成本 | 每次动态规划、多轮工具调用和重复扫描会产生运行时延迟与模型 Token 成本 |

因此，grep 的真正天花板不是“文件太多，扫描太慢”这一条。扫描速度通常可以通过工具和工程手段优化；更难突破的是**查询表达覆盖、语义相关性排序、跨文档结构关系、多模态解析、跨系统权限与服务 SLA**。当问题落在这些边界上，应该引入能解决该问题的组件，而不是笼统地把整个检索系统替换成 RAG。

### 3.7 AWS 的企业案例：Embedding 不是万能药，Agentic Retrieval 也不是免费升级

AWS 的实际案例把金融、制造和多语言企业文档中的真实约束暴露出来。

**Amazon Finance：先 Query Expansion，再并行向量检索。** Amazon FinTech 团队处理数千份历史监管问询材料，文档包括 PDF、PPT、Word 和 CSV，并包含大量领域术语。其方案采用 Bedrock Knowledge Bases、OpenSearch Serverless 和层级 Chunking；查询阶段并不是把用户原句直接向量化一次，而是先用 Claude 3.5 Haiku 生成最多五个查询变体，再并行调用 Retrieve API。AWS 报告，这种并行处理把检索延迟从顺序执行约 10 秒降到 2 秒以内。即使已经使用 Embedding，Query Expansion 和并行执行仍然是重要优化手段；向量索引没有替代查询规划。

**IskayPet：Managed Hybrid Search + 权限过滤。** IskayPet 的知识分散在数百份 SharePoint 文档中，覆盖四种语言、三个国家和多个业务域。它采用 Bedrock Managed Knowledge Bases，利用内置 BM25 + Semantic Hybrid Search、Reranking 和文档级权限过滤；查询时检索 25 个 passages，去重后最多把 15 个放入 Prompt。上线约两个月后，AWS 报告其操作问题的查找时间从 3–5 分钟降到约 7 秒，并预计承载每月约 100,000 次查询。关键不是“向量越多越好”，而是混合召回、权限约束、候选数量控制和增量同步共同组成生产检索能力。

**Novo Nordisk：四百万文档规模下，向量检索仍然不够。** AWS 2026 年 11 月发布的案例描述了一个约四百万份受控制造文档的知识库。系统采用 Neptune 知识图谱 + OpenSearch Hybrid Search：向量搜索用于语义召回，BM25 捕获文档编号、设备代码和精确术语；再通过图谱补充流程层级、文档引用和实体关系，并用 Reranker 提高候选段落精度。它还会在检索前澄清站点、产品代际和设备范围，避免把相似但不适用的文件当成答案。规模只是背景，真正推动架构升级的是文档版本、生效范围、实体关系和受控内容的可追溯性。

**AWS Bedrock Agentic Retrieval：Embedding 之上仍然需要检索规划。** AWS 在 MuSiQue 多跳问题集上的测试显示，相较单次检索，AgenticRetrieve 对 2-hop、3-hop、4-hop 问题的 Recall 增益分别为 22.8、31.9、37.3 个百分点；代价是多次模型调用、额外延迟和更高费用。AWS 因此建议短、明确的问题使用普通 Retrieve，把 AgenticRetrieve 留给多部分、比较型、探索型或跨知识库问题。它不是所有请求的默认路径。

这些案例可以归纳为一个更成熟的企业架构：**Query Understanding / Expansion 负责理解和拆解问题；BM25 负责精确术语；Embedding 负责语义召回；Metadata / ACL 负责范围和权限；Graph 负责关系；Reranker 负责精排；Agent 负责根据证据缺口决定是否继续搜索。** 不同组件各司其职，任何一个都不能代替其他层。

参考：[Amazon Finance regulatory inquiries](https://aws.amazon.com/blogs/machine-learning/how-amazon-finance-streamlines-regulatory-inquiries-by-using-generative-ai-on-aws/)；[IskayPet Managed Knowledge Bases](https://aws.amazon.com/blogs/machine-learning/how-iskaypet-unified-corporate-knowledge-with-amazon-bedrock-managed-knowledge-bases/)；[Novo Nordisk GraphRAG](https://aws.amazon.com/blogs/machine-learning/novo-nordisk-modernizes-manufacturing-process-documents-with-amazon-bedrock-agentcore/)；[AWS Agentic Retrieval](https://aws.amazon.com/blogs/machine-learning/agentic-retrieval-for-amazon-bedrock-managed-knowledge-base/)。

## 4. 不要把 Embedding、向量数据库和 OpenSearch 当成一个决策

这三个东西解决的问题不同。

**Embedding 是表示方式。** 它把文本、图片或其他内容编码成向量，使系统可以按相似度进行检索。它本身不负责文档管理、权限、全文检索、过滤、排序或服务治理。

**向量存储和索引负责保存、组织和查询向量。** 小规模场景可以从 PostgreSQL + pgvector 等现有数据库能力开始，不必立即部署独立向量数据库。数据规模、并发、索引维护和性能要求确实超出当前数据库能力时，再评估专用服务。

**OpenSearch 是搜索与分析引擎。** 它可以做倒排索引和 BM25 全文检索，也可以通过 k-NN 等能力做向量搜索，还支持把词法和语义结果合并为 Hybrid Search。OpenSearch 文档将这几种能力明确区分：向量检索、语义检索、混合检索、Reranking 和 RAG 并不是同一个功能。

参考：[OpenSearch Vector Search Concepts](https://docs.opensearch.org/latest/vector-search/getting-started/concepts/)；[OpenSearch Hybrid Search](https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/)。

### 4.1 先判断需要哪一层

| 真实需求 | 需要考虑的能力 | 不应直接推导出的结论 |
| --- | --- | --- |
| 找到精确词项、错误码、实体编号 | 倒排索引 / BM25 | 不代表需要 Embedding |
| 找到语义相近的段落 | Embedding + Vector Search | 不代表需要 OpenSearch |
| 同时命中精确术语和语义表达 | Hybrid Search | 不代表一定需要独立向量数据库 |
| 按日期、业务域、文档状态、权限过滤 | Metadata / Structured Filter / ACL | 不应把过滤逻辑交给向量相似度 |
| 多来源统一搜索、高并发、稳定 SLA | 集中式检索服务与索引平台 | 不代表所有数据都必须向量化 |
| 精确检索初筛后提高语义相关性 | Reranker | 不代表需要对整个语料做复杂 RAG |

特别要注意：如果系统的问题是“搜索多个数据源很慢”，引入 Embedding 未必有用。真正需要的可能是连接器、增量同步、统一元数据、缓存或并行查询。如果问题是“用户没有权限的文档也被召回”，需要修复的是检索前的权限过滤和数据授权边界，不是换一个向量数据库。

### 4.2 为什么很多企业最终会走向 Hybrid Search

纯 BM25 对精确词项、专有名词、编号和短语通常很有效；纯向量检索更适合表达方式不同但含义相近的查询。两者有不同的召回偏好。

金融领域的查询尤其容易同时包含两种信息：

> 找到关于“集中度风险”的政策要求，并确认规则 INV-042 对单一发行人的限制。

“集中度风险”适合语义发现；`INV-042` 和“单一发行人”则需要精确匹配。只用向量可能错过编号和关键条款，只用关键词又可能错过用“issuer exposure”或“single-name exposure”表达的材料。

Hybrid Search 将两种结果合并，再根据需要做 Reranking。OpenSearch 提供基于分数归一化或 Reciprocal Rank Fusion（RRF）的混合结果处理方式。选择哪种方式应由相关性评估决定，而不是默认把所有分数相加。

## 5. 用数据判断是否应该升级

架构决策不能只靠“Agent 感觉搜索不方便”。建议先建立一个小型 Retrieval Evaluation Dataset，记录真实问题、预期相关文档、权限范围和答案所需的证据片段。

不需要一开始准备几千条。可以先从 30—100 个真实问题开始，覆盖精确查找、语义发现、跨文档关系、时间过滤、权限过滤和多轮探索。重要的是问题来自真实工作，而不是人为设计成向量检索擅长的样子。

对每个问题，至少比较两种实现：

1. 当前 Agentic Search：文件系统、grep、元数据查询、结构化工具。
2. 候选索引方案：BM25、Embedding 或 Hybrid Search。

记录以下指标：

| 指标 | 要回答的问题 | 观察重点 |
| --- | --- | --- |
| Recall@K | 前 K 条结果中是否包含真正需要的证据？ | 漏掉关键文档的比例 |
| Precision@K | 返回的结果中有多少真正相关？ | 噪声是否过多 |
| MRR / nDCG | 重要证据是否排在前面？ | Agent 是否需要反复翻找 |
| Task Success Rate | Agent 最终是否正确完成任务？ | 检索是否真正影响业务结果 |
| Time to Evidence | 从提问到找到可用证据需要多久？ | 包括 Agent 探索和索引查询 |
| Token / Tool Calls | 为检索消耗多少上下文和工具调用？ | 是否出现重复搜索 |
| Freshness Lag | 新增或修改内容多久能被查到？ | 索引同步延迟 |
| ACL Correctness | 是否只返回用户有权访问的内容？ | 越权召回必须为零 |
| Operating Cost | 建索引和运行检索服务花费多少？ | 包括 Embedding、存储、更新和运维 |

其中最容易被忽略的是 Task Success Rate。Recall@K 提升不一定意味着 Agent 的任务成功率提升。如果原先 Agent 已经可以通过 grep 找到关键文件，向量索引增加了一批相似但不必要的文档，最终答案甚至可能更差。

### 5.1 一个可执行的升级判据

建议用以下逻辑，而不是人为设定“超过十万篇文档就必须上向量数据库”：

- **继续使用 Agentic Search**：真实任务成功率满足要求，关键证据召回稳定，检索延迟和 Token 成本可接受，内容更新速度符合要求。
- **先优化现有检索**：失败主要来自目录混乱、排除规则错误、关键词不足、文件解析失败、缺少元数据或 Agent 搜索策略不合理。
- **先引入全文索引**：主要问题是跨目录、跨来源的精确检索速度、过滤、排序或并发，而语义召回不是主要短板。
- **试点 Embedding**：先运行 LLM Query Decomposition / Expansion，再用多路 grep、BM25 和结构化检索；如果真实查询集中仍持续漏掉语义相关证据，并且 Dense Retrieval 能补回这些证据，才引入 Embedding。
- **引入 Hybrid Search**：精确术语和语义发现同时重要，并且评估证明两种召回组合能提高最终任务成功率。
- **部署独立搜索平台**：除了检索质量，还出现跨系统统一接入、并发、服务 SLA、索引隔离、监控、权限过滤、数据生命周期和运维管理等平台级需求。

阈值应该来自业务 SLA 和基线测试。例如，如果一个任务要求 3 秒内返回候选证据，就应测量 Agentic Search 的 P95，而不是用平均耗时判断；如果某类监管问题要求不能漏掉适用政策，就要单独评估该类查询的召回率，不能被其他普通问题的平均表现掩盖。

## 6. 一个更稳妥的架构演进路径

不要从“文件搜索”一步跳到“企业级 RAG 平台”。可以按实际瓶颈逐层增加能力。

### Stage 1：文件系统就是检索层

适合本地 Agent、代码仓库、项目工作区、有限规模的文档集合。

```text
User Query
    |
    v
Agent
    |
    +-- glob / find
    +-- grep / rg
    +-- read file
    +-- bash / scripts
    +-- LSP / AST (for code)
    |
    v
Evidence in Context
    |
    v
Answer with file paths / line references
```

先做好文件命名、目录组织、排除规则和文档元数据。重要的项目说明可以通过 `AGENTS.md`、`CLAUDE.md` 或项目入口文档提供给 Agent。不要把整个知识库预先塞进上下文。

### Stage 2：增加轻量结构化索引

当文件数量增长、需要按时间、类型、业务域、来源和状态过滤时，可以先增加 SQLite、DuckDB 或 PostgreSQL 元数据表，保存文件路径、标题、来源、更新时间、版本和 ACL 引用。

文件正文仍由 Agent 按需读取。索引先解决“去哪里找”和“哪些文件符合条件”，不必急着解决语义相似度。

### Stage 3：增加全文检索

当跨目录或跨来源的精确搜索已经成为性能瓶颈，或者需要稳定的相关性排序、高并发查询时，引入倒排索引和 BM25。

可以先评估现有数据库的全文检索能力。如果数据源、规模、并发和查询复杂度确实需要独立服务，再评估 OpenSearch。此时不必默认开启向量检索。

### Stage 4：针对语义缺口增加 Embedding

先从一部分高价值文档和真实问题做试点。明确 Chunk 的边界、文档版本、元数据、Embedding 模型版本和更新机制，建立可重复的评估集。

不要只比较“向量搜索能不能返回结果”，要比较它是否找到了原本词法搜索遗漏的关键证据，以及这些证据是否改善最终任务结果。

### Stage 5：在证据充分时采用 Hybrid Search

当 BM25 和向量召回分别解决不同问题，而且组合后的任务成功率确实更好，再考虑统一检索接口：

```text
                 User Query
                      |
                Query Analysis
                      |
          +-----------+-----------+
          |                       |
      BM25 Search            Vector Search
          |                       |
          +-----------+-----------+
                      |
                Fusion / RRF
                      |
                  Reranker
                      |
              ACL + Metadata Check
                      |
              Evidence / Citations
                      |
                    Agent
```

这里的 ACL 不能只放在最后做展示过滤。对受保护内容，必须在检索候选集形成之前或检索过程中实施授权约束；最终结果仍需做权限校验，避免缓存、重排或其他处理环节造成越权。检索系统不能成为绕过原始 Data Entitlement 的旁路。

## 7. 金融服务企业的特殊考虑

在金融服务企业里，检索架构的分界线不只是文档规模和语义差异，还包括数据权属、权限和证据要求。

例如，一个 Investment Research Agent 可能需要同时读取：

- 研究报告和投资政策；
- Bloomberg、LSEG、MSCI 等外部数据及其定义；
- 内部投资组合、持仓和风险数据；
- 团队的分析笔记、审批记录和历史决策；
- 产品、账户、客户和投资限制相关的业务定义。

这不是一个简单的“把所有文件切片后放入向量数据库”的问题。

首先，结构化金融数据不应该被 Embedding 取代。价格、持仓、风险敞口、交易状态和基准数据应通过受控 SQL、API 或数据平台查询，保留精确过滤、时间语义和数据血缘。向量检索可以帮助找到相关政策、分析说明或指标定义，但不应该用相似文本回答“当前持仓是多少”或“某日 NAV 是多少”。

其次，权限必须在检索边界实施。不同用户对研究报告、客户数据、投资组合、交易记录和内部审批材料可能拥有不同权限。文档 ACL、数据行级权限、字段级权限和业务 Entitlement 不是同一件事。Embedding 索引必须继承并正确执行来源权限；不能先召回所有向量，再把权限交给 LLM 判断。

再次，证据和版本需要可追溯。监管政策、投资限制和研究结论可能随时间变化。检索结果至少要保留来源、版本、生效时间、更新时间和原文位置。Embedding 是派生数据，不能替代权威原文，也不能成为审计证据的唯一来源。

因此，企业级方案更合理的形态通常是多种检索方式并存：

| 知识类型 | 推荐检索方式 | 关键约束 |
| --- | --- | --- |
| 结构化持仓、价格、风险指标 | SQL / API / 数据平台 | 精确查询、时间口径、数据血缘 |
| 源代码、配置和工程文档 | grep / LSP / 文件搜索 | 版本、路径、行号 |
| 政策、研究报告、操作手册 | BM25 + 必要时 Embedding | 版本、生效日期、文档 ACL |
| 内部业务定义和指标口径 | 元数据 / 业务词典 / Semantic Layer | 定义所有权、口径一致性 |
| 邮件、工单、会议记录 | 来源连接器 + 全文检索，必要时 Hybrid | 用户权限、时间和来源 |
| 图片、扫描件、图表 | OCR / 文档解析 / 多模态检索 | 解析质量、原始文件引用 |

这也解释了为什么企业知识平台通常需要一个检索路由层，而不是一个“万能向量库”。Agent 根据任务选择合适的数据源和检索工具；检索服务负责权限、过滤、排序和证据定位；LLM 负责理解问题、组织检索步骤和综合证据。

## 8. 最后一个容易犯的错误：把 Agent 搜索能力差，当成缺少 Embedding

如果 Agent 经常找不到文件，不要立即加向量索引。先检查：

1. Agent 是否知道有哪些目录和数据源？
2. `grep` / `rg` 是否排除了需要搜索的文件？
3. 文件解析是否能正确处理 PDF、DOCX、HTML、表格和扫描件？
4. 业务缩写、别名和同义词是否有可用词典？
5. Agent 是否能在首次搜索失败后调整关键词和搜索范围？
6. 搜索结果是否过多，导致上下文被噪声填满？
7. 是否存在需要用 SQL、LSP、API 或专用连接器解决的问题？
8. Agent 是否能返回文件路径、版本、页码或行号，供人验证？

尤其要注意，**搜索不到内容和内容没有被正确解析，是两种不同的问题。** 如果 PDF 解析阶段丢失了表格，Embedding 只会把错误或不完整的文本向量化；如果文档根本没有进入索引，向量模型也不可能凭空找出它。

还有一种情况：Agent 的工具调用次数很多，但每次都在重复搜索相同内容。这可能需要更好的搜索计划、临时结果缓存、Agent Memory 或结构化笔记，而不一定需要向量数据库。Anthropic 在同一篇 Context Engineering 文章中把动态检索、结构化笔记、上下文压缩和 Sub-agent 视为解决长任务上下文问题的不同手段。不要把所有上下文问题都归到 RAG 名下。

## 结论：先证明文件检索不够，再引入索引

本地 AI Agent 的出现改变了知识检索的默认架构。过去，系统需要预先把大量内容整理成索引，再通过一个查询接口返回候选文档。现在，Agent 可以直接使用文件系统、命令行和结构化工具，按需发现内容、读取证据并继续探索。

这不意味着 Embedding 或 OpenSearch 失去了价值。LLM 可以把问题拆成多组词法和结构化查询，但它生成的表达始终是有限的，也未必知道语料内部的特殊语言。Embedding 可以补充词面之外的语义匹配；预计算索引则可以把高频检索从运行时探索转为稳定服务。两者都应该由真实任务中的召回缺口、延迟和治理要求来证明价值。

真正值得坚持的原则是：

**从精确检索开始；先修复数据和搜索策略；用真实任务测量失败；只有当失败模式明确指向语义召回或预计算索引时，再增加对应能力。**

如果最后需要的是 BM25，就不要为了 RAG 上 Embedding；如果只需要 Embedding，就不要为了向量检索顺手部署一整套 OpenSearch；如果需要的是结构化查询或权限治理，也不要指望向量相似度解决。

架构不是功能清单。每增加一层索引，都应该对应一个已经被测量、并且现有方案无法经济解决的问题。

## 参考资料

1. Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents), 2025-09-29。关于 Just-in-time Context、Agentic Search、预计算检索的权衡，以及 Claude Code 使用 glob / grep 的实践。
2. VS Code, [How Copilot understands your workspace](https://code.visualstudio.com/docs/agents/reference/workspace-context)。关于 Copilot 的文本搜索、Grep、文件搜索、符号检索、语义索引和排除规则。
3. Pi, [Command Line](https://docs.pi.dev/latest/cli)。关于 Pi 内置 read、bash、grep、find、ls 等工具及工具配置。
4. OpenSearch, [Vector search concepts](https://docs.opensearch.org/latest/vector-search/getting-started/concepts/)。关于 Embedding、k-NN、Semantic Search、Hybrid Search、Reranking 和 RAG 的能力边界。
5. OpenSearch, [Hybrid search](https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/)。关于词法与语义检索结果的归一化和 RRF 融合。
6. GitHub Copilot, [Researching with GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/research-with-copilot-cli)。关于使用 grep、glob 和 view 对代码仓库进行探索式研究。
7. Zhang et al., [Exploring the Best Practices of Query Expansion with Large Language Models](https://aclanthology.org/2024.findings-emnlp.103/), EMNLP Findings 2024。关于多样化查询扩展、融合策略及其效果。
8. Weller et al., [When do Generative Query and Document Expansions Fail?](https://aclanthology.org/2024.findings-eacl.134/), EACL Findings 2024。关于扩展可能带来收益，也可能引入噪声并损害强检索器排序的实证分析。


9. Anthropic, [How Claude Code works in large codebases](https://claude.com/resources/articles/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start), 2026-05-14。关于百万行级代码库、分层上下文、排除规则、LSP 和结构化搜索。
10. OpenAI, [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)。关于优先使用 rg / rg --files、专用文件工具和并行工具调用。
11. Manus, [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus), 2025-07-18。关于文件系统外部上下文、工具结果卸载、KV-cache 和上下文管理。
12. Pi, [Pi coding-agent source](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)。关于 minimal coding harness 和 read / write / edit / bash 默认工具。
13. LangChain, [Context Engineering Starts with Retrieval](https://www.langchain.com/blog/context-engineering-starts-with-retrieval), 2026-10-23。关于 Deep Agents 的 glob / grep / 分页读取、大结果卸载和 subagent 委派。
14. LangChain, [How agents can use filesystems for context engineering](https://www.langchain.com/blog/how-agents-can-use-filesystems-for-context-engineering), 2025-11-21。关于文件系统作为上下文工作区，以及代码和技术文档中语义检索的局限。
15. Atlarix, [How We Deleted Our Retrieval Index and 5,246 Lines With It](https://www.atlarix.dev/blogs/how-we-deleted-our-retrieval-index)。关于索引维护成本、文件监听器开销和退回 grep / glob 的工程复盘。
16. AWS, [How Amazon Finance streamlines regulatory inquiries](https://aws.amazon.com/blogs/machine-learning/how-amazon-finance-streamlines-regulatory-inquiries-by-using-generative-ai-on-aws/), 2026-05-12。关于最多五个 Query Expansion 变体、并行 Retrieve 和检索延迟优化。
17. AWS, [How IskayPet unified corporate knowledge with Amazon Bedrock Managed Knowledge Bases](https://aws.amazon.com/blogs/machine-learning/how-iskaypet-unified-corporate-knowledge-with-amazon-bedrock-managed-knowledge-bases/), 2026-10-22。关于多语言 SharePoint、Hybrid Search、文档 ACL、候选数量控制和生产结果。
18. AWS, [Novo Nordisk modernizes manufacturing process documents with Amazon Bedrock AgentCore](https://aws.amazon.com/blogs/machine-learning/novo-nordisk-modernizes-manufacturing-process-documents-with-amazon-bedrock-agentcore/), 2026-11-16。关于四百万份受控文档、GraphRAG、Hybrid Search、实体范围澄清和版本关系。
19. AWS, [Agentic retrieval for Amazon Bedrock Managed Knowledge Base](https://aws.amazon.com/blogs/machine-learning/agentic-retrieval-for-amazon-bedrock-managed-knowledge-base/), 2026-07-23。关于 MuSiQue 多跳检索的 Recall 增益，以及 Agentic Retrieval 的延迟与成本权衡。
