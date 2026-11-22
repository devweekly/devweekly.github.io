---
type: Concept
title: "Recursive Self-Improvement in AI Systems"
description: "A system-level view of agents that retain improvements and modify the mechanisms responsible for future improvements."
tags: [recursive-self-improvement, self-evolving-agents, agent-harness, evaluation, safety]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22T00:00:00Z" }
status: draft
sources:
  - id: awesome-rsi
    resource: https://github.com/lobehub/awesome-rsi
    title: "Awesome RSI: A curated research map of Recursive Self-Improvement"
  - id: self-evolving-agents-survey
    resource: https://arxiv.org/abs/2507.21046
    title: "A Survey of Self-Evolving Agents: On Path to Artificial Super Intelligence"
  - id: rsi-bounded-survey
    resource: https://arxiv.org/abs/2607.07663
    title: "Recursive Self-Improvement in AI: From Bounded Self-Refinement to Autonomous Research Loops"
  - id: generalized-agent-iteration
    resource: https://arxiv.org/abs/2609.13406
    title: "Generalized Agent Iteration: One Formal Framework for Iterative Policy Improvement and Recursive Self-Improvement"
  - id: trustworthy-rsi-survey
    resource: https://arxiv.org/abs/2610.35193
    title: "Trustworthy Recursive Self-Improvement in the Era of Large Models: Foundation, Risks, Evaluation and Open Challenges"
---

# Definition

Recursive self-improvement (RSI) describes a system that improves its capabilities and can also improve the mechanisms that generate subsequent improvements. The important property is not simply that an agent changes something about itself. It is that the improvement process itself becomes part of the system's evolving state and can be revised, evaluated, retained, and reused in later rounds.[^awesome-rsi][^rsi-bounded-survey]

This definition separates three claims that are often conflated:

- **Self-refinement** changes the current answer or trajectory. It may disappear when the task ends.
- **Persistent self-improvement** changes a reusable component—such as memory, context, skills, prompts, tools, workflows, code, or model weights—and improves later tasks.
- **Recursive self-improvement** also changes the machinery that proposes, evaluates, or installs those updates.

A system that can edit its own prompt or memory is therefore not automatically an RSI system. It may be a useful persistent-learning agent, but if the updater and its evaluation policy remain fixed, the recursive part has not yet been demonstrated. An editable architecture is an **RSI substrate**: it makes self-modification possible, but does not prove that a self-improvement loop is operating.[^awesome-rsi]

# What can evolve

The taxonomy is organized by the object being changed. These categories overlap; a system can evolve several components at once.[^self-evolving-agents-survey][^awesome-rsi]

| Evolution target | Persistent artifact | Typical feedback |
| --- | --- | --- |
| Model | Weights, adapters, training data, reward or critic models | Verified outcomes, preference signals, self-generated data, external rewards |
| Agent harness | Prompts, context, memory, skills, tools, control flow, permissions, subagents | Tool results, task success, error traces, human corrections |
| Agent or workflow design | Executable workflow graphs, agent topology, reusable subagents, code | Benchmark scores, execution cost, failures and transfer tests |
| Multi-agent system | Roles, coordination rules, communication protocols, population strategies | Team-level outcomes and cross-agent evaluation |
| AI research process | Hypothesis generation, experiment selection, coding, analysis, review | Reproducible experiments and independently checked results |
| Embodied system | Policies, skills, world models, task strategies and sometimes hardware configuration | Simulation and physical-world measurements |

Model-level self-training and harness-level evolution should not be collapsed into one category. The former changes the learned policy or its training process; the latter can produce large behavioral changes while the underlying model weights remain frozen. For agent products, the harness is often the cheaper and more reversible place to begin.

# The improvement loop

A practical loop has six stages:

1. **Observe:** retain task outcomes, tool traces, corrections, and relevant environmental feedback.
2. **Diagnose:** identify a recurring limitation and distinguish it from a one-off failure or an external condition.
3. **Propose:** generate a small, attributable candidate change to a named component.
4. **Verify:** run deterministic checks, task evaluations, regression tests, and transfer tests against a baseline.
5. **Promote or reject:** accept only changes that pass quality, safety, and cost thresholds; preserve rejected hypotheses to avoid repeating them.
6. **Learn about the improver:** examine whether the proposer, evaluator, search strategy, or update procedure should itself change. This is the step that moves from persistent self-improvement toward RSI.

The last stage must not be inferred merely because the agent has a self-referential architecture. A fixed meta-agent can repeatedly write better task agents without improving its own ability to discover, judge, or install improvements.

# Evidence: what has actually improved?

Use three evidence levels when reading claims or designing an experiment.[^awesome-rsi]

| Evidence level | What it establishes | What it does not establish |
| --- | --- | --- |
| Task gain | The candidate scores better on the measured task or benchmark | That anything changed persistently |
| Retained gain | A stored update improves later runs, preferably on tasks not used to create it | That the updater became better |
| Improver gain | The mechanism generating updates also improves, under controlled and resource-comparable tests | Unlimited or open-ended improvement |

A fourth distinction is useful in practice: **structural recursion versus measured recursive gain**. A system may contain a loop that edits its own source code, prompt, or search strategy. That is evidence of structural recursion. To establish improver gain, compare the changed improver with a frozen-improver control using the same starting task agent, feedback, evaluation set, compute budget, and number of attempts.

# Keep the evaluator anchored

The formal framework of Generalized Agent Iteration describes agent improvement along two independent questions: whether the improving mechanism is part of the modifiable agent, and whether the evaluation standard remains grounded outside that agent.[^generalized-agent-iteration]

This distinction matters. An agent may be allowed to change its proposer, critic, or search procedure while an external benchmark and fixed constraints remain authoritative. That is a controllable path toward recursion. If the agent can also redefine what counts as success, it can produce apparent improvement by moving the goalposts. A fully self-referential system may be an interesting research object, but it is not an adequate production acceptance policy.

# Relationship to memory and context

The concepts already in this Wiki describe important components of the harness that an evolving agent may learn to improve:

- [Memory Hierarchy](memory-hierarchy.md) describes what is retained and in what form.
- [Memory Dreaming](memory-dreaming.md) describes asynchronous review and consolidation of experience.
- [Context Management](context-management.md) controls what enters the active context during a task.
- [Personal Intelligence](personal-intelligence.md) models user-specific facts and preferences, including their scope and changing validity.
- [Agent Memory](agent-memory.md) connects capture, retrieval, consolidation, and future context.

These mechanisms are useful without RSI. They become part of a self-improvement loop when experience causes durable changes that measurably improve future behavior. They move closer to strict RSI when the agent also improves how it selects, updates, evaluates, or governs those mechanisms.

An [LLM Wiki](llm-wiki.md) is likewise a knowledge representation and retrieval substrate, not an autonomous improvement loop by itself. Updating a concept page does not prove that the process used to discover and validate future updates has improved.

# Engineering implications

For a deployed agent, treat self-modification as a controlled software-delivery path rather than an unrestricted ability to rewrite its runtime.

- Keep the evaluator, protected test set, policy constraints, and promotion authority outside the agent's editable surface.
- Version every candidate artifact and record the hypothesis, source evidence, diff, test results, resource use, and accept/reject decision.
- Evaluate against both the tasks that guided the change and held-out tasks or changed environments. Repeatedly tuning against a fixed test set turns it into training data.
- Run candidates in isolated workspaces with least-privilege credentials. Do not let a candidate silently edit permissions, secrets, audit logs, or its own acceptance criteria.
- Support staged rollout, rollback, and comparison with the incumbent. A useful update must remain useful after the exploratory context and privileged state are removed.
- Measure regressions, cost, latency, token use, operational complexity, and safety constraints alongside task success.

The practical target is not maximum self-modification. It is reliable accumulation of verified improvements without losing previously trusted behavior or control.

# Failure modes and open questions

The main failure modes are benchmark overfitting, evaluator gaming, reward hacking, capability regression, memory contamination, unsafe code changes, goal drift, privacy leakage into persistent state, and loss of effective human oversight. When an improvement mechanism changes, earlier evidence about that mechanism may no longer apply; its successor needs fresh validation.[^trustworthy-rsi-survey]

The central research questions are consequently empirical: how to detect a genuine improvement rather than evaluation leakage; how to preserve constraints across generations; how to measure improvement to the improver; how to prevent a search process from collapsing diversity; and how to keep costs and human oversight bounded.

See the [research dossier](../references/research-recursive-self-improvement-2026.md) and [industry practice dossier](../references/industry-practice-recursive-self-improvement.md).

[^awesome-rsi]: [LobeHub, Awesome RSI](https://github.com/lobehub/awesome-rsi).
[^self-evolving-agents-survey]: [Gao et al., A Survey of Self-Evolving Agents](https://arxiv.org/abs/2507.21046).
[^rsi-bounded-survey]: [Chen et al., Recursive Self-Improvement in AI: From Bounded Self-Refinement to Autonomous Research Loops](https://arxiv.org/abs/2607.07663).
[^generalized-agent-iteration]: [Tang et al., Generalized Agent Iteration](https://arxiv.org/abs/2609.13406).
[^trustworthy-rsi-survey]: [Pu et al., Trustworthy Recursive Self-Improvement in the Era of Large Models](https://arxiv.org/abs/2610.35193).
