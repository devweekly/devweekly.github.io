# Research Report — DuckDB

## Executive Summary

DuckDB 是一个进程内分析型数据库系统。它最重要的工程洞察是：通过向量化的执行模型和列式存储的协同设计，在单节点分析负载上取得了高吞吐与相对简洁实现的平衡。读者应优先阅读 `src/execution/operator/` 与 `src/optimizer/optimizer.cpp`。

## Top Claims

### Claim 1: DuckDB 使用 Vectorized Execution 而非 Volcano Iterator 模型

**Why it holds**:
- Evidence: `src/execution/operator/aggregate/physical_hash_aggregate.cpp`
- Coverage: Code + Test
- Quality: Verified

**Why it might be wrong**:
- Alternative explanation: 仅在部分算子使用向量化，其他算子仍为行级处理。
- Missing evidence: execution operator base class 的全局执行接口。

**Why it matters**:
没有这个洞察，读者会误以为 DuckDB 是可插拔算子的火山模型，从而错误地评估其性能特征。

### Claim 2: 优化器针对单节点 CPU/内存效率设计，而非分布式网络代价

**Why it holds**:
- Evidence: `src/optimizer/optimizer.cpp`
- Coverage: Code
- Quality: Partially Verified

**Why it might be wrong**:
- Missing evidence: 缺少分布式计划相关的 cost model 源码。

**Why it matters**:
理解优化器目标有助于判断哪些设计决策会迁移到分布式数据库，哪些不会。

### Claim 3: 列式存储与向量化执行在数据布局上协同设计

**Why it holds**:
- Evidence: `src/storage/table/column_segment.cpp`
- Coverage: Code
- Quality: Partially Verified

**Why it might be wrong**:
- Alternative explanation: 存储层独立实现，向量化在读取时做转换。

**Why it matters**:
如果两者是独立演进的，向量化收益可能被数据转换开销抵消。

## Appendix

- **Reading Guide**: 先读 `src/execution/operator/aggregate/physical_hash_aggregate.cpp`，再读 `src/optimizer/optimizer.cpp`，最后读 `src/storage/table/column_segment.cpp`。
- **Open Questions**: 事务与并发控制的完整设计尚未验证。
- **What NOT to Learn**: 不要复制任何 AI Agent 相关设计，DuckDB 不是 Agent 系统。

## Quality Gate

1. **What would invalidate this report?** 如果发现 DuckDB 主执行路径仍是行级 iterator。
2. **What is most likely to be disagreed with?** Claim 2 关于优化器目标的结论，因为缺少分布式相关证据。
3. **Is any Claim pretending to be certain when it should be Unknown?** Claim 1 基本验证，Claim 2 与 3 为 Partially Verified，已诚实标注。
