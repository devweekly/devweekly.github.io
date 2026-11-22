---
type: Concept
title: "Agent Memory"
description: "A layered approach to retaining experience, consolidating knowledge, and supplying relevant context to future agent sessions."
tags: [agents, memory, context-management, retrieval]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22T00:00:00Z" }
status: draft
sources:
  - id: anthropic-agent-memory
    resource: https://www.anthropic.com/research/components-of-agent-memory
    title: "The components of agent memory"
    last_modified: "2026-11-06T21:15:32Z"
  - id: memory-survey
    resource: https://link.springer.com/article/10.1007/s44336-026-00044-1
    title: "Learning to Remember: Advances in Memory Mechanisms for Large Language Models"
    last_modified: "2026-11-09"
---

# Definition

Agent memory is the durable information an agent can use beyond its current context window. It is not one store: source traces, episodic records, semantic facts, procedures, linked knowledge representations, and a small injected context serve different purposes.[^anthropic-agent-memory][^memory-survey]

# Design

Separate memory capture during task execution from later consolidation. The first preserves evidence and task outcomes; the second can correct, merge, and organize notes into a navigable representation. At answer time, combine targeted wiki navigation with source search, and keep always-loaded context small.

The labels short-term and long-term describe retention lifetime, while working, episodic, semantic, and procedural describe the function of the information. A robust system models both axes rather than putting every memory into a single chronological list. See [Memory Hierarchy](memory-hierarchy.md).

# Personalization

For personal assistants, the system must learn more than facts. It must represent changing preferences and interaction constraints, then decide when they apply. A retrieved preference is not automatically an instruction for the current task. See [Personal Intelligence](personal-intelligence.md).

# Consolidation

A separate background process can revisit logs, correct mistakes, promote repeated evidence into reusable knowledge, repair links, and decide what should be kept in the next session's context. See [Memory Dreaming](memory-dreaming.md).

# Runtime context

Persistent memory and active context are different. The agent should retrieve only the evidence needed for the current request and use compaction or tool-result clearing for in-session context growth. See [Context Management](context-management.md).

# Engineering implications

Give source-specific work independent write targets, then serialize consolidation of shared concepts and indexes. Preserve source history and temporal changes. Evaluate memory by whether it improves future decisions and user outcomes—not by the number of stored notes.

[^anthropic-agent-memory]: [Anthropic, The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory).
[^memory-survey]: [Han et al., Learning to Remember](https://link.springer.com/article/10.1007/s44336-026-00044-1).
