---
type: Concept
title: "Context Management for Long-Running Agents"
description: "Runtime control of what enters, remains in, or leaves the model's active context, distinct from persistent memory across sessions."
tags: [context-management, context-engineering, compaction, retrieval, tool-use]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22T00:00:00Z" }
status: draft
sources:
  - id: anthropic-context-engineering
    resource: https://www.anthropic.com/research/effective-context-engineering-for-ai-agents
    title: "Effective context engineering for AI agents"
    last_modified: "2025-09-29"
  - id: anthropic-context-primitives
    resource: https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
    title: "Context engineering: memory, compaction, and tool clearing"
  - id: claude-code-memory
    resource: https://code.claude.com/docs/en/memory
    title: "How Claude remembers your project"
  - id: ctxagent
    resource: https://arxiv.org/abs/2610.34425
    title: "CTXAgent - Self-Controlled Context Management of LLM Agents"
    last_modified: "2026-10-27"
  - id: compact-bench
    resource: https://arxiv.org/abs/2611.25673
    title: "CompAct-Bench: A Benchmark for Working-Context Compaction in Long-Horizon Agent Tasks"
    last_modified: "2026-11-20"
  - id: memory-survey
    resource: https://link.springer.com/article/10.1007/s44336-026-00044-1
    title: "Learning to Remember: Advances in Memory Mechanisms for Large Language Models"
    last_modified: "2026-11-09"
---

# Definition

Context management is the runtime discipline of deciding what information the model should see now, what can be fetched later, what can be removed from the active window, and what must survive beyond the current session. Context includes instructions, conversation history, task state, tool definitions, tool results, retrieved documents, and selected memories.[^anthropic-context-engineering]

The context window is a finite working resource. Anthropic describes “context rot”: the model's ability to use information can degrade as more tokens accumulate, even before the hard token limit is reached. The goal is not to maximize tokens loaded, but to assemble the smallest sufficient set of high-signal information for the current decision.[^anthropic-context-engineering]

# Operations that solve different problems

## Selection and just-in-time retrieval

Keep lightweight pointers to large or infrequently needed information—files, URLs, database identifiers, and memory keys—and fetch the relevant portion only when required. This supports progressive disclosure and avoids loading an entire corpus up front. The cost is an extra retrieval step and possible tool latency.

## Tool-result clearing

If an old tool result can be fetched again, remove its large payload from the active history while preserving enough of the tool-call record to know what happened and how to retrieve it. This should not erase user instructions, decisions, or task progress.

## Compaction

Compaction replaces a long active history with a shorter summary or hand-off. It is lossy: the next model invocation cannot use a detail that the summary omitted unless the detail is available elsewhere. Preserve the objective, decisions, constraints, exact identifiers and values still needed, current state, open questions, and the path to recover source evidence.

Compaction is not long-term memory. It keeps the current task moving through a context boundary; a separate persistent store is needed for knowledge that must survive later sessions.

## External memory and context isolation

Persist durable information outside the active context, then retrieve it in future sessions. Subagents or separate workflows can perform retrieval and tool-heavy work in their own context and return a compact, structured result with evidence pointers.

Anthropic's cookbook distinguishes compaction, clearing re-fetchable tool results, and external memory as three separate primitives.[^anthropic-context-primitives]

# Use layered controls

A robust harness combines deterministic resource limits with task-aware model decisions. Token thresholds provide a safety backstop, but a fixed threshold alone does not know whether a task has reached a clean boundary. The model can identify when a subtask has completed or older observations are no longer useful, but not every model can reliably manage its own context.

CTXAgent evaluates model-directed compaction and curation in long sessions and reports substantial variation across models.[^ctxagent] CompAct-Bench evaluates whether an agent can still finish the original task after an intermediate context compaction. In its 200-task benchmark, the strongest tested compactor achieved 68.5% post-compaction accuracy and the model average was 56.7% at a 10% target retention ratio. These study-specific results show why summary quality should be measured by continuation success, not readability alone.[^compact-bench]

A practical policy is hybrid: let the model request compaction or curation when it recognizes a useful boundary, while the harness enforces hard budgets, preserves protected messages, records checkpoints, and provides a deterministic recovery route.

# Choose the operation by the failure

| Observed problem | Primary operation | What must be preserved |
| --- | --- | --- |
| Too much re-fetchable tool output | Clearing | Tool identity, arguments, result location, and recovery path |
| Too many turns in one active task | Compaction | Task state, decisions, exact values, constraints, and unresolved work |
| Knowledge must survive a new session | External memory | Provenance, time, scope, and durable meaning |
| Large corpus is mostly irrelevant now | Just-in-time retrieval | Searchability, identifiers, and source access |
| Exploration is drowning the main task | Context isolation | A verifiable result with evidence pointers |

# Test the whole continuation path

A context-management test should begin with a task trajectory, compact or curate it at a defined point, and then let the agent continue under the same task and action budget. Check whether exact decisions, ephemeral observations, and standing instructions survive. Also record token use, cache effects, latency, cost, re-fetch calls, and task success.

The same principle applies to user memory: evaluate whether the assistant chooses and applies the right preference in the current context, not only whether it can retrieve the preference. See [Personal Intelligence](personal-intelligence.md) and [Memory Hierarchy](memory-hierarchy.md).

Related: [Agent Memory](agent-memory.md), [Memory Dreaming](memory-dreaming.md), and [Personal Intelligence](personal-intelligence.md).

[^anthropic-context-engineering]: [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents).
[^anthropic-context-primitives]: [Anthropic Cookbook, Context engineering: memory, compaction, and tool clearing](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools).
[^ctxagent]: [Busch et al., CTXAgent - Self-Controlled Context Management of LLM Agents](https://arxiv.org/abs/2610.34425).
[^compact-bench]: [Chen et al., CompAct-Bench](https://arxiv.org/abs/2611.25673).
[^memory-survey]: [Han et al., Learning to Remember](https://link.springer.com/article/10.1007/s44336-026-00044-1).
