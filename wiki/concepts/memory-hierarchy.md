---
type: Concept
title: "Short-Term and Long-Term Memory in Agents"
description: "An engineering taxonomy that separates active working context from persistent episodic, semantic, procedural, and synthesized memory."
tags: [agent-memory, working-memory, short-term-memory, long-term-memory, episodic-memory, semantic-memory, procedural-memory]
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
  - id: trimem
    resource: https://arxiv.org/abs/2605.19952
    title: "Rethinking How to Remember: Beyond Atomic Facts in Lifelong LLM Agent Memory"
    last_modified: "2026-10-20"
  - id: tem
    resource: https://arxiv.org/abs/2610.21900
    title: "TEM: Temporal State Tracking Memory for Large Language Model Agents"
    last_modified: "2026-10-15"
  - id: context-primitives
    resource: https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
    title: "Context engineering: memory, compaction, and tool clearing"
---

# Why the short-term / long-term split is not enough

In agent systems, “short-term” and “long-term” usually describe how long information remains available, not what kind of knowledge it represents. Active working context may exist only for one request, while a project decision may persist for months. Separately, episodic, semantic, and procedural describe the function of information. These are different axes and should not be forced into one taxonomy.[^memory-survey]

A practical design asks two questions: how long must this information survive, and what job will it perform when retrieved?

# The working layers

## Working memory: the active context

Working memory is the information currently available to the model: the current request, instructions, selected conversation turns, tool results, task state, and retrieved evidence. It has a hard token budget and competes for attention. It is not a durable store; context resets or compaction can remove details.

Treat it as a cache of what the model needs for the next decisions, not as the authoritative history.

## Event log and episodic memory

The event log preserves what happened: original messages, tool calls, task outcomes, corrections, and dated decisions. Episodic memory is a curated view of significant events that can be recalled later. Both should retain pointers to the underlying evidence so a summary does not become the only surviving record.

A transcript is not automatically useful memory. Most turns do not deserve permanent promotion. Selection should account for future usefulness, novelty, recurrence, user importance, and the cost of retaining sensitive or volatile information.

## Semantic memory

Semantic memory contains facts and generalizations assembled across events: a project's architecture, a person's current role, an entity relationship, or a recurring user preference. It should distinguish explicit facts from inferences and preserve time and provenance.

TriMem argues against compressing all dialogue directly into atomic facts. Its design retains raw dialogue segments linked to source identifiers, extracts atomic facts for retrieval, and synthesizes profiles for reasoning across scattered information. The point is to preserve multiple useful granularities, not to choose between a raw log and a short summary.[^trimem]

## Procedural memory

Procedural memory records how to do something: a workflow, skill, policy, troubleshooting pattern, or previously successful strategy. It differs from a statement about the user or an isolated event. A procedural memory should be validated against later outcomes and should include the conditions where it applies.

## Knowledge representations

A graph, wiki, or set of linked concept pages organizes semantic and procedural knowledge so an agent can traverse relationships across many documents. It is a navigation and synthesis layer, not a replacement for source records. Anthropic's memory hierarchy separates searchable transcripts, memory notes, higher-level representations such as wikis, and a small injected layer for the next session.[^anthropic-agent-memory]

# Long-term memory needs time semantics

A fact can remain true, become outdated, or be historically important after it is superseded. A system that stores only the latest value cannot answer historical questions and may confuse “was true” with “is true”.

TEM stores facts as versioned records linked to their sources, then orders and labels historical versions during retrieval. Its evaluation suggests that exposing temporal status can materially improve answers about changing facts.[^tem]

A practical record should distinguish observed time, occurrence time, validity, supersession, and evidence. Do not overwrite the old state when a new value arrives.

# Context injection is a separate layer

Only a small subset of long-term memory should be loaded by default. The active session needs high-value identity, behavior instructions, current project state, and pointers to more detailed material. Less frequently used knowledge should be retrieved when needed.

Anthropic's context-engineering cookbook distinguishes compaction, clearing re-fetchable tool results, and external memory. They solve different problems and should not be treated as interchangeable.[^context-primitives]

# Keep the dimensions separate

| Dimension | Examples | Main design question |
| --- | --- | --- |
| Lifetime | One turn, one session, persistent | How long must it survive? |
| Function | Working, episodic, semantic, procedural | What future task does it support? |
| Representation | Raw event, atomic fact, profile, graph, procedure | At what detail should it be stored? |
| Access | Always loaded, indexed, searched, tool-fetched | When should it enter active context? |
| Trust | Stated, inferred, machine-checked, human-reviewed | What evidence supports it? |

These dimensions can coexist. A project decision may begin as a working-context observation, be preserved in an event log, become a semantic fact after verification, and be represented in a wiki. The transition should be explicit; an uncertain observation must not silently become a permanent instruction.

Related: [Personal Intelligence](personal-intelligence.md), [Memory Dreaming](memory-dreaming.md), and [Context Management](context-management.md).

[^memory-survey]: [Han et al., Learning to Remember: Advances in Memory Mechanisms for Large Language Models](https://link.springer.com/article/10.1007/s44336-026-00044-1).
[^anthropic-agent-memory]: [Anthropic, The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory).
[^trimem]: [Sun et al., Rethinking How to Remember: Beyond Atomic Facts in Lifelong LLM Agent Memory](https://arxiv.org/abs/2605.19952).
[^tem]: [Song et al., TEM: Temporal State Tracking Memory for Large Language Model Agents](https://arxiv.org/abs/2610.21900).
[^context-primitives]: [Anthropic Cookbook, Context engineering: memory, compaction, and tool clearing](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools).
