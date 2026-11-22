# Architecture Workbench ADRs

Architecture decisions for the Workbench are recorded here. The current accepted decisions are:

| ADR | Decision |
| --- | --- |
| [0001](0001-work-item-centric-application.md) | Work Item-centric Application Boundary |
| [0002](0002-storage-and-file-boundary.md) | Storage and File Boundary |
| [0003](0003-external-agent-runtime-boundary.md) | External Agent Runtime Boundary |
| [0004](0004-external-context-reference-boundary.md) | External Context Reference Boundary |
| [0005](0005-lightweight-request-workflow-engine.md) | Lightweight Request Workflow Engine and Human Accountability |
| [0006](0006-skills-over-mcp.md) | Skills over MCP |
| [0007](0007-business-mcp-tools-and-agent-coordinator.md) | Business MCP Tools and Agent Coordinator |
| [0008](0008-dag-based-agent-plans-and-provider-neutral-host.md) | DAG-based Agent Plans and Provider-neutral Host |
| [0009](0009-server-owned-agent-run-leases-and-crash-recovery.md) | Server-owned Agent Run Leases and Crash Recovery |
| [0010](0010-business-workflow-and-work-item-workspace.md) | Business Workflow, Submission Baseline and Work Item Workspace |

ADR-0010 establishes the boundary between business workflow, collaboration workflow and Agent execution, adds immutable Submission manifests and defines the business-first Work Item Workspace.
