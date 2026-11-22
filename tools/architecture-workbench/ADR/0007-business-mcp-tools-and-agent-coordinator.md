# ADR-0007: Business MCP Tools and Pull-based Agent Coordination

- Status: Accepted
- Date: 2026-11-22
- Extends: ADR-0005, ADR-0006

## Context

ADR-0006 established Workbench as a provider of role Skills over MCP. Skills let an Agent Host discover work methods, but a Skill alone cannot read or change a Request, create a Task, persist an Artifact draft, or coordinate multiple role executions.

Workbench already owns the authoritative Work Item, Participation, Task, Artifact, Review, Decision and Workflow models. Agent execution must operate through these domain boundaries rather than introduce a second business state store. The project does not select one model vendor or Agent SDK, and does not yet need a server-hosted LLM worker.

## Decision

Extend the existing MCP endpoint with Workbench business Tools and a persistent Agent Coordinator. Continue using the official MCP TypeScript SDK v2 `McpServer.registerTool()` API and Zod v4 schemas.

Business Tools are command/query adapters over the existing SQLite domain services. Every tool resolves the current caller and checks Work Item Participation permissions at execution time. The initial tools support:

- Search and read only Work Items visible to the caller.
- Read the Work Item Context Capsule, Artifacts and external resource references.
- Read Workflow state and the caller's Task list.
- Create Tasks, update Tasks within existing assignee/contributor rules, create draft Artifacts and add discussion notes.
- Request, claim, complete, fail, pause and resume Agent Runs; list role profiles and Agent Run history.

The MCP endpoint does not expose tools for submitting a formal Review, creating a Decision, accepting risk or closing a Request. Those actions continue through the existing Human-authorized APIs and Workflow Engine.

## Agent Coordinator and runtime boundary

Agent Profile is a registered role capability mapped to a Skill, not a Person, permission set or model provider. The initial profiles are Business Analyst, Solution Architect, Data Architect, Security Reviewer, Architecture Reviewer, Decision Analyst and Request Coordinator.

An Agent Run persists its Work Item, optional Task, profile key, Skill name, objective, requester, claimant, status, hand-off reason and resulting Artifact. Agent Run Events record queue, claim, completion, failure, Human hand-off and resume events, including additional Human context. The pull queue query filters by profile and the Host's current Work Item permissions; claiming uses a conditional status update so two Hosts cannot claim the same queued Run.

The current runtime adapter is pull-based. An external MCP Host calls `agent_claim_next_run` to poll and atomically claim the oldest eligible Run for a profile, reads the associated Skill and participant-scoped context, executes the model using its own provider, then uses Workbench Tools to create a draft Artifact or request Human input. Workbench coordinates durable state but does not host model inference, own model credentials or depend on Copilot SDK, CodeBuddy SDK, LangChain or DeepAgents.

The Agent Host controls parallel execution and fan-out. It may request independent profiles for one Work Item and correlate their outputs through the Coordinator. Workbench does not assume that all profile runs are independent or automatically merge their results.

## Identity and security

Local MCP mode remains localhost-only and uses the existing demo identity header. It is not suitable for production authentication.

Remote MCP requires a Host allowlist, a bearer secret of at least 32 characters and an explicit non-admin `MCP_SERVICE_USER_ID`. The server overrides any caller-supplied demo identity and maps all remote calls to that one Service Principal. The prototype seed creates `u-agent`; the Requestor or Workbench Admin must add it to each Work Item and grant only the minimum Participation permissions required for that assignment. The Service Principal is not globally privileged and must never receive `decide` or `manage` merely to execute Agent work.

The static bearer token is a deployment-level service credential, not user-level OAuth delegation. Production must replace it with OIDC/OAuth authentication and revocable, user- or Agent-scoped Delegation Grants before exposing MCP to untrusted networks.

## Consequences

- Agent Hosts can use the same protocol to retrieve role methods and perform authorized Workbench operations.
- Agent outputs are versioned draft Artifacts and remain visible in the Work Item activity and Agent Run history.
- A Human hand-off pauses only the Agent Run; it does not mutate the Request Workflow or create an implicit approval.
- Agent coordination is durable and auditable without coupling the Workbench to a particular LLM provider.
- This is a pull-based execution integration, not a server-hosted autonomous Agent Runtime. A future push worker or provider adapter can implement the same coordinator contract.
- All external Jira, Confluence, GitHub and LeanIX content remains outside Workbench. The Agent Host resolves references through its own authorized source-system tools.
- MCP Tools are a new write surface and must remain behind the same domain permission checks. Do not register convenience tools that write directly to SQLite or bypass the Workflow Engine.

## Validation

The Workbench build runs an MCP-over-HTTP smoke test against an isolated SQLite database. It verifies Skills discovery and digest checks, tool registration and execution, read/write permission enforcement, draft Artifact creation, Task updates, Agent Run state transitions and remote service-identity override behavior.

## References

- [MCP TypeScript SDK v2: Tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools)
- [MCP TypeScript SDK v2: Serve with Express](https://ts.sdk.modelcontextprotocol.io/v2/serving/express)
- [MCP TypeScript SDK v2: Authorization](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization)
- [ADR-0005: Lightweight Request Workflow Engine and Human Accountability](0005-lightweight-request-workflow-engine.md)
- [ADR-0006: Publish Role Skills over MCP](0006-skills-over-mcp.md)
