# Hypotheses — readme-claims-code-doesnt

### H1: README 中关于分布式事务的声明在代码中未实现
- **先验置信度**: 60%
- **支持证据**: evidence-brief.md 中 "No source files contain transaction/distributed/commit/rollback/xa"
- **若成立，意味着什么**: 不能信任 README 的功能声明，需要源码验证。
- **若不成立，意味着什么**: 实现使用了不同术语或位于外部依赖。
- **如何验证**: 全局搜索 transaction / distributed / commit / rollback / xa 关键词。

| 证据来源 | 置信度变化 | 原因 |
|----------|------------|------|
| 先验 | 60% | README 声称但无代码匹配 |
| 缺少源码证据 | 80% | 关键词未命中 |
| 缺少测试证据 | 85% | 无相关测试 |

### Competing Hypothesis
- **陈述**: 分布式事务通过外部库实现，因此源码中不出现相关关键词。
- **先验置信度**: 25%
- **置信度**: 15%
- **为何不如主假设**: 外部依赖也应在 import/require 中体现事务相关库。
- **如何证伪竞争假设**: 检查依赖清单是否包含分布式事务框架。
