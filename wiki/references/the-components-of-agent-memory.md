---
type: Research Article
title: "The components of agent memory"
description: "Anthropic's research account of Claude memory capture, offline consolidation, and wiki-based memory representations."
resource: https://www.anthropic.com/research/components-of-agent-memory
tags: [agent-memory, claude, memory-consolidation, llm-wiki]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22" }
status: draft
x-devweekly-published-at: "2026-11-06T00:00:00Z"
x-devweekly-source-updated-at: "2026-11-06T21:15:32Z"
---

# Source

**Publisher:** Anthropic  
**Author:** Lance Martin  
**Published:** 2026-11-06  
**Last updated:** 2026-11-06

# Summary

The article describes how an agent can retain useful experience during work, then use later consolidation to correct and organize memories. It treats a linked wiki as a navigable representation above individual notes, while search and a small injected context remain important parts of retrieval.

# Evidence reported

- In a corpus of about 350,000 files (roughly 420 million tokens), 128 wiki-building sessions improved wiki-only performance on 25 questions from 13% to 48% of graded criteria. Wiki plus search reached 61%, versus 53% for search alone, while using about 20,000 fewer tokens per question.
- On a merger task requiring information across documents, the wiki scored 87% against 73% for search alone.
- Separating concurrent work by source document preserved 57 of 57 contract facts, compared with 41 of 57 when agents overwrote one shared summary.

# Limits

The article also reports cases where a wiki added little over direct search, especially when answers were in one document, and a case where the generated wiki exceeded the source corpus in size. These results are evidence from Anthropic's evaluations, not a general performance guarantee.

# Related concepts

- [Agent Memory](../concepts/agent-memory.md)
- [LLM Wiki](../concepts/llm-wiki.md)
