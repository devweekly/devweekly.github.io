# API Surface

Base URL in development: http://localhost:4000/api

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /health | Health and adapter status |
| GET | /bootstrap | People directory, visible Work Items, debt register and counters |
| GET | /my/tasks | Tasks assigned to the current principal, including Task Owner and Assignee projections |
| PATCH | /people/:id/profile | Update own profile; Workbench Admin may update another person's profile |
| GET | /work-items | List business Work Items |
| POST | /work-items | Create a Request and its initial Request Package, with a designated Chairman |
| PATCH | /work-items/:id/request-package | Update a draft or Requestor revision before submission; Requestor only |
| GET | /agent-profiles | Registered Agent profiles and runtime adapter capabilities |
| GET | /work-items/:id | Work Item detail projection, including Submission manifests and Agent Run history |
| GET | /work-items/:id/agent-runs | List Agent Runs visible to a Work Item participant |
| POST | /work-items/:id/agent-runs | Queue a standalone Agent Run as the current Human principal |
| GET | /work-items/:id/agent-plans | List multi-role Agent Plans and dependency graphs |
| POST | /work-items/:id/agent-plans | Create a multi-role Agent Plan; the server appends a final synthesis node |
| POST | /agent-runs/:id/resume | Resume a run waiting for Human input |
| POST | /work-items/:id/artifacts | Submit a new Artifact version |
| POST | /work-items/:id/reviews | Comment, request Requestor clarification or raise a blocking objection during Discussion and Review |
| POST | /work-items/:id/clarifications/:clarificationId/answer | Answer an outstanding clarification; Requestor only |
| POST | /work-items/:id/request-package-drafts/:draftId/apply | Apply a completed Agent Package draft to the editable Request Package; Requestor only |
| POST | /work-items/:id/participations | Add or upsert a Work Item-scoped Participation; Requestor/Admin/manager only |
| PUT | /work-items/:id/participations/:participationId | Update the role and permissions for a related person |
| DELETE | /work-items/:id/participations/:participationId | Remove a related person; Requestor and Owner remain participants | 
| POST | /work-items/:id/tasks | Create a Task with an accountable owner and optional current assignee |
| POST | /work-items/:id/decisions | Record a formal human Decision; the Workflow Engine applies the related lifecycle transition |
| POST | /work-items/:id/transitions | Submit a Request Package or explicitly close an approved/rejected Request |
| GET | /work-items/:id/context-capsule | Export a participant-scoped context projection, including external resource references |
| POST | /tech-debts | Create a linked Technical Debt Work Item |
| PATCH | /tasks/:id | Update Task status; Work Item contributors may change Task Owner, Assignee or due date |
| PATCH | /tech-debts/:id | Update debt status and remediation plan |
| POST | /work-items/:id/comments | Add a discussion message |
| POST | /work-items/:id/attachments | Upload an authorized attachment using the configured ObjectStore |
| GET | /external-resource-refs | List saved references linked to Work Items visible to the current principal; no source-system search |
| POST | /work-items/:id/external-links | Reuse an existing reference or record a new one; does not call that system |
| DELETE | /work-items/:id/external-links/:linkId | Remove a reference association without deleting the remote object |
| GET | /analytics | Request and Technical Debt portfolio metrics |
| GET | /admin/workflow-timers?status=dead_letter | Inspect workflow timers by status; Workbench Admin only |
| POST | /admin/workflow-timers/:timerId/retry | Requeue one dead-letter workflow timer immediately; Workbench Admin only |

The prototype uses x-demo-user-id to simulate the authenticated Human Principal. Do not expose that header as a production authentication mechanism. The server resolves permissions from Participation for every protected write.

## Task accountability

A Task has an accountable `owner_id` and an optional current `assignee_id`. Both Human principals must be Work Item participants. When creating a Task, the server defaults the Owner to the Work Item Owner if `ownerId` is omitted; `assigneeId` may be omitted when work has not yet been allocated. The current Assignee or Task Owner can update task status. Only a Work Item contributor can reassign either principal or change the due date. The Agent Run's `claimed_by` remains execution metadata and does not modify either field. The REST endpoints and `workbench_create_task` / `workbench_update_task` MCP tools enforce the same participant and accountability rules; Agent Hosts cannot bypass them by writing through MCP.

## External resource references

The external-links endpoints only persist pointers and Work Item relationship semantics. They do not access Jira, Confluence, GitHub or LeanIX. A Confluence Page may carry a Template key/name; the actual Template definition is retrieved by an optional Agent through its own MCP/API tool, not by this API.

The Context Capsule returns external resource IDs/keys/URLs and relationship types. It does not contain a synchronized copy of remote content.

## Workflow Engine

The API returns a `workflow` projection in Work Item detail: current phase, Chairman, formal outcome, review deadline, active clarification, reviewer snapshot, available actions and transition history. Request detail also returns `relatedDebts`, the Technical Debt Work Items directly linked from the Request. A participant who can read the originating Request receives read-only access to those linked debt records; this does not grant debt-management permission. Request submission creates an internal immutable review baseline containing the Request content and current external reference identities, then creates a Review Cycle, fixed reviewer snapshot and persisted review timer in one SQLite transaction. This baseline is an implementation detail for review consistency, not a separate user-facing materials-history feature. Request Package composition and any Agent assistance happen in the Client; there is no server-side Package Draft endpoint or MCP tool. The transitions endpoint accepts `submit_request` and `close`; the former is Requestor-confirmed and the latter is Chairman/Admin-only.

Review operations are limited to `comment`, `clarification_requested` and `objection`. A comment never changes status. A clarification pauses the remaining review duration and creates a response deadline. When all open clarifications are answered, the remaining review time resumes. An unanswered clarification or review deadline expiry moves the Request to `decision_meeting`; a blocking objection does so immediately. None of these events produces an approval or rejection.

Only the designated Chairman or a Workbench Admin may record a formal Decision Meeting outcome (`approved`, `needs_work` or `rejected`). Approved and rejected Requests enter pending-close states and require an explicit Chairman/Admin close action. Need Work returns to `requestor_revision` and the next submission creates a new Submission and Review Cycle.

### Durable timer service

The application uses a small Node.js scheduler backed by SQLite. The `workflow_timers` table stores due time, timer type, Submission/Review Cycle identity, status, lease, attempts and the last processing error. One in-process `setTimeout` is armed for the earliest scheduled timer. API events call `wake()` to recalculate it. Startup recovery reclaims in-flight timers and processes overdue timers; processing re-checks current Work Item and Review Cycle state in a database transaction. Retries use bounded backoff and exhausted jobs enter `dead_letter`. Admins can inspect dead-letter jobs through `GET /admin/workflow-timers?status=dead_letter` and explicitly requeue one with `POST /admin/workflow-timers/:timerId/retry`.

Node.js Timer handles are only wake-up signals and are not durable. SQLite remains the source of truth. There is no Flowable/BPMN runtime, Redis, BullMQ or third-party scheduling dependency. The current deployment assumes one application process; multi-instance deployment would require database-backed timer claiming and lease coordination.

## MCP Skills Endpoint

MCP endpoint: `http://localhost:4000/mcp` (development). It uses the official MCP TypeScript SDK v2 Streamable HTTP handler and the Skills Extension `io.modelcontextprotocol/skills` (SEP-2640).

The server publishes the repository-managed `tools/architecture-workbench/skills/` catalog:

| MCP method | Purpose |
| --- | --- |
| `skills/list` | Discover the available Skills; supports protocol pagination |
| `skills/get` | Resolve one Skill by its `skill://…/SKILL.md` URI and obtain its manifest |
| `resources/read` | Read `SKILL.md` or a supporting file; the SDK verifies content against the published digest |
| `resources/directory/read` | Read a Skill directory listing when the negotiated extension capability advertises directory reads |

Each Skill directory contains a `SKILL.md` with Agent Skills YAML frontmatter. Skill files are loaded and validated at server startup; invalid catalogs fail startup rather than silently publishing a partial set. Updating catalog files requires an application restart.

This endpoint publishes instructions and a bounded set of business tools. It does not execute or automatically activate a Skill. The MCP Host is responsible for Skill discovery, approval, integrity verification, activation and model execution. Business tools call the same Workbench domain checks as REST and never bypass Participation permissions.

The endpoint is localhost-only by default. Set `MCP_ALLOWED_HOSTS` to a comma-separated hostname allowlist when serving it through a remote host. Host validation is not user authentication; do not add private Skills or expose business tools until an appropriate authentication and authorization layer is in place.

## MCP business tools

The `/mcp` endpoint registers the following business and coordination tools alongside the Skills Extension:

| Tool | Purpose | Authorization |
| --- | --- | --- |
| `workbench_search_work_items` | Search only Work Items visible to the caller | read on returned Work Items |
| `workbench_get_work_item` | Read participants, Tasks, Artifacts, Reviews, Decisions and Workflow projection | read |
| `workbench_get_artifact` | Read the complete content of one Artifact | read on parent Work Item |
| `workbench_get_context_capsule` | Read Work Item context, Artifact metadata and external resource references | read |
| `workbench_get_workflow_state` | Read current state, available actions and history | read |
| `workbench_list_my_tasks` | List Tasks assigned to the current principal | read on parent Work Item |
| `workbench_create_task` | Create a Task; human assignee must be a participant | contribute |
| `workbench_update_task` | Update Task status; assignees may update status and contributors may reassign | assignee or contribute |
| `workbench_create_artifact_draft` | Save a versioned draft Artifact | contribute |
| `workbench_draft_request_package` | Save an Agent-authored Request Package suggestion bound to its active Run claim; Requestor confirmation is still required | contribute + active Run claim |
| `workbench_add_comment` | Add a discussion note | comment |
| `agent_list_profiles` | List role-oriented Agent profiles and mapped Skills | none |
| `agent_request_run` | Queue a standalone Agent Run for a Work Item | contribute |
| `agent_request_plan` | Create a multi-role DAG with an automatic final synthesis node | contribute |
| `agent_list_plans` | List Plans, nodes and dependency edges for a Work Item | read |
| `agent_get_plan_context` | Read completed specialist outputs from a claimed synthesis node | synthesis claimant with contribute |
| `agent_claim_next_run` | Poll and atomically claim the oldest queued node whose dependencies are complete; returns a per-claim token | read + contribute |
| `agent_claim_run` | Claim a known queued Run assigned to the profile | read + contribute |
| `agent_heartbeat_run` | Renew an unexpired Run lease; requires the current claim token | claimant with contribute + claim token |
| `agent_complete_run` | Persist the claimed Run result as a draft Artifact; requires its claim token | claimant with contribute + claim token |
| `agent_request_human_handoff` | Pause a Run and record Human questions/actions; requires its claim token | claimant with contribute + claim token |
| `agent_fail_run` | Record a claimed Run failure; requires its claim token | claimant with contribute + claim token |
| `agent_resume_run` | Requeue a Human hand-off | original requester, Work Item Requestor or Admin |
| `agent_list_runs` | List Agent Runs for a Work Item | read |
| `agent_get_run_events` | Read append-only lifecycle events and Human-provided resume context | read |

There are intentionally no Agent tools for formal Review submission, Decision creation, risk acceptance, or Request closure. The MCP Host must not infer that loading architecture-review or decision-preparation grants the ability to submit a formal Review or Decision.

## Agent Run lifecycle and Host protocol

A Human creates a Run through `POST /api/work-items/:id/agent-runs` or `agent_request_run`. The Coordinator persists the objective, Work Item, optional Task, Agent profile, associated Skill, requester and lifecycle status.

An external MCP Host polls `agent_claim_next_run(agentKey)`. The server atomically claims the oldest queued Run for that profile which the Host's current principal is authorized to read and contribute to. A successful response contains the Run and Skill URI; a `null` response means no eligible Run is queued.

The Host receives a one-time claim token and a server-defined lease duration with the Run. The Workbench Server owns the lease expiry and reaper; the Host renews it through `agent_heartbeat_run` while preparing context and executing the model. Heartbeats are authorized against the current Work Item Participation and claim token. The token is not included in ordinary Plan/Run list projections. The Host then reads the Skill, gets the Context Capsule and retrieves individual Artifact bodies only when needed. It performs model inference using its own runtime/provider. The result is saved through `agent_complete_run` as a draft Artifact, or the Host pauses the Run using `agent_request_human_handoff`.

The server runs a periodic lease-recovery sweep and also performs recovery before assigning new work. An expired Run is returned to `queued` with its old claim token invalidated, allowing another authorized Host to claim it with a new token. After three claims without a successful completion or hand-off, a further lease expiry moves the Run to `failed` rather than retrying forever. Legacy `running` rows without a lease are treated as expired during migration/recovery. Run completion and Artifact creation share one database transaction, so an expired or superseded worker cannot leave an orphan Artifact through the completion path. The Host receives an AbortSignal when its lease heartbeat fails; Executor plugins should pass that signal to cancellable model/runtime calls. Lease fencing protects Workbench writes, but cannot roll back external side effects already performed by a deployment-specific Executor.

Human hand-off pauses only the Agent Run. The Request workflow does not change. The original requester, Work Item Requestor or an Admin can resume it. Additional context is persisted in the Run event log; after a resumed Run is claimed, the Host must call `agent_get_run_events` to read that Human context before continuing.

## Remote MCP identity

Local MCP mode is localhost-only and uses the prototype `x-demo-user-id` identity header. Remote mode requires `MCP_ALLOWED_HOSTS`, a `MCP_BEARER_TOKEN` with at least 32 characters and a non-admin `MCP_SERVICE_USER_ID`. The server overrides any caller-supplied demo identity with this fixed Service Principal. Seed creates `u-agent`; a Requestor/Admin must add it to each Work Item and grant only the permissions needed for that work. The static bearer secret is service authentication for this prototype, not per-user OAuth delegation.

## Multi-role Agent Plan

A Plan contains one or more specialist nodes plus an automatically generated final Decision Analyst synthesis node. The caller supplies node keys, Agent profile keys, optional node-specific objectives and dependency keys. The server validates key uniqueness, dependency references and acyclicity before persisting the Plan, Runs and dependency edges in one SQLite transaction.

Runs without prerequisites can be claimed concurrently. A node with dependencies is not claimable until every prerequisite Run has status completed. A failed prerequisite therefore prevents dependent nodes from running; independent branches may finish, but the Plan cannot reach completed status. The synthesis node depends on every requested specialist node and reads their saved Draft Artifacts through agent_get_plan_context.

The synthesis output is a draft decision brief. It must preserve disagreements, assumptions and uncertainty. It cannot create a formal Decision or advance the Request Workflow.

## Agent Host process

The repository includes a provider-neutral pull Host: npm run agent-host.

The process connects to the MCP endpoint using the local demo identity or configured remote bearer token, polls the configured Agent profiles and executes each profile through a deployment-provided AgentExecutor. The Executor module exports createAgentExecutors() and implements the interface in server/agents/host.ts.

The Host verifies the associated Skill through the Skills Extension, retrieves the participant-scoped Context Capsule, obtains the Plan aggregation context only for a claimed synthesis node, and writes the outcome through agent_complete_run or agent_request_human_handoff. Exceptions are persisted with agent_fail_run. Model provider SDKs and credentials remain in the Executor plugin, outside the Workbench Server.