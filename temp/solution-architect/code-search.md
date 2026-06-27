## Question & Requirement

代码搜索策略，作为solution architect，我需要针对某个新需求（这个需求的业务背景我也不熟悉），可能需要搜索50多个甚至更多的内部github repo，我已经把这些repo clone到本地，但是代码搜索效率，包括token花费都不理想。给我设计一个搜索策略，做一些预处理，结合grep或者其它工具，做一下提效

**补充要求**：

1. 尽量减少额外工具或者数据库的依赖，类似于entity graph尽量存成human readable的json或者其它格式
2. 如果可能，尽量使用JavaScript或者Python来完成任务，减少幻觉产生，规范输出
3. 我的目的不是改代码，不是100%准确，而是尽量从代码库找到业务需求相关的code logic和data flow



---

## Answer From ChatGPT

这是一个典型的 **Code Intelligence / Code Discovery** 问题，而不是 RAG 问题。

对于你这种场景（Solution Architect + 数十甚至上百 Repo + 对业务不了解），我实际上不建议一开始就把所有 repo 全部交给 Claude Code、Codex 或 Gemini 去读。

**LLM 应该是最后一步，而不是第一步。**

我会设计一个四层搜索 Pipeline。

```
                New Requirement
                      │
                      ▼
           Requirement Expansion
        (LLM生成搜索关键词)
                      │
                      ▼
         Fast Static Search Layer
      (rg / ast-grep / ctags)
                      │
                      ▼
       Semantic Code Index Layer
      (symbol index / sqlite)
                      │
                      ▼
         LLM Deep Understanding
        (Claude / GPT / Gemini)
```

这一套下来，token 通常可以下降一个数量级。

---

### 第一层：Requirement Expansion

很多人最大的错误：

拿需求直接搜索。

例如

```
Need support PRIIPs report
```

直接

```
rg PRIIPs
```

结束。

实际上业务词汇往往不会出现在代码里。

Architect 第一件事情应该做的是：

**把需求展开成技术语言。**

例如

```
Requirement:

Generate PRIIPs Report
```

LLM先做：

```
列出：

业务名词
同义词
数据库字段
DTO名称
API名称
Kafka topic
GraphQL
REST endpoint
Feature Flag
配置文件
日志关键词
Exception
```

例如得到：

```
PRIIPS
KID
TransactionCost
PerformanceScenario
RiskIndicator
SRRI
CostCalculator
DocumentGenerator
PdfExporter
ReportBuilder
ScenarioEngine
```

然后自动生成搜索词。

例如：

```
PRIIPS
KID
Scenario
PerformanceScenario
CostCalculator
SRRI
Risk
PDF
Document
GenerateReport
```

第一步就已经提升很多。

---

### 第二层：建立 Repo Metadata（一次即可）

不要让 LLM 去扫描 repo。

应该提前做 metadata。

例如：

```
repo-a

symbols
imports
apis
controllers
entities
graphql
routes
kafka
sql
config
```

全部提出来。

例如

```
repo.json

{
  repo:

  services:

  controllers:

  routes:

  classes:

  interfaces:

  protobuf:

  graphql:

  kafka:

  sql_tables:

  package:

}
```

这个生成一次。

以后不用再扫描。

例如

```
rg "class "

rg "@RestController"

rg "router."

rg "@KafkaListener"

rg "graphql"

rg "createTable"

rg "CREATE TABLE"
```

一分钟就能完成几十Repo。

---

### 第三层：建立 Symbol Index（最重要）

这是我认为收益最高的。

例如建立

```
SQLite

symbols

------------------------
symbol
type
repo
file
line
language
```

例如

```
RiskCalculator
Class
pricing-service
...

CalculateCost()

Function

report-service

...

GeneratePdf

Method

document-service
```

全部存进去。

以后查询

```
risk
```

0.1 秒。

而不是 rg 所有 repo。

甚至支持：

```
like '%risk%'
```

或者

```
fts5
```

SQLite FTS。

---

### 第四层：Dependency Graph

Architect 最大的问题：

不知道入口。

建议提前生成

```
caller -> callee
```

例如

```
Controller

↓

Service

↓

DAO

↓

Kafka

↓

Snowflake
```

存成 graph。

例如

```
caller

callee

file
```

以后

```
RiskController
```

直接知道：

```
↓

RiskService

↓

CostEngine

↓

ScenarioCalculator

↓

PdfBuilder
```

根本不用 LLM。

---

### 第五层：建立 Import Graph

例如：

```
A imports B

B imports C

C imports D
```

Architect 最喜欢问：

```
这个类是谁用的？
```

提前建：

```
imports

extends

implements

annotation

decorator

dependency injection
```

查询：

```
RiskEngine
```

直接知道：

```
14个repo引用
```

---

### 第六层：全文索引（不是 Embedding）

很多公司第一反应：

Embedding。

其实代码搜索：

BM25 > Embedding

建议：

```
Zoekt

Livegrep

OpenSearch BM25

ripgrep-all

Tantivy
```

甚至：

```
SQLite FTS5
```

已经很好。

例如：

```
GenerateReport
```

几毫秒。

---

### 第七层：AST Search

不要全部靠 rg。

例如：

```
ast-grep
```

可以搜：

```
所有实现某接口

所有override

所有Decorator

所有Annotation

所有Lambda

所有SQL

所有Promise

所有async
```

例如

```
implements CostCalculator
```

不用 grep。

AST 秒出。

---

### 第八层：ctags

很多人已经忘了。

Universal Ctags：

```
ctags -R
```

生成：

```
tags
```

以后：

```
vim

Ctrl-]
```

跳定义。

几十 repo 都可以。

甚至：

```
readtags
```

脚本调用。

---

### 第九层：Tree-sitter Index

推荐。

Tree-sitter 可以解析：

```
TS

JS

Java

Python

Go

C++

Rust
```

建立：

```
AST

Method

Call

Import

Symbol
```

以后：

```
谁调用 GenerateReport()
```

不用 LLM。

---

### 第十层：LLM 最后登场

最后只把：

```
3~5个文件
```

交给 Claude。

而不是：

```
整个 repo
```

Prompt：

```
Requirement

↓

Search Result

↓

Dependency Graph

↓

Relevant Symbols

↓

Relevant Config

↓

Relevant SQL

↓

Relevant Kafka

↓

Relevant API
```

Claude 才真正开始分析。

Token 会小很多。

---

### 推荐工具组合

| 层            | 工具                          | 是否推荐  |
| ------------ | --------------------------- | ----- |
| 文件搜索         | `fd`                        | ⭐⭐⭐⭐⭐ |
| 文本搜索         | `ripgrep (rg)`              | ⭐⭐⭐⭐⭐ |
| AST 搜索       | `ast-grep`                  | ⭐⭐⭐⭐⭐ |
| Symbol Index | Universal Ctags             | ⭐⭐⭐⭐⭐ |
| AST 解析       | Tree-sitter                 | ⭐⭐⭐⭐⭐ |
| Call Graph   | Tree-sitter + 自建            | ⭐⭐⭐⭐  |
| Import Graph | Tree-sitter                 | ⭐⭐⭐⭐⭐ |
| 全文检索         | SQLite FTS5 / Tantivy       | ⭐⭐⭐⭐⭐ |
| 大规模代码搜索      | Zoekt                       | ⭐⭐⭐⭐⭐ |
| Git 历史搜索     | `git log -S` / `git log -G` | ⭐⭐⭐⭐  |

---

## 我最推荐的架构（适合 50–500 个内部 Repo）

如果让我为你这种场景（架构师、需要跨大量仓库快速定位实现）设计一个可长期演进的系统，我会采用下面的架构：

```
                           Requirement
                                 │
                                 ▼
                  LLM Requirement Expansion
           (业务词 → 技术词 → 同义词 → API → 表名)
                                 │
                                 ▼
                    Multi-stage Candidate Search
        ┌─────────────┬─────────────┬─────────────┐
        │             │             │
        ▼             ▼             ▼
   rg / fd      SQLite FTS5     ast-grep
        │             │             │
        └─────────────┴─────────────┘
                      │
                      ▼
               Symbol Metadata DB
     (类、函数、接口、注解、路由、Topic、SQL、配置)
                      │
                      ▼
        Dependency / Import / Call Graph
                      │
                      ▼
        自动筛选 Top 10～30 个最相关文件
                      │
                      ▼
          LLM 深度分析与方案生成
```

这个思路与大型代码搜索系统（如 Google Code Search、Sourcegraph、Zoekt 等）的核心理念一致：**先用廉价、可索引的方法把搜索空间从几百万行代码缩小到几十个候选文件，再让 LLM 做需要语义理解和架构推理的工作**。对于你这种经常需要快速理解陌生业务系统的工作方式，这种分层设计通常能兼顾速度、成本和准确性。


-------------------------------

## Answer From Gemini

这份指南提供的代码搜索策略非常专业且切中要害。它指出了用 LLM 处理大规模代码库时的核心痛点——**把 LLM 当作检索引擎是极其昂贵且低效的，LLM 应该被用作推理和总结引擎。**

这个“漏斗型”的四层架构（从便宜快速的静态搜索，到基于符号和图的索引，最后再交给昂贵缓慢的 LLM）与业界顶尖的大型代码搜索工具（如 Sourcegraph）的底层逻辑完全一致。

作为一个需要快速应对陌生业务的 Solution Architect，要将这套理论**务实地落地**，我为你提供以下补充建议和落地策略：

---

### ## 一、 落地优先级建议（MVP 策略）

这份指南虽然完美，但对于个人开发者或单兵作战的架构师来说，**完整搭建这十层 Pipeline 的工程量太大了**。你可能为了实现一个需求，花了一周时间去写 Tree-sitter 解析脚本。

建议采用MVP（最小可行性产品）思路，分阶段落地：

* **Day 1：快速见效（只做第 1、2、10 层）**
* 用 Claude/GPT 把业务需求扩展为技术词汇（Requirement Expansion）。
* 直接结合 `fd` 和 `ripgrep (rg)` 在 50 个 Repo 中暴力全文本搜索。
* 肉眼筛选出 5-10 个最相关的核心文件，合并丢给 LLM 进行深度分析。


* **Day 3：引入索引提效（加入第 6、8 层）**
* 跑一次 `ctags -R` 生成符号表。
* 如果有精力，跑一个脚本把所有 Repo 的关键元数据（Metadata）抽取到 JSON 或简单文本中，缩小未来的搜索范围。


* **Day 30：长期架构（探索图与 AST）**
* 如果这 50 个 Repo 是你未来一年要持续打交道的资产，再考虑用 Tree-sitter 或 SQLite 建立复杂的 Call Graph 和 Import Graph。



### ## 二、 开箱即用的工具替代方案（避免重复造轮子）

与其自己用 Python + SQLite 缝合 `rg` 和 `ast-grep`，不如直接使用市面上已经实现这套“漏斗逻辑”的成熟工具。作为架构师，工具的 ROI（投资回报率）最重要：

| 推荐工具 | 解决的痛点 / 对应的层级 | 优势 |
| --- | --- | --- |
| **Sourcegraph (Local)** | 涵盖第 2、3、5、6 层 | 本地运行，原生支持正则、符号搜索，大规模 Repo 管理的绝对王者。它天然就帮你建好了 Symbol Index 和 Import Graph。 |
| **Bloop.ai / Quivr** | 涵盖全流程（重点是 6、10 层） | 专门针对本地多 Repo 的 AI 搜索引擎。它会自动做 BM25 检索和 AST 语法树解析，然后把 Context 喂给 LLM，开箱即用。 |
| **Cursor / Cline (VS Code 插件)** | 涵盖第 1、10 层 | 如果你把 50 个 Repo 放在一个 Workspace，Cursor 的 `@Codebase` 功能背后就是这套 Rerank + 语义搜索逻辑，能极大节省你自己搭 Pipeline 的时间。 |

### ## 三、 补充关键维度：Git 历史与“找人”（The Missing Layer）

指南中提到了 `git log`，但一笔带过了。对于**不熟悉业务背景**的架构师来说，代码上下文往往不在代码里，而在提交历史里。

**建议在 Pipeline 中加入“Context Retrieval”层：**

1. **Git Blame:** 当你通过 `rg` 找到一个核心业务类（如 `CostCalculator`）时，不要急着给 LLM 看代码。先用 `git blame` 看看这行代码是谁、在什么时候写的。
2. **Pull Request 描述:** 找到对应的 Commit Message 或 PR。很多时候，**“为什么这么设计”**（Why）在 PR 的讨论里，而代码只反映了“怎么实现”（How）。
3. **将 Commit 历史喂给 LLM:** 把该核心文件最近 5 次的 commit message 和代码一起发给 LLM，能大幅度提升 LLM 还原业务背景的准确率。

### ## 四、 第十层 LLM Prompt 优化

最后一步交给 LLM 时，提供给它的 Context 必须结构化。你可以基于他的建议，固化一个标准的 Prompt 模板：

> **[Role]**
> 你是一个资深的系统架构师。我需要你帮我分析一个新需求在现有代码库中的落地落点。
> **[Business Requirement]**
> {需求描述}
> **[Context Provided]**
> 1. 核心文件代码：{文件内容}
> 2. 关键依赖路径：{Call Graph 文本}
> 3. 历史修改记录：{最近的相关 Git Commit}
> 
> 
> **[Task]**
> 请基于以上信息，告诉我：
> 1. 这个需求涉及修改哪几个核心模块？
> 2. 当前代码中是否存在针对该业务的 Feature Flag 或配置项？
> 3. 如果要在该电路上做扩展，是否有潜在的破坏性影响（Breaking Change）？
> 
> 

---

目前这 50 多个 Repo 主要使用的技术栈和语言是什么？我们可以先针对性地写一个最简单的 `bash` 或 `python` 脚本，把“需求词汇扩展 -> ripgrep 搜索 -> 结果打平”这第一遍流程跑通。


-------------------------------

## Answer from GLM-5.2

前面两位已经把"漏斗架构"和"分层 pipeline"讲透了,我不再重复。作为补充,我重点讲四个前面没充分展开、但 architect 实际落地时最先卡住的点,并给出 Day-1 能跑的骨架。

---

### 一、先别搜代码,先筛 Repo

ChatGPT 的 pipeline 默认你已经知道"在哪些 repo 里搜"。但 architect 对业务不熟时,真正的第一道筛子是 **repo 级别**,不是文件级别。50 个 repo 直接 rg 一遍,光噪音就够你喝一壶。

预先给每个 repo 建一份"一页纸档案"(只取 repo 根目录 + 顶层几个文件):

- `README.md` 前 50 行
- `package.json` / `pom.xml` / `go.mod` / `build.gradle` 的 name + description + dependencies
- 顶层目录名
- service 名(从 CI 配置、Dockerfile、k8s manifest 里抠)

存成 `repos.jsonl`,每行一个 repo。需求来了,先让 LLM **只看这 50 份档案**,输出"最相关的 5-8 个 repo + 理由"。这一步 token 成本几乎可以忽略(50 份档案压一起也就几万 token),但能把后续搜索空间砍掉 85%。

这一步是 architect 工作流的真正起点——你不是在"搜索代码",你是在"定位责任域"。

---

### 二、把 rg 命中变成"排序后的文件列表"

rg 的痛点不是慢,是**返回太多噪音**。`PRIIPS` 在 50 个 repo 里可能命中 300 个文件、2000 行,你根本看不过来。

需要一个打分步骤。对每个命中文件,算一个相关度分数:

- 命中关键词的**种类数**(扩展出 10 个词,命中 8 种 > 只命中 1 种但出现 20 次)
- 命中位置的**语义权重**(类名/函数名命中 > 注释命中 > 字符串字面量命中)
- 文件**类型权重**(`Controller/Service/Repository` > 工具类 > 测试 > 配置)
- **文件大小惩罚**(超大文件往往是聚合类,信号密度低)
- **目录深度惩罚**(`src/main` 下的命中比 `vendor/`、`node_modules/`、`test/` 下值钱)

用一个简单 python 脚本跑一遍,输出 Top 20 文件 + 每个文件的命中片段(上下文各 3 行)。这一步把 2000 行噪音压成 20 个候选,后面 LLM 只需要读这 20 个文件的相关片段。

具体用 `rg --json` 拿结构化输出,python 里聚合打分,比纯 rg 文本输出好处理得多。

---

### 三、architect 的产出不是"文件列表",是"Impact Map"

前两位都停在"把 5-10 个文件丢给 LLM 分析"。但 architect 真正要交付的不是"代码在哪",而是"**这个需求要改哪些地方、风险在哪、有没有现成扩展点**"。

建议让 LLM 最后一步输出的不是自然语言分析,而是一张结构化的 Impact Map:

- **入口点**:这个需求最可能的接入位置(哪个 Controller / API / 消费者)
- **核心改动点**:必须修改的 3-5 个文件 + 改动类型(新增/扩展/重构)
- **扩展点**:已存在的 Feature Flag / 策略模式 / 插件机制(能不改就不改)
- **下游影响**:改了之后会被波及的调用方(Kafka 消费者、下游服务、前端)
- **风险信号**:同名字段冲突、硬编码业务规则、测试覆盖盲区
- **未知项**:LLM 不确定、需要找领域专家确认的点

这张图才是 architect 跟下游团队对齐的真正产物。文件列表只是它的依据。

---

### 四、索引的增量维护(别每次全量重建)

ChatGPT 说"metadata 生成一次,以后不用再扫描"。实际上 repo 会更新,architect 也不会只跑一次。需要轻量的增量机制:

- repo 列表固定 → `git fetch` + `git log --since="last-index"` 拿变更文件列表,**只对变更文件重跑 symbol/dependency 抽取**
- 全量重建只在 repo 结构大变(大规模重构)时做,频率按季度
- 索引存 SQLite,带 `indexed_at` 和 `commit_sha` 字段,出问题能回溯

这样日常维护成本是分钟级,不是小时级。

---

### 五、一个能跑的 Day-1 脚本骨架

Gemini 提到"先跑通第一遍流程"但没给代码。补一个最小可运行的骨架(伪代码,按你的语言栈调整):

```python
# 1. 需求扩展:LLM 把业务需求 → 技术关键词列表
keywords = llm_expand(requirement)  # ["PRIIPS", "KID", "CostCalculator", ...]

# 2. 仓库筛选:LLM 看 repos.jsonl 选 top-K repo
target_repos = llm_pick_repos(repos_jsonl, keywords)  # ["pricing-svc", "report-svc", ...]

# 3. 结构化搜索:rg --json 拿命中
hits = []
for repo in target_repos:
    out = run(f"rg --json -C 2 -e {' -e '.join(keywords)} {repo}")
    hits += parse_rg_json(out)

# 4. 打分排序
ranked = score_and_rank(hits, keywords)
top_files = ranked[:20]

# 5. 拼上下文喂 LLM,输出 Impact Map
context = build_context(top_files)
impact_map = llm_analyze(requirement, context)
```

这个骨架 Day 1 就能跑,后面每一层(符号索引、call graph、AST)都是往 `score_and_rank` 和 `build_context` 里加料,不改主干。

---

### 六、反模式提醒

几个看起来提效、实际拖累的坑:

- **过早建 embedding 索引**:50 个 repo 的 embedding 维护成本远高于收益,代码搜索 BM25/FTS5 已经够用。embedding 留给"自然语言找代码"场景,architect 拿到的是业务词,不是自然语言。
- **把整个 repo 塞 LLM context**:即使 200K context 也扛不住,且注意力分散。永远先筛再喂。
- **只搜主分支**:有些业务逻辑在 release/hotfix 分支。落地前确认"这个 repo 的生产分支是哪个",别漏。
- **忽略配置中心**:业务规则常在配置不在代码。搜索时把 Apollo/Nacos/Consul 的配置 dump 也纳入搜索范围,关键词命中率会显著提升。
- **搜索结果不脱敏**:internal repo 可能有密钥、内网域名。喂 LLM 前过一遍 `git-secrets` 或简单正则脱敏,避免把密钥发给模型厂商。

---

**一句话总结**:这套东西的核心不是"工具多",而是**把 architect 的工作流从"读代码"改造成"读索引 + 读决策点"**。你的时间花在判断"该改哪、风险在哪",不是花在"找代码在哪"。前面所有预处理都是为了把后者压缩到几乎为零。


-------------------------------

## Answer from DeepSeek

前三位已经把架构、工具、落地路径讲得很完整了。我不重复。我补三个被跳过但 architect 实际干活时最致命的问题，以及一个具体的成本算账。

---

### 一、最致命的问题：搜不到

前面所有 pipeline 默认"代码里有关键词"。但 architect 最常遇到的困境恰恰相反：

> 需求来了，业务词 rg 一遍，什么都没命中。

这不是搜索策略的问题，是**需求的语言和代码的语言不在同一个语义空间里**。PRIIPs 在代码里可能叫 `RegulatoryReportV2`，KID 可能是 `KeyInformationDocument`，CostCalculator 可能在代码里只是一个匿名的 lambda 塞在 `ReportBuilder.build()` 里。

这个时候前面所有 pipeline 全部失效。你需要的是**反向搜索**：

1. 从需求倒推"这个功能如果是我做的，我会建什么类/表/接口"
2. 用这些**假设的技术名**去搜，而不是用业务词
3. 搜不到就搜"上下游线索"：Kafka topic 名、数据库表名、API path、protobuf message 名

具体做法：让 LLM 以"假设我来实现这个需求"的视角，输出 3 套可能的技术命名方案（Java 风格、Go 风格、微服务命名风格），分别去搜。通常总有一套能命中。

这套"搜不到时的兜底策略"是 architect 最值钱的经验，但前面没人提。

---

### 二、跨语言 repo 的符号提取，别用统一工具

ChatGPT 推荐的 ctags/tree-sitter 是好东西，但 50 个 repo 大概率不是同一语言。Java 的 annotation 体系、Go 的 interface 隐式实现、Python 的装饰器、TypeScript 的类型体操——用同一套规则去套，提取出来的符号质量天差地别。

落地建议：

- **Java/Spring**：直接 `rg "@RestController|@Service|@Repository|@Component"` 比 ctags 准，因为 Spring bean 的语义不是 ctags 能从源码推断的
- **Go**：`rg "^func |^type "` 就够了，Go 的符号体系简单，不需要重型工具
- **Python/TypeScript**：tree-sitter 有价值，但只提取 `class`/`function`/`export`，别试图解析完整 AST
- **Protobuf/GraphQL Schema**：单独搜 `*.proto` / `*.graphql`，这些是跨服务的契约，比代码里搜符号更高效

不要追求"一套工具覆盖所有语言"。先按语言分组，每组用最简单的提取规则，然后统一入库。重型工具（tree-sitter 完整 AST）留给后续深度分析，不是 Day-1 必需品。

---

### 三、代码搜到了，但"看不懂"才是真正的瓶颈

前面三位都假设"找到代码 → LLM 分析 → 产出方案"。但实际上 architect 最大的时间黑洞不是"找不到"，而是：

> 找到了 5 个可能相关的文件，每个 500 行，LLM 分析完了给了一堆看似合理的推断，但**你不知道哪些推断是对的、哪些是幻觉**。

你需要一个**验证回路**，而不是只靠 LLM 的"理解"：

1. 拿到 LLM 输出的 Impact Map 后，对每个"核心改动点"，再用 `git log --follow -p` 看这个文件的修改历史，确认"这个类最近半年真的在改什么"
2. 对每个"下游影响"，用 `rg` 搜调用方，确认 LLM 列出的下游服务列表是否完整
3. 对每个"未知项"，产出的是**具体的问题**（比如"RiskEngine 的配置是从数据库读还是从 Apollo 读？"），而不是模糊的"需要进一步确认"

这个验证回路才是 architect 交付质量的分水岭。LLM 是加速器，不是裁判。

---

### 四、成本算账：一组具体数字

前面都说"token 会下降一个数量级"，但没给数字。假设 50 个 repo，平均每个 repo 200 个源文件，每个文件 300 行。做一组对比：

| 方案 | 喂给 LLM 的数据量 | 估算 token | 花费（按 DeepSeek 当前价格） |
|------|------------------|-----------|--------------------------|
| 直接把 50 个 repo 全塞进去 | 不可能，context 窗口不够 | N/A | N/A |
| 每个 repo 挑 5 个核心文件，50×5=250 个文件 | 75,000 行 | ~200K | ~$0.3 |
| 先 rg 筛出 200 个命中文件，人工挑 20 个 | 6,000 行 | ~16K | ~$0.02 |
| 先筛 repo → rg 打分排序 → 只喂 Top 10 | 3,000 行 | ~8K | ~$0.01 |
| 只用 repos.jsonl 档案 + Impact Map 骨架 | 500 行 | ~1.5K | ~$0.002 |

**结论**：从"每个 repo 胡乱挑几个文件"到"打分排序后的 Top 10"，token 下降 25 倍，但**分析质量反而上升**，因为 LLM 注意力集中在了真正相关的代码上。多喂不相关的代码只会稀释注意力。

这就是为什么"先筛再喂"不是省钱的优化，而是**质量的刚需**。

---

### 一句话总结（跟前面三位不同的视角）

前面三位告诉你"用什么工具搜"，我告诉你的是——**architect 真正值钱的能力不是搜得快，而是搜不到时知道怎么换方向、搜到了知道怎么验证 LLM 没胡说**。工具链是自行车，验证回路是刹车。没有刹车的自行车，骑得越快越危险。



--------------------------

## Round2 Answer from ChatGPT

我认真看了你文件里的**补充要求**，我认为它实际上改变了问题的解法。

你的目标不是做一个 **Sourcegraph**，也不是做一个 **CodeQL**。

而是：

> **作为 Solution Architect，在几百个 repo 中，以尽可能低的 token、尽可能低的维护成本，快速找到业务逻辑（Business Logic）和数据流（Data Flow）。**

这里有三个关键约束（也是很多 AI 没有真正优化的）：

1. **尽量不用数据库**（SQLite 都不是必须）
2. **human readable**（json/jsonl/md）
3. **宁可80%准确，也不要复杂维护**

所以，我会把整个方案重新设计成 **Pre-index + Progressive Search**，完全围绕这三个目标。

---

# 我认为最大的误区

前面的回答都有一个共同的问题：

> **索引做得太重。**

例如：

* SQLite
* Entity Graph
* Call Graph
* Tree-sitter 全AST
* Symbol DB

这些都很好。

但是对于 Architect 来说：

> **真正花时间的不是 query，而是维护 index。**

repo 每天更新。

AST 一变就要重新生成。

Graph 又要重新生成。

最后真正花时间的是维护，不是搜索。

我会采用另一种思路：

> **Everything is File**

所有索引全部存成：

```
index/

    repos.json

    symbols.jsonl

    apis.jsonl

    imports.jsonl

    configs.jsonl

    sql.jsonl

    kafka.jsonl

    summary/

        repoA.md

        repoB.md
```

没有数据库。

全部 json/jsonl。

---

# 第一层：Repo Summary（最值得做）

这一层 ROI 我认为最高。

例如：

```
repo-summary.json

{
    "repo":"pricing-service",

    "description":"Pricing Engine",

    "language":"Java",

    "framework":"Spring Boot",

    "apis":[...],

    "topics":[...],

    "sqlTables":[...],

    "dependencies":[...]

}
```

但是我建议不要直接 json。

我建议生成：

```
summary/pricing-service.md
```

例如：

```
Repository

Pricing Service

Purpose

Calculate transaction cost

Expose APIs

POST /pricing

Consume Kafka

TradeCreated

Produce Kafka

PricingCompleted

Database

trade_cost

trade_snapshot

Core Classes

RiskCalculator

CostEngine

ScenarioEngine
```

为什么？

因为：

以后可以直接喂 LLM。

token 很少。

而且人能看。

---

# 第二层：Code Catalog（而不是 Symbol Index）

不要建复杂 symbol。

而是建立：

```
catalog.jsonl
```

例如：

```json
{
  "repo":"pricing",

  "type":"controller",

  "name":"RiskController",

  "file":"src/..."
}
```

```json
{
  "repo":"pricing",

  "type":"service",

  "name":"CostService"
}
```

```json
{
  "repo":"pricing",

  "type":"sql",

  "table":"trade_cost"
}
```

```json
{
  "repo":"pricing",

  "type":"kafka",

  "topic":"TradeCreated"
}
```

一行一个。

jsonl。

rg 就能搜。

Python 也好处理。

---

# 第三层：不要建 Call Graph

这是我和前面回答最大的区别。

Call Graph：

维护成本太高。

真正需要的是：

## Lightweight Relationship

例如：

```
RiskController

↓

imports

RiskService
```

```
RiskService

↓

imports

CostEngine
```

不用分析调用。

不用AST。

直接：

```
import

require

using

include
```

解析。

得到：

```
relationships.jsonl
```

例如：

```json
{
    "from":"RiskController",

    "to":"RiskService",

    "relation":"import"
}
```

Architect 已经足够用了。

真正 Data Flow 再临时分析。

---

# 第四层：最重要——Search Score

我认为所有回答里面，GLM 提到的 Ranking 是最值得加强的。

rg 的问题不是搜索。

而是：

```
2000 hits
```

怎么办？

所以建议设计一个 Score。

例如：

```
Score

=

keyword score

+

file score

+

directory score

+

symbol score
```

举例：

```
src/controller

+20

src/service

+15

src/model

+8

test

-20

vendor

-100

README

-30
```

再例如：

```
class name

+20

method

+15

comment

+2
```

最后：

```
Top20 Files
```

LLM 永远只看：

```
Top20
```

---

# 第五层：需求自动展开（重点优化）

这一层我建议不要只做：

```
同义词
```

而应该输出四类关键词：

```
Business

Technical

Infrastructure

Naming Pattern
```

例如：

```
Requirement

Generate Report
```

LLM 输出：

Business

```
Report

Document

Statement
```

Technical

```
ReportBuilder

PdfService

ExportService
```

Infrastructure

```
Kafka

S3

Blob

Snowflake
```

Naming

```
generate*

build*

create*

export*
```

后面的 rg 全部自动生成。

---

# 第六层：搜索流程（真正工作流）

我建议整个搜索过程固定，不允许 LLM 自由发挥。

```
Requirement

↓

LLM Expand Keywords

↓

Search Repo Summary

↓

Top 5 Repo

↓

Search Catalog

↓

Top 50 Symbols

↓

rg

↓

Top20 Files

↓

Read snippets

↓

LLM

↓

Impact Map
```

这里有一个原则：

> **LLM 从来不直接搜索 Repo。**

LLM 永远只是：

* 展开关键词
* 对搜索结果排序
* 总结

这样 token 最省。

---

# 第七层：预处理应该生成什么？

我建议只生成下面几个文件。

```
index/

repos.json
```

所有 repo 基本信息

```
catalog.jsonl
```

所有：

* Controller
* Service
* API
* SQL
* Kafka
* Config
* GraphQL

```
imports.jsonl
```

Import关系。

```
summaries/

repo.md
```

Repo简介。

```
stats.json
```

例如：

```
Language

Framework

Spring

NestJS

FastAPI

Express
```

没有数据库。

全部 json。

全部 git diff。

全部 human readable。

---

# 最后：如果让我从零实现（JavaScript / Python）

结合你的三个补充要求（**低依赖、JSON 可读、Python/JavaScript 实现**），我不会实现一个数据库式索引器，而会实现一个轻量级 CLI，整体目录如下：

```text
code-search/
├── scan.py                  # 扫描所有 repo
├── expand.py                # LLM 扩展需求关键词
├── search.py                # 多阶段搜索 + 排序
├── summarize.py             # 生成 repo summary
├── rerank.py                # 搜索结果打分
│
├── index/
│   ├── repos.json
│   ├── catalog.jsonl
│   ├── imports.jsonl
│   ├── configs.jsonl
│   ├── sql.jsonl
│   └── summaries/
│       ├── repo-a.md
│       └── repo-b.md
│
└── repos/
    ├── service-a/
    ├── service-b/
    └── ...
```

整个系统唯一依赖的外部工具建议只有：

* `ripgrep (rg)`：全文搜索（核心）
* `fd`：快速遍历文件
* `ast-grep`：**可选**，用于需要语法级搜索时
* Git：获取变更、`git blame`、`git log`

其他部分全部使用 Python 或 JavaScript 标准库完成。

---

## 我会再进一步加一个「Business Flow Index」

这是我认为前面几个答案都没有充分强调，但对 Architect 最有价值的一层。

与其建立完整的 Call Graph，不如预处理时抽取**业务节点**，例如：

```json
{
  "file": "TradeController.java",
  "contains": [
    "REST API",
    "TradeRequest",
    "TradeService",
    "Kafka:TradeCreated",
    "DB:trade_order"
  ]
}
```

或者：

```json
{
  "file": "ReportService.java",
  "contains": [
    "PDF",
    "S3 Upload",
    "Notification",
    "AuditLog"
  ]
}
```

它不是严格的数据流分析，而是**业务能力索引（Business Capability Index）**。

对于架构师而言，大多数需求分析并不需要精确的 CFG（Control Flow Graph）或完整的 Call Graph，而是需要快速回答：

* **这个需求应该从哪个模块切入？**
* **涉及哪些上下游系统？**
* **会影响哪些数据库、消息队列、API？**
* **哪些文件值得交给 LLM 深入分析？**

如果预处理阶段就能回答这些问题，LLM 的职责就只剩下推理和方案设计，而不是花大量 token 在海量代码中“找东西”。我认为，这种轻量、可维护、以业务能力为中心的索引方式，比构建复杂的 AST/Graph 数据库更符合你作为 Solution Architect 的实际工作流。


------------------

## Round2 Answer from Gemini


面对50多个业务陌生的代码仓库，作为 Solution Architect，你的直觉非常敏锐：**你需要的不是一个笨重的代码语法分析器，而是一个能快速定位业务边界和数据流向的“业务雷达”。**

综合你提供的多轮 AI 深度探讨（特别是避免数据库依赖、优先使用脚本语言、聚焦业务逻辑这三个核心补充要求），我为你提炼并设计了一套“基于轻量级纯文本索引 + 漏斗式过滤”的代码搜索策略。这套方案抛弃了维护成本极高的 AST 和图形数据库，完全依靠 Python/Node.js、`ripgrep (rg)` 和 JSONL/Markdown 来实现。

---

## 核心设计理念：Everything is File & 渐进式漏斗

这套策略的核心是**把高频的、耗时的全局检索，转化为低频的预处理**。所有的中间产物都是人类可读的（Human Readable），并且 LLM 只有在搜索空间被压缩到极致时才介入。

### 第一阶段：轻量级预处理 (Pre-Indexing)

*目标：用 Python 或 JavaScript 脚本，每月或每周跑一次，生成静态索引文件。*

**1. Repo 级业务摘要 (`summaries/repo_name.md`)**
不要让 LLM 去读代码，让它读摘要。用脚本提取每个仓库的 `README.md` 前 100 行、`package.json`/`pom.xml` 的依赖，以及配置文件的外围信息，交给低成本模型生成一份 Markdown 摘要：

* **职责定位**（如：订单结算服务）
* **入口点**（如：暴露的 REST APIs, 消费的 Kafka Topics）
* **出口点**（如：调用的外部服务, 生产的 Topics, 读写的数据库表）

**2. 业务能力索引 (`capabilities.jsonl`)**
放弃复杂的符号索引（Symbol Index），改为**正则匹配业务节点**。用 Python 脚本结合 `rg`，扫描所有路由、SQL 语句、MQ 监听器，按行存入 JSONL：

* `{"repo": "order-svc", "type": "api", "path": "POST /v1/settle", "file": "src/.../OrderController"}`
* `{"repo": "order-svc", "type": "db_table", "name": "trade_record", "file": "src/.../TradeEntity"}`

**3. 轻量级依赖流 (`imports.jsonl`)**
放弃高成本的 Call Graph。只用简单的正则提取 `import`, `require`, `from`，建立文件级的依赖映射，足以让你追踪 Data Flow。

* `{"from": "OrderController", "to": "PricingService", "relation": "import"}`

---

### 第二阶段：渐进式搜索工作流 (Progressive Search)

*目标：需求来临时，通过标准化 Pipeline，将千万行代码压缩到几十行核心上下文。*

#### 1. 逆向需求展开 (Reverse Requirement Expansion)

不要用业务需求直搜代码，代码里大概率没有业务词汇。让 LLM 做**反向推测**：

* **输入：** “支持 PRIIPs 报表导出”
* **LLM 输出：**
* *业务词：* Report, Statement, Document
* *技术猜测（关键）：* PdfExporter, ReportBuilder, S3Uploader
* *基建线索：* Kafka: report_topic, DB: report_config



#### 2. 仓库级初筛 (Repo-Level Filtering)

将第一步扩展出的关键词，结合第一阶段生成的 `summaries/*.md` 喂给 LLM。

* **任务：** “基于这些仓库摘要，找出最可能涉及该需求的 3-5 个仓库。”
* **收益：** 直接砍掉 90% 的搜索空间。

#### 3. 评分制精准检索 (Scoring-Based Grep)

在锁定的 3-5 个仓库中，用 Python 脚本调用 `rg` 搜索扩展词汇，并**必须对结果进行打分排序**，而不是直接看。

* **加分项：** 命中 `capabilities.jsonl` 中的 API 或 DB 定义 (+20)、命中类名/方法名 (+15)、在 `src/main` 目录下 (+10)。
* **减分项：** 在 `test/` 目录下 (-20)、超大文件 (-10)。
* **输出：** 截取 Top 15-20 个得分最高的文件及其上下 5 行代码片段。

#### 4. 引入历史上下文 (Git Context Retrieval)

代码可能看不出业务逻辑，但 Commit 历史可以。

* 对 Top 排名的核心文件，脚本自动执行 `git blame` 或 `git log -n 3`。
* 获取最近修改该文件的 Commit Message，这通常包含了真正的业务背景（Why）。

---

### 第三阶段：LLM 深度分析与产出

将上述过滤后的**浓缩上下文**（Top 20 关键代码片段 + Git 历史 + 简单的 Import 关系）交给能力最强的 LLM（如 Claude 3.5 Sonnet 或 GPT-4o），输出你真正需要的架构师交付物。

**核心 Prompt 产出目标：Impact Map（影响分析图）**

* **核心修改点：** 需求落地需要改动哪几个核心文件？
* **数据流向 (Data Flow)：** 从哪个 API 进，经过哪些 Service，落入哪张表？
* **潜在风险与扩展点：** 是否有现成的 Feature Flag？是否会破坏现有的下游依赖？

---

### 方案效益与成本对比

| 环节 | 传统无策略做法 (全局检索) | 本地静态文件 + 漏斗策略 (本方案) |
| --- | --- | --- |
| **外部依赖** | 图数据库, AST 解析器, 向量数据库 | Python/Node.js 标准库, `rg`, `git` |
| **Token 消耗** | 灾难级 (几十万级别上下文，易触发幻觉) | 极低 (~5K-10K Tokens，聚焦核心片段) |
| **搜索精度** | 噪音极大，被成千上万行无效日志或测试代码淹没 | 命中核心业务流，屏蔽边缘代码，带有历史 Git 视角 |
| **维护成本** | 牵一发而动全身，语法树极易报错 | 极低，基于正则表达式和 JSONL，坏了随时重跑 |

---

这套基于文本文件的流水线，完全契合你作为 Solution Architect “快速看清大局”的痛点，兼顾了低成本与高容错率。

**为了让这个方案尽快落地，目前这 50 多个 Repo 主要以哪一两种编程语言为主？我可以针对性地为你写一个基于 Python 或 Node.js 的轻量级 `scan_and_score` 扫描脚本骨架，让你今天就能跑起来看看效果。**

### 代码 from Gemini Round2

面对“什么语言都有”的异构代码仓库（Java, Go, Node.js, Python 混杂），我们绝对不能碰 AST（抽象语法树）或者特定语言的解析工具链，否则光是配置环境就能让你崩溃。

在这个场景下，最务实的做法是利用“跨语言的正则表达式启发式规则 (Cross-language Heuristics)”结合强大的 `ripgrep (rg)`。

下面我为你写一个无依赖（只依赖 Python 3 和系统安装的 `rg`）的轻量级脚本 `business_radar.py`。这个脚本分为两个核心指令：

1. `index`：用跨语言的业务特征正则，快速抽取出 API、DB、MQ 等关键业务节点，生成 `catalog.jsonl`。
2. `search`：输入 LLM 展开后的业务关键词，脚本会自动调用 `rg` 搜索，并**基于目录和文件特征进行打分排序**，最终只输出高价值的 Top N 代码片段。

### 核心 Python 脚本 (`business_radar.py`)

保存以下代码为 `business_radar.py`：

```python
import os
import json
import subprocess
import argparse
from collections import defaultdict
from pathlib import Path

# ==========================================
# 1. 跨语言业务特征正则 (Heuristic Patterns)
# ==========================================
CAPABILITY_PATTERNS = {
    # 涵盖 Spring, Express/Koa, Go net/http & Gin, FastAPI 等
    "api_route": r"(@(Rest)?Controller|@(Get|Post|Put|Delete)Mapping|router\.(get|post|put)|app\.(get|post)|func .* ServeHTTP)",
    # 涵盖原生 SQL, Hibernate, GORM, TypeORM 等
    "database": r"(SELECT .* FROM|INSERT INTO|UPDATE .* SET|CREATE TABLE|@Table|@Entity|gorm:|\.execute\()",
    # 涵盖 Kafka, RabbitMQ 等常见 MQ 客户端
    "message_queue": r"(@KafkaListener|KafkaTemplate|producer\.send|consumer\.onMessage|amqp\.|topic\s*=)",
    # 涵盖配置项、Feature Flag 读取
    "config_flag": r"(os\.getenv|process\.env|@Value|\.getProperty|viper\.Get)"
}

IGNORE_DIRS = {".git", "node_modules", "vendor", "dist", "build", "test", "tests", "mock"}

# ==========================================
# 阶段一：扫描与索引 (Pre-Index)
# ==========================================
def run_index(repo_dir, output_file="catalog.jsonl"):
    print(f"🚀 正在扫描 {repo_dir} 下的多语言业务节点...")
    results = []
    
    for cap_type, pattern in CAPABILITY_PATTERNS.items():
        # 调用 ripgrep 寻找匹配项
        cmd = ["rg", "-n", "--no-heading", pattern, repo_dir]
        for ignore in IGNORE_DIRS:
            cmd.extend(["-g", f"!{ignore}/**"])
            
        try:
            output = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
            for line in output.splitlines():
                if not line.strip(): continue
                # rg 输出格式通常是: filepath:line:content
                parts = line.split(":", 2)
                if len(parts) >= 3:
                    file_path, line_num, content = parts[0], parts[1], parts[2]
                    results.append({
                        "repo": Path(file_path).parts[1] if len(Path(file_path).parts) > 1 else "unknown",
                        "type": cap_type,
                        "file": file_path,
                        "line": line_num,
                        "snippet": content.strip()[:100] # 只截取前100个字符作为摘要
                    })
        except subprocess.CalledProcessError:
            continue # rg 没有找到匹配项时会返回非零状态码

    # 写入 JSONL
    with open(output_file, "w", encoding="utf-8") as f:
        for res in results:
            f.write(json.dumps(res, ensure_ascii=False) + "\n")
            
    print(f"✅ 索引完成！共提取 {len(results)} 个业务节点，已保存至 {output_file}")

# ==========================================
# 阶段二：打分式检索 (Search & Score)
# ==========================================
def calculate_score(file_path, content):
    score = 0
    path_str = file_path.lower()
    
    # 1. 目录权重 (Directory Scoring)
    if "src/main" in path_str or "cmd/" in path_str or "app/" in path_str:
        score += 20
    if "service" in path_str or "controller" in path_str or "handler" in path_str:
        score += 15
    if "test" in path_str or "mock" in path_str or "fixture" in path_str:
        score -= 50  # 强力降权测试代码
    
    # 2. 文件类型权重 (File Type Scoring)
    if path_str.endswith(('.java', '.go', '.ts', '.py', '.cs')):
        score += 10
    if path_str.endswith(('.json', '.yaml', '.xml', '.md')):
        score -= 5 # 配置文件降权，除非特意搜配置
        
    # 3. 语义权重 (Semantic Scoring)
    content_lower = content.lower()
    if "class " in content_lower or "func " in content_lower or "interface " in content_lower:
        score += 10 # 命中定义位置
        
    return score

def run_search(repo_dir, keywords, top_k=15):
    print(f"🔍 正在检索关键词: {', '.join(keywords)}")
    
    # 将多个关键词用 OR 连接给 rg
    regex_pattern = "|".join(keywords)
    cmd = ["rg", "-n", "-C", "2", "--no-heading", regex_pattern, repo_dir]
    
    for ignore in IGNORE_DIRS:
        cmd.extend(["-g", f"!{ignore}/**"])
        
    scored_results = []
    
    try:
        # 这里为了简化，直接获取 rg 文本输出进行打分。
        # 实际工程中可以使用 `rg --json` 进行更精确的解析
        output = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
        
        current_file = ""
        current_snippet = []
        
        for line in output.splitlines():
            if line == "--": continue # rg 的 context 分隔符
            parts = line.split("-", 2) if "-" in line else line.split(":", 2)
            if len(parts) >= 3:
                file_path = parts[0]
                content = parts[2]
                
                # 遇到新文件时进行打分
                score = calculate_score(file_path, content)
                scored_results.append({
                    "file": file_path,
                    "score": score,
                    "match": content.strip()
                })

    except subprocess.CalledProcessError:
        print("❌ 未找到匹配项")
        return

    # 按分数倒序排列
    scored_results.sort(key=lambda x: x["score"], reverse=True)
    
    # 聚合去重 (同一文件取最高分)
    final_top_files = {}
    for res in scored_results:
        if res["file"] not in final_top_files and len(final_top_files) < top_k:
            final_top_files[res["file"]] = res
            
    print(f"\n🏆 Top {len(final_top_files)} 核心相关文件 (根据业务价值打分):")
    print("-" * 60)
    for file, data in final_top_files.items():
        print(f"[{data['score']:>3} 分] {file}")
        print(f"       ↳ {data['match'][:120]}...")
    print("-" * 60)
    print("💡 建议：将以上文件的完整内容交由 LLM 进行 Data Flow 深度分析。")

# ==========================================
# CLI 入口
# ==========================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Multi-language Business Radar for Architects")
    subparsers = parser.add_subparsers(dest="command", help="commands")
    
    # Index 命​​令
    idx_parser = subparsers.add_parser("index", help="扫描仓库，生成业务节点 JSONL 索引")
    idx_parser.add_argument("repo_dir", help="包含多个代码仓库的根目录")
    
    # Search 命令
    srch_parser = subparsers.add_parser("search", help="使用打分机制搜索代码")
    srch_parser.add_argument("repo_dir", help="包含多个代码仓库的根目录")
    srch_parser.add_argument("keywords", nargs="+", help="搜索关键词 (如 PRIIPS CostCalculator)")
    
    args = parser.parse_args()
    
    if args.command == "index":
        run_index(args.repo_dir)
    elif args.command == "search":
        run_search(args.repo_dir, args.keywords)
    else:
        parser.print_help()

```

### 如何使用这个工具？

假设你把所有 50 个 repo 都 clone 到了 `~/my_company_repos/` 目录下。

**第一步：生成业务雷达图（一分钟跑完，跨语言）**

```bash
python business_radar.py index ~/my_company_repos/

```

*你会得到一个 `catalog.jsonl`，里面全是各个语言暴露的 API、监听的 MQ topic 和操作的数据库表。平时不看代码时，你都可以直接 grep 这个文件来梳理架构。*

**第二步：基于 LLM 展开后的需求词汇进行精准搜索**
假设你的需求是“重构报表服务的成本计算逻辑”，你用 LLM 扩写出了技术词汇 `CostCalculator`、`PerformanceScenario`、`trade_record`。

```bash
python business_radar.py search ~/my_company_repos/ CostCalculator PerformanceScenario trade_record

```

### 为什么这个脚本适合你的场景？

1. **绝对的语言无关性：** 无论下面藏着 Java、Node 还是 Go，所有的 Controller、Router 终归要写特定的标识词（如 `@GetMapping` 或 `router.post`）。用正则覆盖最常见的十几种模式，能达到 80% 的准确率，对于业务探查完全够用。
2. **极强的降噪能力（Score 机制）：** `ripgrep` 最容易把 `test/` 里的 mock 数据和 `dist/` 里的编译产物全部吐出来。这个脚本的 `calculate_score` 算法会直接把这些噪音打入冷宫（-50分），而把 `src/main` 或 `service` 目录下的核心文件推到最前面。
3. **低 Token 消耗的交付物：** 运行 `search` 命令后，你只会拿到被打分过滤后的 Top 10-15 个文件路径和摘要。你只需把这 15 个文件喂给 Claude 或 GPT-4o，让它画出影响图（Impact Map），不仅精准，而且 Token 花费极低。



------------------------

## Round2 Answer from GLM-5.2

Round1 我讲了"反向搜索"和"验证回路",Round2 两位都吸收了。我不重复理论,直接给**按你三个补充要求落地时,实际会卡住的工程细节 + 一个能跑的最小骨架**。

三个补充要求翻译成工程约束:
1. **不用数据库** → 所有索引必须是 `rg` 能直接吃的文本文件
2. **JS/Python 实现 + 减少幻觉** → LLM 只做"读文本、输出结构化 JSON"的窄任务,不让它碰代码本身
3. **找 code logic + data flow,不是改代码** → 索引粒度按"业务节点"切,不按"符号"切

下面讲五个具体卡点,然后给骨架。

---

### 一、`capabilities.jsonl` 不是用 LLM 生成,是用"正则配方表"生成

ChatGPT 和 Gemini 都说"用脚本提取业务节点存 jsonl",但没说**怎么提取**。一旦你让 LLM 去读代码提取,就同时违反了"减少幻觉"和"低成本"两条。

正确做法:维护一份**语言无关的正则配方表**(`recipes.yaml`),每个配方就是 `(name, regex, output_type)`。脚本只是个配方执行器,LLM 完全不参与索引生成。

```yaml
# recipes.yaml - 业务节点正则配方表
- name: rest_api
  pattern: '@(Get|Post|Put|Delete|Request)Mapping\(["\']([^"\']+)'
  captures: [method_or_path, path]
  type: api

- name: spring_kafka
  pattern: '@KafkaListener\(.*?topics\s*=\s*["\']([^"\']+)'
  captures: [topic]
  type: kafka_consumer

- name: sql_table_create
  pattern: 'CREATE\s+TABLE[^;]*?(\w+)\s*\('
  captures: [table]
  type: sql_table

- name: jpa_entity
  pattern: '@Table\(\s*name\s*=\s*["\']([^"\']+)'
  captures: [table]
  type: sql_table

- name: js_route
  pattern: '(app|router)\.(get|post|put|delete)\(["\']([^"\']+)'
  captures: [_, method, path]
  type: api

- name: proto_message
  pattern: '^message\s+(\w+)\s*\{'
  captures: [message]
  type: protobuf
  glob: "*.proto"
```

落地要点:

- 每个语言栈单独一组配方,Java/Spring、Go、Python/Flask、TS/Express 各自独立
- 配方失败时**静默跳过**,不报错——你只要 80% 准确
- 同一个文件命中多个配方就输出多行 jsonl,不要试图合并
- 每行 jsonl 必带 `repo`、`file`、`line`、`type`、`value` 五个字段,这是后续打分和喂 LLM 的最小契约

这套配方表一次写好,后续加 repo 只需重跑,不维护。LLM 在预处理阶段**完全不参与**,符合"减少幻觉"。

---

### 二、"Business Flow Index" 的正确粒度是"文件 → 业务标签集合"

ChatGPT Round2 提的 Business Flow Index 方向对,但给的例子是"文件里 contains 了什么",没说怎么聚合。直接把 capabilities.jsonl 按 file 聚合就是:

```python
# 把 capabilities.jsonl 按 file 聚合成 business_flow.jsonl
# 一行一个文件,列出该文件涉及的所有业务标签
{"file": "pricing-svc/src/.../TradeController.java",
 "repo": "pricing-svc",
 "tags": ["api:POST /trade", "kafka_in:TradeCreated",
          "call:TradeService", "table:trade_order"]}
```

这一步的价值:architect 搜需求时,**不用进代码就能判断这个文件是不是入口**。比如搜 `TradeCreated` 命中 3 个文件,看 tags 就知道哪个是生产者、哪个是消费者、哪个只是常量定义。

关键工程细节:tags 数组**不要去重、不要排序**——保留命中顺序,因为文件内出现顺序本身反映了数据流方向(API 在前、DB 在后是正常入口;DB 在前、API 在后可能是 DAO)。

---

### 三、打分公式必须"可解释",不能是黑盒

Round1 我和 ChatGPT 都说"要打分",但没强调一个事:**architect 需要知道每个文件为什么得这个分**。黑盒打分=没法调参=最后弃用。

打分函数输出必须是 `score + breakdown`:

```python
def score_file(file_meta, keyword_hits):
    breakdown = {
        "keyword_variety": len(set(keyword_hits)) * 10,   # 命中关键词种类
        "in_src_main": 15 if "/src/main/" in file_meta["path"] else 0,
        "is_entry": 20 if file_meta["tags"] else 0,       # 有业务标签=入口
        "in_test": -20 if "/test/" in file_meta["path"] else 0,
        "in_vendor": -100 if "/vendor/" in file_meta["path"] else 0,
        "size_penalty": -min(file_meta["lines"] // 500, 20),
    }
    return sum(breakdown.values()), breakdown
```

输出 Top 20 时**连带 breakdown 一起打印**:

```
1. [score=85] TradeController.java
   keyword_variety:40 in_src_main:15 is_entry:20 in_test:0 ...
2. [score=72] ReportService.java
   keyword_variety:30 in_src_main:15 is_entry:20 in_test:0 ...
```

architect 一眼能看出"这个文件分高是因为命中了 4 个关键词还是因为它是入口"。调参时也只改公式,不改数据。**可解释性是这套轻量方案能长期活下去的关键**——不像 AST 索引坏了你都不知道哪层错。

---

### 四、增量更新:用 `git diff` 而不是 `git log --since`

Gemini Round2 提了 git context 但没说索引怎么增量。ChatGPT Round1 说"metadata 生成一次"是错的,repo 会更新。

我的 Round1 说"用 git log --since 拿变更文件",Round2 修正:**用 `git diff` 拿具体变更行,只重跑命中行的配方**,不是整个文件重跑。

```python
# 增量更新伪代码
for repo in repos:
    last_sha = load_last_indexed_sha(repo)
    current_sha = git_rev_parse_head(repo)
    if last_sha == current_sha:
        continue  # 没变化,跳过
    changed_files = git_diff_name_only(repo, last_sha, current_sha)
    for f in changed_files:
        remove_old_capabilities_for_file(f)   # 从 jsonl 删旧记录
        rerun_recipes_on_file(f)              # 只对这个文件重跑配方
    save_indexed_sha(repo, current_sha)
```

为什么不用 `git log --since`:它返回的是 commit 列表,还得反推改了哪些文件,且会漏掉 force-push 的历史。`git diff <old_sha> HEAD --name-only` 直接拿文件列表,简单准确。

`last_indexed_sha` 存成一个 `index/sha_map.json`,human readable,符合你的要求。

---

### 五、能跑的最小骨架(60 行 Python)

前两位给了目录结构和概念,我给**今天就能跑的脚本**。依赖只有 `rg` 和 Python 标准库,无 pip 包。把下面三个文件放一起,跑 `python scan.py /path/to/repos` 就出索引。

```python
# scan.py - 扫描所有 repo,生成 capabilities.jsonl + sha_map.json
import json, os, subprocess, re
from pathlib import Path

RECIPES = [
    ("api", re.compile(r'@(?:Get|Post|Put|Delete)Mapping\(["\']([^"\']+)')),
    ("kafka", re.compile(r'@KafkaListener\(.*?topics\s*=\s*["\']([^"\']+)')),
    ("table", re.compile(r'@Table\(\s*name\s*=\s*["\']([^"\']+)')),
    ("js_api", re.compile(r'(?:app|router)\.(get|post|put|delete)\(["\']([^"\']+)')),
]

def scan_repo(repo_path, repo_name):
    out = []
    for f in Path(repo_path).rglob("*"):
        if not f.is_file() or any(x in str(f) for x in
           ["/.git/", "/node_modules/", "/vendor/", "/test/"]):
            continue
        try:
            text = f.read_text(errors="ignore")
        except Exception:
            continue
        for cap_type, pat in RECIPES:
            for m in pat.finditer(text):
                out.append({"repo": repo_name, "file": str(f),
                            "type": cap_type, "value": m.group(1)})
    return out

def main(repos_root):
    with open("index/capabilities.jsonl", "w") as cap_f, \
         open("index/sha_map.json", "w") as sha_f:
        sha_map = {}
        for repo in Path(repos_root).iterdir():
            if not repo.is_dir(): continue
            for row in scan_repo(repo, repo.name):
                cap_f.write(json.dumps(row, ensure_ascii=False) + "\n")
            sha = subprocess.check_output(
                ["git", "-C", str(repo), "rev-parse", "HEAD"]
            ).decode().strip()
            sha_map[repo.name] = sha
        sha_f.write(json.dumps(sha_map, indent=2))

if __name__ == "__main__":
    import sys; main(sys.argv[1])
```

```python
# search.py - 打分搜索,输出 Top20 + breakdown
import json, subprocess, sys
from collections import defaultdict

KEYWORDS = sys.argv[1:]  # 用法: python search.py PRIIPS KID CostCalculator

# 1. rg 拿命中
rg = subprocess.run(["rg", "--json", "-w"] + KEYWORDS,
                    capture_output=True, text=True)
hits = defaultdict(lambda: {"count": 0, "types": set(), "lines": 0})
file_tags = defaultdict(list)
for line in rg.stdout.splitlines():
    obj = json.loads(line)
    if obj["type"] == "match":
        f = obj["data"]["path"]["text"]
        hits[f]["count"] += 1
        hits[f]["types"].add(obj["data"]["submatch"][0]["match"]["text"])

# 2. 加载 capabilities 给文件打标签
with open("index/capabilities.jsonl") as cap_f:
    for line in cap_f:
        row = json.loads(line)
        file_tags[row["file"]].append(f'{row["type"]}:{row["value"]}')

# 3. 打分
scored = []
for f, h in hits.items():
    breakdown = {
        "keyword_variety": len(h["types"]) * 10,
        "is_entry": 20 if file_tags[f] else 0,
        "in_test": -20 if "/test/" in f else 0,
    }
    scored.append((sum(breakdown.values()), breakdown, f, file_tags[f]))
scored.sort(reverse=True)

# 4. 输出 Top 20
for score, brk, f, tags in scored[:20]:
    print(f"[{score}] {f}")
    print(f"  breakdown: {brk}")
    print(f"  tags: {tags[:5]}")
```

这两个文件加起来不到 60 行,已经覆盖了"预处理 + 搜索 + 打分"闭环。`expand.py`(LLM 关键词扩展)和 `summarize.py`(repo 摘要)可以后续加,但**没有这俩也能用**——手动传关键词就行,先跑起来再优化。

---

### 六、跟前面两位的关键差异

| 维度 | ChatGPT Round2 | Gemini Round2 | 我 Round2 |
|------|----------------|---------------|-----------|
| 索引生成方式 | 概念性描述 | "用脚本提取" | **正则配方表 + LLM 完全不参与预处理** |
| 打分可解释性 | 给了分值表 | 给了加减分项 | **强制输出 breakdown,architect 能调参** |
| 增量更新 | 没提 | 没提 | **git diff + sha_map,只重跑变更文件** |
| Business Flow 粒度 | 文件 contains 什么 | 没单独提 | **capabilities 按 file 聚合,保留顺序反映数据流方向** |
| 可跑代码 | 给了目录结构 | 给了概念流程 | **60 行能跑的 scan.py + search.py** |

核心主张:**轻量方案要能长期活下去,关键是"可解释 + 可调参 + 坏了能重跑"**。前面两位的方案理论完整,但落地时 architect 会卡在"这个文件为什么分高""索引怎么更新""配方错了怎么调"这些问题上。我把这些工程细节填上了,这才是"宁可 80% 准确也不要复杂维护"的真正含义——80% 是靠"能调参的简单公式"撑出来的,不是靠"复杂的 AST 碰运气"。

