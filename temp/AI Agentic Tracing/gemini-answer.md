设计一个面向 AI Agent 的全链路可观测性（Observability）系统，并且基于 OpenTelemetry (OTel) 是目前业界非常标准的最佳实践。相较于仅仅记录 LLM 的 API 调用，监控 Agent 更需要构建一棵完整的**任务追踪树（Span Tree）**。

以下是结合 OTel 标准的架构设计方案以及开源工具推荐：

## 一、 整体架构设计分层

建议将监控系统拆分为标准的可观测性四层架构，这样可以完美解耦，避免被单一厂商的数据模型锁定：

| 层级 | 核心组件 / 职责 | 技术选型示例 |
| --- | --- | --- |
| **可视化与分析层** | 提供 AI 专属大盘监控、Timeline、Prompt 比对、Cost 瓶颈分析图表。 | Langfuse UI, Grafana, Jaeger UI |
| **数据存储层** | 存储海量 Trace、Log 和 Metrics 数据，支持高并发写入和快速检索。 | ClickHouse, Elasticsearch |
| **数据收集层 (Collector)** | 负责接收底层的遥测数据，进行采样、过滤（如 PII 脱敏）、统一打标签后导出。 | OpenTelemetry Collector |
| **应用插桩层 (SDK)** | 拦截 Agent、LLM、RAG、Tool 的调用，自动注入 Context 并生成标准 Span。 | OpenLIT SDK, Langfuse SDK |

---

## 二、 追踪 (Tracing) 与 Span 核心逻辑

在 Agent 监控中，千万不要以 HTTP 请求为中心，而必须以 **Agent Task** 为中心。

* **Trace Root (根节点):** 代表整个 Agent 的单次运行生命周期（Agent Run）。
* **Child Spans (子节点):** 详细展开每一个子步骤，例如 Planner（任务规划）、Retrieval（知识库检索）、Tools（API或浏览器工具调用）、LLM（大模型对话）。任何一步异常，都能顺着树状图快速定位。
* **Event 记录:** 对于不需要记录完整时间跨度的状态跃迁（如：Cache Hit/Miss, Memory Fallback, Retry），直接使用 OTel Event 附加在对应的 Span 上。
* **Prompt 版本隔离:** 不要只记录渲染后的纯文本。应该分别记录 `Prompt Template` 和传入的 `Variables`。这样后续在排查时，才能在面板上对比不同 Prompt 版本的表现（Latency 或 Accuracy 的 Diff）。

---

## 三、 标准化 Span Attributes 设计

为了能进行精准的 troubleshoot，需要定义统一的属性 Schema。以下是核心组件必须挂载的 Attributes：

| 监控维度 | 关键 Attributes 示例 |
| --- | --- |
| **Agent 运行上下文** | `agent.name`, `agent.version`, `agent.session_id`, `agent.user_id`, `agent.workflow_id` |
| **LLM 核心指标** | `llm.vendor`, `llm.model`, `llm.prompt_tokens`, `llm.completion_tokens`, `llm.cost`, `llm.latency` |
| **Tool / 外部工具** | `tool.name`, `tool.arguments`, `tool.result_size`, `tool.success`, `tool.retry_count` |
| **RAG / 检索** | `retrieval.index`, `retrieval.topk`, `retrieval.embedding_model`, `retrieval.hit_count` |

---

## 四、 突破 Token 与 Cost 监控瓶颈

很多系统无法看清 Cost 瓶颈，核心原因是没有把粒度拆解到单一任务上。

* **多维度 Token 记录:** 必须在每一个 LLM Span 中单独记录 Prompt Tokens 和 Completion Tokens。如果你使用了具有长下文缓存或推理思考环节的模型，还需要补充记录 Cached Tokens 和 Reasoning Tokens。
* **统一法币换算:** 在 SDK 拦截层或 Collector 层，将不同模型（如 GPT-4o, Claude-3.5-Sonnet, DeepSeek）的 Token 消耗实时换算为标准货币金额（如 `USD` 或 `CNY`），记录在 `llm.cost` 字段中。
* **Timeline 与占比聚合:** 借助可视化面板聚合同一个 `trace_id` 下的所有 `llm.cost`。你可以非常直观地通过饼图或时间轴看到，单次 Agent 耗费的 0.05 USD 中，到底是 Planner 环节、Reflection (反思) 环节，还是最终的 Answer 环节引发了 Token 爆炸。

---

## 五、 开源替代方案对比 (Open Source)

如果你希望寻找开源且深度支持 OTel 的 LangSmith 替代品，以下是目前最主流的选择：

| 开源工具 | 核心优势 | 适用场景 |
| --- | --- | --- |
| **Langfuse** | 业界最成熟的开源 LangSmith 平替。AI Native 设计，原生支持 Prompt 版本管理、数据集评估、Cost 追踪和 Session 重放。 | **强烈推荐。** 适合需要开箱即用、并专注于提供 AI 专属监控面板的团队。 |
| **OpenLIT** | OTel First 设计。优势在于极简的 Auto Instrumentation，能一键自动监控众多 LLM 框架和 Vector DB。 | **推荐。** 适合公司内部已经有非常完善的 OTel 基础设施（如已经在使用 Grafana/ClickHouse）的团队。 |
| **Arize Phoenix** | 在 Evaluation（评测）和 RAG 分析方面做得极深；对 Embedding 召回率和幻觉（Hallucination）检测支持很好。 | 适合重度依赖 RAG，且需要频繁进行离线或在线 Eval 评测的项目。 |
| **Jaeger + Grafana** | 最基础的云原生可观测性方案，完全不用引入新的外部厂商平台。 | 适合底层研发能力强，愿意自己设计 Dashboard 来呈现 AI 数据的团队。 |

目前你们的 Agent 主要是基于哪个框架开发的（比如 LangChain、LlamaIndex，还是完全纯手写代码调度）？这会直接影响我们选择哪种 SDK 来做底层的自动插桩。



“都有”是一个非常真实且普遍的企业级现状。在实际业务落地中，往往是主流程用 LangChain 编排，RAG 模块用 LlamaIndex 优化，而一些核心的复杂业务逻辑和 Tool 调用则是纯手写代码。

针对这种**异构 Agent 生态**，监控方案的核心挑战在于**上下文传递（Context Propagation）**：如何保证这三种框架产生的日志，能够完美串联在同一个 `trace_id` 下，形成一棵完整的调用树（Span Tree），而不是断裂成几个孤立的片段。

以下是针对“都有”场景的落地设计方案和插桩（Instrumentation）策略：

## 一、 异构框架的插桩策略

在多种框架并存的情况下，千万不要手动去写大量的底层 OpenTelemetry API 代码。你需要利用好现成的 Auto-Instrumentation（自动插桩）工具结合少量手动装饰器。

### 1. 针对 LangChain

LangChain 原生支持 Callback 机制。无论是 Langfuse 还是 OTel，都提供了现成的 Handler。

* **做法：** 在执行 `chain.invoke()` 时，将监控系统提供的 Callback 注入进去。
* **效果：** Planner 思考、Tool 调度、LLM 调用的层级关系会自动生成，Prompt 模板和最终变量也会被自动捕获。

### 2. 针对 LlamaIndex

LlamaIndex 的核心在于检索（Retrieval）、节点（Nodes）和合成（Synthesizer）。

* **做法：** 使用全局配置（Global Settings）或针对特定 QueryEngine 注入 Callback。
* **效果：** 能够精准抓取到 Vector DB 的查询时间、Top-K 召回的 Chunk 内容，以及 Embedding 模型的耗时和 Token 消耗。

### 3. 针对纯手写代码 (Custom Code)

纯手写代码是自由度最高的，也是最容易导致 Trace 断裂的地方。

* **做法：** 使用监控 SDK 提供的装饰器（Decorator）。
* **示例：** 只需要在你的 Python 函数或工具类方法上加上类似 `@observe()` 或 `@tracer.start_as_current_span()` 的注解。
* **效果：** 任何自定义的 API 抓取、数据库查询、复杂计算，都会作为一个单独的 Span 挂载到当前的 Trace 树上。

---

## 二、 解决异构场景的最佳 SDK 选型

为了将上述三种代码无缝粘合，我推荐以下两个开源选项，它们的侧重点不同：

| 方案选型 | 对异构环境的整合方式 | 核心优势 |
| --- | --- | --- |
| **方案 A: 采用 Langfuse SDK** (AI Native 路线) | 它的 `@observe()` 装饰器是神作。你可以在最外层的原生 Python 函数加上 `@observe()` 生成 Root Trace。在这个函数内部，无论是调用 LangChain、LlamaIndex 还是原生 OpenAI 客户端，只要把当前的 `trace_id` 传进去，Langfuse 就能自动把它们拼成一棵树。 | 极度灵活，专为 AI 场景设计，Dashboard 直接看 Cost 和 Prompt 非常直观，是目前粘合异构框架最省力的开源工具。 |
| **方案 B: 采用 OpenLIT + 标准 OTel** (纯云原生路线) | 一行代码 `openlit.init()`。它直接在底层 Hook 了 OpenAI、Anthropic、ChromaDB、Pinecone 等基础库。**它不管你上层用的是 LangChain 还是手写代码**，只要底层发起了网络请求，它就能捕获。对于纯手写的业务函数，再补充标准 OTel 装饰器。 | 无侵入性强，完全遵循 OTel 语义，可以直接把数据导入 Jaeger、Grafana 或 Datadog，无需额外部署 AI 专属后台。 |

---

## 三、 核心避坑指南：防止 Trace 断裂

在“都有”的架构中，最常出现的问题是：**排查问题时，发现 Planner 的 Trace 和 RAG 的 Trace 断开了，找不到它们属于哪一次用户提问。**

**设计原则：强制透传 Trace Context。**

1. **定义唯一的 Session / Run ID：** 在用户发来请求的第一层 API 网关或 Controller 处，生成一个全局唯一的 `trace_id` 和 `session_id`。
2. **显式传递：** 当你的原生代码调用 LangChain 时，必须通过 `config={"callbacks": [...]}` 显式传递当前的 Trace 上下文。
3. **异步注意：** 如果你的 Agent 包含异步调度（如 Python 的 `asyncio` 多协程并发），必须确保 OTel Context Variables 在跨协程时没有丢失。

---

由于你们有大量的自定义代码和多框架混用，系统的拓扑结构可能已经相对复杂。为了更精准地建议数据收集层（Collector）的架构，我想了解一下：

**你们的 Agent 服务目前主要是部署在 Kubernetes 环境，还是 Serverless（如云函数）上？**（这会直接决定 OTel Collector 是采用 Sidecar 模式、DaemonSet 模式，还是直接将数据发送到网关。）


------------


这是一个极其核心且在企业落地 AI 场景时经常“卡脖子”的安全合规问题。无论是 GDPR、HIPAA 还是国内的数据安全法，都不允许将用户的明文敏感信息（PII，如身份证、手机号、银行卡号、真实姓名等）发送到外部的可观测性平台。

在 AI Agent 架构中，数据泄露的高危区域主要有两个：**Prompt（模板渲染后的纯文本）** 和 **Tool Arguments（传递给工具的 JSON 参数）**。

解决这个问题的核心原则是：**数据脱敏必须发生在数据离开企业信任边界（Trust Boundary）之前。** 在结合 OpenTelemetry 的架构下，通常有三种主流的设计方案：

---

### 一、 架构选型：在哪一层进行脱敏？

| 拦截层级 | 实现方式 | 优缺点 | 适用场景 |
| --- | --- | --- | --- |
| **1. Client / SDK 层 (最安全)** | 在 Agent 代码的 OpenTelemetry SDK 拦截器中，在 Span 闭合并 Export 之前直接执行文本替换。 | **优点：** 绝对安全，敏感数据甚至不会落盘到本地日志。<br>

<br>**缺点：** 如果你有 Python、TS、Go 多种语言的 Agent，要在每个 SDK 里重复写一遍脱敏逻辑；且基于 NLP 的脱敏会增加单次请求的 Latency。 | 对数据安全要求极高（如金融、医疗），且开发栈相对单一。 |
| **2. OTel Collector 层 (最推荐)** | Agent 输出明文 Trace，将其发送给部署在内网的 OTel Collector。由 Collector 统一执行清洗后再发送给 Langfuse / Grafana 等外部平台。 | **优点：** 集中式管理，Agent 零负担无延迟，支持跨语言，规则统一更新。<br>

<br>**缺点：** 需要额外部署并维护 Collector 组件。 | 异构系统（多框架、多语言混用），且拥有独立内网环境的企业。 |
| **3. AI Gateway / Proxy 层** | 类似于 Helicone、LiteLLM，在 LLM 请求出网关前拦截替换。 | **优点：** 顺便把发给大模型厂商（如 OpenAI）的 PII 也洗掉了，一举两得。<br>

<br>**缺点：** 只能拦截发给 LLM 的数据，**无法拦截发给本地 Tool / RAG 的敏感数据**。 | 主要担心大模型厂商泄露数据，且重度依赖外部 API 的场景。 |

---

### 二、 核心技术方案：如何识别和替换 PII？

无论你选择在哪一层拦截，底层清洗技术的选型都非常关键。单纯使用正则表达式（Regex）是远远不够的，因为 Prompt 是非结构化的自然语言。

#### 1. 微软 Presidio (业界标准)

[Microsoft Presidio](https://microsoft.github.io/presidio/) 是目前最强大的开源 PII 识别和脱敏工具（Python/Go）。

* **机制：** 结合了正则、校验和算法（Checksum）以及轻量级 NLP 模型（如 spaCy），能够精准识别出上下文中的实体。
* **效果：** 可以将 Prompt 中的 `"帮我查询13812345678的订单"` 自动清洗为 `"帮我查询<PHONE_NUMBER>的订单"`。如果你还要追踪关联性，可以使用 Hash 模式替换为 `"帮我查询<8f4a2b...>的订单"`。

#### 2. OpenTelemetry Collector 的 Redaction Processor

如果你选择在 Collector 层处理，可以直接使用 OTel 生态自带的处理器。
在你的 `otel-collector-config.yaml` 中，可以配置 `redaction` 处理器或者 `transform` 处理器，专门针对 AI 相关的 attributes 进行正则清洗：

```yaml
processors:
  redaction:
    # 允许修改的 Span Attributes，例如 LLM 的 Prompt 和 Tool 的参数
    allow_all_keys: false
    allowed_keys:
      - gen_ai.prompt
      - gen_ai.completion
      - tool.arguments
    # 屏蔽规则 (正则表达式)
    blocked_values:
      - "(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}"  # Email 屏蔽
      - "\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b" # 信用卡号屏蔽

```

---

### 三、 给大模型（LLM）看假数据，给 Tool 传真数据的“金手指”设计

在 Agent 场景中，最棘手的矛盾是：**大模型不需要知道用户的真实 PII，但执行任务的 Tool（比如查数据库）必须知道真实的 PII 才能工作。**

**最佳实践：双向 Tokenization (令牌化代理)**

1. **输入拦截 (Masking)：** 在用户请求进入 Agent 之前，网关层通过 Presidio 将 PII 提取出来，存在本地的高速缓存（如 Redis）中，并生成一个 UUID Token。
* *用户输入：* “发邮件给 boss@company.com”
* *Agent 看到的：* “发邮件给 `[TOKEN_1]`”


2. **Agent 处理：** Planner、LLM 在整个思考和推理（Trace）过程中，流转的全部是 `[TOKEN_1]`。此时记录下来的所有的 Observability Span 都是绝对安全的。
3. **Tool 还原 (Unmasking)：** 当 Agent 决定调用 `send_email(address="[TOKEN_1]")` 工具时，在你的 Tool 执行层，先去 Redis 查表，将 `[TOKEN_1]` 还原成真实的 `boss@company.com` 再去执行真实动作。

这样设计，既保证了 LLM 和监控系统的绝对脱敏，又不会破坏 Agent 的执行逻辑。
