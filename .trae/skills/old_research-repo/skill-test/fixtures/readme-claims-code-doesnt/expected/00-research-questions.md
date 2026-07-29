# Research Questions — readme-claims-code-doesnt

## Archetype

Library/SDK — 基于 hasMain/hasExports 信号，但证据有限。

## Top 5 Questions

### Q1: README 声称支持分布式事务，但代码中缺少相关实现，应如何验证？
- **Why it matters**: 文档与代码不一致时，必须优先相信代码。
- **Expected Evidence**: 源码中 transaction / distributed / commit / rollback / xa 关键词
- **Hypothesis**: README 描述的是规划功能，尚未实现。
- **Alternative**: 相关实现使用了不同的术语或位于外部依赖中。

### Q2: 如果分布式事务未实现，当前的本地事务模型是什么？
- **Why it matters**: 即使缺少分布式能力，仍可能存在简单的事务语义。
- **Expected Evidence**: 源码中任何状态管理或持久化代码
- **Hypothesis**: 项目可能仅提供单节点内存状态。
- **Alternative**: 可能依赖调用方处理一致性。

### Q3: 该 Library 的核心抽象边界在哪里？
- **Why it matters**: 证据不足时，需要最小化可信结论。
- **Expected Evidence**: `src/` 入口文件、导出声明
- **Hypothesis**: 项目是一个轻量工具库。
- **Alternative**: 可能是一个未完成的框架。

### Q4: 测试覆盖能否验证 README 中的其他声明？
- **Why it matters**: 需要判断 README 中哪些声明有代码/测试支持。
- **Expected Evidence**: `tests/` 目录内容
- **Hypothesis**: 测试仅覆盖基础功能。
- **Alternative**: 可能测试缺失是因为功能通过集成验证。

### Q5: 缺少哪些证据才能确认项目的真实能力？
- **Why it matters**: 诚实标注 Unknown 比猜测更重要。
- **Expected Evidence**: 文档、源码、测试、配置
- **Hypothesis**: 需要更多源码阅读和外部文档交叉验证。
- **Alternative**: 无。

## Filtered Out

- "为什么采用 Vectorized Execution？" — 无数据库证据，已过滤。
- "Agent lifecycle 如何设计？" — 无 AI Agent 证据，已过滤。
