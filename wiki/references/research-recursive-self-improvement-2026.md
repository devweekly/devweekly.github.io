---
type: Research Dossier
title: "Research: Recursive Self-Improvement in AI Agents and Systems"
description: "A curated research map spanning formal definitions, model and harness evolution, self-modifying agents, automated AI research, evaluation, and safety through 2026-11-22."
tags: [research, recursive-self-improvement, agent-evolution, harness, evaluation, safety]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22T00:00:00Z" }
status: draft
sources:
  - id: awesome-rsi
    resource: https://github.com/lobehub/awesome-rsi
    title: "Awesome RSI: A curated research map of Recursive Self-Improvement"
  - id: self-evolving-agents-survey
    resource: https://arxiv.org/abs/2507.21046
    title: "A Survey of Self-Evolving Agents: On Path to Artificial Super Intelligence"
  - id: self-improvements-survey
    resource: https://arxiv.org/abs/2607.13104
    title: "Self-Improvements in Modern Agentic Systems: A Survey"
  - id: rsi-bounded-survey
    resource: https://arxiv.org/abs/2607.07663
    title: "Recursive Self-Improvement in AI: From Bounded Self-Refinement to Autonomous Research Loops"
  - id: trustworthy-rsi-survey
    resource: https://arxiv.org/abs/2610.35193
    title: "Trustworthy Recursive Self-Improvement in the Era of Large Models: Foundation, Risks, Evaluation and Open Challenges"
  - id: coding-agent-survey
    resource: https://arxiv.org/abs/2608.03392
    title: "Self-Evolving Coding Agents"
  - id: generalized-agent-iteration
    resource: https://arxiv.org/abs/2609.13406
    title: "Generalized Agent Iteration: One Formal Framework for Iterative Policy Improvement and Recursive Self-Improvement"
  - id: godel-machine
    resource: https://arxiv.org/abs/cs/0309048
    title: "Gödel Machines: Self-Referential Universal Problem Solvers Making Provably Optimal Self-Improvements"
  - id: promptbreeder
    resource: https://arxiv.org/abs/2309.16797
    title: "Promptbreeder: Self-Referential Self-Improvement Via Prompt Evolution"
  - id: stop
    resource: https://arxiv.org/abs/2310.02304
    title: "Self-Taught Optimizer (STOP): Recursively Self-Improving Code Generation"
  - id: adas
    resource: https://arxiv.org/abs/2408.08435
    title: "Automated Design of Agentic Systems"
  - id: dgm
    resource: https://arxiv.org/abs/2505.22954
    title: "Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents"
  - id: ace
    resource: https://arxiv.org/abs/2510.04618
    title: "Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models"
  - id: memrl
    resource: https://arxiv.org/abs/2601.03192
    title: "MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory"
  - id: memevolve
    resource: https://proceedings.mlr.press/v306/zhang26fa.html
    title: "MemEvolve: Meta-Evolution of Agent Memory Systems"
  - id: rrsi
    resource: https://arxiv.org/abs/2609.24972
    title: "RRSI: Regularized Recursive Self-Improvement of Agent Harnesses"
  - id: aflow
    resource: https://proceedings.iclr.cc/paper_files/paper/2025/hash/5492ecbce4439401798dcd2c90be94cd-Abstract-Conference.html
    title: "AFlow: Automating Agentic Workflow Generation"
  - id: meta-context-engineering
    resource: https://arxiv.org/abs/2601.21557
    title: "Meta Context Engineering via Agentic Skill Evolution"
  - id: ai-scientist
    resource: https://sakana.ai/ai-scientist/
    title: "The AI Scientist: Towards Fully Automated Open-Ended Scientific Discovery"
  - id: alphaevolve
    resource: https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/
    title: "AlphaEvolve: A Gemini-Powered Coding Agent for Designing Advanced Algorithms"
  - id: safety-self-evolving
    resource: https://arxiv.org/abs/2610.00093
    title: "Safety in Self-Evolving Agents: A Survey"
  - id: seabench
    resource: https://arxiv.org/abs/2609.35596
    title: "SEABench: Benchmarking Endogenous Misalignment in Self-Evolving Agents"
  - id: rsi-bench
    resource: https://github.com/sunghunkwag/rsi-bench
    title: "RSI-Bench"
---

# Scope and reading method

This dossier curates papers and systems that directly study persistent self-improvement, recursively modifiable improvement mechanisms, or evaluation and safety properties that determine whether such systems can be trusted. It is not a copy of the continuously changing [Awesome RSI research map](https://github.com/lobehub/awesome-rsi). That repository is useful for discovery; each item below links to a primary paper, proceedings page, project page, or official implementation where available.[^awesome-rsi]

The literature uses overlapping terms—self-refinement, self-evolution, self-training, agent optimization, harness optimization, and recursive self-improvement. Do not infer RSI from a title. Classify each result by its update target, what persists, which part of the update procedure can change, how it is evaluated, and what remains fixed.

# Surveys and conceptual frameworks

**A Survey of Self-Evolving Agents: On Path to Artificial Super Intelligence** (Gao et al., 2025; TMLR 2026). Organizes agent evolution by what changes, when updates occur, and how they are performed. It covers models, memory, tools, architecture, single- and multi-agent approaches, applications, benchmarks, and safety. It is a useful broad map for the transition from static foundation models to agents that adapt through interaction.[^self-evolving-agents-survey]

**Recursive Self-Improvement in AI: From Bounded Self-Refinement to Autonomous Research Loops** (Chen et al., 2026; preprint). Surveys 1,250 arXiv papers from 2024–2026 and separates update targets and degrees of loop closure. Its central distinction is between bounded, measurable refinement and open-ended RSI. It also emphasizes that every loop depends on an evaluator signal; the reliability of that signal constrains the strength of the improvement claim.[^rsi-bounded-survey]

**Self-Improvements in Modern Agentic Systems: A Survey** (Ren et al., 2026; preprint). Models an agent as a foundation model plus an operational scaffold of prompts, memory, tools, and control logic. It treats self-improvement as a persistent update operator on model or scaffold components. This is a useful system-level vocabulary for harness engineering.[^self-improvements-survey]

**Generalized Agent Iteration (GAI)** (Tang et al., 2026; preprint). Places iterative policy improvement and RSI in one formal framework. Two questions determine where a system sits: whether the improving mechanism is itself part of the modifiable agent, and whether evaluation remains anchored outside the agent. The second question exposes goal drift and fully self-referential evaluation as distinct risks.[^generalized-agent-iteration]

**Trustworthy Recursive Self-Improvement in the Era of Large Models** (Pu et al., 2026; preprint). Organizes trustworthy RSI around genuine and sustained improvement, preservation of behavioral constraints, system security and privacy, and transparency and controllability. It analyses diagnosis, proposal generation, evaluation, update implementation, and the recursive modification of those stages.[^trustworthy-rsi-survey]

**Self-Evolving Coding Agents** (Zhou et al., 2026; preprint). Reviews coding agents that persistently update framework, memory, skills, tools, models, collaboration structure, workflow, or environment from repository-level feedback. Executable tests and issue trajectories make software engineering a particularly observable domain, but also create risks of benchmark overfitting, unsafe edits, and fragile repository-specific rules.[^coding-agent-survey]

# Foundational mechanisms

**Gödel Machine** (Schmidhuber, 2003/2006). A theoretical self-referential universal problem solver that rewrites itself only after proving that a change improves expected utility. Its value is conceptual: it makes proof of beneficial self-modification explicit. In practical open environments, proving that arbitrary code changes are globally beneficial is generally intractable; modern systems therefore use empirical evaluation and safeguards instead.[^godel-machine]

**Promptbreeder** (Fernando et al., 2023; ICML 2024). Evolves task prompts and the mutation prompts that generate future prompt candidates. It is a clear example of self-referential prompt evolution. Its results are bounded to the tested optimization tasks and should not be read as evidence of general-purpose autonomous improvement.[^promptbreeder]

**Self-Taught Optimizer (STOP)** (2023; COLM 2024). Demonstrates an LLM-written scaffolding program that improves the program responsible for generating further improvements. It is a compact, concrete example of recursive code-level optimization, although it operates in a constrained code-generation setting.[^stop]

**Automated Design of Agentic Systems (ADAS)** (Hu, Lu, and Clune, 2024; ICLR 2025). Represents agent designs as code and uses a meta-agent to search and create new designs. The paper demonstrates that automatically discovered agents can outperform hand-designed baselines in several domains. The important boundary is whether the search mechanism itself evolves, rather than only the agents it creates.[^adas]

# Harness, context, and memory evolution

This is currently one of the most practical research areas for agent builders because it can improve behavior without retraining the base model.

**Agentic Context Engineering (ACE)** (Zhang et al., ICLR 2026). Replaces destructive whole-context rewriting with an evolving playbook maintained by three roles: Generator creates trajectories and candidate lessons, Reflector extracts useful insights, and Curator applies structured delta updates with deduplication and pruning. The paper reports average gains of 10.6% on agent tasks and 8.6% on finance-domain benchmarks. ACE is strong evidence for retained context improvement. Its generator–reflector–curator procedure is itself a designed pipeline; the paper's context gains alone do not prove that this updater recursively improves its own method.[^ace]

**MemRL** (Zhang et al., 2026; preprint). Keeps the base LLM fixed and applies runtime reinforcement learning to episodic memory. A two-stage retrieval process filters by semantic relevance and then uses learned Q-values to select higher-utility experiences based on environmental feedback. It demonstrates a route to persistent adaptation without weight updates; the learning policy and memory-selection machinery must be separately assessed before claiming improver gain.[^memrl]

**MemEvolve: Meta-Evolution of Agent Memory Systems** (Zhang et al., ICML 2026). Jointly evolves experiential knowledge and the memory architecture that encodes, stores, retrieves, and manages it. It also introduces EvolveLab as a modular codebase spanning twelve representative memory systems. The paper reports gains of up to 17.06% on evaluated frameworks and cross-task/cross-LLM transfer. It is especially relevant because the object of adaptation includes how the agent learns from experience, not merely the content accumulated in memory.[^memevolve]

**Meta Context Engineering via Agentic Skill Evolution** (2026; ICML 2026). Uses a bi-level approach in which context-engineering skills and context artifacts co-evolve. It is relevant to the question of whether an agent can learn better procedures for managing its own context, rather than just accumulating better context text.[^meta-context-engineering]

Related work includes [A-MEM](https://arxiv.org/abs/2502.12110), [ExpeL](https://arxiv.org/abs/2308.10144), [MemSkill](https://arxiv.org/abs/2602.02474), and [EvolveR](https://arxiv.org/abs/2510.16079). These systems explore linked notes, reusable experience, memory operations, or experience-driven agent lifecycles. Their relationship to strict RSI depends on whether the learning/updating mechanism itself is mutable and empirically improved.

# Harness and code evolution

**Darwin Gödel Machine (DGM)** (Zhang et al., 2025). Modifies its own coding-agent code, keeps an archive of candidate agents, and empirically evaluates changes on coding benchmarks. The paper reports SWE-bench performance increasing from 20.0% to 50.0%, and Polyglot from 14.2% to 30.7%. It is an important open-ended search demonstration: the archive preserves multiple branches rather than only one greedy sequence. These results are benchmark-specific, and the implementation warns that model-generated code is untrusted and requires isolation and oversight.[^dgm]

**RRSI: Regularized Recursive Self-Improvement of Agent Harnesses** (Xia et al., 2026; preprint and open implementation). Treats the harness around a frozen model—prompts, tools, control flow, memory, and context management—as the search target. It adds an annealed edit budget, edit-history awareness, exploration of unused components, a critic for benchmark-specific logic, a noise-adjusted acceptance threshold, cost-aware selection, and pruning. Its motivation is that harness search can memorize the development benchmark and lose gains out of distribution. The public implementation uses Git worktrees for candidate isolation and records per-edit hypotheses, diffs, measured scores, costs, and verdicts. The paper reports gains on its evolved benchmarks and transfer to held-out benchmarks. Because the proposal and selection machinery is not automatically evidence of being improved by the same loop, distinguish retained harness gains from measured improvement to the improver itself.[^rrsi]

**AFlow: Automating Agentic Workflow Generation** (Zhang et al., ICLR 2025). Searches workflows represented as executable graphs using Monte Carlo tree search, code modification, stored experience, and execution feedback. It is a useful bounded workflow-optimization method. A fixed search procedure that discovers better workflows is an enabling method, not by itself proof of recursive improvement of the search procedure.[^aflow]

Other active harness work includes [AutoHarness](https://arxiv.org/abs/2603.03329), [Continual Harness](https://arxiv.org/abs/2605.09998), [Agentic Harness Engineering](https://arxiv.org/abs/2604.25850), [RSIAgent](https://arxiv.org/abs/2609.15364), and [CoEvoSkills](https://arxiv.org/abs/2604.01687). Treat them as distinct update mechanisms and check the latest paper versions before comparing reported results.

# Model-level evolution and automated AI R&D

Model-level approaches change training data, reward signals, model weights, or the training procedure itself. Examples include [Self-Rewarding Language Models](https://arxiv.org/abs/2401.10020), [Self-Play Fine-Tuning](https://arxiv.org/abs/2401.01335), and [SEAL: Self-Adapting Language Models](https://arxiv.org/abs/2506.10943). They are important to the broader RSI landscape, but their learning loop and its degree of external supervision must be distinguished from harness-level adaptation.

Automated AI R&D extends the target from an agent to the process that builds or improves AI systems:

- **The AI Scientist** (Sakana AI, 2024) attempts an end-to-end research loop: idea generation, code, experiments, result analysis, paper writing, and automated review. Its authors document serious limitations, including incorrect implementations, unfair baseline comparisons, and flawed interpretation. A reproducible artifact and independent review remain necessary.[^ai-scientist]
- **AlphaEvolve** (Google DeepMind, 2025) uses an LLM-guided evolutionary coding agent with automated evaluators to discover and optimize algorithms. It illustrates the value of verifiable objective functions and a search loop, rather than an unconstrained LLM judge.[^alphaevolve]
- **PostTrainBench** and **AutoLab** test whether agents can carry out realistic model post-training or long-horizon AI research and engineering tasks. These measure AI R&D capability; capability to assist AI development is not the same claim as autonomous recursive self-improvement.

# Evaluation and safety

A useful evaluation should measure more than the score of the latest candidate.

| Evaluation question | What to measure |
| --- | --- |
| Did the change help the intended task? | Matched baseline, repeated trials, task-level success and error categories |
| Is the gain retained? | Persistent artifact, fresh session, repeated task, and held-out tasks |
| Does it transfer? | Different repositories, domains, models, environments, and distributions |
| Did the improver become better? | Frozen-improver control, same task agent, feedback, candidate count, and compute budget |
| Did it damage prior behavior? | Regression suite, constraint checks, historical tasks, and red-team cases |
| Is the update worth its cost? | Tokens, latency, compute, infrastructure cost, retries, and maintenance burden |

Relevant evaluation resources include [RSI-Bench](https://github.com/sunghunkwag/rsi-bench), [SEABench](https://arxiv.org/abs/2609.35596), [PostTrainBench](https://arxiv.org/abs/2603.08640), [AutoLab](https://arxiv.org/abs/2606.05080), [MLE-bench](https://github.com/openai/mle-bench), [RE-Bench](https://github.com/METR/RE-Bench), and [SWE-bench](https://github.com/SWE-bench/SWE-bench). Some are direct self-improvement evaluations; others are capability proxies for AI R&D or coding. Do not treat all benchmark scores as direct RSI evidence.[^awesome-rsi]

The safety literature highlights risks that compound across persistent state and successor systems: benchmark leakage, reward hacking, self-confirming evaluators, capability regression, diversity collapse, harmful or stale memory, prompt injection that becomes retained policy, policy/permission drift, privacy leakage, unsafe self-modifying code, and weakening human oversight. [Safety in Self-Evolving Agents](https://arxiv.org/abs/2610.00093) and the broader [Trustworthy RSI survey](https://arxiv.org/abs/2610.35193) are useful starting points. A key operational principle is that a change to the evaluator or updater invalidates assumptions based on its earlier version; evaluate the changed mechanism again.

# Research conclusions

The strongest near-term engineering path is bounded, harness-level adaptation with immutable external evaluation and versioned candidate artifacts. Memory, context, and skill evolution can deliver useful retained gains without changing model weights. Code-level and AI R&D loops are more powerful but also expand the attack surface and the difficulty of verification.

The evidence base is uneven. Papers report encouraging gains, but differences in benchmark, model, compute budget, evaluation independence, and what exactly changed make headline numbers non-comparable. Claims of autonomous or open-ended RSI should therefore be held to a higher standard than a single benchmark improvement.

# Related Wiki concepts

- [Recursive Self-Improvement](../concepts/recursive-self-improvement.md)
- [Agent Memory](../concepts/agent-memory.md)
- [Memory Dreaming](../concepts/memory-dreaming.md)
- [Context Management](../concepts/context-management.md)

[^awesome-rsi]: [LobeHub, Awesome RSI](https://github.com/lobehub/awesome-rsi).
[^self-evolving-agents-survey]: [Gao et al., A Survey of Self-Evolving Agents](https://arxiv.org/abs/2507.21046).
[^rsi-bounded-survey]: [Chen et al., Recursive Self-Improvement in AI: From Bounded Self-Refinement to Autonomous Research Loops](https://arxiv.org/abs/2607.07663).
[^self-improvements-survey]: [Ren et al., Self-Improvements in Modern Agentic Systems](https://arxiv.org/abs/2607.13104).
[^generalized-agent-iteration]: [Tang et al., Generalized Agent Iteration](https://arxiv.org/abs/2609.13406).
[^trustworthy-rsi-survey]: [Pu et al., Trustworthy Recursive Self-Improvement in the Era of Large Models](https://arxiv.org/abs/2610.35193).
[^coding-agent-survey]: [Zhou et al., Self-Evolving Coding Agents](https://arxiv.org/abs/2608.03392).
[^godel-machine]: [Schmidhuber, Gödel Machines](https://arxiv.org/abs/cs/0309048).
[^promptbreeder]: [Fernando et al., Promptbreeder](https://arxiv.org/abs/2309.16797).
[^stop]: [Zelikman et al., Self-Taught Optimizer (STOP)](https://arxiv.org/abs/2310.02304).
[^adas]: [Hu et al., Automated Design of Agentic Systems](https://arxiv.org/abs/2408.08435).
[^dgm]: [Zhang et al., Darwin Gödel Machine](https://arxiv.org/abs/2505.22954).
[^ace]: [Zhang et al., Agentic Context Engineering](https://arxiv.org/abs/2510.04618).
[^memrl]: [Zhang et al., MemRL](https://arxiv.org/abs/2601.03192).
[^memevolve]: [Zhang et al., MemEvolve](https://proceedings.mlr.press/v306/zhang26fa.html).
[^rrsi]: [Xia et al., RRSI](https://arxiv.org/abs/2609.24972).
[^aflow]: [Zhang et al., AFlow](https://proceedings.iclr.cc/paper_files/paper/2025/hash/5492ecbce4439401798dcd2c90be94cd-Abstract-Conference.html).
[^meta-context-engineering]: [Meta Context Engineering via Agentic Skill Evolution](https://arxiv.org/abs/2601.21557).
[^ai-scientist]: [Sakana AI, The AI Scientist](https://sakana.ai/ai-scientist/).
[^alphaevolve]: [Google DeepMind, AlphaEvolve](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/).
