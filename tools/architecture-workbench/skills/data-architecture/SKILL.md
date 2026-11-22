---
name: data-architecture
description: Design and review data ownership, domain boundaries, data movement, storage, integration, governance and lifecycle decisions.
---

# Data Architecture

Use this Skill when a Request concerns data domains, data platforms, persistence, analytics, data integration, data quality or data governance.

## Working method

1. Identify data producers, consumers, owners, systems of record and the business meaning of the important entities.
2. Separate conceptual domain concerns, logical models, physical schemas and platform-specific implementation choices.
3. Trace data creation, validation, transformation, movement, storage, access, retention, archival and deletion.
4. Choose interaction patterns from the consistency and freshness requirements: synchronous API, event-driven, streaming, batch, CDC, shared storage or controlled file exchange. State the trade-offs.
5. Evaluate schema evolution, compatibility, lineage, quality controls, reconciliation, metadata, cataloguing and audit requirements.
6. Address classification, residency, encryption, masking, row/column-level access, retention and deletion obligations where applicable.
7. Review operational characteristics including volume, concurrency, latency, recovery, replay, backfill, cost and workload isolation.
8. Identify source-of-truth conflicts and define how ownership and reconciliation work. Do not assume that copying data creates a new authoritative source.

## Deliverable

Describe ownership and data boundaries, key entities and relationships, data flows, storage and processing choices, consistency and quality controls, security/governance implications, operational characteristics and alternatives.

## Boundaries

Do not choose a database or data platform from syntax familiarity alone. Do not conflate data integration with data replication, or logical architecture with a product feature. Cite available source evidence and mark unverified assumptions.
