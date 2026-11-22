# ADR-0003: External Agent Runtime and Human Authority Boundary

- Status: Accepted
- Date: 2026-11-22

## Context

Participants may use no Agent, a lightweight chat assistant, or a deep Agent Client such as an IDE/CLI integration. The website must remain usable by Human-only participants and should not require a specific provider, model, Runtime, or Agent registry.

The first prototype needs to validate business collaboration, Artifact versioning, independent Review, Decision authority and Technical Debt lifecycle. An Agent Runtime would add another stateful subsystem before those domain boundaries are proven.

## Decision

Do not include LangChain, DeepAgents or LangSmith in the initial runtime. Use Ant Design X only for optional Agent-oriented UI affordances and Context Capsule handoff. Keep REST API as the business service boundary. Any future native Agent is a distinct runtime that may use MCP/API tools for external knowledge retrieval. External system tool connections do not belong to the Workbench's business API or persistence layer.

Agent analysis can produce draft Artifacts, questions and recommendations. The platform records the Human participation that owns the responsibility. Agent identity and grant provenance may be recorded for connected clients, but an Agent's declared Persona does not grant organizational role or Decision authority.

## Consequences

- No model credentials, Agent Runtime, memory store or LangSmith tracing are required to run the prototype.
- AI analysis can be introduced as a separately deployable capability after the business workflow is validated.
- Agent execution traces are diagnostic records, not the authoritative business audit or Decision record.
