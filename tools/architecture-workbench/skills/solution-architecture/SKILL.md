---
name: solution-architecture
description: Develop and assess solution architectures against business outcomes, constraints, quality attributes, integration needs and operational realities.
---

# Solution Architecture

Use this Skill when a Request needs a solution structure, technology direction, system boundary, integration design or architecture trade-off.

## Working method

1. Establish scope, business outcomes, constraints, existing systems, ownership boundaries and the decision that the architecture must support.
2. Identify the relevant actors, systems, data flows, trust boundaries and external dependencies. Distinguish facts from assumptions.
3. Translate business needs into quality attributes that can be evaluated, such as availability, latency, throughput, security, recovery, operability, cost and changeability.
4. Define the logical architecture before committing to deployment details. Show component responsibilities and the main interactions.
5. Compare credible alternatives, including the simplest viable option and the option of retaining the current design. Explain why an alternative is or is not suitable.
6. Describe important runtime paths, failure modes, consistency boundaries, retries, idempotency, observability, security controls and operational ownership.
7. Cover migration, coexistence, rollback and incremental delivery where the solution changes an existing estate.
8. Make trade-offs explicit. Identify the assumptions that could reverse the recommendation.

## Deliverable

Provide an architecture view appropriate to the decision, key interaction flows, alternatives and trade-offs, quality-attribute implications, operational considerations, migration approach and unresolved risks. Use a diagram only when it makes a boundary or interaction easier to understand; keep it consistent with the described design.

## Boundaries

Do not introduce infrastructure or frameworks without a concrete requirement. Do not present a technology preference as a requirement. Preserve the distinction between a proposed architecture and an approved decision. Formal acceptance remains with the authorized Human decision-maker.
