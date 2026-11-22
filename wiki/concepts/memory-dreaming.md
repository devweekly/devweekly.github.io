---
type: Concept
title: "Memory Dreaming and Offline Consolidation"
description: "Asynchronous maintenance that reviews agent experience, repairs and generalizes memory, updates representations, and selectively forgets low-value or stale material."
tags: [memory-dreaming, sleep-time-compute, consolidation, lifelong-learning, forgetting]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22T00:00:00Z" }
status: draft
sources:
  - id: anthropic-agent-memory
    resource: https://www.anthropic.com/research/components-of-agent-memory
    title: "The components of agent memory"
    last_modified: "2026-11-06T21:15:32Z"
  - id: sleep-time-compute
    resource: https://arxiv.org/abs/2504.13171
    title: "Sleep-time Compute: Beyond Inference Scaling at Test-time"
    last_modified: "2025-04-17"
  - id: letta-sleep-agents
    resource: https://www.letta.com/blog/sleep-time-compute/
    title: "Sleep-time Compute"
    last_modified: "2025-04-21"
  - id: let-them-sleep
    resource: https://arxiv.org/abs/2610.25561
    title: "Let Them Sleep: Recursive Self-Pruning Memory for Long-Horizon LLM Agents"
    last_modified: "2026-10-18"
  - id: letta-production-eval
    resource: https://www.letta.com/blog/evaluating-memory-in-production-agents/
    title: "Evaluating Memory in Production Agents"
    last_modified: "2026-07-28"
  - id: mempabench
    resource: https://arxiv.org/abs/2610.30485
    title: "Why Bother Me Again? Benchmarking Personal Agent Memory for Interaction Preferences"
    last_modified: "2026-10-23"
---

# Definition

Memory dreaming is an asynchronous process that reviews accumulated experience between active interactions. It can correct bad notes, merge repeated observations into reusable knowledge, connect related concepts, detect outdated states, and decide what should remain easy to retrieve.

“Dreaming” is a metaphor for background consolidation, not a claim that an agent reproduces biological sleep. The engineering idea is to move expensive memory maintenance out of the latency-sensitive user interaction path.

# Online capture and offline consolidation

During a task, the agent should preserve evidence cheaply: append to a transcript or event log, mark important decisions and corrections, and save task progress when it is likely to be needed later. It should not stop every few turns to perform a full rewrite of its long-term memory.

A background consolidator can work over a bounded set of new or changed evidence: select salient events; reconstruct the source material; compare duplicates and contradictions; consolidate facts, profiles, procedures, or wiki links; validate source support; then demote or prune only when evidence remains recoverable.

Anthropic describes dreaming as a way to revisit notes, correct errors, build wiki representations, and decide which knowledge should be injected into future sessions.[^anthropic-agent-memory] Letta's original sleep-time compute paper studies offline reasoning over a known context before a query arrives. Its experiments are mainly mathematical reasoning tasks, not a general proof that memory dreaming improves every assistant workload.[^sleep-time-compute]

# Separate user-facing work from memory maintenance

Letta's sleep-time implementation separates a primary agent from a background memory agent. The primary agent handles user interaction and searches memory; the sleep-time agent receives tools to revise the primary agent's in-context memory and its own memory asynchronously.[^letta-sleep-agents]

This separation reduces the need for an interactive agent to mix response generation with broad memory rewrites. Give parallel workers bounded write targets. Let them prepare source-specific changes, then serialize updates to shared profiles, concepts, and indexes. Anthropic's wiki evaluation also found that agents overwriting a shared summary could lose important facts; independent source pages followed by consolidation is safer.

# Trigger by evidence, not activity

A fixed timer is not the definition of dreaming. Trigger maintenance when there is a reason to believe it can improve future behavior: a project milestone, repeated corrections, conflicting evidence, a changed source, retrieval failures, or a large batch of new material. An idle window can provide cheap compute, but idle time alone is not evidence that a memory needs rewriting.

# Forgetting is useful but destructive

A 2026 preprint, Let Them Sleep, proposes clustering failures into short rules, removing the episodes used to derive those rules, decaying rules that are not reinforced, and promoting rules that recur across contexts.[^let-them-sleep]

However, the same paper reports a harmful pruning run: on a LoCoMo conversation with a high natural error rate, the system pruned a large portion of memory and finished 19.5 points below baseline. It had assumed that memories involved in a failed task caused the failure, when the task itself was difficult.

A failed outcome is not proof that the retrieved memory was wrong. Test causal relevance before pruning, preserve source-level recovery, and evaluate historical recall after deletion.

# Evaluation

Evaluate dreaming by downstream task quality, not by the number of notes rewritten or how short the profile becomes. Useful measures include correctness of updates, stale-memory suppression, source traceability, reuse of a learned procedure, fewer repeated failures, preference-selection quality, memory size, write cost, and retrieval latency.

Letta's production-oriented evaluation separates memory usage (adherence and retrieval) from memory generation (generalization and hygiene).[^letta-production-eval] MemPABench shows why interaction preferences must be tested in multi-session behavior rather than only as fact-recall questions.[^mempabench]

Related: [Memory Hierarchy](memory-hierarchy.md), [Personal Intelligence](personal-intelligence.md), and [LLM Wiki](llm-wiki.md).

[^anthropic-agent-memory]: [Anthropic, The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory).
[^sleep-time-compute]: [Lin et al., Sleep-time Compute: Beyond Inference Scaling at Test-time](https://arxiv.org/abs/2504.13171).
[^letta-sleep-agents]: [Letta, Sleep-time Compute](https://www.letta.com/blog/sleep-time-compute/).
[^let-them-sleep]: [Chauhan et al., Let Them Sleep](https://arxiv.org/abs/2610.25561).
[^letta-production-eval]: [Letta, Evaluating Memory in Production Agents](https://www.letta.com/blog/evaluating-memory-in-production-agents/).
[^mempabench]: [Li et al., MemPABench](https://arxiv.org/abs/2610.30485).
