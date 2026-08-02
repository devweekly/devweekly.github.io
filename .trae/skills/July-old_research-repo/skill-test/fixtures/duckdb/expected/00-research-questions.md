# Research Questions — DuckDB

## Archetype

Database — 基于 hasSQL/hasDB/hasParser/hasLexer 信号，以及 optimizer.cpp / physical_plan_generator.cpp / column_segment.cpp 等核心源码证据。

## Top 5 Questions

### Q1: 为什么 DuckDB 选择 Vectorized Execution 而不是 Volcano Iterator 模型？
- **Why it matters**: 执行模型决定了分析型查询的吞吐上限和代码可维护性。
- **Expected Evidence**: `src/execution/operator/aggregate/physical_hash_aggregate.cpp`、 `test/sql/aggregate/`
- **Hypothesis**: 向量化执行对批量分析负载吞吐更高。
- **Alternative**: Volcano 模型可能更通用，但单线程吞吐更低。

### Q2: Optimizer 如何在无分布式场景下保持查询计划质量？
- **Why it matters**: 进程内数据库没有网络 shuffling，优化器目标与分布式系统不同。
- **Expected Evidence**: `src/optimizer/optimizer.cpp`
- **Hypothesis**: 优化器专注于本地 CPU/内存效率而非网络代价。
- **Alternative**: 可能通过 aggressive statistics 补偿缺少的分布式信息。

### Q3: Columnar Storage 如何与 Vectorized Execution 协同设计？
- **Why it matters**: 存储格式与执行模型必须匹配，否则向量化收益会被反序列化抵消。
- **Expected Evidence**: `src/storage/table/column_segment.cpp`
- **Hypothesis**: 列式存储按向量批次组织数据，减少转换开销。
- **Alternative**: 行存 + 向量化转换可能更简单但内存带宽更高。

### Q4: 事务与并发控制是否为了分析负载做了简化？
- **Why it matters**: OLAP 系统常在事务模型上与 OLTP 做不同取舍。
- **Expected Evidence**: 源码中 MVCC/transaction 目录、相关测试
- **Hypothesis**: DuckDB 采用轻量级事务以适配只读分析场景。
- **Alternative**: 可能复用 PostgreSQL 风格的多版本并发控制。

### Q5: 为什么 Parser / Planner 不直接生成最终物理计划，而是保留多阶段转换？
- **Why it matters**: 多阶段 IR 转换增加代码量，但也为优化和扩展提供锚点。
- **Expected Evidence**: `src/execution/physical_plan_generator.cpp`
- **Hypothesis**: 逻辑/物理计划分离让优化器独立演进。
- **Alternative**: 单次从 SQL 到物理计划可能减少抽象层但更难扩展。

## Filtered Out

- "Agent lifecycle 如何设计？" — DuckDB 不是 AI Agent，已过滤。
- "LLM Prompt 如何管理？" — 无 LLM 证据，已过滤。
