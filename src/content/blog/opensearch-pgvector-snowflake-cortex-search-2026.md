---
author: SW
pubDatetime: 2026-11-18T08:00:00Z
title: "OpenSearch、pgvector 与 Snowflake Cortex Search：企业检索架构怎么选"
featured: false
draft: false
tags:
  - Search
  - OpenSearch
  - PostgreSQL
  - pgvector
  - Snowflake
  - Cortex Search
  - RAG
  - Enterprise Architecture
  - AI Architecture
description: "从检索内核、数据路径、业务场景、权限与运维成本比较 OpenSearch、PostgreSQL pgvector 和 Snowflake Cortex Search，并讨论企业为什么会混合使用它们，以及怎样划分边界。"
---

# OpenSearch、pgvector 与 Snowflake Cortex Search：企业检索架构怎么选

**研究截止日期：2026 年 11 月 18 日**

企业做 AI Search 或 RAG，常见的技术选型问题是：已经有 PostgreSQL，装上 pgvector 是否就够了？OpenSearch 也支持向量检索，是否可以替代专门的向量数据库？如果企业的数据平台已经在 Snowflake，Cortex Search 是否能把检索层也统一进去？

这三个产品都能做向量检索，但它们不是同一类东西。OpenSearch 是以搜索为中心的分布式搜索与分析引擎；pgvector 是把向量能力带进 PostgreSQL 的扩展；Cortex Search 则是 Snowflake 提供的托管检索服务，重点是直接对 Snowflake 中的数据建立混合检索能力。把它们放在一张“向量数据库性能榜”里比较，容易忽略真正决定架构的差异：数据在哪里、更新有多快、检索逻辑有多复杂、权限如何执行，以及团队愿意承担多少搜索基础设施。

先给一个简明判断：搜索本身是产品核心能力、需要丰富的全文检索和排序控制，优先评估 OpenSearch；检索对象本来就在 PostgreSQL，数据规模和查询负载仍在数据库合理范围内，而且业务查询需要事务数据、关系过滤和向量相似度一起完成，pgvector 往往是更简单的选择；数据已经治理在 Snowflake，目标是以较少工程投入为文档问答、企业知识搜索和 Agent 提供托管检索，Cortex Search 值得优先验证。

这不是互斥选择。成熟企业经常会让不同检索系统服务不同的数据域和工作负载。真正需要避免的是：同一批数据被无目的地复制到三个系统，团队却没有定义谁是权威数据源、谁负责权限、谁负责更新，以及检索结果如何回到业务对象。

## 一、先把两个“混合”概念分开

讨论架构之前，需要先区分 Hybrid Search 和 Hybrid Architecture。

**Hybrid Search（混合检索）**指一次搜索请求同时使用不同的召回方式，例如关键词检索与向量语义检索，再合并候选结果并排序。它解决的是“怎么找得更准”。OpenSearch 可以通过 search pipeline 归一化分数或使用 RRF 合并结果；PostgreSQL 可以组合全文检索与 pgvector，但排序融合通常需要自己写 SQL 或应用逻辑；Cortex Search 则把关键词检索、向量检索和语义重排整合为托管服务。

**Hybrid Architecture（混合架构）**指企业同时运行多个检索系统，各自服务不同数据域或请求类型。它解决的是“哪类数据应该由谁检索”。例如，实时产品目录走 OpenSearch，交易应用的个性化上下文走 PostgreSQL + pgvector，Snowflake 中的研究报告和制度文档走 Cortex Search。

两者不是一回事。一个系统可以提供 Hybrid Search，却不代表它适合承载企业所有检索需求；企业部署多个系统，也不代表每个系统内部都必须做复杂的混合检索。

## 二、三个产品的定位和边界

| 维度 | OpenSearch | PostgreSQL + pgvector | Snowflake Cortex Search |
| --- | --- | --- | --- |
| 产品定位 | 分布式搜索与分析引擎 | 关系数据库的向量扩展 | Snowflake 托管检索服务 |
| 主要数据模型 | Document / Index | Table / Row | 基于 SQL 查询定义的 Search Service |
| 关键词检索 | 原生全文检索，BM25 | PostgreSQL Full Text Search，GIN 等索引 | 托管关键词检索 |
| 向量检索 | k-NN 插件及多种 ANN 引擎 | pgvector，支持精确和近似检索 | 托管向量索引与检索 |
| 混合检索 | 原生 hybrid query、pipeline、分数融合/RRF | 全文检索与向量检索组合，融合逻辑由开发者控制 | 内置关键词、向量召回和语义重排 |
| 结构化过滤 | 丰富的字段过滤、聚合与查询 DSL | SQL、JOIN、事务与关系约束 | Search Service 的属性字段过滤 |
| 数据更新模型 | 索引写入与 refresh，适合搜索索引更新流 | 数据库事务、WAL、MVCC | 从源查询刷新索引，受 TARGET_LAG 等配置影响 |
| 扩展方式 | Shard、Replica、Cluster | 纵向扩展、只读副本及外部分片方案 | Snowflake 管理服务与服务容量 |
| 运维责任 | 自建或托管集群，仍需管理索引和查询行为 | PostgreSQL 运维，同时承担向量索引资源 | 基础设施由 Snowflake 管理，需管理服务、刷新和成本 |
| 适合的核心问题 | 搜索体验、复杂检索、规模与低延迟 | 业务事务数据旁边的相似度检索 | Snowflake 数据上的托管企业检索 |

表格中的“原生”不代表完全不需要工程工作。OpenSearch 仍需要设计索引、分片、向量模型、过滤和排序；pgvector 仍需要处理召回与全文排序的融合；Cortex Search 虽然托管了索引和检索流程，数据准备、权限设计、刷新策略和质量评估仍由使用方负责。

### OpenSearch：把搜索当成一项独立基础设施

OpenSearch 的基本对象是 Index 和 Document。它继承了 Lucene 搜索体系的核心思路：文本会被分析器拆成词项，建立倒排索引；查询时根据词项匹配和相关性算法（常见的是 BM25）召回文档。向量检索通过 k-NN 能力加入同一套搜索平台。

因此，OpenSearch 不只是“可以存 embedding 的数据库”。它适合同时处理精确词项、短语、字段权重、过滤、聚合、排序、搜索建议，以及向量语义召回。产品目录搜索、客户服务知识搜索、跨文档检索、日志和安全事件搜索，都可能从这套能力中受益。

在向量索引内部，OpenSearch 支持多种 ANN 方法和引擎。HNSW 通过多层近邻图减少搜索时需要访问的候选点；IVF 把向量划分到多个聚类列表，查询时只扫描部分列表；Faiss、Lucene 等引擎在过滤、内存和性能取舍上并不相同。OpenSearch 还支持量化和磁盘型检索路线，以降低大规模向量索引的内存压力。实际选择需要根据数据规模、更新频率、过滤条件、召回率和延迟压测，不能只看算法名称。

OpenSearch 的另一项优势是检索过程可控。Hybrid Search 可以分别执行关键词和向量查询，再通过 normalization processor 归一化分数并加权融合，也可以通过 score ranker 使用 Reciprocal Rank Fusion（RRF）。RRF 按各路召回的名次融合，不要求 BM25 分数和向量相似度分数处于同一个数值尺度。对于产品编号、证券代码、法律条款编号等精确匹配要求很高的场景，这种控制能力很重要。

代价是它需要被当作一套独立的分布式系统运营。分片数量、Shard 大小、Replica、Segment Merge、Refresh、Mapping、Analyzer、向量索引内存、查询并发和冷热数据管理都会影响性能与成本。数据通常需要从业务系统通过 CDC、消息队列或批处理同步到搜索索引。索引是面向检索的投影，不应轻易成为业务主数据的唯一权威副本。

### pgvector：让向量检索留在关系数据旁边

pgvector 的设计哲学不同。它没有试图把 PostgreSQL 变成完整的搜索平台，而是提供 vector、halfvec、bit、sparsevec 等数据类型，以及距离计算和索引能力，让 embedding 可以和业务表中的其他字段一起存储、查询。

pgvector 默认可以做精确最近邻搜索：逐行计算向量距离，得到准确结果。这对小规模数据、严格过滤后剩余数据较少的查询，或者需要先建立正确性基线的场景很有用。数据量上来后，可以增加 ANN 索引。当前主要的两类索引是 HNSW 和 IVFFlat。

HNSW 建立多层图结构，通常能在查询速度和召回率之间取得较好的平衡，但索引构建较慢、内存占用较高。IVFFlat 将向量划分为多个列表，查询时只探测一部分列表，通常构建更快、内存使用更低，但需要根据数据分布调整 lists 和 probes。它们不是“谁更新谁就一定更好”的关系，而是不同资源条件下的工程取舍。

pgvector 最容易被低估的优势其实不是向量算法，而是 PostgreSQL 本身。业务对象、权限关系、租户、状态、时间范围和 embedding 可以放在同一个数据库事务模型里。查询可以通过 SQL JOIN 关联客户、账户、产品、文档权限和业务状态；数据变更与向量记录也可以处于同一事务边界，避免为一个中小型应用额外维护一套搜索数据同步链路。

PostgreSQL 还有自己的全文检索能力：tsvector/tsquery、排名函数以及 GIN 索引。把它与 pgvector 组合，就能在数据库内部完成关键词和语义召回。问题在于，PostgreSQL 并没有像 OpenSearch 那样开箱即用的完整 hybrid query 和搜索 pipeline。开发者通常需要分别召回候选集，再用 SQL、RRF 或应用代码融合排序。对简单业务这不是障碍；当检索需要复杂 analyzer、多字段相关性、拼写纠错、搜索建议、复杂排序和高并发时，应用层自己拼装的成本会逐渐显现。

还要注意 ANN 与过滤条件的交互。pgvector 的近似索引扫描后再应用过滤条件时，候选结果可能被过滤掉，导致最终返回数量不足或召回率下降。pgvector 提供 iterative index scans 等能力缓解这一问题，也可以根据租户或类别使用分区、部分索引。多租户场景不能只在 SQL 中加一个 tenant_id 就认为性能和隔离问题已经解决：共享 ANN 索引可能让不同租户的数据分布影响搜索效率和召回表现，必要时要按安全域分区或隔离。

### Cortex Search：把 Snowflake 数据变成托管检索服务

Cortex Search 的出发点是减少企业自己搭建检索基础设施的工作。用户通过 SQL 定义 Search Service 的数据来源、搜索文本列和可返回/过滤的属性列，Snowflake 负责建立检索索引，并提供服务接口。默认路线把关键词检索、向量语义检索和语义重排组合起来。对于 RAG、企业知识搜索和 Agent 读取非结构化文本，这种集成能显著缩短从数据到可查询服务的路径。

一个重要区别是：Cortex Search 不是让应用直接对 Snowflake 表执行每一次向量距离计算。它会把源查询结果物化并建立面向低延迟服务的索引。创建服务时会构建索引，后续按 TARGET_LAG 检查源数据变化并刷新。刷新使用指定的 Virtual Warehouse 执行源查询和索引更新；在线检索则使用独立的多租户 serving compute。这样可以避免每次检索都依赖用户自己的 Warehouse，但也意味着数据更新到检索可见之间存在刷新延迟。

Cortex Search 的优势是少操心索引引擎、embedding 生成和相关性参数。对已经把研究报告、客户服务记录、制度文档、产品说明和其他数据治理在 Snowflake 的组织，这个服务可以直接使用 SQL 转换后的数据集，避免再建设一套完整的检索集群。它也支持 multi-index 场景：例如产品名称和 SKU 走文本索引，产品描述和评论走向量索引；已有 embedding 也可以作为用户提供的向量索引使用。

托管并不意味着没有成本。需要考虑初始建索引和后续刷新所用的 Warehouse 计算、文本 embedding 的 Token 计算，以及按索引数据量计费的 serving compute。源表更新频率、文本列数量、embedding 维度、服务数量和查询方式都会影响总成本。应该用真实数据做一轮成本估算，而不是只比较“自建集群”和“托管服务”的单价。

Cortex Search 还有一个必须进入架构评审的权限边界：Search Service 查询采用 owner’s rights。具有足够权限调用服务的角色，可以检索该服务已经索引的数据，即使它对底层源表没有相同的读取权限；底层表的 Row Access Policy 也不能被想当然地视为会按每个查询用户身份自动过滤搜索结果。Snowflake 官方文档明确说明了这一点。因此，不能把“用户没有源表 SELECT 权限”当作检索结果不会泄露的证明。应当在服务边界、索引数据范围、可过滤的授权属性和应用身份校验上明确设计；高敏感数据通常需要按安全域拆分服务，或采用经过验证的授权过滤模式，并对越权查询做负向测试。

## 三、技术内核差异：三种系统究竟在优化什么

把三者放到检索链路里看，差异会更直观。

| 层次 | OpenSearch | pgvector | Cortex Search |
| --- | --- | --- | --- |
| 文本索引 | Lucene 倒排索引与 BM25 | PostgreSQL 全文检索，常用 GIN | Snowflake 管理的关键词检索索引 |
| 向量索引 | k-NN 插件，HNSW/IVF 等方法和多种引擎 | PostgreSQL 扩展索引访问方法，HNSW/IVFFlat | Snowflake 管理的向量检索索引 |
| 分布式/执行单元 | Cluster、Shard、Replica、Segment | PostgreSQL 表、索引、事务与执行计划 | Search Service、刷新任务和托管 serving compute |
| 相关性融合 | Query DSL + Search Pipeline，可调归一化/RRF | SQL 或应用代码实现 | 内置混合召回与语义重排 |
| 数据更新 | 写入索引，经过 refresh 对搜索可见 | 事务提交后按数据库可见性规则读取 | 源查询刷新，受 TARGET_LAG 和刷新执行影响 |
| 调优重点 | 分片、索引、向量引擎、过滤、查询管线 | SQL 计划、索引参数、过滤选择性、数据库资源 | 数据集/列设计、刷新目标、服务成本、查询参数 |

OpenSearch 的文本检索和向量检索在一个专门的搜索引擎里协同工作。它的执行路径围绕分布式索引设计：协调节点把查询分发给相关 Shard，各 Shard 在自己的 Segment 上检索，再由协调节点合并结果。向量 ANN 索引也会与 Shard/Segment 的生命周期、内存和查询并发发生关系。这种设计能水平扩展，但集群和索引设计会成为长期运维工作。

pgvector 的向量索引则属于 PostgreSQL 的索引访问路径。SQL 仍由 PostgreSQL Planner 和 Executor 负责，事务、MVCC、WAL、备份恢复和权限模型仍然是数据库的机制。HNSW 或 IVFFlat 只是新增的向量索引访问方式，不会自动获得独立搜索引擎的分布式检索和相关性调优能力。它的价值在于减少系统边界，而不是把搜索功能做得最多。

Cortex Search 把内部索引实现和服务容量管理交给 Snowflake。用户主要定义数据源查询、搜索列、属性列、模型和刷新目标，通过服务接口检索。其代价是底层算法和索引生命周期的可控程度低于自建 OpenSearch/pgvector；收益是不用自己运营相应的检索节点和索引构建流程。对架构师来说，关键不是追问它是否也用了某个特定 ANN 算法，而是确认当前服务能否满足自己的过滤、延迟、刷新、权限和成本要求。没有公开承诺或可验证依据的内部实现细节，不应靠猜测补齐。

## 四、按业务案例选，而不是按“谁的向量检索更强”选

### 1. 电商、内容平台和面向用户的产品搜索：优先评估 OpenSearch

用户输入“适合雨天通勤的轻便外套”，系统需要理解语义；输入某个 SKU、品牌名或型号时，又必须精确匹配。搜索结果还要结合库存、价格、品类、地域、热度和个性化排序。这里的关键不是单纯找到语义相似的文本，而是一个完整的产品搜索体验。

OpenSearch 的全文检索、字段权重、过滤、聚合、suggestion、向量召回和排序管线适合承载这类工作负载。业务数据库仍然保存产品和库存的权威状态，OpenSearch 保存面向搜索的索引投影。库存等强时效字段可以在检索后回源校验，或通过 CDC 更新索引；不能因为搜索索引里有库存字段，就把它当成下单时的最终库存判断。

### 2. SaaS 应用中的上下文检索：优先评估 pgvector

假设一个 CRM 或投研应用已经用 PostgreSQL 保存客户、账户、研究笔记、任务和用户权限。应用要找“与当前客户情况相似的历史案例”，结果必须限定当前用户可访问的客户、指定业务线和最近一年记录。

如果数据量尚可，检索请求需要频繁 JOIN 业务表，而且更新要与事务数据保持一致，pgvector 可以减少额外的索引同步系统。可以在记录表里存 embedding，通过 SQL 先按租户、状态和授权范围过滤，再计算或索引向量相似度，并结合全文检索候选集。

这种方案的前提是数据库资源预算允许搜索负载存在。向量索引构建、ANN 查询和复杂全文检索会消耗 CPU、内存与 I/O，不能让面向用户的事务查询因为 Agent 搜索而受到影响。应监控慢查询、连接池、缓存命中、索引大小和 autovacuum；必要时把检索负载放到只读副本或独立检索系统。

### 3. 企业制度、研究报告、客户服务记录的 RAG：优先评估 Cortex Search（前提是数据已在 Snowflake）

企业往往已经把大量结构化和半结构化数据汇集到 Snowflake。数据团队维护清洗后的研究报告、产品说明、客户服务记录和业务术语字段，AI 应用希望对这些内容做问答、搜索和摘要。

Cortex Search 的价值在于可以从 Snowflake 中的 SQL 查询定义检索语料，自动处理 embedding、混合检索和索引服务。团队不必为了一个文档问答场景，额外搭建集群、索引更新任务和向量服务。尤其当检索数据本来就需要经过 Snowflake 的清洗、脱敏、数据产品和权限治理时，数据路径比较直接。

但如果数据要求秒级实时更新、检索需要复杂的自定义排序，或者用户权限必须严格继承源表的动态行级策略，就不能只因为数据在 Snowflake 就默认选择 Cortex Search。应先验证 TARGET_LAG 能否满足业务时效，并把 owner’s rights 的安全影响作为准入条件。

### 4. 日志、安全事件和运维知识：OpenSearch 通常更自然

日志、Trace、安全事件和告警数据通常具有高写入量、时间范围过滤、聚合分析、全文查询和近实时可见的要求。OpenSearch 本身就是搜索与分析引擎，能够在同一平台处理文本检索、过滤、聚合和向量语义搜索。将历史事件和处置手册接入混合检索，还可以为运维 Agent 提供上下文。

不过，日志分析与知识问答并不是同一种负载。海量原始日志不应该全部转换成 embedding；先通过时间、服务、严重级别、事件类型等结构化条件缩小范围，再对需要语义理解的事件描述或知识文档做向量检索，通常更合理。

## 五、有没有公司混合使用？公开案例能说明什么

公开资料能找到企业把关键词检索和向量检索放在同一系统内，也能找到企业在不同业务域使用不同数据平台的案例。但截至本文研究日期，没有找到足够可靠的公开材料，可以证明某一家企业明确同时在生产中使用 OpenSearch、pgvector 和 Snowflake Cortex Search 三者，并公开了完整的跨系统检索架构。因此，不能把“企业混合使用很常见”写成“三者一起用已经是某公司的标准实践”。

有几个公开案例可以说明不同路线的实际价值。

**Instacart：PostgreSQL 全文检索与 pgvector 组合。** Instacart 在 2025 年公开介绍了其搜索基础设施现代化过程。团队原本已经通过 PostgreSQL 提供全文检索，因此评估 pgvector 时，考虑的是把 embedding 检索纳入已有 Postgres 搜索体系，减少数据重复和额外维护，并利用 PostgreSQL 中实时商品可用性信息做过滤。其方案把 pgvector 的向量召回与 PostgreSQL 的全文检索排名结合起来。这是“关系数据和搜索数据靠得很近”时，使用 pgvector 的一个有代表性的工程案例。它证明了该路线在 Instacart 特定规模和工作负载下可行，不代表所有十亿级目录搜索都适合单个 PostgreSQL 集群。

**Atlassian：把搜索能力提升为独立平台。** OpenSearch 在 2026 年公布的案例称，Atlassian 运行了 300 多个集群、超过 200 亿文档，并将 OpenSearch 用于支持 AI 搜索相关工作负载。案例提到，原有基于 PostgreSQL 的搜索在不断增长的 AI 需求下遇到扩展压力，随后转向基于 Kubernetes 的 OpenSearch 平台。这个案例可以说明：当搜索已经成为跨产品、跨团队的基础能力，独立搜索平台的价值会超过把所有检索继续留在业务数据库里的便利。公开案例没有提供足够细节来还原 Atlassian 所有内部数据路径，因此不应推断其所有 PostgreSQL 工作负载都被迁移。

**LINE：OpenSearch 从日志平台扩展到 AI 检索基础设施。** OpenSearch 项目在 2025 年发布的案例材料描述了 LINE 的大规模 OpenSearch 平台，覆盖日志、监控、数据管道和实时搜索，并规划向向量检索、Hybrid Search 和 Agent 工作负载扩展。该案例反映的是平台化搜索路线：组织愿意投入专门的集群自动化和运维能力，以统一承载多类搜索与可观测性需求。具体规模和成果来自项目方发布的案例材料，属于厂商生态案例，不宜直接当作独立性能基准。

**Coda：Cortex Search 作为企业 AI 平台的检索层。** Snowflake 发布 Cortex Search 时引用了 Coda 的 Coda Brain 项目。Coda 表示 Cortex Search 能够支持其对公司结构化与非结构化数据的统一理解，并减少搜索基础设施的运维投入。这是 Cortex Search 与企业 AI 产品结合的公开客户反馈。它说明托管检索服务对产品团队的吸引力，但该材料没有披露完整部署规模、成本和独立评测，不能据此得出 Cortex Search 普遍优于自建搜索系统的结论。

这些案例呈现的不是一个统一答案，而是三种不同的工程出发点：已有 Postgres 搜索体系希望合并检索能力；搜索规模和复杂度上升，需要独立搜索平台；数据已经集中在 Snowflake，希望用托管服务快速建立 AI 检索能力。

## 六、企业如何混合使用：按数据域和一致性要求划分

在大型企业里，三个系统可以共存，但应该有明确分工。下面是一种适合金融服务企业的参考架构，不是上述客户案例的复刻。

| 数据域 / 业务请求 | 建议检索系统 | 选择原因 | 权威数据源 |
| --- | --- | --- | --- |
| 实时产品目录、证券/基金搜索、研究门户搜索 | OpenSearch | 精确代码匹配、全文检索、复杂过滤和排序 | 产品主数据、参考数据平台 |
| Agent 会话、用户工作区、轻量业务对象和个性化上下文 | PostgreSQL + pgvector | 事务关系、用户/租户过滤、低复杂度语义检索 | PostgreSQL 业务库 |
| 研究报告、制度文档、产品说明、已治理的客户服务语料 | Cortex Search | 数据已在 Snowflake，托管混合检索，减少独立索引运维 | Snowflake 数据产品/文档数据集 |
| 原始日志、Trace、安全事件 | OpenSearch | 高吞吐写入、时间过滤、聚合和全文查询 | 日志采集/对象存储 |

在这套架构中，Agent 不应该直接知道每种存储系统的细节。应用侧提供统一的 Retrieval API 或 Tool Registry，根据问题类型、数据域、权限上下文和时效要求选择后端。例如，“某只基金最近的投资限制是什么”可能需要从 Snowflake 的制度和产品文档中检索；“这个用户当前能看到哪些研究任务”应该由业务数据库执行授权过滤；“搜索某个证券代码对应的所有研究内容”则可能由 OpenSearch 负责召回，再回到权威数据源读取最新记录。

**关键是统一接口，不是统一存储。** 统一接口应当统一请求上下文、身份、过滤条件、结果结构、来源标识、分数含义和审计字段；不应该为了接口一致，把三个后端的能力压缩成最低公分母。OpenSearch 可以返回多路召回与排序信息，pgvector 可以返回 SQL 过滤和相似度结果，Cortex Search 可以返回其服务结果及属性。适配层需要保留这些来源信息，便于后续 reranking、评估和审计。

### 数据同步怎么做

每个检索系统都应该有清晰的权威源。OpenSearch 通常消费 CDC、事件流或批量数据，建立可重建的搜索投影；pgvector 如果与业务数据共库，可以在事务内更新 embedding 状态，异步任务负责生成或重算向量；Cortex Search 则从 Snowflake 中定义好的源查询刷新索引。

不要设计成 OpenSearch 更新后再同步到 PostgreSQL，PostgreSQL 更新后再同步到 Snowflake，最后三个系统互相追数据。更稳妥的做法是从权威数据源或统一事件流分别构建各自的检索投影。每个投影记录 source_id、source_version、updated_at、embedding_model 和 chunk_version，确保可以判断检索结果对应哪个数据版本，也能在模型升级或切片策略改变时重建。

### 权限不能靠检索结果返回后的过滤补救

金融服务场景尤其需要把授权放在检索设计中。比如研究报告按客户、业务线、地区、保密级别和用户角色授权。若先对所有文档做全局向量召回，再在应用层删除用户无权查看的结果，可能出现候选不足、侧信道风险和排序偏差；如果某个 Agent 或工具绕过了后置过滤，问题会更严重。

应尽量把可执行的授权约束转化为检索时过滤条件，并在后端服务或可信策略层验证用户身份和授权范围。OpenSearch 可以通过文档级安全能力或应用侧强制过滤实现，但要验证查询路径和身份传播；PostgreSQL 可以使用 RLS、租户分区和事务权限，并结合 ANN 过滤行为评估召回；Cortex Search 需要特别处理 owner’s rights，不能把源表行级策略当作自动生效的检索用户权限。高敏感语料可以按安全域拆分 Search Service，查询前由策略服务确定可访问的服务和过滤范围。

对于不可绕过的 Data Entitlement，LLM 不应决定过滤条件，也不能通过 Prompt 声明“只搜索用户有权访问的数据”来替代授权检查。策略决策应由确定性的授权组件执行，检索服务只接收已经验证的身份与约束。

## 七、成本与运维：不要只比较服务报价

三个方案的成本构成完全不同。

OpenSearch 的主要成本来自节点计算、内存、存储、网络和高可用冗余；向量索引尤其会影响内存占用和节点规格。还要计入集群升级、容量规划、索引重建、查询优化、告警和 on-call。托管 OpenSearch 能减少部分基础设施工作，但不会替你完成索引建模和相关性调优。

pgvector 看起来最便宜，因为它可能复用已有 PostgreSQL，但这不意味着检索没有成本。向量列和索引会扩大数据库存储与内存工作集，ANN 查询会与 OLTP 争用 CPU、I/O 和连接；备份、复制、VACUUM、索引维护和扩容也会受到影响。如果为了保护交易库而最终增加独立副本或专用集群，成本模型就不再是“零增量”。

Cortex Search 的成本更偏向服务使用量：初始建索引和刷新所需的 Warehouse 计算、embedding Token 计算、托管 serving compute，以及多索引和多列带来的额外开销。它减少了集群运维，但需要管理服务数量、刷新频率、索引数据量和查询模式。对低频、变化少的知识库，较长 TARGET_LAG 可能更经济；对频繁更新的数据，刷新目标和增量处理成本必须通过实际工作负载验证。

建议用同一份真实语料和查询集做 PoC，而不是用产品宣传页的延迟数字作比较。至少测量：Recall@K、MRR 或 nDCG、精确代码命中率、过滤后的召回率、P50/P95/P99 延迟、并发吞吐、数据更新到可检索的时间、索引重建时间，以及每千次查询和每百万文档的综合成本。对于 RAG，还应测量答案引用的正确性、证据覆盖率和越权检索率。检索命中率高，不代表生成答案就一定正确。

## 八、落地时可以按这几个问题做决策

| 问题 | 更倾向的选择 | 原因 |
| --- | --- | --- |
| 搜索是面向用户的核心产品能力，需要复杂全文检索、排序和聚合吗？ | OpenSearch | 搜索模型和调优空间更完整 |
| 数据已经在 PostgreSQL，检索需要与事务数据、关系和权限紧密结合吗？ | pgvector | 减少数据复制和系统边界 |
| 数据已经治理在 Snowflake，主要目标是快速提供 RAG/企业知识检索吗？ | Cortex Search | 托管索引和混合检索降低工程负担 |
| 必须支持复杂、可控的检索管线和多路召回吗？ | OpenSearch，或自建检索层 | 可控制召回、融合、过滤和排序 |
| 数据更新必须与业务事务强一致吗？ | pgvector | 同一数据库事务边界更直接 |
| 能接受按目标延迟刷新，且希望把索引运维交给平台吗？ | Cortex Search | 服务化管理更合适 |
| 多租户和文档级权限非常复杂吗？ | 先做安全 PoC，再选型 | 三者的权限执行模型不同，不能只看功能列表 |

如果仍然无法判断，先不要把三套系统全部部署。挑选一个真实业务切片，包含常见问题、精确标识符查询、语义改写问题、权限过滤、数据更新和低频长尾查询。用相同 embedding 模型、相同 chunk 规则和同一套评估集进行测试，避免把数据预处理差异误判为引擎差异。对 Cortex Search，另外验证刷新延迟、服务权限和 owner’s rights；对 pgvector，重点测试过滤条件下的 ANN 召回和数据库资源竞争；对 OpenSearch，重点测试分片布局、索引内存、Hybrid Search 融合和持续更新能力。

## 结语：选检索系统，先看数据和责任边界

OpenSearch、pgvector 和 Cortex Search 的差别，不在于谁“支持向量搜索”，而在于它们把复杂性放在哪里。

OpenSearch 把复杂性放在搜索平台本身，换来完整的搜索能力和控制空间；pgvector 把向量检索放进关系数据库，换来事务数据与检索数据的紧密结合；Cortex Search 把索引和在线检索基础设施托管起来，换来 Snowflake 数据上的快速交付，但需要接受服务边界、刷新模型和权限语义。

企业不必追求一个系统解决所有检索问题。更合理的目标是让每类数据在最合适的系统里被检索，同时明确权威源、同步机制、权限执行点、质量评估和故障降级路径。只有这些边界清楚，混合架构才是在分工，而不是在制造新的数据孤岛。

## 参考资料

### 官方文档与项目资料

- [OpenSearch：Vector search techniques](https://docs.opensearch.org/latest/vector-search/vector-search-techniques/)
- [OpenSearch：Methods and engines](https://docs.opensearch.org/latest/mappings/supported-field-types/knn-methods-engines/)
- [OpenSearch：Hybrid search](https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/)
- [OpenSearch：Vector search performance tuning](https://docs.opensearch.org/latest/vector-search/performance-tuning/)
- [pgvector：项目文档与索引说明](https://github.com/pgvector/pgvector)
- [PostgreSQL：Preferred Index Types for Text Search](https://www.postgresql.org/docs/current/textsearch-indexes.html)
- [Snowflake：Cortex Search overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview)
- [Snowflake：Query a Cortex Search Service / Access control](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/query-cortex-search-service)
- [Snowflake：ALTER CORTEX SEARCH SERVICE / TARGET_LAG](https://docs.snowflake.com/en/sql-reference/sql/alter-cortex-search)

### 公开客户案例

- [Instacart：How Instacart Built a Modern Search Infrastructure on Postgres](https://company.instacart.com/tech-innovation/how-instacart-built-a-modern-search-infrastructure-on-postgres)
- [OpenSearch：Atlassian's Success with OpenSearch for Mission-Critical Workloads](https://opensearch.org/case-studies/achieving-99-99-availability-atlassians-success-with-opensearch-for-mission-critical-workloads/)
- [OpenSearch：LINE's Journey to an AI Ready OpenSearch Platform](https://opensearch.org/case-studies/powering-194-million-users-lines-journey-to-an-ai-ready-opensearch-platform/)
- [Snowflake：Cortex Search: State-of-the-art hybrid search for RAG and AI App（含 Coda 客户反馈）](https://www.snowflake.com/en/blog/cortex-search-ai-hybrid-search/)
