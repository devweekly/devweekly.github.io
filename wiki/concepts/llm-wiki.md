---
type: Concept
title: "LLM Wiki"
description: "A persistent, linked knowledge representation that an LLM builds and maintains from source material."
tags: [llm-wiki, knowledge-management, agents, memory]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22" }
status: draft
sources:
  - id: anthropic-wiki-evaluation
    resource: https://www.anthropic.com/research/components-of-agent-memory
    title: "The components of agent memory"
    author: "human:lance-martin"
    last_modified: "2026-11-06T21:15:32Z"
---

# Definition

An LLM Wiki is a collection of linked concept pages that an agent incrementally creates and maintains from source material. The directory tree provides organization; Markdown links express relationships between concepts.[^anthropic-wiki-evaluation]

# Operating model

Keep source evidence unchanged. During ingestion, update the concepts affected by new evidence rather than creating a summary page for every file. In a separate consolidation pass, reconcile duplicates and disagreements, repair links, and improve indexes. At query time, use the wiki to navigate across documents and search to verify details in the underlying sources.

# When it helps

A wiki is most useful when questions require combining facts across documents or revisiting knowledge over time. It may add little for a fact contained in one easy-to-search document; an over-detailed wiki can become larger than the material it represents.

[^anthropic-wiki-evaluation]: [Anthropic, The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory).
