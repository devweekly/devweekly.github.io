---
type: Concept
title: "LLM Wiki"
description: "A persistent, linked knowledge representation that an LLM builds and maintains from source material."
tags: [llm-wiki, knowledge-management, agents, memory]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22T00:00:00Z" }
status: draft
sources:
  - id: anthropic-wiki-evaluation
    resource: https://www.anthropic.com/research/components-of-agent-memory
    title: "The components of agent memory"
    last_modified: "2026-11-06T21:15:32Z"
  - id: memory-survey
    resource: https://link.springer.com/article/10.1007/s44336-026-00044-1
    title: "Learning to Remember: Advances in Memory Mechanisms for Large Language Models"
    last_modified: "2026-11-09"
---

# Definition

An LLM Wiki is a collection of linked concept pages that an agent incrementally creates and maintains from source material. The directory tree provides organization; Markdown links express relationships between concepts.[^anthropic-wiki-evaluation]

# Operating model

Keep source evidence unchanged. During ingestion, update the concepts affected by new evidence rather than creating a summary page for every file. In a separate consolidation pass, reconcile duplicates and disagreements, repair links, and improve indexes. At query time, use the wiki to navigate across documents and search to verify details in the underlying sources.

A wiki is a knowledge representation layer, not a replacement for episodic history, source search, or a current user model. It is especially useful for stable concepts that connect evidence across many documents. Fast-changing personal preferences or task-specific state should remain time-aware and independently addressable. See [Memory Hierarchy](memory-hierarchy.md).

An LLM Wiki is an RSI substrate only in the limited sense that it exposes accumulated knowledge in an editable, reusable form. Updating pages from new evidence may improve future retrieval, but the wiki itself does not demonstrate a recursive improvement loop. For that, the system that discovers, validates, and applies future wiki changes must also improve, with evidence from independent tasks. See [Recursive Self-Improvement](recursive-self-improvement.md).

# When it helps

A wiki is most useful when questions require combining facts across documents or revisiting knowledge over time. It may add little for a fact contained in one easy-to-search document; an over-detailed wiki can become larger than the material it represents. Anthropic's 2026 evaluation found that a growing wiki worked best in combination with search, rather than as the only way to access the corpus.[^anthropic-wiki-evaluation]

[^anthropic-wiki-evaluation]: [Anthropic, The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory).
