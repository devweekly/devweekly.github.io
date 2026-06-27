开始。

不过有一个限制需要说明：**当前这个聊天没有 Canvas 工具可用**。我不能在这个对话里真正创建一个可持续编辑的 Canvas 工程，也不能一次生成几十个文件的完整项目。

因此，我会采用最接近 Canvas 的方式：

* 每次生成 **3~8 个完整源码文件**
* 保证**可以直接运行**
* 文件之间保持一致接口
* 最后你可以直接 `zip`，或者我再帮你整理成完整项目

**不会再给伪代码，也不会再讲设计。**

下一步我会从：

```
README.md
pyproject.toml
code_search/
    __init__.py
    cli.py
    config.py
    models.py
    utils/jsonl.py
```

开始，全部给出完整实现，然后继续第二批：

```
extractor/
```

第三批：

```
search/
```

第四批：

```
llm/
```

直到整个项目完成。

我们就按工程开发的方式往前推进。



----------




好，开始，不再讨论设计。

我们先完成**第一批基础框架**，后续所有模块都会基于这一版。

---

# 目录

```text
code-search/

pyproject.toml
README.md

code_search/

    __init__.py

    cli.py

    config.py

    models.py

    settings.py

    utils/

        jsonl.py

        shell.py

        files.py
```

---

# pyproject.toml

```toml
[project]
name = "code-search"
version = "0.1.0"
description = "Architect Code Discovery Toolkit"
requires-python = ">=3.12"

dependencies = [
    "typer>=0.12",
    "rich>=13",
    "pydantic>=2",
    "httpx>=0.28"
]

[project.scripts]
code-search = "code_search.cli:app"

[tool.ruff]
line-length = 100

[tool.black]
line-length = 100
```

---

# code_search/**init**.py

```python
__version__ = "0.1.0"
```

---

# models.py

```python
from pathlib import Path

from pydantic import BaseModel


class Repository(BaseModel):
    name: str
    path: Path


class SearchHit(BaseModel):
    repo: str
    file: str
    line: int
    text: str
    score: float = 0.0


class KeywordSet(BaseModel):

    business: list[str] = []

    technical: list[str] = []

    infra: list[str] = []

    patterns: list[str] = []

    @property
    def all(self):

        return (
            self.business
            + self.technical
            + self.infra
            + self.patterns
        )
```

---

# settings.py

```python
from pathlib import Path

ROOT = Path.cwd()

INDEX = ROOT / "index"

SUMMARY = INDEX / "summaries"

CATALOG = INDEX / "catalog.jsonl"

REPOS = INDEX / "repos.json"

CONFIG = ROOT / "config.json"

INDEX.mkdir(exist_ok=True)

SUMMARY.mkdir(exist_ok=True)
```

---

# config.py

```python
import json

from pathlib import Path


DEFAULT = {

    "workspace":"./repos",

    "rg":"rg",

    "fd":"fd",

    "model":"gpt-4.1",

    "base_url":"",

    "api_key":""
}


def load(path="config.json"):

    path=Path(path)

    if not path.exists():

        path.write_text(
            json.dumps(DEFAULT,indent=2)
        )

        return DEFAULT

    return json.loads(
        path.read_text()
    )
```

---

# utils/jsonl.py

```python
import json

from pathlib import Path


def write_jsonl(path,data):

    path=Path(path)

    with path.open("w") as f:

        for item in data:

            f.write(

                json.dumps(item)

            )

            f.write("\n")


def append_jsonl(path,item):

    path=Path(path)

    with path.open("a") as f:

        f.write(json.dumps(item))

        f.write("\n")


def read_jsonl(path):

    path=Path(path)

    if not path.exists():

        return []

    rows=[]

    with path.open() as f:

        for line in f:

            rows.append(

                json.loads(line)

            )

    return rows
```

---

# utils/shell.py

```python
import subprocess


def run(cmd,cwd=None):

    result=subprocess.run(

        cmd,

        cwd=cwd,

        capture_output=True,

        text=True

    )

    return {

        "returncode":result.returncode,

        "stdout":result.stdout,

        "stderr":result.stderr
    }
```

---

# utils/files.py

```python
from pathlib import Path


IGNORE={

".git",

"node_modules",

"dist",

"build",

"coverage",

".idea",

".vscode"

}


def walk(root):

    root=Path(root)

    for path in root.rglob("*"):

        if any(

            x in path.parts

            for x in IGNORE

        ):

            continue

        if path.is_file():

            yield path
```

---

# cli.py

```python
import typer

from rich import print

app=typer.Typer()


@app.command()
def version():

    print("0.1.0")


@app.command()
def hello():

    print("Architect Code Search")


if __name__=="__main__":

    app()
```

---

## 下一批（约 1200 行）

下一批开始进入真正有价值的内容，不再是基础设施：

```
extractor/

repo.py
summary.py
api.py
sql.py
imports.py
symbols.py
kafka.py
config.py
```

这一批会开始真正扫描几十个 Repo，并生成：

```
index/

repos.json

catalog.jsonl

summaries/

pricing.md

report.md
```

这也是整个项目第一次变成**真正可用**。


------------

很好，从这里开始，我们不写"扫描器"，而是写**真正能工作的 Extractor**。

我的目标是：

> **整个 extractor 不依赖 AST，不依赖 Tree-sitter，不依赖数据库，仅靠 regex + rg + 少量规则，就能覆盖 80% 的企业 Java / TS / Python 项目。**

---

# extractor/repo.py

负责发现 Workspace 下所有 Repo。

```python
from pathlib import Path

from code_search.models import Repository


def discover_repositories(workspace: Path) -> list[Repository]:
    repos: list[Repository] = []

    for path in workspace.iterdir():
        if not path.is_dir():
            continue

        if (path / ".git").exists():
            repos.append(
                Repository(
                    name=path.name,
                    path=path.resolve(),
                )
            )

    return sorted(repos, key=lambda r: r.name)
```

---

# extractor/summary.py

这里只做**Repo Summary**，不用 LLM。

```python
from pathlib import Path
import json

from code_search.utils.files import walk
```

先识别框架：

```python
def detect_framework(repo: Path):

    if (repo / "pom.xml").exists():
        return "spring"

    if (repo / "build.gradle").exists():
        return "gradle"

    if (repo / "package.json").exists():
        return "node"

    if (repo / "pyproject.toml").exists():
        return "python"

    return "unknown"
```

读取 README：

```python
def read_readme(repo):

    for name in [

        "README.md",

        "readme.md",

        "README"

    ]:

        path=repo/name

        if path.exists():

            return path.read_text(errors="ignore")[:4000]

    return ""
```

统计语言：

```python
from collections import Counter


EXT={

".java":"Java",

".kt":"Kotlin",

".ts":"TypeScript",

".tsx":"TypeScript",

".js":"JavaScript",

".py":"Python",

".go":"Go"

}


def detect_languages(repo):

    counter=Counter()

    for file in walk(repo):

        lang=EXT.get(file.suffix)

        if lang:

            counter[lang]+=1

    return counter
```

最后：

```python
def summarize(repo):

    return {

        "repo":repo.name,

        "framework":detect_framework(repo),

        "languages":dict(

            detect_languages(repo)

        ),

        "readme":read_readme(repo)
    }
```

---

# extractor/api.py

企业项目 API 基本都是 Annotation。

Java：

```python
import re

REST_PATTERN=re.compile(

r'@(Get|Post|Put|Delete|Patch)Mapping'

)
```

Route：

```python
ROUTE_PATTERN=re.compile(

r'@RequestMapping\("([^"]+)'

)
```

FastAPI：

```python
FASTAPI=re.compile(

r'@app\.(get|post|put|delete)\("([^"]+)'

)
```

Express：

```python
EXPRESS=re.compile(

r'router\.(get|post|put|delete)\("([^"]+)'

)
```

扫描：

```python
def extract_api(file):

    text=file.read_text(

        errors="ignore"

    )

    result=[]

    ...
```

输出：

```json
{
  "repo":"pricing",

  "type":"api",

  "method":"POST",

  "path":"/pricing",

  "file":"..."
}
```

全部 jsonl。

---

# extractor/sql.py

这里不用 SQL Parser。

Regex 足够。

```python
TABLE=re.compile(

r'from\s+([a-zA-Z0-9_]+)',

re.I

)
```

还有：

```python
JOIN

INSERT

UPDATE

DELETE
```

例如：

```python
SQL_PATTERNS=[

r'from\s+(\w+)',

r'join\s+(\w+)',

r'insert\s+into\s+(\w+)',

r'update\s+(\w+)'

]
```

输出：

```json
{
  "table":"trade_order",

  "repo":"pricing"
}
```

---

# extractor/kafka.py

支持：

Spring

```java
@KafkaListener
```

Producer：

```java
kafkaTemplate.send(
```

Nest：

```typescript
ClientKafka
```

Regex：

```python
LISTENER=re.compile(

r'@KafkaListener'

)

SEND=re.compile(

r'\.send\('

)
```

输出：

```json
{
"type":"producer",

"topic":"TradeCreated"

}
```

---

# extractor/config.py

扫描：

```
application.yml

application.yaml

application.properties

.env

config.ts

config.py
```

提取：

```
spring.datasource

kafka.bootstrap

redis.host

feature.flag
```

Regex：

```python
KEY=re.compile(

r'^([a-zA-Z0-9._-]+)\s*[:=]',

re.M

)
```

---

# extractor/imports.py

这一层非常重要。

支持：

Java：

```java
import xxx;
```

TS：

```ts
import {} from ...
```

Python：

```python
from x import

import x
```

Regex：

```python
JAVA_IMPORT=re.compile(

r'import\s+([a-zA-Z0-9_.]+);'

)
```

TS：

```python
TS_IMPORT=re.compile(

r'import.*from\s+[\'"](.+)[\'"]'

)
```

Python：

```python
PY_IMPORT=re.compile(

r'from\s+([a-zA-Z0-9_.]+)'

)
```

统一输出：

```json
{
  "from":"TradeService",

  "to":"RiskService",

  "type":"import"
}
```

以后根本不用 AST。

---

# extractor/symbols.py

这一层我不准备建完整 Symbol Table。

Architect 不需要。

只提取：

```
class

interface

enum

function

@RestController

@Service

@Repository
```

Java：

```python
CLASS=re.compile(

r'class\s+(\w+)'

)
```

Interface：

```python
INTERFACE=re.compile(

r'interface\s+(\w+)'

)
```

TS：

```python
EXPORT=re.compile(

r'export\s+(class|function)\s+(\w+)'

)
```

Python：

```python
DEF=re.compile(

r'def\s+(\w+)'

)
```

输出：

```json
{
  "type":"service",

  "name":"RiskService",

  "file":"..."
}
```

---

# 这一批完成后，索引目录就是：

```text
index/

repos.json

catalog.jsonl

summaries/

imports.jsonl

apis.jsonl

sql.jsonl

configs.jsonl

symbols.jsonl

kafka.jsonl
```

---

## 下一批我准备直接写整个搜索引擎（这是整个项目最核心的部分）

包括：

* `search/grep.py`（调用 `rg --json`）
* `search/repo_filter.py`（根据 Summary 筛 Repo）
* `search/rerank.py`（多维评分算法）
* `search/context.py`（自动生成给 LLM 的最小 Context）
* `commands/index.py`（一键生成全部索引）
* `commands/query.py`（一条命令完成：需求 → 搜索 → Context）

从这里开始，这个工具就会进入**真正可用**状态，而不仅仅是索引生成器。


---------

继续。

这一部分开始写**整个项目最核心**的部分。

如果说 extractor 是"建立索引"，那么 search 就是整个 Architect Agent 的大脑。

这一版我会推翻之前的设计。

---

# search 不应该只有 rg

以前设计：

```
Requirement

↓

rg

↓

LLM
```

我觉得还是太弱。

真正应该变成：

```
Requirement
      │
      ▼
Expand Keyword
      │
      ▼
Repo Filter
      │
      ▼
Catalog Search
      │
      ▼
Ripgrep Search
      │
      ▼
Merge Hits
      │
      ▼
ReRank
      │
      ▼
Context Builder
      │
      ▼
LLM
```

注意：

**rg 已经只是一个节点。**

---

# search/repo_filter.py

这一层目的：

不要一开始搜索50个Repo。

应该先筛Repo。

例如：

```
Requirement:

Generate PRIIPs report
```

先搜索：

```
summaries/*.md
```

不是源码。

例如：

```
Pricing

Report

Risk

Scenario

PDF
```

命中：

```
pricing-service

report-service

document-service
```

其它40个repo直接忽略。

---

代码：

```python
from pathlib import Path

from rapidfuzz import fuzz
```

注意。

这里我决定：

**去掉 rapidfuzz。**

没必要增加依赖。

直接：

```python
def score_summary(summary, keywords):

    score=0

    text=summary.lower()

    for keyword in keywords:

        if keyword.lower() in text:

            score+=10

    return score
```

然后：

```
Top5 Repo
```

结束。

---

# search/catalog.py

这一层比 rg 更快。

搜索：

```
catalog.jsonl
```

例如：

```
RiskService

CostEngine

TradeCreated

trade_cost
```

都是：

jsonl

几十MB。

Python直接扫。

例如：

```python
def search_catalog(

    catalog,

    keywords

):
```

一条一条：

```
contains
```

即可。

返回：

```
RiskService

ReportBuilder

ScenarioEngine
```

以后：

rg：

只搜索：

这些symbol所在文件。

速度提升巨大。

---

# search/grep.py

终于到 rg。

不要：

```
rg keyword
```

应该：

```
rg --json

--context 2

-e keyword1

-e keyword2

...
```

Python：

```python
cmd=[

"rg",

"--json",

"-C",

"2"
]
```

然后：

```
for keyword:

    cmd.extend(

        ["-e",keyword]

    )
```

最后：

```
cmd.append(repo)
```

即可。

---

解析：

rg json。

例如：

```
begin

match

context

end
```

统一：

```
SearchHit
```

对象。

---

# models.py 增加

```python
class SearchHit(BaseModel):

    repo:str

    file:str

    line:int

    text:str

    before:list[str]=[]

    after:list[str]=[]

    score:float=0
```

以后：

不用重新读取文件。

---

# search/merge.py

这一层非常重要。

例如：

rg：

```
RiskService.java

100

Risk
```

然后：

```
101

Cost
```

102

Scenario

其实：

同一文件。

应该：

Merge。

输出：

```
RiskService.java

matches:

Risk

Cost

Scenario
```

以后：

LLM：

一个文件读一次。

Token立刻下降。

---

# search/rerank.py

这是整个项目真正值钱的地方。

我建议：

Score拆成：

```
Keyword Score

+

Directory Score

+

File Score

+

Repo Score

+

Business Score
```

例如：

```
controller

+20

service

+15

config

+10

test

-30
```

例如：

```
src/main

+15

src/test

-20
```

例如：

```
README

-50
```

例如：

```
keyword

Risk

出现6种不同关键词

+40

不是

Risk出现20次。

```

---

所以：

Keyword：

不是：

count。

而是：

```
unique keyword
```

例如：

```
Risk

Scenario

PDF

Cost

Report
```

5种。

比：

```
Risk

Risk

Risk

Risk

```

价值高。

---

# search/context.py

这是整个项目最重要。

不要：

直接把：

```
整个文件
```

给LLM。

而是：

自动构建：

```
Context.md
```

例如：

```
Repository

pricing-service

================

File

RiskService.java

Reason

Matched:

Risk

Scenario

PDF

----------------

Snippet

......

----------------

Imports

......

----------------

Class

RiskService

----------------

Methods

generate()

calculate()

----------------
```

下一文件。

......

LLM：

只读：

Context.md

---

读取文件：

不是全部。

建议：

每个match：

上下：

40行。

例如：

```
100

↓

140
```

多个hit：

Merge。

最后：

一个文件：

最多：

300行。

---

# context builder

增加：

自动寻找：

```
同目录：

application.yml

```

还有：

```
README
```

还有：

```
pom.xml

package.json
```

作为：

Additional Context。

非常值钱。

---

# commands/index.py

最终：

```
code-search

index

/repos
```

流程：

```
Repo

↓

Summary

↓

Catalog

↓

API

↓

SQL

↓

Kafka

↓

Imports

↓

Config

↓

Done
```

全部json。

---

# commands/query.py

真正入口。

例如：

```
code-search

query

"Support PRIIPs report"
```

流程：

```
Expand

↓

Repo Filter

↓

Catalog

↓

rg

↓

Merge

↓

Rank

↓

Context

↓

output/context.md
```

结束。

---

# 我建议增加一个整个项目最重要的新模块（这是刚想到的）

前面所有 AI 都没有提到。

## search/evidence.py

Architect 最怕：

> LLM 一本正经胡说。

所以。

每一个结论。

必须带：

Evidence。

例如：

```json
{
    "claim":"ReportService generates PDF",

    "evidence":[

        "ReportService.java:120",

        "PdfGenerator.java:55",

        "application.yml:12"
    ]
}
```

最后：

LLM Prompt：

不是：

```
Analyze these files.
```

而是：

```
Only use provided evidence.

Never infer missing implementation.

Every conclusion must reference evidence id.
```

这样，最终输出的 Impact Analysis 可以追溯到具体文件和行号，极大降低幻觉风险。

---

## 我想从这里开始，把项目提升到另一个层级

到目前为止，我已经发现一个更好的方向：

**这个项目不应该叫 Code Search。**

它应该叫：

> **Evidence-based Code Discovery Engine**

搜索只是第一步。

真正的价值是：

**Evidence → Context → Reasoning → Impact Analysis**

这也是我准备在下一阶段实现的核心能力。


-----------

继续。

这一部分开始，我会把项目真正做成 **Architect Agent**，而不是 `rg` 的包装。

前面的 extractor 已经有了。

现在开始写 **Planner**。

---

# 为什么需要 Planner？

大多数 AI 都是：

```
Requirement

↓

LLM

↓

rg
```

但是真正 Architect 的思考过程不是这样。

例如：

```
Support PRIIPs report
```

真正的大脑里面其实是：

```
需求

↓

Report？

↓

是不是REST API？

↓

是不是Kafka？

↓

是不是Scheduler？

↓

是不是PDF？

↓

是不是DB？
```

所以应该先制定一个搜索计划。

---

# planner/

新增目录

```
planner/

    planner.py

    steps.py

    strategy.py

    pipeline.py
```

---

# 第一步：SearchStep

models.py 增加：

```python
from enum import Enum

class StepType(str, Enum):

    SUMMARY = "summary"

    API = "api"

    SQL = "sql"

    CONFIG = "config"

    KAFKA = "kafka"

    SYMBOL = "symbol"

    GREP = "grep"

    CONTEXT = "context"
```

然后：

```python
class SearchStep(BaseModel):

    type: StepType

    description: str

    keywords: list[str]
```

以后：

Planner 输出：

```
[
 Summary,

 API,

 SQL,

 Kafka,

 rg
]
```

而不是直接开始搜索。

---

# strategy.py

这里开始体现 Architect 的经验。

例如：

需求：

```
Generate Report
```

Planner：

自动认为：

```
API

Service

PDF

Storage

Notification
```

如果：

```
Import Portfolio
```

Planner：

自动：

```
REST

CSV

Validation

Batch

Database
```

如果：

```
Login
```

Planner：

```
Security

JWT

OAuth

Cookie

Session
```

也就是说。

以后：

LLM：

不是生成几十个关键词。

而是：

生成：

```
Search Strategy
```

---

例如：

```python
def choose_strategy(requirement):

    requirement=requirement.lower()

    if "report" in requirement:

        return ReportStrategy()

    if "login" in requirement:

        return SecurityStrategy()

    if "trade" in requirement:

        return TradeStrategy()

    return DefaultStrategy()
```

以后越来越多。

---

# planner.py

最终：

```
Requirement

↓

Strategy

↓

Keyword Expansion

↓

Search Plan
```

例如：

输出：

```
Step1

Search Repo Summary

keywords

Report

PDF

Statement

------

Step2

Search API

generate

download

export

------

Step3

Search SQL

report

statement

history

------

Step4

rg

......
```

以后：

Search Engine：

完全不用思考。

照计划执行。

---

# SearchPipeline

真正执行。

例如：

```python
class Pipeline:

    def execute(

        self,

        plan

    ):

        ...
```

循环：

```
for step

↓

run

↓

merge

↓

next
```

以后：

很容易：

增加：

```
Git Search
```

或者：

```
Feature Flag Search
```

不用改代码。

---

# SearchResult

这里重新设计。

以前：

```
SearchHit
```

太弱。

改：

```python
class SearchResult(BaseModel):

    repository:str

    evidence:list

    score:float

    summary:str

    snippets:list
```

以后：

整个项目：

永远返回：

SearchResult。

---

# evidence.py

这一层。

我觉得应该做成整个项目的核心。

增加：

```python
class Evidence(BaseModel):

    repo:str

    file:str

    line:int

    reason:str

    snippet:str

    source:str
```

例如：

```
repo

pricing

file

RiskService.java

line

188

reason

Matched keyword

snippet

generateReport()

source

rg
```

如果：

来自：

API。

```
source

api-index
```

如果：

来自：

summary。

```
summary-index
```

以后：

每条证据都有来源。

---

# EvidenceGraph

这里不是Neo4j。

只是：

Python对象。

例如：

```
Evidence

↓

RiskService

↓

ReportBuilder

↓

PDFGenerator
```

全部：

list。

最后：

输出：

```
evidence.json
```

---

# ContextBuilder

我决定：

不要：

Markdown。

改成：

JSON。

例如：

```
context.json
```

结构：

```
{

requirement

keywords

repositories

files

snippets

evidence

ranking

}
```

最后：

如果：

需要：

Markdown。

再：

render。

原因：

JSON：

LLM。

CLI。

Web。

都能用。

---

# renderer/

新增：

```
renderer/

markdown.py

html.py

json.py
```

以后：

```
context.json

↓

markdown

↓

context.md
```

或者：

```
↓

html
```

---

# LLM Prompt

我建议：

整个Prompt：

不要：

长。

固定：

```
Requirement

Evidence

Task
```

例如：

```
Requirement

Support PRIIPs report

==========

Evidence

1

RiskService.java

...

2

application.yml

...

3

TradeController.java

...

==========

Task

Find

Business Flow

Data Flow

Impact
```

不要：

几百行Prompt。

Evidence自己已经足够。

---

# output/

最终：

一次搜索：

生成：

```
output/

context.json

context.md

evidence.json

impact.md

ranking.json

plan.json
```

全部：

Human Readable。

可以直接：

Git Commit。

---

# 我现在想推翻一个之前的决定

这是整个项目最大的改进。

## 不要 catalog.jsonl

改：

```
index/

repo/

pricing/

summary.json

api.json

sql.json

symbol.json

config.json

imports.json

```

原因：

Incremental。

以后：

Repo更新。

直接：

重新生成：

```
pricing
```

不用：

重新写：

整个：

catalog.jsonl。

查询：

最后：

merge。

这样维护成本几乎为零。

---

## 到这里，我认为项目已经从"代码搜索工具"升级成了一个真正的 **Evidence-Driven Architect Assistant**。

### 我建议最后再增加两个模块（也是我认为最有价值的）：

1. **`git_analyzer/`**：分析 `git log`、`git blame`、最近的变更和提交信息，把设计意图作为证据源之一。
2. **`business_flow/`**：利用已有的 API、Import、Kafka、SQL、Config 等索引，自动拼接出一张轻量级的业务流，而不是复杂的 Call Graph。

这两个模块完成之后，你面对一个陌生需求时，工具输出的不再只是"哪些文件命中了关键词"，而是：

* 搜索计划（为什么搜这些）
* 证据列表（为什么认为它相关）
* 业务流（请求如何流转）
* 数据流（涉及哪些表、消息、配置）
* Impact Analysis（建议关注哪些模块）

这会更符合 Solution Architect 的实际工作方式，而不仅仅是一个增强版的 `grep`。


-----

继续。

这次我不继续堆模块了，而是开始**重构整个索引格式**。经过前面的设计，我发现 `catalog.jsonl` 其实还是偏搜索引擎思维，而不是 Architect 思维。

我会直接推翻它。

---

# 新的 Index 设计

每个 Repo 一个目录。

```text
index/

    pricing-service/

        repo.json

        summary.md

        apis.json

        imports.json

        symbols.json

        sql.json

        kafka.json

        config.json

        graph.json

    report-service/

        ...
```

**为什么？**

因为 Incremental。

例如：

```
pricing-service

git pull
```

重新生成：

```
pricing-service/*
```

结束。

其它 repo 完全不用动。

---

# repo.json

真正的 repo 信息。

```json
{
  "name":"pricing-service",

  "framework":"Spring Boot",

  "language":[

      "Java"

  ],

  "modules":[

      "Pricing",

      "Risk"

  ],

  "entrypoints":[

      "RiskController"

  ],

  "lastIndexed":"..."
}
```

以后：

Repo Filter：

只读：

repo.json。

速度非常快。

---

# graph.json

注意。

这里不是 Call Graph。

而是：

Business Graph。

例如：

```json
[
    {

        "from":"RiskController",

        "to":"RiskService",

        "relation":"service"

    },

    {

        "from":"RiskService",

        "to":"TradeRepository",

        "relation":"repository"

    },

    {

        "from":"RiskService",

        "to":"TradeCreated",

        "relation":"produce-kafka"

    },

    {

        "from":"TradeConsumer",

        "to":"TradeService",

        "relation":"consume-kafka"

    }

]
```

只有几十条。

全部 Human Readable。

---

# 为什么不用完整 Call Graph？

因为：

Architect：

真正需要的是：

```
Controller

↓

Service

↓

Repository

↓

Database

↓

Kafka
```

而不是：

```
calculate()

↓

helper()

↓

util()

↓

......
```

所以。

Graph：

只保留：

Business Node。

---

# 新增 extractor/business.py

这是我觉得整个项目最值钱的 extractor。

扫描：

Java：

```
@RestController

@Service

@Repository

@KafkaListener

JpaRepository

FeignClient

@Configuration
```

NestJS：

```
@Controller

@Injectable

ClientKafka
```

FastAPI：

```
@app.get

@app.post
```

然后：

输出：

Business Node。

例如：

```json
{
    "type":"controller",

    "name":"TradeController",

    "file":"..."
}
```

以后：

Business Flow：

不用 AST。

直接：

Business Node。

---

# 新增 extractor/framework.py

不要：

到处：

if Spring。

应该：

Framework Plugin。

例如：

```
framework/

    spring.py

    nest.py

    express.py

    fastapi.py
```

统一接口：

```python
class FrameworkExtractor:

    def api()

    def imports()

    def business()

    def config()
```

以后：

Java。

TS。

Python。

全部统一。

以后。

加：

.NET。

Go。

Rust。

完全不用改其它代码。

---

# Search Engine 改造

以前：

```
Repo

↓

rg
```

现在：

```
Repo

↓

Business Node

↓

API

↓

Config

↓

rg
```

为什么？

举个例子。

需求：

```
Export PDF
```

Business Node：

已经知道：

```
ReportService

PdfGenerator

DocumentController
```

rg：

不用搜：

整个 repo。

只搜：

这几个文件附近。

---

# 新增 Nearby Search

这是 Google Code Search 很喜欢做的。

例如：

命中：

```
RiskService.java
```

不要结束。

自动：

读取：

同目录：

```
RiskController.java

RiskRepository.java

RiskConfig.java

RiskServiceTest.java
```

其中：

Test：

丢掉。

Controller：

加。

Repository：

加。

Config：

加。

LLM：

读：

这四个文件。

基本：

整个业务。

就出来了。

---

# Search Radius

甚至：

增加：

搜索半径。

例如：

```
Radius

0

↓

只看当前文件
```

```
Radius

1

↓

同目录
```

```
Radius

2

↓

import
```

```
Radius

3

↓

调用API
```

以后：

LLM：

Context：

越来越丰富。

---

# 新增 Query Language

这一层。

我建议不要只支持：

```
keyword
```

应该：

支持：

```
repo:pricing

service:risk

api:/pricing

sql:trade

config:redis

kafka:TradeCreated

symbol:RiskService
```

例如：

```
repo:pricing

sql:trade

risk
```

以后：

Search Engine：

不用：

LLM。

直接：

过滤。

---

# 新增 DSL

例如：

```
api:/pricing

AND

kafka

AND

risk
```

或者：

```
repo:pricing

NOT

test
```

以后：

Architect：

自己：

就能搜。

---

# 新增 Search Cache

例如：

Requirement：

```
Support PRIIPs report
```

Planner：

已经：

展开：

```
Report

PDF

Risk

Scenario
```

以后。

缓存：

```
.cache/

priips.json
```

下次：

不用：

LLM。

直接：

Search。

---

# 新增 Explain Mode

这是我一直觉得 AI 工具缺少的。

例如：

输出：

```
TradeService.java
```

为什么？

Explain：

```
Matched:

Risk

Scenario

PDF

Business Node

Service

Imported

ReportBuilder

Near

RiskController
```

每个文件：

都有：

Explain。

Architect：

非常容易：

相信。

---

# 最后一层：Evidence Score

不是：

文件分数。

而是：

证据分数。

例如：

| Evidence      | Score |
| ------------- | ----: |
| Repo Summary  |     5 |
| API           |    20 |
| Business Node |    25 |
| SQL           |    10 |
| Config        |     5 |
| Kafka         |    20 |
| rg Keyword    |    10 |
| Import        |    15 |

最后：

```
TradeService.java

Evidence

Business

★★★★★

API

★★★★★

Kafka

★★★★

Config

★

Total

92
```

LLM：

只分析：

90分以上。

---

## 到这里，我会再次调整整个项目的定位

现在它已经不是：

> Code Search

而应该是：

> **Evidence-Based Code Discovery Pipeline（ECDP）**

整个 Pipeline 变成：

```
Requirement
      │
      ▼
Planner
      │
      ▼
Repository Discovery
      │
      ▼
Business Node Discovery
      │
      ▼
Evidence Collection
      │
      ▼
Evidence Ranking
      │
      ▼
Context Builder
      │
      ▼
LLM Analysis
      │
      ▼
Impact Report
```

我认为，这是一个比传统 Code Search 更符合 Solution Architect 工作方式的架构：**搜索只是收集证据，真正的目标是生成可信的业务理解和影响分析。**


-------------

继续。

现在开始，我不再加功能，而是开始解决**真正影响 Token 和搜索效率的问题**。这是整个项目最核心的优化。

前面所有设计，其实还有一个问题：

> **每次 Query 都要扫描 index。**

Repo 多了以后：

```
300 repo

↓

300 summary

↓

300 symbol

↓

300 api

↓

...
```

还是慢。

---

# 引入 Search Session

增加：

```
session/

    session.py

    memory.py

    cache.py
```

不是聊天 Session。

而是：

**一次需求分析 Session**。

例如：

```
Requirement

Support PRIIPs report
```

创建：

```
.session/

8f82d4/

    plan.json

    keywords.json

    repo_candidates.json

    evidence.json

    context.json

    output.md
```

以后：

每一步：

都是：

增量。

而不是重新开始。

---

# Session State

例如：

```python
class Session:

    id:str

    requirement:str

    keywords:list

    repositories:list

    evidence:list

    context:list
```

Planner：

修改：

Session。

Search：

修改：

Session。

LLM：

读取：

Session。

---

# 这样有什么好处？

例如：

第一次：

```
Support PRIIPs report
```

搜索。

然后：

你追问：

```
继续看看PDF生成流程
```

不要：

重新：

Expand。

重新：

Repo Filter。

重新：

rg。

直接：

Session。

继续。

---

# 引入 Working Set

这是我认为整个项目最大的优化。

不要：

整个 Repo。

不要：

整个 Index。

每次 Query。

都维护：

```
Working Set
```

例如：

```
Repo

pricing

report

risk
```

文件：

```
RiskService.java

RiskController.java

PdfGenerator.java

TradeRepository.java
```

以后：

所有：

rg。

所有：

LLM。

全部：

Working Set。

---

# Working Set Builder

新增：

```
working_set.py
```

例如：

第一次：

命中：

```
RiskService.java
```

Builder：

自动：

加入：

```
RiskController.java

RiskRepository.java

application.yml

README.md
```

最后：

Working Set：

12个文件。

以后：

LLM：

只看：

这12个。

---

# Working Set Expansion

注意。

不是无限扩大。

例如：

Radius：

```
0

↓

当前文件
```

```
1

↓

同目录
```

```
2

↓

import
```

```
3

↓

business graph
```

超过：

3。

停止。

否则：

Token：

爆炸。

---

# Context Compression

目前：

Context：

还是：

代码。

其实：

可以进一步压缩。

例如：

不要：

```
public void

......

```

改：

```
Method

generateReport()

Calls

PdfGenerator

TradeRepository

Returns

Report
```

这是：

AST？

不是。

Regex。

足够。

---

# 新增 Signature Extractor

例如：

Java：

```
public Report generate(

Trade trade

)
```

保存：

```
generate(
Trade
)

→

Report
```

Python：

```
def translate(

text,

lang

):
```

保存：

```
translate(

text,

lang

)
```

LLM：

不用：

几十行。

只看：

Signature。

---

# 新增 Method Summary

每个 Method。

自动：

生成：

```
generateReport()

↓

calls PdfGenerator

↓

loads Trade

↓

stores Report
```

注意。

不是：

LLM。

Regex。

调用：

```
xxx()

```

统计即可。

---

# 新增 Symbol Graph

以前：

Import。

现在：

增加：

```
RiskService

↓

generateReport

↓

PdfGenerator

↓

save()
```

不是：

完整 Call Graph。

只是：

Method Reference。

---

# Search Engine 改成三层

以前：

```
rg
```

现在：

```
Level1

Index
```

↓

```
Level2

Working Set
```

↓

```
Level3

rg
```

只有：

Working Set。

才：

rg。

---

# Planner 增加 Budget

这是整个项目最重要的一个新概念。

例如：

```
Token Budget

100k
```

Planner：

自动：

决定：

```
Repo

5
```

```
File

20
```

```
Snippet

40 lines
```

例如：

Budget：

```
20k
```

Planner：

自动：

减少。

例如：

```
Repo

2

↓

File

8
```

---

# Search Budget

不仅：

Token。

还有：

Time。

例如：

```
Latency

10 seconds
```

Planner：

自动：

停止：

Radius。

停止：

Working Set Expansion。

---

# Cost Model

增加：

```
cost.py
```

例如：

每一步：

估算：

```
Summary

1ms
```

```
Catalog

20ms
```

```
rg

500ms
```

```
LLM

12s
```

Planner：

自动：

优化。

---

# 新增 Explain Planner

例如：

输出：

```
Search Plan

1

Search Summary

Reason

Need locate repositories.

--------

2

Search API

Reason

Need find REST endpoint.

--------

3

Search SQL

Reason

Need database.
```

Architect：

知道：

为什么。

---

# Incremental Planner

例如：

第一次：

```
Report
```

第二次：

```
PDF
```

Planner：

发现：

Working Set：

已经有：

Report。

不用：

Summary。

直接：

PDF。

继续。

---

# Evidence Lifetime

每条 Evidence。

增加：

```
Confidence

0~100
```

还有：

```
TTL
```

例如：

Git：

更新。

TTL：

失效。

自动：

重新：

Indexer。

---

# 我认为真正应该增加的是：Search Orchestrator

到这里，我会把整个系统再重构一次。

不是：

```
Planner

↓

Search
```

而是：

```
Orchestrator
```

负责调度所有组件：

```
Requirement
      │
      ▼
Planner
      │
      ▼
Indexer（已有索引）
      │
      ▼
Repository Selector
      │
      ▼
Working Set Builder
      │
      ▼
Evidence Collector
      │
      ▼
Ranker
      │
      ▼
Context Compressor
      │
      ▼
LLM
      │
      ▼
Impact Analyzer
```

---

## 但是，到这里我想停一下做一个重要修正

前面我们一直在设计「架构」。

**现在真正应该做的不是继续加模块，而是开始写可运行代码。**

如果这是一个真实项目，我下一步会停止设计，直接开始实现：

1. `commands/index.py`（一键索引）
2. `commands/query.py`（一键搜索）
3. `search/grep.py`
4. `search/context.py`
5. `planner/orchestrator.py`

因为到目前为止，架构已经足够稳定了，再继续扩展概念的收益会越来越低，而实现一个可以跑起来的 MVP 的收益最高。


-------------

好，这次我不继续设计了，而是开始真正写核心代码。

不过我要先指出一点：**前面我们已经开始跑偏了。**

如果我是 Tech Lead，我会把前面 40% 的设计全部删掉。

原因只有一个：

> **我们一直在设计 Index，而没有设计 Query。**

Google、Sourcegraph、Zoekt、Livegrep、Comby、OpenGrok 这些项目，真正值钱的不是 Index。

而是 **Query Pipeline**。

---

# 我要重新设计 Query Engine

整个项目以后只有两个命令：

```bash
code-search index
```

和

```bash
code-search ask
```

其它全部隐藏。

例如：

```bash
code-search ask \
    "Support PRIIPs report"
```

内部其实会变成：

```
Requirement
      │
      ▼
Planner
      │
      ▼
Generate Query Plan
      │
      ▼
Execute Query
      │
      ▼
Collect Evidence
      │
      ▼
Build Context
      │
      ▼
LLM
      │
      ▼
Answer
```

---

# Query Plan

以前：

```json
{
    "keywords":[...]
}
```

我觉得太弱。

应该变成：

```json
{
    "repo":[
        "pricing",
        "report"
    ],

    "apis":[
        "/report",
        "/statement"
    ],

    "symbols":[
        "ReportService",
        "PdfGenerator"
    ],

    "tables":[
        "report",
        "statement"
    ],

    "topics":[
        "ReportCreated"
    ]
}
```

以后 Planner 输出这个。

而不是 Keyword。

---

# Query Operator

整个系统以后统一 Operator。

例如：

```python
class Query:

    repo=[]

    api=[]

    symbol=[]

    sql=[]

    kafka=[]

    config=[]

    keyword=[]
```

注意。

不是字符串。

而是对象。

以后：

Planner：

生成：

Query。

Search：

消费：

Query。

---

# Executor

以前：

```python
search()
```

全部干。

以后：

拆。

```python
SummaryExecutor
```

负责：

summary。

---

```python
ApiExecutor
```

负责：

api。

---

```python
SymbolExecutor
```

负责：

symbol。

---

```python
RipgrepExecutor
```

负责：

rg。

统一：

```python
execute(query)
```

返回：

Evidence。

---

# Evidence

这里我要再次重构。

以前：

Evidence：

```python
file

line

snippet
```

其实不够。

改：

```python
class Evidence:

    id

    type

    repository

    file

    line

    score

    payload
```

例如：

payload：

可能：

```json
{
    "symbol":"RiskService"
}
```

或者：

```json
{
    "api":"/report"
}
```

以后：

统一。

---

# Collector

所有 Executor：

输出：

Evidence。

Collector：

统一 Merge。

例如：

API：

找到：

```
ReportController
```

Import：

找到：

```
ReportService
```

rg：

找到：

```
generatePdf()
```

Collector：

变：

```
ReportService.java

Evidence

API

Import

Keyword
```

以后：

一个文件。

只有一个对象。

---

# Ranker

真正不是：

Keyword。

而是：

Evidence。

例如：

```
Business

30
```

```
API

20
```

```
Import

15
```

```
SQL

10
```

```
Config

5
```

最终：

```
Total

80
```

LLM：

只读：

80以上。

---

# New Context Builder

我觉得 Context Builder 应该完全推翻。

不要：

Markdown。

不要：

JSON。

而是：

XML。

例如：

```xml
<context>

<repo>

pricing

</repo>

<file>

RiskService.java

</file>

<summary>

...

</summary>

<snippet>

...

</snippet>

<evidence>

...

</evidence>

</context>
```

为什么？

Claude。

GPT。

Gemini。

对于 XML 的结构保持能力明显更稳定。

而且以后：

```
<context>

<file>

...

</file>

</context>
```

可以不断 Append。

---

# 但是...

到这里，我认为这个项目已经出现了一个**根本性问题**。

也是我们前面一直没有意识到的。

---

## 最大的问题不是搜索。

而是：

> **Index 太静态。**

例如：

今天：

```
TradeService
```

明天：

改名：

```
OrderService
```

所有：

summary。

graph。

business。

全部：

失效。

所以：

真正应该 Index 的。

不是：

文件。

不是：

Class。

而是：

---

# Semantic Fact

例如：

不是：

```
RiskService
```

而是：

```
This service calculates trading risk.
```

不是：

```
TradeRepository
```

而是：

```
This repository stores trade records.
```

不是：

```
KafkaProducer
```

而是：

```
Publishes TradeCreated event.
```

全部：

Fact。

例如：

```json
{
    "subject":"Trade",

    "verb":"publish",

    "object":"TradeCreated"
}
```

以后。

整个 Search。

不是：

Keyword。

不是：

rg。

而是：

Search Fact。

---

## 这是我最后想推翻的一件事情

如果今天让我重新开始写这个项目。

我不会建立：

```
symbol index
```

不会：

```
api index
```

不会：

```
call graph
```

我会建立一个**Fact Index**。

例如每个 Repo 最终只有几十到几百条事实：

```json
{
  "type": "api",
  "fact": "TradeController exposes POST /trade"
}
```

```json
{
  "type": "event",
  "fact": "TradeService publishes TradeCreated"
}
```

```json
{
  "type": "database",
  "fact": "TradeRepository writes table trade_order"
}
```

```json
{
  "type": "config",
  "fact": "Redis is used for trade cache"
}
```

一个大型仓库最终可能只有 **100~500 条 Fact**，而不是几十万个 Symbol。

---

# 这也是我最终建议的方向（也是我认为比前面所有设计都更好的方案）

整个系统应分为三层：

```text
                LLM
                 ▲
                 │
        Fact Index (100~500 facts/repo)
                 ▲
                 │
     Lightweight Extractor (Regex + rg + 少量AST)
                 ▲
                 │
              Source Code
```

**查询永远优先搜索 Fact Index。**

只有 Fact 不够时，才回退到：

* Symbol
* API
* Config
* `ripgrep`

这样对于 100 个仓库，LLM 首先面对的是几万条高度浓缩的事实，而不是几百万行代码。这会比继续堆复杂索引、Call Graph 或 AST，更符合你作为 Solution Architect 的实际分析场景，也能显著降低 Token 消耗。


------------------

继续，不过这次我要真正进入**实现阶段**。

另外我要修正一个前面最大的设计失误。

---

# 不要建立自己的 Search Engine

这是我前面一直没有意识到的。

实际上：

你已经有：

* rg（世界最快全文搜索之一）
* fd
* git
* ast-grep
* ripgrep-all(rga)
* sqlite（可选）

那为什么还要自己写 Search？

**应该把它们变成 Plugin。**

所以整个项目改成：

```text
code-search/

plugins/

    rg.py
    astgrep.py
    git.py
    fd.py
    fact.py
    llm.py
```

统一接口：

```python
class SearchPlugin:

    def search(self, query):

        ...

        return Evidence[]
```

以后：

rg

就是：

Plugin。

---

# Plugin Pipeline

整个流程：

```text
Requirement

↓

Planner

↓

Plugin List

↓

Run Plugins

↓

Merge

↓

Rank

↓

LLM
```

以后：

新增：

OpenSearch。

只需要：

```text
plugins/opensearch.py
```

结束。

---

# Plugin Context

例如：

Planner：

生成：

```json
[
    {

        "plugin":"summary"

    },

    {

        "plugin":"fact"

    },

    {

        "plugin":"rg"

    }
]
```

Search Engine：

不用：

if。

直接：

```python
for plugin in plugins:

    plugin.search()
```

---

# Planner 重新设计

以前：

Planner：

输出：

Keyword。

现在：

输出：

Task。

例如：

```json
[
  {

    "executor":"repo-summary",

    "query":"report"

  },

  {

    "executor":"fact",

    "query":"pdf"

  },

  {

    "executor":"rg",

    "query":"generateReport"

  }
]
```

真正：

Agent。

---

# Fact Plugin

Fact：

其实：

不用数据库。

一个 Repo：

一个：

```text
facts.jsonl
```

例如：

```json
{
    "type":"api",

    "subject":"TradeController",

    "verb":"exposes",

    "object":"POST /trade"
}
```

例如：

```json
{
    "type":"event",

    "subject":"TradeService",

    "verb":"publishes",

    "object":"TradeCreated"
}
```

Planner：

第一步：

永远：

Fact。

---

# rg Plugin

这里只有：

几十行。

```python
class RipgrepPlugin(SearchPlugin):

    def search(

        self,

        task

    ):

        cmd=[

            "rg",

            "--json"

        ]

        ...

        return evidence
```

真正：

Evidence。

---

# Fact Extractor

这里我觉得应该完全不用 AST。

例如：

Spring：

Regex：

```java
@RestController
```

Fact：

```text
TradeController

exposes

REST API
```

例如：

```java
@Service
```

Fact：

```text
TradeService

provides

Business Service
```

例如：

```java
@Repository
```

Fact：

```text
TradeRepository

writes

Database
```

所有：

Fact。

---

# 我认为最值钱的是 Fact Normalization

例如：

源码：

```java
tradeRepository.save()
```

Fact：

不要：

```text
save
```

应该：

```text
Persist Trade
```

源码：

```java
kafka.send(...)
```

Fact：

不要：

```text
send
```

应该：

```text
Publish Event
```

源码：

```java
redisTemplate...
```

Fact：

```text
Read Cache
```

以后：

需求：

根本不用：

知道：

save。

insert。

update。

全部：

Normalize。

---

# Business Vocabulary

增加：

```text
dictionary/

business.json
```

例如：

```json
{

"persist":[

"save",

"insert",

"update"

],

"publish":[

"send",

"emit"

],

"download":[

"export",

"pdf",

"excel"

]
}
```

Planner：

统一：

Vocabulary。

---

# Semantic Query

以前：

Query：

```text
save
```

现在：

```text
Persist Trade
```

Planner：

自动：

展开：

```text
save

insert

repository

JpaRepository
```

rg：

不用：

LLM。

---

# Fact Graph

Fact：

其实：

天然：

Graph。

例如：

```text
Trade

↓

Persist

↓

trade_order
```

例如：

```text
Trade

↓

Publish

↓

TradeCreated
```

以后：

Business Flow：

直接：

Graph。

不用：

Call Graph。

---

# Repository Capability

每个 Repo：

增加：

```json
{

"capabilities":[

"Trade",

"Pricing",

"Risk",

"PDF"

]
}
```

Planner：

先：

Capability。

再：

Fact。

最后：

rg。

---

# 我现在最大的修改（也是最终版本）

整个项目以后只有四层。

```text
                 LLM

                  ▲

                  │

          Context Builder

                  ▲

                  │

          Evidence Collector

        ▲       ▲        ▲

        │       │        │

      Fact     rg     Git

        ▲

        │

 Lightweight Extractor

        ▲

        │

     Source Code
```

**没有 Call Graph。**

**没有 AST Database。**

**没有 Neo4j。**

---

# 但是，我还想再推翻一个设计（这也是我认为整个项目最后一次大的重构）

如果这是我要长期维护的项目，我甚至不会自己维护 `facts.jsonl`。

我会直接采用 **Markdown Knowledge Base**。

例如：

```text
index/

pricing-service/

README.md

FACTS.md

API.md

DATABASE.md

EVENTS.md

CONFIG.md
```

例如：

`FACTS.md`

```markdown
# Facts

## Business

- PricingService calculates transaction cost.

- RiskService evaluates market risk.

## Database

- Writes table trade_order.

- Reads trade_snapshot.

## Events

- Publishes TradeCreated.

- Consumes MarketDataUpdated.

## External

- Calls ReportService.
```

为什么？

因为：

1. 人能直接读。
2. Git Diff 极其清晰。
3. LLM 天然适合 Markdown。
4. 可以人工补充知识，而不仅仅依赖自动提取。

---

## 到这里，我会停止继续扩展架构。

如果这真是一个 GitHub 项目，我下一步不会再设计任何模块，而是开始编码，并遵循以下优先级：

1. **先实现 Index Builder**（1000 行以内）
2. **再实现 Plugin Framework**
3. **然后完成 `code-search ask`**
4. **最后接入 LLM 和 Fact Extractor**

整个 MVP 控制在 **3000 行 Python 左右**，但能够直接用于你分析几十到上百个内部仓库的新需求。这会比继续增加抽象层，更快产生实际价值。


------------

好，这次我不会继续空谈架构，而是以**真正要开源这个项目**的标准来推进。

另外，我再推翻一个之前的决定。

---

# 最大的问题

我们一直在说：

```
Requirement

↓

Planner

↓

Search
```

其实真正的问题不是 Search。

而是：

> **Requirement 太弱。**

例如：

```
Support PRIIPs report
```

真正应该变成：

```
Requirement Graph
```

而不是 Keywords。

---

# Requirement Graph

例如

```
Support PRIIPs report
```

Planner 应该拆成：

```yaml
Business:
    PRIIPs
    Report

Actions:
    Generate
    Store
    Publish

Outputs:
    PDF

Systems:
    S3
    Kafka

Data:
    KID
    Scenario
    Performance
```

以后整个 Search 都围绕 Graph。

不是 Keyword。

---

# Domain Dictionary

增加

```
knowledge/

    finance/

        priips.yaml

    insurance/

    healthcare/

    ecommerce/
```

例如：

priips.yaml

```yaml
concepts:

  PRIIPs:

      aliases:

          - KID

          - Key Information Document

      outputs:

          - PDF

      related:

          - Performance

          - Cost

          - Risk

          - Scenario
```

以后 Planner：

不用 LLM。

直接：

```
PRIIPs

↓

KID

↓

Scenario

↓

Performance

↓

Cost
```

自动展开。

---

# Capability Discovery

以前：

Repo Summary：

```
Pricing Service
```

太弱。

应该：

Capability。

例如：

```
pricing-service

Capabilities

★★★★★ Pricing

★★★★ Risk

★★ PDF

☆
Notification
```

以后：

Requirement：

```
Pricing
```

Planner：

直接：

Capability。

不用：

LLM。

---

# 新增 capability.py

每个 Repo：

自动生成：

```
capability.json
```

例如：

```json
{

"repo":"pricing-service",

"capabilities":[

{

"name":"Pricing",

"confidence":95

},

{

"name":"Risk",

"confidence":88

}

]

}
```

---

# Capability Extractor

来源：

不是：

README。

而是：

综合：

```
API

+

Kafka

+

SQL

+

Package

+

README

+

Business Fact
```

综合打分。

---

# Fact Extraction 升级

以前：

Fact：

```
TradeService

publishes

TradeCreated
```

还是代码。

应该升级。

例如：

```
Capability

Trade Lifecycle
```

下面：

```
Facts

TradeController receives Trade

↓

TradeService validates

↓

TradeRepository stores

↓

TradeService publishes TradeCreated
```

注意。

已经变成：

Business Process。

---

# 新增 Business Process

每个 Repo：

```
process.json
```

例如：

```json
{
    "name":"Trade Lifecycle",

    "steps":[

        "Receive Trade",

        "Validate",

        "Persist",

        "Publish Event"

    ]
}
```

以后：

Architect：

直接：

看到流程。

不用：

Call Graph。

---

# 这里开始进入整个项目最核心的创新

## 不再 Search File

而是：

Search Capability。

例如：

```
Support PRIIPs Report
```

Planner：

先：

Capability：

```
Report

Risk

Scenario

Pricing
```

然后：

Repo。

例如：

```
pricing-service

95

report-service

92

risk-service

89
```

然后：

Business Process。

例如：

```
Generate Report

↓

Scenario

↓

Performance

↓

PDF
```

最后：

才：

Source Code。

---

# Search 层数重新定义

以前：

```
Summary

↓

rg
```

以后：

```
Capability

↓

Business Process

↓

Fact

↓

Symbol

↓

rg
```

注意。

rg：

最后。

---

# 新增 Query Planner

Planner：

输出：

不是：

Keyword。

而是：

Execution Plan。

例如：

```yaml
SearchCapability:

    Pricing

    Report

SearchProcess:

    Report Generation

SearchFact:

    Publish PDF

SearchCode:

    PdfGenerator
```

真正：

Agent。

---

# 新增 Search Budget

Planner：

还有：

```
Max Repo

5

Max File

20

Max Snippet

150
```

以后：

LLM：

永远：

不会：

爆Token。

---

# Search Feedback

这是我认为整个项目最重要的功能。

例如：

第一次：

```
Top Repo

pricing
```

Architect：

点击：

```
Not Relevant
```

以后：

Planner：

学习。

以后：

自动：

降低。

---

# Relevance Model

例如：

```
Business Capability

40
```

```
Business Process

30
```

```
Fact

20
```

```
rg

10
```

以后：

越来越准。

---

# 现在我要再次推翻一个东西

不要：

```
Planner
```

应该：

```
Workflow
```

例如：

Workflow：

```
Requirement

↓

Capability Discovery

↓

Repository Selection

↓

Business Process Discovery

↓

Evidence Collection

↓

Context Compression

↓

LLM

↓

Impact Report
```

整个：

Workflow。

都是：

Plugin。

---

# 最后一个创新（我认为最重要）

也是整个项目最终形态。

## 不建立 Code Index。

建立：

```
Knowledge Base
```

例如：

```
knowledge/

pricing-service/

Capability.md

Process.md

Fact.md

API.md

Config.md

Database.md

Event.md
```

所有文件：

Markdown。

全部：

Git 管理。

---

例如：

Process.md

```markdown
# Report Generation

Entry

ReportController

↓

ReportService

↓

ScenarioEngine

↓

PerformanceEngine

↓

PdfGenerator

↓

S3

↓

Notification
```

以后：

LLM：

99% 的问题。

**根本不用再读代码。**

只有：

```
需要实现

需要修改

需要Debug
```

才：

Fallback：

```
rg
```

---

## 这是我最终版本的架构（也是我认为比前面所有版本都成熟）

```
               Requirement
                     │
                     ▼
          Domain Knowledge（行业知识）
                     │
                     ▼
       Capability Discovery（能力发现）
                     │
                     ▼
      Business Process Discovery（业务流程）
                     │
                     ▼
       Repository Selection（仓库选择）
                     │
                     ▼
       Evidence Collection（事实收集）
                     │
                     ▼
       Context Compression（上下文压缩）
                     │
                     ▼
                 LLM Analysis
                     │
                     ▼
          Architecture / Impact Report
```

---

## 不过，到这里我会再次调整项目目标

经过这么多轮设计，我认为**项目名都应该改**。

它已经不是 Code Search。

也不是 Architect Assistant。

我会叫它：

> **Architecture Knowledge Engine (AKE)**

因为真正长期有价值的，不是搜索代码，而是**持续沉淀组织的业务知识、架构知识和代码事实**。搜索只是知识引擎的一种查询方式。这样你以后无论接入 Claude Code、Codex、Gemini CLI，还是内部 Agent，它们消费的都是统一的 Knowledge Base，而不是每次都重新理解几百万行代码。



-----------------


这次我不继续"发散"了。

因为我已经发现一个更大的问题。

**整个项目最大的瓶颈不是 Index，也不是 Search，而是 Extraction。**

也就是说：

> 如果 Extractor 足够好，Search 可以非常简单。

所以，我会把整个项目重构成下面这样（这是我认为真正可以长期维护 5 年以上的版本）。

---

# Architecture

```text
ake/

    extract/
        java/
        typescript/
        python/

    knowledge/

    query/

    llm/

    output/
```

注意。

没有：

```
search/
```

因为 Search 已经不是核心。

---

# 为什么？

例如一个 Spring 项目：

今天大部分工具都会这样：

```
@RestController

↓

找到文件

↓

rg

↓

LLM
```

其实这是最低效的。

真正应该是：

```
@RestController

↓

Endpoint

↓

Business Capability

↓

Business Process

↓

Knowledge
```

Search 已经结束了。

---

# Extractor 应该生成什么？

不是：

```
symbol.json
```

不是：

```
api.json
```

而是：

```
knowledge/
```

例如：

```
knowledge/

    pricing/

        capability.md

        process.md

        api.md

        event.md

        database.md

        config.md

        dependency.md
```

---

例如

Capability.md

```markdown
# Capability

Pricing

Risk Calculation

Scenario Calculation

Performance Calculation
```

---

API.md

```markdown
POST /pricing

Input

TradeRequest

Output

PricingResponse
```

---

Database.md

```markdown
Read

trade_snapshot

Write

trade_cost
```

---

Event.md

```markdown
Publish

TradeCreated

Consume

MarketDataUpdated
```

---

Dependency.md

```markdown
Uses

RiskEngine

ScenarioEngine

ReportService
```

---

Process.md

```markdown
TradeRequest

↓

Validate

↓

Pricing

↓

Persist

↓

Publish Event

↓

Return Result
```

---

你会发现：

> **LLM 根本不用读源码。**

---

# Source Code 什么时候读？

只有两种情况。

例如：

Architect：

```
为什么这里会算错？
```

或者：

```
需要修改实现
```

才：

```
Knowledge

↓

定位

↓

Code
```

---

# 所以 Query 应该改成两阶段。

以前：

```
Requirement

↓

Code
```

以后：

```
Requirement

↓

Knowledge

↓

Need Code?

↓

Code
```

90%的情况。

Knowledge 已经够。

---

# 继续推翻

我现在甚至觉得：

Fact 都太细。

真正应该建立：

Capability。

例如：

```
Trade
```

Capability：

```
Trade Lifecycle
```

下面：

```
Receive Trade

↓

Validate

↓

Persist

↓

Publish
```

而不是：

```
TradeRepository.save()
```

Architect 不关心。

---

# Extractor 分层

以后：

Extractor：

四层。

```
Layer1

Syntax
```

例如：

```
@RestController

@Service

@Repository
```

↓

```
Layer2

Semantic
```

例如：

```
Controller

Business Service

Persistence
```

↓

```
Layer3

Business
```

例如：

```
Trade

Pricing

Report
```

↓

```
Layer4

Knowledge
```

例如：

```
Trade Lifecycle
```

---

# 为什么这样？

举例。

源码：

```java
tradeRepository.save(entity);
```

Layer1

```
Method Call
```

Layer2

```
Repository Save
```

Layer3

```
Persist Trade
```

Layer4

```
Trade Lifecycle
```

越往上。

越稳定。

---

# 我认为真正值钱的是 Layer4。

因为：

以后：

TradeRepository

改名：

```
OrderRepository
```

Knowledge：

完全不用更新。

---

# Knowledge 应该 Version

例如：

```
knowledge/

pricing/

v1/

v2/

latest/
```

以后：

代码：

更新。

Knowledge：

Diff。

Architect：

直接：

看：

```
Capability

增加

Settlement
```

不用：

看：

1000个commit。

---

# Git Integration

真正应该：

不是：

git blame。

而是：

Knowledge Diff。

例如：

昨天：

```
Capability

Pricing

Risk
```

今天：

```
Capability

Pricing

Risk

Settlement
```

Architect：

一分钟：

知道：

新增：

Settlement。

---

# 新增 ADR Extractor

企业代码里面：

很多：

```
docs/

adr/

design/

architecture/
```

全部：

抽。

例如：

```
ADR-001

Kafka

instead of RabbitMQ
```

Knowledge：

增加：

```
Architecture Decision

Messaging

Kafka
```

这比代码还值钱。

---

# 新增 Prompt Library

不要：

一个Prompt。

例如：

```
prompt/

impact.md

business.md

bug.md

design.md

review.md
```

不同：

Task。

不同：

Prompt。

---

# Context Builder 重新设计

不是：

拼代码。

而是：

拼：

```
Requirement

+

Capability

+

Process

+

Fact

+

Evidence

+

Selected Code
```

最后：

XML。

例如：

```xml
<context>

<capability>

Pricing

</capability>

<process>

Pricing Flow

</process>

<fact>

Writes trade_cost

</fact>

<code>

...

</code>

</context>
```

---

# 我最后想再推翻一件事情（也是我认为整个项目最大的升级）

前面一直说：

```
Knowledge
```

其实：

Knowledge 还是机器生成。

真正应该：

允许人工编辑。

例如：

```
knowledge/

pricing/

README.md

```

团队：

直接：

补充：

```
这个Service其实负责......

不要修改......

依赖美国团队......
```

以后。

Extractor：

不会覆盖。

而是：

Merge。

---

## 这是我最终建议的项目形态

我不会再叫它 Code Search，也不会叫 AKE。

我会直接定位成一个**Code Knowledge Compiler**。

它像编译器一样，把源代码编译成知识：

```text
          Source Code
                │
                ▼
      Language Extractor（Java/TS/Python）
                │
                ▼
      Semantic Extractor
                │
                ▼
      Business Extractor
                │
                ▼
      Knowledge Compiler
                │
                ▼
        Markdown Knowledge Base
                │
                ▼
         Planner / LLM / Agent
```

这是我经过整个讨论后认为最值得投入的方向。

---

## 不过，我必须指出一个关键问题

我们已经讨论了很多轮，但**真正的代码几乎没有增加**。如果这是一个真实项目，我现在会停止所有架构设计，开始写代码，并按下面的顺序实现：

1. **Java Extractor（优先支持 Spring Boot）**
2. **TypeScript Extractor（NestJS/Express）**
3. **Knowledge Compiler（输出 Markdown）**
4. **`ask` 命令（Knowledge → Code 回退）**

因为这四部分完成后，这个工具就已经可以在你的几十到几百个内部仓库上实际使用，而后面的能力（Workflow、Planner、Feedback 等）都可以逐步演进。



-------------------


继续。

不过这一轮我不会再做概念设计，而是站在**Google Code Search、Sourcegraph、Zoekt、OpenGrok、Livegrep、Claude Code、Cursor、Codex**这些工具的发展路线来看，我觉得我们前面还有一个**最大的缺失**。

这个缺失不是 Search，不是 Knowledge。

而是：

> **Code Intelligence Pipeline（代码智能流水线）**

这是整个项目最值得做的地方。

---

# 我建议整个系统改成 Compiler Pipeline

不要叫 Extractor。

叫 Compiler。

因为它真的和编译器一样。

例如 Java：

```text
.java

↓

Lexer

↓

Parser

↓

AST

↓

Semantic

↓

IR

↓

Optimization

↓

Output
```

我们的项目应该变成：

```text
Repository

↓

File Scanner

↓

Language Frontend

↓

Normalizer

↓

Business Analyzer

↓

Knowledge IR

↓

Optimizer

↓

Knowledge Output
```

注意：

我这里引入了一个新的概念。

---

# Knowledge IR（中间表示）

这是我认为整个项目最缺的。

目前：

Java：

输出：

```json
api.json
```

Python：

输出：

```json
api.json
```

TS：

输出：

```json
api.json
```

以后：

全部输出：

统一 IR。

例如：

```json
{
  "kind":"service",

  "name":"TradeService",

  "language":"java",

  "framework":"spring"
}
```

Controller：

```json
{
  "kind":"api",

  "method":"POST",

  "path":"/trade"
}
```

SQL：

```json
{
  "kind":"database",

  "operation":"write",

  "table":"trade_order"
}
```

Kafka：

```json
{
  "kind":"event",

  "action":"publish",

  "topic":"TradeCreated"
}
```

注意：

Extractor 不直接输出 Markdown。

Extractor 输出 IR。

---

# 为什么？

以后：

NestJS。

FastAPI。

Go。

.NET。

全部：

输出：

同一个 IR。

后面模块：

完全不用改。

这就是 LLVM 的思想。

---

# Frontend

目录：

```text
frontend/

    java/

    python/

    typescript/

    go/

    csharp/
```

统一：

```python
class Frontend:

    parse()

    extract()

    normalize()
```

输出：

Knowledge IR。

---

# Optimizer

这是前面一直没有提到的。

IR 出来以后。

应该：

优化。

例如：

Java：

```java
save()

insert()

persist()
```

IR：

三个：

Node。

Optimizer：

统一：

```text
Persist
```

---

例如：

```java
KafkaTemplate.send()
```

NestJS：

```ts
client.emit()
```

Python：

```python
producer.publish()
```

全部：

统一：

```text
Publish Event
```

以后：

Knowledge：

统一。

---

# Dead Knowledge Elimination

这个名字故意借 LLVM。

例如：

提取：

```text
Getter

Setter

Builder

equals()

hashCode()
```

全部：

删。

Architect：

完全没价值。

---

# Constant Folding（笑）

例如：

Spring：

```java
@RequestMapping("/trade")
```

Controller：

```java
@PostMapping("/create")
```

直接：

Fold：

```text
POST

/trade/create
```

以后：

API：

不用：

计算。

---

# Inline Expansion

例如：

Config：

```yaml
trade:

bucket:

reports
```

代码：

```java
@Value("${trade.bucket}")
```

IR：

直接：

```text
reports
```

LLM：

不用：

猜。

---

# Linker

整个 Repo：

不是孤岛。

应该：

Link。

例如：

Repo A：

```text
Publish

TradeCreated
```

Repo B：

```text
Consume

TradeCreated
```

Link：

```text
TradeCreated

↓

RepoA

↓

RepoB
```

整个企业：

Business Graph。

自动。

---

# Multi Repo Link

例如：

Feign：

```java
ReportClient
```

OpenAPI：

```yaml
/report
```

Link：

自动：

跨 Repo。

以后：

Architect：

看见：

```text
Pricing

↓

Report

↓

Notification
```

全部：

企业级。

---

# Knowledge Optimizer

这一层。

做：

Merge。

例如：

三个 Repo：

都：

```text
Pricing
```

Merge：

Capability：

```text
Enterprise Pricing
```

以后：

Knowledge：

越来越干净。

---

# Index 不应该按 Repo

这是我认为今天最大的修改。

以前：

```text
index/

repo/

pricing/
```

其实。

错。

应该：

按：

Knowledge。

例如：

```text
knowledge/

capability/

Pricing.md

Risk.md

Settlement.md
```

里面：

引用：

所有 Repo。

例如：

Pricing.md

```markdown
Implemented By

pricing-service

legacy-pricing

pricing-engine
```

Architect：

以后：

查：

Pricing。

不是：

Repo。

---

# Business Object

增加：

```text
knowledge/

object/

Trade.md

Account.md

Order.md
```

自动：

抽取。

例如：

Trade：

涉及：

```text
API

Database

Kafka

Repository

Service
```

全部：

聚合。

---

# Flow Compiler

这是我认为整个项目未来最大的价值。

例如：

Trade：

自动：

生成：

```mermaid
graph TD

Client

-->

TradeController

-->

TradeService

-->

TradeRepository

-->

Kafka

-->

ReportService
```

不是：

LLM。

Compiler。

---

# Knowledge Query Language（KQL）

不要 SQL。

不要 DSL。

直接：

KQL。

例如：

```text
capability:Pricing
```

或者：

```text
object:Trade
```

例如：

```text
event:TradeCreated
```

例如：

```text
api:/pricing
```

例如：

```text
flow:Trade
```

Planner：

全部：

自动生成。

---

# Query Optimizer

这其实就是数据库思想。

例如：

Requirement：

```text
Trade PDF
```

Planner：

不要：

```text
rg Trade

rg PDF
```

而是：

```text
Capability

↓

Object

↓

Flow

↓

Code
```

最少代价。

---

# 我最后想再推翻一件事（也是整个项目最大的升级）

我们一直说：

> Knowledge Base

其实还是静态。

真正应该叫：

> **Knowledge Compiler + Query Engine**

像：

```text
gcc
```

一样。

例如：

```text
gcc

↓

IR

↓

Optimization

↓

Assembly
```

我们：

```text
Repository

↓

Knowledge IR

↓

Optimizer

↓

Knowledge Graph

↓

LLM
```

---

# 最终版（我认为这是整个项目最终的架构）

```text
                    Repository
                         │
                         ▼
              Language Frontends
      (Java / TS / Python / Go / C#)
                         │
                         ▼
                 Knowledge IR
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       IR Optimizer          Multi-Repo Linker
              │                     │
              └──────────┬──────────┘
                         ▼
                Knowledge Compiler
                         │
                         ▼
              Markdown Knowledge Base
                         │
                         ▼
                  Query Optimizer
                         │
                         ▼
               Context Builder (Budget-aware)
                         │
                         ▼
                 LLM / Claude / Codex
                         │
                         ▼
      Architecture Report / Impact Analysis
```

---

## 如果这是我亲自维护的开源项目，我还会再增加两个我认为决定成败的模块

### 1. Incremental Compiler

不是重新扫描整个仓库。

而是：

```text
git diff

↓

Changed Files

↓

Recompile IR

↓

Merge
```

100 个仓库，每天更新几个文件，通常只需要重新编译几秒钟。

---

### 2. Test Corpus（这是很多 AI 项目都缺失的）

建立一个 `corpus/`：

```text
corpus/

    spring-petclinic/

    eShopOnContainers/

    nacos/

    opensearch/

    kubernetes/
```

每个项目都配套：

* 标准 Knowledge IR
* 标准 Knowledge Markdown
* 标准 Query
* 标准 Expected Result

这样每修改一次 Extractor、Optimizer 或 Planner，都可以自动跑回归测试，确保知识提取质量不会退化。

**这一点我认为比继续设计任何新模块都重要。** 一个好的测试语料库，会决定这个项目能否长期稳定演进。


----------------


继续。

不过，这一轮我不再从"代码搜索"角度思考，而是站在**Google、Meta、Microsoft 内部 Code Intelligence 平台**的角度来看。

我觉得，我们前面还有一个根本没有讨论到的东西。

也是我认为这个项目最终能不能做到**企业级**的关键。

> **Repository 不应该是最小单位。**

这是整个架构最大的一个问题。

---

# 为什么？

假设企业有：

```text
pricing-service

risk-service

report-service

notification-service

customer-service
```

现在所有 Code Search 都是：

```
Repo
    ↓
Code
```

但是对于 Architect 来说：

真正关心的是：

```
Business Domain
```

例如：

```
Trade
```

实际上：

涉及：

```
pricing

risk

report

notification

customer
```

所以真正应该建立的是：

```
Business Domain Layer
```

而不是 Repo Layer。

---

# 新增 Domain Compiler

整个 Pipeline：

```
Repo

↓

Knowledge

↓

Domain Compiler

↓

Enterprise Knowledge
```

例如：

pricing-service

里面：

```
Pricing Capability
```

risk-service

里面：

```
Risk Capability
```

最终：

自动 Merge：

```
Trade Domain
```

---

目录：

```
knowledge/

    domain/

        Trade/

        Customer/

        Portfolio/

        Market/

        Risk/
```

例如：

```
Trade/

    Capability.md

    Process.md

    APIs.md

    Events.md

    Repositories.md
```

以后：

Architect：

永远：

先打开：

Trade。

不是 Repo。

---

# Object Compiler

再进一步。

不是 Domain。

而是：

Business Object。

例如：

```
Trade
```

自动聚合：

所有：

```
TradeDTO

TradeEntity

TradeRepository

TradeService

TradeController

TradeCreated

trade_order
```

输出：

```
Trade.md
```

例如：

```
Business Object

Trade

----------------

REST

POST /trade

GET /trade/{id}

----------------

Database

trade_order

----------------

Kafka

TradeCreated

TradeCancelled

----------------

Repositories

pricing-service

risk-service

----------------

Capabilities

Pricing

Settlement

Risk
```

以后：

新人。

5分钟。

理解：

Trade。

---

# Timeline Compiler

这是我觉得整个行业都没做好。

不仅：

现在。

还要：

时间。

例如：

```
Trade

2023

↓

Risk

2024

↓

Settlement

2025

↓

PRIIPs
```

自动：

根据 Git。

生成：

Evolution。

以后：

Architect：

直接：

知道：

为什么。

---

# ADR Compiler

企业：

很多：

```
docs/

architecture/

adr/

decision/
```

全部：

抽。

例如：

```
ADR-001

Kafka

instead of MQ
```

自动：

Knowledge。

以后：

Prompt：

自动：

引用。

---

# People Knowledge（这一点非常有价值）

不是：

谁写代码。

而是：

Ownership。

例如：

```
Trade

↓

Team Alpha
```

```
Pricing

↓

Team Beta
```

以后：

Impact：

自动：

告诉你：

```
需要联系：

Risk Team

Pricing Team
```

这对于大型企业特别有价值。

注意，这里不是为了分析个人，而是维护**模块归属**，可以从 `CODEOWNERS`、团队配置、目录约定等公开工程信息提取，而不依赖个人信息。

---

# Dependency Compiler

不仅：

Java Import。

而是：

企业依赖。

例如：

```
pricing

↓

report

↓

notification
```

不仅：

代码。

还有：

```
REST

Kafka

Database

S3

Redis
```

统一。

---

# Runtime Knowledge

这是我认为未来最大的扩展。

不仅：

Source。

还包括：

```
Kubernetes

↓

Deployment

↓

ConfigMap

↓

Helm

↓

Terraform
```

最后：

Knowledge：

包含：

```
Source

+

Infrastructure
```

例如：

```
Pricing Service

↓

Deployment

pricing-prod

↓

Namespace

investment

↓

Kafka

pricing-topic

↓

Redis

pricing-cache
```

Architect：

以后：

直接：

知道：

线上部署。

---

# Observation Compiler

进一步：

把：

```
Grafana

Prometheus

OpenTelemetry

Jaeger
```

全部：

接进来。

Knowledge：

增加：

```
Runtime

Latency

↓

Dependency

↓

Error Rate
```

以后：

不仅：

知道：

代码。

还知道：

生产。

---

# Multi-layer Knowledge

整个系统：

最终：

不是一层。

而是：

```
Business

▲

Process

▲

Capability

▲

API

▲

Code

▲

Infrastructure

▲

Runtime
```

每层：

可以：

独立 Query。

---

# Knowledge Query

例如：

```
Trade
```

Planner：

不是：

搜：

Trade。

而是：

自动：

```
Business

↓

Capability

↓

API

↓

Event

↓

Database

↓

Runtime

↓

Code
```

全部：

一起。

---

# Query Plan Example

例如：

```
Implement PRIIPs report
```

Planner：

输出：

```
1.

Domain

Investment

2.

Capability

Report

Risk

Performance

Scenario

3.

Business Object

Trade

Portfolio

Holding

4.

Event

ReportGenerated

5.

Database

trade_snapshot

6.

API

/report

7.

Repository

report-service
```

注意。

已经没有：

Keyword。

---

# 这里我会再次推翻一个设计

不要：

```
Markdown
```

作为：

Knowledge Source。

而是：

建立：

```
Knowledge Package
```

例如：

```
knowledge/

trade/

package.yaml

README.md

Capability.md

API.md

Process.md

Runtime.md

ADR.md
```

package.yaml

```yaml
name: Trade

owners:

- Trading Team

dependencies:

- Pricing

- Risk

- Settlement

objects:

- Trade

- Portfolio

capabilities:

- Pricing

- Settlement

- Reporting
```

以后：

Knowledge：

就像：

npm package。

可以：

Version。

可以：

Publish。

可以：

Merge。

---

# 我最终认为，这个项目真正应该定位成：

> **Enterprise Code Intelligence Platform（ECIP）**

Code Search 只是其中一个能力。

整个系统最终服务于：

* Architect（影响分析）
* Developer（代码定位）
* AI Agent（上下文提供）
* Reviewer（设计审查）
* Onboarding（新人学习）
* Governance（架构治理）

---

## 如果我是这个项目的 Maintainer，我下一阶段不会再增加功能，而会投入三件最有价值的事情

1. **语言 Frontend 做到极致**：优先支持 Java(Spring Boot)、TypeScript(NestJS)、Python(FastAPI)，保证提取质量，而不是急于支持十几种语言。

2. **Knowledge IR 稳定化**：定义一套版本化、向后兼容的 IR Schema，让所有语言 Frontend 输出一致的数据结构。这会成为整个系统的"ABI"。

3. **建立 Benchmark**：准备几十个真实开源项目和数百个典型架构问题（例如"找订单创建流程"、"定位 Kafka 消费链路"、"分析新增字段影响范围"），持续评估召回率、准确率、Token 消耗和响应时间。没有这套 Benchmark，再好的架构也很难持续演进。

我认为，这三件事带来的长期价值，会远远超过继续增加新的模块。


---------------------


继续。

不过这次，我不会继续扩展架构，而是站在**未来两三年的 AI Coding Agent**角度重新思考。

我认为，我们前面讨论的方案还有一个最大的缺陷：

> **整个系统还是 Pull 模型。**

也就是说：

```
User

↓

Query

↓

Search

↓

LLM
```

这是 Claude Code、Codex、Cursor、Gemini CLI 今天都是这样工作的。

**但是我觉得未来不是这样。**

---

# 应该改成 Push Model

也就是说：

每天 Git 更新。

系统自动：

```
git pull

↓

Incremental Compiler

↓

Knowledge Update

↓

Generate Diff

↓

Update Embedding（如果有）

↓

Done
```

Architect 根本不用 Search。

每天：

Knowledge 已经最新。

---

# Knowledge Delta

增加：

```
knowledge/

trade/

history/

2026-06-01.md

2026-06-15.md

2026-06-27.md
```

例如：

今天：

```
Settlement Capability Added

Affected

Trade

Pricing

Risk
```

以后：

Architect：

每天：

直接：

Read Delta。

不用：

看：

500 commits。

---

# Semantic Git Diff

不要：

Git：

```
+20

-15
```

应该：

Compiler：

自动：

```
Trade Process

Added

Settlement

Capability
```

例如：

Git：

改：

```java
saveSettlement()
```

输出：

```
Business Capability

Settlement

新增
```

这就是：

Semantic Diff。

---

# Knowledge CI

整个项目。

应该：

接：

CI。

例如：

GitHub：

```
PR

↓

Knowledge Compiler

↓

Knowledge Diff

↓

Comment PR
```

例如：

PR：

增加：

一个：

REST API。

机器人：

自动：

评论：

```
Business Impact

New Capability

Settlement

Affected Domain

Trade

Need Update

API.md

Need Update

Process.md
```

比：

Code Review：

值钱。

---

# PR Reviewer

甚至：

不用：

LLM。

Compiler：

已经知道：

```
新增

Kafka Producer
```

自动：

Review：

```
Missing Consumer

Detected.
```

例如：

新增：

```
@RestController
```

但是：

没有：

Security。

自动：

提醒。

---

# Architecture Drift

这是我认为真正值钱的模块。

例如：

Knowledge：

昨天：

```
Trade

↓

Pricing

↓

Kafka

↓

Report
```

今天：

变：

```
Trade

↓

Pricing

↓

Kafka

↓

Redis

↓

Report
```

Compiler：

自动：

告诉你：

```
Architecture Drift

Redis Introduced
```

不用：

LLM。

---

# Governance Engine

继续。

Knowledge：

不仅：

查询。

还可以：

检查。

例如：

Rule：

```
Controller

不能

访问

Repository
```

Compiler：

检查：

IR。

直接：

Violation。

例如：

```
Kafka Topic

必须

Version

v2
```

检查：

Topic。

全部：

静态。

---

# Pattern Detector

越来越高级。

例如：

Compiler：

扫描：

整个企业。

发现：

```
PDF

Generator
```

有：

15种。

自动：

输出：

```
Pattern

Duplicated

Need Shared Library
```

Architect：

直接：

知道。

---

# Enterprise Capability Map

最终：

不是：

Repo。

而是：

企业地图。

例如：

```
Trading

├── Pricing

├── Settlement

├── Risk

├── Report

├── Notification
```

每个：

Capability。

点开：

```
API

Events

Owner

Repositories

Runtime

ADR

Metrics
```

这其实已经有点像企业版的 Backstage，但重点是**自动从代码和工程资产生成**，而不是完全依赖人工维护。

---

# AI Memory

这里我觉得是整个项目未来最大的升级。

不要：

每次：

LLM：

重新分析。

应该：

Memory。

例如：

Architect：

昨天：

问：

```
PRIIPs
```

今天：

问：

```
Scenario
```

Memory：

已经：

```
Working Set

Trade

Risk

Pricing
```

直接：

继续。

---

# Agent Loop

整个流程：

```
Requirement

↓

Planner

↓

Knowledge

↓

Need More?

↓

Code

↓

Need More?

↓

Git

↓

Need More?

↓

ADR

↓

Need More?

↓

Runtime

↓

Done
```

这是：

真正：

Agent。

不是：

一次 Prompt。

---

# Active Learning

增加：

Feedback。

例如：

Architect：

```
ReportService

Not Relevant
```

系统：

以后：

降低。

不是：

LLM。

而是：

Rank。

---

# Confidence

每条：

Knowledge。

都有：

```
Confidence

98%
```

例如：

来自：

Annotation。

```
100
```

来自：

Regex。

```
80
```

来自：

LLM。

```
60
```

Architect：

一眼：

知道：

可信度。

---

# Explainability

整个系统。

最大的原则。

不是：

智能。

而是：

Explain。

例如：

```
Why

Pricing Service?
```

输出：

```
Matched

Capability

Pricing

API

/report

Event

ReportGenerated

Score

93
```

所有：

Evidence。

透明。

---

# 这里我要再推翻一个设计

我现在认为：

Knowledge 不应该全部自动生成。

应该：

三层。

```
Layer1

Compiler
```

↓

```
Layer2

Human
```

↓

```
Layer3

LLM
```

例如：

Compiler：

```
Trade

writes

trade_order
```

Human：

补充：

```
Trade Order

仅用于美国市场
```

LLM：

补充：

```
可能影响

Settlement
```

以后：

Knowledge：

越来越准。

---

# 最终架构（我认为这是整个项目最终形态）

```
                    Git Repository
                           │
                           ▼
                 Incremental Compiler
                           │
                           ▼
                    Knowledge IR
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   Business Model     Architecture     Runtime Model
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                Enterprise Knowledge Base
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
     Query Engine     Governance      CI Reviewer
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                     AI Agent Platform
```

---

## 不过，经过这么多轮讨论，我想给你一个**完全不同于前面所有设计**的建议。

### 不要把它做成一个"搜索工具"，而是做成一个**编译器生态（Compiler Ecosystem）**。

参考 LLVM，而不是参考 Sourcegraph。

建议采用如下分层：

```
ake/
├── frontend/          # Java、TS、Python Frontend
├── ir/                # Knowledge IR 定义（整个项目最重要）
├── optimizer/         # Normalize、Merge、Dedup、Semantic Folding
├── linker/            # 多 Repo 关联
├── backend/
│   ├── markdown/      # 输出 Knowledge Markdown
│   ├── json/          # 输出 JSON
│   ├── graph/         # 输出 Graph
│   ├── llm/           # 输出 LLM Context
│   └── search/        # 输出搜索索引
├── query/             # KQL、Planner、Executor
├── governance/        # 架构规则检查
├── benchmark/         # 回归测试与评测
└── cli/
```

### 我认为真正的护城河不是 `ripgrep`、不是 LLM、也不是 Prompt。

真正的护城河只有三个：

1. **Knowledge IR**：所有语言最终汇聚到统一语义模型。
2. **Incremental Compiler**：百万行代码在几秒内完成增量知识更新。
3. **Knowledge Optimizer**：把不同语言、框架、团队实现归一化成稳定的业务能力、业务对象和业务流程。

如果这三个做好了，后面的 Claude、GPT、Gemini、Copilot，甚至未来的新模型，都只是消费同一套 Knowledge IR 的不同前端，而不是你的核心竞争力。



-------------


