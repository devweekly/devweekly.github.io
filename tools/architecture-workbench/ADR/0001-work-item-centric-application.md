# ADR-0001: Use Work Item as the Main Business Record

- Status: Accepted
- Date: 2026-11-22

## Context

The product must support architecture proposals, ADRs, independent reviews, formal human decisions and long-lived follow-up obligations. It must also remain reusable for other business work such as change assessment, risk review and compliance investigations.

The website must remain fully usable without an AI Agent. External Agent Clients may connect later, but the site must not own or require their Runtime.

## Decision

Use Business Work Item as the durable business root. Participation expresses a principal's role and permissions within one Work Item. Task represents executable work. Artifact represents versioned deliverables such as ADRs and architecture documents. Review represents an independent opinion bound to an Artifact version. Decision represents a formal human decision with subject, outcome, rationale and conditions.

Technical Debt is recorded as a separate Work Item and linked to the Work Item and Decision that caused it. A fix that can be completed as part of the current work stays a Task. Create a separate Technical Debt Work Item only when it needs its own owner, priority and target date.

REST API is the business interface. Remote MCP will be an adapter for external Agent Clients and must call the same application services. No model Runtime or Agent registry is required in the prototype.

## Consequences

- The UI is organized around My Work and Work Item Workspace rather than a chat-first experience.
- Human permissions are checked in the server for each action. UI visibility is not an authorization boundary.
- Agent-generated content remains a draft or submission. It cannot become a formal Review Outcome or Decision by itself.
- Business workflow and Agent execution lifecycle remain separate.
