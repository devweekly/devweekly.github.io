# Hypotheses — DuckDB

### H1: DuckDB 采用 Vectorized Execution 以最大化分析型查询吞吐
- **先验置信度**: 40%
- **支持证据**: `src/execution/operator/aggregate/physical_hash_aggregate.cpp`、`test/sql/aggregate/simple_aggregate.test`
- **若成立，意味着什么**: 执行层围绕批量数据设计，算子间传递向量而非单条记录。
- **若不成立，意味着什么**: 可能是 hybrid 模型，仅在部分算子使用向量化。
- **如何验证**: 阅读 operator base class 与 chunk 传递逻辑。

| 证据来源 | 置信度变化 | 原因 |
|----------|------------|------|
| 先验 | 40% | 源码目录命名提示 |
| physical_hash_aggregate.cpp | 70% | 出现 vector/chunk 操作 |
| test/sql/aggregate/ | 85% | 测试验证聚合结果正确 |

### Competing Hypothesis
- **陈述**: DuckDB 实际使用 Volcano iterator，向量操作只是局部优化。
- **先验置信度**: 30%
- **置信度**: 25%
- **为何不如主假设**: 测试与源码中 chunk 结构贯穿多个算子。
- **如何证伪竞争假设**: 找到 pull-based next() 接口并确认其非主路径。
