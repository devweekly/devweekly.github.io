最近几天 AI Agent 圈里确实开始热议 **Graph Engineering（图工程）**，很多人把它说成是继 Prompt Engineering、Context Engineering、Loop Engineering 之后的下一阶段。不过需要说明的是：

> **它目前不是一个学术界或工业界已经统一定义的术语，而是社区最近（2026 年 7 月中下旬）形成的一个新概念。** ([AI Builder Club By AI Jason][1])

它的出现，大概可以追溯到 OpenClaw 作者 Peter Steinberger 在 X 上提出的讨论：

> **"Are we still talking loops or did we shift to graphs yet?"**

随后很多博客、社区和开源项目开始讨论 "Graph Engineering"。

---

## 为什么会从 Loop Engineering 演变出来？

Loop Engineering 的核心思想是：

```
Observe
→ Think
→ Act
→ Verify
→ Repeat
```

一个 Agent 在一个反馈闭环（Feedback Loop）中不断工作。

例如 Claude Code、Codex、OpenHands 都属于这一类。

Loop Engineering 关注的是：

* 如何设计循环
* 如何退出
* 如何 Retry
* 如何 Verification
* 如何 Memory

换句话说：

> **重点是"一个 Agent 如何不断完成任务"。** ([Loop Engineering][2])

---

## Graph Engineering 想解决什么？

很多团队发现，当 Agent 数量开始增加以后，一个 Loop 已经不够了。

例如：

```
Research
      ↓
Planner
      ↓
Retriever
      ↓
Analyzer
      ↓
Verifier
      ↓
Report
```

实际上：

Research 里面可能还有自己的 Loop。

Retriever：

```
Search
→ Rank
→ Retry
→ Search
```

Verifier：

```
Check
→ Reproduce
→ Retry
```

Planner：

```
Plan
→ Evaluate
→ Re-plan
```

于是整个系统已经不是：

> 一个 Loop

而变成：

> **很多 Loop 组成的一张图（Graph）。**

Graph Engineering 就是开始研究：

> **如何设计这些 Loop 之间的关系。** ([Eigent][3])

---

## 它比 Loop 多了什么？

简单来说：

| Loop Engineering | Graph Engineering |
| ---------------- | ----------------- |
| 一个 Agent         | 多个 Agent          |
| 一个反馈循环           | 多个 Feedback Loop  |
| 一个状态             | 全局 State          |
| 一个 Memory        | Shared Memory     |
| 一个 Exit          | Graph Termination |
| Tool 调用          | Agent Routing     |
| Retry            | Recovery Graph    |
| Prompt           | Workflow          |

可以理解成：

> Loop 是节点内部。

> Graph 是节点之间。

很多文章甚至直接说：

> Every node is still a loop.

也就是说：

**Graph 并没有替代 Loop，而是把多个 Loop 组织起来。** ([AI Builder Club By AI Jason][1])

---

## Graph Engineering 真正新增关注的内容

目前社区讨论最多的是下面几个方面：

### 1. Routing

哪个 Agent 应该接任务？

例如：

```
Question
      ↓
  Classifier
   ↙      ↘
Research   Coding
```

以前 Loop 不关心。

Graph 必须关心。

---

### 2. Ownership

谁负责这一块？

例如：

Planner

不能直接改代码。

Coder

不能直接发布。

Verifier

不能修改 Report。

Graph 开始引入：

* Ownership
* Authority
* Permission

这些概念。 ([CodesDevs][4])

---

### 3. Shared State

以前：

Loop 自己维护 Context。

现在：

Graph 维护：

* State
* Memory
* Blackboard
* Artifact

例如：

Research Report

所有 Agent 都共享。

---

### 4. Recovery

如果：

Verifier Fail

不是整个 Loop Retry。

而是：

```
Verifier
      ↓
Back to Analyzer
```

Graph 开始有：

Recovery Edge。

---

### 5. Human Gate

例如：

```
Publish
      ↓
Human Approval
      ↓
Deploy
```

Graph 可以很自然表达：

Human-in-the-loop。

---

## 其实 LangGraph 很早就在做这件事

很多人觉得 Graph Engineering 是新东西。

实际上：

LangGraph 去年就在做：

* DAG
* Conditional Edge
* State
* Checkpoint
* Interrupt
* Resume
* Human Gate

Graph Engineering 更像是：

> **给这种 Agent 编排方式起了一个新的名字。**

最近还有论文明确提出，要把 Agent Loop 提升为显式的 Graph，通过静态图、调度器和状态机来提高可验证性和可调试性。([arXiv][5])

---

## 目前有没有统一定义？

**没有。**

目前网上至少有三种理解：

第一种（最主流）

> Graph = 多个 Loop。

第二种

> Graph = Agent Workflow DAG。

第三种

> Graph = Feedback Network。

甚至有文章说：

> **Graph Engineering is wiring loops together.**

也就是说：

Graph 本身不是重点。

真正重点是：

> 多个 Feedback Loop 如何互相约束、验证和纠错。 ([Eigent][3])

---

## 我对这个概念的判断

我认为它**不是一次技术革命，而是抽象层级的提升**。

过去几年的演进大致可以概括为：

| 阶段                    | 关注点                         |
| --------------------- | --------------------------- |
| Prompt Engineering    | 一次调用如何写 Prompt              |
| Context Engineering   | 一次调用能看到什么 Context           |
| Loop Engineering      | 一个 Agent 如何持续工作             |
| **Graph Engineering** | **多个 Agent、多个 Loop 如何协同工作** |

因此，更准确的说法应该是：

> **Graph Engineering 包含 Loop Engineering，而不是取代它。**

一个成熟的 Graph 通常由多个节点组成，而**每个节点内部依然运行着自己的 Loop**。这也是目前不少技术分析和社区讨论逐渐形成的共识。([AI Builder Club By AI Jason][1])

结合你最近一直在设计的 **Enterprise Research Agent**，我认为这个概念尤其值得关注，因为你的架构实际上已经非常接近 Graph Engineering：Research、Planning、Evidence Collection、Gap Detection、Verification、Report 等都天然可以建模为图节点，而每个节点内部再运行各自的推理和验证 Loop。这种分层方式比单一的大循环更容易控制状态、权限、恢复路径和可观测性。

[1]: https://www.aibuilderclub.com/blog/graph-engineering-vs-loop-engineering?utm_source=chatgpt.com "Graph Engineering vs Loop Engineering | AI Builder Club"
[2]: https://loopengineering.app/guides/what-is-loop-engineering/?utm_source=chatgpt.com "What Is Loop Engineering? AI Agent Loops Explained — Loop Engineering"
[3]: https://www.eigent.ai/blog/graph-engineering-ai-agents?utm_source=chatgpt.com "Graph Engineering for AI Agents"
[4]: https://codesdevs.io/notes/graph-engineering-ai-agents/?utm_source=chatgpt.com "What is graph engineering for AI agents? | CodesDevs Notes"
[5]: https://arxiv.org/abs/2604.11378?utm_source=chatgpt.com "From Agent Loops to Structured Graphs:A Scheduler-Theoretic Framework for LLM Agent Execution"


----------------------


我查阅了最近几天关于 **Graph Engineering** 的讨论、技术博客以及最新论文，发现这个概念比网上很多人总结得更有意思。

我的结论可以先放在前面：

> **Graph Engineering 并不是「Loop Engineering 2.0」。它真正代表的是 AI Agent 的工程关注点，从 Agent Behavior（行为）转向 Agent Organization（组织）。** ([AI Builder Club By AI Jason][1])

这其实意味着 AI Agent 开始进入类似软件架构的发展阶段。

---

# 一、为什么突然出现 Graph Engineering？

回顾近两年的发展，其实可以看到一个很明显的演化路径。

| 时间                  | 工程重点         | 解决的问题             |
| ------------------- | ------------ | ----------------- |
| Prompt Engineering  | 一次调用         | 怎么问模型             |
| Context Engineering | 输入管理         | 给模型什么信息           |
| Loop Engineering    | Agent        | Agent 如何持续完成任务    |
| Graph Engineering   | Agent System | 多个 Agent 如何组成一个系统 |

前三个层次，都把 **Agent 当成一个整体**。

Graph Engineering 第一次把 Agent 拆开来看：

> 一个复杂 Agent，其实应该是一群 Agent。

因此它开始讨论：

* Agent Organization
* Agent Topology
* Agent Collaboration
* Agent Governance

而不是 Prompt。([explainx.ai][2])

---

# 二、Loop Engineering 的天花板

Loop Engineering 的典型结构可以抽象成：

```text
Observe
↓
Think
↓
Act
↓
Verify
↓
Loop
```

无论 Claude Code

还是 OpenHands

还是 Codex

核心其实都是：

> 一个 Agent 不断循环。

Loop Engineering 的关注点包括：

* Tool Selection
* Retry
* Reflection
* Verification
* Memory
* Exit Condition

这一层已经很好了。

但是当任务越来越复杂，就出现一个问题。

例如：

一个 Enterprise Research。

里面其实有：

* Planner
* Researcher
* Retriever
* Analyzer
* Reviewer
* Writer

这些东西已经不是：

一个 Loop。

而是：

很多 Loop。

---

# 三、Graph Engineering 本质是什么？

Graph Engineering 最重要的一句话：

> **Loop describes behavior. Graph describes organization.** ([explainx.ai][2])

这是很多文章容易忽略的一点。

Graph 关注的是：

不是：

Agent 在干什么。

而是：

Agent 之间是什么关系。

例如：

```
Research
      ↓
Evidence Collection
      ↓
Analysis
      ↓
Verification
      ↓
Report
```

这里：

每一个节点：

仍然可以运行自己的 Loop。

Graph 负责的是：

节点之间：

* 谁调用谁
* 谁等待谁
* 谁拥有状态
* 谁可以失败
* 谁可以恢复

---

# 四、Graph Engineering 真正新增的工程问题

这也是我认为最有价值的地方。

## 1）Topology（拓扑）

以前：

一个 Loop。

现在：

开始出现：

* Tree
* DAG
* Cyclic Graph
* Dynamic Graph

例如：

Research 可以：

Fan-out

```
Research
 ├─ GitHub
 ├─ Confluence
 ├─ Jira
 └─ Internet
```

最后：

Fan-in

变成一个 Summary。

Loop 已经表达不了这种结构。

---

## 2）Routing

Graph 开始有：

Routing。

例如：

```
Question

↓

Classifier

↓

Research
Coding
Search
```

谁应该执行？

谁不应该执行？

这是 Graph 的问题。

不是 Prompt 的问题。

---

## 3）State Ownership

以前：

Context 就是一段 Prompt。

现在：

Graph 开始有：

Shared State。

例如：

Evidence

不是 Prompt。

而是：

Artifact。

每个 Agent：

都读取：

Evidence。

但是：

只有某些 Agent：

可以修改。

于是开始有：

Ownership。

---

## 4）Synchronization

Graph 必须考虑：

多个 Agent：

什么时候同步。

例如：

```
Search A

Search B

Search C

↓

Merge
```

什么时候：

Merge？

全部完成？

还是：

Majority？

还是：

Timeout？

Loop 不关心。

Graph 必须关心。

---

## 5）Recovery Graph

这是我认为最大的变化。

以前：

失败：

Retry。

现在：

失败以后：

Graph 可以：

```
Verifier
      ↓
Analyzer
      ↓
Verifier
```

甚至：

```
Verifier

↓

Planner

↓

重新规划
```

Recovery：

开始变成：

Graph。

而不是：

while(true)。

---

## 6）Governance

这是企业里面特别重要。

例如：

Deploy：

不能直接执行。

必须：

```
Deploy Request

↓

Human Approval

↓

Deploy
```

Graph：

天然支持：

* Human Gate
* Permission
* Escalation
* Audit

这也是企业 Agent 最需要的。([arXiv][3])

---

# 五、为什么说它更像软件架构？

这是我自己的一个观察。

Prompt Engineering：

像：

写 SQL。

Loop Engineering：

像：

写一个函数。

Graph Engineering：

更像：

设计整个系统。

它开始出现很多软件架构概念。

例如：

| 软件架构         | Graph Engineering |
| ------------ | ----------------- |
| Service      | Agent             |
| API          | Edge              |
| Message      | State             |
| Workflow     | Graph             |
| Saga         | Recovery Edge     |
| Event Bus    | Shared State      |
| Orchestrator | Supervisor        |

所以：

很多架构师会觉得：

很熟悉。

因为：

Graph Engineering：

其实就是：

把软件架构：

搬到了 Agent。

---

# 六、为什么 LangGraph 火？

很多人说：

Graph Engineering 是新东西。

其实：

LangGraph 一年前就在干这个。

它提供：

* StateGraph
* Conditional Edge
* Checkpoint
* Interrupt
* Resume
* Human Approval
* Typed State

真正的新变化不是 LangGraph。

而是：

整个行业开始认识到：

> Agent 不应该只是一个 Loop。([arXiv][4])

---

# 七、真正值得关注的趋势：Graph ≠ Workflow

我认为目前网上最大的误解就是：

很多人认为：

Graph = Workflow。

其实不是。

Workflow：

通常：

固定。

例如：

A

↓

B

↓

C

Graph：

可以：

动态。

例如：

```
Planner

↓

生成新的节点

↓

动态加入 Graph

↓

删除节点

↓

重新 Routing
```

Graph：

本身：

也是运行时数据。

而不是：

静态流程。

很多文章开始把这种称作：

**Living Graph**

或者：

**Runtime Graph**。([arXiv][3])

---

# 八、Graph Engineering 下一步可能是什么？

结合最近几篇论文，我认为未来 1~2 年的发展重点不会停留在「画图」或「多 Agent 编排」，而会进一步演进到几个方向：

| 下一阶段                 | 关注点                                        |
| -------------------- | ------------------------------------------ |
| Graph + Ontology     | Graph 不只是流程，还显式表达企业实体、关系和语义约束。             |
| Graph + Memory       | Memory 不再属于单个 Agent，而是挂载到 Graph 节点、边或共享状态。 |
| Graph + Provenance   | 每个结论都能追溯到来源、推理路径和责任节点。                     |
| Graph + Verification | 将验证节点内建到图中，而不是事后补充。                        |
| Self-evolving Graph  | 根据历史执行效果自动重组节点、调整路由和优化拓扑。                  |

这些方向已经能在近期关于 Graph 工作流、Context Graph 和多 Agent 治理的论文中看到雏形。([arXiv][4])

---

# 九、结合你的 Enterprise Research Agent，我认为真正值得借鉴的不是“Graph”这个词，而是 Graph 背后的设计思想

从我们之前讨论过的 Enterprise Research Agent 架构来看，你的设计已经天然符合 Graph Engineering 的思路：Research、Evidence Collection、Hypothesis、Gap Detection、Verification、Report 都可以视为独立节点，每个节点内部保留自己的推理与验证 Loop，而图负责管理节点之间的依赖、状态共享、证据流转和恢复路径。

不过，我建议不要把重点放在“多 Agent”本身，而是放在三个更有价值的工程能力上：

1. **Evidence Graph**：让每个中间结论都引用具体证据，并形成可追踪的依赖关系，而不是只有最终报告。
2. **Artifact Graph**：把 Hypothesis、Evidence、Finding、Decision、Report 都作为一等对象（Artifact）管理，Agent 只是消费和生产这些对象。
3. **Verification Graph**：将事实校验、冲突检测、来源一致性检查等作为图中的固定节点，而不是最后统一做一次 Review。

这三点比单纯增加 Agent 数量更符合 Graph Engineering 的长期发展方向，也与你一直追求的“Research Report 每条结论都必须可论证、可追踪 Source”的目标高度一致。

[1]: https://www.aibuilderclub.com/blog/graph-engineering-guide-2026?utm_source=chatgpt.com "Graph Engineering Guide (2026)"
[2]: https://explainx.ai/blog/graph-engineering-ai-agents-multi-agent-organizations-2026?utm_source=chatgpt.com "Graph Engineering: Wire Multi-Agent Orgs After Loops (2026)"
[3]: https://arxiv.org/abs/2607.10878?utm_source=chatgpt.com "LOGOS: A Living Logic for AI Agent Teams That Evolve With Humans"
[4]: https://arxiv.org/abs/2607.19297?utm_source=chatgpt.com "Graph-Based Agentic AI with LangGraph: Workflow Pathways for Long-Running Stateful Business Processes"
