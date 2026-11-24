# Architecture Workbench ADRs

Architecture decisions for the Workbench are recorded here. The current accepted decisions are:

| ADR | Decision |
| --- | --- |
| [0001](0001-work-item-centric-application.md) | Use Work Item as the Main Business Record |
| [0002](0002-storage-and-file-boundary.md) | Storage and File Boundary |
| [0003](0003-external-agent-runtime-boundary.md) | External Agent Runtime Boundary |
| [0004](0004-external-context-reference-boundary.md) | External Context Reference Boundary |
| [0005](0005-lightweight-request-workflow-engine.md) | Lightweight Request Workflow Engine and Human Accountability |
| [0006](0006-skills-over-mcp.md) | Skills over MCP |
| [0007](0007-business-mcp-tools-and-agent-coordinator.md) | Business MCP Tools and Agent Coordinator |
| [0008](0008-dag-based-agent-plans-and-provider-neutral-host.md) | DAG-based Agent Plans and Provider-neutral Host |
| [0009](0009-server-owned-agent-run-leases-and-crash-recovery.md) | Server-owned Agent Run Leases and Crash Recovery |
| [0010](0010-business-workflow-and-work-item-workspace.md) | Business Workflow, Submission Baseline and Work Item Workspace |
| [0011](0011-request-submission-review-and-human-decision.md) | Request Submission, Time-bounded Review and Human Decision |
| [0012](0012-request-workspace-and-client-agent-boundary.md) | Request Workspace, External References and Client-side Agent Assistance |
| [0013](0013-mcp-entra-resource-server-authentication.md) | MCP Entra OAuth Resource Server Authentication |\n| [0014](0014-agent-capability-architecture-skills-mcp-webmcp.md) | Agent Capability Architecture: Skills, MCP and WebMCP |

ADR-0010 establishes the Work Item Workspace, immutable Submission baseline and separation of Business Workflow, Collaboration Workflow and Agent execution. ADR-0011 supersedes only ADR-0010's original lifecycle taxonomy and defines the Request Package, timed discussion/review, Chairman-led Decision Meeting and explicit closure. It uses the existing Node.js and SQLite runtime; Flowable and BPMN are not introduced. ADR-0012 simplifies the Request workspace, removes server-side Agent Package Draft, and makes related Technical Debt visible from the Request. ADR-0013 establishes Microsoft Entra ID as the Authorization Server for remote MCP, the Workbench as an OAuth Resource Server, and identity mapping from verified tokens to Workbench People.
