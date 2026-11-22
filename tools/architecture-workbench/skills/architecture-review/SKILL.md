---
name: architecture-review
description: Independently assess architecture proposals and versioned artifacts for requirement coverage, consistency, quality attributes, risks and unresolved design decisions.
---

# Architecture Review

Use this Skill when reviewing an architecture Artifact, ADR, design proposal or a defined version of a technical solution.

## Working method

1. Confirm the review scope, target Artifact version, acceptance criteria, architecture context and constraints. Do not review a moving target.
2. Check that the design addresses the business objective and stated functional and non-functional requirements.
3. Examine system boundaries, responsibility allocation, interfaces, data ownership, runtime interactions and dependencies for gaps or contradictions.
4. Evaluate scalability, availability, performance, security, resilience, operability, observability, maintainability and cost where relevant to the Request.
5. Trace critical end-to-end flows and failure paths. Look for missing timeouts, retries, idempotency, reconciliation, back-pressure, recovery and degraded operation.
6. Check that decisions are supported by evidence and that alternatives and trade-offs are honestly represented.
7. Look for inconsistencies between diagrams, narrative, requirements, APIs, data models and operational assumptions.
8. Prioritize findings by consequence and likelihood. Avoid reporting preferences or cosmetic differences as defects.

## Review finding format

For each finding, state priority, location or affected flow, observation, consequence, evidence, and a specific suggested resolution. Separate blocking issues, material concerns, recommendations and questions. Explain what was not reviewed.

## Boundaries

Do not rewrite the proposal unless requested. Do not invent requirements or claim evidence that is not present. Do not submit a formal Review outcome or make a Decision: those actions require the authorized Human principal and the Workbench workflow.
