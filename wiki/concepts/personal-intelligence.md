---
type: Concept
title: "Personal Intelligence and User Models"
description: "A user-centered model that helps an assistant select relevant personal context and adapt behavior without over-applying stale or out-of-scope preferences."
tags: [personal-intelligence, personalization, user-model, preference-memory, privacy]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22T00:00:00Z" }
status: draft
sources:
  - id: google-personal-intelligence
    resource: https://blog.google/innovation-and-ai/products/gemini-app/personal-intelligence/
    title: "Gemini introduces Personal Intelligence"
    last_modified: "2026-01-14"
  - id: openai-memory
    resource: https://help.openai.com/en/articles/8590148-memory-in-chatgpt
    title: "Memory in ChatGPT"
  - id: claude-code-memory
    resource: https://code.claude.com/docs/en/memory
    title: "How Claude remembers your project"
  - id: horizonbench
    resource: https://arxiv.org/abs/2604.17283
    title: "HorizonBench: Long-Horizon Personalization with Evolving Preferences"
    last_modified: "2026-11-17"
  - id: mempabench
    resource: https://arxiv.org/abs/2610.30485
    title: "Why Bother Me Again? Benchmarking Personal Agent Memory for Interaction Preferences"
    last_modified: "2026-10-23"
  - id: benchpres
    resource: https://arxiv.org/abs/2603.16557
    title: "BenchPreS: A Benchmark for Context-Aware Personalized Preference Selectivity of Persistent-Memory LLMs"
    last_modified: "2026-10-15"
  - id: memory-aware-reward
    resource: https://arxiv.org/abs/2610.31272
    title: "Memory-Aware Reward Modeling: Learning Human Preferences for LLM Memory Use"
    last_modified: "2026-10-22"
---

# Definition

Personal Intelligence is an assistant's ability to use relevant knowledge about a particular person, their ongoing work, and their preferences to make better decisions and reduce repeated explanation. Google uses the phrase as the product name for Gemini's connected-app personalization feature; this page uses it more broadly for the engineering capability, not as a standardized architecture.[^google-personal-intelligence]

A useful system needs more than a store of facts. It needs a user model, a policy for deciding whether a memory applies to the current request, and controls for correcting, limiting, or removing retained information.

# What belongs in a user model

Separate information by what it means and how it should affect behavior. Typical categories include durable facts and relationships; positive and negative preferences; interaction preferences such as when to ask, confirm, or act; active goals and constraints; and procedural knowledge about recurring tasks.

Do not collapse these into one undifferentiated profile. A fact is not an instruction; an expressed preference is not necessarily permanent; an interaction preference is not relevant to every task.

# Applicability matters as much as retrieval

A retrieved memory can be topically relevant and still be wrong to apply. A preference should be checked against the current domain, task, audience, channel, time, and the user's latest instruction. For example, a preference about food recommendations should influence meal suggestions, not unrelated technical explanations.

BenchPreS evaluates whether persistent preferences should be applied or suppressed across recipient-task contexts. Its evaluated models showed substantial over-application; even the best reported model retained a high misapplication rate. MemPABench similarly found that retrieval-based memory systems did not reliably improve interaction-preference selection, while file-based memory sometimes applied preferences beyond their intended scope.[^benchpres][^mempabench]

A current request must be allowed to override an older preference. When scope or current validity is unclear, either avoid using the memory or ask one focused question. Do not silently turn a repeated behavior into a global rule.

# Preferences change

A useful user model represents a preference as a belief with evidence and a time dimension, rather than a timeless fact. HorizonBench constructs long-running conversations in which preferences change after life events without the user explicitly announcing the new preference. In the authors' evaluation, all 25 tested frontier models selected outdated preferences more often than expected; the best reported accuracy was 52.8%.[^horizonbench]

Preserve the transition: what the preference used to be, what newer evidence suggests, when the change may have happened, and whether the new state is explicit or inferred. Do not overwrite history when a preference changes; mark the old state as superseded and use the current state for current decisions.

# Memory use should be judged by user outcomes

Recall accuracy alone is insufficient. A study with about 1,000 pairwise judgments from 87 participants found that memory-conditioned responses were not consistently preferred to responses generated without those memories; users sometimes strongly preferred the unpersonalized answer. Automatic evaluators also favored memory-conditioned answers more often than the participants did.[^memory-aware-reward]

Evaluate three separate behaviors: whether the system retrieves a relevant memory, whether it applies it in the correct context, and whether using it actually improves the result from the user's perspective. Include a no-memory baseline in personalization evaluations.

# Product patterns

Google's Gemini Personal Intelligence announcement illustrates cross-source synthesis across Gmail, Photos, YouTube, and Search, with app connections controlled by the user.[^google-personal-intelligence] OpenAI's Memory documentation describes using relevant context from past chats and available sources, and exposes source and correction/removal controls.[^openai-memory] Claude Code separates human-authored instructions from agent-maintained auto memory, giving them different ownership and purposes.[^claude-code-memory]

These are product-specific implementations, not interchangeable standards. Their common lesson is that personalization depends on both the content retained and the mechanism that decides when it should influence behavior.

# Design principles

1. Preserve provenance and distinguish explicit user statements from inferred patterns.
2. Scope each preference by task and context; add temporal validity and supersession.
3. Treat personalization as an optional intervention. No memory can be the correct choice.
4. Provide user-visible review, correction, suppression, and deletion paths.
5. Do not treat an LLM's memory file as an authorization policy. Enforce security, privacy, and approval requirements in deterministic controls.

A user model may become an evolving harness component when new evidence changes durable preferences, scopes, or interaction strategies. Such adaptation must preserve provenance, time, user correction controls, and the ability to suppress an inapplicable preference. It is retained self-improvement only when it improves later outcomes; it is not strict RSI unless the updater and its evaluation method also improve. See [Recursive Self-Improvement](recursive-self-improvement.md).

Related: [Memory Hierarchy](memory-hierarchy.md), [Memory Dreaming](memory-dreaming.md), and [Context Management](context-management.md). See also the [industry and research source dossier](../references/industry-memory-and-context.md) and [latest papers](../references/research-memory-and-context-2026.md).

[^google-personal-intelligence]: [Google, Gemini introduces Personal Intelligence](https://blog.google/innovation-and-ai/products/gemini-app/personal-intelligence/).
[^openai-memory]: [OpenAI, Memory in ChatGPT](https://help.openai.com/en/articles/8590148-memory-in-chatgpt).
[^claude-code-memory]: [Anthropic, How Claude remembers your project](https://code.claude.com/docs/en/memory).
[^horizonbench]: [Li et al., HorizonBench: Long-Horizon Personalization with Evolving Preferences](https://arxiv.org/abs/2604.17283).
[^mempabench]: [Li et al., Why Bother Me Again? Benchmarking Personal Agent Memory for Interaction Preferences](https://arxiv.org/abs/2610.30485).
[^benchpres]: [Yoon et al., BenchPreS](https://arxiv.org/abs/2603.16557).
[^memory-aware-reward]: [Dong et al., Memory-Aware Reward Modeling](https://arxiv.org/abs/2610.31272).
