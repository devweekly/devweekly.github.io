# ADR-0008: DAG-based Multi-Agent Plans and Provider-neutral MCP Host

- Status: Accepted
- Date: 2026-11-22
- Extends: ADR-0006, ADR-0007

## Context

ADR-0007 introduced standalone Agent Runs and a pull-based MCP Host contract. That is sufficient for a single role to work on one Request, but independent Run records do not express the order in which multiple specialists should contribute, which outputs a synthesis role must consume, or when the overall collaboration is complete.

The Workbench must support common multi-role collaboration patterns without turning a particular business scenario into a hard-coded workflow. It must remain independent of model providers and Agent SDKs, while retaining a durable record of dependencies, outputs, failures and Human intervention.

## Decision

Introduce Agent Plan as the durable root of a multi-role collaboration. A Plan belongs to one Work Item and contains one to eight requested specialist nodes. Each node is an Agent Run with a unique node key, one Agent Profile, an objective and zero or more prerequisite nodes. Store prerequisite edges in agent_run_dependencies, not in prompt text or an unvalidated JSON field.

The server validates node keys, profile mappings, dependency references and cycles before creating a Plan. Plan, Run and dependency records are persisted in one SQLite transaction. The dependency graph must be a directed acyclic graph.

The server automatically adds one final synthesis node mapped to the Decision Analyst profile. It depends on all requested specialist nodes. The Host may claim a node only when all of its prerequisite Runs have status completed. Independent nodes may therefore execute in parallel; dependent nodes remain queued until their prerequisite outputs have been saved.

The synthesis node can call agent_get_plan_context only after it has been claimed by the current Host. The tool returns the completed specialist outputs, including their Artifact content, node key and Agent Profile. The synthesis output is saved as a draft decision brief and becomes the Plan's result Artifact. It must preserve material disagreements, assumptions and uncertainty instead of silently flattening them.

## Plan lifecycle

The Plan status is a projection of its Run nodes:

- queued: at least one node is eligible for execution and no node is running.
- running: one or more nodes are executing.
- waiting_for_human: at least one node requires Human input.
- completed: every node, including synthesis, completed and a result Artifact exists.
- failed: no node is running or eligible and at least one node failed or was cancelled.

A failed prerequisite prevents dependent nodes from being claimed. Independent branches may finish, but the final synthesis node cannot run unless all specialist nodes complete. The prototype does not automatically retry failed nodes or rewrite the graph.

Human hand-off remains Run-scoped. The Plan reflects that it is waiting for input, but the Request Workflow status is not changed. After an authorized Human resumes the Run, the Host reads the appended Human context from the Run event history and continues execution.

## Agent Host

Provide a reference MCP Agent Host process, started with npm run agent-host. It polls configured Agent Profiles, claims dependency-ready Runs, verifies each Skill through the MCP Skills Extension, reads the Work Item Context Capsule and calls the registered AgentExecutor.

The Host is provider-neutral. A deployment supplies a module exporting createAgentExecutors(); each executor implements the interface in server/agents/host.ts. It owns provider-specific prompt construction, model invocation, credentials and any optional source-system MCP/API clients. The Workbench owns the plan graph, role-to-Skill mapping, authorization, durable Run state and result Artifact.

The Host may run multiple workers per profile. Each successful claim returns a random one-time claim token and a server-defined lease duration. Complete, fail, hand-off, heartbeat and synthesis-context operations require that token; ordinary Plan and Run listings never return it. The Workbench Server owns lease expiry and recovery; the Host renews the lease while work is active. Expired leases are requeued with their old token invalidated, subject to a bounded attempt count. The implementation and recovery policy are detailed in ADR-0009.

## Security and accountability

- Each claim, context read and write is checked against the Host's current Work Item Participation.
- A per-claim token binds Run write-back to the worker that received the claim, even when multiple workers share one service identity.
- A Skill or Agent Profile never grants business permissions.
- Specialist output and synthesis output are draft Artifacts. No Agent tool submits an official Review, records a formal Decision, accepts risk or closes a Request.
- Synthesis can recommend an option but cannot approve its own recommendation.
- The Host uses the configured local demo principal or the remote MCP Service Principal. Production must replace the prototype static bearer token with OIDC/OAuth and revocable, scoped Delegation Grants.
- External Jira, Confluence, GitHub and LeanIX content remains outside the Workbench. The Host resolves those references with its own authorized tools and records provenance in its Artifact.

## Consequences

- Parallel, sequential and fan-in collaboration can be represented by one auditable DAG.
- Workbench can determine node readiness without asking an LLM to interpret dependency instructions.
- Specialist findings remain separate Artifacts, while the synthesis result has an explicit Plan-level reference.
- The Host can be deployed separately and scaled horizontally without coupling the Workbench Server to a model vendor.
- The Executor plugin contract still needs a concrete deployment adapter. This repository deliberately does not select or bundle a provider SDK.
- The Executor plugin contract still needs a concrete deployment adapter. This repository deliberately does not select or bundle a provider SDK.

## Validation

The CI MCP-over-HTTP smoke test exercises:
- DAG validation and persistence, including prerequisite gating.
- Parallel claims for independent specialist nodes.
- Downstream readiness after prerequisite completion.
- Synthesis context containing all completed specialist Artifacts.
- Plan completion with a Plan-level result Artifact.
- The provider-neutral Agent Host against a real MCP HTTP server using deterministic test Executors.
- Server-side lease renewal, expiry recovery, bounded retries and stale claim-token rejection.

## References

- [ADR-0006: Publish Role Skills over MCP](0006-skills-over-mcp.md)
- [ADR-0007: Business MCP Tools and Pull-based Agent Coordination](0007-business-mcp-tools-and-agent-coordinator.md)
- [MCP TypeScript SDK v2: Client](https://ts.sdk.modelcontextprotocol.io/v2/client/)
- [MCP TypeScript SDK v2: Tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools)
- [Agent Skills specification](https://agentskills.io/specification)