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
| GET | /work-items/:id | Work Item detail projection |
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
