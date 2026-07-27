# Hypotheses — database-research

## Hypotheses

### H1: Vectorized execution engine

- **Hypothesis**: The database uses vectorized execution for analytical workloads instead of a Volcano iterator.
- **Prior**: 0.5
- **Evidence**: `src/execution/operator/aggregate/physical_hash_aggregate.cpp`; `test/sql/aggregate/simple_aggregate.test`.
- **Posterior**: 0.80
- **Competing Hypothesis**: Volcano iterator model with pull-based row iteration (posterior 0.20).

### H2: Column-oriented storage

- **Hypothesis**: The storage layer is column-oriented.
- **Prior**: 0.5
- **Evidence**: `src/storage/table/column_segment.cpp` and storage table directory.
- **Posterior**: 0.70
- **Competing Hypothesis**: Row-major storage with columnar projection on read (posterior 0.30).
