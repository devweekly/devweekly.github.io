# Domain Model

The prototype deliberately separates business facts from interaction and execution details.

| Concept | Prototype representation | Meaning |
| --- | --- | --- |
| Work Item | work_items | Durable business matter and lifecycle |
| Participation | participations | Principal's role and action permissions in one Work Item |
| Person Profile | people | Directory profile, expertise, contact details and global Workbench Admin flag |
| Requestor | work_items.requestor_id | Person who raised the Request; can maintain the Request's relevant people |
| Task | tasks | Executable work with owner, status and due date |
| Artifact | artifacts | Versioned deliverable, including ADR and evidence |
| Submission | submissions | Immutable manifest for one formal material submission, including Artifact versions and context version |
| Review Cycle | review_cycles | A review round bound to one Submission and its baseline manifest |
| Review | reviews | Independent opinion bound to an Artifact version |
| Decision | decisions | Formal decision by an authorized Human |
| Technical Debt | Work Item + debt_details + relation | Optional long-lived follow-up; not created for every Request |
| External Resource Reference | external_resource_refs | Pointer/identifier for an external Jira, Confluence, GitHub or LeanIX resource; no synchronized content |
| Work Item External Link | work_item_external_links | Many-to-many relation between Work Items and external resources, with a business relation type and optional Confluence Template reference |
| Thread | comments | Human discussion attached to a Work Item |
| Attachment | attachments + ObjectStore | File metadata and authorization in SQLite; bytes in local storage or S3 |
| Workflow Transition | workflow_transitions | Append-only history of Request lifecycle transitions, actions, actor and reason |
| Clarification Request | clarification_requests | Reviewer question bound to a Submission and response deadline, including the answer or unanswered result |
| Decision Meeting | decision_meetings | Chairman, meeting time, minutes, rationale and formal outcome for a Review Cycle |
| Workflow Timer | workflow_timers | Durable review or clarification deadline, scheduler status, lease, attempts and processing error |
| Activity | activity_events | Append-oriented business activity record |
| Agent Profile | server/agents/coordinator.ts registry | Role-oriented execution capability mapped to one Skill; not a Person or model provider |
| Agent Plan | agent_plans | Multi-role collaboration request with an overall status and final synthesis Artifact |
| Agent Run | agent_runs | One role-specific Plan node or standalone execution against a Work Item, with status, claim lease, bounded attempt count and optional Task/Artifact links |
| Agent Run Dependency | agent_run_dependencies | Directed edge that prevents a downstream node from being claimed until its prerequisites complete |
| Agent Run Event | agent_run_events | Append-only execution, failure, completion and Human hand-off history |
| Agent Runtime Adapter | server/agents/runtime.ts | Provider-neutral capability contract |
| Agent Host | server/agents/host.ts + host-cli.ts | Pull worker that verifies Skills, reads Workbench context, calls an AgentExecutor and writes results through MCP |
| Agent Executor | deployment-provided module | Provider-specific model invocation for one or more Agent Profiles |
| Work Session | external Host-owned | Model context and runtime session are not business state |

## Decision outcomes

The Request lifecycle uses three formal outcomes: `approved`, `needs_work` and `rejected`. The outcome is separate from the Work Item phase. Approval and rejection enter a pending-close state; Need Work returns the Request to Requestor revision and requires a new Submission. Artifact-level decisions, where separately supported, must not be confused with the Request-level Decision Meeting outcome.

A production Decision Policy must define mandatory reviewers, quorum, authority, segregation of duties, and conditional obligations.

## Authorization

Each Participation stores a set of permissions such as read, contribute, comment, review, decide and manage. Permissions are explicit and not hierarchical: manage does not automatically grant decide or review. Each write API re-checks the current actor's Participation. A production deployment must replace the demo identity header and permission seed data with OIDC/OAuth identity, policy versioning and revocable Delegation Grants.

## Technical debt lifecycle

Technical Debt is represented as a Work Item so that it can have its own owner, status, priority, due date, artifacts, tasks and future review. The work_item_relations link identifies its origin; debt_details holds debt-specific attributes. It is not a boolean attribute on an ADR.

## External context references

External resources are references, not integrations. The Workbench stores identifiers, keys, URLs, resource types and the relationship to a Work Item. A resource reference may be linked to multiple Work Items, and a Work Item may link to multiple resources.

For a Confluence Page, the association may include a Template key/name reference. This is not a copy of the actual Confluence Template definition. If a future Workbench Agent needs the page or template content, the Agent resolves it using its own configured MCP/API tool connection. The Workbench API does not connect to source systems, synchronize status, cache source content or hold their credentials.

A Context Capsule carries the references, not the remote page contents or live Jira/LeanIX facts. Any Agent retrieval must respect source-system authorization and preserve source identity and retrieval time in its analysis.

## Request workflow

The lifecycle is defined by ADR-0011 and enforced by the server-side state machine. The Request Package is submitted once by the Requestor and frozen as an immutable Submission; initial proposal and supporting material belong to this package, while analysis Tasks and Agent Runs remain execution activities.

| Current phase | Event | Next phase | Rule |
| --- | --- | --- | --- |
| draft / requestor_revision | Requestor submits Request Package | discussion_review | Freeze manifest, reviewer snapshot and review deadline |
| discussion_review | Comment | discussion_review | Discussion only; deadline is unchanged |
| discussion_review | Request clarification | waiting_requestor | Pause remaining review duration and start clarification deadline |
| waiting_requestor | Requestor answers all pending clarifications | discussion_review | Resume remaining review duration |
| waiting_requestor | Clarification deadline expires | decision_meeting | Record unanswered clarification and proceed to meeting |
| discussion_review | Blocking objection | decision_meeting | Early hand-off; objection is not a formal rejection |
| discussion_review | Review deadline expires | decision_meeting | No implicit approval |
| decision_meeting | Approved | approved_pending_close | Chairman/Admin records meeting result and rationale |
| decision_meeting | Need Work | requestor_revision | Requestor prepares a new Submission |
| decision_meeting | Rejected | rejected_pending_close | Chairman/Admin records rejection |
| approved_pending_close / rejected_pending_close | Chairman/Admin closes | closed | Explicit human closure |

The review deadline is independent from the Work Item's business target date. The default review duration is configurable with `WORKFLOW_REVIEW_DAYS`; the clarification response duration is configurable with `WORKFLOW_CLARIFICATION_DAYS`. Ordinary comments do not affect either deadline. Only people captured in the Submission's reviewer snapshot can use the Review operations. Reviewers can comment, ask the Requestor to clarify or raise a blocking objection; they cannot formally approve or reject the Request. Ordinary Work Item discussion remains available through the separate Comments operation.

A Request Package may be drafted with Agent assistance, but a completed Agent Run does not submit it. The Requestor confirms the final package and submission message. The Submission stores the Requestor as submitter and the assisting Run ID as provenance when provided.

The UI renders the server-provided workflow projection and available actions. The server re-checks Requestor, reviewer, Chairman and Admin permissions on each transition. Task status and Agent Run status remain separate from the Request lifecycle.

## Submission manifest

A Submission is created by the server when a Requestor submits a Request Package. It stores the Git-commit-style submission message, package JSON, Requestor identity, optional Agent Run provenance, source Submission and an immutable manifest of Artifact IDs, versions, code/type, titles and content hashes, together with the context version and creation time. The Review Cycle references that Submission and retains `baseline_json` for compatibility with existing consumers. An empty Artifact manifest is valid when the Request Package itself contains the initial business input and no separate deliverable has yet been attached.

A material revision creates a new Artifact version. It does not rewrite an earlier Submission, reset prior Review outcomes or silently alter what a reviewer evaluated. A Need Work outcome returns the Request to Requestor revision; resubmission creates a new Submission/Review Cycle pair. Reviews and clarifications remain attached to their original cycle and Artifact versions. Submission, Review Cycle, Work Item transition, timer and activity records are committed together.

At startup, existing Review Cycles without a Submission are migrated by copying their current `baseline_json` into a legacy Submission. This preserves the historical baseline instead of guessing a new one.

## Workflow layers

The Workbench keeps three distinct layers:

- Business Workflow: Work Item lifecycle, formal gates, permission-checked transitions and transition history.
- Collaboration Workflow: Tasks, accountable owners, assignees, dependencies, participant hand-off and independent Reviews.
- Agent Execution Workflow: Agent Plans, Run nodes, claims, leases, retries, Host sessions and execution traces.

Only the Business Workflow controls Work Item status. A Task or Agent Run can be blocked, waiting or complete without changing the business stage. An Agent Plan is an execution mechanism, not a business approval stage.

## Relevant people and personal work

The Requestor is recorded separately from the Work Item Owner. The Requestor, a global Workbench Admin or a Work Item principal with explicit `manage` permission can add, update or remove Participation records. The Requestor and Owner must remain participants.

People can maintain their own profile. A Workbench Admin can maintain any profile. A Task Owner or Assignee can update Task status without receiving broader Request contribution permissions; reassigning the Owner/Assignee and changing due date remain contributor-only actions.


## Agent collaboration model

A Person, Agent Profile, Skill and Task are distinct concepts. A Person is an accountable Human principal with Participation permissions. An Agent Profile describes a bounded role such as Business Analyst or Security Reviewer. A Skill supplies that role's work method. A Task is a unit of work that may be used to scope an Agent Run. The Agent Host supplies the model/runtime that executes the profile.

The Coordinator persists Agent Run lifecycle and ownership. An Agent Run is queued against a Work Item and one registered profile; the profile maps to a published Skill. An authorized Host claims the Run, retrieves the Skill and Work Item context, and works through MCP business tools. Its output is saved as a draft Artifact. The Run event log records queue, claim, completion, failure, Human hand-off and resume events.

The initial execution model is pull-based. Workbench does not launch model processes or depend on a specific Agent SDK. A Host can be built with Copilot SDK, CodeBuddy SDK, Claude, another provider, or an in-house runtime, as long as it follows the MCP contract and uses its own authorized tool connections.

Human intervention is explicit. An Agent can pause its Run with questions and recommended actions; it cannot decide for the Human or move the Request Workflow. A Work Item Requestor or Admin may resume a Run after supplying missing context. Completion only produces a draft Artifact; it does not submit an official Review or Decision.

The remote MCP service identity is a non-admin Person principal (seeded as `u-agent` in the prototype). It receives no global permissions by default. A Requestor/Admin must add it to each Work Item and grant only the permissions needed for that assignment. Local demo identity headers are not production authentication.

## Multi-role Agent Plans

A Plan is a durable collaboration request, separate from the Work Item business workflow. It owns a set of Agent Run nodes and dependency edges. A Plan does not represent an approval stage and cannot change Request status.

The caller provides one to eight specialist nodes. Each node has a unique key, one Agent Profile and optional prerequisites. The server validates the dependency graph as a directed acyclic graph and creates an additional synthesis node mapped to the Decision Analyst profile. That node depends on all requested specialists, so it becomes available only after every specialist Artifact has been persisted.

The Host claims only nodes whose prerequisites are complete. Independent branches may run in parallel. A failed node blocks its descendants; the Plan remains failed once no remaining branch is running or ready. A Human hand-off pauses the affected Run and moves the Plan to waiting_for_human; the Request Workflow itself is unchanged.

The synthesis node receives the completed specialist Artifact bodies together with their profile and node identity. It must identify areas of agreement, differences, unresolved assumptions and residual risks. Its output is a draft decision brief and remains subject to Human review. The system does not automatically flatten disagreement or turn an Agent recommendation into a formal Decision.

## Agent Host and Executor contract

The Host is a separate pull process. It connects to Workbench through Streamable HTTP MCP, discovers the assigned Skill, verifies its digest, reads the Context Capsule and calls a deployment-provided AgentExecutor. The Executor is responsible for provider-specific model calls, prompt construction and any source-system MCP/API tools.

The Host owns protocol mechanics: polling, profile-specific concurrency, dependency-aware claiming, context retrieval, failure recording and result submission. It does not own business permissions; every tool call is re-authorized by Workbench. The Host does not assume a specific Agent SDK or model provider.