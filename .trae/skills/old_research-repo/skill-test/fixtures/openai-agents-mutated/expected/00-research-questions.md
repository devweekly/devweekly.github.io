# Research Questions — openai-agents (Mutated)

## Archetype

AI Agent — 基于 hasAgent/hasLLM/hasTool/hasPrompt 信号，但 Runner 相关源码证据已被移除。

## Top 5 Questions

### Q1: `src/agents/run.py` 是否存在？如果存在，它与 Agent 的关系是什么？
- **Why it matters**: Runner 是 Agent 执行模型的关键，但当前证据摘要未提供其源码。
- **Expected Evidence**: `src/agents/run.py` 文件、Agent 调用链
- **Hypothesis**: run.py 可能包含主循环，但需要源码确认。
- **Alternative**: Agent 可能自驱动执行，run.py 不存在或为薄包装。

### Q2: 在缺少 Runner 证据时，能否确认 Agent 是自驱动的？
- **Why it matters**: 不能从缺失的证据中推断架构。
- **Expected Evidence**: `src/agents/agent.py` 中是否存在执行循环
- **Hypothesis**: Agent 可能只声明能力，不自驱动。
- **Alternative**: Agent 内部可能包含完整执行逻辑。

### Q3: Tool 与 Agent 的交互边界在哪里？
- **Why it matters**: 即使执行模型未知，Tool 抽象仍是可研究的。
- **Expected Evidence**: `src/agents/tool.py`、`tests/test_agent.py`
- **Hypothesis**: Tool 是纯函数式接口。
- **Alternative**: Tool 可能直接访问 Agent 内部状态。

### Q4: Context 对象是否独立于执行模型？
- **Why it matters**: Context 可能是与 Runner 无关的独立设计。
- **Expected Evidence**: `src/agents/_run_context.py`
- **Hypothesis**: Context 显式传递，不依赖 Runner。
- **Alternative**: Context 可能仅在 Runner 驱动下才有效。

### Q5: 当前证据摘要缺少哪些 Runner 相关证据？
- **Why it matters**: 这是测试 Skill Honest Limits 的关键问题。
- **Expected Evidence**: run.py 源码、run tests、架构文档
- **Hypothesis**: 缺少主循环与 Agent-Runner 调用链证据。
- **Alternative**: 证据可能在其他路径未被发现。

## Filtered Out

- "Runner 为什么存在？" — 原始 Runner 证据已被移除，无法作为可验证问题保留。
