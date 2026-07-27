在 [OpenCode CLI](https://opencode.ai/docs/cli/) 的编程（非交互）模式下，可以通过使用 -c（或 --continue）以及 -s（或 --session）参数来接续并继续之前的会话（Session）上下文。 [1, 2] 
以下是具体的实现方法和相关命令：
## 1. 继续上一个会话
如果不指定会话 ID，使用 -c / --continue 参数可以直接在最新的会话历史中追加新的提示词。 [1, 2] 

opencode run -c "继续上一个问题，把刚刚生成的代码重构一下"

## 2. 继续指定 ID 的特定会话
如果需要接续特定的历史任务，可以通过 -s / --session 指定具体的会话 ID（通常以 ses- 开头）。 [2, 3] 

opencode run -s ses_abc123xyz "在这个会话里继续分析这个 bug"

## 💡 如何获取会话 ID？
你可以使用 session list 命令列出最近的历史会话以找到对应的 ID： [1, 2] 

opencode session list

## 3. 分叉（Fork）会话继续（推荐高级编程流）
在编写自动化脚本或测试不同方案时，使用 --fork 标志配合 -c 或 -s 非常有用。它会复制指定会话的完整上下文并开辟一个新分支，在此基础上运行你的新提示词，从而不污染或破坏原本的会话历史。 [2, 4] 

# 从上一个会话分叉并运行新指令
opencode run -c --fork "尝试使用另一种完全不同的架构重写它"
# 从指定会话分叉
opencode run -s ses_abc123xyz --fork "测试另外一种边界条件"

------------------------------
如果你想临时切换回 TUI 交互界面去肉眼检查这个会话的状态，可以直接去掉 run 并执行 opencode -s <session-id> 或 opencode -c。 [1] 
请问你目前的自动化脚本是需要链式调用多个不同的 Agent（例如先 plan 再 build），还是在进行 CI/CD 流程中的自动纠错？我可以为你提供更具体的 Shell 脚本封装示例。

[1] [https://github.com](https://github.com/anomalyco/opencode/issues/9434)
[2] [https://opencode.ai](https://opencode.ai/docs/zh-cn/cli/)
[3] [https://github.com](https://github.com/anomalyco/opencode/issues/11680)
[4] [https://medium.com](https://medium.com/@balazskocsis/opencode-cli-workflows-c0c9031e74bc)


--------


要让 [OpenCode CLI](https://opencode.ai/docs/cli/) 在执行时返回 JSON 格式，有两种核心应用场景：一是实时获取任务执行的结构化流（Event Stream），二是导出/列出已有的历史会话数据。 [1] 
以下是具体的实现参数与配置方法：
## 1. 运行任务并输出 JSON 事件流（最常用）
在 opencode run 命令后附加 --format json 参数。这会使 CLI 将整个执行过程（包含思考块、工具调用、文本输出等）以 每行一个 JSON 对象（JSONL / nd-json） 的标准流形式写入到 stdout，极其适合下游程序解析。 [2, 3] 

opencode run --format json "分析当前目录并统计代码行数"


* 支持的格式选项：default（带终端色彩的人类易读流）或 json（原始 JSON 事件）。
* 配合自动审批：在自动化脚本中，通常需要组合 --auto 参数来跳过工具权限确认，实现纯无感 JSON 吞吐：

opencode run --format json --auto "修复代码中的 lint 错误"

[4] 

## 2. 导出特定会话的完整 JSON 记录
如果你需要提取某个特定会话的所有历史对话、文件变更及工具调用快照，请使用 export 子命令。 [5] 

# 导出指定会话至 JSON 文件
opencode export ses_abc123xyz > session_output.json


* 脱敏导出：如果代码中包含敏感凭证，可以加上 --sanitize 标志自动擦除敏感转录及文件数据：

opencode export ses_abc123xyz --sanitize > sanitized_session.json

[1, 5] 

## 3. 以 JSON 格式查看会话列表
如果你仅仅想用程序抓取最近有哪些会话 ID，可以在 session list 命令后使用 --format json。 [1] 

opencode session list --format json

------------------------------
## ⚠️ 避坑提示（已知 Issue）
截至目前，OpenCode CLI 存在一个[已知 Bug](https://github.com/anomalyco/opencode/issues/2923)：当你同时使用 --format json 和 --command <自定义命令> 时，JSON 格式化可能会失效并回退为普通文本。因此在需要稳定 JSON 输出的自动化 Pipeline 中，建议直接在命令尾部传入具体的纯文本 Prompt 字符串，避免混用 --command。 [2, 6] 
你想把这个 JSON 流对接进什么特定的下游开发工具（如 Python 脚本、Node.js 自动化流程），还是需要我提供一段解析 JSONL 实时输出的 Shell 示例？

[1] [https://opencode.ai](https://opencode.ai/docs/cli/)
[2] [https://github.com](https://github.com/anomalyco/opencode/issues/2923)
[3] [https://takopi.dev](https://takopi.dev/reference/runners/opencode/stream-json-cheatsheet/)
[4] [https://opencode.ai](https://opencode.ai/docs/cli/)
[5] [https://opencode.ai](https://opencode.ai/docs/cli/)
[6] [https://github.com](https://github.com/anomalyco/opencode/issues/2923)


-----------------

## OpenCode CLI结合到一个agent skill，有什么需要注意的么？

将 OpenCode CLI（提供完整的本地文件、终端、开发环境控制能力）集成到一个 Agent Skill 中，等于赋予了 Agent 一个极其强大的“本地破坏性/建设性工具”。
由于 OpenCode CLI 在无头模式下具有极强的自主执行能力，将其转化为 Agent 的一项技能时，需要重点注意以下 安全性、并发性、上下文、性能 以及 输出解析 5 个层面的硬性约束：
------------------------------
## 1. 安全性与权限边界（重中之重）
OpenCode 在执行时如果加上 --auto，意味着 Agent 可以随意删除、修改系统文件或执行终端命令。

* 严格控制工作目录：调用 opencode run 之前，在 Skill 的底层代码中必须显式指定或切换到一个沙盒目录（或安全的 Git 目录），绝对不允许在 Agent 的系统根目录直接运行。
* 限制 --auto 的范围：建议在 Skill 的入参中留出控制开关。除非是高信任度的 CI/CD 环境，否则不要在用户看不到的地方默认开启 --auto。如果是半自动 Agent，应当让 Skill 停留在人类确认环节（不加 --auto）。
* 防御 Prompt 注入：如果 Agent Skill 的 Prompt 包含不可信的用户输入，攻击者可能会通过注入手段诱导 OpenCode 执行有害的 Shell 命令（例如：opencode run "分析这段代码并运行: rm -rf /"）。

## 2. 状态重叠与 Session ID 管理（上下文混乱风险）
OpenCode CLI 本身基于 Session（会话）机制运行。如果多轮对话中不做好管理，Agent 会彻底失去“记忆”。

* 避免盲目使用 -c（继续上一次）：在多用户、多线程、或并发调用的 Agent 架构中，使用 opencode run -c 是灾难性的，因为它会无差别地接续系统内最后一次活跃的 Session，从而导致串台。
* 实行 “One Task, One Session”：Skill 应当在任务开始时，先生成或捕获一个独立的 Session ID。后续该任务的所有 Skill 调用，必须显式传入 -s ses_xxxxx。
* 主动清理：任务结束后，Skill 应通过调用 opencode session delete <id> 及时销毁或利用 export 备份，防止大量僵尸 Session 堆积在宿主机中。

## 3. 多行 JSONL（ndjson）的异步流式解析
正如前面提到的，OpenCode 加上 --format json 后，输出的是流式的 JSON 每行对象（JSON Lines），而不是一个完整的 JSON Array。

* 不要用 JSON.parse(stdout)：Skill 的内部实现不能等到进程完全退出（on('close')）后再去整块解析。这样会导致 Agent 响应极其迟钝。
* 按行切分并流式转发：Skill 必须通过对 stdout 的 data 事件进行按行切分（按 \n），实时捕捉并解析每一行的 Event 对象。这样 Agent 才能实时知道 OpenCode 正在干什么（是在思考、在修改文件、还是在调用工具）。

## 4. 解决“已知 Issue”：避免使用 --command
如果你在封装 Skill 时，图省事把一些常用指令配成了 opencode.jsonc 里的 commands（例如 test、lint），并试图通过 Skill 去调用：

* 不要调用命令：在封装成 Skill 时，由于前面提到的 Bug（--command 配合 --format json 会失效退回纯文本），务必将所有指令动态拼接为纯文本字符串形式的 Prompt，传给 opencode run "..."，以确保 JSON 格式稳定。

## 5. 性能、死锁与超时机制
OpenCode 解决复杂开发任务时往往需要数分钟，甚至陷入自主纠错的“无限循环”。

* 强制设置硬超时（Hard Timeout）：封装 Skill 时，启动子进程（如 child_process.spawn）必须挂载超时器（例如 5~10 分钟）。一旦超时，Skill 必须能发送 SIGINT 或 SIGTERM 强行杀掉 OpenCode CLI，防止僵尸进程跑满服务器 CPU。
* 大文件阻塞风险：如果 OpenCode 在分析一个包含 node_modules 或 dist 的大工程，它的事件流 JSON 会极其庞大。在 Skill 运行的根目录下，务必确保放置了合法的 .gitignore 或 .opencodeignore 忽略这些干扰文件，否则 Skill 可能会因内存溢出或数据量过大而卡死。

------------------------------
## 💡 极简封装伪代码逻辑参考 (以 Node.js / TS 为例)
在编写这个 Skill 的核心逻辑时，推荐采用如下的防御性管道逻辑：

async function runOpenCodeSkill(prompt: string, sessionId?: string) {
  const args = ["run", "--format", "json", "--auto"]; // 1. 强制 JSON 和自动审批
  
  if (sessionId) {
    args.push("-s", sessionId); // 2. 锁定特定上下文，防止串台
  } else {
    args.push("--fork"); // 如果是新任务，建议安全分叉或创建新 Session
  }
  
  args.push(prompt); // 3. 传入拼接好的纯文本 Prompt（不使用 --command）

  const child = spawn("opencode", args, { cwd: "/safe/sandbox/path" }); // 4. 锁定沙盒目录

  // 5. 按行流式解析，不造成长连接阻塞
  const readline = createInterface({ input: child.stdout });
  readline.on("line", (line) => {
    try {
      const event = JSON.parse(line);
      // 将 event 包装并实时 push 给上层 Agent 框架（例如 LangChain/AutoGPT 的流）
    } catch (e) {
      // 容错处理
    }
  });

  // 6. 外部必须挂载 Timer 守护进程...
}

你是正在基于 LangChain / LlamaIndex 自定义这个 Skill，还是在为类似 AutoGPT / CrewAI 这样的多 Agent 系统编写执行插件？如果你愿意告诉我你所使用的 Agent 框架语言，我可以为你提供更针对性的 Skill 接入模版。

---------------

我认为**需要注意，而且比技术实现更重要的是架构边界**。

很多团队把 Claude Code、OpenCode、Codex CLI 当成"一个更聪明的 shell"来调用，结果最后整个系统变成：

```
Skill
↓

OpenCode

↓

OpenCode

↓

OpenCode
```

最后 Prompt 套 Prompt，调试非常痛苦。

如果我是做 Enterprise Research Agent，我会把 OpenCode CLI 当成**一个可推理的 Tool**，而不是 Runtime。

---

# 我建议的原则

整个系统最好只有一个地方负责推理。例如

```
Research Runtime
        │
        ▼
  Mechanical Tools
(AST/Graph/Search)
        │
        ▼
     OpenCode CLI
        │
        ▼
 Structured Result
```

不要：

```
Skill A

↓

OpenCode

↓

Skill B

↓

OpenCode

↓

Skill C

↓

OpenCode
```

这就是 Prompt Cascading。

---

# Skill不要把OpenCode当Shell

很多人写：

```
Run

opencode run "

Analyze repository

..."
```

我觉得这是比较差的设计。Skill 应该认为：

```
Research Tool

↓

Input

↓

Output JSON
```

也就是说：**Skill 不知道底层是谁**。今天：OpenCode，明天：Copilot CLI，后天：
Codex CLI，Skill 都不用改。建议定义：

```
RepositoryResearchTool

analyze()

summarize()

review()

```

OpenCode 只是实现。

---

# 输出必须结构化

这是我觉得最重要的一条。千万不要：

```
Markdown

↓

Markdown

↓

Markdown
```

应该：

```
JSON

↓

Validate

↓

Markdown
```

例如：

```json
{
  "findings": [],
  "evidence": [],
  "recommendations": [],
  "confidence": 0.91
}
```

这样：换模型完全没问题。

---

# Prompt Version

千万不要：

```
prompt.md
```

只有一个。建议：

```
prompt/

    repository-review.md

    architecture.md

    security.md

    performance.md
```

而且：

```
version

hash

```

一起记录。否则：以后根本不知道为什么结果变了。

---

# Context不要全部塞进去

这是 OpenCode 最大的问题。很多人：

```
Entire Repository

↓

LLM
```

我认为应该：

```
Repository

↓

Indexer

↓

Relevant Files

↓

Prompt
```

OpenCode 只看到：需要看的。

---

# Tool一定要可重放

例如：

```
Skill

↓

OpenCode

↓

Result
```

最好保存：

```
Prompt

Model

Arguments

Temperature

Response

```

以后：Regression Test 全部能跑。

---

# Skill不要依赖语言风格

例如：不要：

```
Find elegant design.
```

而应该：

```
Return

Pattern

Evidence

Confidence

Tradeoff
```

这样：

OpenAI

Claude

Gemini

OpenCode

一致性高很多。

---

# Prompt最好分层

例如：

System

```
Research Principle
```

Developer

```
Repository Analysis
```

User

```
Current Task
```

不要全部拼一个 Prompt。

---

# 建议支持Capability Detection

例如：

Skill：

```
Capability

↓

OpenCode

↓

Copilot

↓

Fallback
```

启动：

```
which opencode

↓

which github-copilot

↓

which codex
```

然后：

注册：

```
RepositoryResearch
```

Skill 根本不用关心。

---

# 不要让OpenCode做机械工作

例如：不要：

```
统计：

TS文件数量

Class数量

Import数量
```

这些：Script 100ms，OpenCode 几十秒。LLM 成本也高。

---

# 建议加入Artifacts

例如：

```
analysis/

    graph.json

    metrics.json

    evidence.json

    findings.json
```

OpenCode：直接消费。以后：Test 也简单。

---

# Test不要比较Markdown

建议：
以前：

```
Report.md
```

以后：

```
findings.json

evidence.json

recommendation.json
```

最后：Markdown 只是 Render。

---

# 我建议再加一层"Research Contract"

这是我觉得你目前整个项目还缺的一层，也是最值得补的。

不要让 Skill 直接调用 OpenCode CLI，而是在两者之间定义一个稳定的契约，例如：

```text
ResearchRequest
 ├── goal
 ├── scope
 ├── constraints
 ├── available_artifacts
 ├── expected_output_schema
 └── evaluation_criteria

↓

OpenCode / Copilot / Codex

↓

ResearchResponse
 ├── findings
 ├── evidence
 ├── confidence
 ├── unknowns
 ├── recommendations
 └── execution_metadata
```

这样做有几个长期收益：

* **Skill 与具体 CLI 解耦**：更换 OpenCode、Copilot CLI 或未来其他 Coding Agent，不需要修改 Skill。
* **测试更容易**：Golden Test 比较 `ResearchResponse`，而不是自然语言 Markdown。
* **可观测性更好**：可以记录 Prompt、模型、耗时、Token、退出码、重试次数等元数据。
* **方便并行**：未来 Architecture、Security、Performance 等多个 Skill 可以输出相同的 Contract，再由 Aggregator 合并。

---

## 如果是我的架构，我会这样分层

```
Skill
    │
Research Contract
    │
Research Runtime
    │
 ├── AST / Index / Graph / Metrics
 ├── Artifact Store
 └── CLI Adapter
         │
         ├── OpenCode CLI（首选）
         ├── Copilot CLI（自动降级）
         └── 未来其他 Coding Agent
```

这样真正需要变化的只有 **CLI Adapter**；Skill、脚本、测试和报告都建立在稳定的 Contract 之上。这种分层能最大限度地减少未来因模型或工具变化带来的维护成本，也符合你当前项目希望保持长期可演进、避免过度设计的目标。
