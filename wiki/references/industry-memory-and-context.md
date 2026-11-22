---
type: Industry Research Dossier
title: "Industry Practice: Personal Memory and Context Management"
description: "A curated record of public product and engineering practices from Google, OpenAI, Anthropic, and Letta."
tags: [industry-practice, personal-intelligence, memory, context-management]
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
  - id: anthropic-context-engineering
    resource: https://www.anthropic.com/research/effective-context-engineering-for-ai-agents
    title: "Effective context engineering for AI agents"
    last_modified: "2025-09-29"
  - id: anthropic-context-primitives
    resource: https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
    title: "Context engineering: memory, compaction, and tool clearing"
  - id: letta-sleep-agents
    resource: https://www.letta.com/blog/sleep-time-compute/
    title: "Sleep-time Compute"
    last_modified: "2025-04-21"
  - id: letta-context-constitution
    resource: https://www.letta.com/blog/context-constitution/
    title: "Context Constitution"
    last_modified: "2026-04-02"
  - id: letta-production-eval
    resource: https://www.letta.com/blog/evaluating-memory-in-production-agents/
    title: "Evaluating Memory in Production Agents"
    last_modified: "2026-07-28"
---

# Scope

This dossier records public product documentation and engineering accounts available on 2026-11-22. It is not a vendor feature comparison and does not imply that similarly named features share the same architecture.

# Personal data and user context

**Google Gemini — Personal Intelligence.** Google's January 2026 announcement describes connecting Gmail, Photos, YouTube, and Search so Gemini can reason across personal and general information. The announcement emphasizes optional app connections and user controls. It is a useful cross-source personalization pattern, but the privacy description is the vendor's own account rather than an independent audit.[^google-personal-intelligence]

**OpenAI — ChatGPT Memory.** The current help documentation describes using relevant information from past chats, saved memories, custom instructions, available files, and connected apps, depending on the account and workspace. It also describes memory sources and user controls for correction, suppression, and deletion. The product documentation emphasizes that the memory summary is not the complete list of sources used.[^openai-memory]

**Anthropic — Claude Code.** The documentation distinguishes human-authored `CLAUDE.md` or `AGENTS.md` instructions from Claude-maintained auto memory. Auto memory is scoped to a repository and only a bounded prefix of `MEMORY.md` is loaded automatically. The files are context, not enforced policy; deterministic hooks are required for hard controls.[^claude-code-memory]

# Context engineering and long sessions

**Anthropic — Effective context engineering.** Anthropic describes context rot and recommends a small, high-signal context, efficient tools, progressive disclosure, and just-in-time retrieval rather than preloading large corpora.[^anthropic-context-engineering]

**Anthropic — Context primitives.** Its cookbook distinguishes compaction, tool-result clearing, and persistent memory. Compaction summarizes the active history; clearing removes old re-fetchable tool payloads; memory persists notes outside the active context. These operations address different sources of context growth.[^anthropic-context-primitives]

# Asynchronous maintenance and agent-owned context

**Letta — Sleep-time agents.** Letta's implementation separates a user-facing primary agent from a background agent that maintains the primary agent's memory. The background model can be slower and run asynchronously, moving memory maintenance out of the response path.[^letta-sleep-agents]

**Letta — Context Constitution.** Letta describes a memory-first harness with a versioned memory filesystem, tools for the agent to read and write its context, cross-conversation memory, and specialized subagents for reflection and organization. This makes context an inspectable artifact, but also makes memory governance and review essential.[^letta-context-constitution]

**Letta — Production memory evaluation.** Its Context-Bench V2 separates memory usage (adherence and retrieval) from memory generation (generalization and hygiene). The benchmark is private and the results are vendor-reported, but the dimensions provide a useful checklist for evaluating stateful agents.[^letta-production-eval]

# Cross-source engineering conclusions

The public examples converge on a few architectural patterns:

- Separate always-loaded instructions from agent-generated memories and from source records.
- Keep the initial context small; retrieve large or low-frequency material on demand.
- Provide a source trail and user controls for personal context.
- Separate user-facing response generation from broad memory maintenance when consolidation is expensive.
- Test both memory use and memory generation, and do not rely on text files as enforcement for security or approvals.

# Related concepts

- [Personal Intelligence and User Models](../concepts/personal-intelligence.md)
- [Memory Dreaming and Offline Consolidation](../concepts/memory-dreaming.md)
- [Context Management for Long-Running Agents](../concepts/context-management.md)

[^google-personal-intelligence]: [Google, Gemini introduces Personal Intelligence](https://blog.google/innovation-and-ai/products/gemini-app/personal-intelligence/).
[^openai-memory]: [OpenAI, Memory in ChatGPT](https://help.openai.com/en/articles/8590148-memory-in-chatgpt).
[^claude-code-memory]: [Anthropic, How Claude remembers your project](https://code.claude.com/docs/en/memory).
[^anthropic-context-engineering]: [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents).
[^anthropic-context-primitives]: [Anthropic Cookbook, Context engineering: memory, compaction, and tool clearing](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools).
[^letta-sleep-agents]: [Letta, Sleep-time Compute](https://www.letta.com/blog/sleep-time-compute/).
[^letta-context-constitution]: [Letta, Context Constitution](https://www.letta.com/blog/context-constitution/).
[^letta-production-eval]: [Letta, Evaluating Memory in Production Agents](https://www.letta.com/blog/evaluating-memory-in-production-agents/).
