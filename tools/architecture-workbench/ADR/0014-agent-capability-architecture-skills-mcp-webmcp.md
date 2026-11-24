# ADR-0014: Agent Capability Architecture — Skills, MCP and WebMCP

- Status: Accepted
- Date: 2026-11-23
- Related: ADR-0006, ADR-0007, ADR-0008, ADR-0013

## Context

Architecture Workbench already distributes role-specific Skills through the MCP Skills Extension and exposes business capabilities through MCP Tools. WebMCP introduces a browser-facing way for an Agent to discover and invoke capabilities exposed by the currently open page.

These mechanisms overlap at the tool-discovery level but solve different problems. Without an explicit boundary, the project could create duplicate business Tools, split authorization logic between browser and server, or make core Agent workflows depend on an open browser session.

Workbench must support external MCP clients, provider-neutral Agent Hosts, background execution and business workflows whose state and authorization remain server-owned.

## Decision

Adopt **Skills + MCP as the primary Agent integration architecture**. Treat WebMCP as an optional browser interaction adapter; it does not replace MCP and is not required for core Workbench workflows.

The responsibilities are:

- **Skills — How to work.** Skills describe role-specific methods, task steps, evidence requirements, tool usage guidance and deliverable standards. They are version-controlled and portable across compatible Agent Hosts.
- **MCP — What the Agent can do.** MCP exposes client-independent Workbench business capabilities, including authorized Work Item and Context Capsule access, Task and Artifact operations, discussion and Agent Run coordination.
- **WebMCP — How the Agent interacts with the current UI.** If adopted, it exposes page-specific capabilities such as current view state, navigation, visible filters and draft-form interactions.

### Core workflow independence

Architecture reviews, assessments, ADR preparation and other Agent workflows must be executable through Skills and MCP without requiring a Workbench browser tab. External Agent Hosts and background/scheduled execution must remain first-class use cases.

### One business and authorization boundary

MCP and WebMCP are adapters, not separate business platforms. Both must call the same Workbench Application Services and existing authorization/workflow checks. Neither adapter may write directly to persistence or reimplement business rules.

Authentication and Work Item Participation are checked by the server at operation time. Skill discovery, Skill loading, Tool discovery, browser page state, selected Work Item, visible filters or UI navigation do not grant permissions.

Formal Review Outcomes, Decisions, risk acceptance and Work Item closure remain subject to the existing human-authorized workflow. Agent-generated content remains a draft until adopted or submitted through the authorized process.

### WebMCP scope

WebMCP is deferred until supported browser and Agent Client capabilities provide a concrete user benefit. If introduced, start with browser-specific read-only page context and low-risk navigation/filter operations. Draft-form assistance may be added later when it reuses backend validation and authorization.

Do not mirror all MCP business Tools into WebMCP. Do not expose privileged server operations, unrestricted data access, credentials or policy internals as page tools.

## Consequences

- Core Agent workflows remain portable and can run without a browser.
- Workbench retains one authoritative implementation of business rules and resource authorization.
- Browser integration can improve interactive workflows without becoming a dependency of Agent execution.
- The project avoids duplicate tool catalogs, policy logic, business operations and state synchronization.
- WebMCP is a future optional enhancement, not a current implementation requirement.

## References

- [ADR-0006: Publish Role Skills over MCP](0006-skills-over-mcp.md)
- [ADR-0007: Business MCP Tools and Agent Coordinator](0007-business-mcp-tools-and-agent-coordinator.md)
- [ADR-0008: DAG-based Agent Plans and Provider-neutral Host](0008-dag-based-agent-plans-and-provider-neutral-host.md)
- [ADR-0013: MCP Entra OAuth Resource Server Authentication](0013-mcp-entra-resource-server-authentication.md)
- [WebMCP Community Group](https://github.com/webmachinelearning/webmcp)
