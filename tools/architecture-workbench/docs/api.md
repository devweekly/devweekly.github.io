# API Surface

Base URL in development: http://localhost:4000/api

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /health | Health and adapter status |
| GET | /bootstrap | Demo people, work items, debt register and counters |
| GET | /work-items | List business Work Items |
| POST | /work-items | Create a Work Item |
| GET | /work-items/:id | Work Item detail projection |
| POST | /work-items/:id/artifacts | Submit a new Artifact version |
| POST | /work-items/:id/reviews | Submit an independent Review |
| POST | /work-items/:id/tasks | Create a Task |
| POST | /work-items/:id/decisions | Record a formal human Decision |
| GET | /work-items/:id/context-capsule | Export a participant-scoped context projection |
| POST | /tech-debts | Create a linked Technical Debt Work Item |
| PATCH | /tech-debts/:id | Update debt status and remediation plan |
| POST | /work-items/:id/comments | Add a discussion message |
| POST | /uploads | Store an unstructured file using the configured ObjectStore |

The prototype uses x-demo-user-id to simulate the authenticated Human Principal. Do not expose that header as a production authentication mechanism. The server resolves permissions from Participation for every protected write.
