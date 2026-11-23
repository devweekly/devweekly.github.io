# ADR-0012: Request Workspace, External References and Client-side Agent Assistance

- Status: Accepted
- Date: 2026-11-22
- Supersedes: ADR-0010, section 6 (primary Request workspace presentation) only
- Related: ADR-0001, ADR-0004, ADR-0007, ADR-0010, ADR-0011

## Context

The Request workspace had begun to repeat the same information in several forms: a deliverables panel, a formal Submission register, and a separate Artifact version-history panel. That presentation suggested that every Request needed a managed collection of locally stored deliverables. In the actual operating model, the original business materials remain in Jira, Confluence, GitHub and LeanIX. The Workbench primarily records the Request, discussion, decisions, operational data and links to those source materials.

The previous collaboration panel was a table of people, owners, assignees and tasks. It looked like a list of approval assignments, even though ordinary work does not require each participant to approve or reject anything. A formal approve / needs-work / reject outcome belongs only to the Chairman-led Decision Meeting defined by ADR-0011.

Technical Debt is modeled as a related Work Item, but the Request detail did not show those relationships. This forced users to leave the Request to understand its known follow-up debt.

A server-side Agent Package Draft MCP tool also duplicated a responsibility that belongs to the Client Agent and Requestor interaction. The Client already owns model interaction, context assembly and the editable Request composition experience. The Workbench Server should persist business facts and enforce workflow rules, not maintain a second draft lifecycle for Agent-generated text.

## Decision

### 1. Keep original materials in their source systems

The Request stores its business description and operational information. Original materials are linked through external references to Jira, Confluence, GitHub and LeanIX. The Workbench stores the source system, resource identity/key, title, URL and relationship type; it does not copy source content or create a parallel deliverables catalogue.

The Request detail presents these references once in a concise **Linked Resources** section. It does not repeat them under Submission history or material-version history.

### 2. Keep Submission as an internal review baseline

The database Submission and Review Cycle remain because the review process must retain the exact Request context and external references that were current when the review began. This is an internal consistency and audit mechanism.

The normal Request workspace does not present separate **Formal Submission History** and **Artifact Version History** panels. It does not display the same links or content repeatedly. Artifact versions remain available in the advanced information area for generated analysis outputs and formal records that genuinely have versions, such as ADRs.

### 3. Present collaboration as progress, not approvals

The primary collaboration section is named **Collaboration Progress**. Work items are grouped by their actual progress state, such as:
- In Progress
- Not Started
- Needs Coordination
- Completed

Task title and progress are primary. Owner, current assignee and due date are supporting context, not the primary layout. This view does not introduce approve/reject actions. Updating a Task is a work-progress update only.

The Request lifecycle remains separate. Reviewers may comment, ask for clarification or raise a blocking objection. Only the Decision Meeting can record a formal Request outcome.

### 4. Show linked Technical Debt in Request detail

The Request detail always includes an **Related Technical Debt** section. Each linked debt displays its code, title, severity, status, owner, priority and target date. An empty state explicitly indicates that no Technical Debt is linked.

A principal who can read the originating Request may inspect its linked Technical Debt in read-only mode. This relationship does not grant contribution or debt-management permissions. Debt ownership and lifecycle remain on the Technical Debt Work Item.

### 5. Keep Agent Package composition in the Client

The Client Agent may help the Requestor compose or revise Request content. The Client owns this draft interaction and presents the result for Requestor editing and confirmation.

Remove the server-side Agent Package Draft mechanism completely:
- no `workbench_draft_request_package` MCP tool;
- no Request Package Draft REST endpoint;
- no `request_package_drafts` table or projection;
- no server-side apply/adopt operation or draft lifecycle.

The Requestor submits through the existing Request workflow. Agent Runs, Tasks and draft Artifacts remain separate collaboration/execution capabilities.

## Consequences

- Request detail has one visible location for external source links and one visible location for linked Technical Debt.
- Submission baselines remain durable internally, but the user interface no longer repeats them as material-history concepts.
- Collaboration is presented as ongoing work rather than a mandatory approval checklist.
- Client and Server responsibilities are clearer: the Client Agent drafts; the Server stores business facts and enforces authorization and workflow transitions.
- Existing unsubmitted Agent Package Draft rows from earlier prototype versions are discarded during startup migration. They are not business records and are not converted into Submissions.
