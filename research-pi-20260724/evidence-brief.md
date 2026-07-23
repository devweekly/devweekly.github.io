# Evidence Brief: pi-monorepo

> Generated: 2026-07-23 by research-repo skill (deterministic analysis).
> This brief is the **input** for LLM report generation — not the final report.
> The LLM should read this brief, then write `report.md` per the prompt in the last section.

## 1. Executive Brief

| Dimension | Value |
|-----------|-------|
| Repository | pi-monorepo |
| Manifest | package.json (javascript) |
| Version | 0.0.3 |
| Source files | 940 |
| Top languages | .ts (916), .md (89), .json (36), .mjs (21), (no ext) (17) |
| Top-level dirs | .github, .husky, .pi, packages, scripts |
| Commits | 5080 |
| Contributors | 287 |
| CI provider | github-actions |
| **Project stage** | mature (5080 commits, 287 contributors) |
| **Ecosystem** | JavaScript/Node ecosystem |

## 2. Architecture Insights

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Modules | 940 | — |
| Import edges | 2487 | edge/node ratio: 2.65 |
| Import cycles | 20 | ⚠ tight coupling detected |
| Functions | 3037 | 3.2 funcs/module |
| Classes | 0 | N/A |

**Coupling assessment**: edge/node ratio 2.65 → high — tightly coupled, changes ripple widely

**Import cycles** (potential design issues):
  - `packages.agent.src.harness.types → packages.agent.src.harness.session.session → packages.agent.src.harness.types`
  - `packages.coding-agent.src.modes.interactive.components.diff → packages.coding-agent.src.modes.interactive.components.diff`
  - `packages.ai.src.compat → packages.ai.src.api.anthropic-messages.lazy → packages.ai.src.types → packages.ai.src.api.anthropic-messages → packages.coding-agent.src.core.sdk → packages.ai.src.compat`
  - `packages.ai.src.compat → packages.ai.src.api.anthropic-messages.lazy → packages.ai.src.types → packages.ai.src.api.anthropic-messages → packages.coding-agent.src.core.sdk → packages.coding-agent.src.core.agent-session → packages.ai.src.compat`
  - `packages.coding-agent.src.core.bash-executor → packages.coding-agent.src.core.tools.bash → packages.coding-agent.src.core.extensions.types → packages.coding-agent.src.core.bash-executor`
  - ... and 15 more

**Most depended-upon modules** (high in-degree = core/foundation):
  - `packages.ai.src.types` (in-degree: 147)
  - `packages.ai.src.compat` (in-degree: 120)
  - `packages.coding-agent.src.modes.interactive.theme.theme` (in-degree: 83)
  - `packages.coding-agent.src.core.session-manager` (in-degree: 71)
  - `packages.ai.src.models` (in-degree: 61)
  - `packages.coding-agent.src.config` (in-degree: 51)
  - `packages.coding-agent.src.core.settings-manager` (in-degree: 49)
  - `packages.agent.src.harness.types` (in-degree: 39)
  - `packages.coding-agent.src.utils.json` (in-degree: 39)
  - `packages.ai.src.model-catalog` (in-degree: 37)

**Most influential modules** (high PageRank = architectural bottleneck):
  - `packages.ai.src.types` (PageRank: 0.0982)
  - `packages.coding-agent.src.utils.child-process` (PageRank: 0.0294)
  - `packages.coding-agent.src.config` (PageRank: 0.0228)
  - `packages.coding-agent.src.utils.paths` (PageRank: 0.0204)
  - `packages.ai.src.utils.event-stream` (PageRank: 0.0182)
  - `packages.coding-agent.src.modes.interactive.theme.theme` (PageRank: 0.0156)
  - `packages.ai.src.compat` (PageRank: 0.0150)
  - `packages.ai.src.auth.types` (PageRank: 0.0129)
  - `packages.ai.src.models` (PageRank: 0.0111)
  - `packages.ai.vitest.config` (PageRank: 0.0109)

**Entry points**: 82 total (tool: 52, cli: 29, sdk: 1)
  Sample entry points:
  - [tool] `packages/agent/src/harness/tools/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/agent/src/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/ai/src/cli.ts` — cli entrypoint file (deep/bundled)
  - [tool] `packages/ai/src/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/coding-agent/examples/extensions/doom-overlay/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/coding-agent/examples/extensions/dynamic-resources/index.ts` — package index entrypoint (deep/bundled)

## 3. AI / Agent Design

**Prompts**: 66 detected
  By type: prompt (33), system (24), assistant (1), template (7), few-shot (1)
  Sample prompts:
  - [prompt] `packages/agent/src/harness/agent-harness.ts:363` systemPrompt = "You are a helpful assistant."...
  - [prompt] `packages/agent/src/harness/compaction/branch-summarization.ts:173` BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use ...
  - [prompt] `packages/agent/src/harness/compaction/branch-summarization.ts:235` promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`...
  - [system] `packages/agent/src/harness/compaction/compaction.ts:446` SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a ...
  - [prompt] `packages/agent/src/harness/compaction/compaction.ts:450` SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summa...

**Tools**: 3 detected
  By framework: script-tool (3)
  Sample tools:
  - [script-tool] `index` — `packages/agent/src/harness/tools/index.ts`
  - [script-tool] `index` — `packages/agent/src/index.ts`
  - [script-tool] `index` — `packages/coding-agent/src/core/tools/index.ts`

**Design archetype** (derived):
  - Tools/Prompts ratio: 0.0 → prompt-heavy design (capabilities primarily instruction-driven)

## 4. Testing & Evaluation

**Testing**: 337 test files, 4359 test functions
  Test/source ratio: 0.36 → adequate coverage
  Test patterns detected: e2e, replay, corpus, regression
  Tests by module (top 5):
    - `editor`: 200 tests
    - `stream`: 183 tests
    - `package-manager`: 138 tests
    - `tools`: 112 tests
    - `prompt-templates`: 106 tests

**Evaluation**: Detected
  Eval files: 1
    - `scripts/profile-coding-agent-node.mjs`
  Metrics: metric, score, f1
  Patterns: evaluation, metric, benchmark, eval, score, dataset

## 5. Engineering Metrics

| Metric | Value |
|--------|-------|
| Modules (AST nodes) | 940 |
| Import edges | 2487 |
| Import cycles | 20 |
| Functions indexed | 3037 |
| Call relations | 76173 |
| Test files | 337 |
| Total commits | 5080 |
| Contributors | 287 |

**Derived indicators**:
  - Coupling density: 2.65 edges/module
  - Cycle count: 20 — ⚠ multiple cycles suggest architectural debt
  - Call density: 25.1 calls/function
  - Commit intensity: 18 commits/contributor
  - CI: github-actions with 10 workflow(s)

**Architecture signal directories** (high structural importance):
  - `.pi/prompts`
  - `packages/agent`
  - `packages/agent/docs`
  - `packages/agent/src`
  - `packages/agent/src/harness`
  - `packages/agent/src/harness/compaction`
  - `packages/agent/src/harness/session`
  - `packages/agent/src/harness/tools`
  - `packages/agent/src/harness/utils`
  - `packages/agent/test`

## 6. Reading Priority (Top Files)

Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):

| # | File | Score | Why |
|---|------|-------|-----|
| 1 | `README.md` | 90 | README (+50); important file (+40) |
| 2 | `packages/ai/src/compat.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 3 | `packages/ai/src/models.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 4 | `packages/ai/src/types.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 5 | `packages/coding-agent/src/config.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 6 | `packages/coding-agent/src/modes/interactive/theme/theme.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 7 | `packages/coding-agent/examples/README.md` | 80 | README (+50); examples (+30) |
| 8 | `packages/coding-agent/examples/extensions/README.md` | 80 | README (+50); examples (+30) |
| 9 | `packages/coding-agent/examples/extensions/doom-overlay/README.md` | 80 | README (+50); examples (+30) |
| 10 | `packages/coding-agent/examples/extensions/plan-mode/README.md` | 80 | README (+50); examples (+30) |
| 11 | `packages/coding-agent/examples/extensions/subagent/README.md` | 80 | README (+50); examples (+30) |
| 12 | `packages/coding-agent/examples/sdk/README.md` | 80 | README (+50); examples (+30) |
| 13 | `packages/coding-agent/examples/extensions/claude-rules.ts` | 60 | examples (+30); entrypoint (+30) |
| 14 | `packages/coding-agent/examples/extensions/commands.ts` | 60 | examples (+30); entrypoint (+30) |
| 15 | `packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts` | 60 | examples (+30); entrypoint (+30) |
| 16 | `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/index.ts` | 60 | examples (+30); entrypoint (+30) |
| 17 | `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/test.ts` | 60 | examples (+30); entrypoint (+30) |
| 18 | `packages/coding-agent/examples/extensions/doom-overlay/index.ts` | 60 | examples (+30); entrypoint (+30) |
| 19 | `packages/coding-agent/examples/extensions/dynamic-resources/index.ts` | 60 | examples (+30); entrypoint (+30) |
| 20 | `packages/coding-agent/examples/extensions/dynamic-tools.ts` | 60 | examples (+30); entrypoint (+30) |

**LLM guidance**: Read files in this order. The first 5-10 files typically reveal
the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.

## 7. Research Plan & Open Questions

### Hypotheses (from evidence)
- **✓ H1-purpose** (high): The repository purpose and target audience can be inferred from README and manifest
- **✓ H2-ai-agent** (high): This is an AI-agent / LLM-related project with prompts and/or tools
- **✓ H3-modular** (high): The codebase has a modular architecture with identifiable dependency layers
- **✓ H4-testing** (high): The project relies on automated tests for correctness
- **✓ H5-entrypoints** (high): Entry points reveal the primary interfaces (CLI, server, SDK)
- **✓ H6-evaluation** (high): The project measures quality through benchmarks or evaluations
- **✓ H7-maturity** (high): The project is actively maintained with a non-trivial development history

### Open Questions (from evidence gaps)
- [medium] **architecture**: How is responsibility divided among the top modules, and where are the dependency boundaries?
- [medium] **entrypoints**: What commands or APIs does the CLI/server expose?
- [medium] **prompts**: What role do system, assistant, and few-shot prompts play?
- [low] **prompts**: Are prompts statically defined or dynamically assembled?
- [low] **tools**: Are tools decorated, wrapped, or provided by a framework?
- [low] **architecture**: What design patterns or conventions explain the module organization?

---

## LLM Analysis Instructions

You are an experienced software architect. Based on the evidence above, write a comprehensive
engineering research report for **pi-monorepo**. Save it as `report.md` in the working folder.

### Report Structure

1. **Executive Summary** — What is this project? Why does it exist? What's the most interesting
   architectural decision? Who should study it?

2. **Architecture Overview** — Describe the module structure, dependency direction, layering,
   and execution flow. Use a Mermaid diagram for the core architecture. Explain WHY the
   architecture is designed this way, not just WHAT it is.

3. **AI/Agent Design** (if applicable) — Analyze the prompt system, tool framework, agent
   lifecycle, context engineering, and guardrails. What's the orchestration pattern?

4. **Engineering Tradeoffs** — For each major design decision: what was chosen, what was
   the alternative, why this choice? Focus on tradeoffs that are non-obvious.

5. **Reusable Patterns** — Patterns worth copying, patterns to avoid, interesting abstractions,
   and clever tricks. Be specific about WHERE each pattern lives (file:line).

6. **Testing & Evaluation** — How does the project verify correctness? What's the test
   strategy? Is there evaluation infrastructure? What gaps exist?

7. **Learning Checklist** — Top 10 concepts worth learning, top 10 files to read, top tests
   to study. Prioritize by insight density.

### Rules

- Every claim must cite evidence from this brief (section number, metric, or file path).
- Use High/Medium/Low confidence labels for major conclusions.
- Don't speculate without evidence — say "Unknown" if evidence is insufficient.
- Don't just restate the numbers — interpret what they MEAN for engineering decisions.
- Compare with similar projects when you have relevant knowledge.
- Focus on WHY, not WHAT. The evidence brief already says WHAT.

### Evidence Files for Deeper Investigation

The following JSON files contain full evidence (read them if you need more detail):
- `evidence-store/full.json` — complete analysis output
- `evidence-store/symbols.json` — function/class/import/call index
- `evidence-store/architecture.json` — dependency graph + centrality
- `evidence-store/interesting_files.json` — ranked file reading priority
