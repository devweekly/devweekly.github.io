# Research Questions — openai-agents

## Archetype

AI Agent — 基于 hasAgent/hasLLM/hasTool/hasPrompt 信号，以及 agent.py / run.py / tool.py / _run_context.py 等核心源码证据。

## Top 5 Questions

### Q1: Runner 为什么存在？为什么不让 Agent 自己管理执行循环？
- **Why it matters**: Runner-centric 模型是 OpenAI Agents SDK 与其他 Agent 框架最大的架构差异。
- **Expected Evidence**: `src/agents/run.py:L120` main loop、`tests/test_run.py`
- **Hypothesis**: Runner 统一处理 lifecycle、tool calling、error handling，Agent 只负责配置与能力声明。
- **Alternative**: Agent 自驱动模型（如 LangGraph 的 graph node）可能更灵活但更难调试。

### Q2: Context 被拆成多个文件（_run_context.py / context propagation），这是为了避免什么？
- **Why it matters**: Context 拆分影响状态传递、可测试性和多 Agent 编排。
- **Expected Evidence**: `src/agents/_run_context.py`
- **Hypothesis**: 显式 Context 对象避免隐式全局状态，使单步执行可观测。
- **Alternative**: 可能只是为了模块拆分，没有深层设计意图。

### Q3: Tool 的抽象边界在哪里？工具调用如何与 Runner 解耦？
- **Why it matters**: Tool 是 Agent 与外部世界交互的唯一通道，边界决定可测试性。
- **Expected Evidence**: `src/agents/tool.py`、`tests/test_agent.py`
- **Hypothesis**: Tool 是纯函数式接口，Runner 负责序列化/反序列化与错误捕获。
- **Alternative**: Tool 可能直接访问 Runner 内部状态以简化实现。

### Q4: 为什么框架不提供内置 Memory，而是让外部存储解决？
- **Why it matters**: Memory 是 Agent 长期行为的关键，但 SDK 选择保持轻量。
- **Expected Evidence**: agent.py 构造函数、README 文档
- **Hypothesis**: 内置 Memory 会引入状态管理复杂度，SDK 优先保证单轮执行清晰。
- **Alternative**: 可能通过 Context 字段隐式传递短期记忆。

### Q5: Agent 生命周期方法（setup / run / teardown）是否真的被 Runner 调用？
- **Why it matters**: 生命周期接口如果仅存在于类定义而未被框架调用，则是装饰性抽象。
- **Expected Evidence**: `src/agents/agent.py`、`src/agents/run.py`
- **Hypothesis**: Runner 显式调用 lifecycle hook，使 Agent 行为可扩展。
- **Alternative**: lifecycle 方法可能由用户代码调用，框架只负责 run()。

## Filtered Out

- "为什么使用 Volcano Optimizer？" — 不是数据库，已过滤。
- "Eclipse Plugin 如何扩展？" — 不是 IDE，已过滤。
