# ADR-0010: Business Workflow, Submission Baseline and Work Item Workspace

- Status: Accepted
- Date: 2026-11-22
- Supersedes: None
- Related: ADR-0001, ADR-0005, ADR-0007, ADR-0008, ADR-0009

## Context

The Workbench has a durable Work Item model and a small server-owned lifecycle. Its detail page had gradually exposed the domain model as parallel tabs: overview, reviews, tasks, Agent collaboration, decisions and activity. Users had to combine these views to understand the current stage, the person accountable for the work, the next action and the material being reviewed.

That presentation also blurred three different kinds of progress. The Work Item lifecycle is a business commitment; Tasks coordinate work between people and Agents; Agent Plans and Runs describe execution inside an Agent Host. They have different authorities, recovery rules and meanings. Exposing all three as one workflow makes a simple business process look like an orchestration console.

Review Cycle currently stores its material baseline as JSON. A baseline needs its own durable identity because one review submission can contain several independently versioned Artifacts. A subsequent revision must not silently change what an earlier reviewer was asked to inspect.

This decision follows the Shared Business Work Item model described in [From A2A to Shared Business Work Items](https://github.com/devweekly/devweekly.github.io/blob/main/src/content/blog/multi-role-agent-collaboration-business-work-items-2026.md). It also applies Apple's interface guidance on clarity, user agency, hierarchy and progressive disclosure:
- [Apple Human Interface Guidelines: Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
- [Apple Human Interface Guidelines: Layout](https://developer.apple.com/design/human-interface-guidelines/layout)

## Decision

### 1. Use the Request lifecycle defined by ADR-0011

The five-stage lifecycle described in the original version of this ADR is superseded by [ADR-0011](0011-request-submission-review-and-human-decision.md). The Work Item remains the business source of truth, but the business stages are Request Package, Discussion and Review, Decision Meeting, and Pending Close / Complete.

ADR-0011 is authoritative for statuses, timer behavior, clarification handling, formal decision outcomes and closure authority. The remaining decisions in this ADR continue to apply: workflow layers stay separate, Task accountability remains distinct from Agent execution, each Submission has an immutable manifest, formal decisions remain Human-authorized, and the Work Item Workspace remains business-first.

### 2. Separate the three workflow layers

- **Business Workflow** owns Work Item status, formal gates, authorized transitions and lifecycle history.
- **Collaboration Workflow** owns Task ownership, assignment, dependencies, hand-off between participants, independent Review and material iteration.
- **Agent Execution Workflow** owns Agent Plan DAGs, Run claims, leases, retries, Host execution and runtime traces.

The three layers may reference each other but cannot substitute for one another. A completed Agent Run means execution finished; it does not mean a Task was accepted, a Review approved, a Decision made or a Work Item completed.

### 3. Make task accountability explicit

A Task distinguishes:
- **Task Owner**: the Human accountable for the result and follow-through.
- **Assignee**: the current Human assigned to perform the work.
- **Executor**: the actual participant or Agent Runtime performing a step. Agent Run claimant data is execution metadata, not a transfer of business responsibility.
- **Reviewer**: an independent participant providing a review against a fixed Submission.

Task Owner and Assignee must be participants in the Work Item. A contributor may maintain these assignments. An assignee or Task Owner may update task progress within the existing authorization rules. Agent claim or completion never changes Task Owner.

### 4. Give each review submission an immutable identity

Introduce a `Submission` record when the Work Item is submitted for review. Its manifest fixes the Artifact IDs, versions, content hashes, purpose, context version, submitting principal and creation time. A Review Cycle references the Submission and retains its existing baseline JSON for compatibility.

The Submission, Review Cycle, Work Item transition and transition/activity records are written in one database transaction. A new Artifact version does not mutate an existing Submission or change the active Review Cycle's baseline. A later resubmission creates a new Submission and a new Review Cycle; earlier Reviews remain attached to the original baseline.

Existing Review Cycles are migrated by creating a legacy Submission from their existing baseline JSON. The original baseline is preserved; no historical Review is rebound to a different version.

### 5. Keep formal decisions human-authorized

Agent output and synthesis remain draft Artifacts. An Agent may prepare options, evidence, assumptions, trade-offs and recommended actions. Only a principal with explicit `decide` permission can create a formal Decision or advance a decision gate. Agent tools do not gain formal Review, Decision, risk acceptance or Work Item closure authority.

### 6. Present a focused Work Item Workspace

The normal workspace puts business work ahead of implementation detail.

The primary view presents:
1. Work Item identity, current stage, Work Item Owner and the next useful action.
2. The server-provided lifecycle and its available actions.
3. Current Tasks with Task Owner, Assignee, status and due date.
4. Latest deliverable versions and the history of immutable Submissions.
5. Discussion attached to the Work Item.

An Additional Information disclosure contains participation and permission administration, full review and decision records, all Artifact versions, attachments, external references, Agent Plans/Runs, Context Capsule export and activity/technical traces. These remain available but do not compete with the primary work.

Global navigation is reduced to My Work, All Work Items, Portfolio and Technical Debt. People and profile administration remain available as a secondary destination. A Work Item has a stable URL so it can be linked, reopened and navigated with browser history.

The UI follows Apple's design principles as product behavior rather than visual imitation: show the most relevant information first, keep user actions explicit and reversible where possible, and reveal specialized controls when the user asks for them.

## Consequences

- The existing Workflow Engine and Agent DAG coordinator remain in place; this ADR changes their boundaries and presentation, not their responsibilities.
- Submission manifests make review scope inspectable and immutable. The current implementation records Artifact identity/version/hash and context version; a fully versioned, field-level Context View remains a future extension.
- Task Owner is additive. Existing Task rows are backfilled using the previous assignee when present, otherwise the Work Item Owner, preserving a named accountable person while retaining the current assignee.
- The primary workspace becomes simpler without deleting advanced capabilities or domain records.
- Submission history is now a first-class business record. Any future API that creates Review Cycles must create and bind a Submission in the same transaction.
- Production authorization, reviewer assignment/quorum policy and enterprise identity delegation remain separate hardening work; UI visibility is never an authorization boundary.
