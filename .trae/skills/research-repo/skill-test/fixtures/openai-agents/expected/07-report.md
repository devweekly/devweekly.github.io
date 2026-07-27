# Research Report — openai-agents

## Executive Summary

OpenAI Agents SDK 是一个轻量级 Agent 执行框架。它最重要的工程洞察是：通过 Runner-centric 设计把 Agent lifecycle、tool calling 与 context propagation 从 Agent 类中剥离，使单 Agent 执行路径更清晰。读者应优先阅读 `src/agents/run.py` 与 `src/agents/_run_context.py`。

## Top Claims

### Claim 1: Runner 是执行核心，Agent 主要负责能力声明

**Why it holds**:
- Evidence: `src/agents/run.py:L120` main loop
- Coverage: Code + Test
- Quality: Verified

**Why it might be wrong**:
- Alternative explanation: Agent 内部仍保留自治执行逻辑，Runner 只是入口。
- Missing evidence: Agent 所有 public 方法被 Runner 调用的完整路径。

**Why it matters**:
没有这个洞察，读者会误以为 Agent 类包含主循环，从而错误地扩展框架。

### Claim 2: Context 被显式传递以避免隐式全局状态

**Why it holds**:
- Evidence: `src/agents/_run_context.py`
- Coverage: Code
- Quality: Partially Verified

**Why it might be wrong**:
- Alternative explanation: 拆分只是模块组织，没有状态管理意图。

**Why it matters**:
显式 Context 使单步执行可测试，也决定多 Agent 编排是否可行。

### Claim 3: Tool 接口与 Runner 解耦，工具错误由 Runner 捕获

**Why it holds**:
- Evidence: `src/agents/tool.py`、`tests/test_agent.py`
- Coverage: Code + Test
- Quality: Verified

**Why it might be wrong**:
- Missing evidence: 缺少 Tool 失败时的错误传播路径源码。

**Why it matters**:
Tool 边界决定外部集成是否稳定，也影响安全沙箱设计。

## Appendix

- **Reading Guide**: 先读 `src/agents/run.py` 主循环，再读 `src/agents/_run_context.py`，最后读 `src/agents/tool.py`。
- **Open Questions**: Memory 是否完全由外部提供；多 Agent 编排的推荐模式。
- **What NOT to Learn**: 不要寻找数据库优化器或 IDE 插件架构，这与本仓库无关。

## Quality Gate

1. **What would invalidate this report?** 如果发现 Agent.run() 内部存在独立主循环。
2. **What is most likely to be disagreed with?** Claim 2 关于 Context 拆分意图，因为目前仅基于文件结构推断。
3. **Is any Claim pretending to be certain when it should be Unknown?** Claim 2 为 Partially Verified，已诚实标注。
