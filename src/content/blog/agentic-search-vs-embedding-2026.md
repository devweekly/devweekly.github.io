---
author: SW
pubDatetime: 2026-11-17T12:00:00Z
title: "Agentic Search 的边界：什么时候才需要 Embedding"
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
description: "从 Claude Code、Codex、Manus、Pi 和 AWS 的工程实践出发，分析 grep、glob、find 与 LLM 查询规划能做到什么程度，以及语义检索和独立搜索平台真正解决的问题。"
---

# Agentic Search 的边界：什么时候才需要 Embedding

**研究截止日期：2026 年 11 月 17 日**

做 Agent 知识检索，最容易走的一条弯路，是还没弄清楚用户要找什么，就先把文档切块、生成 Embedding，再部署一套向量检索服务。

这套做法当然能用。但在很多场景里，Agent 已经有文件系统、Shell 和一组简单工具：先用 `glob` 或 `find` 找文件，再用 `grep` / `rg` 搜索，读取少量结果，发现线索后继续追踪。它可以根据第一次搜索的结果修改关键词，也可以把一个问题拆成几组查询并行执行。

这就是 Agentic Search。它把一部分原本由离线索引完成的工作，交给 Agent 在运行时处理。

Anthropic、OpenAI、Manus、Pi 和 LangChain 的公开实践都能看到这种思路。它们并没有把 Embedding 当成 Agent 获取知识的默认入口。对于代码仓库和结构清楚的工作区，文件搜索、Shell、符号导航和按需读取往往更直接。

但这并不意味着 grep 可以解决所有检索问题。它的扫描速度可以优化得很高，Agent 也可以通过 Query Expansion 弥补一部分词汇差异；真正难以绕过的是语义召回、相关性排序、跨来源关系、非文本内容，以及生产环境中的延迟和治理要求。

这篇文章讨论的不是“RAG 要不要用”，而是一个更具体的架构问题：**先把 Agentic Search 做到什么程度，才算合理地证明它不够用？接下来应该增加全文索引、Embedding、Chunking，还是一套独立搜索平台？**

## 1. Agentic Search 为什么经常已经够用

假设用户提出一个开发任务：

> 找出项目里所有处理用户身份认证的逻辑，说明登录、Token 校验和权限判断分别在哪里实现，以及它们之间的调用关系。

Agent 可以先看目录，再搜索相关术语和符号：

```bash
find . -maxdepth 3 -type f
rg -n -i "auth|authenticate|authorization|token|session" .
rg -n "verifyToken|checkPermission|requireAuth" src test
```

接下来读取候选文件，查看测试和调用方。如果结果太多，就缩小目录或增加文件类型过滤；如果没有命中，就换一组表达；如果找到函数定义，就继续追踪引用。

这和传统检索有一个重要区别：传统检索通常先准备索引，查询时返回一批候选内容；Agentic Search 则把“下一步搜什么”也纳入运行时过程。Agent 根据已读到的内容继续找，直到证据足以回答问题。

文件系统本身也提供了不少线索。目录、文件名、扩展名、Git 历史、模块边界和相邻文件，往往已经表达了内容之间的关系。对于代码库，`src/auth/token.ts`、`tests/auth/token.test.ts` 和 `docs/security/token-lifecycle.md` 之间的路径关系，本身就有检索价值。

这套方式有几个实在的优点：

- 搜索函数名、错误码、配置键、业务术语和文件路径时，精确匹配通常比语义相似度更可靠。
- 文件修改后可以立即搜索，不需要等待切片、Embedding 生成和索引刷新。
- 结果直接指向文件和行号，便于检查原文、追踪调用关系。
- 不需要额外维护向量模型、索引存储和同步任务。
- 搜索不完整时，Agent 可以调整范围和查询，不必把第一次结果当成最终答案。

Anthropic 在 [Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) 中讨论过 Just-in-time Context：与其提前把大量内容塞进上下文，不如保留文件路径、查询或链接，在需要时再通过工具加载。Claude Code 使用 Bash、glob 和 grep 探索代码库，就是这种做法的具体体现。

不过，Agentic Search 并不免费。它把部分成本从离线索引阶段移到了每次请求中。一次复杂任务可能需要多轮搜索、读取和推理；每次工具调用都有延迟，搜索结果也会消耗上下文。更麻烦的是，Agent 的搜索路径并不总是稳定，同一个问题可能因为查询词或目录选择不同而得到不同结果。

所以，不能只看 `rg` 扫描用了多少毫秒。实际需要比较的是：

```text
一次检索任务的总成本
= 工具调用与 I/O 延迟
+ 搜索结果占用的上下文
+ Agent 规划和反复探索的推理成本
+ 漏掉证据后的返工成本
```

如果这些成本仍然低于建立和维护索引的成本，就没有必要为了架构看起来完整而引入 RAG。

## 2. 先把 grep 做好：性能优化与能力边界

讨论 Embedding 之前，应该先把词法检索做到合理的工程状态。很多所谓“grep 搜索不行”，实际原因是搜索范围太大、结果太多、目录结构不清楚，或者 Agent 每次都从头扫描。

### 2.1 把搜索范围缩小

本地仓库优先用 `rg --files`、`fd` 或 glob 找到候选文件，再对目标目录搜索。尊重 `.gitignore`，排除 `node_modules`、`dist`、`build`、生成代码、二进制文件和无关日志。能按扩展名、目录、时间或来源过滤，就不要把整个仓库交给一次宽泛的正则搜索。

对 monorepo，目录地图和分层项目说明很有用。Agent 先确定相关 package 或 service，再进入局部范围搜索，通常比在仓库根目录反复试关键词有效得多。

### 2.2 控制结果，不要把命中全部塞进上下文

第一轮搜索的目的通常是找出候选文件，而不是读取所有匹配内容。可以先用 `rg -l` 取文件列表，再用行号和少量上下文定位；使用计数、单文件最大命中数和分页，避免高频词造成结果洪泛。

完整结果可以写入临时文件，主上下文只保留路径、摘要和少量预览。需要时再读取指定片段。重复任务可以缓存文件清单、元数据和查询结果，并在文件变更后按路径或内容哈希失效。

多个独立子问题也不必串行执行。Agent 可以并行搜索不同术语或目录；如果工具调用开销比实际扫描更大，可以把多条查询合并到一次 Bash 批处理里。

### 2.3 grep 不擅长的事，交给结构化工具

继续增加正则表达式，并不能让 grep 理解代码结构或业务关系。不同问题应该使用不同工具：

| 问题 | 更合适的工具 |
| --- | --- |
| 函数定义、引用、类型和调用关系 | LSP、AST、Tree-sitter |
| 重复执行的大量词法查询 | SQLite FTS5、Tantivy、BM25 |
| 日期、来源、版本、业务域和状态过滤 | SQL、元数据索引 |
| 多个远程数据源、并发和稳定 SLA | 集中式全文检索服务 |
| 词面不同但含义相关的内容 | Embedding / Dense Retrieval |
| 多跳实体和业务关系 | 图查询或知识图谱 |

对代码库来说，LSP 往往比把更多 grep 结果交给模型更有效。它能直接返回符号定义和引用，减少同名函数、跨语言调用带来的噪声。Anthropic 的大代码库实践也强调了分层项目说明、目录作用域、排除生成文件，以及 LSP 和 MCP 结构化搜索。

### 2.4 grep 的天花板不是文件数量

把搜索执行性能和检索质量分开，边界会更清楚。

| 维度 | 优化后的 Agentic Search | 继续优化也难以解决的问题 |
| --- | --- | --- |
| 扫描速度 | ripgrep、SSD、目录预筛选、文件类型过滤，能让本地搜索很快 | 远程文件系统、跨区域 I/O、大量小文件的访问成本 |
| 结果规模 | 路径过滤、计数、分页、上下文窗口能控制输出 | 命中多不代表相关，grep 不知道哪段最能回答问题 |
| 查询覆盖 | LLM 可生成同义词、缩写、中英文表达和子问题 | 未被生成的语料特有表达，仍可能完全没有词面命中 |
| 相关性排序 | BM25、路径权重、时间和规则可以改善排序 | 难以判断没有相同词语、但语义上真正回答问题的内容 |
| 结构理解 | LSP、AST 和符号索引能补足代码结构 | 通用文本搜索不理解复杂实体关系、因果链和文档版本依赖 |
| 内容类型 | OCR 和文档解析后可以搜索提取文本 | 图片、图表、复杂表格和音视频需要专门解析 |
| 企业治理 | 受控目录和文件权限可以限制搜索范围 | 跨系统 ACL、用户级 Entitlement、索引隔离和审计需要独立设计 |

本地扫描速度通常不是最先遇到的瓶颈。更难解决的是：查询表达没有覆盖目标内容、结果无法按语义相关性排序、信息散落在不同系统，或者内容本身不是可直接搜索的文本。

这也是为什么不能用“文件数量超过多少”作为 Embedding 的触发阈值。十万份命名规范、结构清楚的代码文件，可能仍然适合文件搜索；几百份表达混乱、术语不统一的业务文档，反而可能很需要语义召回。

## 3. 一线 Agent 项目实际上怎么做

Anthropic、OpenAI、Manus、Pi 和 LangChain 的实现有一个共同点：文件系统和 Shell 是很有用的基础能力，但它们没有声称这套能力适合所有数据和所有查询。

| 项目 | 公开实践 | 能说明什么 |
| --- | --- | --- |
| Anthropic / Claude Code | 文件遍历、grep、引用追踪；通过分层 CLAUDE.md、目录范围、排除规则、LSP 和 MCP 辅助大型代码库导航 | 大仓库不自动意味着需要向量索引；导航和结构化工具很重要 |
| OpenAI / Codex CLI | 文档建议使用 `rg` / `rg --files`、专用文件工具，并行执行互不依赖的搜索和读取 | 基础搜索工具和调用方式本身值得优化 |
| Manus | 把文件系统作为外部上下文；大型工具结果卸载到文件，保留引用，需要时再读取 | 检索之外，还要管理结果和上下文生命周期 |
| Pi | 默认工具保持精简，以 read、write、edit、bash 为核心，再通过扩展增加能力 | 不必把每一种文件操作都包装成复杂的专用工具 |
| LangChain / Deep Agents | 提供 ls、glob、grep、分页读取；大结果卸载到文件，并支持委派给子 Agent | 即使用 RAG，也不能忽略上下文容量和结果管理 |

这些材料的证据性质并不相同：Anthropic、OpenAI、Manus 和 LangChain 的文章与文档是官方工程实践；Pi 的代码仓库可以核对工具实现。它们不是在相同数据集、硬件和查询集上做的 grep 与 Embedding 对照实验。因此，它们能说明这些团队怎样设计 Agent 的默认工具，但不能用来证明 grep 在任何规模下都优于向量检索。

一个值得单独看的反例来自 Atlarix。团队复盘了检索索引的维护成本：文件监听器占用文件描述符，索引刷新反复读取仓库，复杂度却没有带来足够的搜索收益。最后他们删除了检索索引，退回 ripgrep 驱动的 grep / glob。作者也承认词法搜索有明显短板，例如搜索 authentication 未必能找到命名为 verifyCredentials 的实现。这个案例的价值不在于“索引都没用”，而在于提醒我们：**索引是一项需要持续维护的系统，不是加上去就只有收益。**

参考：[Anthropic: Claude Code at scale](https://claude.com/resources/articles/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start)；[OpenAI: Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)；[Manus: Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)；[Pi coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)；[LangChain: Context Engineering Starts with Retrieval](https://www.langchain.com/blog/context-engineering-starts-with-retrieval)；[Atlarix: How We Deleted Our Retrieval Index and 5,246 Lines With It](https://www.atlarix.dev/blogs/how-we-deleted-our-retrieval-index)。

## 4. LLM 能扩展查询，但为什么还需要 Embedding

“用户不知道该用哪些关键词”不是引入 Embedding 的充分理由。LLM 可以先理解问题，再把它拆成多个检索任务。原始问题不必直接交给 grep。

例如，用户问：

> 找出所有讨论客户资产在市场剧烈波动期间如何保持流动性的材料。

Agent 可以拆成现金管理、流动性风险、资产变现、赎回压力、市场压力和监管指标等概念，再生成中英文表达、缩写和相关术语。随后分别执行 grep、BM25 或元数据查询，合并去重结果，读取证据，并检查哪些概念仍然没有覆盖。

```text
用户问题
  -> 意图、实体、概念和约束识别
  -> Query Decomposition / Expansion
  -> grep / BM25 / SQL / API / LSP
  -> 合并结果并读取原文
  -> 检查证据覆盖
  -> 有缺口时生成针对性查询
```

这比把用户原句直接向量化一次更灵活，也更容易解释搜索过程。但 Query Expansion 不是无限覆盖。LLM 生成的查询是有限的；它未必知道某个机构内部的项目代号、历史缩写、团队黑话或供应商字段名。即使生成了足够多的近义词，词法检索仍然依赖查询和文档之间存在某种词面交集。

查询数量也不是越多越好。扩展过度会把主题相近但并不回答问题的内容带进来，增加排序噪声和上下文成本。EMNLP 与 EACL 2024 的相关研究都显示，LLM Query Expansion 的效果取决于检索器和扩展策略；它可能改善召回，也可能损害原本较强的检索排序。

因此，Embedding 真正值得试点的情况是：

- 语料里有大量组织内部表达、历史叫法或跨语言写法，无法靠有限词典和查询扩展覆盖。
- 用户描述的是业务现象或隐含机制，文档从不同角度表达，简单同义词扩展仍然找不到。
- 在真实问题集上，Query Expansion + BM25 / grep / 结构化查询仍稳定漏掉相关证据，而 Dense Retrieval 能补回这些证据。
- 查询频率高，运行时多轮探索的 P95 延迟和 Token 成本不可接受，需要把部分检索工作提前到索引阶段。

关键是用真实查询验证，而不是凭直觉判断“语义搜索应该更聪明”。Embedding 也会漏召回，也会把语义相近但不适用的内容排上来。它增加的是另一种召回信号，不是正确答案保证。

参考：[Exploring the Best Practices of Query Expansion with Large Language Models (EMNLP Findings 2024)](https://aclanthology.org/2024.findings-emnlp.103/)；[When do Generative Query and Document Expansions Fail? (EACL Findings 2024)](https://aclanthology.org/2024.findings-eacl.134/)。

## 5. AWS 的案例说明了什么

AWS 的企业案例很有参考价值，因为它们展示的不是单纯的向量相似度，而是查询扩展、混合检索、权限过滤、候选控制和多跳检索如何组合。

**Amazon Finance：先扩展查询，再并行检索。** Amazon FinTech 团队处理数千份历史监管问询材料，来源包括 PDF、PPT、Word 和 CSV。方案采用 Bedrock Knowledge Bases 和 OpenSearch Serverless，并使用层级 Chunking。查询阶段先让 Claude 3.5 Haiku 生成最多五个查询变体，再并行调用 Retrieve API。AWS 文章报告，这样把原本顺序执行约 10 秒的检索过程缩短到 2 秒以内。

这个案例说明，即使采用 Embedding，原始问题也不应该被当作唯一查询；查询规划和并行执行仍然影响检索效果与延迟。

**IskayPet：多语言企业知识库需要的不只是向量。** IskayPet 的知识分散在数百份 SharePoint 文档中，涉及四种语言、三个国家和多个业务域。方案使用 Bedrock Managed Knowledge Bases 的 BM25 + Semantic Hybrid Search、Reranking 和文档级权限过滤。查询先取 25 个 passages，去重后最多将 15 个放入 Prompt。AWS 报告，操作问题的查找时间从 3–5 分钟降到约 7 秒，并预计支持每月约 100,000 次查询。

这里真正重要的是多语言检索、词法与语义召回的组合、权限过滤和候选数量控制，而不只是向量模型本身。

**Novo Nordisk：四百万份受控文档还涉及版本和关系。** AWS 2026 年 11 月发布的案例描述了约四百万份制造流程文档。方案结合 Neptune 知识图谱和 OpenSearch Hybrid Search：BM25 负责文档编号、设备代码等精确术语，向量检索补充语义召回，图谱提供流程层级、文档引用和实体关系，再通过 Reranker 调整候选顺序。系统还会澄清站点、产品代际和设备范围，避免把相似但不适用的文件当成答案。

这类问题已经不只是“找相似段落”。版本、生效范围、实体关系和原文可追溯性都影响答案是否适用。

**AWS Agentic Retrieval：向量检索之上仍然需要 Agent。** AWS 在 MuSiQue 多跳问题集上的测试显示，相较单次检索，AgenticRetrieve 对 2-hop、3-hop 和 4-hop 问题的 Recall 分别提升 22.8、31.9 和 37.3 个百分点。代价是更多模型调用、更高延迟和费用。AWS 因此建议把普通 Retrieve 用于短而明确的问题，把 Agentic Retrieval 留给多部分、比较型、探索型或跨知识库问题。

这些案例没有证明“所有企业都应该上 GraphRAG”或“所有检索都应该 Agentic”。它们展示的是不同组件各自解决的问题：BM25 找精确词项，Embedding 补语义召回，Metadata 和 ACL 控制范围，Graph 表达关系，Reranker 调整候选顺序，Agent 根据证据缺口决定是否继续检索。

参考：[Amazon Finance regulatory inquiries](https://aws.amazon.com/blogs/machine-learning/how-amazon-finance-streamlines-regulatory-inquiries-by-using-generative-ai-on-aws/)；[IskayPet Managed Knowledge Bases](https://aws.amazon.com/blogs/machine-learning/how-iskaypet-unified-corporate-knowledge-with-amazon-bedrock-managed-knowledge-bases/)；[Novo Nordisk manufacturing documents](https://aws.amazon.com/blogs/machine-learning/novo-nordisk-modernizes-manufacturing-process-documents-with-amazon-bedrock-agentcore/)；[AWS Agentic Retrieval](https://aws.amazon.com/blogs/machine-learning/agentic-retrieval-for-amazon-bedrock-managed-knowledge-base/)。

## 6. Embedding、Chunking、BM25 和 OpenSearch 不是一个决策

讨论 RAG 时，经常把 Embedding、向量数据库、Chunking 和 OpenSearch 混成一件事。实际上它们解决的是不同问题。

**Chunking 决定检索的基本单元。** 文档太长，直接整篇检索会让相关内容被稀释；切得太碎，又会丢失标题、表格上下文、定义和前后约束。Chunking 不是越小越好。应结合文档结构、段落边界、表格和业务语义设计，并保留文档 ID、章节、页码、版本、生效时间和来源位置。对于需要上下文的内容，可以采用父子块或层级检索：先命中较小的片段，再回到较大的上下文读取。

**Embedding 把文本转换成向量。** 它提供语义相似度匹配信号，但本身不负责文档解析、权限过滤、全文检索、版本管理或服务治理。

**向量索引负责保存和查询向量。** 小规模场景可以先用 PostgreSQL + pgvector 等现有能力，不必立即部署独立向量数据库。

**BM25 / 倒排索引负责词法检索。** 它适合精确术语、编号、缩写和词频相关性排序。需要反复执行大规模全文查询时，可以考虑 SQLite FTS5、Tantivy 或搜索平台。

**OpenSearch 是独立的搜索与分析平台。** 它支持倒排索引、BM25、向量检索、Hybrid Search 和相关排序能力。是否采用 OpenSearch，应该由数据源数量、查询并发、过滤需求、服务 SLA、索引生命周期和运维能力决定，而不是由“用了 Embedding”自动推导出来。

可以把决策拆成几层：

| 真实需求 | 需要评估的能力 | 不应直接推导出的结论 |
| --- | --- | --- |
| 精确术语、编号和短语检索 | 倒排索引 / BM25 | 不代表需要 Embedding |
| 词面不同但语义相关 | Embedding + Vector Search | 不代表需要 OpenSearch |
| 精确词和语义发现都重要 | Hybrid Search | 不代表必须部署独立向量数据库 |
| 日期、来源、版本、业务域和权限过滤 | Metadata / SQL / ACL | 不能交给向量相似度代替 |
| 跨系统、高并发和稳定 SLA | 集中式检索服务 | 不代表所有数据都必须向量化 |
| 初筛后需要更准确排序 | Reranker | 不代表必须建设复杂 RAG Pipeline |

金融问题经常同时需要精确匹配和语义发现。例如“找到集中度风险政策，并确认规则 INV-042 对单一发行人的限制”。“集中度风险”可能需要语义发现；规则编号和具体限制则需要精确检索。此时 Hybrid Search 有意义，但仍要用真实问题集验证融合策略是否改善结果。

## 7. 用真实问题决定是否升级

不要用“文档超过十万份”或“目录太大”作为升级标准。先收集一批真实问题，标注相关文档、必要证据片段和用户权限，再比较现有 Agentic Search 与候选检索方案。

30–100 个问题就可以作为第一轮基线，覆盖精确查找、语义发现、跨文档关系、时间过滤、权限过滤和多轮探索。问题要来自真实工作，不能只挑 Embedding 擅长的例子。

至少记录这些指标：

| 指标 | 关注点 |
| --- | --- |
| Recall@K | 前 K 个结果是否包含需要的证据 |
| Precision@K | 结果中有多少真正相关 |
| MRR / nDCG | 重要证据是否排在前面 |
| Task Success Rate | Agent 最终是否正确完成任务 |
| Time to Evidence / P95 | 找到可用证据需要多久，尾延迟是否满足 SLA |
| Token / Tool Calls | 检索消耗多少上下文和工具调用 |
| Freshness Lag | 新增或修改的内容多久能被检索到 |
| ACL Correctness | 是否只返回用户有权访问的内容 |
| Total Cost | Embedding、存储、更新、模型调用和运维的总成本 |

升级前先看失败原因：

- 如果失败来自目录混乱、排除规则错误、文档解析缺失或查询策略不合理，先修复这些问题。
- 如果主要问题是跨目录精确搜索慢、过滤和排序能力不足，先评估全文索引。
- 如果 Query Expansion + BM25 / grep 仍稳定漏掉语义相关证据，再试点 Embedding。
- 如果精确词项和语义召回各有价值，且融合后任务成功率提高，再采用 Hybrid Search。
- 如果问题已经涉及跨系统接入、高并发、P95 SLA、索引隔离、权限、监控和生命周期管理，再评估独立搜索平台。

尤其要单独检查权限和数据新鲜度。ACL 错误不能被平均 Recall 指标掩盖；新增政策几天后才进入索引，也可能比检索排序稍差更严重。

## 8. 放到金融服务企业，应该怎样组合

金融服务企业通常不是一个统一的文档库，而是多种数据类型和权限模型并存。把所有内容切成 Chunk，再统一做 Embedding，既不经济，也容易把不同的数据语义混在一起。

| 数据类型 | 优先访问方式 | 主要约束 |
| --- | --- | --- |
| 持仓、价格、风险指标和交易状态 | 受控 SQL / API / 数据平台 | 精确口径、时间语义、数据血缘 |
| 源代码、配置和工程文档 | grep / LSP / 文件搜索 | 版本、路径、行号 |
| 政策、研究报告和操作手册 | BM25，必要时增加 Embedding | 版本、生效日期、文档 ACL |
| 内部业务定义和指标口径 | 元数据、业务词典、Semantic Layer | 定义所有权和口径一致性 |
| 邮件、工单和会议记录 | 来源连接器 + 全文检索，必要时 Hybrid | 用户权限、时间和来源 |
| 图片、扫描件和图表 | OCR、文档解析或多模态检索 | 解析质量和原始文件引用 |

结构化金融数据尤其不应该被 Embedding 取代。价格、持仓、风险敞口和 NAV 应通过受控 SQL 或 API 查询。向量检索可以帮助找到政策解释、研究材料或指标定义，但不能用相似文本回答“当前持仓是多少”。

权限也不能交给 LLM 判断。不同用户可能对研究报告、客户数据、投资组合和交易记录拥有不同权限。文档 ACL、行级权限、字段级权限和业务 Entitlement 不是一回事。检索必须在授权边界内执行，不能先召回所有内容，再让模型决定哪些能看。

检索结果还必须能回到权威原文。至少保留来源、版本、生效时间、更新时间和原文位置。Embedding 是派生数据，不是权威记录，也不能成为审计证据的唯一来源。

因此，企业更需要一个检索路由层：Agent 根据任务选择 SQL、文件搜索、BM25、Embedding 或图查询；检索服务负责授权、过滤、排序和证据定位；LLM 负责理解问题、安排搜索并综合证据。它不应该是一个试图用向量库包办所有数据访问的系统。

## 9. 决策顺序

下图把前面的判断收敛成一条实际选型路径：先理解问题，再利用 Agentic Search；搜索失败时先诊断原因，确认是语义召回缺口后再引入 Embedding。OpenSearch 则单独根据平台需求评估。

<iframe src="/diagrams/agentic-search-decision-2026.html" title="Agentic Search 与 Embedding 的检索决策树" width="100%" height="1120" loading="lazy" style="border:0;max-width:100%;"></iframe>

<small>图：Agentic Search、Embedding 与独立搜索平台的决策顺序。<a href="/diagrams/agentic-search-decision-2026.html">单独打开图表</a>。</small>

最后可以归结为三条：

1. **先把现有搜索用好。** 目录、过滤、并行查询、结果控制、LSP 和元数据，往往比一开始引入向量索引更值得做。
2. **先证明语义召回有缺口。** LLM Query Expansion 能解决一部分词汇差异，但它不是无限覆盖；Embedding 也不是正确性保证。
3. **把检索能力和平台基础设施分开决策。** 需要 Embedding，不等于需要 OpenSearch；需要 OpenSearch，也不等于所有数据都要做向量化。

架构升级应该对应一个已经测量出来的问题。没有这个问题，就没有必要增加索引、同步链路和新的运维负担。

## 参考资料

1. Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents), 2025-09-29。Just-in-time Context、Agentic Search 和预计算检索的权衡。
2. Anthropic, [How Claude Code works in large codebases](https://claude.com/resources/articles/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start), 2026-05-14。大型代码库中的目录导航、分层上下文、排除规则、LSP 和结构化搜索。
3. OpenAI, [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)。`rg`、文件工具和并行工具调用的使用建议。
4. Manus, [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus), 2025-07-18。文件系统外部上下文、工具结果卸载和上下文管理。
5. Pi, [Pi coding-agent source](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)。coding agent 的精简工具集和扩展方式。
6. LangChain, [Context Engineering Starts with Retrieval](https://www.langchain.com/blog/context-engineering-starts-with-retrieval), 2026-10-23。Deep Agents 的文件检索、分页读取和结果卸载。
7. LangChain, [How agents can use filesystems for context engineering](https://www.langchain.com/blog/how-agents-can-use-filesystems-for-context-engineering), 2025-11-21。文件系统作为 Agent 上下文工作区。
8. Atlarix, [How We Deleted Our Retrieval Index and 5,246 Lines With It](https://www.atlarix.dev/blogs/how-we-deleted-our-retrieval-index)。检索索引维护成本与退回 grep / glob 的工程复盘。
9. VS Code, [How Copilot understands your workspace](https://code.visualstudio.com/docs/agents/reference/workspace-context)。文本搜索、Grep、文件名搜索、符号检索和语义索引。
10. Zhang et al., [Exploring the Best Practices of Query Expansion with Large Language Models](https://aclanthology.org/2024.findings-emnlp.103/), EMNLP Findings 2024。LLM 查询扩展的策略与效果。
11. Weller et al., [When do Generative Query and Document Expansions Fail?](https://aclanthology.org/2024.findings-eacl.134/), EACL Findings 2024。查询扩展可能引入噪声并影响强检索器排序的实证研究。
12. AWS, [How Amazon Finance streamlines regulatory inquiries](https://aws.amazon.com/blogs/machine-learning/how-amazon-finance-streamlines-regulatory-inquiries-by-using-generative-ai-on-aws/)。查询扩展、并行 Retrieve 和检索延迟优化。
13. AWS, [How IskayPet unified corporate knowledge with Amazon Bedrock Managed Knowledge Bases](https://aws.amazon.com/blogs/machine-learning/how-iskaypet-unified-corporate-knowledge-with-amazon-bedrock-managed-knowledge-bases/)。多语言 SharePoint、Hybrid Search、文档 ACL 和候选数量控制。
14. AWS, [Novo Nordisk modernizes manufacturing process documents](https://aws.amazon.com/blogs/machine-learning/novo-nordisk-modernizes-manufacturing-process-documents-with-amazon-bedrock-agentcore/)。大规模受控文档、GraphRAG、Hybrid Search 和版本关系。
15. AWS, [Agentic retrieval for Amazon Bedrock Managed Knowledge Base](https://aws.amazon.com/blogs/machine-learning/agentic-retrieval-for-amazon-bedrock-managed-knowledge-base/)。多跳问题的 Agentic Retrieval 效果与成本权衡。
16. OpenSearch, [Vector search concepts](https://docs.opensearch.org/latest/vector-search/getting-started/concepts/)。Embedding、k-NN、Semantic Search、Hybrid Search 和 Reranking。
17. OpenSearch, [Hybrid search](https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/)。词法与语义结果的融合方式。
18. Pi, [Command Line](https://docs.pi.dev/latest/cli)。Pi 内置工具和命令行使用方式。
