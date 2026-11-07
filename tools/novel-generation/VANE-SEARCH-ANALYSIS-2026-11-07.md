# 检索引擎选型分析：Vane、SQLite FTS5、BM25 与本地 Embedding 模型

> 分析日期：2026-11-07  
> 范围：tools/novel-generation 的原文检索、写作上下文召回与后续检索架构  
> 决策状态：**Proposed**。建议先完成同语料 PoC，再决定是否将 Vane 作为生产检索后端。  
> 本文是针对当前代码的工程选型报告，不代表已经批准或实施 Vane 集成。

## 结论

Vane 值得进入候选方案，但目前没有足够证据支持直接把它作为生产环境的唯一检索引擎。它的优势不只是替换 BM25：它把中文 Jieba 分词、BM25、HNSW 向量检索和 RRF 混合排序封装在一个可嵌入 Node 进程的 Rust 引擎中。对于人物别名、情节语义相近、场景联想和跨段落主题检索，这些能力有潜在价值。

当前项目的检索实现则是一个轻量的 BM25-style 全文扫描器，适合早期原文定位，但已经承担普通章节、长章节和全文分析的上下文召回。继续扩展手写评分、分词和索引逻辑没有太大价值，应该把检索能力封装成独立服务，并用真实续写问题比较三条路线：

1. **SQLite FTS5 + Jieba 预分词**：实现和运维成本最低，作为成熟的词项检索基线。
2. **Vane text 模式**：验证 Vane 自带中文分词和 BM25 是否能直接替换现有实现。
3. **Vane hybrid 模式**：在同样的文本索引上增加 embedding 和向量召回，检验语义检索是否实际改善续写证据质量。

当前建议是：**先建立检索评测集和适配层，再做 Vane PoC；不要同时在生产路径维护 FTS5 与 Vane 两套全文索引，也不要因为 Vane 支持向量就默认每个检索任务都走 hybrid。** 如果 Vane 的混合检索在真实样本上有稳定收益，并且 Node 过滤、持久化与重建验收通过，再采用 Vane。否则 SQLite FTS5 足以替代手写实现。

## 1. 当前项目的检索现状

### 1.1 数据边界

当前架构已经把三类数据分开：

- **library/index.json**：导入后的原文片段及来源位置，是原文检索的基础数据。
- **novel.db**：全文分析、人物、事件、关系和章节知识库。
- **story.db**：续写过程中持续更新的人物状态、事件和情节状态。

原文检索不能取代后两类结构化查询。原文回答“原著具体写过什么”，成书知识库回答“目前从全文提取了哪些人物和事件资料”，Story State 回答“续写已经发展到什么状态”。三者的来源、可信度和生命周期不同，不应该因为引入搜索引擎而合并。

这一边界应继续保留：SQLite 是业务数据和结构化知识的事实来源；Vane 或 FTS5 只能保存可重建的检索投影。

### 1.2 现有 BM25 实现做了什么

当前 src/library.ts 的处理过程是：

- TXT / Markdown 导入后按章节切分，再切成带重叠的文本片段。
- 每个片段保存稳定 ID、源文件、章节、片段序号、字符起止位置、源文件哈希和章节起始偏移。
- 查询和文档使用同一套 terms() 规则：拉丁词项规范化、短词保留、较长 token 拆成二元组，并对连续文本补充中文字符二元组。
- 查询时逐个遍历缓存中的文档和词项，按简化的 IDF/TF 公式累加分数；完整查询字符串命中时额外加分。
- 搜索结果返回原文片段和来源位置，供调用方生成证据上下文。

这是一种可用的 BM25 风格评分，不是成熟搜索引擎的完整 BM25 实现，也没有真正的倒排 posting 列表。索引加载后仍需要对文档集合进行扫描，评分公式没有标准 BM25 的完整文档长度归一化和索引执行优化。它的优点是依赖少、结果可复现、实现透明；缺点是中文分词粗糙，短查询和专有名词命中不够稳定，召回和排序策略继续扩展会让自有代码逐渐变成一个需要维护的小型搜索引擎。

目前检索至少用于 CLI 原文搜索、全文分析 Agent 输入材料，以及长章节逐场检索。长章节查询会组合创作 brief、场景计划和相关人物名称，因此既包含精确词项需求，也包含场景语义需求。

### 1.3 当前实现的实际问题

现阶段最值得解决的不是搜索速度，而是检索质量和职责边界：

- 中文字符二元组能缓解无空格文本的子串匹配，但容易产生大量泛化匹配；两字姓名、别名和专有术语缺少稳定的词典语义。
- 检索请求把任务 brief、人物名称和场景描述拼在一起，词项命中会受到查询长度和高频字词干扰。
- 人物、地点、章节、时间线等结构化信息已经在 SQLite 中，全文索引却无法按这些条件可靠地预过滤。
- 当前评分只回答“文本与查询词有多少重合”，不能处理“表述不同但讲的是同类事件”的语义召回。
- 没有统一的 Search API 和可度量的检索质量基线，换引擎容易变成凭少数示例主观判断。

因此应停止继续堆叠手写评分逻辑；但是否需要向量检索，应由真实查询集决定。

## 2. Vane 能提供什么

项目：[ximing/vane](https://github.com/ximing/vane)  
版本基线：README / Node package 当前标示为 v0.4.1。  
关键资料：[中文 README](https://github.com/ximing/vane/blob/main/README.zh-CN.md)、[SPEC](https://github.com/ximing/vane/blob/main/docs/SPEC.md)、[REQUIREMENTS](https://github.com/ximing/vane/blob/main/docs/REQUIREMENTS.md)。

Vane 是嵌入式 Rust 检索库，不是托管搜索服务。它提供统一 Collection API，在同一数据集合上建立文本倒排索引和 HNSW 向量索引。Node 通过 N-API 调用 Rust core；不需要为普通 Node 集成运行独立搜索服务器。

### 2.1 对小说检索有价值的能力

**中文 Jieba 和自定义词典。** Vane 内置 Jieba 分词，并允许通过 userDict 注入领域词条。人物姓名、别名、地名、势力名称、物品和能力名称，都比无词典的字符二元组更适合采用词典切分。运行期修改词表需要显式 reindex()，其设计避免新旧分词身份混用。

**成熟的 BM25 实现。** Vane 使用 Block-Max WAND 进行 top-k 文本检索。即使暂时不使用向量检索，也可以单独使用 mode: "text"，避免项目继续维护自写评分和文档扫描逻辑。

**向量与混合检索。** Vane 使用 HNSW 召回向量候选，并默认通过 RRF 融合向量和 BM25 排名。它适合测试人物行为相似、主题相近、不同措辞描述的类似事件，以及与当前场景语义相近的历史片段。

**嵌入式持久化。** Vane 使用本地目录、多段文件、manifest 和 WAL，不要求独立部署 Elasticsearch / OpenSearch 一类服务。它提供快照导出能力，适合本地创作工具。

**Node 原生包。** 当前 npm 包 @vane-rs/node v0.4.1 声明了 macOS arm64、macOS x64、Linux x64 glibc 和 Windows x64 MSVC 的可选原生依赖。对以 Node / TypeScript 为主的当前工具，直接集成 Node 包比启动 CLI 侧车更自然。

### 2.2 Vane 不负责什么

Vane 不生成 embedding，也不运行模型。应用必须提供文档向量和查询向量，并决定使用本地模型还是远端 embedding API。模型变更后的向量重建和任务调度仍属于应用职责。

Vane 也不是关系数据库，不提供 SQL、业务事务、多用户权限或分布式部署。小说、章节、人物、实体关系、事件和 Story State 不应该迁入 Vane。它只负责“从一批文本片段中找出候选片段”。

Vane 的 CLI 侧车还会自行监控目录、切片和调用 embedding provider。当前项目已经有自己的章节切分、场景上下文、来源哈希和证据位置，不应该让 CLI 再维护一套平行切片逻辑。建议只集成 @vane-rs/node 库，由现有 ingest pipeline 决定索引边界。

## 3. Vane 与 SQLite FTS5 的取舍

| 维度 | SQLite FTS5 + Jieba 预分词 | Vane |
|---|---|---|
| 中文词项检索 | 应用负责分词后写入 FTS5 | 内置 Jieba，可注入词典 |
| BM25 | FTS5 内置 bm25() | Block-Max WAND BM25 |
| 语义召回 | 需要另接向量索引 | 内置 HNSW |
| 混合排序 | 自己合并结果和排名 | 内置 RRF / linear |
| 业务数据查询 | SQL 原生、事务成熟 | 不提供 SQL |
| 元数据过滤 | SQL 灵活，可与业务查询联结 | scalar filter，能力受限 |
| 部署 | 单一 SQLite 数据库；依赖现有运行时 | Node 原生模块 + 独立索引目录 |
| 更新一致性 | 可以放在 SQLite 事务内 | 与业务 SQLite 之间需要同步机制 |
| 迁移与排障 | 数据和索引可通过 SQL 检查 | 使用 Vane API、索引统计和快照工具 |
| 运维复杂度 | 最低 | 多一个索引生命周期和 embedding 依赖 |

### 3.1 SQLite FTS5 的合适定位

FTS5 能解决现有实现最直接的问题：不再手写 BM25，获得成熟全文查询、排名、snippet 和索引维护。中文可以在入库和查询前采用同一套 Jieba 分词，把词项以空格分隔后交给 FTS5 的 tokenizer；小说领域词典由项目维护。

FTS5 的优势是全文索引与原有 SQLite 数据处于同一数据库和事务边界中。人物、章节和片段元数据可以通过普通 SQL 过滤或 JOIN，不必等待搜索绑定开放过滤功能。若评测发现语义召回的增益有限，这会是更简单的长期方案。

### 3.2 Vane 的额外价值与成本

Vane 比 FTS5 多提供 HNSW 和统一混合排序。它的价值不应以“支持向量检索”来证明，而要看是否能找到 FTS5 无法找到、但对当前写作确实有帮助的片段。

引入 Vane 同时增加了两类维护面：一是 Vane 索引目录与业务 SQLite 之间的同步和恢复；二是 embedding 模型的调用、成本、延迟、隐私和模型升级。对于合法取得但不适合外发的原著文本，默认应优先使用本地 embedding；配置远端 embedding 时必须明确文本发送边界，不能把小说正文无意间传给新的外部服务。

## 4. 需要在集成前解决的限制

### 4.1 Node filter 尚未开放

Vane 的 Rust core 已实现 scalar pre-filter，但当前 main 分支的 Node 查询参数解析仍会拒绝非空 filter。Node 的 convert.rs 里有明确的拒绝逻辑；README 的过滤章节也说明过滤尚未通过 Node、Go 和浏览器绑定的查询解析器暴露。

这是小说系统的实际阻塞项之一。检索需要按 world、章节范围、资料类型或阶段限制结果。仅在 top-k 召回后再过滤，可能把真正符合条件的结果挡在候选集之外，尤其是在限定章节或人物范围时。

在 Node filter 对应的版本正式发布并经测试之前，不应假设 README 中 Rust core 的过滤能力已经能从 TypeScript 使用。PoC 可先将过滤场景作为独立验收项；若短期内无法满足，应由 SQLite 先选出候选 ID，再决定是否采用 Vane，不能把 post-filter 冒充等价的 pre-filter。

### 4.2 Metadata 不是关系模型

Vane 文档中的 metadata 是标量字段，过滤条件为 eq / in / gte / lte，字段之间是 AND，不是任意 SQL。它不能代替人物与章节之间的多对多关系表，也不能自然表达数组类型的人物参与者列表。

适合写入 Vane metadata 的字段包括 worldId、chapterOrdinal、sourceType、chunkKind 等简单过滤字段。人物 ID 列表、事件参与者、实体别名和关系仍应保留在 SQLite 中，由结构化查询处理。

### 4.3 Collection 的向量约束

Vane SPEC 规定每个 Collection 恰好一个 vector 字段，向量维度在建库时固定。文本模式虽然可以只传 text 查询，但 schema 仍有 vector 字段约束。PoC 需要验证 text-only 文档是否可以不提供向量、写入和重开行为是否符合预期，以及在尚未启用 embedding 时是否能保持纯文本检索。

同一 Collection 只能承载一种向量维度和一种主检索配置。更换 embedding 模型或维度不能只改配置，必须有可恢复的重新嵌入和重建流程。

### 4.4 RRF 不代表任务语义上的最佳权重

Vane 默认采用 RRF，降低不同检索分数尺度难以比较的问题，这是合理默认值。但小说不同任务的精确度偏好不一样：

- 人物真名、地名、物品名和原文引句：词项检索通常应优先。
- 相似场景、主题或事件模式：向量召回更有价值。
- 文风参考：通用语义 embedding 不一定能准确表示句法、叙述距离和人物声音，不能把“主题相似”当成“文风相似”。
- 时间线和人物知识：应由 SQLite 状态与事实查询负责，而不是让向量相似度决定。

因此不要让所有 Agent 默认共用一个不可区分的 hybrid 查询。应用层应提供少量明确的检索 profile，例如 exact-evidence、scene-semantic、style-reference，决定查询文本、召回模式、结构化条件和结果后处理。RRF 只负责融合排名，不负责判断证据是否真实或适用于当前时间点。

### 4.5 稳定性与持久化仍需 PoC 验证

Vane 当前为 v0.4.1，尚未到 1.0。README 中的性能和 recall 数值是项目自己的目标与门禁描述，不等于在本项目语料、查询分布和机器上的实测结果。正式采用前应锁定版本，验证 macOS arm64 安装、Node 运行时兼容、批量导入、异常退出恢复、增量更新、删除、快照导出和索引重建。

## 5. 推荐目标架构

保留现有内容解析和业务数据模型，只替换可插拔的检索实现。

NovelSearchService 是写作、全文分析和 CLI 共用的边界。上层只提交检索意图并接收带来源位置的命中项，不直接依赖 Vane API、FTS5 SQL 或 embedding provider。

数据流职责如下：

1. TXT / Markdown 继续经过现有 ingest Pipeline，按现有规则生成章节、文本片段和来源位置。
2. library/index.json 继续作为原文片段清单；SQLite 保存业务数据、结构化知识和索引状态。
3. 可选 embedding provider 只负责向量生成；Vane 只保存文本、向量和少量标量 metadata。
4. NovelSearchService 按查询用途选择 text、hybrid 或 SQLite 结构化查询。
5. 命中后按 chunk ID 回取当前原文和来源位置，再交给写作 Agent。
6. Vane 索引可以删除和重建，不能反向成为原文事实来源。

数据流的关键约束：

- 不让 Vane CLI 重新切片或重新定义 chunk ID。
- Vane 使用现有片段 ID 作为 Document ID。更新时幂等 upsert；源文件重新导入导致片段变化时，删除旧 ID。
- Vane 只保存检索所需文本、向量和少量标量 metadata。来源哈希、字符偏移、章节结构和原文证据仍以项目数据为准。
- 搜索命中返回 chunk ID 后，再从当前库读取最新片段与来源信息；不能把 Vane 返回的缓存文本作为最终证据权威。
- Vane 索引允许删除并重建。启动或索引任务恢复时，根据当前 chunk ID 和 content hash 对账，补写缺失、更新变化、删除过期条目。
- embedding provider 不可用时自动退化到 text 模式，不应让普通写作因语义索引不可用而整体停摆。需要语义召回的任务应明确报告降级状态。
- 所有检索结果都只是供 Agent 判断的候选证据。检索分数不是事实置信度，向量相似更不能升级为人物关系或正史事件。

### 5.1 索引更新和一致性

当前原文片段的权威存储是 library/index.json，而不是 Vane。由于两者不能参与同一个 SQLite 事务，不能宣称二者具有跨存储原子提交。

建议把索引状态与重试信息放在现有 SQLite 中，并采用可重复的 reconciliation：

- 导入完成后，记录需要索引的 chunk ID 和内容哈希。
- Index Worker 对新增或变化片段生成 embedding，并调用 Vane add()。
- 对从当前语料消失的 chunk ID 调用 delete()。
- 调用 flush() 后更新本地索引状态。
- 进程中断时，根据权威 chunk 清单和 Vane 状态继续补齐，不依赖内存队列。
- 定期或手动运行 rebuild，能从 library/index.json 完整重建一个新的 Vane collection，再切换活动版本。

如果某一阶段发生在写入文件之后、索引状态落库之前，启动对账仍能发现差异。不要仅靠“写文件时顺便调用 Vane”实现双写，否则崩溃时会出现无法解释的漏索引。

### 5.2 中文用户词典

可以从已有实体注册表和明确别名数据构建 Jieba user dictionary，包含人物名称、稳定别名、地点、势力、物品与能力专名。但人物称谓、关系称呼和可能存在歧义的简称不能一律当成全局唯一实体。

词典应有内容哈希和版本；批量变更后再执行 reindex，而不是每次导入一条新别名就立即触发全库重建。对歧义名称，仍需由 SQLite 的实体消歧逻辑和原文证据处理。

### 5.3 各类 Agent 的检索策略

| 使用者 / 任务 | 推荐检索 | 说明 |
|---|---|---|
| 原文搜索 CLI | text | 精确词项、名称、片段查找 |
| 人物与事实核查 | text + SQLite | 先按实体和章节缩小范围，再回取原文 |
| 主线剧情规划 | hybrid 候选 + SQLite | 语义召回历史事件，同时检查情节线和时间位置 |
| 长章节逐场写作 | scene-specific hybrid / text | 每场独立构造查询，不把整章 brief 和所有人物名单无差别拼接 |
| 创意发散 | hybrid | 查找可借鉴的相似情境，不将相似事件直接当作必须复用的剧情 |
| 文风参考 | 经认可样本 + 专门策略 | 语义相似不能证明叙述风格相似；保留 Style Profile 的抽象风格约束 |
| 连续性审查 | SQLite + text | 人物当时知道什么、位于何处、事件发生顺序等由结构化状态和原文证据核对 |


## 6. 本地 Embedding 模型选型

Vane 不生成 embedding。项目必须单独运行本地 embedding provider：导入时批量生成每个 chunk 的向量，查询时生成 query vector，再把 `text + vector + meta` 一起交给 Vane。Embedding 模型、向量维度和编码方式因此是 Vane 集成的一部分，不应留到实现阶段临时决定。

### 6.1 选择标准

当前 `src/constants.ts` 将原文检索 chunk 的最大长度设为 **1,200 个字符**，相邻 chunk 重叠 160 个字符。模型至少需要完整接收这一长度；优先选择 8K 以上上下文，避免模型 tokenization 后在 512-token 上限处静默截断。中文字符数和模型 token 数并不完全等价，PoC 必须直接用每个模型自己的 tokenizer 检查实际 token 长度。

另外几个条件同样重要：中文检索能力、向量维度不超过 Vane 的 4096 维上限、许可证足够宽松、能够在本机批量推理、提供明确的 query/document 编码规则。C-MTEB 可以帮助筛选，但它不是长篇小说检索基准，不能直接预测人物、事件和跨章节剧情召回效果。

### 6.2 候选模型

| 模型 | 参数量 / 向量维度 | 最大输入长度 | 许可证 | 中文检索参考 | 本地部署情况 | 判断 |
|---|---:|---:|---|---:|---|---|
| [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) | 0.6B / 1024 | 32K | Apache-2.0 | C-MTEB Retrieval 71.03 | 官方 GGUF、llama.cpp、Ollama；Q8_0 GGUF 约 639MB | **首选默认模型**。长上下文、指令感知、多语言、维度适中，Node 接入简单 |
| [richinfoai/ritrieve_zh_v1](https://huggingface.co/richinfoai/ritrieve_zh_v1) | 0.3B / 1792 | 模型卡未明确说明 | MIT | C-MTEB Retrieval 76.97 | SentenceTransformers；F32 权重文件约 1.3GB | 中文专项对照。公开分数很强，但必须先验证 1,200 字符 chunk 是否被截断 |
| [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3) | 约 0.57B / 1024 | 8192 | MIT | 模型卡主要展示多语言及 MIRACL 评测，不与 Qwen 的 C-MTEB 表直接横比 | Ollama 官方模型库，约 1.2GB；FlagEmbedding / SentenceTransformers | 稳健的多语言长文本备选。Vane 只会使用其 dense 向量，无法直接消费 BGE-M3 的 sparse 和 ColBERT 多向量输出 |
| [BAAI/bge-base-zh-v1.5](https://huggingface.co/BAAI/bge-base-zh-v1.5) | 109M / 768 | 512 | MIT | C-MTEB Retrieval 69.49 | SentenceTransformers / ONNX | 轻量中文基线；当前 1,200 字符 chunk 可能超过 512-token 上限，不建议未经切分验证就用于正式索引 |
| [BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5) | 33M / 512 | 512 | MIT | C-MTEB Retrieval 61.77 | SentenceTransformers / ONNX | 资源极低时的速度基线，检索质量和输入长度均不占优 |
| [google/embeddinggemma-300m](https://huggingface.co/google/embeddinggemma-300m) | 300M / 768 | 2048 | Gemma Terms | 未找到与上述模型同口径的中文检索分数 | 官方定位为端侧 / 笔记本部署；Hugging Face 需要接受 Google 使用条款 | 小模型备选，但许可证不是 Apache/MIT，且上下文短于 Qwen3 |
| [dunzhang/stella-mrl-large-zh-v3.5-1792d](https://huggingface.co/dunzhang/stella-mrl-large-zh-v3.5-1792d) | 约 0.3B / 1792（MRL 可降维） | 模型卡需进一步核实 | MIT | 模型卡报告 C-MTEB Retrieval 73.51（1792 维） | SentenceTransformers | 中文专项对照；同样要检查长文本截断，且已有分数更高的 Ritrieve 可优先测试 |
| [jinaai/jina-embeddings-v5-text-small](https://huggingface.co/jinaai/jina-embeddings-v5-text-small) | 以模型卡为准 | 以模型卡为准 | CC-BY-NC-4.0 | 不纳入本次可商用候选比较 | Hugging Face / SentenceTransformers | 有能力但带非商业限制；除非确认项目用途接受该条款，否则不选 |

Qwen 官方 C-MTEB 对比表列出的 Retrieval 分数为：Qwen3-Embedding-0.6B 71.03、4B 77.03、8B 78.21；同一表中的 Ritrieve-zh-v1 为 76.97。这个结果说明 0.6B 不是中文检索分数最高的模型，4B 和 Ritrieve 的公开分数都更高。但 4B 需要更大的运行内存，Ritrieve 的最大输入长度在模型卡中没有明确说明，所以不能只按这几个分数决定生产选型。参见 [Qwen3-Embedding 模型与评测表](https://github.com/QwenLM/Qwen3-Embedding) 和 [Ritrieve 模型卡](https://huggingface.co/richinfoai/ritrieve_zh_v1)。

BGE-M3 的特点是一个模型可输出 dense、sparse 和 ColBERT 多向量结果，支持 100 多种语言及最多 8192 tokens。Vane 目前只接收一个 dense vector 字段；项目已经使用 Vane 自己的 BM25，所以不能把 BGE-M3 的 sparse 路径也算作 Vane 集成后的额外收益。它仍然值得作为 dense embedding 对照组，但不应因为其“多功能”宣传就默认优于 Qwen3。

### 6.3 推荐结论

**默认采用 Qwen3-Embedding-0.6B，中文专项 PoC 同时测试 Ritrieve-zh-v1，BGE-M3 作为多语言长文本对照。**

选择 Qwen3-Embedding-0.6B 的原因不是它在 C-MTEB 排名最高，而是它对当前工程约束最均衡：

- 32K context 能完整容纳当前 1,200 字符 chunk，并为将来较长场景片段留有空间。
- 1024 维向量适合 Vane；单条 float32 向量约 4KB，10 万条原始向量约 410MB，尚未计入 HNSW 图和索引开销。
- 支持 100 多种语言，可保留将来处理英文、日文或多语言参考资料的空间。
- Apache-2.0 许可证明确，且有官方 GGUF 和现成的本地运行路径。
- Qwen3 的 query/document 非对称编码规则明确，能够针对“用户的剧情描述 → 原文证据片段”这一检索任务定制 query instruction。

Ritrieve-zh-v1 应该进入 PoC，而不是直接成为默认模型。它在公开 C-MTEB 表上的检索分数比 Qwen3-0.6B 高约 5.9 分，且模型卡采用 MIT 许可证、不需要额外 query instruction；但它是中文专向模型，输出维度为 1792，F32 权重文件约 1.3GB，最关键的是模型卡没有清楚标注最大输入长度。必须先验证它是否能完整编码项目当前的 chunk；如果真实 tokenizer 会在 512 tokens 左右截断，那么公开榜单上的优势不能直接转化成当前语料的优势。

Qwen3-Embedding-4B 可作为质量上限对照，但不是第一版默认值。其 C-MTEB Retrieval 为 77.03，和 Ritrieve 的 76.97 几乎相同；Ollama 版本约 2.5GB，运行时内存还会高于模型文件大小。先验证 0.6B 和 Ritrieve，只有小说自建评测集显示明显收益时再考虑 4B。8B 不纳入本地默认候选。

### 6.4 本地运行方式

对 Qwen3-Embedding-0.6B，建议优先采用官方 GGUF + llama.cpp。它不需要 Ollama，也不需要项目自行转换模型：

```bash
# macOS / Linux：安装 llama.cpp 应用
curl -LsSf https://llama.app/install.sh | sh

# 官方 Q8_0 GGUF，启动本地 OpenAI-compatible embedding endpoint
llama serve -hf Qwen/Qwen3-Embedding-0.6B-GGUF:Q8_0 --embeddings
```

官方 Hugging Face GGUF 仓库提供 Q8_0（约 639MB）和 F16（约 1.2GB）文件，并直接列出 llama.cpp、LM Studio、Jan、Ollama 等本地运行入口。对于本地 Mac，先用 Q8_0 做 PoC；不要仅凭量化名称推断质量，最终仍需用小说检索集检查向量召回是否退化。参考 [Qwen3-Embedding-0.6B-GGUF](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF)。

若希望用 Ollama 管理模型，也可以直接运行：

```bash
ollama pull qwen3-embedding:0.6b
ollama pull bge-m3
```

Ollama 提供 `/api/embed` 和 JavaScript SDK 的 `embed()`，支持批量输入。Vane Node adapter 只需要把本地 endpoint 返回的 embedding 数组转成 Vane 所需的 number[] / float32 向量。对 Ritrieve-zh-v1，先用 SentenceTransformers 常驻加载模型，再通过本机 HTTP 或子进程 RPC 暴露批量 embedding 接口；不要每个 chunk 都启动一次 Python 进程。

建议统一抽象 `NovelEmbeddingProvider`，由配置选择模型和 endpoint。模型运行时不应进入 Agent 生成路径；索引构建时批量调用，查询时只编码一条 query。远端模型服务可以作为显式可选配置，但默认不把原著正文发送到第三方 embedding API。

### 6.5 Qwen3 的 query/document 编码规则

Qwen3-Embedding 是 instruction-aware 模型。官方推荐为 query 加一条任务指令，而 document 不加指令；官方说明使用合适的 query instruction 在多数检索任务中可带来约 1%–5% 的提升。多语言场景推荐使用英文 instruction，查询内容本身仍可为中文。参见 [Qwen3-Embedding 使用说明](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)。

建议先固定一条小说检索指令，所有 Agent 共用同一模板：

```text
Instruct: Retrieve passages from a Chinese novel that provide evidence relevant to the user's writing query, including relevant characters, events, scenes, actions, or causal situations even when the wording differs.
Query: {query}
```

文档侧使用原文 chunk（第一轮不要混入额外摘要或模型生成的标签），查询侧使用上面的 instruction + query。等基础结果稳定后，再单独比较“正文”与“章节标题 + 正文”两种 document 输入。Ritrieve-zh-v1 和 BGE-M3 则按各自模型卡要求编码；Ritrieve 官方示例明确说明不需要 instruction。

Vane collection schema 的向量维度必须与模型输出严格一致。建议第一版固定 Qwen3 的 1024 维和 cosine metric；Ritrieve 的 1792 维、BGE-M3 的 1024 维应放在独立 PoC collection，不能混写到同一 collection。索引 manifest 至少记录 model ID、HF revision、量化方式、输出维度、归一化方式、query instruction 版本和 chunker 版本。更换模型或维度时重建新 collection，校验完再切换活动索引，不允许新旧模型向量混用。

### 6.6 本项目的实际 PoC 模型矩阵

使用当前 1,200 字符 chunk、相同 chunk ID 和相同查询集，最少比较：

| 测试组 | 模型 / 模式 | 目的 |
|---|---|---|
| A | Vane text（BM25 only） | 确立不依赖 embedding 的基线 |
| B | Vane hybrid + Qwen3-Embedding-0.6B Q8_0 | 第一候选默认路径 |
| C | Vane hybrid + richinfoai/ritrieve_zh_v1 | 中文专向质量对照；特别检查 token 截断 |
| D | Vane hybrid + BAAI/bge-m3 dense | 多语言、长文本对照 |
| E（可选） | Vane hybrid + Qwen3-Embedding-4B | 只用于测量 0.6B 到大模型的质量增益和资源代价 |

评测集至少覆盖：人物真名和别名、两字短称谓、具体物品/能力、精确原文短语、改写事件描述、相似场景、跨章节同一人物的不同阶段、时间相近但事实不同的干扰项。对每条查询记录必须命中的 chunk、可接受的相关 chunk，以及不应命中的错误人物/错误时间结果。

除了 Recall@10、nDCG@10、MRR、误召回率和检索延迟，Embedding PoC 还必须记录：

- 索引阶段每 1,000 chunks 的生成时间、批量吞吐和失败重试次数。
- Query embedding 的 P50/P95 延迟。
- 每个 chunk 的 tokenizer 长度、实际送入模型的 token 数及截断比例；截断比例必须为 0，或者将截断明确作为测试变量。
- 模型加载后的常驻内存、批量推理峰值内存、Vane 索引体积。
- 模型量化前后的检索指标变化。
- 重建索引所需时间，以及模型 revision / 量化版本变更是否触发正确重建。

C-MTEB 只用于选候选，不能作为验收通过条件。最终采用标准应是：在中文小说真实检索任务上比 Vane text 有稳定增益，且不损伤人物精确命中和原文证据召回；模型再大、榜单再高，如果引入更多错误人物或错误时间召回，也不应进入生产路径。

## 7. PoC 设计与验收

不应以 Vane README 的合成数据 Benchmark 代替本项目的真实检索质量测试。建议选取一部已完成导入和分析的小说，先固定一份 5,000–10,000 个现有 chunk 的测试语料；所有方案使用相同片段边界、查询集和人工标注的相关证据。

### 7.1 对比对象

| 方案 | 验证目的 |
|---|---|
| 当前手写 BM25-style | 作为现有基线，确认替换是否造成退步 |
| SQLite FTS5 + Jieba | 验证成熟全文检索能达到什么水平 |
| Vane text | 单独衡量 Vane 的分词和 BM25 能力 |
| Vane vector | 测量纯语义召回的价值及噪声 |
| Vane hybrid | 测量 BM25 + 向量 + RRF 是否改善最终排序 |

测试时不要把 FTS5 和 Vane 的切片结果混在一起比较。必须固定 chunk ID 和源文本，否则结果差异可能来自切片，而非检索算法。

### 7.2 查询集覆盖

至少覆盖以下场景：

- 精确名称：人物全名、别名、地名、物品与能力名称。
- 短查询：两字人名、短称谓、单一专有名词。
- 原文表达：已知句子或短语、关键词组合。
- 改写查询：不用原文关键词描述某次事件，验证语义召回。
- 场景查询：描述相似的环境、冲突、谈判或行动。
- 跨章节查询：同一人物或情节线在不同阶段的表现。
- 干扰查询：同名异人、相似人物、相近主题但时间或事实不相符的片段。
- 文风查询：只作为探索性测试，不能把语义近邻直接当作文风相似结果。

建议先构造 50–100 条有明确预期结果的真实写作查询，每条记录“相关片段”“必须命中的事实”“明确不应命中的干扰项”。标注重点是证据是否适合当前写作任务，而不是只判断文本主题是否相似。

### 7.3 指标与门槛

| 指标 | 验证方式 | 采用要求 |
|---|---|---|
| Recall@10 | 应命中的证据是否出现在前 10 条 | 不低于当前基线；重点看语义改写问题 |
| nDCG@10 | 相关证据是否排在更前面 | 至少在目标任务类别上有稳定提升 |
| MRR | 第一条有效证据的排名 | 精确人物 / 原文查询不能明显退化 |
| 误召回 | 不同人物、不同时间阶段或相似但无关事件 | 不得增加会误导写作的高排名结果 |
| 延迟 | P50 / P95，冷启动与热查询分开 | 在真实本地机器上测量 |
| 索引成本 | 初次建库、增量更新、重建耗时 | 能接受且可重复 |
| 资源占用 | 索引磁盘、内存、embedding 调用量 | 不影响本地写作运行 |
| 恢复能力 | 异常退出、部分写入、删除、重建 | 不丢原文，不产生静默漏索引 |

采用 Vane hybrid 的条件不是“平均分高一点”，而是它要在改写表达、相似场景和跨章节关联这些当前薄弱的任务上带来可复现的增益，同时不破坏精确名称和原文证据检索。若只改善语义相似度，却增加错误人物、错误时间或无关情节的召回，不应采用。

### 7.4 必须通过的工程验收

在做正式集成前，应验证：

1. @vane-rs/node 在项目要求的 Node 版本与目标 macOS arm64 环境可以直接安装和运行，不要求用户本地编译 Rust。
2. text-only 文档是否允许缺少向量；collection schema、批量 upsert、flush、close 和重新打开的语义符合预期。
3. Node filter 支持情况有明确版本依据和自动化测试；不能只依据 Rust core 已实现的说明。
4. Jieba userDict 对人名、别名、领域词的切分符合预期；词典变更后 reindex 不产生新旧分词段混用。
5. Vane 写入失败、embedding 超时或进程中止时，恢复流程能根据权威 chunk 清单补齐，不影响原文和 Story State。
6. 删除一个源文件或重新导入文件后，旧 chunk 不会继续被召回。
7. Vane 索引目录可备份、导出、恢复；重建后的结果与当前语料哈希一致。
8. embedding provider 不可用时，text-only 路径仍然工作；不允许因为语义检索不可用而阻断普通写作。

## 8. 分阶段实施建议

### 阶段 A：先建立检索契约和评测基线

先定义 NovelSearchService 与统一的 SearchHit。结果至少应包含稳定 chunk ID、score、source、chapter、start/end、sourceHash 和检索通道。上层调用者不再导入 searchLibrary() 或直接依赖底层引擎。

统一查询请求应表达用途、关键词、可选语义查询、world 范围、章节范围、候选数量和检索 profile。不要把 Vane 的 SearchQuery 暴露为项目公共接口。

同时整理真实查询集与相关证据标注。这一步完成后，现有实现仍可作为默认 provider，不必先改动生成流程。

### 阶段 B：并行 PoC，不改变正式写作路径

实现 FTS5 和 Vane 两个实验 adapter，离线对同一份语料建索引、执行同一批查询。Vane 分别跑 text、vector、hybrid；embedding 首选本地 provider，记录模型名称、版本、维度和语料哈希。

PoC 只比较检索结果和资源数据，不把实验召回直接注入正式写作。确认 Node filter 与持久化限制后，再做决策。

### 阶段 C：只保留一个生产全文索引实现

若 Vane hybrid 达到质量门槛，采用 Vane 作为检索 provider，保留 SQLite 作为事实库，并由 Index Worker 维护 Vane projection。若 Vane 的语义增益不稳定或过滤能力长期无法满足要求，则选择 SQLite FTS5 + Jieba，停止维护当前自写 BM25。

无论选择哪一种，都不应永久双写 FTS5 和 Vane。双写只存在于离线迁移和回归比较阶段。

### 阶段 D：按真实问题逐步启用 hybrid

先对创意发散、相似场景等语义收益最明确的任务启用 vector/hybrid。人物事实、时间线和连续性审查仍以 SQLite 结构化查询和原文 text 检索为主。监控实际命中是否被写作流程使用、是否带来错误事实，而不是只监控搜索延迟。

检索服务失效时可以退化到 text provider；embedding 失败时 Vane text 模式仍可使用。检索层不应成为普通写作的人工审批门禁。

## 9. 最终建议

**现在应该淘汰继续扩展手写 BM25 的路线，但不应未经评测就将 Vane 直接设为唯一生产检索后端。**

推荐的近期动作是：

- 抽象 NovelSearchService，固定检索返回值和证据来源契约。
- 以 SQLite FTS5 + Jieba 预分词建立成熟的词项检索基线。
- 同时针对 Vane v0.4.1 做 Node PoC，特别验证 Node filter、text-only 写入、中文 userDict、异常恢复和索引对账。
- 使用真实续写查询集比较 text 与 hybrid，只有明确改善语义召回且不增加事实误召回时才启用向量路径。
- 始终让原文、章节、人物、事件和故事状态留在现有项目数据模型中；检索索引可随时重建。

Vane 的方向与当前项目吻合，尤其适合将来把“关键词找原文”扩展为“关键词和语义共同找剧情证据”。但小说创作最重要的不是检索结果看起来相似，而是检索结果是否准确、是否处于正确的故事阶段，以及是否真正有助于写出更好的小说。检索分数和知识库完整度都不能凌驾于文学性之上。

---

## 参考资料

### 当前项目

- [Novel Generation README](./README.md)
- [Novel Generation Architecture](./ARCHITECTURE.md)
- [ADR-0001：文学性优先与全文人物/情节分析](./ADR/0001-literary-priority-and-corpus-analysis.md)
- [当前原文分块和 BM25-style 检索实现](./src/library.ts)
- [检索回归测试](./test/library.test.ts)
- [长章节逐场检索调用](./src/long-chapter.ts)
- [全文分析检索调用](./src/world-analysis.ts)
- [Embedding 模型选型与本地部署](#6-本地-embedding-模型选型)

### Vane

- [Vane 中文 README](https://github.com/ximing/vane/blob/main/README.zh-CN.md)
- [Vane 技术规范 SPEC](https://github.com/ximing/vane/blob/main/docs/SPEC.md)
- [Vane 需求与架构约束](https://github.com/ximing/vane/blob/main/docs/REQUIREMENTS.md)
- [Vane Node 查询参数转换](https://github.com/ximing/vane/blob/main/crates/vane-node/src/convert.rs)
- [Vane Node package.json](https://github.com/ximing/vane/blob/main/crates/vane-node/package.json)
- [Vane Releases](https://github.com/ximing/vane/releases)

### 本地 Embedding 模型

- [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
- [Qwen3-Embedding 官方技术报告与 C-MTEB 对比](https://github.com/QwenLM/Qwen3-Embedding)
- [Qwen3-Embedding-0.6B-GGUF（官方 Q8_0 / F16）](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF)
- [Ollama Qwen3-Embedding 模型与本地 API](https://ollama.com/library/qwen3-embedding)
- [richinfoai/ritrieve_zh_v1](https://huggingface.co/richinfoai/ritrieve_zh_v1)
- [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3)
- [Ollama BGE-M3 模型与本地 API](https://ollama.com/library/bge-m3)
- [BAAI/bge-base-zh-v1.5 的 C-MTEB 对比](https://huggingface.co/BAAI/bge-base-zh-v1.5)
- [EmbeddingGemma 300M](https://huggingface.co/google/embeddinggemma-300m)
- [Jina Embeddings v5 Text Small 许可证](https://huggingface.co/jinaai/jina-embeddings-v5-text-small)
