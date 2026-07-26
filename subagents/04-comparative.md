<!-- Target output: 04-comparative.md -->
<!-- Repo: pi | Lang: zh -->

# 对比分析 — pi

将 pi 与**以下显式列出的项目**进行对比，输出到 `04-comparative.md`。

**只允许对比以下项目**（禁止自行编造其他项目）：
- OpenAI Agents SDK
- LangGraph
- Claude Code
- Codex
- AutoGen
- CrewAI
- MCP

必读输入：
- `evidence-brief.md`
- `02-ontology.md`
- `RQ-001-architecture-pattern.md` 与 `RQ-002-llm-provider-isolation.md`
- `03-cross-validation.md`

输出结构：

## 对比维度

| 维度 | pi | OpenAI Agents SDK | LangGraph | 差异含义 |
|------|-------------|-------------------|-----------|----------|

维度建议：
- 架构模式（Plugin / Pipeline / Graph / Monolith）
- Agent 编排方式
- Prompt / Tool 生命周期
- Guardrails 深度
- 可扩展性机制
- 测试/Eval 策略

## 可复用模式

- 哪些做法值得迁移到其它项目？
- 需要满足什么前提条件？

## 反模式警告

- 哪些设计选择可能在其它场景下成为陷阱？