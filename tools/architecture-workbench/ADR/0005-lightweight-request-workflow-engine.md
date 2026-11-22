# ADR-0005: Lightweight Request Workflow Engine and Human Accountability

- Status: Accepted
- Date: 2026-11-22

## Context

Request lifecycle transitions were previously implemented as direct status updates in individual HTTP handlers. This allowed the UI, Review endpoint and Decision endpoint to become separate sources of workflow rules. The Workbench also needs a clear current stage, a visible Requestor and related people, personal task ownership and auditable status changes.

The prototype does not need a general-purpose BPMN engine, arbitrary user-authored workflows or a separate orchestration service.

## Decision

Implement a small in-process Workflow Engine for Request lifecycle transitions. The initial lifecycle is:

`draft → analysis → in_review → accepted / rejected → closed`

A Review outcome of `request_changes` transitions `in_review → changes_requested`; resubmission transitions `changes_requested → in_review` and establishes a new Review Cycle baseline. A formal Decision drives acceptance, rejection or a return to analysis. The Request status remains the authoritative current state; each transition is appended to `workflow_transitions`.

The engine owns transition validation, authorization checks, Review Cycle baseline creation on submission and transition history. REST routes are command adapters and the UI receives a read-only workflow projection. Ant Design Steps visualizes this projection but does not implement workflow rules.

Requestor is recorded separately from Work Item Owner. The Requestor, a global Workbench Admin or an explicitly authorized Work Item manager may maintain Participation records. The Requestor and Owner remain participants. People can edit their own profile; Workbench Admin can maintain other profiles.

Tasks remain independent executable work items. A Task Assignee can update their own Task status, but broader edits such as reassignment remain contributor/admin actions. The My Work page is based on actual Task assignment, not only Work Item ownership.

## Consequences

- Request state changes have one server-side authority and an audit trail.
- The workflow is intentionally fixed and small; it is not a generic BPMN or rules authoring platform.
- Human Decision Authority remains distinct from Workflow Engine execution. The engine enforces transitions but does not make decisions.
- A future workflow expansion should introduce versioned workflow definitions and explicit migration rules before adding parallel branches, quorum logic or timers.
- The data model remains suitable for future PostgreSQL migration, subject to the existing repository abstraction work.
