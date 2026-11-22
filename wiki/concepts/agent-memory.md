---
type: Concept
title: "Agent Memory"
description: "A layered approach to retaining experience, consolidating knowledge, and supplying relevant context to future agent sessions."
tags: [agents, memory, context-management, retrieval]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22" }
status: draft
sources:
  - id: anthropic-agent-memory
    resource: https://www.anthropic.com/research/components-of-agent-memory
    title: "The components of agent memory"
    author: "human:lance-martin"
    last_modified: "2026-11-06T21:15:32Z"
---

# Definition

Agent memory is the durable information an agent can use beyond its current context window. It is not one store: source traces, compact notes, linked knowledge representations, and information deliberately loaded into a new session serve different purposes.[^anthropic-agent-memory]

# Design

Separate memory capture during task execution from later consolidation. The first preserves salient events; the second can correct, merge, and organize notes into a navigable representation. At answer time, combine targeted wiki navigation with source search, and keep always-loaded context small.

A wiki is one representation layer, not the source of truth. Keep claims traceable to evidence, track changes that may make a memory stale, and avoid promoting unverified inferences into durable instructions.

# Engineering implications

Give source-specific work independent write targets, then serialize consolidation of shared concepts and indexes. Evaluate memory by whether it improves future retrieval and answers—not by the number of stored notes.

Related: [LLM Wiki](llm-wiki.md).

[^anthropic-agent-memory]: [Anthropic, The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory).
