如果这里说的是**用户在 Agent 对话中临时上传一个 PDF / Excel / Word / 图片，然后让 Agent 分析这个文件**，那么两种模式其实差别很大。

## 先给结论

我会这样选：

| 场景              | 自制 Agent Platform        | Snowflake Cortex Agent           |
| --------------- | ------------------------ | -------------------------------- |
| 用户临时上传 PDF      | **非常灵活**                 | 可以做，但更偏 Snowflake Stage          |
| 用户临时上传 Excel    | **容易**                   | 可以落 Stage 后处理                    |
| 用户上传图片          | **容易直接传给模型**             | Cortex REST 支持 vision 图片输入       |
| 用户上传几十 MB 文件    | 很容易自己控制                  | Stage 模式更自然                      |
| 文件长期作为知识库       | 自己做 Object Storage + RAG | **Snowflake 很强**                 |
| 文件需要反复查询        | Object Storage + Search  | **Stage + Cortex Search**        |
| 文件需要 SQL 分析     | 自己做 ingestion            | **Snowflake 非常合适**               |
| 文件需要复杂 Agent 操作 | **DeepAgents 更灵活**       | Coding Agent / code execution 可做 |
| 文件权限治理          | 自己做                      | **Snowflake 优势明显**               |

最关键的区别是：

> **自制平台适合“file as request input”；Snowflake 更适合“file as data/knowledge”。**

---

# 1. 自制 Agent Platform：文件应该是 Request 的一部分

例如前端：

```text
用户
 │
 │  上传 annual-report.pdf
 │
 ▼
Angular
 │
 ▼
Agent API
 │
 ├── fileId
 ├── filename
 ├── mimeType
 └── storageUri
 │
 ▼
DeepAgents
```

我推荐**不要直接把文件 base64 塞进 Agent prompt**。

应该：

```text
Browser
   │
   │ upload
   ▼
Object Storage
   │
   │ fileId
   ▼
Agent API
   │
   ▼
Agent Runtime
```

例如：

```text
s3://agent-files/session-123/report.pdf
```

然后 Agent 的 context：

```json
{
  "userMessage": "分析这份年报中的 ESG 风险",
  "attachments": [
    {
      "id": "file-123",
      "name": "report.pdf",
      "mimeType": "application/pdf",
      "uri": "s3://..."
    }
  ]
}
```

Agent 再决定：

```text
PDF
 ↓
document parser
 ↓
text / markdown / tables
 ↓
chunks
 ↓
LLM
```

或者：

```text
PDF
 ↓
multimodal model
```

---

# 2. 自制平台最好把 File 做成一等公民

我会设计：

```text
AgentRequest
├── messages
├── attachments[]
└── metadata
```

Attachment：

```typescript
type AgentAttachment = {
  id: string
  name: string
  mimeType: string
  size: number
  uri: string
  source: "upload" | "url" | "workspace"
}
```

然后 Agent Tools：

```text
file.read
file.extract
file.search
file.preview
file.download
```

这样 Agent 本身不知道文件存在哪里。

例如：

```text
DeepAgent
    │
    ├── file.read(file-123)
    ├── file.extract(file-123)
    ├── file.search(file-123, "ESG risk")
    └── python.analyze(file-123)
```

这比：

```text
prompt = "... here's the PDF base64 ..."
```

成熟很多。

---

# 3. Snowflake Cortex 的思路不太一样

Snowflake 更推荐：

```text
User File
   ↓
Snowflake Stage
   ↓
AI_PARSE_DOCUMENT
   ↓
Table
   ↓
Cortex Search
   ↓
Cortex Agent
```

官方的 PDF chatbot 示例就是这个模式：先把 PDF 上传到 Snowflake Stage，再用 `AI_PARSE_DOCUMENT` 解析，然后切 chunk，最后建立 Cortex Search。([Snowflake Documentation][1])

例如：

```text
@MY_DB.MY_SCHEMA.DOCUMENTS/

    annual-report-2025.pdf
    annual-report-2024.pdf
    ESG-report-2025.pdf
```

然后：

```text
AI_PARSE_DOCUMENT
       ↓
extracted markdown
       ↓
chunk
       ↓
Cortex Search
```

Agent：

```text
User
 │
 │ "2025 年报中最大的 ESG 风险是什么？"
 │
 ▼
Cortex Agent
 │
 ▼
Cortex Search
 │
 ▼
PDF chunks
 │
 ▼
LLM
 │
 ▼
Answer + citation
```

Cortex Search 本身就是 Cortex Agent 的标准 unstructured-data retrieval layer。([Snowflake Documentation][2])

---

# 4. 这两种模式最大的区别

假设用户上传：

```text
ABC_Annual_Report.pdf
```

### 自制 Agent

更像：

```text
POST /agents/investment/run

files:
  - ABC_Annual_Report.pdf

message:
  "分析这家公司"
```

这个文件属于：

> **这一次 Agent Run**

---

### Snowflake

更像：

```text
PUT file
     ↓
Snowflake Stage
     ↓
Parse
     ↓
Index
     ↓
Cortex Search
```

这个文件属于：

> **企业知识库 / Data Plane**

所以 Snowflake 天生更适合：

> “上传以后，以后所有 Agent 都可以查询。”

---

# 5. 但是 Snowflake 也可以处理临时文件

这点很重要。

并不是说 Cortex Agent 只能处理预先建立好的知识库。

Snowflake 本身支持把本地文件上传到 Stage；官方文档也展示了 Snowsight 直接上传文件到 Stage 的方式。([Snowflake Documentation][1])

然后：

```text
upload
 ↓
stage
 ↓
AI_PARSE_DOCUMENT
 ↓
temporary table
 ↓
agent
```

你完全可以做：

```text
POST /agent/session
POST /agent/session/{id}/files
POST /agent/session/{id}/run
```

内部：

```text
Agent Session
    │
    ├── temporary stage
    │       └── report.pdf
    │
    ├── parsed content
    │
    └── agent thread
```

只是**这不是 Cortex Agent 最天然的交互模式**，你需要自己在外围做一层 file/session management。

---

# 6. 图片稍微不同

如果用户上传：

```text
chart.png
```

Snowflake Cortex REST API 对支持 vision 的模型可以直接接受 image input，目前要求把图片作为 base64 放进请求，单次 conversation 最多 20 张图片、请求大小上限 20 MiB。([Snowflake Documentation][3])

因此：

```text
Browser
 ↓
image
 ↓
Cortex REST API
 ↓
Vision model
```

是可以的。

自制 Agent Platform 则可以更自由：

```text
Browser
 ↓
Object Storage
 ↓
DeepAgents
 ↓
Vision model
```

甚至可以：

```text
image
 ↓
OCR
 ↓
Vision
 ↓
Python
 ↓
SQL
```

---

# 7. Excel 是最能体现两者差异的场景

例如用户上传：

```text
portfolio.xlsx
```

问：

> “帮我找出过去一年收益率最低的 10 个标的，并分析原因。”

### 自制平台

可以：

```text
Excel
 ↓
Object Storage
 ↓
Python tool
 ↓
pandas
 ↓
DataFrame
 ↓
DeepAgent
 ↓
LLM
```

这是 DeepAgents 很擅长的模式。

---

### Snowflake

则可以：

```text
Excel
 ↓
Stage
 ↓
Snowflake ingestion
 ↓
Table
 ↓
SQL
 ↓
Cortex Agent
```

然后：

```text
Cortex Analyst
       ↓
SQL
       ↓
portfolio table
       ↓
Cortex Agent
```

这其实是 Snowflake 的强项。

---

# 8. 更有意思的是 PDF + SQL 可以合并

这正好适合你前面说的**投资 idea / ESG** 场景。

例如：

```text
用户上传：
Apple_2025_Annual_Report.pdf
```

然后问：

> “结合这份年报和我们 Snowflake 里的 ESG 数据，分析 Apple 的主要风险。”

Agent 可以：

```text
                 Cortex Agent
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
     Cortex Search  Analyst       SQL
          │            │            │
       年报 PDF      ESG data     financial
          │            │            │
          └────────────┼────────────┘
                       ↓
                      LLM
                       ↓
                    Report
```

这个就是 Snowflake 架构真正有吸引力的地方。

文件不是孤立的：

> **文件最终成为 Snowflake Data Plane 的一部分。**

Cortex Search 甚至支持 analytical search：先缩小文档候选集，再通过 SQL、`AI_FILTER`、`AI_EXTRACT`、`AI_AGG` 等对整个相关文档集合做分析。([Snowflake Documentation][4])

---

# 9. 如果是你要做的 Agent Platform，我建议直接支持两种 File Mode

不要二选一。

定义：

```text
File Mode
│
├── ephemeral
│
└── knowledge
```

### `ephemeral`

用户上传：

```text
report.pdf
```

只服务当前：

```text
Agent Session
```

架构：

```text
Browser
 ↓
Object Storage
 ↓
Agent File Service
 ↓
DeepAgents / Cortex Agent
```

生命周期：

```text
Session created
      ↓
file uploaded
      ↓
agent run
      ↓
session expires
      ↓
file deleted
```

适合：

* 临时 PDF
* Excel
* 图片
* 用户自己的材料
* 一次性分析

---

### `knowledge`

用户上传：

```text
ESG-policy.pdf
Investment-guideline.pdf
Company-report.pdf
```

进入：

```text
Snowflake Stage
 ↓
AI_PARSE_DOCUMENT
 ↓
Chunks
 ↓
Cortex Search
 ↓
Agent Knowledge
```

生命周期：

```text
Upload
 ↓
Index
 ↓
Available to many agents
 ↓
Versioning
 ↓
Delete
```

适合：

* 企业知识库
* 投研报告
* ESG 文档
* 制度
* 合同
* Research

---

# 10. 我会进一步把 Agent Platform 的 File Plane 单独抽出来

最终架构：

```text
                         Agent Platform
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
          Runtime            Tools             Files
             │                 │                 │
      ┌──────┴──────┐          │         ┌───────┴────────┐
      │             │          │         │                │
Cortex Agent   DeepAgents     MCP    Ephemeral         Knowledge
      │             │                    │                │
      │             │                  S3/Blob       Snowflake
      │             │                    │              Stage
      │             │                    │                │
      │             │                    │        AI_PARSE_DOCUMENT
      │             │                    │                │
      │             │                    │        Cortex Search
      │             │                    │                │
      └─────────────┴────────────────────┴────────────────┘
                               │
                         Observability
                               │
                           Snowflake
```

这个设计非常适合你前面那个企业 AI Platform。

---

## 11. 一个特别重要的设计原则

**不要让 Agent 直接拥有“文件上传能力”。**

应该：

```text
Frontend
   ↓
File Service
   ↓
File ID
   ↓
Agent
```

Agent 看到：

```json
{
  "fileId": "file_123",
  "name": "annual-report.pdf",
  "mimeType": "application/pdf"
}
```

然后通过 tool：

```text
file.read
file.parse
file.search
file.download
```

访问。

这样未来你完全可以把：

```text
S3
Azure Blob
Snowflake Stage
SharePoint
OneDrive
Google Drive
```

统一成：

```text
FileProvider
```

Agent 根本不用知道底层存储是什么。

---

### 最终我会这样定

如果你们已经以 **Snowflake 为企业数据中心**：

**临时用户文件：**

```text
Browser
 → File Service
 → S3/Blob
 → DeepAgents
```

**企业长期文件：**

```text
Upload
 → Snowflake Stage
 → AI_PARSE_DOCUMENT
 → Cortex Search
 → Cortex Agent / DeepAgents via MCP
```

**Excel / CSV 等需要计算的文件：**

```text
Upload
 → Snowflake Stage
 → Table
 → SQL / Cortex Analyst
 → Agent
```

**图片：**

```text
Upload
 → Vision model
 → Agent
```

这种设计比“所有文件都丢进 Cortex Agent”更合理，也不会把你的 Agent Platform 锁死在 Snowflake。

[1]: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/tutorials/cortex-search-tutorial-3-chat-advanced?utm_source=chatgpt.com "Tutorial 3: Build a PDF chatbot with Cortex Search | Snowflake Documentation"
[2]: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-agents?utm_source=chatgpt.com "Use Cortex Search with Cortex Agents | Snowflake Documentation"
[3]: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api?utm_source=chatgpt.com "Cortex REST API | Snowflake Documentation"
[4]: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-analytical-search?utm_source=chatgpt.com "Analytical search | Snowflake Documentation"



----------------


可以。这里其实要把两个问题分开看：

1. **Snowflake 如何把 structured + unstructured 统一纳入 Agent**
2. **Snowflake 的 Evaluation 到底已经到了什么程度，能不能替代 LangSmith**

我重新看了目前 Snowflake 的文档后，结论比前面更明确：

> **第一个问题，Snowflake 已经做得非常完整，甚至是它做 Agent 平台最有竞争力的地方。**
>
> **第二个问题，Snowflake 的 Evaluation 已经不是“只有简单 LLM-as-judge”了；2026 年已经进入 GA，并且有 Agent-specific evaluation + AI Observability + TruLens。但如果拿整个 LangSmith Evaluation/Observability 生态比较，仍然不能说完全达到 LangSmith 的成熟度。**

---

# 一、Structured + Unstructured 到底怎么进入 Snowflake Agent？

Snowflake 现在的 Cortex Agent 本身就是围绕这个问题设计的。

它的官方架构就是：

```text
                         Cortex Agent
                              │
                   ┌──────────┴──────────┐
                   │                     │
             Structured              Unstructured
                   │                     │
             Cortex Analyst          Cortex Search
                   │                     │
                   ▼                     ▼
              Snowflake DB          Documents
              Tables/Views          PDFs/Text/etc.
                   │                     │
                   └──────────┬──────────┘
                              ▼
                         Agent Reasoning
                              │
                              ▼
                           Answer
```

Snowflake 官方明确把 Cortex Agent 定义成可以在 **structured + unstructured data 之间进行 orchestration** 的 Agent；structured 数据通过 Cortex Analyst 生成 SQL，unstructured 数据通过 Cortex Search 检索。([Snowflake Documentation][1])

这不是两个独立产品硬拼，而是 Agent 自己决定：

> “这个问题应该查数据库，还是查文档，还是两个都查？”

---

# 二、Structured Data 应该怎么放？

对于你们的金融场景，我建议：

```text
Snowflake
│
├── Raw data
│
├── Curated tables
│
├── Semantic Views
│
└── Cortex Analyst
```

关键不是简单把表扔进去。

而是给 Agent 一个**业务语义层**。

例如投资 Idea：

```text
investment_ideas
portfolio
securities
companies
funds
esg_scores
financial_metrics
```

不要让 Agent 直接面对 200 张表。

应该：

```text
Raw tables
     ↓
Curated views
     ↓
Semantic Views
     ↓
Cortex Analyst
     ↓
Cortex Agent
```

Semantic View 可以定义：

```text
Company
 ├── company_id
 ├── name
 ├── sector
 └── country

Financial
 ├── revenue
 ├── EBITDA
 ├── margin
 └── growth

ESG
 ├── score
 ├── carbon_intensity
 └── controversy_score
```

以及它们之间的 relationship。

Snowflake 的 Semantic View 本身就是为这种业务实体、逻辑表和关系定义设计的。([Snowflake Documentation][2])

这样用户问：

> “过去三年日本金融行业 ESG score 下降最快的 20 家公司？”

Agent：

```text
Cortex Agent
      │
      ▼
Cortex Analyst
      │
      ▼
Semantic View
      │
      ▼
SQL
      │
      ▼
Snowflake
```

而不是让通用 LLM 自己猜 SQL。

---

# 三、Unstructured Data 怎么放？

则是：

```text
Documents
   │
   ▼
Snowflake Stage
   │
   ▼
AI_PARSE_DOCUMENT
   │
   ▼
Structured text / layout
   │
   ▼
Cortex Search
```

例如：

```text
@research_documents/

    Apple_2025_Annual_Report.pdf
    Toyota_ESG_Report.pdf
    Goldman_Research.pdf
    Investment_Guideline.pdf
```

然后 Cortex Search 建立 searchable service。

Cortex Search 本身就是 Snowflake 的 RAG/search layer。([Snowflake Documentation][3])

---

# 四、真正厉害的是 Agent 可以同时用两者

比如你们的实际场景：

> “结合 Toyota 2025 年报和我们 Snowflake 中的 ESG 数据，判断 Toyota 是否存在需要关注的 transition risk。”

Cortex Agent 可以走：

```text
                         User
                           │
                           ▼
                    Cortex Agent
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
        Cortex Search              Cortex Analyst
              │                         │
              ▼                         ▼
       Toyota 2025 PDF            ESG tables
              │                         │
              │                         ▼
              │                        SQL
              │                         │
              └────────────┬────────────┘
                           ▼
                      Agent reasoning
                           │
                           ▼
                        Answer
```

这是 Cortex Agent 的核心设计目标。Snowflake 官方甚至明确描述了 Agent 会在工具之间进行 routing，并在工具调用后反思下一步。([Snowflake Documentation][4])

---

# 五、所以对于你的平台，我会把 Data Plane 定义成这样

```text
                    Enterprise Data Plane
                            │
          ┌─────────────────┴──────────────────┐
          │                                    │
   Structured Data                       Unstructured Data
          │                                    │
   ┌──────┴──────┐                       ┌─────┴─────┐
   │             │                       │           │
 Tables       Semantic Views          Documents    Images
   │             │                       │
   └──────┬──────┘                       │
          │                               │
    Cortex Analyst                  Cortex Search
          │                               │
          └──────────────┬────────────────┘
                         │
                         ▼
                   Cortex Agent
```

这部分我认为：

**Snowflake > 自己从零搭。**

因为如果你自己做：

```text
Postgres
+
S3
+
OpenSearch
+
Vector DB
+
RAG
+
SQL Agent
+
Semantic Layer
```

你实际上重新造了一大堆 Snowflake 已经有的东西。

---

# 六、但不要误解成“所有 unstructured data 都要变成 Snowflake Table”

这是一个很重要的边界。

我会分：

### Structured

```text
DB
Tables
Views
Semantic Views
```

### Semi-structured

```text
JSON
XML
CSV
Parquet
```

可以进入 Snowflake。

### Unstructured

```text
PDF
DOCX
PPTX
HTML
TXT
Images
```

原始文件可以留在：

```text
Stage / external storage
```

然后：

```text
AI_PARSE_DOCUMENT
Cortex Search
```

负责消费它。

也就是说：

> **Snowflake 不一定要求你把 PDF 物理转换成数据库表。**

它可以保持：

```text
original document
      +
parsed representation
      +
search index
```

这个模型。

---

# 七、Evaluation：现在 Snowflake 已经到了什么程度？

这里需要纠正一个容易产生的印象。

如果是 2024/2025，我会说：

> Snowflake 的 AI Evaluation 明显落后 LangSmith。

**但到现在已经不是这个结论了。**

Snowflake 的：

> **Cortex Agent Evaluations**

已经在 **2026-03-13 GA**。([Snowflake Documentation][5])

而且它不是简单：

```text
input → output → LLM judge
```

Snowflake 现在采用 **Goal-Plan-Action (GPA)** 思路。

也就是：

```text
Goal
 ↓
Plan
 ↓
Action
 ├── Search
 ├── Analyst
 ├── Tool
 └── ...
 ↓
Result
```

每个阶段都可以评价。

官方文档明确说明 Agent evaluation 会追踪 Agent 活动，并且 evaluation trace 会包含 planning、response generation 和每个 tool invocation 的 span。([Snowflake Documentation][6])

这个方向其实非常对 Agent。

---

# 八、Snowflake Agent Evaluation 已经有什么？

目前至少可以分成：

```text
Agent Evaluation
│
├── Ground Truth Evaluation
│
├── Reference-free Evaluation
│
├── Agent behavior
│
├── Tool selection
│
├── Tool execution
│
├── Answer quality
│
└── Custom LLM Judge
```

而且支持自定义 evaluation metric。

例如你可以定义：

```text
"Does the agent respect investment data entitlement?"
```

然后：

```text
LLM Judge
   ↓
0 ~ 1
   +
explanation
```

Snowflake 明确支持 custom metrics，而且 custom metric 可以是 ground-truth based 或 reference-free。([Snowflake Documentation][6])

---

# 九、Snowflake 还有一个很重要的东西：External Agent Evaluation

这对于**你真正想做的平台**尤其重要。

你不一定只能评价：

```text
Cortex Agent
```

Snowflake 现在的 evaluation data API 已经区分：

```text
agent_type:
    CORTEX AGENT
    EXTERNAL AGENT
```

也就是说，Snowflake 正在支持把**外部 Agent application**也纳入 Evaluation / Observability。([Snowflake Documentation][6])

例如：

```text
                         Snowflake
                              │
                   ┌──────────┴──────────┐
                   │                     │
             Cortex Agent         External Agent
                   │                     │
                   │                 DeepAgents
                   │                 LangGraph
                   │                 Custom Agent
                   │                     │
                   └──────────┬──────────┘
                              │
                       AI Observability
                              │
                       Evaluation
```

这个变化对你前面讨论的架构非常关键。

---

# 十、这意味着什么？

你完全可以设计：

```text
Agent Platform
│
├── Cortex Agent
│
├── DeepAgents
│
├── Custom Agent
│
└── ...
        │
        ▼
Snowflake AI Observability
        │
        ▼
Evaluation
```

而不是：

```text
DeepAgents
    ↓
LangSmith
```

这意味着 Snowflake 有可能成为你们平台的：

> **统一 Agent Evaluation + Observability Data Plane**

而不是只评价 Snowflake 自己的 Agent。

---

# 十一、那和 LangSmith 比到底差在哪里？

这里需要比较得更严格。

| 能力                            | Snowflake | LangSmith |
| ----------------------------- | --------- | --------- |
| Agent tracing                 | **强**     | **强**     |
| Agent-specific evaluation     | **强**     | **强**     |
| LLM-as-judge                  | **强**     | **强**     |
| Ground truth                  | **强**     | **强**     |
| Reference-free                | **强**     | **强**     |
| Custom evaluator              | **有**     | **非常强**   |
| Tool-level evaluation         | **强**     | **强**     |
| Dataset                       | **有**     | **非常成熟**  |
| Experiment                    | **有**     | **非常成熟**  |
| Version comparison            | **有**     | **非常成熟**  |
| Pairwise evaluation           | **相对弱**   | **强**     |
| Human annotation workflow     | **弱**     | **很强**    |
| Annotation queue              | **弱/不完整** | **成熟**    |
| Online evaluation             | **有**     | **成熟**    |
| Production feedback → dataset | **可以做**   | **非常成熟**  |
| Prompt engineering            | **弱**     | **强**     |
| Eval-driven development       | **中等**    | **强**     |
| TS/Python SDK                 | **有**     | **非常成熟**  |
| Agent framework integration   | **正在扩大**  | **非常强**   |
| Data governance               | **非常强**   | 中等        |
| SQL analytics                 | **非常强**   | 中等        |
| Enterprise data locality      | **非常强**   | 中等        |

LangSmith 当前明确把 Evaluation 分成：

```text
Offline
+
Online
```

Offline：

```text
Dataset
 ↓
Experiment
 ↓
Evaluator
 ↓
Compare
```

Online：

```text
Production Trace
 ↓
Online Evaluator
 ↓
Feedback
 ↓
Dataset
 ↓
Regression Test
```

而且支持 code evaluator、LLM-as-judge、composite evaluator、pairwise evaluation、summary evaluation 等。([Docs by LangChain][7])

这套 **evaluation lifecycle** 目前 LangSmith 仍然更成熟。

---

# 十二、特别是 Human Evaluation，LangSmith 明显更强

例如你们金融场景很可能需要：

> “这个 Agent 的投资风险分析是否真的专业？”

这种事情不一定适合完全 LLM-as-judge。

LangSmith 有专门的：

```text
Annotation Queue
```

可以：

```text
Agent Run
   ↓
Human Reviewer
   ↓
Rubric
   ├── Accuracy
   ├── Completeness
   ├── Compliance
   └── Investment relevance
```

甚至支持：

```text
Run A       vs       Run B
```

让人判断：

> 哪个版本更好？

LangSmith 的 Pairwise Annotation Queue 就是为这种场景设计的。([Docs by LangChain][8])

这是 Snowflake 目前明显没有达到同等成熟度的地方。

---

# 十三、但是 Snowflake 有一个 LangSmith 没有的巨大优势

就是：

> **Evaluation Data 本身就在企业 Data Platform 里。**

例如：

```text
Agent evaluation
      │
      ▼
Snowflake
      │
      ├── Agent traces
      ├── Evaluation scores
      ├── User feedback
      ├── Business data
      ├── Ground truth
      ├── Compliance data
      └── Audit data
```

你可以直接 SQL：

```sql
SELECT
    agent_version,
    evaluation_metric,
    AVG(score),
    COUNT(*)
FROM ...
GROUP BY
    agent_version,
    evaluation_metric;
```

然后和业务 KPI join：

```text
Agent Quality
     JOIN
Business Outcome
     JOIN
User
     JOIN
Portfolio
```

这在金融企业里是非常有价值的。

---

# 十四、所以我现在会重新定义 Snowflake vs LangSmith

不要问：

> “Snowflake Evaluation 能不能替代 LangSmith？”

应该问：

> **“我们的 Agent Platform 需要的是 LangSmith 的哪些能力？”**

如果只是：

```text
Trace
+
LLM Judge
+
Dataset
+
Regression
+
Agent evaluation
```

**Snowflake 现在已经足够。**

如果你需要：

```text
Trace
+
Evaluation
+
Prompt engineering
+
Dataset management
+
Experiment management
+
Pairwise evaluation
+
Human annotation
+
Online evaluators
+
Feedback loop
+
Deep framework integrations
```

**LangSmith 仍然明显更成熟。**

---

# 十五、但对你这个项目，我会做一个很重要的架构调整

你之前的架构是：

```text
DeepAgents
     ↓
LangSmith
     ↓
Snowflake
```

我现在更倾向：

```text
                         Agent Platform
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
          Runtime             Data          Evaluation
             │                 │                 │
      ┌──────┴──────┐    ┌────┴────┐       ┌────┴────┐
      │             │    │         │       │         │
Cortex Agent   DeepAgents Structured Unstructured Eval     Trace
      │             │    │         │       │         │
      │             │  Analyst   Search    │      Observability
      │             │    │         │       │         │
      └──────┬──────┘    └────┬────┘       └────┬────┘
             │                │                 │
             └────────────────┼─────────────────┘
                              ▼
                         Snowflake
```

然后只在需要的时候：

```text
                    LangSmith
                       ↑
                       │
             advanced developer
                experimentation
```

而不是让 LangSmith 成为平台的核心依赖。

---

# 十六、尤其是你们金融场景，我认为 Snowflake 的 Evaluation 路线反而更合理

你前面定义过几个非常重要的原则：

```text
Agent can reason autonomously,
but cannot independently break authorization.

LLM can generate suggestions,
but cannot define enterprise security boundary.

Retrieval can return data,
but cannot bypass Data Entitlement.

Tool can execute actions,
but high-risk actions require Policy decision.

Runtime logs != Regulatory Audit Evidence.
```

如果把 Evaluation 纳入这个体系，我会增加：

```text
Agent Evaluation
│
├── Answer Correctness
├── Groundedness
├── Tool Selection
├── Tool Execution
├── Plan Quality
├── Data Entitlement Compliance
├── Policy Compliance
├── Citation Correctness
├── Sensitive Data Exposure
├── Hallucination
└── Business Outcome
```

其中最后几个完全可以做成你们自己的 **custom evaluator**。

例如：

```text
Evaluation Dataset

input:
"分析 Fund A 的 ESG 风险"

ground_truth:
...

expected_data:
...

allowed_data:
...

expected_tools:
[
  "Cortex Search",
  "Cortex Analyst"
]

policy:
"User cannot access Fund B"
```

然后评：

```text
                    Agent Run
                        │
        ┌───────────────┼────────────────┐
        ↓               ↓                ↓
    Answer          Tool Calls       Data Access
        │               │                │
   Correctness      Tool Accuracy    Entitlement
        │               │                │
        └───────────────┼────────────────┘
                        ↓
                   Compliance
                        ↓
                  Final Score
```

这已经不是传统的“LLM output evaluation”了，而是：

> **Enterprise Agent Evaluation**

这个方向我认为比单纯复制 LangSmith 更适合你们。

---

# 十七、最后给一个成熟度判断

截至现在，我会这样打分：

| 能力                             | Snowflake | LangSmith |
| ------------------------------ | --------: | --------: |
| Agent Runtime                  |       8.5 |         9 |
| Structured Data Agent          |   **9.5** |       7.5 |
| Unstructured/RAG               |     **9** |         9 |
| Data Governance                |   **9.5** |         7 |
| Observability                  |       8.5 |   **9.5** |
| Agent Evaluation               |   **8.5** |   **9.5** |
| Evaluation Dataset             |         8 |   **9.5** |
| Experiment                     |         8 |   **9.5** |
| Human Evaluation               |         6 |   **9.5** |
| Pairwise Eval                  |       6.5 |     **9** |
| Online Evaluation              |         8 |   **9.5** |
| Custom enterprise metrics      |     **9** |         9 |
| Business-data correlation      |    **10** |         7 |
| Financial governance potential |   **9.5** |         8 |
| 全部集中在企业数据平台                    |    **10** |         6 |

所以我的判断不是：

> Snowflake 已经完全替代 LangSmith。

而是：

> **Snowflake 已经跨过了“Evaluation 不够用”的门槛。**

特别是现在 **Cortex Agent Evaluation + AI Observability + External Agent evaluation + Cortex Analyst evaluation + TruLens** 放在一起以后，已经足够支撑一个企业自己的 Agent Evaluation Platform。([Snowflake Documentation][6])

而你们如果采用：

**Cortex Agent + DeepAgents + Snowflake + SPCS + MCP**

我现在反而会建议：

> **不要一开始就把 LangSmith 当成必选项。**

先把 Snowflake 的 **Observability + Evaluation** 作为平台统一基础设施；只有在开发者体验、复杂实验、Human Annotation、Pairwise Evaluation、Prompt Engineering 等方面出现实际缺口，再补 LangSmith。

这会比“AgentCore + DeepAgents + LangSmith + Snowflake”少一个非常重的平台依赖，而且**structured/unstructured data、Agent trace、evaluation、business data、audit evidence 最终可以在同一个 Snowflake data plane 里关联起来**。

[1]: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents?utm_source=chatgpt.com "Cortex Agents"
[2]: https://docs.snowflake.com/en/user-guide/views-semantic/overview?utm_source=chatgpt.com "Overview of semantic views"
[3]: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview?utm_source=chatgpt.com "Cortex Search"
[4]: https://docs.snowflake.com/ja/user-guide/snowflake-cortex/cortex-agents?utm_source=chatgpt.com "Cortex Agents"
[5]: https://docs.snowflake.com/fr/release-notes/2026/other/2026-03-13-cortex-agent-evaluations?utm_source=chatgpt.com "13 mars 2026 Évaluations Cortex Agent (Disponibilité générale)"
[6]: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-evaluations?utm_source=chatgpt.com "Cortex Agent evaluations | Snowflake Documentation"
[7]: https://docs.langchain.com/langsmith/evaluation?utm_source=chatgpt.com "LangSmith Evaluation - Docs by LangChain"
[8]: https://docs.langchain.com/langsmith/annotation-queues?utm_source=chatgpt.com "Use annotation queues - Docs by LangChain"
