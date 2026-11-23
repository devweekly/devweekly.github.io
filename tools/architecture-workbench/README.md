# Architecture Workbench

Architecture Workbench manages architecture proposals and ADRs, coordinates cross-functional reviews, records formal decisions, and tracks technical debt that must be addressed after those decisions.

The project lives under `devweekly/tools` and runs independently of the Astro site build. In addition to architecture reviews, it supports other business work items such as change assessments and risk assessments.

## Current Implementation

- React 19, Vite, and TypeScript.
- Ant Design 6 provides the enterprise UI; Ant Design X provides optional Agent and context-assistance surfaces.
- Express 5 exposes the REST API.
- Node.js built-in `node:sqlite` is used for the first phase of persistence. Node.js 24.0 or later is required.
- Unstructured files are stored through the `ObjectStore` interface. The default implementation writes to a local directory; configuring S3 switches to the AWS SDK implementation.
- The Workbench Server publishes role Skills and business Tools over MCP. It also provides an Agent Plan / Run Coordinator, DAG dependencies, and a final synthesis node. A separate Agent Host connects to MCP, schedules executable nodes, and invokes the model Runtime through a deployment-provided `AgentExecutor` plugin. Workbench is not coupled to Copilot, CodeBuddy, or a specific model SDK. Jira, Confluence, GitHub, and LeanIX are registered only as external context references; Workbench does not implement connectors, synchronization, or caching for those systems.

## Getting Started

Requirements: Node.js >=24.0 and pnpm or npm.

```bash
cd tools/architecture-workbench
cp .env.example .env
npm install
npm run dev
```

The frontend runs at http://localhost:5173 and the API at http://localhost:4000. On first startup, the application creates the SQLite schema and demo data. The default database is `data/architecture-workbench.sqlite`. Express loads the local `.env` file through dotenv.

For production mode, run `npm run build` followed by `npm start`.

The identity selector at the top of the page lets you switch between demo users and inspect their different permissions on each work item. The system also creates an administrator demo account for maintaining the people directory and workflows. Identity switching is for local testing only. A production deployment must integrate enterprise identity and provide a controlled administrator-account management process.

## Prototype Capabilities

1. Create business work items and inspect their owners, status, participants, and linked resources.
2. Add ADRs, architecture proposals, and other versioned artifacts to a work item.
3. When a requestor submits a package, the system records the artifact versions and content summaries used as the review baseline, together with the submission note. An Agent may help prepare the package, but the requestor must confirm and submit it.
4. Discussion and review have explicit deadlines. Ordinary comments do not change the workflow. Requesting clarification pauses the review timer. A blocking objection or an expired review period moves the item into a decision meeting.
5. The meeting chair or an administrator records approval, a request for changes, or rejection after the decision meeting. When changes are requested, the requestor revises and resubmits the package. After approval or rejection, the meeting chair or an administrator must explicitly close the work item.
6. Assign a task owner and assignee independently. Agent task records identify the actual executor without transferring human accountability.
7. Manage work item participants and grant read, contribute, comment, review, decide, and participant-management permissions independently. Participant-management permission does not imply review or decision authority.
8. Link technical debt to the work item and decision that introduced it. Track its owner, priority, severity, target state, remediation plan, status, and due date separately.
9. Update task status and inspect discussion and activity history.
10. Upload files and evidence attachments. Files are stored locally by default, with optional AWS S3 support.
11. Link external resources such as Jira Stories, Confluence Pages, GitHub repositories, and LeanIX Applications or Interfaces. A resource can be reused by multiple work items.
12. Record a Confluence page template identifier so an Agent with the required access can retrieve the template content.
13. Review global analytics for work items and technical debt, including status, priority, age, overdue items, originating work items, and external-resource relationships.
14. Copy the context of work items visible to the current user for use with Copilot, Claude, or another Agent. The exported context contains external links and relationships, not source-system content.

## Core Domain Model

A **Work Item** represents business work that needs to be tracked over time, such as an architecture review, change assessment, or technical-debt item. Architecture reviews and technical debt are simply different Work Item types. ADRs and architecture proposals are versioned Artifacts. A Review records feedback against a specific review cycle, Artifact, and version. A Decision records who made the decision, its outcome, rationale, and conditions. A work item can link to multiple external resources, and an external resource can be referenced by multiple work items.

A **Task** is executable work; it is not a review comment or a formal decision. The task owner is accountable for the result, while the assignee performs the work. An **Agent Run** records the Agent that actually executed a task and does not replace human accountability. Request status is managed by a Node.js state machine. Each submission freezes the artifact versions and content summaries used by that review cycle. The review runs against its stored deadline, and only an authorized meeting chair or administrator can record a formal decision. One person may hold multiple roles on the same work item; explicitly granted permissions are combined. Participant-management permission does not automatically grant review or decision authority. A reviewer cannot independently review their own submission, and a later Artifact version does not change the baseline of a review already in progress.

The local prototype simulates the current user through a request header. The server enforces access according to work item participation permissions. Before production deployment, integrate enterprise OIDC/OAuth authentication and delegated authorization, and enforce resource-level access checks.

## Work Item Workspace

A work item opens in one continuous workspace rather than splitting the overview, tasks, artifacts, reviews, and Agent execution records into a row of peer pages. The default view prioritizes the current stage, owner, next action, active tasks, Artifact versions, and discussion.

Participants and permissions, full review and decision history, Artifact version history, submission history, external resources, attachments, Agent plans and runs, context export, and activity history are grouped under **More Details**. Global navigation includes My Work, All Work Items, Analytics, and Technical Debt. The People Directory is a secondary entry point.

The design follows the Apple HIG principles of clear hierarchy, user control, and progressive disclosure. It does not attempt to reproduce the visual appearance of a particular Apple product. Business workflow, collaborative tasks, and Agent execution remain three separate layers.

## Storage Design

SQLite is used only for the local prototype. Data access is concentrated in `server/db.ts` and the Express Application Service; the frontend never accesses the database directly. A future PostgreSQL migration should preserve the domain API and business constraints while replacing the database connection and repository implementation. It will also require formal migration scripts, concurrency control, and backup/recovery procedures. A PostgreSQL driver has not yet been implemented.

Object storage is isolated behind the `ObjectStore` interface in `server/object-store.ts`. The default `LocalObjectStore` writes files to `LOCAL_OBJECT_DIR`. Set `STORAGE_DRIVER=s3`, `S3_BUCKET`, and `AWS_REGION` to use `S3ObjectStore`. Deployment environments should prefer IAM Roles or Workload Identity; never put long-lived AWS keys in source code or commit them to the repository. File metadata and access grants are managed in the business database. An S3 URI is not an authorization mechanism.

## AI and Agent Integration

LangChain, DeepAgents, and LangSmith are not included at this stage. The prototype is intended to validate business state, authorization, review, and decision boundaries—not Agent orchestration. Ant Design X provides optional Agent assistance, and the UI can export a Context Capsule.

The Workbench Server uses the official MCP TypeScript SDK v2 to publish Skills and business Tools at `http://localhost:4000/mcp`. Skills are discovered and read through `skills/list`, `skills/get`, and `resources/read`. Business Tools query work items, read Context Capsules, manage Tasks, and submit Artifact drafts and discussion records. Each Skill directory contains a `SKILL.md` and may include supporting references and examples. The catalog is strictly validated at startup and deployed with the application version.

**The Workbench backend does not integrate with external business systems.** It stores only the IDs/keys, URLs, resource types, relationship semantics, and Confluence Template reference identifiers for Jira Stories, Confluence Pages, GitHub repositories, and LeanIX Applications or Interfaces. It does not call external APIs, synchronize status, copy source content, or store credentials for those systems. Users can reuse references already registered and visible to their current identity; new resources are entered by the user. There is no source-system search picker.

The external Agent Host is the MCP/API tool client. It reads references from a Work Item, uses its own configuration and authorized source-system tools to retrieve external content when needed, then submits analysis, evidence, and drafts back to Workbench. External access remains governed by each source system and the identity/authorization used by the Agent. Agent results must retain their source and retrieval time. They cannot automatically create a formal Review Outcome or Decision.

An **Agent Plan** is a multi-role analysis task. Each **Agent Run** is an executable node, with dependencies stored in `agent_run_dependencies`. When a plan is created, Workbench adds a final synthesis node and waits for all specialist roles to finish before running it. When an Agent Host polls through `agent_claim_next_run`, the server returns only nodes whose dependencies are complete and that the current service identity is authorized to execute. Independent nodes can run in parallel; dependent nodes become claimable only after their prerequisites succeed. Each node's output is saved as an Artifact draft. The synthesis node reads the specialist results and prepares a decision brief for the responsible owner.

Run claiming uses server-managed Claim Leases. The default lease is 60 seconds, and the Host sends a heartbeat every one-third of the lease duration. Workbench Service periodically scans expired leases and performs another recovery pass before assigning new work. When a lease expires, the old Claim Token becomes invalid and the Run returns to the queue for another Host to claim with a new Token. Each Run can be claimed at most three times; repeated crashes that exhaust the limit move the Run to `failed`. Artifact creation and Run completion are committed in the same SQLite transaction so an expired Worker cannot leave orphaned output.

Workbench does not run model inference inside the server process. A separate Host process runs through `npm run agent-host`, polling MCP concurrently for its configured roles. The Host loads and validates Skills, obtains the Context Capsule, and invokes the deployment-provided `AgentExecutor`. The plugin owns the model SDK, credentials, model selection, and context strategy. The Host handles protocol, scheduling, dependency execution, and result submission.

Skills describe working methods, MCP Tools expose controlled operations, and the Coordinator manages the Agent Run lifecycle. The Host must discover, validate, approve, and load Skills itself. Agents can create drafts, Tasks, and discussion records only. There are no MCP Tools for formal Review Outcomes, Decisions, risk acceptance, or work item closure. Each Tool rechecks the current Participation permissions; a Skill or Agent Profile cannot expand authorization.

LangChain or DeepAgents may be considered as future Agent Runtime implementations, and LangSmith may be used for execution tracing. They are not external-system connectors and must never become the source of truth for business state.

## Agent Host

After installing the project dependencies, configure the MCP endpoint, a remote Bearer Token (for remote mode), the roles to run, and the Executor plugin path:

```bash
# Workbench Server lease settings
AGENT_RUN_LEASE_MS=60000
AGENT_RUN_LEASE_SWEEP_MS=10000

# Separate Agent Host process
MCP_URL=http://localhost:4000/mcp
MCP_DEMO_USER_ID=u-agent
AGENT_EXECUTOR_MODULE=/absolute/path/to/agent-executors.ts
AGENT_HOST_PROFILES=business-analyst,solution-architect,data-architect,security-reviewer,decision-analyst
AGENT_HOST_WORKERS_PER_PROFILE=1
AGENT_HOST_POLL_INTERVAL_MS=3000
npm run agent-host
```

The Executor plugin must export `createAgentExecutors()`, returning an `AgentExecutor` indexed by Agent Profile key. The interface is defined in `server/agents/host.ts`. It is loaded and executed by the separate `npm run agent-host` process. **It is not browser UI client code and does not run inside the Workbench Server process.** Its `execute()` method receives the validated Skill, Context Capsule, Run metadata, optional Plan synthesis context, Artifact-reading methods, and an `AbortSignal` for lease loss. It must return a Draft Artifact or explicitly request a Human hand-off. The Host captures execution exceptions and records Run failures. This repository provides the Host and Executor interface, but does not bundle CodeBuddy, Copilot, or another real model Provider Adapter.

A remote Host uses `MCP_URL` and a Workbench API access token issued by Entra (passed through `MCP_BEARER_TOKEN`). The local demo mode uses `MCP_DEMO_USER_ID`. An Entra delegated token maps to a Workbench Person through `tid + oid`; an app-only Agent token maps through `MCP_SERVICE_USER_ID` to a non-Admin service identity. Both identities must be added to the relevant Work Item and granted only the required Participation permissions. The Agent Host does not currently handle interactive login or token refresh; token acquisition and renewal are the responsibility of the deployment. Do not put model API keys in Workbench Server configuration or commit them to the repository.

## Repository Layout

```text
client/              React, Ant Design, and Ant Design X
server/              Express API, SQLite schema/seed, and object-storage adapters
server/agents/       Agent Profile, Plan Coordinator, MCP Agent Host, and Executor contract
server/mcp/          Skills Extension, business Tools, and MCP Host smoke tests
skills/              Role Skills published through the MCP Skills Extension
ADR/                 Architecture Decision Records
docs/                Domain model, authorization, and API documentation
data/                Local runtime data (gitignored)
```

## Current Limitations

- Demo authentication selects an identity through a request header and is not suitable for production.
- Skills and business Tools over MCP, DAG Agent Plans, server-side Claim Leases, and a provider-neutral Agent Host are implemented. No model Provider Adapter is bundled; deployments must supply an `AgentExecutor` plugin. A complete organizational directory and policy engine are not yet implemented, and there are no Jira, Confluence, GitHub, or LeanIX connectors.
- Local MCP allows only a localhost Host and simulates the caller through `x-demo-user-id`; it is not suitable for production. Remote MCP must configure `MCP_ALLOWED_HOSTS` and enable the Entra OAuth Resource Server (`MCP_AUTH_ENABLED=true`), or explicitly use the prototype-only static Bearer Token compatibility mode. Entra mode validates the v2 access-token signature, issuer, audience, tenant, client allowlist, and delegated scope/app role. Delegated users map to People through `tid + oid`; app-only Agents map to the non-Admin `MCP_SERVICE_USER_ID`. Email-based automatic matching is disabled by default. With Entra disabled, a remote static Token remains mapped to a service identity and does not provide user delegation.
- The current SQLite implementation uses incremental schema checks at startup to support existing prototype databases. There is no general migration framework or PostgreSQL adapter. A PostgreSQL migration requires an asynchronous Repository / Unit of Work implementation; changing only the connection string is insufficient.
- Local/S3 upload and metadata recording are implemented. Authorized downloads or presigned URLs scoped to a Work Item, and malware scanning, are not yet implemented.
- Request package submission, review-baseline version retention, comments, clarification, blocking objections, decision meetings, and closure by a meeting chair or administrator are implemented. The reviewer roster is captured when review starts. Production still needs notification delivery, reviewer-independence rules, quorum handling, and configurable review policies.
- The timer service uses a single Node.js `setTimeout` with tasks persisted in SQLite. It targets the current single-instance prototype; multi-instance deployment requires stricter task claiming, leases, and recovery coordination.
