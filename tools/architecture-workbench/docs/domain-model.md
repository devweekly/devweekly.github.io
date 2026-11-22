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
| Review Cycle | review_cycles | A review round and its baseline manifest |
| Review | reviews | Independent opinion bound to an Artifact version |
| Decision | decisions | Formal decision by an authorized Human |
| Technical Debt | Work Item + debt_details + relation | Optional long-lived follow-up; not created for every Request |
| External Resource Reference | external_resource_refs | Pointer/identifier for an external Jira, Confluence, GitHub or LeanIX resource; no synchronized content |
| Work Item External Link | work_item_external_links | Many-to-many relation between Work Items and external resources, with a business relation type and optional Confluence Template reference |
| Thread | comments | Human discussion attached to a Work Item |
| Attachment | attachments + ObjectStore | File metadata and authorization in SQLite; bytes in local storage or S3 |
| Workflow Transition | workflow_transitions | Append-only history of Request lifecycle transitions, actions, actor and reason |
| Activity | activity_events | Append-oriented business activity record |
| Work Session | not persisted in prototype | Runtime/session detail is not business state |

## Decision outcomes

- accepted
- accepted_with_conditions
- more_analysis
- rejected

These are prototype values. A production Decision Policy must define applicable outcomes, subject scope, mandatory reviewers, quorum, authority, segregation of duties, and conditional obligations.

## Authorization

Each Participation stores a set of permissions such as read, contribute, comment, review, decide and manage. Permissions are explicit and not hierarchical: manage does not automatically grant decide or review. Each write API re-checks the current actor's Participation. A production deployment must replace the demo identity header and permission seed data with OIDC/OAuth identity, policy versioning and revocable Delegation Grants.

## Technical debt lifecycle

Technical Debt is represented as a Work Item so that it can have its own owner, status, priority, due date, artifacts, tasks and future review. The work_item_relations link identifies its origin; debt_details holds debt-specific attributes. It is not a boolean attribute on an ADR.

## External context references

External resources are references, not integrations. The Workbench stores identifiers, keys, URLs, resource types and the relationship to a Work Item. A resource reference may be linked to multiple Work Items, and a Work Item may link to multiple resources.

For a Confluence Page, the association may include a Template key/name reference. This is not a copy of the actual Confluence Template definition. If a future Workbench Agent needs the page or template content, the Agent resolves it using its own configured MCP/API tool connection. The Workbench API does not connect to source systems, synchronize status, cache source content or hold their credentials.

A Context Capsule carries the references, not the remote page contents or live Jira/LeanIX facts. Any Agent retrieval must respect source-system authorization and preserve source identity and retrieval time in its analysis.

## Request workflow

The workflow is intentionally small and deterministic. Request status remains the business source of truth; the Workflow Engine validates allowed transitions and records each transition in `workflow_transitions`.

| Current stage | Allowed next action | Next stage |
| --- | --- | --- |
| draft | Start analysis | analysis |
| analysis | Submit for review | in_review |
| changes_requested | Resubmit for review | in_review |
| in_review | Reviewer requests changes | changes_requested |
| in_review | Decision: accept | accepted |
| in_review | Decision: reject | rejected |
| in_review | Decision: more analysis | analysis |
| accepted / rejected | Close | closed |

Submitting for review requires at least one Artifact. Each submission closes the previous active Review Cycle and captures a new baseline manifest. A Review outcome of `request_changes` moves the Request to `changes_requested`; final acceptance, rejection and more-analysis outcomes still require a formal Decision.

The UI renders the server-provided workflow projection with Ant Design Steps. It does not decide which transitions are allowed. Permission checks and state transitions are performed by the server Workflow Engine.

## Relevant people and personal work

The Requestor is recorded separately from the Work Item Owner. The Requestor, a global Workbench Admin or a Work Item principal with explicit `manage` permission can add, update or remove Participation records. The Requestor and Owner must remain participants.

People can maintain their own profile. A Workbench Admin can maintain any profile. A Task Assignee can update their own Task status without receiving broader Request contribution permissions; reassignment and due-date edits remain contributor/admin actions.
