# ADR-0011: Request Submission, Time-bounded Review and Human Decision

- Status: Accepted
- Date: 2026-11-22
- Supersedes: ADR-0010, section 1 (business lifecycle taxonomy and lifecycle transitions) only
- Related: ADR-0001, ADR-0005, ADR-0007, ADR-0008, ADR-0009, ADR-0010

## Context

The earlier five-stage lifecycle described intake, analysis, professional review, decision and closure as separate phases. In practice, Requestor submission and the initial proposal are one business submission package. Analysis tasks, specialist work and Agent runs may continue around the package, but they do not need a separate business lifecycle stage.

Review is an asynchronous, time-bounded discussion window. Most reviews do not require an explicit approval action. A Request proceeds to a decision meeting when the review deadline expires, when a blocking objection is raised, or when a clarification request is not answered by its response deadline. A clarification pauses the remaining review time. A comment does not stop or reset the clock.

A reviewer's objection is not a formal rejection. Only the designated Chairman or a Workbench Admin records the formal outcome at the decision meeting. The Request is not automatically approved when a deadline expires. After an approved or rejected decision, the Chairman or Admin explicitly closes the Request.

The process needs durable timers and event-driven transitions, but the current service is a single Node.js application using SQLite. Introducing a general workflow engine, BPMN runtime, Redis or a third-party job queue would add an unnecessary operational dependency.

## Decision

### 1. One Request Package submission

The Requestor prepares and confirms a Request Package containing:
- business problem, context and target outcome;
- scope, constraints and relevant risks;
- optional initial proposal and evidence;
- questions requiring a committee decision;
- an immutable material manifest;
- a Git-commit-style submission message describing the intent of this revision.

An Agent running in the Client may help the Requestor compose or revise the Request description. This is ordinary Client-side assistance; it does not create a server-side Agent Package Draft, database entity or MCP tool. The Requestor remains the submitter and explicitly confirms submission. Agent execution, plan completion or artifact creation never submits a Request.

A later revision creates a new Submission linked to the prior Submission. It does not overwrite the previous package or review baseline.

### 2. Four business stages and explicit outcomes

| Stage | Status | Behavior |
| --- | --- | --- |
| Request Package | `draft`, `requestor_revision` | Requestor prepares or revises the package and submits it |
| Discussion and Review | `discussion_review`, `waiting_requestor` | Reviewers discuss the frozen Submission; timer may pause for clarification |
| Decision Meeting | `decision_meeting` | Chairman/Admin records the formal result |
| Pending Close / Complete | `approved_pending_close`, `rejected_pending_close`, `closed` | Chairman/Admin explicitly closes approved or rejected Requests |

The formal Decision Outcome is separate from the current phase: `approved`, `needs_work` or `rejected`.

- `approved` moves to `approved_pending_close`.
- `needs_work` returns to `requestor_revision`; the next submission creates a new Submission and Review Cycle.
- `rejected` moves to `rejected_pending_close`.
- Only the Chairman or a Workbench Admin can close an approved or rejected Request.

### 3. Discussion and Review rules

Each Submission creates an immutable Review Cycle, a reviewer snapshot and a persisted review deadline.

- **Comment** is discussion only. It does not change the phase or deadline.
- **Request Clarification** records the question and a response deadline, pauses the remaining review duration and moves the Request to `waiting_requestor`.
- **Answer Clarification** is performed by the Requestor. When all open clarification requests are answered, the remaining review duration resumes.
- **Unanswered Clarification** at its deadline moves the Request to the Decision Meeting and remains visible as unanswered.
- **Blocking Objection** ends the review window early and moves the Request to the Decision Meeting. It does not set the formal outcome to rejected.
- **Review Deadline** expiry moves the Request to the Decision Meeting. It never grants implicit approval.

The review deadline is a workflow deadline, not the Work Item target date. The default review window is configurable through `WORKFLOW_REVIEW_DAYS`; clarification response time is configurable through `WORKFLOW_CLARIFICATION_DAYS`.

### 4. Persisted Node.js timers

Use a small `WorkflowTimerService` based on Node.js `setTimeout` and SQLite:
- SQLite `workflow_timers` is the source of truth for due times, state, attempts and errors.
- One in-process timer is armed for the nearest scheduled deadline; it is not one timer per Request.
- Business events wake the scheduler so the nearest deadline is recalculated.
- Startup recovery reclaims expired processing leases and processes overdue timers.
- Timer transitions validate the current Work Item, Submission and Review Cycle in a database transaction.
- Completion is idempotent. Stale timers become completed without changing current state; failures retry with bounded backoff and then enter `dead_letter`.

The timer service is a scheduler, not a second workflow engine. Business transition rules remain in the existing server-owned state machine. No in-memory timer is treated as durable state.

### 5. Authority boundaries

- Requestor confirms and submits the Request Package and answers clarifications.
- Reviewers comment, request clarification or raise a blocking objection. They cannot approve or reject the Request.
- Chairman/Admin records the meeting time, minutes, rationale and formal outcome.
- Chairman/Admin explicitly closes approved and rejected Requests.
- Client-side Agents may assist with drafting and analysis. Workbench Server does not expose a separate Package Draft workflow or MCP tool. Agents cannot submit on behalf of the Requestor, raise formal decisions, accept risk or close a Request.

## Consequences

- ADR-0010 remains in force for the Work Item workspace, internal immutable Review baseline, Task accountability and separation of Business Workflow, Collaboration Workflow and Agent Execution Workflow. Its earlier five-stage lifecycle table is replaced by this ADR.
- Existing `analysis` and `changes_requested` Requests migrate to `requestor_revision`; `in_review` migrates to `discussion_review`; old `accepted` and `rejected` records migrate to their pending-close states. Historical transitions and Review records are retained.
- Existing Review Cycles retain their original baseline. Their due dates are converted into durable timers where possible.
- SQLite and the Node.js process remain the only runtime dependencies for lifecycle scheduling. Multi-instance deployment would require database-backed timer claiming with leases; the current single-process deployment does not require an external queue.
- BPMN and Flowable are not runtime dependencies or implementation targets for this decision.
