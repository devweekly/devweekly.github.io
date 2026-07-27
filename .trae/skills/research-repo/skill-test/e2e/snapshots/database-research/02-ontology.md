# Behavior Ontology — database-research

## Entities

- **SQL Parser**: Converts SQL text into an AST.
- **Binder**: Resolves names and types into a bound logical plan.
- **Optimizer**: Transforms logical plan into a physical plan.
- **Execution Engine**: Executes physical operators in a vectorized manner.
- **Storage Manager**: Manages column-oriented segments and pages.
- **Transaction Manager**: Concurrency control and recovery.

## Relations

- Parser **produces** AST.
- Binder **transforms** AST into logical plan.
- Optimizer **transforms** logical plan into physical plan.
- Execution Engine **executes** physical plan.
- Storage Manager **reads** column segments.
- Transaction Manager **coordinates** reads and writes.
