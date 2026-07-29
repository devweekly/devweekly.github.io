# Hypotheses — openai-agents

### H1: Runner 是 OpenAI Agents SDK 的核心编排器，Agent 只是配置容器
- **先验置信度**: 45%
- **支持证据**: `src/agents/run.py:L120` main loop、`src/agents/agent.py`
- **若成立，意味着什么**: 理解 Runner 就能理解执行流程，Agent 类主要声明能力。
- **若不成立，意味着什么**: Agent 拥有自治执行逻辑，Runner 只是薄包装。
- **如何验证**: 阅读 run.py 主循环与 agent.py 方法调用关系。

| 证据来源 | 置信度变化 | 原因 |
|----------|------------|------|
| 先验 | 45% | README 与目录结构 |
| run.py main loop | 75% | Runner 明显包含执行循环 |
| tests/test_run.py | 85% | 测试直接测试 Runner 行为 |

### Competing Hypothesis
- **陈述**: Agent 自身拥有执行逻辑，Runner 只是便捷入口。
- **先验置信度**: 35%
- **置信度**: 20%
- **为何不如主假设**: 测试与源码都以 Runner 为测试主体。
- **如何证伪竞争假设**: 找到 Agent.run() 内部独立 loop。
