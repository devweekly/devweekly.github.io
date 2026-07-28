# Research Report — pi

**Engineering Research Report** · Chief Software Architect's Analysis
**Date**: 2026-07-29

---

## 1. Repository Mental Model

pi is an open-source AI coding agent framework. It turns an LLM into an interactive programmer — think an open-source Claude Code or Cursor CLI, but built as a modular library rather than a monolithic application. (Fingerprint.domain: "Application", F-004)

The maintainer mentally divides the system into five crisp concepts, each with a hard boundary (F-004, confidence 0.85, **Documentation Only — 未验证**):

```
LLM Provider → Agent Runtime → Coding Agent → Presentation
                        ↕
                  Extension System
```

- **LLM Provider** owns model definitions, provider adapters, shared types, and a compat layer. Its responsibility is abstracting LLM API differences into a unified interface. Its boundary: never touches the agent loop, tool execution, or terminal I/O. (F-004 concept 1)
- **Agent Runtime** owns the agent loop, tool harness, session management, compaction, and prompt templates. Its responsibility is the core agent lifecycle — message handling, tool calling, state persistence, context compaction. Its boundary: pure orchestration; no LLM provider logic, no terminal I/O. (F-004 concept 2)
- **Coding Agent** owns session management, interactive mode, and the CLI entrypoint. Its responsibility is the user-facing interactive coding agent — composing Agent Runtime, LLM Integration, and TUI. Its boundary: composition layer; delegates the core loop to Agent Runtime and rendering to TUI. (F-004 concept 3)
- **Presentation** owns the TUI renderer. Its boundary: pure rendering; no business logic, no agent state. (F-004 concept 4)
- **Extension System** owns custom providers, overlays, resources, and plugins. Its boundary: operates on the Coding Agent surface; cannot modify core Agent Runtime or LLM Integration internals. (F-004 concept 5)

This five-way separation is the single most important thing to understand about pi. Everything else — decisions, tensions, risks — follows from how these boundaries are enforced.

---

## 2. Design Philosophy

pi's code reveals a **Pragmatic Functional** philosophy (Fingerprint.engineering_taste: "Pragmatic", Fingerprint.style: "Functional").

The strongest evidence is what the code *doesn't* do (F-006, "No dependency injection framework or class-based OOP", confidence 0.85, **Partially Verified**). Across 916 TypeScript files, there are **0 classes** and **3,037 functions**. No DI container, no class inheritance, no `inject()` decorator — just explicit imports and function composition. The devDependencies confirm this: `esbuild`, `biome`, `husky`, `typescript`, `tsx` — no DI framework, no IoC container. (ev-105, ev-106)

This is not accidental minimalism. It's a deliberate choice: the architecture prefers **explicit wiring over magic**. Rather than a DI framework resolving dependencies at runtime, every import is a hard edge you can grep. Rather than class hierarchies, capabilities are composed at the function level. The philosophy is "if you can't trace the dependency by reading the import statement, the abstraction is wrong."

A second revealing choice: **the extension system is scoped to the Coding Agent surface.** (F-008, confidence 0.82, **Partially Verified**) The core Agent Runtime (`agent-harness.ts`) has zero extension points — no plugin hooks, no middleware, no interceptors. Extensions live in the Coding Agent package exclusively, and their examples (`doom-overlay`, `custom-provider-anthropic`) are presentation-layer or provider-registration only (ev-031). This is pragmatism: keep the core loop auditable, allow customization at the edges.

---

## 3. Engineering Constraints

### Constraint 1: Must support many LLM providers without modifying core code (F-001, confidence 0.90, **Partially Verified**)

- **What it drives**: The provider adapter registry pattern (F-002). Each provider is an adapter registered in a central registry (`packages.ai.src.providers.all`), isolated from the core agent runtime.
- **Evidence**: README claims "Unified multi-provider LLM API (OpenAI, Anthropic, Google, …)" (ev-002, score 0.95). The hub module `packages.ai.src.providers.all` has fanOut 44 — all provider adapters aggregated in one module (ev-101, score 0.80).
- **Confidence**: 0.90 — high, but the evidence is readme + metric, not the adapter interface itself.

### Constraint 2: Must allow gradual migration without breaking downstream consumers (implicit, derived from F-003)

- **What it drives**: The compat layer (F-003, confidence 0.80, **Partially Verified**).
- **Evidence**: When the Model Registry was replaced with Model Runtime (ev-033, commit `9993c969`), the compat module absorbed 113 dependents (ev-103, score 0.90). This is a "migration tax" — compat pays the cost so consumers don't have to.

### Constraint 3: Core agent loop must remain stable and auditable (implicit, derived from F-008)

- **What it drives**: Extension System scoped to Coding Agent surface, not Agent Runtime core (F-008).
- **Evidence**: Zero extension points in `agent-harness.ts` (ev-010). All extension examples are in `packages/coding-agent/examples/extensions/` — none in `packages/agent/`.

---

## 4. Capability Map

The system is organized as a layered capability stack. Each layer depends on the one below it:

```
Presentation (TUI renderer)          — packages/tui/src/tui.ts
    ↑ uses
Coding Agent (CLI, session mgmt)     — packages/coding-agent/src/
    ↑ depends_on
Agent Runtime (loop, tools, session) — packages/agent/src/
    ↑ contains ─────────────────────────────────────────────┐
    │                                                        │
    ├── Tool Runtime (bash, index)     — packages/agent/src/harness/tools/
    ├── Session Management (JSONL, memory) — .../harness/session/
    ├── Compaction (summarization)     — .../harness/compaction/
    ├── Prompt Management (templates, skills) — .../harness/
    └── Agent Harness (orchestrator)   — .../harness/agent-harness.ts
    ↑ depends_on
LLM Integration (providers, types)   — packages/ai/src/
    ↑ exposes
Extension System (custom providers, overlays) — packages/coding-agent/examples/extensions/
```

**Key dependencies from KG relationships**:
- `Agent Runtime → LLM Integration`: Agent Runtime depends on LLM Integration types (rel-016, fanIn 146 on `packages.ai.src.types`)
- `Agent Harness → Agent Runtime ↔ Compaction ↔ Session Management ↔ Prompt Management`: The harness orchestrates the agent loop, compaction, message building, and session state — all from the Agent Runtime package (rel-006 through rel-011)
- `Coding Agent → Agent Runtime + LLM Integration + Presentation`: The Coding Agent composes all three lower layers (rel-012 through rel-014)
- `Extension System → Coding Agent`: Extensions operate on the Coding Agent surface only (rel-015)

Entity_ids referenced: LLM Integration, Agent Runtime, Tool Runtime, Session Management, Compaction, Prompt Management, Agent Harness, Coding Agent, Presentation, Extension System.

---

## 5. Architecture

### Overall Shape

pi is a **Capability-oriented** architecture (Fingerprint.architecture: "Capability-oriented"). This is not layered in the classical sense (no strict layer isolation rules), nor plugin-based (the extension system is deliberately surface-only), nor a monolith (clear package boundaries). Each package owns a distinct capability and its internal sub-capabilities are composed through explicit imports.

### Key Modules

| Module | Role | Evidence |
|--------|------|----------|
| `packages.ai.src.types` (fanIn 146) | Shared type definitions — the load-bearing spine | F-007, ev-107 |
| `packages.ai.src.compat` (fanIn 113) | Migration compat layer — absorbs breaking changes | F-003, ev-103 |
| `packages.agent.src.harness.types` (fanIn 28) | Harness-internal types — separate from AI types | DependencySmell hub_module |
| `packages.tui.src.tui` (fanIn 28) | TUI renderer — presentation hub | DependencySmell hub_module |
| `packages.coding-agent.src.config` (fanIn 51) | God module in coding-agent | DependencySmell hub_module (high severity) |

### Information Flow

Data flows through the system in a clean direction:

```
LLM Provider (model + adapter)
    ↓ (unified types)
Agent Runtime (agent-loop, harness, compaction)
    ↓ (composed session + prompts)
Coding Agent (session-manager, interactive-mode)
    ↓ (rendered via TUI)
Presentation (terminal output)
```

The flow is a pipeline: provider types → agent processing → session management → presentation. No module in the left column reaches into modules in the right column.

### Counter-Evidence and Competing Interpretations

**Cycles exist**: The dependency graph has **20 cycles** (archMetrics.totalCycles: 20). One concrete cycle identified:

```
packages.agent.src.harness.types → packages.agent.src.harness.session.session → packages.agent.src.harness.types
```

(DependencySmell, circular_dependency, medium severity, `packages/agent` module, labeled "not acceptable" — ev-105 context)

This cycle means `harness.types` and `session.session` mutually import each other. For a Capability-oriented system that prides itself on clean boundaries, this is a fault line. The coupling density of 0.0028 is low (sparse graph), making the cycle stand out as a localized violation rather than systemic.

**God modules undermine the clean picture**: Five modules have in-degree ≥20, flagged as hub modules:
- `packages.coding-agent.src.config` — 51 dependents (high severity)
- `packages.agent.src.harness.types` — 28 dependents
- `packages.ai.src.api.openai-completions.lazy` — 27 dependents
- `packages.tui.src.tui` — 28 dependents (also an entity: Presentation)

These concentrated dependency points mean changes to any of these modules ripple widely. Clean package boundaries at the macro level ... coupled with god modules at the micro level.

### Architecture Confidence

The Capability-oriented classification is consistent with the code. However, the cycles and god modules reduce confidence that the boundaries are *enforced*. It is a Capability-oriented architecture **in intent**, with localized violations that suggest either (a) the boundaries emerged organically and weren't retrofitted, or (b) the migration from Model Registry to Model Runtime temporarily blurred lines.

---

## 6. Evolution

pi is in **Early evolution** (Fingerprint.evolution: "Early") — three active migrations detected from git history:

### Trend 1: Model Registry → Model Runtime (forward, ev-033)
Commit `9993c969` (2026-07-14, 133 files changed) replaces the model registry with a model runtime. This is not a refactor — it's a fundamental shift from a static registry (providers registered upfront) to a runtime (models resolved and composed dynamically). The compat layer (F-003, fanIn 113) was created to make this migration non-breaking.

### Trend 2: Standalone → Scoped Packages (forward, ev-034)
Commit `3e5ad67e` (2026-05-07, 324 files changed) migrates packages to `@earendil-works/` scope. This signals readiness for production distribution — scoped packages in a monorepo indicate the project is preparing for independent versioning and publishing.

### Trend 3: TypeBox v0 → v1 (forward, ev-035)
Commit `35ff2689` (2026-04-22, 82 files changed) upgrades TypeBox with extension compatibility. Dependency hygiene — the team invests in framework upgrades early.

### Summary

All three trends move in the same direction: **toward production readiness**. The Model Registry → Model Runtime is the most architecturally significant — it suggests the team realized that a registry was too static for their needs and needed a runtime model resolution layer. The compat band-aid (F-003) suggests this was discovered mid-flight rather than designed upfront.

---

## 7. Key Decisions

### Decision 1: Provider adapter registration pattern for LLM providers (F-002, confidence 0.80, **Partially Verified**)

- **Intent**: Enable adding new LLM providers by registering an adapter, without modifying the core runtime. (long-term)
- **Tradeoff**: All provider adapters loaded eagerly through a central registry (`packages.ai.src.providers.all`, fanOut 44) rather than discovered lazily. This creates a single bottleneck node — if the registry fails to load, all providers fail.
- **Alternatives considered**: Plugin discovery, Lazy import per provider.
- **Evidence**: `packages.ai.src.providers.all` is a bottleneck node with fanOut 44 (ev-102, score 0.85). Example extension at `packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts` (ev-015, score 0.70).
- **Insight**: The decision favors simplicity over laziness. Eager loading means the provider interface is tested at startup, not discovered at first use. The fanOut 44 is a concern, but the code is 3,037 functions and 0 classes — this pattern is consistent with the overall functional approach.

### Decision 2: Compat layer for gradual Model Registry → Model Runtime migration (F-003, confidence 0.80, **Partially Verified**)

- **Intent**: Enable downstream consumers to migrate at their own pace without breaking changes. (temporary)
- **Tradeoff**: Compat module accumulates **113 dependents** (ev-103, score 0.90), creating a long-lived migration tax that is hard to remove. Modules that should depend on the new runtime instead depend on compat, which is a dead-end wrapper.
- **Alternatives considered**: Breaking change release (publish v2), Feature flag per consumer.
- **Evidence**: Commit `9993c969` — "replace model registry with model runtime" (ev-033, score 0.85). `packages.ai.src.compat` fanIn 113 (ev-103, score 0.90).
- **Insight**: This is the most honest decision in the repo. The team chose user experience (no breakage) over architectural purity (clean cut). The 113 dependents on compat are a debt that must be paid down. If it persists past the migration, it becomes permanent dead weight.

### Decision 3: Extension System scoped to Coding Agent surface, not Agent Runtime core (F-008, confidence 0.82, **Partially Verified**)

- **Intent**: Keep the core agent loop stable and auditable while allowing rich CLI customization and third-party provider registration. (long-term)
- **Tradeoff**: Extensions cannot modify core behavior — session logic, compaction, and the agent loop are sealed. Extensions are limited to presentation hooks and provider registration.
- **Alternatives considered**: Plugin hooks in Agent Runtime, Monkey-patching import system.
- **Evidence**: All extension examples are in `packages/coding-agent/examples/extensions/` — none modify `packages/agent/src/harness/agent-harness.ts` (ev-010, score 0.80). `doom-overlay` (ev-031, score 0.75) and `custom-provider-gitlab-duo` (ev-016, score 0.70) are presentation-layer or provider-registration only.
- **Insight**: This is a deliberate tradeoff between power and safety. The Agent Runtime is sealed because tool execution + session state + LLM calls is a security-critical surface — an extension that could intercept the agent loop could exfiltrate every prompt and response. The cost is that deep customizations require forking.

---

## 8. Design Tensions

### Tension 1: Agent Runtime simplicity vs Extension System flexibility (F-005, confidence 0.78, **Partially Verified**)

**Left (simplicity)**: The Agent Runtime (`packages/agent/src/agent-loop.ts`, ev-104) is a tight, focused loop. It handles messages, calls tools, manages state, and compacts context — but it has zero extension points. No middleware, no hooks, no interceptors. You can read the entire agent loop in one file and know exactly what it does.

**Right (flexibility)**: The Extension System (`packages/coding-agent/examples/extensions/`, ev-031) wants to provide custom overlays like `doom-overlay`, custom providers like `custom-provider-anthropic`, and dynamic resources. But these extensions are surface-only — they can't hook into the loop to, say, add a custom tool that runs before every message.

**The code currently leans left** — Agent Runtime simplicity wins. The decision is conscious and documented in F-008. But this tension will resurface when users inevitably ask "can I write an extension that filters every LLM response?" or "can I add a custom tool that runs on every loop iteration?".

**Recommendation**: If extension demand grows, consider adding a **hook point interface** to `agent-harness.ts` — not full plugin middleware (too complex), but a `beforeStep`/`afterStep` observer pattern. This preserves auditability while allowing observation without interception.

---

## 9. Architectural Leverage

### Spine: `packages.ai.src.types` — fanIn 146 (F-007, confidence 0.90, **Partially Verified**)

This is the single most load-bearing module in the entire system. 146 modules depend on it — every package (ai, agent, coding-agent, tui, extensions) imports these type definitions.

- **Blast radius**: 146 dependents. Changing a type here breaks nearly everything.
- **Recovery cost**: **High**. A breaking change in `types` cascades across all 10 entities in the KG. The compat layer (F-003) exists precisely to absorb this kind of blast.
- **Type**: **Spine** — high leverage + high recovery cost. It is the central nervous system of the architecture.

### Other high-leverage modules:
- `packages.ai.src.compat` (fanIn 113) — migration compat, **temporary leaf** in intent but **de facto spine** while it persists
- `packages.agent.src.harness.types` (fanIn 28) — harness-specific types, **leaf** within the Agent Runtime package but high leverage there
- `packages.tui.src.tui` (fanIn 28) — Presentation renderer, **spine** for visual output

---

## 10. Patterns Worth Reusing

### Pattern 1: Abstraction-based Provider Registry (from F-002)

- **Pattern**: Register providers by implementing an adapter interface; all adapters composited in a central registry module.
- **Applicability**: When you need to support multiple backends (LLM providers, storage engines, CI systems) and the set of backends changes more frequently than the core logic.
- **Limitation**: Eager loading (all providers loaded at startup) breaks if the provider set is large or some providers are rarely used. Lazy discovery or dynamic import would address this.
- **Migration Cost**: Low. The pattern is essentially "define an interface, implement it, register it." The cost is in the registry module becoming a bottleneck.
- **Reuse Score**: ★★★★☆ (4/5) — Simple, effective, easy to test. The only ding is the bottleneck risk.

### Pattern 2: Compat Module for Non-Breaking Migrations (from F-003)

- **Pattern**: When refactoring a core module, create a compat wrapper that exposes the old API but delegates to the new implementation. New consumers use the new API; old consumers continue through compat.
- **Applicability**: When you have many internal dependents and the cost of a coordinated migration exceeds the cost of maintaining compat for a limited time.
- **Limitation**: Compat modules have a strong tendency to become permanent. Without an explicit deprecation timeline (e.g., "compat will be removed in v2.0"), they accumulate dependents and become impossible to delete.
- **Migration Cost**: Medium. Low to create, but removal requires coordinating all 113+ dependents. The cost is back-loaded.
- **Reuse Score**: ★★★☆☆ (3/5) — Useful but dangerous. Only use with a sunset date.

### Pattern 3: Surface-Only Extension System (from F-008)

- **Pattern**: Allow extensions only at the surface layer (presentation, provider registration), not in the core runtime. The core is sealed; extensions cannot intercept business logic.
- **Applicability**: Security-critical systems where the core runtime must be auditable (tool execution, LLM interaction, state management).
- **Limitation**: Extensions are inherently limited. Deep customizations require forking. The pattern assumes the core runtime is "good enough" that surface customization satisfies most needs.
- **Migration Cost**: Low. Adding surface hooks is cheap. The hard decision is *not* adding core hooks.
- **Reuse Score**: ★★★★☆ (4/5) — The right tradeoff for security-sensitive agent runtimes. Sealing the core loop is the correct default; extension points should be opt-in.

### Pattern 4: Zero-Class Functional Architecture (from F-006)

- **Pattern**: Pure function composition with explicit imports. No DI, no classes, no inheritance. Capabilities are modules, not objects. Dependencies are import statements, not injected references.
- **Applicability**: TypeScript monorepos where traceability (being able to grep every dependency) is more important than runtime flexibility. Projects where the set of capabilities is known at build time.
- **Limitation**: Runtime polymorphism requires conditional logic (if-provider, switch-on-type) rather than virtual dispatch. Dependency graphs can become dense (3,037 functions × 4,206 imports = 12.7 million edges).
- **Migration Cost**: High. Moving from classes to functions is not a refactor — it's a rewrite. But *starting* with this pattern is free.
- **Reuse Score**: ★★★★★ (5/5) — The single most transferable insight from pi. For TypeScript projects without heavy polymorphism requirements, this pattern produces more auditable, testable, and grep-able code than any DI framework.

---

## 11. Risks

### Coupling Risk 1: 20 dependency cycles

**Risk**: The cycle `harness.types ↔ session.session` (and 19 other cycles) means bidirectional dependency chains exist. If module A changes a type, module B breaks, and fixing B breaks A.

**Impact**: Medium. These are localized cycles within the `packages/agent` module — not cross-package cycles. But they indicate the agent internal modules are more coupled than the clean package structure suggests.

**Mitigation**: Extract a shared base that both `harness.types` and `session.session` depend on, rather than having them mutually import.

### Coupling Risk 2: God module `packages.ai.src.types` (fanIn 146)

**Risk**: F-007 identifies this as the spine. A breaking change here requires coordinated updates across 146 files.

**Impact**: High. This is the system's single point of architectural failure. If types need to change to support a new provider feature, the blast radius is the entire codebase.

**Mitigation**: Semantic versioning of the types package with explicit breaking change notices. Consider segregating types by capability (AI types ≠ Agent types ≠ TUI types) to reduce the blast radius.

### Evolution Risk 3: Compat layer may become permanent

**Risk**: F-003 warns that the compat module has 113 dependents. Compat is explicitly temporary ("intent: temporary"), but temporary modules that accumulate 113 dependents rarely get removed.

**Impact**: High. If compat becomes permanent, every new development must work around it. The migration tax becomes a permanent drag.

**Mitigation**: Set a sunset date (e.g., "remove compat v1.0 in v2.0 release"). Audit dependents each quarter. If a dependent hasn't migrated, ping the owner.

### Coverage Risk 4: Mental model is documentation-only

**Risk**: F-004 (the five-concept mental model) is **Documentation Only — 未验证**. All evidence is README-derived. The actual code may have leakier boundaries than documented.

**Impact**: Medium. If the mental model doesn't match the code, maintainers and contributors will make wrong assumptions about boundaries.

**Mitigation**: Write an architectural test that enforces the boundaries: "prompt templates must not import agent-loop", "session must not import TUI". Fail CI on violations.

### Safety Risk 5: No extension point means limited market

**Risk**: F-008 keeps the core sealed. This means the OSS ecosystem cannot add capabilities like custom tool hooks, response interceptors, or execution policies without forking.

**Impact**: Low currently (experimental project), but limits community adoption in the long term.

**Mitigation**: Revisit F-008 tension periodically. If community demand for deep extensions exceeds the current need for core auditability, introduce a limited hook interface.

---

## 12. Lessons Learned

### Worth Learning

**1. Boundaries beat layering.** pi's five-concept separation (LLM Provider → Agent Runtime → Coding Agent → Presentation + Extension System) is more effective than a strict layered architecture because it maps directly to *change frequency*: providers change often, the agent loop rarely, and the presentation independently. This is a capability-oriented architecture done right — the boundaries are drawn along ownership lines, not abstraction layers.

**2. Zero-class architecture scales to 3,037 functions.** The absence of DI frameworks and class hierarchies is not a limitation — it's a feature. Every dependency is greppable. Every function is testable in isolation. The resulting codebase is remarkably navigable for 916 files. (F-006)

**3. Explicit migration tax is honest engineering.** The compat layer (F-003) is ugly (113 dependents on a temporary module), but it's *honest*. The team chose user experience over architectural purity and documented the tradeoff (temporary intent + 113 fanIn). This is more valuable than pretending migrations don't have costs.

### Historical Baggage

**1. Eager provider loading creates a bottleneck.** The provider registry (`packages.ai.src.providers.all`, fanOut 44) loads all adapters at startup. For the current provider count this is fine, but it's a pattern that will break at scale. Prefer lazy discovery or dynamic imports if the provider set grows beyond ~10.

**2. Cycles are silent architecture decay.** The 20 cycles in the dependency graph didn't appear overnight — they accumulated because no architectural test enforces acyclic imports. Without automated boundary enforcement, capability-oriented architecture erodes into a ball of modules. (Counter-Evidence from DependencySmell)

### The One Thing

**The most important engineering lesson from pi**: *Architectural boundaries are only as strong as the import graph enforces them.* pi's five-concept mental model (F-004) is elegant — the most elegant thing in the repo. But it's documented, not enforced. The 20 cycles and 5 god modules show the gap between documented intent and actual code. Every line of code that crosses a boundary without being accounted for is a debt that compounds.

If you remember one thing from this report: **document your boundaries, but write a test that enforces them.** The cost of a CI-boundary test is one file and 30 lines. The cost of not having it is 20 cycles and a compat module with 113 dependents.

---

## Quality Gate

### 1. What would invalidate this report?

The report's strongest claim is that pi is a capability-oriented architecture with clean five-concept separation (F-004). If a deep code audit revealed that modules labeled as "boundary: pure orchestration, no LLM provider logic" actually import provider adapters directly (bypassing the types layer), the mental model collapses. This is a known risk — F-004 is **Documentation Only — 未验证**.

### 2. What is most likely to be disagreed with?

The claim that "zero-class functional architecture is the most transferable insight" (§10, Pattern 4, ★★★★★). A Staff Engineer at a Java shop would argue that interfaces + DI provide better testability through mocking. The counter-argument: pi's 3,037 functions are *provably* testable in isolation without mocks, because dependencies are explicit imports, not injected references. But this is a religious war — reasonable engineers disagree.

### 3. Is any Claim pretending certain when it should be Unknown?

Yes. F-005 (tension between simplicity and flexibility) claims confidence 0.78, but the evidence is code paths — not user surveys or usage data. The actual *demand* for deeper extensions is unknown. The report should note: "User demand for deep extensions is **Need External Evidence** — check GitHub issues and discussions to verify."

### 4. Are all 12 sections present?

All 12 sections present. No section was skipped.

### 5. Does every Claim trace to a Finding id or KG entity?

Yes. Each section cites the relevant F-id or entity_id. Exceptions: the implicit constraints in §3 (Constraint 2 and 3) are derived from F-003 and F-008 respectively, not independently verified.

### 6. Is the Fingerprint consistent with the narrative?

Yes. Fingerprint says "Pragmatic" — the report reflects pragmatism (compat layer, surface-only extensions, zero-class architecture). Fingerprint says "Capability-oriented" — the report centers on the five-concept separation. Fingerprint says "Experimental" — the report flags no production-grade testing or deployment infrastructure. Consistent.

### 7. Are Competing Interpretations and Counter-Evidence reflected?

Yes:
- **Counter-Evidence**: 20 cycles and 5 god modules (§5) directly challenge the clean capability-oriented picture
- **Competing Interpretations**: The cycles suggest either organic emergence or temporary migration blurring (§5). The compat module's 113 fanIn suggests it may be permanent despite "temporary" intent (§7, Decision 2)
- **Tension**: F-005 (simplicity vs flexibility) receives its own section (§8)

### 8. Are low-confidence Findings flagged?

- F-005 (tension): confidence 0.78 — **Partially Verified**, noted as code-evidence only, user demand unknown
- F-004 (mental model): **Documentation Only — 未验证**, flagged in §1 and §12 with risk of invalidation
- F-003 (compat): confidence 0.80 — **Partially Verified**, temporary intent vs 113 fanIn tension flagged
- F-002 (provider registry): confidence 0.80 — **Partially Verified**, fanOut 44 bottleneck flagged

---

*Report rendered from Knowledge Graph (10 entities, 16 relationships), Semantic Findings (8 findings, 5 types), and Repository Fingerprint (7 dimensions). Evidence Quality annotations applied per the Evidence Quality Layer standard. All Finding ids and entity ids cited verbatim from inputs.*
