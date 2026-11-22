---
name: request-coordination
description: Coordinate a Work Item across people and specialist Agents by turning workflow context into owned tasks, dependencies, hand-offs and clear status updates.
---

# Request Coordination

Use this Skill when a Request spans multiple roles, needs parallel analysis, has unresolved dependencies or requires coordination from intake through review and decision.

## Working method

1. Read the current Work Item context, workflow state, participants, assigned Tasks, artifacts, discussions and visible external references before proposing new work.
2. Confirm the required outcome, current stage, next decision point, accountable Human roles and any blocking dependencies.
3. Break work into bounded Tasks with a clear deliverable, accountable assignee, due date or sequencing constraint where known, and an explicit completion condition.
4. Assign specialist work to the appropriate role or Agent capability. Parallelize independent analysis; keep shared assumptions and interfaces explicit.
5. Track dependencies and hand-offs. A downstream Task should not be treated as ready when required inputs are missing.
6. Report progress using evidence from actual Task and Artifact state. Distinguish proposed, assigned, in-progress, blocked and completed work.
7. Escalate missing ownership, conflicting requirements, overdue dependencies and decisions that require a Human authority.
8. Before review, check that required deliverables and evidence are available and that the review target is a stable Artifact version.

## Request Package preparation

When a Run is explicitly assigned to prepare a new or revised Request Package and the Request is still in `draft` or `requestor_revision`:

1. Build a structured proposal with a clear goal, scope, constraints and risks, optional initial proposal, explicit questions for the Decision Meeting, and a concise Git-commit-style submission message.
2. Use `workbench_draft_request_package` with the current Work Item ID, Run ID and active claim token. The tool stores a pending suggestion only; it does not modify the Request Package or create a Submission.
3. Finish the Run through the normal Agent Host completion or hand-off protocol. The Requestor can apply the completed suggestion, edit it and make the formal submission.
4. Do not call a workflow transition or represent the suggestion as a submitted Request. The Requestor remains the submitter and decision authority remains Human.

Do not use this path once the Request has entered Discussion and Review. A submitted Request Package is frozen for that Review Cycle.

## Deliverable

Produce a coordination summary containing the current stage, objective, participants and responsibilities, task breakdown, dependencies, blockers, next actions and required Human intervention.

## Boundaries

Use only the tools and permissions actually provided by the Host. Do not claim to have assigned a Task, changed workflow state or notified a person unless the corresponding operation succeeded. Do not impersonate the Requestor, Owner, Reviewer or Decision Authority. Workflow transitions, reviews and formal decisions remain governed by the Workbench server.
