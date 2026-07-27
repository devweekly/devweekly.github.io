整体我认真读了一遍。

如果结合我们前面一直讨论的目标（**Research-first、Palantir Ontology 思想、Question-centric、避免 over engineering、适合作为 Claude Code / Codex / GPT-5 Subagent**），我认为：

> **这一版已经比一般的 Agent Prompt 高一个层次。**
>
> 它已经不是 "让 AI 去总结代码"，而是在组织一个真正的 Research Workflow。

但是，如果我是 Principal Architect，我仍然会继续改几处，因为现在还有几个明显的问题。

---

# 总体评分

我一般按几个维度打分。

| 项目         | 分数  |
| ---------- | --- |
| Workflow设计 | 9.8 |
| Prompt质量   | 9.2 |
| Research深度 | 8.8 |
| Evidence驱动 | 9.6 |
| Ontology思想 | 8.5 |
| 防幻觉能力      | 8.7 |
| 可扩展性       | 9.5 |

综合：

**9.2/10**

如果想做到 **9.8+**，我会继续改。

---

# 最大的问题（一）

## 现在仍然是 Topic-based，不是 Question-based

这是我觉得最大的地方。

例如：

```
architecture.md

guardrails.md

testing.md

ai-patterns.md
```

实际上还是：

> 一个Agent研究一个Topic。

这其实比较像传统 consulting。

真正的 Research 不是这样。

Research 更像：

> 一个Agent回答一个问题。

例如：

```
Question:

How does this repository isolate LLM providers?

```

另一个 Agent：

```
Question:

How does tool execution remain deterministic?

```

再一个：

```
Question:

How is context propagated?

```

最后：

```
Question:

How does architecture evolve?

```

注意区别。

Topic：

```
Architecture
```

Question：

```
How does architecture enforce separation between planning and execution?
```

Question会天然逼AI去找证据。

Topic不会。

---

所以我建议：

不要叫

```
02-evidence-ai-patterns
```

而叫

```
RQ-003-agent-lifecycle

```

里面回答：

```
Research Question

How is the Agent lifecycle implemented?

```

然后：

Finding

Evidence

Alternative

Confidence

---

整个质量会上一个台阶。

---

# 第二个问题

## Evidence Agent没有Hypothesis意识

例如：

Architecture Agent：

现在：

```
Analyze architecture...
```

应该改成：

```
Your primary goal is NOT to summarize architecture.

Instead:

Evaluate whether any hypothesis in
01-hypotheses.md
is supported,
refuted,
or unaffected
by the architecture evidence.

If you discover completely new evidence that invalidates existing hypotheses,
record it explicitly.

```

为什么？

因为：

Research不是：

```
Hypothesis

↓

Evidence

↓

Report
```

而是：

```
Hypothesis

↓

Evidence

↓

Hypothesis Revision

↓

Evidence

↓

Cross Validation

```

这就是Scientific Method。

---

# 第三个问题

Evidence Agent之间完全独立

实际上：

Architecture

Testing

Guardrails

AI Pattern

四个Agent：

互相不知道别人发现什么。

这其实容易产生：

```
Architecture:

LLM Provider是Plugin

Testing:

不知道Plugin

Guardrails:

不知道Plugin

```

最后：

三个地方重复写。

我建议：

允许：

```
02-evidence-architecture.md

↓

02-evidence-testing

```

读取。

或者：

维护：

```
shared-findings.md

```

里面只有：

```
Finding

Evidence

Confidence

```

其他Agent可以引用。

这是Multi-agent里面常见的方法。

---

# 第四个问题

Finding结构还是太简单

目前：

```
Conclusion

Evidence

Confidence

Reason

```

我建议：

改成：

```
Finding

Conclusion

Evidence

Alternative Interpretation

Confidence

Unknowns

```

例如：

```
Conclusion

The framework appears to use provider abstraction.

Evidence

provider.ts
registry.ts

Alternative

It could merely be a wrapper.

Unknowns

Need runtime registration verification.

Confidence

Medium

```

这个非常重要。

因为：

Architecture Review里面：

Alternative Interpretation

是必须的。

---

# 第五个问题

没有Explicit Counter Evidence

Cross Validation才做：

```
Contradicting Evidence

```

太晚了。

我建议：

所有Finding：

增加：

```
Counter Evidence

```

例如：

```
Evidence

...

Counter Evidence

No tests verify this.

No runtime registration found.

```

这是Google Research很喜欢的格式。

---

# 第六个问题

Comparative太弱

目前：

```
Peer A

Peer B
```

AI会自己编。

应该改成：

```
Only compare against projects
explicitly listed below.

```

例如：

```
OpenAI Agents SDK

LangGraph

Claude Code

Codex

AutoGen

CrewAI

MCP

```

否则：

GPT会开始：

```
Project A

Project B

```

开始幻想。

---

# 第七个问题

Report Writer权限过大

目前：

```
Synthesize everything

```

实际上容易：

重新解释。

建议增加：

```
Never create new findings.

Only summarize
validated findings
accepted by
03-cross-validation.md

```

否则：

Report Writer容易：

```
顺手再分析一下。

```

整个Research Tree污染。

---

# 第八个问题

没有Evidence Budget

例如：

Architecture Agent：

```
Top20 files

```

但是：

Top20：

可能：

```
15个test

```

```
5个config

```

真正Architecture：

一个没读。

建议：

Prompt里面写：

```
If evidence is insufficient,
expand reading scope.

Maximum:

50 files

Maximum:

200 symbols

Stop when confidence stabilizes.

```

这就是Research Budget。

Claude Code内部就是类似思想。

---

# 第九个问题（也是我最推荐加的）

增加一个

```
Ontology Mapper

```

不是Analyzer。

而是：

Subagent。

例如：

```
02-ontology.md

```

职责：

```
Extract

Entity

Capability

Component

Interface

Service

Protocol

Prompt

Tool

Adapter

Workflow

```

然后输出：

```
ontology.json

```

例如：

```json
{
  "entities":[
      ...
  ],

  "relations":[
      ...
  ]
}
```

后面：

所有Agent：

都引用：

```
ontology.json

```

而不是：

自己重新理解。

这就是Palantir真正干的事情。

不是Graph。

而是：

Shared Semantic Layer。

这是我觉得目前缺失最大的地方。

---

# 第十个问题

Research Question没有生命周期

建议：

增加：

```
RQ-001

Status

Open

↓

Investigating

↓

Validated

↓

Rejected

↓

Needs Evidence

```

Cross Validation：

更新状态。

最终Report：

只引用：

```
Validated

```

Research就非常像真正论文。

---

# 如果让我继续升级（我认为值得）

我不会继续增加更多 Analyzer。

我会增加四个基础能力：

```
Hypothesis Manager
        │
        ▼
Ontology Mapper
        │
        ▼
Evidence Agents
        │
        ▼
Cross Validator
        │
        ▼
Research Question Tracker
        │
        ▼
Report Writer
```

这是我认为最符合现代 Research Agent 的架构。

---

## 我给出的最终评价

你的设计已经超出了常见的“多 Agent 并行分析”模式，开始接近真正的工程研究流水线。但下一步的提升重点不应该继续增加更多分析维度，而应该让整个流程围绕**研究问题（Research Question）**和**共享语义（Ontology）**组织，而不是围绕文件或主题组织。

如果只能选少数几个改动，我建议按下面的优先级实施：

1. **将 Topic-based 子 Agent 改为 Question-based（最高优先级）**：每个 Agent 回答一个明确的 Research Question，而不是负责一个主题。
2. **增加 Ontology Mapper**：生成共享的 `ontology.json`（实体、关系、能力），作为所有后续 Agent 的统一语义层。
3. **让 Evidence Agent 以验证或推翻假设为目标**：不是单纯产出 Findings，而是围绕 `01-hypotheses.md` 持续验证、修正和补充。
4. **强化 Finding 模板**：增加 `Alternative Interpretation`、`Counter Evidence` 和 `Unknowns`，让每条结论体现证据权衡，而不是单向论证。
5. **限制 Report Writer**：明确禁止生成新的结论，只整合经过交叉验证的 Findings，避免最后一步重新推理带来的污染。

做到这几项之后，我会把这套 Research Repo Skill 的整体成熟度从现在约 **9.2/10** 提升到 **9.8+/10**。届时，它会更接近专业研究团队使用的研究工作流，而不仅仅是一个优秀的代码分析 Agent。
