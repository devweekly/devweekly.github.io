# API Surface

Base URL in development: http://localhost:4000/api

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /health | Health and adapter status |
| GET | /bootstrap | People directory, visible Work Items, debt register and counters |
| GET | /my/tasks | Tasks assigned to the current principal |
| PATCH | /people/:id/profile | Update own profile; Workbench Admin may update another person's profile |
| GET | /work-items | List business Work Items |
| POST | /work-items | Create a Work Item |
| GET | /agent-profiles | Registered Agent profiles and runtime adapter capabilities |
| GET | /work-items/:id | Work Item detail projection, including Agent Run history |
| GET | /work-items/:id/agent-runs | List Agent Runs visible to a Work Item participant |
| POST | /work-items/:id/agent-runs | Queue an Agent Run as the current Human principal |
| POST | /agent-runs/:id/resume | Resume a run waiting for Human input |
| POST | /work-items/:id/artifacts | Submit a new Artifact version |
| POST | /work-items/:id/reviews | Submit an independent Review |
| POST | /work-items/:id/participations | Add or upsert a Work Item-scoped Participation; Requestor/Admin/manager only |
| PUT | /work-items/:id/participations/:participationId | Update the role and permissions for a related person |
| DELETE | /work-items/:id/participations/:participationId | Remove a related person; Requestor and Owner remain participants | 
| POST | /work-items/:id/tasks | Create a Task |
| POST | /work-items/:id/decisions | Record a formal human Decision; the Workflow Engine applies the related lifecycle transition |
| POST | /work-items/:id/transitions | Start analysis, submit for review or close a Request |
| GET | /work-items/:id/context-capsule | Export a participant-scoped context projection, including external resource references |
| POST | /tech-debts | Create a linked Technical Debt Work Item |
| PATCH | /tasks/:id | Update Task status, assignee or due date |
| PATCH | /tech-debts/:id | Update debt status and remediation plan |
| POST | /work-items/:id/comments | Add a discussion message |
| POST | /work-items/:id/attachments | Upload an authorized attachment using the configured ObjectStore |
| GET | /external-resource-refs | List saved references linked to Work Items visible to the current principal; no source-system search |
| POST | /work-items/:id/external-links | Reuse an existing reference or record a new one; does not call that system |
| DELETE | /work-items/:id/external-links/:linkId | Remove a reference association without deleting the remote object |
| GET | /analytics | Request and Technical Debt portfolio metrics |

The prototype uses x-demo-user-id to simulate the authenticated Human Principal. Do not expose that header as a production authentication mechanism. The server resolves permissions from Participation for every protected write.

## External resource references

The external-links endpoints only persist pointers and Work Item relationship semantics. They do not access Jira, Confluence, GitHub or LeanIX. A Confluence Page may carry a Template key/name; the actual Template definition is retrieved by an optional Agent through its own MCP/API tool, not by this API.

The Context Capsule returns external resource IDs/keys/URLs and relationship types. It does not contain a synchronized copy of remote content.

## Workflow Engine

The API returns a `workflow` projection in Work Item detail: current status, Steps metadata, available actions and the latest transition history. Clients may request only `start_analysis`, `submit_for_review` or `close` through the transitions endpoint. Review outcomes and formal Decision outcomes trigger their corresponding transitions through their own commands.

Every successful transition updates `work_items.status`, appends `workflow_transitions`, and records an activity event. The transition rules and permission checks are server-side; the UI cannot force a target status.


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
| `workbench_add_comment` | Add a discussion note | comment |
| `agent_list_profiles` | List role-oriented Agent profiles and mapped Skills | none |
| `agent_request_run` | Queue an Agent Run for a Work Item | contribute |
| `agent_claim_next_run` | Poll and atomically claim the oldest eligible Run for a profile | read + contribute |
| `agent_claim_next_run` | Poll and atomically claim the oldest queued Run for a profile that this Host can access | read + contribute |
| `agent_claim_run` | Claim a known queued Run assigned to the profile | read + contribute |
| `agent_complete_run` | Persist the claimed run's result as a draft Artifact | claimant with contribute |
| `agent_request_human_handoff` | Pause a Run and record Human questions/actions | claimant with contribute |
| `agent_fail_run` | Record a claimed Run failure | claimant with contribute |
| `agent_resume_run` | Requeue a Human hand-off | original requester, Work Item Requestor or Admin |
| `agent_list_runs` | List Agent Runs for a Work Item | read |
| `agent_get_run_events` | Read append-only lifecycle events and Human-provided resume context | read |

There are intentionally no Agent tools for formal Review submission, Decision creation, risk acceptance, or Request closure. The MCP Host must not infer that loading architecture-review or decision-preparation grants the ability to submit a formal Review or Decision.

## Agent Run lifecycle and Host protocol

A Human creates a Run through `POST /api/work-items/:id/agent-runs` or `agent_request_run`. The Coordinator persists the objective, Work Item, optional Task, Agent profile, associated Skill, requester and lifecycle status.

An external MCP Host polls `agent_claim_next_run(agentKey)`. The server atomically claims the oldest queued Run for that profile which the Host's current principal is authorized to read and contribute to. A successful response contains the Run and Skill URI; a `null` response means no eligible Run is queued.

The Host then reads the Skill, gets the Context Capsule and retrieves individual Artifact bodies only when needed. It performs model inference using its own runtime/provider. The result is saved through `agent_complete_run` as a draft Artifact, or the Host pauses the Run using `agent_request_human_handoff`.

Human hand-off pauses only the Agent Run. The Request workflow does not change. The original requester, Work Item Requestor or an Admin can resume it. Additional context is persisted in the Run event log; after a resumed Run is claimed, the Host must call `agent_get_run_events` to read that Human context before continuing.

## Remote MCP identity

Local MCP mode is localhost-only and uses the prototype `x-demo-user-id` identity header. Remote mode requires `MCP_ALLOWED_HOSTS`, a `MCP_BEARER_TOKEN` with at least 32 characters and a non-admin `MCP_SERVICE_USER_ID`. The server overrides any caller-supplied demo identity with this fixed Service Principal. Seed creates `u-agent`; a Requestor/Admin must add it to each Work Item and grant only the permissions needed for that work. The static bearer secret is service authentication for this prototype, not per-user OAuth delegation.
