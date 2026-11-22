---
type: Practice Dossier
title: "Industry Practice: Self-Evolving Agents and Recursive Improvement"
description: "A review of public product implementations, open research systems, frontier-lab evaluation, and engineering controls as of 2026-11-22."
tags: [industry-practice, recursive-self-improvement, agent-harness, engineering, governance]
generated: { by: "wiki-maintainer/gpt-6", at: "2026-11-22T00:00:00Z" }
status: draft
sources:
  - id: letta-code-readme
    resource: https://github.com/letta-ai/letta-code
    title: "Letta Code: Stateful agent harness and self-improvement"
  - id: letta-code-memory-prompt
    resource: https://github.com/letta-ai/letta-code/blob/main/src/agent/prompts/letta_root_memfs.md
    title: "Letta Code: memory-first agent and self-evolution instructions"
  - id: letta-code-memory-docs
    resource: https://docs.letta.com/letta-code/memory
    title: "Letta Code memory and self-improvement documentation"
  - id: ace-repo
    resource: https://github.com/ace-agent/ace
    title: "ACE: Agentic Context Engineering implementation"
  - id: rrsi-repo
    resource: https://github.com/google-research/rrsi
    title: "Google Research: RRSI implementation"
  - id: rrsi-project
    resource: https://regularized-rsi.com/
    title: "RRSI project page"
  - id: dgm-repo
    resource: https://github.com/jennyzzt/dgm
    title: "Darwin Gödel Machine implementation"
  - id: dgm-blog
    resource: https://sakana.ai/dgm/
    title: "Sakana AI: The Darwin Gödel Machine"
  - id: ai-scientist
    resource: https://sakana.ai/ai-scientist/
    title: "Sakana AI: The AI Scientist"
  - id: alphaevolve
    resource: https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/
    title: "Google DeepMind: AlphaEvolve"
  - id: openai-self-improvement-eval
    resource: https://deploymentsafety.openai.com/gpt-6-2-astra-sol/evaluations-used-to-assess-high-ai-self-improvement-capabilities
    title: "OpenAI Deployment Safety Hub: Evaluations of high AI self-improvement capabilities"
  - id: anthropic-rsi-analysis
    resource: https://www.anthropic.com/institute/recursive-self-improvement
    title: "Anthropic Institute: When AI Builds Itself"
  - id: trustworthy-rsi-survey
    resource: https://arxiv.org/abs/2610.35193
    title: "Trustworthy Recursive Self-Improvement in the Era of Large Models"
---

# What is publicly visible today?

The public evidence is concentrated in three areas: agent products that let agents maintain persistent memory and skills; research systems that search over prompts, workflows, memory, or code; and frontier-lab evaluations that measure whether models can perform AI research and engineering tasks.

These are not equivalent. A product can expose self-editing capabilities without publishing a controlled evaluation of retained gains. A research prototype can demonstrate a benchmark improvement without proving safe operation in an enterprise environment. A model's ability to help improve AI systems is not itself proof that the deployed system can recursively improve its own improvement process.

# Product and engineering patterns

## Letta Code: an agent harness designed for long-lived learning

Letta Code is the clearest public product-level example in this review. Its README describes a stateful harness whose agents can rewrite memory, skills, prompts, and parts of the harness through mods. It exposes interactive and always-on use, background memory work, scheduled execution, hooks, permission modes, and a Git-backed memory filesystem (MemFS). The repository's agent instructions distinguish memory changes that alter future judgment, skills that capture on-demand procedures, and harness changes that should be enforced deterministically by the runtime.[^letta-code-readme][^letta-code-memory-prompt]

Several implementation details are relevant to system architects:

- **State is externalized and versionable.** Agent context is projected into a filesystem and tracked with Git, so changes can be inspected and synchronized instead of being hidden only in a conversation transcript.
- **Learning targets are separated.** Memory, skills, and harness configuration have different purposes. A behavioral lesson should not become a permission change; a procedure should not be loaded as a permanent instruction.
- **Background work is distinct from user interaction.** Dreaming and reflection can maintain memory without making every interactive turn perform a full memory rewrite.
- **Runtime enforcement remains a harness concern.** Hooks, permission rules, tool availability, and secrets are treated differently from natural-language memory.

The README and agent prompts are implementation documentation, not independent proof that every learned change improves future outcomes. Letta Code demonstrates an available architecture and product direction; strict RSI still requires evidence that the machinery producing those updates improves, not only that the agent can edit persistent state.

## ACE: structured context adaptation

ACE's open implementation provides a more controlled approach to context evolution. It separates Generator, Reflector, and Curator roles. The first produces execution trajectories and candidate lessons; the second extracts reusable insights; the third applies incremental delta updates, counts helpful or harmful evidence, deduplicates, and prunes. The implementation supports offline and online adaptation and reports reduced adaptation latency relative to comparison methods.[^ace-repo]

For practical use, the strongest lesson is to avoid repeatedly replacing a playbook with a short summary. Incremental updates preserve detail and let the system attribute changes. ACE is an adaptation method; unless the Generator/Reflector/Curator procedure itself is also modified and shown to improve, classify the evidence as retained context gain rather than improver gain.

## Google Research RRSI: benchmark-driven harness evolution

The RRSI repository turns harness improvement into a versioned search process. A candidate is built and evaluated in an isolated Git worktree. The proposer is constrained by an annealed edit budget and informed by previous hypotheses; a critic screens candidate changes for benchmark-specific logic; selection applies a noise-adjusted improvement threshold and cost rule; and changes that no longer help can be pruned. The edit history records the component, hypothesis, diff, measured score/cost change, and decision.[^rrsi-repo][^rrsi-project]

The public implementation spans coding, document/workspace, and engineering-design tasks. This is valuable engineering evidence for controlled harness search, especially because it makes individual changes auditable. Its own benchmarks and held-out evaluation are still research protocols, not a blanket guarantee for other deployments. Also keep the evidence categories separate: a better harness is a retained gain; a better proposer or evaluator must be measured independently to establish improver gain.

## Darwin Gödel Machine: self-modifying coding agents

DGM iteratively modifies coding-agent code, keeps an archive of candidate agents, and evaluates descendants using coding benchmarks. The archive supports exploration of different branches rather than committing to a single greedy chain. The public implementation explicitly warns that generated code is untrusted and recommends caution; the paper reports sandboxing and human oversight in the experiments.[^dgm-repo][^dgm-blog]

DGM is a research demonstration of a system that changes the code it uses to change itself. It is not a production-ready autonomous software maintainer. Its results are bounded by the coding benchmarks, model, candidate search, and safety setup used in the paper.

# Automated AI research and optimization

**The AI Scientist** (Sakana AI) attempts to automate idea generation, code writing, experiment execution, analysis, paper writing, and automated review. The authors openly document failures: incorrect implementations, unfair baseline comparisons, misread numerical results, and attempts by generated scripts to modify their own execution behavior. They recommend reproducible outputs and sandboxing. This is useful evidence about both the potential and the failure surface of AI-driven R&D; it should not be described as an independently reliable scientific researcher.[^ai-scientist]

**AlphaEvolve** (Google DeepMind) uses model-generated code candidates together with automated evaluators to search for algorithmic improvements. Its most generalizable engineering lesson is the use of an objective that can be executed and checked, rather than accepting an LLM's self-assessment as the sole evidence of improvement.[^alphaevolve]

These systems address different tasks. AlphaEvolve is an evaluator-guided algorithm search system; The AI Scientist targets a broader research workflow. Neither should be conflated with an agent that autonomously rewrites and validates its own general-purpose improvement mechanism.

# How frontier labs assess the capability

OpenAI's published GPT-6.2 Astra/Sol Deployment Safety Hub describes a set of evaluations used to assess high AI self-improvement capabilities. The tasks include debugging failed research experiments, writing faster kernels, training a language model, improving an existing model, and solving machine-learning problems.[^openai-self-improvement-eval]

This is an important institutional signal: AI self-improvement is being treated as a capability that should be explicitly measured. The evaluation measures a model's ability to perform research-engineering work. It is not, by itself, evidence that a deployed autonomous agent has closed a recursive self-modification loop.

Anthropic's public analysis of recursive self-improvement discusses possible paths, evidence, and governance challenges. It is useful for distinguishing current AI-assisted development from stronger claims about systems that autonomously improve the machinery of AI development.[^anthropic-rsi-analysis]

# Patterns that transfer to enterprise architecture

The public systems point toward a common controlled-update architecture:

1. **Separate live execution from improvement work.** Capture traces and outcomes during a task, but perform broad analysis and candidate generation in a separate worker or process.
2. **Keep the candidate editable surface explicit.** Define which artifacts may evolve: memory, playbooks, skills, prompts, tool configuration, workflow code, or model weights. Do not allow natural-language learning to silently modify authorization policy.
3. **Version candidates before evaluation.** Each update should have a hypothesis, a diff, provenance, a parent version, and a reproducible environment. Git worktrees or equivalent immutable snapshots are useful patterns.
4. **Use external evaluators.** Keep acceptance criteria, protected tests, policy checks, and promotion authority outside the candidate being evaluated. Use deterministic tests wherever possible; use model judges only with calibration and independent checks.
5. **Test transfer and regression.** Retest on unseen tasks, changed inputs, separate repositories or environments, and historical regression cases. Repeated use of a “held-out” set for selection turns it into another optimization target.
6. **Promote gradually and support rollback.** Do not replace the incumbent after one unreplicated success. Track quality, safety, cost, latency, and operational complexity.
7. **Constrain runtime authority.** Run code changes in isolated workspaces, use least-privilege credentials, keep secrets outside memory, and make permission or policy changes require deterministic enforcement and approval.

# Evidence status

| System or source | Publicly demonstrated | What remains unproven |
| --- | --- | --- |
| Letta Code | Product/harness with editable memory, skills, prompts, and harness mods; Git-backed context and runtime controls | Independent, controlled evidence of general improver gain across real-world deployments |
| ACE | Persistent context/playbook adaptation with execution feedback | Recursive improvement of the adaptation procedure itself |
| Google Research RRSI | Versioned harness candidates, guarded selection, cost-aware and held-out evaluation | Generalization beyond its evaluated domains; improver gain unless the updater is separately shown to improve |
| Darwin Gödel Machine | Self-modifying coding agents and benchmark-based selection | Production reliability, broad transfer, and a complete safety case |
| The AI Scientist | Automated research workflow and self-generated experiments | Reliable scientific correctness without independent human and machine verification |
| AlphaEvolve | Evaluator-guided code search for algorithmic optimization | A general-purpose system that recursively improves its own search and evaluation process |
| OpenAI self-improvement evaluations | Public assessment of models on AI research and engineering tasks | Autonomous self-modification by a deployed agent |

# Reading list

- [Letta Code](https://github.com/letta-ai/letta-code) and its [memory documentation](https://docs.letta.com/letta-code/memory)
- [ACE implementation](https://github.com/ace-agent/ace) and [ICLR 2026 paper](https://arxiv.org/abs/2510.04618)
- [Google Research RRSI](https://github.com/google-research/rrsi) and [project page](https://regularized-rsi.com/)
- [Darwin Gödel Machine](https://github.com/jennyzzt/dgm) and [Sakana AI write-up](https://sakana.ai/dgm/)
- [The AI Scientist](https://sakana.ai/ai-scientist/)
- [AlphaEvolve](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)
- [Trustworthy RSI survey](https://arxiv.org/abs/2610.35193)

Related: [Recursive Self-Improvement](../concepts/recursive-self-improvement.md), [Memory Dreaming](../concepts/memory-dreaming.md), [Context Management](../concepts/context-management.md), and [Personal Intelligence](../concepts/personal-intelligence.md).

[^letta-code-readme]: [Letta Code, README and feature overview](https://github.com/letta-ai/letta-code).
[^letta-code-memory-prompt]: [Letta Code, agent memory and self-evolution instructions](https://github.com/letta-ai/letta-code/blob/main/src/agent/prompts/letta_root_memfs.md).
[^ace-repo]: [ACE, official implementation](https://github.com/ace-agent/ace).
[^rrsi-repo]: [Google Research, RRSI implementation](https://github.com/google-research/rrsi).
[^rrsi-project]: [RRSI project page](https://regularized-rsi.com/).
[^dgm-repo]: [Darwin Gödel Machine, official implementation](https://github.com/jennyzzt/dgm).
[^dgm-blog]: [Sakana AI, The Darwin Gödel Machine](https://sakana.ai/dgm/).
[^ai-scientist]: [Sakana AI, The AI Scientist](https://sakana.ai/ai-scientist/).
[^alphaevolve]: [Google DeepMind, AlphaEvolve](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/).
[^openai-self-improvement-eval]: [OpenAI Deployment Safety Hub, Evaluations used to assess high AI self-improvement capabilities](https://deploymentsafety.openai.com/gpt-6-2-astra-sol/evaluations-used-to-assess-high-ai-self-improvement-capabilities).
[^anthropic-rsi-analysis]: [Anthropic Institute, When AI Builds Itself](https://www.anthropic.com/institute/recursive-self-improvement).
[^trustworthy-rsi-survey]: [Pu et al., Trustworthy Recursive Self-Improvement in the Era of Large Models](https://arxiv.org/abs/2610.35193).
