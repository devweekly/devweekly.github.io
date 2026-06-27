如果你的目标不是**LLM 调用日志**，而是**整个 AI Agent Runtime Observability**，那我建议直接按照目前业界（2026）的方向设计，而不是复制 LangSmith。

目前基本形成了三个层次：

```
                Dashboard(UI)
                      │
          ┌───────────┴───────────┐
          │                       │
Langfuse/OpenLIT          Grafana/Jaeger
          │                       │
          └───────────┬───────────┘
                      │
                OpenTelemetry
                      │
          SDK / Instrumentation
                      │
             Agent Runtime
```

其中 **OpenTelemetry 已经成为事实标准**。

---

# 建议的整体架构

我一般建议拆成五层。

```
Application
    │
    ▼
Agent Runtime
    │
    ▼
Tracing SDK
    │
    ▼
OpenTelemetry
    │
    ▼
OTLP Collector
    │
 ┌──┴──────────────┐
 │                 │
Jaeger          Clickhouse
 │                 │
Grafana       Langfuse UI
```

其中：

* Trace
* Logs
* Metrics

全部统一走 OTLP。

不要自己设计 Trace Protocol。

---

# Trace 应该如何设计

不要以 HTTP Request 为中心。

应该以 **Agent Task** 为中心。

例如：

```
User Ask

↓

Trace

    Agent

        Planner

            LLM

        Search

            BM25

            Embedding

            Reranker

        Tool

            Github

            SQL

            Browser

        Reflection

            LLM

        Final Answer
```

整个就是一棵 Span Tree。

例如

```
Trace

Root Span

Agent.Run

    Planner

        OpenAI Chat

    Search

        BM25

        Dense Retrieval

    Browser

        Navigate

        Extract DOM

        Screenshot

    LLM Answer
```

以后任何一步异常都能定位。

---

# Span Attribute 应该有哪些

建议定义统一 schema。

例如

```
agent.name

agent.version

agent.run_id

agent.session_id

agent.user_id

agent.workflow

```

LLM

```
llm.vendor

llm.model

llm.temperature

llm.max_tokens

llm.prompt_tokens

llm.completion_tokens

llm.total_tokens

llm.cached_tokens

llm.reasoning_tokens

llm.cost

llm.latency

```

Prompt

```
prompt.name

prompt.version

prompt.template

prompt.variables

prompt.hash

```

Tool

```
tool.name

tool.arguments

tool.result_size

tool.success

tool.retry

```

Retrieval

```
retrieval.index

retrieval.topk

retrieval.latency

retrieval.embedding_model

retrieval.hit_count

```

Browser

```
browser.url

browser.selector

browser.dom_size

browser.screenshot

browser.network_count

```

这些全部作为 Span Attributes。

---

# Prompt 如何记录

不要只记录 prompt。

建议记录：

```
Prompt

↓

Template

↓

Variables

↓

Rendered Prompt
```

例如

```
Prompt

Translate Template

Version

v15

Variables

language=Chinese

tone=formal

article=...

Rendered Prompt

....
```

以后 Prompt 修改即可 Diff。

---

# Agent Event

除了 Span，

建议记录 Event。

例如

```
Planner finished

Reflection started

Retry

Fallback

Memory Hit

Memory Miss

Cache Hit

Cache Miss

```

OTel Event 非常适合。

---

# Metrics

另外不要什么都查 Trace。

很多统计应该直接 Metrics。

例如：

```
Token/s

Average latency

Cost/hour

Error %

Retry %

Prompt Cache Hit

Embedding Cache Hit

```

Grafana 可以直接画。

---

# Cost 分析

很多系统没有做好。

建议每个 Span 都有：

```
Prompt Tokens

Completion Tokens

Reasoning Tokens

Cached Tokens

```

以及

```
USD

JPY

CNY

```

例如：

```
Planner

$0.003

Search

$0

Reflection

$0.018

Answer

$0.005
```

最终

```
Trace Cost

0.026 USD
```

还能画

```
Pie Chart

Planner

10%

Reflection

70%

Answer

20%
```

一眼看到瓶颈。

---

# Token Timeline

还建议画 Timeline。

```
Time

│

Planner

█████

Search

██

Browser

██████████

Answer

████

```

另外

```
Token

Planner

800

Reflection

6000

Answer

1200
```

很容易定位 Reflection 爆 Token。

---

# Prompt Diff

最好支持版本。

例如

```
Prompt v12

↓

Prompt v13

```

然后查看：

```
Latency

+15%

Cost

-25%

Accuracy

+8%
```

LangSmith 就有类似功能。

---

# 如果 Tool 很多怎么办？

每个 Tool 一个 Span。

例如

```
Browser

    goto

    click

    wait

    extract

Github

    search

    get file

SQL

    query

```

全部展开。

---

# Trace Correlation

建议统一 ID。

```
trace_id

session_id

conversation_id

user_id

workflow_id

task_id

```

以后：

用户反馈

↓

找到 Session

↓

找到 Trace

↓

找到 Span

↓

定位 Prompt。

---

# OpenTelemetry Collector

Collector 可以负责：

```
Sampling

Filtering

PII Remove

Mask Secret

Batch

Retry

Export
```

例如：

```
SDK

↓

Collector

↓

Jaeger

↓

Clickhouse

↓

S3
```

不用应用自己处理。

---

# Open Source 推荐（2026）

## ① Langfuse（最推荐）

优势：

* AI Native
* Prompt Version
* Dataset
* Evaluation
* Cost
* Session
* Trace
* OpenTelemetry

目前基本就是 Open Source LangSmith。

适合作为 AI Observability 平台。

---

## ② OpenLIT（推荐）

近两年发展很快。

特点：

* OTel First
* Auto Instrumentation
* Prompt
* Cost
* GPU
* Vector DB
* Agent

适合已有 OpenTelemetry 基础设施的团队。

---

## ③ Arize Phoenix

偏 Evaluation。

适合：

* RAG
* Embedding
* Hallucination
* Retrieval

不是完整 Agent Observability。

---

## ④ Helicone

更偏 API Gateway。

适合：

* OpenAI Proxy
* Cost
* Logging

Agent 能力较少。

---

## ⑤ SigNoz

完全 OTel。

优点：

* Trace
* Metrics
* Logs

缺点：

AI 信息需要自己扩展 Schema。

---

## ⑥ Jaeger + Grafana

最低成本方案。

全部自己做。

---

# 如果是我重新设计一个面向企业 AI Agent 平台的可观测性系统

我会采用下面这套分层架构：

```
                Grafana
                   │
     ┌─────────────┴─────────────┐
     │                           │
 Langfuse (AI View)      Jaeger / Tempo (Infra View)
     │                           │
     └─────────────┬─────────────┘
                   │
            OpenTelemetry Collector
                   │
        AI Instrumentation SDK
                   │
     Agent / MCP / Browser / RAG / LLM
```

其中 AI Instrumentation SDK 负责自动为 Agent、LLM、Prompt、Tool、Retriever、Browser、MCP Server 等组件创建标准化 Span，并附带 Token、Cost、Latency、Prompt Hash、Model、Cache 命中率等属性；Collector 负责脱敏、采样、聚合与导出；上层则同时使用 **Langfuse** 提供 AI 专属分析视图，以及 **Jaeger/Tempo + Grafana** 提供基础设施级追踪与指标分析。这样既能像 LangSmith 一样快速定位 Prompt 和 Agent 的问题，又能利用 OpenTelemetry 生态实现统一的全链路可观测性，避免被单一厂商的数据模型锁定。


----------


可以，而且**我建议不要从 OpenTelemetry SDK 原生开始写**。你的目标应该是：

> **找一个 AI Observability SDK，作为 Instrumentation Layer，然后在上面做自己的 Semantic Convention。**

按照你的背景（架构师，希望做企业级 AI 平台，而不是只监控 LangChain），我会这样选择。

| 方案                        | 推荐度   | 是否值得二次开发 | OTel | Agent       | Prompt | Cost | 适合你     |
| ------------------------- | ----- | -------- | ---- | ----------- | ------ | ---- | ------- |
| **OpenLIT**               | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐    | ✅    | ✅           | ✅      | ✅    | **最推荐** |
| **OpenInference**         | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐    | ✅    | ✅           | ✅      | 部分   | **最推荐** |
| Langfuse SDK              | ⭐⭐⭐⭐  | ⭐⭐⭐      | 部分   | ✅           | ✅      | ✅    | 偏产品     |
| OpenTelemetry SDK         | ⭐⭐⭐   | ⭐⭐⭐⭐⭐    | ✅    | ❌           | ❌      | ❌    | 太底层     |
| OpenAI Agents SDK Tracing | ⭐⭐⭐   | ⭐⭐       | ✅    | OpenAI Only | ✅      | ✅    | 不够通用    |

---

# ① OpenInference（我最推荐）

这是现在 AI Observability 社区影响力最大的标准之一。

它实际上就是：

```
OpenTelemetry

+

AI Semantic Convention

+

Instrumentation
```

项目：

> **OpenInference**

GitHub

[https://github.com/Arize-ai/openinference](https://github.com/Arize-ai/openinference)

它定义了：

```
LLM Span

Embedding Span

Retriever Span

Tool Span

Agent Span

Prompt

Reranker

VectorDB
```

几乎就是 LangSmith 的开源版数据模型。

例如：

```python
@tracer.start_as_current_span("Retriever")
def retrieve():
    span.set_attribute(
        "openinference.span.kind",
        "RETRIEVER"
    )
```

是不是很熟悉？

因为 Phoenix、Langfuse 等很多产品都参考了它。

---

# 为什么我喜欢它？

因为它不是 UI。

而是：

```
Semantic Convention

+

Instrumentation

+

OTel
```

你完全可以：

```
OpenInference

↓

增加自己的 Span Type

↓

增加自己的 Attribute

↓

OTLP
```

例如：

```
Planner

Reflection

Memory

Workflow

Reasoning
```

全部扩展。

---

# ② OpenLIT

这是我认为最适合企业自己改造的。

GitHub

[https://github.com/openlit/openlit](https://github.com/openlit/openlit)

OpenLIT 本质：

```
Application

↓

OpenLIT SDK

↓

OTel SDK

↓

Collector

↓

Backend
```

它已经支持：

✅ OpenAI

✅ Claude

✅ Gemini

✅ Ollama

✅ vLLM

✅ LiteLLM

✅ LangGraph

✅ CrewAI

✅ MCP

等等。

自动采集：

```
Token

Latency

Cost

Prompt

Response

Errors

Retry
```

几乎不用写。

---

更重要的是：

OpenLIT 自己也是：

```
OTel SDK

+

一些 Decorator

+

Auto Instrumentation
```

源码很好改。

---

# ③ 如果我是你，我会怎么改？

例如：

```
OpenLIT SDK

↓

增加：

Planner

Workflow

Reflection

Critic

↓

Export
```

比如：

```
Agent

    Planner

    Tool

    Reflection

    Memory

    Answer
```

变成：

```
PlannerSpan

ReflectionSpan

MemorySpan
```

非常容易。

---

# ④ Langfuse SDK

很多人误会。

Langfuse SDK：

```
不是 OTel SDK
```

而是：

```
Langfuse API

↓

自己的数据模型

↓

UI
```

虽然现在支持：

```
OTLP Import
```

但是：

SDK 不够开放。

如果以后：

```
不用 Langfuse
```

迁移成本会高一点。

---

# ⑤ OpenTelemetry SDK

当然可以。

例如：

```python
with tracer.start_as_current_span("Planner"):
    ...
```

但是：

所有：

```
Prompt

Token

Cost

Agent

Workflow
```

全部自己写。

工作量巨大。

---

# 我建议的架构

如果你准备做：

> 企业 AI Agent Platform

我建议：

```
                 Your SDK
                     │
      ┌──────────────┴──────────────┐
      │                             │
 OpenInference               OpenLIT
      │                             │
      └──────────────┬──────────────┘
                     │
            OpenTelemetry SDK
                     │
                OTLP Collector
                     │
      ┌──────────────┴──────────────┐
      │                             │
   Tempo/Jaeger               Langfuse
```

然后你的 SDK：

统一：

```
Agent

Workflow

Planner

Reasoner

Reflection

Critic

Memory

Tool

Browser

Retriever

Reranker
```

以后：

所有 Framework：

```
LangGraph

CrewAI

AutoGen

Mastra

OpenAI Agents

Claude Code SDK

Google ADK

MCP

```

全部 Adapter 一层。

---

## 结合你最近在做的代码搜索 Agent，我会再进一步建议

你前几天一直在讨论：

* 多阶段 Search Pipeline（BM25 → Embedding → Rerank）
* Browser/Playwright 自动化
* Claude Code Server
* MCP
* Agent Workflow

这种场景已经超过了普通 LLM Trace，更像一个**AI Workflow Engine**。

因此我会设计一层比 OpenInference 更高的抽象，例如：

```
Workflow
 ├── Stage(Search)
 │     ├── BM25
 │     ├── Embedding
 │     └── Rerank
 ├── Stage(Planning)
 │     └── LLM
 ├── Stage(Browser)
 │     ├── Navigate
 │     └── Extract
 └── Stage(Synthesis)
       └── LLM
```

底层仍然使用 **OpenTelemetry + OpenInference/OpenLIT** 导出标准 Trace，而你的平台增加一层 **Workflow Semantic Model**（Stage、Pipeline、Cost Attribution、Prompt Version、Cache、Token Budget 等）。这样既兼容整个 OTel 生态，又能满足企业级 Agent Troubleshooting 和 FinOps 分析需求，而且未来接入新的 Agent Framework 基本只需要写 Adapter，而不用修改整个观测体系。





----------------

这是**所有 AI Observability 产品最大的难点**。实际上，LangSmith、Langfuse、OpenLIT、Arize Phoenix、OpenAI Tracing 都面临同一个问题：

> **为了排查问题，你需要记录 Prompt；但 Prompt 和 Tool Input 往往包含 PII、商业机密、源代码甚至 Token。**

企业（尤其金融、医疗、政府）通常不能直接把这些数据存到 Observability 系统。

因此，现在成熟的方案都采用 **Privacy by Design**，而不是简单的「不要记录」。

---

# 一个成熟的架构

建议把 Logging Pipeline 独立出来，而不是 SDK 直接发到 Backend。

```
Agent Runtime

      │

      ▼

Instrumentation SDK

      │

      ▼

OTel Collector

      │

      ▼

PII Processor
      │
 ┌────┴────┐
 │         │
Mask    Encrypt
 │         │
 └────┬────┘
      ▼
OTLP Exporter
      ▼
Tempo / Langfuse / ClickHouse
```

**PII Processor 放在 OTel Collector**，而不是业务代码里。

---

# 第一层：Prompt 不保存 Raw Text

很多公司一开始都会：

```
prompt = """
Please summarize ...

Customer Name:

John Smith

SSN:

123-45-6789
"""
```

这是绝对不建议的。

建议拆成：

```
Prompt Template

↓

Variables

↓

Rendered Prompt
```

例如：

```
Template

translate_v12

Variables

language=Chinese

article=...
```

真正存：

```
template_id

version

variables
```

而不是 Render 后的 Prompt。

这样可以：

* Prompt Debug
* Prompt Diff
* Prompt Version

但不会保存全部文本。

---

# 第二层：字段级 Redaction（推荐）

例如：

```
{
    "customerName": "John Smith",
    "account":"123456789",
    "email":"abc@gmail.com"
}
```

Collector 自动变成：

```
{
    "customerName":"******",
    "account":"******",
    "email":"******"
}
```

最好支持：

```
Redact

Mask

Hash

Remove
```

例如

```
email

↓

sha256(email)

↓

4b91c1...
```

以后还能统计：

> 同一个客户连续失败。

但不知道客户是谁。

---

# 第三层：Span Attribute Classification

不是所有 Attribute 都一样。

建议定义：

```
PUBLIC

INTERNAL

CONFIDENTIAL

SECRET
```

例如：

```
gen_ai.model

PUBLIC

--------------

tool.url

INTERNAL

--------------

prompt.variables.customer

CONFIDENTIAL

--------------

api_key

SECRET
```

Collector：

```
SECRET

↓

直接删除
```

```
CONFIDENTIAL

↓

Hash
```

```
PUBLIC

↓

保留
```

---

# 第四层：Tool Input 不记录全文

例如：

Browser Tool

```
Navigate

https://abc.com
```

没问题。

但是：

```
POST

/customer

{
SSN
Address
...
}
```

不要记录。

建议：

```
Tool Name

HTTP POST

Input Size

2KB

Fields

5

Latency

Response Size

```

需要 Debug 时：

保存：

```
Schema

而不是

Data
```

例如：

```
{
 customerName:string

 age:number

 address:string
}
```

---

# 第五层：Source Code 怎么办？

你最近一直在做 Code Search Agent。

例如：

```
Search Code

↓

LLM

↓

Summarize
```

这里最危险。

千万不要：

```
Prompt

↓

整个文件
```

建议：

```
repo

branch

commit

file

sha256

line

```

例如：

```
repo

cloudflare

file

worker.ts

commit

ab321cd

hash

98fa12...
```

真正源码：

需要的时候：

再去 Git 拉。

Observability 永远不要保存源码。

---

# 第六层：Sampling

例如：

10000 个请求。

真正保存 Prompt：

```
1%
```

其余：

只保存：

```
Token

Latency

Cost

```

这样：

风险降低很多。

---

# 第七层：双存储（推荐）

很多企业都是：

```
Metadata Store

↓

ClickHouse
```

保存：

```
Trace

Latency

Cost

Token

Prompt Hash

```

另外：

```
Sensitive Store

↓

S3

↓

AES256
```

只有：

```
Admin

Compliance

```

才能查看。

普通开发：

只能看到：

```
Prompt

↓

[REDACTED]
```

---

# 第八层：Prompt Fingerprint（我很推荐）

例如：

Prompt：

```
Summarize the following article...
```

计算：

```
SHA256
```

保存：

```
Prompt Hash

↓

A91BCDD...
```

以后：

```
Hash

↓

Prompt Version
```

即可。

甚至：

```
Embedding

↓

Near Duplicate Prompt
```

都能分析。

无需保存全文。

---

# 第九层：Token Cost 不需要 Prompt

很多人误解。

其实：

定位：

```
为什么今天花了 200 美元？
```

根本不用 Prompt。

只需要：

```
model

prompt_tokens

completion_tokens

reasoning_tokens

cached_tokens

latency

```

即可。

例如：

```
Planner

Claude Sonnet

120

↓

180
```

```
Reflection

GPT-5

16000

↓

$0.48
```

已经知道：

Reflection 爆了。

不用看 Prompt。

---

# 第十层：可配置 Logging Policy（企业必备）

建议定义一份策略，例如 YAML：

```yaml
logging:
  prompt:
    store: metadata_only      # none | metadata_only | full
    hash: true
    template: true
    variables:
      mode: whitelist
      allow:
        - language
        - repo
        - model

  tool:
    input:
      redact:
        - password
        - token
        - ssn
        - email
        - phone
      hash:
        - customerId
        - accountId
      remove:
        - apiKey
        - authorization

  browser:
    save_html: false
    save_url: true
    save_screenshot: false

  code:
    save_content: false
    save_commit: true
    save_repo: true
    save_hash: true
```

这样，你可以针对不同 Tool、不同环境（开发、测试、生产）启用不同的策略。

---

## 如果是你们这种金融企业，我会采用四层数据模型

结合你之前提到的 **FinOps、代码搜索 Agent、Cloud、企业内部 AI 平台**，我会把 Trace 数据分为四个等级：

| 数据层                      | 内容                                                             | 默认策略                                    |
| ------------------------ | -------------------------------------------------------------- | --------------------------------------- |
| **L1 Metadata**          | Trace、Span、Latency、Token、Cost、Model、Error                      | 全部保存                                    |
| **L2 Business Metadata** | Prompt Template ID、Workflow、Tool Name、Repo、Commit、Prompt Hash  | 全部保存                                    |
| **L3 User Data**         | Prompt Variables、Tool Input、LLM Output                         | 默认脱敏/Hash，仅白名单字段保留                      |
| **L4 Sensitive Data**    | 源代码、客户信息、身份证号、API Key、Access Token、Cookie、Authorization Header | 默认禁止进入 Observability，必要时加密独立存储并设置严格访问控制 |

这种分层的好处是：**90% 的性能分析、Token 成本分析、Trace Troubleshooting 都依赖 L1/L2 即可完成**；只有极少数需要深度排查的场景，才需要在受控权限下访问 L3/L4 数据。这也是大型金融机构和云平台构建 AI Observability 时普遍采用的思路。
