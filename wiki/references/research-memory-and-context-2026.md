---
type: Research Dossier
title: "Research: Memory, Personalization, and Context Management"
description: "A curated review of surveys, recent preprints, and benchmarks available through 2026-11-22."
tags: [research, llm-memory, personal-intelligence, context-management, benchmarks]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22T00:00:00Z" }
status: draft
sources:
  - id: memory-survey
    resource: https://link.springer.com/article/10.1007/s44336-026-00044-1
    title: "Learning to Remember: Advances in Memory Mechanisms for Large Language Models"
    last_modified: "2026-11-09"
  - id: sleep-time-compute
    resource: https://arxiv.org/abs/2504.13171
    title: "Sleep-time Compute: Beyond Inference Scaling at Test-time"
    last_modified: "2025-04-17"
  - id: trimem
    resource: https://arxiv.org/abs/2605.19952
    title: "Rethinking How to Remember: Beyond Atomic Facts in Lifelong LLM Agent Memory"
    last_modified: "2026-10-20"
  - id: tem
    resource: https://arxiv.org/abs/2610.21900
    title: "TEM: Temporal State Tracking Memory for Large Language Model Agents"
    last_modified: "2026-10-15"
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
  - id: let-them-sleep
    resource: https://arxiv.org/abs/2610.25561
    title: "Let Them Sleep: Recursive Self-Pruning Memory for Long-Horizon LLM Agents"
    last_modified: "2026-10-18"
  - id: ctxagent
    resource: https://arxiv.org/abs/2610.34425
    title: "CTXAgent - Self-Controlled Context Management of LLM Agents"
    last_modified: "2026-10-27"
  - id: compact-bench
    resource: https://arxiv.org/abs/2611.25673
    title: "CompAct-Bench: A Benchmark for Working-Context Compaction in Long-Horizon Agent Tasks"
    last_modified: "2026-11-20"
---

# Scope and evidence status

This dossier includes one peer-reviewed/open-access survey and a set of arXiv preprints available on 2026-11-22. Preprints and their benchmark results are author-reported; the numbers below are not independent replications or universal guarantees. Dates distinguish initial submission from the latest version read where relevant.

# Surveys and memory architecture

**Learning to Remember: Advances in Memory Mechanisms for Large Language Models** (Han et al., 2026; *Neural Computing and Applications*, DOI 10.1007/s44336-026-00044-1; published 2026-11-09). The survey organizes memory by lifecycle, storage substrate, and role in agent systems. It covers non-parametric stores (text, graphs, databases, multimodal), parametric mechanisms (activations, KV caches, adapters, weights), and memory for agent evolution. Its strongest contribution for system design is the lifecycle view: construction, maintenance, retrieval, consolidation, forgetting, governance, and evaluation must be considered together.[^memory-survey]

# Capture granularity and temporal state

**TriMem — Rethinking How to Remember** (Sun et al.; arXiv:2605.19952; submitted 2026-05-19, revised 2026-10-20). TriMem maintains raw dialogue segments linked to source identifiers, extracted atomic facts for retrieval, and synthesized profiles for reasoning across scattered evidence. It is an argument for retaining complementary levels of detail rather than collapsing everything into facts or summaries.[^trimem]

**TEM — Temporal State Tracking Memory** (Song et al.; arXiv:2610.21900; submitted 2026-10-15). TEM stores facts as source-linked versions and exposes chronological order and historical status during retrieval. It targets the difference between a fact that used to be true and one that is true now.[^tem]

# Personal intelligence and evolving preferences

**HorizonBench** (Li et al.; arXiv:2604.17283; submitted 2026-04-19, revised 2026-11-17). This benchmark studies preference changes that are implied by life events rather than explicitly announced. It contains 4,245 questions over six-month histories for 360 users; the paper also reports 83,024 longitudinal preference ratings from 160 people. All 25 tested frontier models selected outdated preferences more often than expected, and the best reported accuracy was 52.8%.[^horizonbench]

**MemPABench — Why Bother Me Again?** (Li et al.; arXiv:2610.30485; submitted 2026-10-21). It evaluates whether a personal agent remembers interaction preferences—when to clarify, confirm, act autonomously, or avoid unnecessary outreach—over four months of simulated interactions. The paper reports that retrieval-based systems did not outperform the no-memory baseline on preference selection; file-based memory sometimes over-applied preferences.[^mempabench]

**BenchPreS** (Yoon et al.; arXiv:2603.16557; submitted 2026-03-17, revised 2026-10-15). This benchmark evaluates whether a persistent preference should be applied or suppressed for a particular recipient-task context. The authors report high preference misapplication, including a 40.95% rate for the strongest model in their comparison. It isolates scope selection from memory retrieval.[^benchpres]

**Memory-Aware Reward Modeling** (Dong et al.; arXiv:2610.31272; submitted 2026-10-22). In about 1,000 pairwise judgments from 87 participants, memory-conditioned responses were not consistently preferred to responses without personal memory. Users sometimes preferred the unpersonalized response, and automatic evaluators tended to favor memory-conditioned answers more often than users did.[^memory-aware-reward]

# Dreaming, pruning, and context compaction

**Sleep-time Compute** (Lin et al.; arXiv:2504.13171; submitted 2025-04-17). Offline computation over a persistent context reduced test-time compute by about 5x for comparable accuracy on the paper's modified math tasks; sharing precomputed work across related questions reduced average per-query cost. The authors note that benefits depend on how predictable future queries are.[^sleep-time-compute]

**Let Them Sleep** (Chauhan et al.; arXiv:2610.25561; submitted 2026-10-18). Recursive Self-Pruning Memory clusters failures into rules, prunes source episodes, decays rules, and promotes rules seen across contexts. The authors report improvements across software-engineering, temporal-consistency, and long-horizon QA settings. The paper also documents a damaging case where the system pruned useful memory because it misattributed a difficult task's failure to retrieved memories. This is a warning against equating failure with bad memory.[^let-them-sleep]

**CTXAgent** (Busch et al.; arXiv:2610.34425; submitted 2026-10-25, revised 2026-10-27). It studies models that decide when and how to compact or curate their own context. The reported results vary substantially by model; model-directed context management is not a uniform capability that a harness can assume.[^ctxagent]

**CompAct-Bench** (Chen et al.; arXiv:2611.25673; submitted 2026-11-19). It evaluates compaction by whether the agent can complete its original task after an intermediate context boundary. The 200-task benchmark spans BrowseComp, SWE-bench, and CompanyBench. The strongest tested compactor achieved 68.5% post-compaction task accuracy and the model average was 56.7% at a 10% retention ratio.[^compact-bench]

# Research implications

The recent work points to five requirements for a practical memory system: preserve source-level evidence; keep several memory representations rather than one universal summary; track time and supersession; decide whether retrieved preferences apply to the present context; and evaluate consolidation or compaction by downstream behavior.

The relationship between memory/context evolution and strict recursion is discussed in [Recursive Self-Improvement](../concepts/recursive-self-improvement.md), with further work on ACE and MemEvolve in the [RSI research dossier](research-recursive-self-improvement-2026.md).

# Related concepts

- [Memory Hierarchy](../concepts/memory-hierarchy.md)
- [Personal Intelligence and User Models](../concepts/personal-intelligence.md)
- [Memory Dreaming and Offline Consolidation](../concepts/memory-dreaming.md)
- [Context Management for Long-Running Agents](../concepts/context-management.md)

[^memory-survey]: [Han et al., Learning to Remember](https://link.springer.com/article/10.1007/s44336-026-00044-1).
[^sleep-time-compute]: [Lin et al., Sleep-time Compute](https://arxiv.org/abs/2504.13171).
[^trimem]: [Sun et al., TriMem](https://arxiv.org/abs/2605.19952).
[^tem]: [Song et al., TEM](https://arxiv.org/abs/2610.21900).
[^horizonbench]: [Li et al., HorizonBench](https://arxiv.org/abs/2604.17283).
[^mempabench]: [Li et al., MemPABench](https://arxiv.org/abs/2610.30485).
[^benchpres]: [Yoon et al., BenchPreS](https://arxiv.org/abs/2603.16557).
[^memory-aware-reward]: [Dong et al., Memory-Aware Reward Modeling](https://arxiv.org/abs/2610.31272).
[^let-them-sleep]: [Chauhan et al., Let Them Sleep](https://arxiv.org/abs/2610.25561).
[^ctxagent]: [Busch et al., CTXAgent](https://arxiv.org/abs/2610.34425).
[^compact-bench]: [Chen et al., CompAct-Bench](https://arxiv.org/abs/2611.25673).
