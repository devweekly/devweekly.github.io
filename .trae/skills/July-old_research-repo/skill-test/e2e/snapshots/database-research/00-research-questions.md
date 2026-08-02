# Research Questions — database-research

## Archetype

Database

## Top 5 Questions

### Q1: Why is vectorized execution chosen over Volcano iterator?
- **Why it matters**: Execution model determines throughput and code organization.
- **Expected Evidence**: `src/execution/operator/aggregate/physical_hash_aggregate.cpp` and related tests.
- **Hypothesis**: Vectorized execution is used for analytical workloads.
- **Alternative**: Volcano iterator model with per-row function calls.

### Q2: How does the query optimizer integrate with the execution engine?
- **Why it matters**: Optimizer/execution boundary affects extensibility and correctness.
- **Expected Evidence**: `src/optimizer/optimizer.cpp` and its callers in execution operators.
- **Hypothesis**: Optimizer produces a physical plan consumed by the execution engine.
- **Alternative**: Execution engine performs its own optimization during runtime.

### Q3: What is the storage layout for columnar data?
- **Why it matters**: Storage layer is the dominant factor for analytical performance.
- **Expected Evidence**: `src/storage/table/column_segment.cpp` and storage tests.
- **Hypothesis**: Column segments store values contiguously per column.
- **Alternative**: Row-major pages with columnar projection on read.

### Q4: How are transactions and concurrency handled?
- **Why it matters**: Concurrency control is a core database design decision.
- **Expected Evidence**: Transaction manager, MVCC structures, concurrency tests.
- **Hypothesis**: MVCC or snapshot isolation is used.
- **Alternative**: Single-threaded execution with no concurrency control.

### Q5: Where is SQL parsed and bound into an internal representation?
- **Why it matters**: Parser/binder design affects error messages and optimizer input.
- **Expected Evidence**: Parser directory, binder directory, AST definitions.
- **Hypothesis**: Standard parser → binder → logical plan pipeline.
- **Alternative**: Parser directly emits physical operators.

## Filtered Out

- Q6: What is the Agent lifecycle? — Not relevant to a database system.
- Q7: How are prompts engineered? — Cross-archetype contamination.
