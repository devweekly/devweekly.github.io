# Research Questions — DuckDB (Mutated)

## Archetype

Database — 基于 hasSQL/hasDB/hasParser/hasLexer 信号，但关键执行模型证据已被移除。

## Top 5 Questions

### Q1: DuckDB 的执行模型是什么？当前证据是否足够确认？
- **Why it matters**: 执行模型是数据库核心，但本证据摘要缺少关键决策证据。
- **Expected Evidence**: `src/execution/operator/` 目录下 chunk/vector/iterator 关键词
- **Hypothesis**: 可能是向量化执行，但无法从当前证据确认。
- **Alternative**: 可能是火山模型或混合模型。

### Q2: Optimizer 的优化目标是什么？
- **Why it matters**: 即使执行模型未知，优化器目标仍决定计划选择。
- **Expected Evidence**: `src/optimizer/optimizer.cpp`
- **Hypothesis**: 针对单节点 CPU/内存效率。
- **Alternative**: 可能包含分布式代价模型。

### Q3: Columnar Storage 是否与执行模型解耦？
- **Why it matters**: 存储与执行是否独立设计影响模块边界判断。
- **Expected Evidence**: `src/storage/table/column_segment.cpp`
- **Hypothesis**: 列式存储独立实现，执行层做转换。
- **Alternative**: 存储格式与执行模型协同设计。

### Q4: 当前证据摘要缺少哪些关键证据？
- **Why it matters**: 诚实标注证据缺口比猜测更重要。
- **Expected Evidence**: 执行算子基类、测试覆盖、架构文档
- **Hypothesis**: 缺少执行模型 overview。
- **Alternative**: 证据分散在其他目录未被发现。

### Q5: 在证据不足时应如何回答架构问题？
- **Why it matters**: 这是测试 Skill Honest Limits 的关键问题。
- **Expected Evidence**: 无
- **Hypothesis**: 应标注 Unknown 并列出需要补充的证据。
- **Alternative**: 从间接证据推测。

## Filtered Out

- "为什么采用 Vectorized Execution？" — 原始证据已被移除，无法作为可验证问题保留。
