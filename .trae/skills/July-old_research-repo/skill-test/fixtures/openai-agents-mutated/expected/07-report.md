# Research Report — openai-agents (Mutated)

## Executive Summary

OpenAI Agents SDK 是一个轻量级 Agent 框架。由于 Runner 相关源码证据被移除，本报告无法确认 Runner-centric 执行模型是否成立。读者应优先验证 `src/agents/run.py` 是否存在并包含主循环。

## Top Claims

### Claim 1: OpenAI Agents SDK 提供 Agent 与 Tool 抽象

**Why it holds**:
- Evidence: `src/agents/agent.py`、`src/agents/tool.py`
- Coverage: Code
- Quality: Partially Verified

**Why it might be wrong**:
- Missing evidence: 缺少 Agent 与 Tool 交互的测试覆盖。

**Why it matters**:
即使执行模型未知，Agent/Tool 抽象仍是框架的基础。

### Claim 2: Context 被显式传递

**Why it holds**:
- Evidence: `src/agents/_run_context.py`
- Coverage: Code
- Quality: Partially Verified

**Why it might be wrong**:
- Missing evidence: 缺少 Context 在 Agent 与 Tool 之间传递的完整路径。

**Why it matters**:
显式 Context 设计影响可测试性与多 Agent 编排可能性。

### Claim 3: Runner-centric 模型证据不足，应标注 Unknown

**Why it holds**:
- Evidence: 原始 Runner 证据已被移除。
- Coverage: None
- Quality: Unknown

**Why it might be wrong**:
- Alternative explanation: Runner 代码可能存在于其他路径，但当前证据摘要未提供。

**Why it matters**:
在缺少 run.py 的情况下声称 run.py 主导执行循环，会造成幻觉。

## Appendix

- **Reading Guide**: 优先确认 `src/agents/run.py` 是否存在及其与 agent.py 的调用关系。
- **Open Questions**: Runner 是否存在；Agent 是否自驱动执行。
- **What NOT to Learn**: 不要从缺失的证据中推断 Runner 设计。

## Quality Gate

1. **What would invalidate this report?** 如果后续发现 `src/agents/run.py` 并证明其为主循环。
2. **What is most likely to be disagreed with?** Claim 3 可能被认为过于保守。
3. **Is any Claim pretending to be certain when it should be Unknown?** Claim 3 已明确标注 Unknown。
