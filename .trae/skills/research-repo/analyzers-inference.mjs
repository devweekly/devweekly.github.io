import { sep } from "node:path";
import { isTestPath, pathToModuleId, git } from "./utils.mjs";
import { BaseAnalyzer } from "./base-analyzer.mjs";

// ===========================================================================
// Architecture Semantics Layer (2026-07)
//
// The analyzers above are Fact Extractors — they answer "what does the repo
// contain?" The seven analyzers below are Inference Engines — they answer
// "why is it designed this way? what responsibilities does it carry? what
// capabilities does it have? what are the architectural risks?"
//
// Dependency order (MUST be preserved in ANALYZERS array):
//   ArchitecturePattern → Responsibility → (Stability, ChangeCoupling,
//     InformationFlow, DependencySmell) → CapabilityOntology
// ===========================================================================

// --- Pattern signatures ---
// Each pattern has: name, dirSignals (match against dir names), required
// (min signals to match), symbolSignals (optional class/function name
// patterns), and optional graph validation flag.
const ARCHITECTURE_PATTERNS = [
  {
    name: "Hexagonal (Ports & Adapters)",
    dirSignals: ["domain", "application", "adapters", "adapter", "ports", "port"],
    required: 2,
    graphCheck: "layered_direction", // domain ↛ infrastructure
  },
  {
    name: "Clean Architecture",
    dirSignals: ["entities", "usecases", "use_cases", "interface", "interfaces", "frameworks", "infrastructure"],
    required: 2,
    graphCheck: "layered_direction",
  },
  {
    name: "Onion",
    dirSignals: ["core", "infrastructure", "application", "domain"],
    required: 2,
    graphCheck: "layered_direction",
  },
  {
    name: "Layered",
    // Strong signals = classic layered-architecture terms (presentation/business/
    // persistence/repository). Weak signals = generic dir names (ui/services/data)
    // that appear in many non-layered projects (UI toolkits, data pipelines,
    // Tauri apps with frontend/components/ui + backend/services).
    // To avoid false positives, require ≥1 strong signal + ≥1 other signal.
    // Pure weak-signal matches (e.g., ui + services + data scattered across
    // unrelated modules) are NOT enough — they appear in every modern web app.
    // Observed false positives:
    //   - topcoat: crates/*/src/ui + benchmarks/data (UI toolkit + bench data)
    //   - unsloth: studio/frontend/src/components/ui + studio/backend/hub/services
    //              + scripts/data (Tauri app + scripts)
    dirSignals: [
      "presentation", "business", "persistence", "repository", "repositories", // strong
      "ui", "services", "data", // weak
    ],
    required: 2,
    requiredSpecialized: 1,
    specializedSignals: ["presentation", "business", "persistence", "repository", "repositories"],
  },
  {
    name: "Pipeline",
    dirSignals: ["parser", "planner", "executor", "evaluator", "reporter", "stages", "pipeline", "pipelines"],
    required: 2,
    graphCheck: "linear_chain",
    // Specialized-signal gate: `pipeline/` or `pipelines/` alone is ambiguous —
    // it may be a business-domain directory (oil/gas pipelines, CI pipelines,
    // data pipelines as a product feature) rather than a software architecture
    // pattern. Require ≥1 specialized signal (parser/planner/executor/evaluator/
    // reporter/stages) to confirm the architecture pattern.
    // Observed false positive: worldmonitor's `pipeline/` dir refers to physical
    // oil/gas pipelines (PipelineStatusPanel, chokepoint monitoring), not a
    // software Pipeline architecture.
    requiredSpecialized: 1,
    specializedSignals: ["parser", "planner", "executor", "evaluator", "reporter", "stages"],
  },
  {
    name: "Plugin",
    dirSignals: ["plugins", "plugin", "registry", "extensions", "hooks", "addon", "addons"],
    required: 2,
    symbolSignals: [/\bregisterPlugin\b/, /\bloadPlugin\b/, /\bPluginRegistry\b/, /\bcreatePlugin\b/],
  },
  {
    name: "Event-Driven",
    dirSignals: ["events", "handlers", "bus", "dispatcher", "subscribers", "publishers", "listeners"],
    required: 2,
    symbolSignals: [/\bpublish\b/, /\bsubscribe\b/, /\bEventBus\b/, /\bemit\b/, /\bdispatch\b/],
    // Specialized-signal gate: pure symbol matches (publish/subscribe/emit) are
    // too weak — these verbs appear in many non-Event-Driven contexts:
    //   - Reactive programming libraries (@maverick-js/signals emits signal changes)
    //   - Rust async primitives (tokio::broadcast::subscribe)
    //   - Conformance/log tracers (emit() as trace recording)
    //   - Redis pub/sub as transport layer (not architectural Event-Driven)
    //   - SSE/session-scoped event buses (notification, not architecture)
    // Require ≥1 directory signal (events/ handlers/ bus/ dispatcher/ etc.) to
    // confirm the architectural pattern. Symbols alone may match observer
    // patterns, reactive primitives, or logging conventions.
    // Observed false positives: buzz (tokio::broadcast + conformance emit),
    // topcoat (@maverick-js/signals publish/subscribe), Vibe-Trading (session-
    // scoped EventBus for SSE), custodian-kernel (EventBus as side channel).
    requiredDirSignal: 1,
  },
  {
    name: "Actor Model",
    dirSignals: ["actors", "actor", "mailbox", "messages", "props"],
    required: 2,
    symbolSignals: [/\bActor\b/, /\bActorRef\b/, /\bMailbox\b/, /\btell\b/, /\bask\b/],
  },
  {
    name: "Workflow Engine",
    dirSignals: ["workflow", "workflows", "steps", "tasks", "engine", "dag"],
    required: 2,
    symbolSignals: [/\bWorkflow\b/, /\bStep\b/, /\bTask\b/, /\bDAG\b/],
  },
  {
    name: "Finite State Machine",
    dirSignals: ["states", "transitions", "state_machine", "fsm"],
    required: 1,
    symbolSignals: [/\bStateMachine\b/, /\bState\b/, /\bTransition\b/, /\bfsm\b/i],
  },
  {
    name: "Dataflow",
    dirSignals: ["sources", "transforms", "sinks", "streams", "operators"],
    required: 2,
  },
  {
    name: "Compiler",
    // parser/lexer/ast alone are too generic (SQL parsers, config parsers trigger
    // false positives). Require at least one compiler-specific signal (codegen,
    // optimizer, semantic analysis, IR generation) to confirm.
    dirSignals: ["lexer", "tokenizer", "parser", "ast", "codegen", "ir", "semantic", "optimizer"],
    required: 2,
    requiredSpecialized: 1, // must have ≥1 of: codegen, optimizer, semantic, ir
    specializedSignals: ["codegen", "optimizer", "semantic", "ir"],
    symbolSignals: [/\bToken\b/, /\bAST\b/, /\bparse\b/, /\blex\b/, /\bcodegen\b/, /\bIRGen\b/, /\boptimize\b/],
  },
  {
    name: "Blackboard",
    dirSignals: ["blackboard", "knowledge", "controllers"],
    required: 2,
  },
  {
    name: "Microservices",
    dirSignals: ["services", "service"],
    required: 1,
    multiInstanceCheck: true, // need ≥3 service dirs or shared/ + services/
  },
  {
    name: "Monorepo",
    dirSignals: ["packages", "apps", "libs", "modules"],
    required: 1,
    multiManifestCheck: true,
  },
];

// --- Responsibility signatures ---
// Maps module naming patterns to a Responsibility label and Capability tags.
// Used by ResponsibilityAnalyzer and CapabilityOntologyAnalyzer.
const RESPONSIBILITY_RULES = [
  { responsibility: "Task Planning", keywords: ["planner", "planning", "plan", "scheduler", "strategy", "orchestrat"], capabilities: ["planning"] },
  { responsibility: "Tool Execution", keywords: ["executor", "execute", "runner", "runtime", "action"], capabilities: ["execution"] },
  { responsibility: "Tool Registry", keywords: ["tool", "tools", "toolkit"], capabilities: ["tool"] },
  { responsibility: "Context & Memory", keywords: ["memory", "context", "state", "session", "history", "buffer"], capabilities: ["memory", "context"] },
  { responsibility: "Prompt Assembly", keywords: ["prompt", "template", "templating"], capabilities: ["prompt"] },
  { responsibility: "Quality Assessment", keywords: ["eval", "evaluation", "benchmark", "metric", "metrics", "judge"], capabilities: ["evaluation"] },
  { responsibility: "Retrieval", keywords: ["retriev", "rag", "search", "index", "embed"], capabilities: ["retrieval"] },
  { responsibility: "Safety & Guardrails", keywords: ["guard", "guardrail", "safety", "filter", "policy", "validate", "schema"], capabilities: ["safety"] },
  { responsibility: "LLM Interface", keywords: ["llm", "inference", "openai", "anthropic", "claude", "gemini", "mistral", "deepseek", "qwen", "bedrock", "vertex", "completion"], capabilities: ["execution"] },
  { responsibility: "I/O & Transport", keywords: ["api", "http", "transport", "server", "route", "router", "request"], capabilities: ["io"] },
  { responsibility: "Persistence", keywords: ["db", "database", "storage", "store", "persist", "repository", "cache"], capabilities: ["persistence"] },
  { responsibility: "Parsing", keywords: ["parser", "lexer", "tokenizer", "ast", "parse"], capabilities: ["parsing"] },
  { responsibility: "Agent Lifecycle", keywords: ["agent", "harness", "loop", "turn"], capabilities: ["execution", "context"] },
  { responsibility: "Configuration", keywords: ["config", "configuration", "settings"], capabilities: [] },
  { responsibility: "Developer Tooling", keywords: ["cli", "command", "cmd", "dev", "debug"], capabilities: [] },
];

/**
 * Tokenize a symbol name into lowercase tokens for keyword matching.
 * Splits on CamelCase boundaries, underscores, hyphens, and dots.
 * Examples:
 *   "resetCapabilitiesCache" → ["reset", "capabilities", "cache"]
 *   "CacheManager"           → ["cache", "manager"]
 *   "openai_chat"            → ["openai", "chat"]
 *   "HTTPServer"             → ["http", "server"]
 *   "couldBeEmoji"           → ["could", "be", "emoji"]
 *
 * This replaces the old s.toLowerCase().includes(kw) substring match that
 * caused false positives like "db" matching "couldBeEmoji" (couldBe → db).
 */
function tokenizeSymbol(name) {
  if (!name) return [];
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")   // camelCase → camel_Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2") // HTTPServer → HTTP_Server
    .split(/[_\-.\s]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/**
 * Check if a keyword matches any symbol via token-prefix matching.
 * A keyword matches if any token of the symbol STARTS WITH the keyword.
 * This supports intentional prefix keywords like "retriev" (matches
 * "retrieve", "retrieval") and "persist" (matches "persistence", "persistent").
 */
function symbolTokensMatchKw(kw, symbols) {
  const kwLower = kw.toLowerCase();
  return symbols.some((s) =>
    tokenizeSymbol(s).some((token) => token.startsWith(kwLower))
  );
}

// --- Fixed Capability Ontology ---
// The 10 capabilities every AI/Agent system can have. Used by
// CapabilityOntologyAnalyzer to assess maturity and find gaps.
const CAPABILITY_ONTOLOGY = [
  "planning",
  "execution",
  "retrieval",
  "memory",
  "evaluation",
  "safety",
  "tool",
  "context",
  "io",
  "persistence",
];

/**
 * ArchitecturePatternAnalyzer — infers the repo's architecture pattern from
 * directory layout + symbol names + import-graph shape.
 *
 * Rule-based (no LLM). Identifies Hexagonal/Clean/Onion/Layered/Pipeline/
 * Plugin/Event-Driven/Actor/Workflow/FSM/Dataflow/Compiler/Blackboard/
 * Microservices/Monorepo with confidence scores.
 */
class ArchitecturePatternAnalyzer extends BaseAnalyzer {
  get id() {
    return "archPattern";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const discovery = store.discovery || {};
    const arch = store.architecture || {};
    const symbols = store.symbols || {};

    // Candidate directory names: top-level + architecture signal dirs.
    const allDirs = new Set([
      ...(discovery.topLevelDirs || []),
      ...(discovery.architectureSignalDirs || []),
    ]);
    // Also scan one level deep (e.g., src/domain, packages/core).
    // Iterate ctx.dirs (directory entries) directly — iterating ctx.files and
    // taking parts[parts.length-1] would add the FILE BASENAME (e.g.,
    // "semantic-pr.yml"), which then matched `startsWith("semantic-")` and
    // triggered Compiler false positives on repos with a semantic-pr.yml
    // GitHub Actions workflow.
    //
    // Java Eclipse plugin packaging guard: skip directories whose path
    // contains segments with multiple dots (e.g., `plugins/org.jkiss.dbeaver.ui/`,
    // `features/org.eclipse.platform.feature/`). These are Java package names
    // materialized as directory names, NOT architectural layering signals.
    // Without this guard, dbeaver's `plugins/org.jkiss.dbeaver.ui/` and
    // `plugins/org.jkiss.dbeaver.data.repositories/` were misread as
    // `dir: ui/` and `dir: repositories/` — falsely triggering the Layered
    // pattern with confidence 0.70.
    const isJavaPackageSegment = (seg) =>
      typeof seg === "string" && (seg.split(".").length - 1) >= 2;
    for (const d of ctx.dirs) {
      const rel = ctx.rel(d.path);
      const parts = rel.split(sep);
      if (parts.length < 1) continue;
      if (parts[0] === "node_modules" || parts[0] === "vendor") continue;
      // Skip Java plugin packaging paths entirely (plugins/<dotted.name>/...).
      if (parts[0] === "plugins" || parts[0] === "features") {
        if (parts.length >= 2 && isJavaPackageSegment(parts[1])) continue;
      }
      // Skip any segment that looks like a Java package name (≥2 dots).
      if (parts.some(isJavaPackageSegment)) continue;
      // Add the immediate directory name (last path segment).
      allDirs.add(parts[parts.length - 1]);
      // Also add the second-level directory for src/<dir>/... layouts.
      if (parts.length >= 2 && parts[0] === "src") allDirs.add(parts[1]);
    }
    const dirNames = [...allDirs].map((d) => d.toLowerCase());

    // Symbol names for symbol-signal patterns.
    const symbolNames = [
      ...(symbols.classes || []).map((c) => c.name || ""),
      ...(symbols.functions || []).map((f) => f.name || ""),
    ];

    const matches = [];
    for (const pattern of ARCHITECTURE_PATTERNS) {
      // Exact segment match: require a directory segment to EQUAL the signal
      // (or start with `sig-`/`sig_`). Substring matching caused massive false
      // positives — e.g., "ast" matched "contrast", "ir" matched "first"/"directory",
      // which then satisfied the Compiler specialized-signal gate.
      const matchedDirs = pattern.dirSignals.filter((sig) =>
        dirNames.some(
          (d) => d === sig || d.startsWith(`${sig}-`) || d.startsWith(`${sig}_`)
        )
      );
      let matchedSymbols = [];
      if (pattern.symbolSignals) {
        matchedSymbols = pattern.symbolSignals
          .filter((re) => symbolNames.some((n) => re.test(n)))
          .map((re) => re.source);
      }

      const totalSignals = matchedDirs.length + matchedSymbols.length;
      if (totalSignals < pattern.required) continue;

      // Specialized-signal gate (e.g., Compiler requires ≥1 of codegen/optimizer/
      // semantic/ir to avoid false positives from SQL/config parsers).
      // Layered requires ≥1 classic term (presentation/business/persistence/
      // repository) — pure ui/services/data matches are too weak (every modern
      // web app has these).
      if (pattern.requiredSpecialized && pattern.specializedSignals) {
        const specializedHits = pattern.specializedSignals.filter((sig) =>
          matchedDirs.includes(sig)
        );
        if (specializedHits.length < pattern.requiredSpecialized) continue;
      }

      // Required-dir-signal gate (e.g., Event-Driven requires ≥1 dir signal,
      // pure symbol matches like publish/subscribe/emit are too weak).
      if (pattern.requiredDirSignal && matchedDirs.length < pattern.requiredDirSignal) {
        continue;
      }

      // Base confidence: 0.4 for meeting required, +0.15 per extra signal.
      let confidence = 0.4 + 0.15 * (totalSignals - pattern.required);

      // Multi-instance check (Microservices / Monorepo).
      if (pattern.multiInstanceCheck) {
        const serviceDirs = dirNames.filter((d) => d === "service" || d.endsWith("-service"));
        if (serviceDirs.length >= 3) confidence += 0.2;
        else if (serviceDirs.length < 2) continue; // require ≥2 service dirs
      }
      if (pattern.multiManifestCheck) {
        // Count manifests in subdirs (package.json, Cargo.toml, etc.)
        const manifestCount = (ctx.files || []).filter((f) =>
          ["package.json", "Cargo.toml", "pyproject.toml", "go.mod", "pom.xml"].includes(f.name)
        ).length;
        if (manifestCount >= 3) confidence += 0.2;
        else continue;
      }

      // Graph validation: check layer direction or linear chain.
      if (pattern.graphCheck === "layered_direction" && arch.edges) {
        // For Hexagonal/Clean/Onion: verify domain doesn't import infrastructure.
        const hasDomain = matchedDirs.includes("domain") || matchedDirs.includes("entities") || matchedDirs.includes("core");
        const hasInfra = matchedDirs.includes("infrastructure") || matchedDirs.includes("frameworks") || matchedDirs.includes("adapters");
        if (hasDomain && hasInfra) {
          // Sample edges — if any edge goes infra→domain, that's expected (dependency inversion).
          // If any edge goes domain→infra, that's a violation (but still confirms layered structure).
          const infraToDomain = arch.edges.some((e) => /infra|adapter|framework/i.test(e.from) && /domain|entit|core/i.test(e.to));
          if (infraToDomain) confidence += 0.1; // dependency inversion confirmed
        }
      }
      if (pattern.graphCheck === "linear_chain" && arch.edges) {
        // Pipeline: verify a linear chain exists among the matched dirs.
        // Check if there's a path parser→planner→executor→evaluator.
        const chain = matchedDirs;
        let chainConfirmed = false;
        for (let i = 0; i < chain.length - 1; i++) {
          const fromRe = new RegExp(chain[i], "i");
          const toRe = new RegExp(chain[i + 1], "i");
          if (arch.edges.some((e) => fromRe.test(e.from) && toRe.test(e.to))) {
            chainConfirmed = true;
            break;
          }
        }
        if (chainConfirmed) confidence += 0.15;
      }

      confidence = Math.min(confidence, 0.95);

      const evidence = [
        ...matchedDirs.map((d) => `dir: ${d}/`),
        ...matchedSymbols.map((s) => `symbol: ${s}`),
      ];
      matches.push({
        pattern: pattern.name,
        confidence: Number(confidence.toFixed(2)),
        evidence,
        matchedDirs,
        matchedSymbols,
      });
    }

    matches.sort((a, b) => b.confidence - a.confidence);
    const primaryPattern = matches.length > 0 ? matches[0].pattern : "Unknown";
    const allPatterns = matches.map((m) => m.pattern);

    store[this.id] = {
      primaryPattern,
      patterns: matches,
      allPatterns,
      unknown: matches.length === 0,
      _meta: {
        source: "keyword+graph",
        strength: "moderate",
        assumptions: [
          "Architecture patterns are signaled by directory names (segment match, not substring)",
          "Specialized signals gate high-stakes patterns (e.g., Compiler requires codegen/optimizer/semantic/ir)",
          "Graph validation (layered direction, linear chain) confirms pattern with +0.1-0.15 confidence",
          "Multi-instance checks (≥3 service dirs, ≥3 manifests) confirm Microservices/Monorepo",
        ],
        limitations: [
          "Cannot detect patterns with no directory-name signal (e.g., pattern implemented purely in code structure)",
          "Hexagonal/Clean/Onion patterns share dir signals (domain, adapters, infrastructure) and may be indistinguishable",
          "Compiler specialized-signal gate may still false-positive on repos with parser/interpreter subsets (e.g., template engines)",
          "Pattern detection is recall-oriented; precision depends on directory naming conventions",
        ],
        possibleFalsePositives: [
          "Repos with 'core/' dir may trigger Hexagonal/Clean/Onion even when no layered architecture exists",
          "Repos with 'plugins/' dir may trigger Plugin pattern even if plugins/ contains unrelated code",
          "Repos with 'service/' suffix dirs may trigger Microservices with <3 instances (downgraded confidence)",
        ],
        checkedLocations: [
          "discovery.topLevelDirs + 1-level deep dirs",
          "discovery.architectureSignalDirs",
          "symbols.classes[].name + symbols.functions[].name (regex symbol signals)",
          "architecture.edges[] (graph validation)",
          "manifest files count (package.json/Cargo.toml/pyproject.toml/go.mod/pom.xml)",
        ],
        coverage: "Directory-driven pattern detection; misses code-only patterns",
      },
    };
  }
}

/**
 * ResponsibilityAnalyzer — maps each top-level module to a Responsibility
 * (e.g., planner/ → "Task Planning") based on naming + symbol content.
 *
 * Produces a Responsibility Matrix that's far more useful to architects than
 * "top PageRank modules".
 */
class ResponsibilityAnalyzer extends BaseAnalyzer {
  get id() {
    return "responsibility";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const discovery = store.discovery || {};
    const symbols = store.symbols || {};
    const arch = store.architecture || {};

    // Group files by top-level module (first path segment).
    // Test files are excluded so that test fixtures (e.g., tmp_db, test_cache)
    // don't pollute the module's responsibility classification. Previously,
    // the "tests" directory was tagged "Persistence" because test setup code
    // used database fixtures.
    const moduleFiles = new Map(); // moduleName → [{path, symbols}]
    for (const f of ctx.sourceFiles || ctx.files || []) {
      const rel = ctx.rel(f.path);
      if (isTestPath(rel)) continue;
      const parts = rel.split(sep);
      if (parts.length < 2) continue;
      // Use first 2 segments for monorepo (packages/foo) or 1 for flat (src).
      const mod = parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])
        ? `${parts[0]}/${parts[1]}`
        : parts[0];
      if (!moduleFiles.has(mod)) moduleFiles.set(mod, []);
      moduleFiles.get(mod).push(rel);
    }

    // Also group architecture nodes by module.
    const moduleEdges = new Map(); // moduleName → {out: Set, in: Set}
    for (const edge of arch.edges || []) {
      const fromMod = this._moduleOf(edge.from);
      const toMod = this._moduleOf(edge.to);
      if (fromMod === toMod) continue;
      if (!moduleEdges.has(fromMod)) moduleEdges.set(fromMod, { out: new Set(), in: new Set() });
      if (!moduleEdges.has(toMod)) moduleEdges.set(toMod, { out: new Set(), in: new Set() });
      moduleEdges.get(fromMod).out.add(toMod);
      moduleEdges.get(toMod).in.add(fromMod);
    }

    // Map file paths to symbols.
    const symbolsByFile = new Map();
    for (const cls of symbols.classes || []) {
      if (!cls.file) continue;
      if (!symbolsByFile.has(cls.file)) symbolsByFile.set(cls.file, []);
      symbolsByFile.get(cls.file).push(cls.name);
    }
    for (const fn of symbols.functions || []) {
      if (!fn.file) continue;
      if (!symbolsByFile.has(fn.file)) symbolsByFile.set(fn.file, []);
      symbolsByFile.get(fn.file).push(fn.name);
    }

    const responsibilities = [];
    const matrix = {};

    for (const [mod, files] of moduleFiles.entries()) {
      // Collect all symbol names in this module.
      const modSymbols = [];
      for (const file of files) {
        const syms = symbolsByFile.get(file) || [];
        modSymbols.push(...syms);
      }
      // Also include the module name itself for keyword matching.
      // Path-segment match: split module ID on dots/slashes and require a
      // segment to EQUAL the keyword (or start with `kw-`). This prevents
      // false matches like "db" inside "database" or "plan" inside "explainer".
      const modSegments = mod.toLowerCase().split(/[./\\]+/);
      const segmentMatchesKw = (kw) =>
        modSegments.some(
          (seg) => seg === kw || seg.startsWith(`${kw}-`) || seg.startsWith(`${kw}_`)
        );

      let bestRule = null;
      let bestScore = 0;
      let bestEvidence = [];
      for (const rule of RESPONSIBILITY_RULES) {
        const dirHits = rule.keywords.filter(segmentMatchesKw);
        // Use CamelCase token-prefix matching instead of substring match.
        // This prevents false positives like "db" matching "couldBeEmoji"
        // (couldBe → db) while still supporting prefix keywords like
        // "retriev" (matches token "retrieve", "retrieval").
        const symHits = rule.keywords.filter((kw) =>
          symbolTokensMatchKw(kw, modSymbols)
        );
        const score = dirHits.length * 2 + symHits.length;
        if (score > bestScore) {
          bestScore = score;
          bestRule = rule;
          bestEvidence = [
            ...dirHits.map((k) => `dir segment matches "${k}"`),
            ...symHits.slice(0, 3).map((k) => {
              const sym = modSymbols.find((s) =>
                tokenizeSymbol(s).some((t) => t.startsWith(k.toLowerCase()))
              );
              return `symbol: ${sym}`;
            }),
          ];
        }
      }

      // Require score ≥ 2: a single symbol match (score 1) is too weak to
      // classify a module. This prevents e.g., "resetCapabilitiesCache" alone
      // from tagging the entire tui/ module as "Persistence". One directory
      // match (score 2) or two symbol matches (score 2) are minimum evidence.
      if (bestRule && bestScore >= 2) {
        const confidence = Math.min(0.5 + bestScore * 0.1, 0.95);
        const edges = moduleEdges.get(mod) || { out: new Set(), in: new Set() };
        responsibilities.push({
          module: mod,
          responsibility: bestRule.responsibility,
          capabilities: bestRule.capabilities,
          confidence: Number(confidence.toFixed(2)),
          evidence: bestEvidence,
          fileCount: files.length,
          dependencies: {
            outgoing: [...edges.out].slice(0, 5),
            incoming: [...edges.in].slice(0, 5),
          },
        });
        matrix[mod] = bestRule.responsibility;
      } else {
        // Unmapped module — still record for completeness.
        responsibilities.push({
          module: mod,
          responsibility: "Uncategorized",
          capabilities: [],
          confidence: 0.0,
          evidence: [],
          fileCount: files.length,
          dependencies: { outgoing: [], incoming: [] },
        });
        matrix[mod] = "Uncategorized";
      }
    }

    // Sort by file count descending (most significant modules first).
    responsibilities.sort((a, b) => b.fileCount - a.fileCount);

    store[this.id] = {
      responsibilities,
      responsibilityMatrix: matrix,
      totalModules: responsibilities.length,
      mappedModules: responsibilities.filter((r) => r.responsibility !== "Uncategorized").length,
      _meta: {
        source: "keyword",
        strength: "moderate",
        assumptions: [
          "Module boundaries = first 1-2 path segments (packages/foo for monorepo, top dir for flat layout)",
          "Test files are excluded (isTestPath) so test fixtures don't pollute module classification",
          "One directory match (score 2) or two symbol matches (score 2) are minimum evidence; single symbol match (score 1) is too weak",
        ],
        limitations: [
          "Cannot detect responsibilities that span multiple modules (e.g., 'security' implemented across crypto/ + auth/)",
          "Keyword matching is segment/token-prefix; unconventional naming (e.g., 'dataRepo' for persistence) may be missed",
          "Modules with generic names (components/, utils/) often get Uncategorized or false-positive matches",
        ],
        possibleFalsePositives: [
          "Modules named 'search' or 'query' may be tagged Retrieval even when not RAG (e.g., DB search, file search)",
          "Modules named 'storage' may be tagged Persistence even for in-memory caches",
          "Symbol token-prefix 'persist' may match 'persistenceLayer' in non-DB contexts",
        ],
        checkedLocations: [
          "discovery.topLevelDirs + 1-level deep dirs",
          "symbols.functions[].name (CamelCase tokenized)",
          "symbols.classes[].name (CamelCase tokenized)",
          "architecture.edges[] (for module dependency context)",
        ],
        coverage: "100% of non-test source files grouped into modules",
      },
    };
  }

  _moduleOf(nodeId) {
    // Convert dotted module ID back to first path segment.
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
}

/**
 * StabilityAnalyzer — Robert C. Martin's A/I metrics at module level.
 *
 *   I (Instability) = Ce / (Ca + Ce)
 *   A (Abstractness) = (interfaces + abstract classes) / total classes
 *
 * Zone classification:
 *   I < 0.3 && A > 0.7  → Zone of Uselessness (over-abstract)
 *   I > 0.7 && A < 0.3  → Zone of Pain (concrete, hard to change)
 *   Near main sequence   → Sweet Spot
 */
class StabilityAnalyzer extends BaseAnalyzer {
  get id() {
    return "stability";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const arch = store.architecture || {};
    const symbols = store.symbols || {};
    const discovery = store.discovery || {};

    // Group nodes by top-level module.
    const moduleNodes = new Map(); // moduleName → Set<nodeId>
    for (const node of arch.nodes || []) {
      const mod = this._moduleOf(node.id);
      if (!moduleNodes.has(mod)) moduleNodes.set(mod, new Set());
      moduleNodes.get(mod).add(node.id);
    }

    // Count afferent (Ca) and efferent (Ce) couplings at module level.
    const ca = new Map(); // moduleName → Set<depends-on-module>
    const ce = new Map(); // moduleName → Set<depended-on-by-module>
    for (const edge of arch.edges || []) {
      const fromMod = this._moduleOf(edge.from);
      const toMod = this._moduleOf(edge.to);
      if (fromMod === toMod) continue;
      if (!ce.has(fromMod)) ce.set(fromMod, new Set());
      ce.get(fromMod).add(toMod);
      if (!ca.has(toMod)) ca.set(toMod, new Set());
      ca.get(toMod).add(fromMod);
    }

    // Count abstracts (interfaces, abstract classes, protocols, traits) per module.
    const abstractsPerModule = new Map();
    const totalPerModule = new Map();
    for (const cls of symbols.classes || []) {
      const mod = cls.file ? this._moduleOf(pathToModuleId(cls.file)) : "unknown";
      totalPerModule.set(mod, (totalPerModule.get(mod) || 0) + 1);
      const name = cls.name || "";
      const isAbstract = /\b(Interface|Protocol|Trait|Mixin|Abstract|Base|ABC)\b/.test(name)
        || cls.modifiers?.includes?.("abstract")
        || cls.modifiers?.includes?.("protocol");
      if (isAbstract) {
        abstractsPerModule.set(mod, (abstractsPerModule.get(mod) || 0) + 1);
      }
    }

    const modules = [];
    for (const [mod, nodes] of moduleNodes.entries()) {
      const caVal = (ca.get(mod) || new Set()).size;
      const ceVal = (ce.get(mod) || new Set()).size;
      const total = caVal + ceVal;
      const instability = total > 0 ? ceVal / total : 0;
      const totalClasses = totalPerModule.get(mod) || 0;
      const abstractClasses = abstractsPerModule.get(mod) || 0;
      const abstractness = totalClasses > 0 ? abstractClasses / totalClasses : 0;

      let zone;
      if (total === 0) zone = "isolated";
      else if (instability < 0.3 && abstractness > 0.7) zone = "zone_of_uselessness";
      else if (instability > 0.7 && abstractness < 0.3) zone = "zone_of_pain";
      else if (Math.abs(instability + abstractness - 1) < 0.3) zone = "sweet_spot";
      else zone = "transitioning";

      modules.push({
        module: mod,
        ca: caVal,
        ce: ceVal,
        instability: Number(instability.toFixed(3)),
        abstractness: Number(abstractness.toFixed(3)),
        totalClasses,
        abstractClasses,
        zone,
        nodeCount: nodes.size,
      });
    }

    modules.sort((a, b) => (b.ca + b.ce) - (a.ca + a.ce));

    // Summary distribution for A-I graph.
    const zoneDistribution = {};
    for (const m of modules) {
      zoneDistribution[m.zone] = (zoneDistribution[m.zone] || 0) + 1;
    }

    store[this.id] = {
      modules,
      zoneDistribution,
      totalModules: modules.length,
      painModules: modules.filter((m) => m.zone === "zone_of_pain").slice(0, 5),
      uselessnessModules: modules.filter((m) => m.zone === "zone_of_uselessness").slice(0, 5),
    };
  }

  _moduleOf(nodeId) {
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
}

/**
 * ChangeCouplingAnalyzer — detects files that frequently change together in
 * git history, even without import dependencies.
 *
 * Re-runs `git log --name-only` (the raw data is NOT cached in GitAnalyzer
 * — only the count is). Produces coupled pairs with co-change ratio and
 * classifies them as structural (have import dep) or logical (no import dep
 * but change together — the high-value signal).
 */
class ChangeCouplingAnalyzer extends BaseAnalyzer {
  get id() {
    return "changeCoupling";
  }
  supports(ctx) {
    return !!ctx.repoPath;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const repoPath = ctx.repoPath;
    const arch = store.architecture || {};

    // Get the full file list per commit (top 200 commits to bound runtime).
    const logRaw = git(
      repoPath,
      "log",
      "--name-only",
      "--format=@@@%H",
      "-n",
      "200",
      "HEAD"
    );

    if (!logRaw || logRaw.trim().length === 0) {
      store[this.id] = { coupledPairs: [], totalCommitsAnalyzed: 0 };
      return;
    }

    const commits = logRaw.split(/@@@/).filter(Boolean);
    const pairCounts = new Map(); // "fileA|fileB" → count
    const fileCounts = new Map(); // file → commit count
    const totalCommits = commits.length;

    for (const block of commits) {
      const lines = block.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue;
      const files = lines.slice(1).filter((l) => l.trim().length > 0);
      // Count individual file frequencies.
      for (const f of files) {
        fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
      }
      // Count pairs (only if commit touches ≤ 30 files — larger commits are
      // usually merges/refactors and pollute the signal).
      if (files.length > 30) continue;
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const a = files[i] < files[j] ? files[i] : files[j];
          const b = files[i] < files[j] ? files[j] : files[i];
          const key = `${a}|${b}`;
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    }

    // Build a set of import edges for structural-dependency classification.
    const edgeSet = new Set();
    for (const edge of arch.edges || []) {
      edgeSet.add(`${edge.from}|${edge.to}`);
      edgeSet.add(`${edge.to}|${edge.from}`);
    }
    // Also check file-path co-occurrence (same directory = likely related).
    const sameDir = (a, b) => {
      const dirA = a.split(sep).slice(0, -1).join(sep);
      const dirB = b.split(sep).slice(0, -1).join(sep);
      return dirA === dirB;
    };

    // Filter pairs: co-change count ≥ 3 (statistical significance).
    const coupledPairs = [];
    for (const [key, count] of pairCounts.entries()) {
      if (count < 3) continue;
      const [fileA, fileB] = key.split("|");
      const ratioA = fileCounts.get(fileA) > 0 ? count / fileCounts.get(fileA) : 0;
      const ratioB = fileCounts.get(fileB) > 0 ? count / fileCounts.get(fileB) : 0;
      const coChangeRatio = (ratioA + ratioB) / 2;
      const idA = pathToModuleId(fileA);
      const idB = pathToModuleId(fileB);
      const hasStructuralDep = edgeSet.has(`${idA}|${idB}`);
      coupledPairs.push({
        files: [fileA, fileB],
        coChangeCount: count,
        coChangeRatio: Number(coChangeRatio.toFixed(2)),
        hasImportDep: hasStructuralDep,
        type: hasStructuralDep ? "structural" : "logical",
        sameDirectory: sameDir(fileA, fileB),
      });
    }

    coupledPairs.sort((a, b) => b.coChangeCount - a.coChangeCount);

    store[this.id] = {
      coupledPairs: coupledPairs.slice(0, 30),
      totalPairs: coupledPairs.length,
      logicalPairs: coupledPairs.filter((p) => p.type === "logical").length,
      totalCommitsAnalyzed: totalCommits,
    };
  }
}

/**
 * InformationFlowAnalyzer — infers end-to-end information flows by following
 * entrypoints → call graph → LLM call sites → output handlers.
 *
 * Produces labeled flows like:
 *   Request → Planner → Executor → LLM → Parser → Response
 */
class InformationFlowAnalyzer extends BaseAnalyzer {
  get id() {
    return "informationFlow";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const entrypoints = store.entrypoints || {};
    const symbols = store.symbols || {};
    const arch = store.architecture || {};
    const responsibility = store.responsibility || {};

    // Build adjacency list from architecture edges.
    const adj = new Map(); // nodeId → Set<targetId>
    for (const edge of arch.edges || []) {
      if (!adj.has(edge.from)) adj.set(edge.from, new Set());
      adj.get(edge.from).add(edge.to);
    }

    // Identify LLM call sites (functions/classes with LLM-related names).
    // Tightened to LLM-specific provider/model names only. Previously included
    // generic terms (generate, complete, chat, inference, vertex) that caused
    // false positives on non-AI repos:
    //   - UI libraries: "generate" matched color.generate, generate-site
    //   - IDE plugins: matched deployment ID functions
    //   - Design tools: "complete" matched autocomplete components
    // Removed terms: generate, complete, completion, chat, inference, vertex,
    //   call_model, invoke_model, ai_client, model_client
    // Kept: provider names (openai/anthropic/claude/gpt/gemini/mistral/deepseek/
    //   qwen/bedrock) + LLM-specific terms (llm, chat_completion).
    // LLM call site detection via symbol names.
    // Two patterns needed because \b word boundary doesn't work for camelCase:
    //   - `convertToLlm` has no \b before "Llm" (preceded by lowercase "o")
    //   - `llmContext` has no \b after "llm" (followed by uppercase "C")
    // Pattern 1: \b for snake_case/PascalCase boundaries (openai, anthropic, etc.)
    // Pattern 2: camelCase-aware — matches "Llm" after lowercase letter, or "llm"/"LLM"
    //            at non-letter boundary, with non-letter or end-of-string after
    const LLM_NAME_RE = /\b(?:openai|anthropic|claude|gpt|chat_completion|gemini|mistral|deepseek|qwen|bedrock)\b|(?:(?:^|[^a-zA-Z])llm|(?:^|[^a-zA-Z])LLM|[a-z]Llm)(?:[^a-zA-Z]|$)/i;
    const llmNodes = new Set();
    for (const fn of symbols.functions || []) {
      if (fn.name && LLM_NAME_RE.test(fn.name) && fn.file) {
        llmNodes.add(pathToModuleId(fn.file));
      }
    }
    for (const cls of symbols.classes || []) {
      if (cls.name && LLM_NAME_RE.test(cls.name) && cls.file) {
        llmNodes.add(pathToModuleId(cls.file));
      }
    }

    // Identify request entrypoints (cli/server type, source files only).
    // Filter out shell scripts and non-source files that pollute flow detection
    // (e.g., bin/activate-hermit from Hermit tooling was being detected as an entrypoint).
    const SOURCE_EXT_SET = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java"]);
    const requestEntries = (entrypoints.entrypoints || []).filter(
      (ep) =>
        (ep.type === "cli" || ep.type === "server") &&
        SOURCE_EXT_SET.has("." + (ep.path.split(".").pop() || ""))
    );

    // Build a responsibility lookup by module.
    const respByModule = new Map();
    for (const r of responsibility.responsibilities || []) {
      respByModule.set(r.module, r.responsibility);
    }

    // For each request entry, do a BFS (depth 10) and label each node with its
    // responsibility. Detect if the flow passes through an LLM node.
    // Increased from depth 6 to 10 to handle larger repos where LLM call sites
    // are deeper in the call graph (e.g., worldmonitor: entry → gateway → handler → ... → LLM).
    const flows = [];
    for (const entry of requestEntries.slice(0, 8)) {
      const startId = pathToModuleId(entry.path);
      const visited = new Set([startId]);
      const queue = [{ id: startId, depth: 0, path: [startId] }];
      let llmHit = null;
      let maxDepth = 0;

      while (queue.length > 0 && queue[0].depth < 10) {
        const { id, depth, path } = queue.shift();
        if (llmNodes.has(id) && !llmHit) {
          llmHit = { node: id, depth };
        }
        maxDepth = Math.max(maxDepth, depth);
        const neighbors = adj.get(id) || new Set();
        // Follow top 5 most-connected neighbors (raised from 3 to 5).
        // Rationale: LLM call sites may be in the 4th-5th neighbor's subgraph.
        // Limiting to 3 caused false negatives in repos with multiple LLM integration paths.
        const next = [...neighbors].slice(0, 5);
        for (const n of next) {
          if (visited.has(n)) continue;
          visited.add(n);
          queue.push({ id: n, depth: depth + 1, path: [...path, n] });
        }
      }

      // Build labeled steps from the longest path found.
      // For simplicity, use the entry's responsibility chain.
      const entryModule = this._moduleOf(startId);
      const steps = [
        { step: 1, module: entryModule, role: respByModule.get(entryModule) || "Entry Point", node: startId },
      ];

      // Walk the visited set and pick distinct responsibilities.
      const seenResponsibilities = new Set([steps[0].role]);
      for (const nodeId of visited) {
        const mod = this._moduleOf(nodeId);
        const role = respByModule.get(mod);
        if (role && !seenResponsibilities.has(role) && role !== "Uncategorized") {
          steps.push({
            step: steps.length + 1,
            module: mod,
            role,
            node: nodeId,
            isLLMCall: llmNodes.has(nodeId),
          });
          seenResponsibilities.add(role);
        }
        if (steps.length >= 7) break;
      }

      flows.push({
        name: `${entry.path} → ${llmHit ? "LLM" : "output"}`,
        entrypoint: entry.path,
        steps,
        reachesLLM: !!llmHit,
        llmNode: llmHit ? llmHit.node : null,
        confidence: Number((0.4 + steps.length * 0.08).toFixed(2)),
        coverage: steps.length >= 4 ? "complete" : steps.length >= 2 ? "partial" : "minimal",
      });
    }

    store[this.id] = {
      flows,
      totalFlows: flows.length,
      llmCallSites: [...llmNodes].slice(0, 10),
      reachesLLM: flows.some((f) => f.reachesLLM),
      _meta: {
        source: "regex+graph",
        strength: "weak",
        assumptions: [
          "LLM call sites are detected via regex on symbol names (LLM_NAME_RE: openai/anthropic/claude/gpt/llm/gemini/mistral/deepseek/qwen/bedrock/chat_completion)",
          "Entry points are CLI tools, tools, or HTTP handlers from EntrypointsAnalyzer",
          "Flow steps are matched by module responsibility (ResponsibilityAnalyzer)",
          "BFS from entry point reaches LLM call site → flow.reachesLLM=true",
        ],
        limitations: [
          "LLM_NAME_RE is recall-oriented; may false-positive on non-LLM symbols (e.g., 'palette_generator', 'completions' as variable name)",
          "Rust mod/use declarations are not resolved to full module paths → reachesLLM may be false-negative for Rust projects",
          "Java Eclipse extension-points (plugin.xml) are not parsed → AI subsystems in IDE plugins may be invisible to this analyzer",
          "BFS is bounded by graph connectivity; isolated LLM call sites with 0 in/out edges are never reached",
        ],
        possibleFalsePositives: [
          "Symbol names containing 'gpt'/'llm'/'completion' as substrings (e.g., 'Completions' type in UI libraries)",
          "Variables named 'openai'/'anthropic' that are not actual LLM clients",
          "Test fixtures with mock LLM clients",
        ],
        checkedLocations: [
          "symbols.functions[].name + symbols.classes[].name (regex LLM_NAME_RE)",
          "entrypoints.cli[] + entrypoints.tools[] + entrypoints.http[]",
          "architecture.edges[] (BFS traversal)",
          "responsibility.responsibilities[] (flow step labeling)",
        ],
        coverage: "Symbol-name regex; misses LLM calls via DI/registry/extension-point",
      },
    };
  }

  _moduleOf(nodeId) {
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
}

/**
 * DependencySmellAnalyzer — detects architectural smells in the dependency graph.
 *
 * Smell types:
 *   - layer_violation: module depends in the wrong direction (e.g., domain → infrastructure)
 *   - circular_dependency: cycles, classified by context (plugin registration = acceptable)
 *   - hub_module: in-degree > 20 (god module)
 *   - unstable_dependency: stable module depends on unstable module
 */
class DependencySmellAnalyzer extends BaseAnalyzer {
  get id() {
    return "dependencySmell";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const arch = store.architecture || {};
    const pattern = store.archPattern || {};
    const stability = store.stability || {};
    const responsibility = store.responsibility || {};

    const smells = [];

    // 1. Layer violations — depends on pattern.
    const primaryPattern = pattern.primaryPattern || "";
    const isLayered = /Hexagonal|Clean|Onion|Layered/.test(primaryPattern);
    if (isLayered) {
      // Define layer hierarchy: domain/core/entities (high) → application → infrastructure/adapters (low)
      const layerRank = (mod) => {
        const m = mod.toLowerCase();
        if (/domain|entit|core/.test(m)) return 3;
        if (/application|service/.test(m)) return 2;
        if (/infrastruct|adapter|framework|persistence|ui/.test(m)) return 1;
        return 0; // unknown
      };
      for (const edge of arch.edges || []) {
        const fromMod = this._moduleOf(edge.from);
        const toMod = this._moduleOf(edge.to);
        const fromRank = layerRank(fromMod);
        const toRank = layerRank(toMod);
        // Violation: high-rank layer depends on low-rank layer.
        if (fromRank > 0 && toRank > 0 && fromRank > toRank) {
          smells.push({
            type: "layer_violation",
            severity: fromRank - toRank >= 2 ? "high" : "medium",
            from: fromMod,
            to: toMod,
            fromLayer: this._layerName(fromRank),
            toLayer: this._layerName(toRank),
            rule: `${this._layerName(fromRank)} should not depend on ${this._layerName(toRank)} (${primaryPattern})`,
            evidence: `import edge: ${fromMod} → ${toMod}`,
          });
        }
      }
    }

    // 2. Circular dependencies — classify by context.
    const respByModule = new Map();
    for (const r of responsibility.responsibilities || []) {
      respByModule.set(r.module, r.responsibility);
    }
    for (const cycle of arch.cycles || []) {
      if (cycle.length < 3) continue; // skip 2-node cycles (often bidirectional plugins)
      const modules = [...new Set(cycle.map((n) => this._moduleOf(n)))];
      const responsibilities = modules.map((m) => respByModule.get(m) || "Unknown");
      // Plugin registration cycles are acceptable.
      const isPluginCycle = responsibilities.some((r) => /Plugin|Registry|Configuration/.test(r));
      // Business-logic cycles are bad.
      const isBusinessCycle = responsibilities.some((r) => /Planning|Execution|Persistence/.test(r));
      smells.push({
        type: "circular_dependency",
        severity: isPluginCycle ? "low" : isBusinessCycle ? "high" : "medium",
        cycle: cycle.slice(0, 6),
        modules,
        context: isPluginCycle ? "plugin_registration" : isBusinessCycle ? "business_logic" : "general",
        acceptable: isPluginCycle,
        rule: isPluginCycle
          ? "Circular deps in plugin registration are acceptable (registry ↔ plugin)"
          : "Circular deps in business logic indicate tight coupling",
      });
    }

    // 3. Hub modules (god module smell) — in-degree > 20.
    const inDegree = new Map();
    for (const edge of arch.edges || []) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }
    for (const [node, deg] of inDegree.entries()) {
      if (deg >= 20) {
        smells.push({
          type: "hub_module",
          severity: deg >= 40 ? "high" : "medium",
          module: this._moduleOf(node),
          node,
          inDegree: deg,
          rule: `Module with in-degree ${deg} (≥20) is a god module — too many dependents`,
        });
      }
    }

    // 4. Unstable dependency — stable module (I < 0.3) depends on unstable (I > 0.7).
    const stabilityByModule = new Map();
    for (const m of stability.modules || []) {
      stabilityByModule.set(m.module, m);
    }
    for (const edge of arch.edges || []) {
      const fromMod = this._moduleOf(edge.from);
      const toMod = this._moduleOf(edge.to);
      const fromStab = stabilityByModule.get(fromMod);
      const toStab = stabilityByModule.get(toMod);
      if (fromStab && toStab && fromStab.instability < 0.3 && toStab.instability > 0.7) {
        smells.push({
          type: "unstable_dependency",
          severity: "medium",
          from: fromMod,
          to: toMod,
          fromInstability: fromStab.instability,
          toInstability: toStab.instability,
          rule: "Stable module (I<0.3) should not depend on unstable module (I>0.7)",
        });
      }
    }

    // Deduplicate and sort.
    const seen = new Set();
    const deduped = smells.filter((s) => {
      const key = `${s.type}|${s.from || s.module || ""}|${s.to || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const severityRank = { high: 3, medium: 2, low: 1 };
    deduped.sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0));

    store[this.id] = {
      smells: deduped.slice(0, 30),
      totalSmells: deduped.length,
      byType: {
        layer_violation: deduped.filter((s) => s.type === "layer_violation").length,
        circular_dependency: deduped.filter((s) => s.type === "circular_dependency").length,
        hub_module: deduped.filter((s) => s.type === "hub_module").length,
        unstable_dependency: deduped.filter((s) => s.type === "unstable_dependency").length,
      },
      highSeverity: deduped.filter((s) => s.severity === "high").length,
    };
  }

  _moduleOf(nodeId) {
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
  _layerName(rank) {
    return rank === 3 ? "Domain" : rank === 2 ? "Application" : rank === 1 ? "Infrastructure" : "Unknown";
  }
}

/**
 * CapabilityOntologyAnalyzer — assesses the repo against a fixed 10-capability
 * ontology (Planning, Execution, Retrieval, Memory, Evaluation, Safety, Tool,
 * Context, I/O, Persistence).
 *
 * For each capability: maturity score, modules, evidence, coverage label.
 * Identifies missing capabilities (high-value for architects evaluating
 * whether a repo fits their use case).
 */
class CapabilityOntologyAnalyzer extends BaseAnalyzer {
  get id() {
    return "capabilityOntology";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const responsibility = store.responsibility || {};
    const tools = store.tools || {};
    const prompts = store.prompts || {};
    const evals = store.evaluations || {};
    const symbols = store.symbols || {};
    const infoFlow = store.informationFlow || {};

    // Detect MCP server archetype: repos that EXPOSE tools to AI clients via
    // MCP protocol (FastMCP, @mcp.tool decorators, McpServer class) but do NOT
    // themselves invoke LLMs. These are tool providers, not AI agents.
    // Distinction matters because:
    //   - OfficeCLI's McpServer.cs exposes 11 tools but doesn't call any LLM
    //   - pyod's mcp_server.py exposes 10 tools but the core library is
    //     outlier detection (statistics, not LLM)
    //   - unsloth's mcp_server.py exposes tools AND studio/backend calls LLMs
    //     → hybrid archetype (both provider and consumer)
    const mcpExposedTools = (tools.tools || []).filter((t) =>
      ["mcp-tool", "mcp-server-tool", "mcp-tuple"].includes(t.framework)
    );
    const hasMcpServerExposure = mcpExposedTools.length > 0;
    // Detect actual LLM client calls (not just symbol names). Symbol-name
    // matching (LLM_NAME_RE) is recall-oriented and matches any function/class
    // with "llm"/"openai" in its name. Real LLM consumers have actual SDK
    // call expressions OR HTTP calls to LLM API endpoints in source code.
    const llmClientCallPatterns = [
      // SDK method chains
      /\bopenai\s*\.\s*chat\s*\.\s*completions\s*\.\s*create\b/,
      /\banthropic\s*\.\s*messages\s*\.\s*create\b/,
      /\bclient\s*\.\s*chat\s*\.\s*completions\s*\.\s*create\b/,
      /\bclient\s*\.\s*messages\s*\.\s*create\b/,
      /\bchat\s*\.\s*completions\s*\.\s*create\b/,
      /\bcompletions\s*\.\s*create\b/,
      /\bChatCompletion\s*\.\s*create\b/,
      /\bvertexai\s*\.\s*GenerativeModel\b/,
      /\bbedrock\s*\.\s*invoke_model\b/,
      /\bllm\s*\.\s*generate\b/,
      /\bllm\s*\.\s*invoke\b/,
      /\bllm\s*\.\s*stream\b/,
      /\bllm\s*\.\s*predict\b/,
      /\bllm\s*\.\s*complete\b/,
      /\bgenerator\s*\.\s*send_completion_request\b/,
      /\bmodel\s*\.\s*generate_content\b/,
      // HTTP calls to LLM API endpoints (catches repos that call LLM APIs
      // via urllib/requests instead of the official SDK)
      /\bapi\.openai\.com\b/,
      /\bapi\.anthropic\.com\b/,
      /\bgenerativelanguage\.googleapis\.com\b/,
      /\bbedrock-runtime\.[a-z0-9-]+\.amazonaws\.com\b/,
    ];
    let llmClientCallCount = 0;
    let llmClientCallSample = null;
    const llmClientFiles = new Set();
    const codeExts = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cs", ".java", ".go", ".rs"]);
    const codeFiles = ctx.files.filter((f) => codeExts.has(f.ext) && !isTestPath(ctx.rel(f.path)));
    for (const f of codeFiles) {
      const content = ctx.readFileAbsolute(f.path);
      if (!content) continue;
      for (const pattern of llmClientCallPatterns) {
        if (pattern.test(content)) {
          llmClientCallCount++;
          llmClientFiles.add(ctx.rel(f.path));
          if (!llmClientCallSample) {
            const match = content.match(pattern);
            if (match) {
              llmClientCallSample = {
                file: ctx.rel(f.path),
                pattern: match[0],
              };
            }
          }
          break; // one match per file is enough
        }
      }
    }
    const hasRealLLMClientCalls = llmClientCallCount > 0;

    // AI-context gate: the 10 capability domains (Planning/Execution/Retrieval/
    // Memory/Evaluation/Safety/Tool/Context/IO/Persistence) are AI-agent-specific.
    // Applying them to non-AI repos (SQL clients, ML libraries, UI libraries,
    // styling tools) produces false positives:
    // SQL executors match "execution", database buffers match "memory",
    // HTTP routes match "io", etc.
    //
    // Gate: if the repo has NO tools, NO prompts, NO LLM call sites, and NO
    // "LLM Interface" responsibility, it is not an AI agent project. Report
    // all capabilities as "n/a" with a clear reason.
    //
    // Strengthened gate (2026-07-26): LLM call sites alone are insufficient.
    // A repo with only LLM utility functions (e.g., encoders, helpers) but no
    // tools or prompts is likely a library/SDK, not an AI agent. Require at
    // least one of: tools, prompts, OR (LLM call sites + LLM Interface responsibility).
    const hasTools = (tools.tools || []).length > 0;
    const hasPrompts = (prompts.prompts || []).length > 0;
    const hasLLMCallSites = (infoFlow.llmCallSites || []).length > 0;
    const hasLLMResponsibility = (responsibility.responsibilities || []).some(
      (r) => r.responsibility === "LLM Interface"
    );
    // New logic: tools OR prompts are strong signals. LLM call sites alone are weak.
    const isAIProject = hasTools || hasPrompts || (hasLLMCallSites && hasLLMResponsibility);

    // Determine archetype (consumes LLM vs exposes tools vs both vs neither).
    //   - "ai-agent": has real LLM client calls (consumes LLM)
    //   - "mcp-server": exposes MCP tools but doesn't consume LLM
    //   - "hybrid": both exposes MCP tools AND consumes LLM
    //   - "library": has LLM utilities (symbol names) but no client calls or MCP exposure
    //   - "non-ai": no AI signals
    let archetype;
    let archetypeReason;
    if (hasRealLLMClientCalls && hasMcpServerExposure) {
      archetype = "hybrid";
      archetypeReason = `Repo both exposes MCP tools (${mcpExposedTools.length} tools) and invokes LLM clients (${llmClientCallCount} call sites across ${llmClientFiles.size} files). It is both a tool provider and an LLM consumer.`;
    } else if (hasRealLLMClientCalls) {
      archetype = "ai-agent";
      archetypeReason = `Repo invokes LLM clients (${llmClientCallCount} call sites across ${llmClientFiles.size} files). It is an AI agent that consumes LLM services.`;
    } else if (hasMcpServerExposure) {
      archetype = "mcp-server";
      archetypeReason = `Repo exposes ${mcpExposedTools.length} MCP tools to AI clients but does NOT invoke LLM clients itself. It is a tool provider, not an AI agent. Detected via frameworks: ${[...new Set(mcpExposedTools.map((t) => t.framework))].join(", ")}.`;
    } else if (isAIProject) {
      archetype = "library";
      archetypeReason = `Repo has AI-related symbols (tools/prompts/LLM-named symbols) but no actual LLM client calls detected. Likely an AI-adjacent library or SDK.`;
    } else {
      archetype = "non-ai";
      archetypeReason = "No AI signals detected (no tools, prompts, LLM call sites, or LLM Interface responsibility).";
    }

    if (!isAIProject) {
      const capabilities = CAPABILITY_ONTOLOGY.map((cap) => ({
        capability: cap,
        maturity: 0,
        coverage: "n/a",
        moduleCount: 0,
        symbolCount: 0,
        modules: [],
        evidence: [],
      }));
      store[this.id] = {
        totalCapabilities: CAPABILITY_ONTOLOGY.length,
        coveredCapabilities: 0,
        capabilities,
        capabilityMatrix: Object.fromEntries(
          CAPABILITY_ONTOLOGY.map((c) => [c, "n/a"])
        ),
        missingCapabilities: [],
        strongCapabilities: [],
        weakCapabilities: [],
        isAIProject: false,
        archetype,
        archetypeReason,
        reason: "No AI signals detected (no tools, prompts, LLM call sites, or LLM Interface responsibility). Capability assessment is not applicable.",
      };
      return;
    }

    // Build capability → modules/evidence map from ResponsibilityAnalyzer output.
    const capabilityModules = new Map(); // capability → [{module, evidence, fileCount}]
    for (const r of responsibility.responsibilities || []) {
      for (const cap of r.capabilities) {
        if (!capabilityModules.has(cap)) capabilityModules.set(cap, []);
        capabilityModules.get(cap).push({
          module: r.module,
          evidence: r.evidence,
          fileCount: r.fileCount,
          confidence: r.confidence,
        });
      }
    }

    // Augment with direct signals:
    // - Tools → "tool" capability
    if ((tools.tools || []).length > 0) {
      if (!capabilityModules.has("tool")) capabilityModules.set("tool", []);
      capabilityModules.get("tool").push({
        module: "(tools analyzer)",
        evidence: [`detected ${tools.totalTools} tools`],
        fileCount: tools.totalTools,
        confidence: 0.9,
      });
    }
    // - Prompts → "context" capability (prompt assembly)
    if ((prompts.prompts || []).length > 0) {
      if (!capabilityModules.has("context")) capabilityModules.set("context", []);
      capabilityModules.get("context").push({
        module: "(prompts analyzer)",
        evidence: [`detected ${prompts.totalPrompts} prompts`],
        fileCount: prompts.totalPrompts,
        confidence: 0.85,
      });
    }
    // - Evaluations → "evaluation" capability
    if (evals.hasEvaluation || (evals.evalFiles || []).length > 0) {
      if (!capabilityModules.has("evaluation")) capabilityModules.set("evaluation", []);
      capabilityModules.get("evaluation").push({
        module: "(evaluations analyzer)",
        evidence: [`detected ${(evals.evalFiles || []).length} eval files`],
        fileCount: (evals.evalFiles || []).length,
        confidence: 0.9,
      });
    }

    // Count symbols per capability using CamelCase token-prefix matching.
    // Previously used `name.includes(kw)` substring match, which caused false
    // positives: "execut" matched "executeSQL", "run" matched "runQuery",
    // "store" matched "restoreData". Token matching: "executeSQL" → tokens
    // ["execute", "sql"], keyword "execut" matches token "execute" via prefix.
    //
    // Keywords are AI-context-specific: generic terms like "run", "call",
    // "save", "load", "http", "request", "response" were removed because they
    // match common software functions in any repo. The AI-context gate above
    // already ensures we only assess AI projects, but tightening keywords
    // further reduces noise within AI repos (e.g., a util function named
    // "httpGet" in an AI agent should NOT count as "io" capability by itself).
    const symbolCounts = new Map();
    const CAP_KEYWORDS = {
      planning: ["plan", "schedul", "decompos", "strateg", "orchestrat"],
      execution: ["execut", "invoke", "dispatch", "perform"],
      retrieval: ["retriev", "search", "rag", "embed", "index", "query"],
      memory: ["memory", "remember", "history", "retention"],
      evaluation: ["eval", "benchmark", "metric", "judge", "score", "assess"],
      safety: ["guard", "validate", "policy", "safety", "moderat", "redteam"],
      tool: ["tool", "function_call"],
      context: ["context", "prompt", "template", "instruction"],
      io: ["stream", "websocket", "sse", "pipe"],
      persistence: ["persist", "repository", "database", "kvstore"],
    };
    for (const fn of symbols.functions || []) {
      const tokens = tokenizeSymbol(fn.name || "");
      for (const [cap, keywords] of Object.entries(CAP_KEYWORDS)) {
        if (keywords.some((kw) => tokens.some((t) => t.startsWith(kw)))) {
          symbolCounts.set(cap, (symbolCounts.get(cap) || 0) + 1);
        }
      }
    }

    // Build capability assessment.
    const capabilities = [];
    for (const cap of CAPABILITY_ONTOLOGY) {
      const modules = capabilityModules.get(cap) || [];
      const symCount = symbolCounts.get(cap) || 0;
      const moduleCount = modules.length;
      const totalFiles = modules.reduce((s, m) => s + (m.fileCount || 0), 0);

      // Maturity: weighted combination of module count, symbol count, file count.
      let maturity = 0;
      maturity += Math.min(moduleCount * 0.2, 0.4);
      maturity += Math.min(symCount * 0.01, 0.3);
      maturity += Math.min(totalFiles * 0.005, 0.3);
      maturity = Math.min(maturity, 0.95);

      let coverage;
      if (maturity === 0) coverage = "missing";
      else if (maturity < 0.2) coverage = "weak";
      else if (maturity < 0.5) coverage = "moderate";
      else coverage = "strong";

      capabilities.push({
        capability: cap,
        maturity: Number(maturity.toFixed(2)),
        coverage,
        moduleCount,
        symbolCount: symCount,
        modules: modules.slice(0, 5).map((m) => m.module),
        evidence: modules.slice(0, 3).flatMap((m) => m.evidence || []),
      });
    }

    // Build matrix and summaries.
    const capabilityMatrix = {};
    for (const c of capabilities) capabilityMatrix[c.capability] = c.coverage;
    const missingCapabilities = capabilities.filter((c) => c.coverage === "missing").map((c) => c.capability);
    const strongCapabilities = capabilities.filter((c) => c.coverage === "strong").map((c) => c.capability);
    const weakCapabilities = capabilities.filter((c) => c.coverage === "weak").map((c) => c.capability);

    capabilities.sort((a, b) => b.maturity - a.maturity);

    store[this.id] = {
      capabilities,
      capabilityMatrix,
      missingCapabilities,
      strongCapabilities,
      weakCapabilities,
      totalCapabilities: CAPABILITY_ONTOLOGY.length,
      coveredCapabilities: CAPABILITY_ONTOLOGY.length - missingCapabilities.length,
      isAIProject: true,
      archetype,
      archetypeReason,
      mcpExposure: {
        exposedToolCount: mcpExposedTools.length,
        frameworks: [...new Set(mcpExposedTools.map((t) => t.framework))],
      },
      llmClientCalls: {
        count: llmClientCallCount,
        fileCount: llmClientFiles.size,
        sample: llmClientCallSample,
        files: [...llmClientFiles].slice(0, 5),
      },
      _meta: {
        source: "inference",
        strength: "moderate",
        assumptions: [
          "AI project gate: repo is AI-project iff it has tools OR prompts OR LLM call sites OR LLM-Interface responsibility",
          "Capability maturity = weighted(module count, symbol count, file count), capped at 0.95",
          "Capability keywords are AI-context-specific (generic terms like run/call/save/load removed)",
          "Non-AI repos get all capabilities 'n/a' (gate prevents false positives on UI/SQL/ML libraries)",
          `Archetype detection: scans source files for real LLM client call patterns (openai.chat.completions.create, anthropic.messages.create, etc.) to distinguish AI agents from MCP tool providers`,
        ],
        limitations: [
          "Maturity score is heuristic, not benchmarked against ground truth",
          "Cannot detect capabilities implemented via composition (e.g., 'planning' via tool calls alone)",
          "Symbol keyword matching may miss capabilities implemented via indirect patterns (e.g., dependency injection)",
          "AI-context gate may under-classify repos with implicit AI usage (no explicit prompts/tools/LLM symbols)",
          "LLM client call patterns are regex-based; may miss SDK calls wrapped in custom abstractions or DI frameworks",
          "MCP server archetype detection relies on ToolsAnalyzer framework labels; custom MCP implementations may be missed",
        ],
        possibleFalsePositives: [
          "Repos with 'agent' in name but no actual AI logic may pass the gate (e.g., cargo-agent)",
          "Capability keyword 'tool' matches any 'tool' symbol, including non-AI tooling",
          "EvaluationsAnalyzer false positives propagate (hasEvaluation=true from metric/score in type names)",
          "LLM client call regex may match commented-out code or string literals containing the pattern",
        ],
        checkedLocations: [
          "responsibility.responsibilities[].capabilities (cross-analyzer input)",
          "tools.tools[] (auto-adds 'tool' capability; framework field identifies MCP-exposed tools)",
          "prompts.prompts[] (auto-adds 'context' capability)",
          "evaluations.evalFiles[] + hasEvaluation (auto-adds 'evaluation' capability)",
          "symbols.functions[].name (tokenized for keyword matching)",
          "source files scanned for LLM client call patterns (openai/anthropic/vertexai/bedrock/llm.* method calls)",
        ],
        coverage: "All 10 capabilities assessed for AI projects; n/a for non-AI projects. Archetype field distinguishes ai-agent / mcp-server / hybrid / library / non-ai.",
      },
    };
  }
}

// ===========================================================================
// Architecture Knowledge Layer — Decision / Constraint / Assumption
//
// Promotes Evidence Store from "code facts" to "architecture knowledge".
// Three analyzers extract WHY the system is designed this way, not just WHAT
// it contains. Each produces ADR-like structured output that the LLM can cite
// directly in the report.
// ===========================================================================

/**
 * DecisionAnalyzer — extracts Architecture Decisions from analyzer outputs.
 *
 * A Decision is a deliberate design choice (not a fact). Examples:
 *   - "Planning and Execution are separated" (from Responsibility matrix)
 *   - "Tool-heavy design" (from Tools/Prompts ratio)
 *   - "Event-Driven architecture" (from ArchitecturePattern)
 *   - "Centralized LLM call sites" (from InformationFlow)
 *
 * Output schema per decision:
 *   { id, decision, category, evidence[], benefit, tradeoff, alternatives, confidence }
 */
class DecisionAnalyzer extends BaseAnalyzer {
  get id() { return "decisions"; }
  supports(_ctx) { return true; }

  async analyze(_ctx, store, _analyzerCtx) {
    const decisions = [];
    let counter = 0;
    const mkId = () => `D-${String(++counter).padStart(3, "0")}`;

    // D1: Architecture pattern decision
    const ap = store.archPattern || {};
    if (ap.primaryPattern && ap.primaryPattern !== "Unknown") {
      const patternMatch = (ap.patterns || []).find((p) => p.pattern === ap.primaryPattern);
      decisions.push({
        id: mkId(),
        decision: `Adopt ${ap.primaryPattern} architecture pattern`,
        category: "structural",
        evidence: (patternMatch?.evidence || []).slice(0, 3),
        benefit: this._patternBenefit(ap.primaryPattern),
        tradeoff: this._patternTradeoff(ap.primaryPattern),
        alternatives: this._patternAlternatives(ap.primaryPattern),
        confidence: Math.min(0.9, (patternMatch?.confidence || 0.4) + 0.3),
      });
    }

    // D2: Responsibility separation decision
    const resp = store.responsibility || {};
    const responsibilities = (resp.responsibilities || []).filter((r) => r.responsibility !== "Uncategorized");
    if (responsibilities.length >= 2) {
      const distinct = new Set(responsibilities.map((r) => r.responsibility));
      if (distinct.size >= 2) {
        decisions.push({
          id: mkId(),
          decision: `Separate concerns across ${responsibilities.length} modules (${[...distinct].slice(0, 3).join(" / ")})`,
          category: "modular",
          evidence: responsibilities.slice(0, 3).map((r) => `${r.module} → ${r.responsibility}`),
          benefit: "Independent evolution of concerns; team can specialize per module",
          tradeoff: "Higher integration complexity; cross-cutting concerns need explicit wiring",
          alternatives: "Single monolithic module with internal separation",
          confidence: 0.7,
        });
      }
    }

    // D3: Tool-heavy vs Prompt-heavy decision
    const tools = store.tools || {};
    const prompts = store.prompts || {};
    const toolCount = tools.totalTools || 0;
    const promptCount = prompts.totalPrompts || 0;
    if (toolCount > 0 || promptCount > 0) {
      if (toolCount > promptCount * 3) {
        decisions.push({
          id: mkId(),
          decision: `Tool-heavy design (${toolCount} tools vs ${promptCount} prompts, ratio ${(toolCount / Math.max(1, promptCount)).toFixed(1)})`,
          category: "capability",
          evidence: [`tools.totalTools=${toolCount}`, `prompts.totalPrompts=${promptCount}`],
          benefit: "Capabilities are explicit, testable, and composable; deterministic execution paths",
          tradeoff: "Tool registry maintenance overhead; less flexible than free-form LLM reasoning",
          alternatives: "Prompt-heavy design (fewer tools, more LLM autonomy)",
          confidence: 0.8,
        });
      } else if (promptCount > toolCount * 2) {
        decisions.push({
          id: mkId(),
          decision: `Prompt-heavy design (${promptCount} prompts vs ${toolCount} tools)`,
          category: "capability",
          evidence: [`prompts.totalPrompts=${promptCount}`, `tools.totalTools=${toolCount}`],
          benefit: "Flexible LLM reasoning; lower tool registry maintenance",
          tradeoff: "Less deterministic; harder to test; prompt drift risk",
          alternatives: "Tool-heavy design (more tools, less LLM autonomy)",
          confidence: 0.8,
        });
      }
    }

    // D4: LLM call site centralization decision
    const iflow = store.informationFlow || {};
    const llmCallSites = iflow.llmCallSites || [];
    if (llmCallSites.length > 0) {
      const files = new Set(llmCallSites.map((c) => c.file || c.location || ""));
      const centralized = files.size <= Math.max(2, Math.ceil(llmCallSites.length / 3));
      decisions.push({
        id: mkId(),
        decision: `${centralized ? "Centralize" : "Distribute"} LLM call sites across ${files.size} file(s) (${llmCallSites.length} total call sites)`,
        category: "integration",
        evidence: llmCallSites.slice(0, 3).map((c) => `${c.file || c.location}:${c.line || ""}`),
        benefit: centralized
          ? "Single point of LLM interaction; easy to audit, rate-limit, and mock"
          : "LLM calls co-located with consumers; lower latency, context-aware",
        tradeoff: centralized
          ? "Bottleneck risk; single point of failure for LLM interactions"
          : "Harder to audit; LLM behavior may vary across call sites",
        alternatives: centralized ? "Distribute call sites to consumers" : "Centralize via a gateway",
        confidence: 0.65,
      });
    }

    // D5: Test strategy decision
    const tests = store.tests || {};
    const testPatterns = tests.testPatterns || [];
    if (testPatterns.length > 0) {
      decisions.push({
        id: mkId(),
        decision: `Adopt multi-strategy testing: ${testPatterns.join(", ")}`,
        category: "quality",
        evidence: [`tests.testPatterns=[${testPatterns.join(", ")}]`, `tests.totalTestFiles=${tests.totalTestFiles || 0}`],
        benefit: "Coverage across correctness (corpus), robustness (poison/stress), and regression",
        tradeoff: "Test suite maintenance cost; longer CI runs",
        alternatives: "Single-strategy testing (e.g., only unit tests)",
        confidence: 0.75,
      });
    }

    // D6: Negative decisions — capabilities deliberately absent
    const cap = store.capabilityOntology || {};
    const matrix = cap.capabilityMatrix || {};
    const missing = Object.entries(matrix).filter(([, v]) => v === "missing" || v === "n/a").map(([k]) => k);
    if (cap.isAIProject === true && missing.length > 0) {
      decisions.push({
        id: mkId(),
        decision: `Deliberately omit ${missing.slice(0, 4).join(", ")} capability (not implemented despite AI context)`,
        category: "negative",
        evidence: [`capabilityOntology.capabilityMatrix: ${missing.map((m) => `${m}=${matrix[m]}`).join(", ")}`],
        benefit: this._negativeBenefit(missing),
        tradeoff: this._negativeTradeoff(missing),
        alternatives: "Implement the missing capabilities",
        confidence: 0.5,
      });
    }

    // Decision Record: inject problem/risk/reusability for ADR-style structure.
    // Each decision gets:
    //   problem    — WHY this decision was needed (the force it resolves)
    //   risk       — what could go wrong if this decision is followed
    //   reusability — 0-1 score: how transferable is this decision to other repos
    const finalizedDecisions = decisions.map((d) => this._finalizeDecision(d));

    store[this.id] = {
      decisions: finalizedDecisions,
      totalDecisions: finalizedDecisions.length,
      byCategory: this._groupByCategory(finalizedDecisions),
      _meta: {
        source: "inference",
        strength: "moderate",
        assumptions: [
          "Decisions are inferred from analyzer outputs, not from ADR docs or commit messages",
          "A 'decision' here means an observable design choice, not a documented rationale",
        ],
        limitations: [
          "Cannot access ADR (Architecture Decision Records) if they exist only in docs/",
          "Negative decisions (deliberate omissions) are inferred from absence, which may be a coverage gap",
        ],
        possibleFalsePositives: [
          "A missing capability may be under-development, not deliberately omitted",
          "Tool/prompt ratio may reflect project stage, not a deliberate design philosophy",
        ],
        checkedLocations: [
          "archPattern.primaryPattern",
          "responsibility.responsibilities[]",
          "tools.totalTools vs prompts.totalPrompts",
          "informationFlow.llmCallSites[]",
          "tests.testPatterns[]",
          "capabilityOntology.capabilityMatrix (for negative decisions)",
        ],
        coverage: "5 decision categories: structural / modular / capability / integration / quality / negative",
      },
    };
  }

  _patternBenefit(p) {
    const map = {
      "Event-Driven": "Loose coupling between producers and consumers; easy to add new event handlers",
      "Hexagonal": "Domain logic isolated from adapters; testable without external dependencies",
      "Pipeline": "Stages are independent and composable; easy to add new stages",
      "Plugin": "Extension without modification; third-party extensibility",
      "Microservices": "Independent deployment and scaling; technology diversity",
      "Layered": "Clear separation of concerns; easy to understand",
      "FSM": "Explicit state transitions; deterministic behavior",
    };
    return map[p] || "Pattern-specific structural benefits";
  }

  _patternTradeoff(p) {
    const map = {
      "Event-Driven": "Eventual consistency; harder to trace event flow; debugging complexity",
      "Hexagonal": "Higher abstraction overhead; more boilerplate for simple domains",
      "Pipeline": "Stage coordination overhead; harder to handle cross-cutting concerns",
      "Plugin": "Plugin API stability burden; versioning complexity",
      "Microservices": "Distributed system complexity; network failure modes; deployment overhead",
      "Layered": "Performance overhead from layering; rigid hierarchy",
      "FSM": "State explosion for complex domains; harder to model concurrent behavior",
    };
    return map[p] || "Pattern-specific tradeoffs";
  }

  _patternAlternatives(p) {
    const map = {
      "Event-Driven": "Direct method calls / Request-Response",
      "Hexagonal": "Traditional layered architecture",
      "Pipeline": "Single-pass processing / Visitor pattern",
      "Plugin": "Hardcoded extensions / Strategy pattern",
      "Microservices": "Modular monolith",
      "Layered": "Hexagonal / Clean Architecture",
      "FSM": "State pattern / ad-hoc control flow",
    };
    return map[p] || "Alternative architecture patterns";
  }

  _negativeBenefit(missing) {
    const benefits = {
      memory: "Stateless design; easier to scale horizontally",
      planning: "Simple reactive loop; lower latency",
      reflection: "Deterministic execution; predictable cost",
      retrieval: "No vector store dependency; simpler deployment",
    };
    return missing.slice(0, 2).map((m) => benefits[m]).filter(Boolean).join("; ") || "Simpler design scope";
  }

  _negativeTradeoff(missing) {
    const tradeoffs = {
      memory: "Cannot maintain conversation context across sessions",
      planning: "Cannot handle multi-step tasks requiring foresight",
      reflection: "Cannot self-correct errors; lower quality on complex tasks",
      retrieval: "Cannot leverage external knowledge; limited to model's training data",
    };
    return missing.slice(0, 2).map((m) => tradeoffs[m]).filter(Boolean).join("; ") || "Reduced capability scope";
  }

  _groupByCategory(decisions) {
    const groups = {};
    for (const d of decisions) groups[d.category] = (groups[d.category] || 0) + 1;
    return groups;
  }

  // ── Decision Record finalizer ──────────────────────────────────────────
  // Adds ADR-style fields (problem / risk / reusability) to each decision.
  // `problem` answers WHY this decision was needed (the force it resolves).
  // `risk` answers what could go wrong.
  // `reusability` is a 0-1 score: how transferable to other repos.
  _finalizeDecision(d) {
    const problem = this._inferProblem(d);
    const risk = this._inferRisk(d);
    const reusability = this._inferReusability(d);
    return { ...d, problem, risk, reusability };
  }

  _inferProblem(d) {
    // Infer the problem from category + decision text
    const t = (d.decision || "").toLowerCase();
    if (d.category === "structural") return `Need to organize code at scale; without a structural pattern the codebase becomes hard to navigate and evolve`;
    if (d.category === "modular") return `Need to separate concerns so teams can work independently and modules can evolve at different rates`;
    if (d.category === "capability") {
      if (t.includes("tool-heavy")) return `Need deterministic, testable capabilities vs flexible LLM reasoning`;
      if (t.includes("prompt-heavy")) return `Need flexible reasoning over a fixed tool surface`;
      return `Need to choose how capabilities are exposed to the LLM`;
    }
    if (d.category === "integration") return `Need to manage where LLM calls happen (centralized for control vs distributed for locality)`;
    if (d.category === "quality") return `Need to ensure quality attributes (testing, eval) are in place before shipping`;
    if (d.category === "negative") return `Observed absence of a capability — the team deliberately chose not to implement it (or has not yet)`;
    return `Design force that this decision resolves`;
  }

  _inferRisk(d) {
    const t = (d.decision || "").toLowerCase();
    const risks = {
      structural: `Pattern may not fit future requirements; migrating away is expensive`,
      modular: `Over-splitting creates integration overhead; cross-cutting concerns leak`,
      capability: t.includes("tool-heavy")
        ? `Tool registry maintenance burden; tools may diverge in style`
        : `Prompt drift; non-deterministic behavior; harder to test`,
      integration: t.includes("centralize")
        ? `Central point of failure; all LLM calls depend on one module`
        : `Inconsistent error handling; harder to audit LLM usage`,
      quality: `Tests/evals may give false confidence; maintenance lag behind features`,
      negative: `Absence may be unintentional; future requirements may need this capability`,
    };
    return risks[d.category] || `Decision may have unintended consequences in edge cases`;
  }

  _inferReusability(d) {
    // Score 0-1: how transferable is this decision to other repos?
    // Structural/modular decisions are highly reusable; integration/quality are project-specific.
    const scores = {
      structural: 0.8,
      modular: 0.7,
      capability: 0.6,
      integration: 0.4,
      quality: 0.3,
      negative: 0.5,
    };
    return scores[d.category] ?? 0.5;
  }
}

/**
 * ConstraintAnalyzer — extracts architectural Constraints.
 *
 * A Constraint is a requirement that drives design decisions. Sources:
 *   - README (explicit "must support X")
 *   - manifest dependencies (implicit: depends on sqlite → local storage)
 *   - code patterns (try/catch/retry → fault tolerance)
 *   - config patterns (env vars → configurability)
 *
 * Output schema per constraint:
 *   { id, constraint, source, evidence[], drivesDecisions[], affectedModules[], confidence }
 */
class ConstraintAnalyzer extends BaseAnalyzer {
  get id() { return "constraints"; }
  supports(_ctx) { return true; }

  async analyze(ctx, store, _analyzerCtx) {
    const constraints = [];
    let counter = 0;
    const mkId = () => `C-${String(++counter).padStart(3, "0")}`;

    // K1: Dependencies imply constraints
    const disc = store.discovery || {};
    const deps = this._extractDependencies(disc, store);
    if (deps.sqlite || deps.sqlcipher) {
      constraints.push({
        id: mkId(),
        constraint: "Must support local persistent storage (embedded SQL)",
        source: "manifest",
        evidence: [`dependency: ${deps.sqlite || deps.sqlcipher}`],
        drivesDecisions: ["Use SQLite as embedded database", "No external database service required"],
        affectedModules: this._modulesWithKeyword(store, ["storage", "db", "database", "persist"]),
        confidence: 0.85,
      });
    }
    if (deps.openai || deps.anthropic || deps.llm) {
      constraints.push({
        id: mkId(),
        constraint: "Must integrate with external LLM provider (network dependency)",
        source: "manifest",
        evidence: [`dependency: ${deps.openai || deps.anthropic || deps.llm}`],
        drivesDecisions: ["Centralize LLM call sites", "Handle network failures and rate limits"],
        affectedModules: this._modulesWithKeyword(store, ["llm", "openai", "anthropic", "inference"]),
        confidence: 0.9,
      });
    }
    if (deps.fastapi || deps.express || deps.flask) {
      constraints.push({
        id: mkId(),
        constraint: "Must expose HTTP API",
        source: "manifest",
        evidence: [`dependency: ${deps.fastapi || deps.express || deps.flask}`],
        drivesDecisions: ["Adopt request/response lifecycle", "Implement API routing layer"],
        affectedModules: this._modulesWithKeyword(store, ["api", "route", "endpoint", "server"]),
        confidence: 0.85,
      });
    }

    // K2: Test patterns imply quality constraints
    const tests = store.tests || {};
    const testPatterns = tests.testPatterns || [];
    if (testPatterns.includes("poison")) {
      constraints.push({
        id: mkId(),
        constraint: "Must resist adversarial / malformed inputs (poison testing)",
        source: "code",
        evidence: ["tests.testPatterns includes 'poison'"],
        drivesDecisions: ["Implement input validation layer", "Sandbox untrusted execution"],
        affectedModules: this._modulesWithKeyword(store, ["sandbox", "validate", "guard", "safety"]),
        confidence: 0.75,
      });
    }
    if (testPatterns.includes("stress")) {
      constraints.push({
        id: mkId(),
        constraint: "Must handle high load / stress conditions",
        source: "code",
        evidence: ["tests.testPatterns includes 'stress'"],
        drivesDecisions: ["Implement backpressure / rate limiting", "Profile under load"],
        affectedModules: this._modulesWithKeyword(store, ["limit", "queue", "throttle", "pool"]),
        confidence: 0.7,
      });
    }

    // K3: Entry point shape implies deployment constraint
    const eps = store.entrypoints || {};
    const allEps = eps.entrypoints || [];
    const cliEps = allEps.filter((e) => e.type === "cli").length;
    if (cliEps > 0 && cliEps >= allEps.length * 0.8) {
      constraints.push({
        id: mkId(),
        constraint: "Must run as a CLI tool (not a long-running service)",
        source: "code",
        evidence: [`${cliEps} CLI entry points out of ${allEps.length} total`],
        drivesDecisions: ["Design for one-shot execution", "No persistent process state"],
        affectedModules: this._modulesWithKeyword(store, ["cli", "command", "main"]),
        confidence: 0.8,
      });
    }

    // K4: Architecture pattern implies constraints
    const ap = store.archPattern || {};
    if (ap.primaryPattern === "Plugin") {
      constraints.push({
        id: mkId(),
        constraint: "Must support third-party extensions (plugin architecture)",
        source: "code",
        evidence: ["archPattern.primaryPattern=Plugin"],
        drivesDecisions: ["Stabilize plugin API surface", "Version the plugin contract"],
        affectedModules: this._modulesWithKeyword(store, ["plugin", "extension", "hook"]),
        confidence: 0.75,
      });
    }
    if (ap.primaryPattern === "Event-Driven") {
      constraints.push({
        id: mkId(),
        constraint: "Must handle asynchronous event flow (eventual consistency)",
        source: "code",
        evidence: ["archPattern.primaryPattern=Event-Driven"],
        drivesDecisions: ["Implement event bus / queue", "Handle out-of-order events"],
        affectedModules: this._modulesWithKeyword(store, ["event", "bus", "queue", "handler"]),
        confidence: 0.75,
      });
    }

    // K5: CI / toolchain constraints
    const ci = store.ci || {};
    if (ci.provider && ci.provider !== "none") {
      constraints.push({
        id: mkId(),
        constraint: `Must pass CI on ${ci.provider} (${(ci.workflows || []).length} workflow(s))`,
        source: "config",
        evidence: [`ci.provider=${ci.provider}`, `ci.workflows=${(ci.workflows || []).length}`],
        drivesDecisions: ["Keep CI green", "Pin dependency versions"],
        affectedModules: [],
        confidence: 0.6,
      });
    }

    store[this.id] = {
      constraints,
      totalConstraints: constraints.length,
      bySource: this._groupBySource(constraints),
      _meta: {
        source: "inference",
        strength: "moderate",
        assumptions: [
          "Dependencies in manifest reflect runtime requirements (not just build-time)",
          "Test patterns reflect quality requirements, not just test style",
          "Entry point shape reflects deployment model",
        ],
        limitations: [
          "Cannot read README text for explicit constraint statements (e.g., 'Must support streaming')",
          "Issue tracker and design docs are not accessible; constraints stated there are missed",
          "Config files (.env.example) are not scanned; env-var constraints are inferred from code only",
        ],
        possibleFalsePositives: [
          "A dependency may be transitively pulled in, not directly required by the architecture",
          "Test patterns may reflect test author preference, not a hard constraint",
        ],
        checkedLocations: [
          "discovery.manifest.dependencies",
          "tests.testPatterns",
          "entrypoints.entrypoints (type distribution)",
          "archPattern.primaryPattern",
          "ci.provider + ci.workflows",
        ],
        coverage: "5 constraint sources: manifest / code / config / pattern / ci",
      },
    };
  }

  _extractDependencies(disc, store) {
    const deps = {};
    const manifest = disc.manifest || {};
    
    // Only check required dependencies, ignore optional/dev dependencies
    // This prevents false positives like pyod's optional openai dependency
    const requiredDeps = manifest.dependencies || {};
    const depNames = Array.isArray(requiredDeps) ? requiredDeps : Object.keys(requiredDeps);
    const joined = depNames.join(" ").toLowerCase();
    
    if (joined.includes("sqlite")) deps.sqlite = "sqlite3";
    if (joined.includes("sqlcipher")) deps.sqlcipher = "sqlcipher";
    if (joined.includes("openai")) deps.openai = "openai";
    if (joined.includes("anthropic")) deps.anthropic = "anthropic";
    if (/[\b\/]llm\b|langchain|llama/.test(joined)) deps.llm = "langchain/llama";
    if (joined.includes("fastapi")) deps.fastapi = "fastapi";
    if (joined.includes("express")) deps.express = "express";
    if (joined.includes("flask")) deps.flask = "flask";
    
    // Also check symbols for implicit LLM deps (Rust repos may not declare openai package)
    if (!deps.openai && !deps.anthropic && !deps.llm) {
      const sym = store.symbols || {};
      const fns = sym.functions || [];
      const hasLlmCall = fns.some((f) => /openai|anthropic|claude|gemini|llm_call/i.test(f.name || ""));
      if (hasLlmCall) deps.llm = "symbol-implicit";
    }
    return deps;
  }

  _modulesWithKeyword(store, keywords) {
    const resp = store.responsibility || {};
    return (resp.responsibilities || [])
      .filter((r) => keywords.some((k) => (r.module || "").toLowerCase().includes(k)))
      .map((r) => r.module)
      .slice(0, 5);
  }

  _groupBySource(constraints) {
    const groups = {};
    for (const c of constraints) groups[c.source] = (groups[c.source] || 0) + 1;
    return groups;
  }
}

/**
 * AssumptionAnalyzer — extracts implicit Assumptions.
 *
 * Assumptions are unstated beliefs the system depends on. They are the most
 * dangerous because they break silently. Sources:
 *   - LLM call without retry → "LLM always available"
 *   - No input validation → "Inputs are always well-formed"
 *   - Sync file I/O → "Files are local and fast"
 *   - Hardcoded path → "Specific OS / filesystem layout"
 *
 * Output schema per assumption:
 *   { id, assumption, evidence[], confidence, risk, brokenIf }
 */
class AssumptionAnalyzer extends BaseAnalyzer {
  get id() { return "assumptions"; }
  supports(_ctx) { return true; }

  async analyze(_ctx, store, _analyzerCtx) {
    const assumptions = [];
    let counter = 0;
    const mkId = () => `A-${String(++counter).padStart(3, "0")}`;

    // A1: LLM availability assumption
    const iflow = store.informationFlow || {};
    const llmCallSites = iflow.llmCallSites || [];
    if (llmCallSites.length > 0) {
      // Check if there's retry logic
      const sym = store.symbols || {};
      const fns = sym.functions || [];
      const hasRetry = fns.some((f) => /retry|backoff|with_retry/i.test(f.name || ""));
      assumptions.push({
        id: mkId(),
        assumption: hasRetry
          ? "LLM service is mostly available (retry logic present but assumes transient failures only)"
          : "LLM service is always available (no retry logic detected)",
        evidence: hasRetry
          ? ["symbols: retry/backoff function found"]
          : [`informationFlow.llmCallSites=${llmCallSites.length} (no retry symbol found)`],
        confidence: hasRetry ? 0.6 : 0.7,
        risk: hasRetry ? "low" : "high",
        brokenIf: "LLM provider has extended outage, or rate limit exhausts retry budget",
      });
    }

    // A2: Input well-formedness assumption
    const tests = store.tests || {};
    const testPatterns = tests.testPatterns || [];
    const hasPoisonTests = testPatterns.includes("poison");
    assumptions.push({
      id: mkId(),
      assumption: hasPoisonTests
        ? "Inputs may be adversarial (poison tests present, partial validation assumed)"
        : "Inputs are always well-formed (no poison/adversarial tests detected)",
      evidence: hasPoisonTests
        ? ["tests.testPatterns includes 'poison'"]
        : ["tests.testPatterns does NOT include 'poison'"],
      confidence: 0.65,
      risk: hasPoisonTests ? "medium" : "high",
      brokenIf: "Adversarial input reaches core logic; unvalidated paths crash or misbehave",
    });

    // A3: Python/Node version assumption
    const disc = store.discovery || {};
    const manifest = disc.manifest || {};
    const lang = manifest.language || "";
    if (lang === "python") {
      assumptions.push({
        id: mkId(),
        assumption: "Python 3.x runtime is available (specific version not validated)",
        evidence: [`discovery.manifest.language=python`],
        confidence: 0.5,
        risk: "low",
        brokenIf: "Deployed on Python 2.x or incompatible 3.x version",
      });
    } else if (lang === "typescript" || lang === "javascript") {
      assumptions.push({
        id: mkId(),
        assumption: "Node.js runtime is available (specific version not validated)",
        evidence: [`discovery.manifest.language=${lang}`],
        confidence: 0.5,
        risk: "low",
        brokenIf: "Deployed on incompatible Node.js version (e.g., missing fetch API on old Node)",
      });
    }

    // A4: Local filesystem assumption (based on storage patterns)
    const resp = store.responsibility || {};
    const hasStorage = (resp.responsibilities || []).some((r) => r.responsibility === "Persistence");
    if (hasStorage) {
      assumptions.push({
        id: mkId(),
        assumption: "Local filesystem is available and writable (persistence detected)",
        evidence: ["responsibility: Persistence module present"],
        confidence: 0.7,
        risk: "medium",
        brokenIf: "Deployed in read-only filesystem (container, serverless) or network-mounted storage with high latency",
      });
    }

    // A5: Single-user / no concurrency assumption
    const ap = store.archPattern || {};
    const cap = store.capabilityOntology || {};
    const matrix = cap.capabilityMatrix || {};
    if (matrix.memory === "missing" || matrix.memory === "n/a") {
      assumptions.push({
        id: mkId(),
        assumption: "No cross-session memory required (stateless or single-session design)",
        evidence: [`capabilityOntology.capabilityMatrix.memory=${matrix.memory || "n/a"}`],
        confidence: 0.6,
        risk: "medium",
        brokenIf: "Multi-turn conversation spans sessions; user expects continuity",
      });
    }

    // A6: Network reliability assumption
    const con = store.constraints || {};
    const hasExternalLLM = (con.constraints || []).some((c) => c.constraint.includes("external LLM"));
    if (hasExternalLLM) {
      assumptions.push({
        id: mkId(),
        assumption: "Network to LLM provider is reliable (latency < timeout)",
        evidence: ["constraints: external LLM provider dependency"],
        confidence: 0.7,
        risk: "high",
        brokenIf: "Network partition, DNS failure, or provider-side throttling causes timeouts",
      });
    }

    // A7: Determinism assumption (if no LLM)
    if (llmCallSites.length === 0 && (cap.isAIProject === false)) {
      assumptions.push({
        id: mkId(),
        assumption: "System behavior is deterministic (no LLM / non-deterministic AI calls detected)",
        evidence: ["informationFlow.llmCallSites=0", "capabilityOntology.isAIProject=false"],
        confidence: 0.75,
        risk: "low",
        brokenIf: "LLM or probabilistic component is introduced without updating tests",
      });
    }

    store[this.id] = {
      assumptions,
      totalAssumptions: assumptions.length,
      byRisk: this._groupByRisk(assumptions),
      highRiskCount: assumptions.filter((a) => a.risk === "high").length,
      _meta: {
        source: "inference",
        strength: "weak",
        assumptions: [
          "Assumptions are inferred from absence (no retry → assumes availability), which is inherently uncertain",
          "Only code-derivable assumptions are extracted; cultural/team assumptions are out of scope",
        ],
        limitations: [
          "Cannot read README 'Prerequisites' section for explicit assumption statements",
          "Assumption risk levels are heuristic, not domain-calibrated",
          "Absence of evidence is not evidence of absence — a missing retry symbol may mean retry is implemented elsewhere",
        ],
        possibleFalsePositives: [
          "No retry symbol may not mean no retry logic (could be in a dependency)",
          "No poison tests may not mean inputs are trusted (could be validated upstream)",
        ],
        checkedLocations: [
          "informationFlow.llmCallSites (count + retry symbol search)",
          "tests.testPatterns (poison presence)",
          "discovery.manifest.language",
          "responsibility.responsibilities (Persistence presence)",
          "capabilityOntology.capabilityMatrix.memory",
          "constraints.constraints (external LLM)",
        ],
        coverage: "7 assumption categories: availability / input / runtime / storage / memory / network / determinism",
      },
    };
  }

  _groupByRisk(assumptions) {
    const groups = { high: 0, medium: 0, low: 0 };
    for (const a of assumptions) groups[a.risk] = (groups[a.risk] || 0) + 1;
    return groups;
  }
}

/**
 * ConsistencyAnalyzer — cross-analyzer contradiction detection (post-processor).
 *
 * Runs LAST in the pipeline. Compares claims across analyzers and flags:
 *   - Contradictions: two analyzers make incompatible claims (severity: high)
 *   - Warnings: one analyzer's output is suspicious given another's (severity: medium/low)
 *
 * Design rationale: with 7 inference engines, disagreements are inevitable.
 * Surfacing them in the Evidence Brief lets the LLM (and reader) prioritize
 * investigation rather than blindly trusting whichever analyzer ran last.
 *
 * Output: store.consistency = { contradictions, warnings, summary }
 * The Evidence Brief surfaces contradictions FIRST (before PageRank, before
 * Architecture Insights), because self-detected conflicts are the most
 * research-valuable findings.
 */
// ===========================================================================
// ArchitectureMetricsAnalyzer — Structural metrics (P2-④)
//
// Computes node-level and aggregate architecture metrics from the import graph
// produced by ArchitectureAnalyzer. Complements StabilityAnalyzer (which is
// module-level Robert C. Martin A-I graph) by providing:
//   - Layer       : layer detection from top-level dirs + src/<layer>/ patterns
//   - Cycle       : count, max length, cycle list (sourced from arch.cycles)
//   - Fan-in/out  : per-node, with aggregate avg / max / distribution
//   - Stability   : per-node I = Ce/(Ca+Ce) (0=stable, 1=unstable)
//   - Coupling    : density, avg degree, hub nodes (high fan-in),
//                   bottleneck nodes (high fan-out)
//
// Source: store.architecture (ArchitectureAnalyzer output — nodes, edges, cycles)
//
// Output: store.archMetrics = { layers, cycles, fanIn, fanOut, stability,
//                               coupling, summary, _meta }
// ===========================================================================

// Known layer name patterns. Matched against top-level dir names AND one-level
// deep subdirs of src/, lib/, app/. Each entry: { layer, aliases }.
// Aliases are matched via token-prefix (so "ui" matches "uikit" too — we use
// exact equality on the dir basename to keep precision).
const LAYER_PATTERNS = [
  { layer: "presentation", aliases: ["ui", "views", "view", "frontend", "web", "client", "components", "screens", "pages", "presentation"] },
  { layer: "business", aliases: ["services", "service", "domain", "usecases", "use_cases", "core", "business", "logic", "interactors"] },
  { layer: "data", aliases: ["data", "models", "entities", "schemas", "db", "database", "persistence", "repositories", "store", "storage"] },
  { layer: "infrastructure", aliases: ["infrastructure", "infra", "adapters", "adapter", "ports", "drivers", "external", "gateways"] },
  { layer: "api", aliases: ["api", "routes", "controllers", "endpoints", "handlers"] },
  { layer: "config", aliases: ["config", "configuration", "settings", "env"] },
  { layer: "utils", aliases: ["utils", "util", "helpers", "common", "shared", "lib"] },
  { layer: "tests", aliases: ["tests", "test", "spec", "specs", "__tests__"] },
];

class ArchitectureMetricsAnalyzer extends BaseAnalyzer {
  get id() {
    return "archMetrics";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const arch = store.architecture || {};
    const discovery = store.discovery || {};
    const nodes = arch.nodes || [];
    const edges = arch.edges || [];
    const cycles = arch.cycles || [];

    if (nodes.length === 0) {
      store[this.id] = {
        skipped: true,
        reason: "No architecture graph available.",
        summary: { totalNodes: 0, totalEdges: 0, totalCycles: 0, totalLayers: 0 },
      };
      return;
    }

    // --- Layer detection ----------------------------------------------------
    const { layers, nodeIdToLayer } = this._detectLayers(nodes, edges, discovery, ctx);

    // --- Fan-in / Fan-out (per-node) ----------------------------------------
    const fanInMap = new Map(); // nodeId -> count
    const fanOutMap = new Map(); // nodeId -> count
    for (const n of nodes) {
      fanInMap.set(n.id, 0);
      fanOutMap.set(n.id, 0);
    }
    for (const e of edges) {
      if (fanOutMap.has(e.from)) fanOutMap.set(e.from, fanOutMap.get(e.from) + 1);
      if (fanInMap.has(e.to)) fanInMap.set(e.to, fanInMap.get(e.to) + 1);
    }
    const fanIn = this._aggregateFan(nodes, fanInMap, "fan-in");
    const fanOut = this._aggregateFan(nodes, fanOutMap, "fan-out");

    // --- Stability (per-node, Robert C. Martin I = Ce/(Ca+Ce)) --------------
    // At node level: Ca = fan-in (dependents), Ce = fan-out (dependencies).
    // I=0 → maximally stable (only depended-upon), I=1 → maximally unstable
    // (only depends-on others, nothing depends on it).
    const nodeStability = nodes.map((n) => {
      const ca = fanInMap.get(n.id) || 0;
      const ce = fanOutMap.get(n.id) || 0;
      const total = ca + ce;
      const instability = total > 0 ? ce / total : 0;
      return { node: n.id, path: n.path, ca, ce, instability: Number(instability.toFixed(3)) };
    });
    const mostStable = [...nodeStability]
      .filter((s) => s.ca + s.ce > 0)
      .sort((a, b) => a.instability - b.instability)
      .slice(0, 5);
    const leastStable = [...nodeStability]
      .filter((s) => s.ca + s.ce > 0)
      .sort((a, b) => b.instability - a.instability)
      .slice(0, 5);
    const avgInstability = nodeStability.length > 0
      ? Number((nodeStability.reduce((sum, s) => sum + s.instability, 0) / nodeStability.length).toFixed(3))
      : 0;
    const stability = {
      avg: avgInstability,
      mostStable,
      leastStable,
      isolatedCount: nodeStability.filter((s) => s.ca + s.ce === 0).length,
    };

    // --- Coupling (aggregate) ----------------------------------------------
    const totalNodes = nodes.length;
    const totalEdges = edges.length;
    const density = totalNodes > 1
      ? totalEdges / (totalNodes * (totalNodes - 1))
      : 0;
    const avgDegree = totalNodes > 0 ? (totalEdges * 2) / totalNodes : 0;
    // Hub nodes: high fan-in (many depend on them) — they are "depended-upon" cores.
    const hubNodes = [...nodes]
      .map((n) => ({ node: n.id, path: n.path, fanIn: fanInMap.get(n.id) || 0 }))
      .sort((a, b) => b.fanIn - a.fanIn)
      .slice(0, 5);
    // Bottleneck nodes: high fan-out (they depend on many) — change ripples out from them.
    const bottleneckNodes = [...nodes]
      .map((n) => ({ node: n.id, path: n.path, fanOut: fanOutMap.get(n.id) || 0 }))
      .sort((a, b) => b.fanOut - a.fanOut)
      .slice(0, 5);
    // Cross-layer edges: edges that cross layer boundaries (high = layers leak).
    let crossLayerEdges = 0;
    for (const e of edges) {
      const fromL = nodeIdToLayer.get(e.from);
      const toL = nodeIdToLayer.get(e.to);
      if (fromL && toL && fromL !== toL) crossLayerEdges++;
    }
    const coupling = {
      density: Number(density.toFixed(4)),
      avgDegree: Number(avgDegree.toFixed(3)),
      crossLayerEdges,
      crossLayerRatio: totalEdges > 0 ? Number((crossLayerEdges / totalEdges).toFixed(3)) : 0,
      hubNodes,
      bottleneckNodes,
    };

    // --- Cycle metrics -----------------------------------------------------
    const cycleLengths = cycles.map((c) => Array.isArray(c) ? c.length : (c.nodes?.length || 0));
    const cycleMetrics = {
      count: cycles.length,
      maxLength: cycleLengths.length > 0 ? Math.max(...cycleLengths) : 0,
      avgLength: cycleLengths.length > 0
        ? Number((cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length).toFixed(2))
        : 0,
      // Surface up to 5 cycles with full node list for LLM inspection.
      top: cycles.slice(0, 5).map((c, i) => ({
        id: i + 1,
        nodes: Array.isArray(c) ? c : (c.nodes || []),
        length: Array.isArray(c) ? c.length : (c.nodes?.length || 0),
      })),
    };

    // --- Summary -----------------------------------------------------------
    const summary = {
      totalNodes,
      totalEdges,
      totalCycles: cycles.length,
      totalLayers: layers.length,
      avgFanIn: fanIn.avg,
      avgFanOut: fanOut.avg,
      avgInstability,
      density: coupling.density,
    };

    store[this.id] = {
      layers,
      cycles: cycleMetrics,
      fanIn,
      fanOut,
      stability,
      coupling,
      summary,
      _meta: {
        source: "store.architecture (nodes, edges, cycles)",
        strength: "strong",
        assumptions: [
          "Import graph accurately reflects runtime dependencies",
          "Layer detection is heuristic (directory naming) — verify against actual architecture",
          "Node-level stability follows Robert C. Martin's I metric; module-level is in StabilityAnalyzer",
        ],
        limitations: [
          "Synthetic repos with no imports produce empty graph",
          "Dynamic imports / reflection-based deps are not captured",
          "Layer detection misses non-conventional directory layouts",
        ],
        possibleFalsePositives: [
          "Test files may inflate fan-in of utility modules",
          "Barrel index.* files create false hubs",
        ],
        checkedLocations: ["store.architecture.nodes", "store.architecture.edges", "store.architecture.cycles", "store.discovery.topLevelDirs"],
        coverage: "import-graph-only",
      },
    };
  }

  /**
   * Detect architectural layers from directory structure.
   * Scans: (1) top-level dirs, (2) one-level deep subdirs of src/, lib/, app/.
   * Each detected layer: { layer, sourceDirs, nodes, nodeCount, intraEdges, crossEdges }
   */
  _detectLayers(nodes, edges, discovery, _ctx) {
    const topLevelDirs = discovery.topLevelDirs || [];
    // Build a map of node.path → first path segment(s) for layer attribution.
    const nodeLayer = new Map(); // nodeId → { layer, sourceDir }

    // Candidate layer dirs: top-level + one-level deep under src/lib/app.
    const candidates = new Set();
    for (const d of topLevelDirs) candidates.add(d);
    for (const d of topLevelDirs) {
      if (d === "src" || d === "lib" || d === "app") {
        // We can't access ctx.dirs here cleanly; use node paths instead.
      }
    }
    // Walk node paths to find src/<sub>/ or lib/<sub>/ patterns.
    const srcSubDirs = new Set();
    for (const n of nodes) {
      const parts = (n.path || "").split("/");
      if (parts.length >= 2 && (parts[0] === "src" || parts[0] === "lib" || parts[0] === "app")) {
        srcSubDirs.add(parts[1]);
      }
    }
    for (const d of srcSubDirs) candidates.add(d);

    // Match candidates against LAYER_PATTERNS.
    const layerOfDir = new Map(); // dirName → layer
    for (const cand of candidates) {
      const lower = cand.toLowerCase();
      for (const pat of LAYER_PATTERNS) {
        if (pat.aliases.includes(lower)) {
          layerOfDir.set(cand, pat.layer);
          break;
        }
      }
    }

    // Attribute each node to a layer (by first path segment or src/<seg>).
    for (const n of nodes) {
      const parts = (n.path || "").split("/").filter(Boolean);
      if (parts.length === 0) continue;
      let dirSeg = null;
      if ((parts[0] === "src" || parts[0] === "lib" || parts[0] === "app") && parts.length >= 2) {
        dirSeg = parts[1];
      } else {
        dirSeg = parts[0];
      }
      const layer = layerOfDir.get(dirSeg);
      if (layer) {
        nodeLayer.set(n.id, { layer, sourceDir: dirSeg });
      }
    }

    // Build layer summaries.
    const byLayer = new Map(); // layerName → { nodes: [], sourceDirs: Set }
    for (const [nodeId, info] of nodeLayer.entries()) {
      if (!byLayer.has(info.layer)) {
        byLayer.set(info.layer, { nodes: [], sourceDirs: new Set() });
      }
      const entry = byLayer.get(info.layer);
      entry.nodes.push(nodeId);
      entry.sourceDirs.add(info.sourceDir);
    }

    const layers = [];
    for (const [layer, info] of byLayer.entries()) {
      const nodeSet = new Set(info.nodes);
      let intraEdges = 0;
      let crossEdges = 0;
      for (const e of edges) {
        const fromIn = nodeSet.has(e.from);
        const toIn = nodeSet.has(e.to);
        if (fromIn && toIn) intraEdges++;
        else if (fromIn || toIn) crossEdges++;
      }
      layers.push({
        layer,
        sourceDirs: [...info.sourceDirs],
        nodeCount: info.nodes.length,
        intraEdges,
        crossEdges,
      });
    }
    layers.sort((a, b) => b.nodeCount - a.nodeCount);
    // Build nodeIdToLayer map for downstream cross-layer edge counting.
    const nodeIdToLayer = new Map();
    for (const [nodeId, info] of nodeLayer.entries()) {
      nodeIdToLayer.set(nodeId, info.layer);
    }
    return { layers, nodeIdToLayer };
  }

  /**
   * Aggregate fan metric (used for both fan-in and fan-out).
   * Returns { avg, max, maxNode, distribution }
   */
  _aggregateFan(nodes, countMap, _label) {
    if (nodes.length === 0) {
      return { avg: 0, max: 0, maxNode: null, distribution: { "0": 0, "1-3": 0, "4-9": 0, "10+": 0 } };
    }
    const values = nodes.map((n) => countMap.get(n.id) || 0);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = Number((sum / values.length).toFixed(3));
    let max = 0;
    let maxNode = null;
    const dist = { "0": 0, "1-3": 0, "4-9": 0, "10+": 0 };
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v > max) {
        max = v;
        maxNode = nodes[i].id;
      }
      if (v === 0) dist["0"]++;
      else if (v <= 3) dist["1-3"]++;
      else if (v <= 9) dist["4-9"]++;
      else dist["10+"]++;
    }
    return { avg, max, maxNode, distribution: dist };
  }
}


// ===========================================================================
// TemporalAnalyzer — Repository Evolution (P2-③)
//
// Analyzes git history to detect architectural evolution events:
//   - Major Rewrite     : single commit (or small burst) touching >30% of files
//   - Architecture Pivot: sustained shift in top-active modules across time windows
//   - Deprecated Pattern: modules with high early activity but no recent activity
//   - Historical Tradeoff: commit messages mentioning rewrite/refactor/deprecate/
//                          replace/migrate (intentional architectural changes)
//
// Source: store.git (GitAnalyzer output — totalCommits, largestRefactors,
//         topActiveModules, firstCommit, lastCommit)
//
// Output: store.temporal = { events, deprecatedModules, pivotWindows, summary, _meta }
// ===========================================================================

class TemporalAnalyzer extends BaseAnalyzer {
  get id() {
    return "temporal";
  }

  supports(ctx) {
    // Requires git history — skip for non-git repos / synthetic repos
    return ctx.isGitRepo === true;
  }

  async analyze(ctx, store, _analyzerCtx) {
    const gitData = store.git || {};
    const totalCommits = gitData.totalCommits || 0;
    const largestRefactors = gitData.largestRefactors || [];
    const topActiveModules = gitData.topActiveModules || [];

    if (totalCommits === 0) {
      store[this.id] = {
        skipped: true,
        reason: "No git history available.",
        events: [],
        deprecatedModules: [],
        pivotWindows: [],
        summary: { totalEvents: 0, totalDeprecated: 0, totalPivots: 0 },
        _meta: this._meta(),
      };
      return;
    }

    const events = [];

    // ── Major Rewrite: commits touching a large fraction of files ────────
    // Threshold: a single commit touching ≥30 files OR ≥10% of all touched
    // files across history (whichever is smaller, but min 10 files).
    const fileCountThreshold = Math.max(10, Math.floor(this._estimateTotalFiles(topActiveModules) * 0.10));
    for (const ref of largestRefactors) {
      if (ref.filesChanged >= fileCountThreshold && ref.filesChanged >= 30) {
        events.push({
          type: "major_rewrite",
          commitHash: ref.hash,
          date: ref.date,
          subject: ref.subject,
          filesChanged: ref.filesChanged,
          interpretation: `Major rewrite: commit ${ref.hash.slice(0, 8)} touched ${ref.filesChanged} files in a single commit — likely a large-scale refactor or architectural change.`,
          confidence: 0.7,
        });
      }
    }

    // ── Historical Tradeoff: commit subjects mentioning architectural shifts ──
    const TRADEOFF_PATTERNS = [
      { regex: /\brewrite\b|refactor\s+(?:whole|entire|major|large)/i, type: "rewrite", interpretation: "Commit message indicates a rewrite — explicit architecture tradeoff." },
      { regex: /\bdeprecat/i, type: "deprecation", interpretation: "Commit message marks something deprecated — historical tradeoff in favor of a new approach." },
      { regex: /\breplace\b|\bmigrate\b|\bport\s+to\b/i, type: "migration", interpretation: "Commit message indicates a migration — replacing one approach with another." },
      { regex: /\barchitecture\b|\bpivot\b|\brestructure\b/i, type: "restructure", interpretation: "Commit message explicitly mentions architecture change." },
    ];
    // We don't have full commit subjects in gitData (only largestRefactors subjects),
    // so check those.
    for (const ref of largestRefactors) {
      for (const pattern of TRADEOFF_PATTERNS) {
        if (pattern.regex.test(ref.subject || "")) {
          events.push({
            type: "historical_tradeoff",
            subtype: pattern.type,
            commitHash: ref.hash,
            date: ref.date,
            subject: ref.subject,
            filesChanged: ref.filesChanged,
            interpretation: pattern.interpretation,
            confidence: 0.6,
          });
          break; // one match per commit
        }
      }
    }

    // ── Deprecated Pattern: modules with high early activity, no recent ──
    // Approximation: topActiveModules lists all-time activity. Without per-period
    // breakdown from GitAnalyzer, we can only flag high-activity modules that
    // appear stagnant based on lastCommit timing. For now, we flag any module
    // in the top 5 with a name suggesting legacy (legacy/, old/, deprecated/,
    // v1/, archive/) as a deprecated pattern candidate.
    const DEPRECATED_NAME_RE = /^(legacy|old|deprecated|v1|archive|obsolete|retired)[/_-]/i;
    const deprecatedModules = topActiveModules
      .slice(0, 10)
      .filter((m) => DEPRECATED_NAME_RE.test(m.module))
      .map((m) => ({
        module: m.module,
        commits: m.commits,
        reason: `Module name suggests legacy/deprecated status (${m.commits} historical commits).`,
        confidence: 0.5,
      }));

    // ── Architecture Pivot: detect shift in dominant modules ─────────────
    // Without per-window git data, we approximate using commit subjects in
    // largestRefactors: if recent refactors focus on different modules than
    // older refactors, that's a pivot. This is a heuristic; deeper analysis
    // would require per-period file-touch counts (TODO: enhance GitAnalyzer).
    const pivotWindows = [];
    if (largestRefactors.length >= 4) {
      // Split refactors into old / new halves by date
      const sorted = [...largestRefactors].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const midIdx = Math.floor(sorted.length / 2);
      const oldHalf = sorted.slice(0, midIdx);
      const newHalf = sorted.slice(midIdx);
      const oldTopModules = this._topModulesFromRefactors(oldHalf);
      const newTopModules = this._topModulesFromRefactors(newHalf);
      // Pivot = old top module no longer in new top 3
      const oldTopNotInNew = oldTopModules.slice(0, 3).filter((m) => !newTopModules.slice(0, 3).includes(m));
      if (oldTopNotInNew.length > 0 && newTopModules.length > 0) {
        pivotWindows.push({
          oldTopModules: oldTopModules.slice(0, 3),
          newTopModules: newTopModules.slice(0, 3),
          shiftedAway: oldTopNotInNew,
          interpretation: `Architecture pivot detected: focus shifted from [${oldTopModules.slice(0, 3).join(", ")}] to [${newTopModules.slice(0, 3).join(", ")}].`,
          confidence: 0.5,
        });
      }
    }

    // Deduplicate events by (commitHash, type)
    const seen = new Set();
    const dedupedEvents = events.filter((e) => {
      const key = `${e.commitHash}:${e.type}:${e.subtype || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    store[this.id] = {
      events: dedupedEvents,
      deprecatedModules,
      pivotWindows,
      summary: {
        totalEvents: dedupedEvents.length,
        totalDeprecated: deprecatedModules.length,
        totalPivots: pivotWindows.length,
        totalCommitsAnalyzed: totalCommits,
      },
      _meta: this._meta(),
    };
  }

  _estimateTotalFiles(topActiveModules) {
    // Rough estimate: sum of commits across top modules is a lower bound on
    // file-touch events, not file count. Use it as a proxy for "files touched".
    return topActiveModules.reduce((s, m) => s + (m.commits || 0), 0);
  }

  _topModulesFromRefactors(refactors) {
    const counts = {};
    for (const r of refactors) {
      // We don't have file lists in largestRefactors, only filesChanged count.
      // Use subject to extract module hints as a fallback.
      const subject = r.subject || "";
      const moduleHint = subject.split(/[:\s/]/)[0]?.toLowerCase() || "unknown";
      counts[moduleHint] = (counts[moduleHint] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
  }

  _meta() {
    return {
      source: "git.largestRefactors + git.topActiveModules",
      strength: "weak",
      assumptions: [
        "Major rewrite = single commit touching ≥30 files or ≥10% of all touched files",
        "Historical tradeoff detected from commit subject keywords (rewrite/deprecate/migrate)",
        "Deprecated pattern requires module name to start with legacy/old/deprecated/v1/archive",
        "Architecture pivot approximated by comparing old/new halves of largestRefactors",
      ],
      limitations: [
        "Synthetic repos have no git history — this analyzer is skipped",
        "Per-period file-touch counts not available from GitAnalyzer; pivot detection is approximate",
        "Subject-line keyword matching can produce false positives (e.g., 'refactor' for unrelated reasons)",
        "Deprecated module detection relies on naming convention; many deprecations are not reflected in module names",
      ],
      possibleFalsePositives: [
        "Large merge commits can trigger Major Rewrite false positives",
        "Routine refactors using 'refactor' keyword trigger Historical Tradeoff false positives",
      ],
      checkedLocations: ["store.git.largestRefactors", "store.git.topActiveModules", "store.git.totalCommits"],
      coverage: "git-history-only",
    };
  }
}


class ConsistencyAnalyzer extends BaseAnalyzer {
  get id() {
    return "consistency";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(_ctx, store, _analyzerCtx) {
    const contradictions = [];
    const warnings = [];

    const cap = store.capabilityOntology || {};
    const resp = store.responsibility || {};
    const prompts = store.prompts || {};
    const tools = store.tools || {};
    const evals = store.evaluations || {};
    const infoFlow = store.informationFlow || {};
    const archPattern = store.archPattern || {};
    const tests = store.tests || {};

    const isAI = cap.isAIProject === true;
    const matrix = cap.capabilityMatrix || {};

    // ── C1: AI-project gate vs concrete AI signals ──────────────────────
    // CapabilityOntology says isAIProject=false but other analyzers found
    // prompts, tools, or LLM call sites. This is a direct contradiction —
    // the AI-context gate may have under-classified.
    if (!isAI) {
      const promptCount = (prompts.prompts || []).length;
      const toolCount = (tools.tools || []).length;
      const llmCallSiteCount = (infoFlow.llmCallSites || []).length;
      const llmRespCount = (resp.responsibilities || []).filter(
        (r) => r.responsibility === "LLM Interface"
      ).length;
      if (promptCount > 0 || toolCount > 0 || llmCallSiteCount > 0 || llmRespCount > 0) {
        const sources = [];
        if (promptCount > 0) sources.push(`PromptsAnalyzer found ${promptCount} prompts`);
        if (toolCount > 0) sources.push(`ToolsAnalyzer found ${toolCount} tools`);
        if (llmCallSiteCount > 0) sources.push(`InformationFlowAnalyzer found ${llmCallSiteCount} LLM call sites`);
        if (llmRespCount > 0) sources.push(`ResponsibilityAnalyzer tagged ${llmRespCount} modules as "LLM Interface"`);
        contradictions.push({
          id: `C${contradictions.length + 1}`,
          topic: "AI project classification",
          severity: "high",
          sourceA: { analyzer: "CapabilityOntology", claim: "isAIProject=false" },
          sourceB: { analyzer: sources.length === 1 ? sources[0].split(" ")[0] : "multiple", claim: sources.join("; ") },
          interpretation:
            "CapabilityOntology's AI-context gate may have under-classified this repo. The gate requires tools OR prompts OR LLM call sites OR LLM-Interface responsibility, but one of these signals exists.",
          recommendation:
            "LLM should verify by reading actual prompt/tool files — they may be test fixtures, docs, or false positives from regex matching.",
        });
      }
    }

    // ── C2: Responsibility "Retrieval" vs CapabilityOntology "retrieval" ──
    // Responsibility tags a module as "Retrieval" but CapabilityOntology
    // reports retrieval=missing/n/a. Suggests ResponsibilityAnalyzer false positive.
    const retrievalRespModules = (resp.responsibilities || []).filter(
      (r) => r.responsibility === "Retrieval"
    );
    if (retrievalRespModules.length > 0) {
      const capRetrieval = matrix.retrieval;
      if (capRetrieval === "missing" || capRetrieval === "n/a" || capRetrieval === undefined) {
        contradictions.push({
          id: `C${contradictions.length + 1}`,
          topic: "Retrieval capability",
          severity: "medium",
          sourceA: {
            analyzer: "ResponsibilityAnalyzer",
            claim: `tagged ${retrievalRespModules.length} module(s) as Retrieval: ${retrievalRespModules.slice(0, 3).map((m) => m.module).join(", ")}`,
          },
          sourceB: {
            analyzer: "CapabilityOntology",
            claim: `retrieval=${capRetrieval || "undefined"}`,
          },
          interpretation:
            "ResponsibilityAnalyzer may have false-positive Retrieval classification (keyword 'retriev'/'search'/'query' matched non-RAG symbols). CapabilityOntology found no retrieval evidence (no vector store, no embed, no RAG pipeline).",
          recommendation:
            "LLM should inspect the Retrieval-tagged module's actual symbols — if they are non-AI search/query (DB query, file search), classify as ResponsibilityAnalyzer false positive.",
        });
      }
    }

    // ── C3: Tools count vs CapabilityOntology "tool" coverage ───────────
    // ToolsAnalyzer detected many tools but CapabilityOntology says tool=missing.
    // Should not happen (CapabilityOntology auto-adds tool capability from
    // ToolsAnalyzer output), but if it does, indicates a bug.
    const toolCount = (tools.tools || []).length;
    const capTool = matrix.tool;
    if (toolCount >= 3 && (capTool === "missing" || capTool === "n/a")) {
      contradictions.push({
        id: `C${contradictions.length + 1}`,
        topic: "Tool capability",
        severity: "high",
        sourceA: { analyzer: "ToolsAnalyzer", claim: `detected ${toolCount} tools` },
        sourceB: { analyzer: "CapabilityOntology", claim: `tool=${capTool}` },
        interpretation:
          "CapabilityOntology should auto-mark tool capability from ToolsAnalyzer output. A 'missing' result with ≥3 tools indicates either a CapabilityOntology bug or the AI-context gate rejected the project.",
        recommendation: "LLM should note this as an analyzer bug; trust ToolsAnalyzer's count.",
      });
    }

    // ── C4: ArchitecturePattern vs Responsibility distribution ──────────
    // Pattern=Microservices but no module tagged "Service/API" → warning.
    // Pattern=Plugin but no module tagged "Plugin Interface" → warning.
    // These are warnings (not contradictions) — pattern detection is allowed
    // to use signals ResponsibilityAnalyzer doesn't cover.
    const primaryPattern = archPattern.primaryPattern;
    if (primaryPattern && primaryPattern !== "Unknown") {
      const respSet = new Set((resp.responsibilities || []).map((r) => r.responsibility));
      if (primaryPattern === "Microservices" && !respSet.has("API") && !respSet.has("Service")) {
        warnings.push({
          id: `W${warnings.length + 1}`,
          topic: "Pattern-Responsibility coverage",
          severity: "low",
          sourceA: { analyzer: "ArchitecturePatternAnalyzer", claim: "primaryPattern=Microservices" },
          sourceB: { analyzer: "ResponsibilityAnalyzer", claim: "no module tagged 'API' or 'Service'" },
          interpretation:
            "Pattern detection may have triggered on directory names like 'service/' without semantic confirmation. Microservices pattern expects service-tier responsibilities.",
        });
      }
      if (primaryPattern === "Plugin" && !respSet.has("Plugin Interface")) {
        warnings.push({
          id: `W${warnings.length + 1}`,
          topic: "Pattern-Responsibility coverage",
          severity: "low",
          sourceA: { analyzer: "ArchitecturePatternAnalyzer", claim: "primaryPattern=Plugin" },
          sourceB: { analyzer: "ResponsibilityAnalyzer", claim: "no module tagged 'Plugin Interface'" },
          interpretation:
            "Plugin pattern detected via 'plugins/' dir or extension-point symbols, but no module has Plugin-Interface responsibility. May indicate ResponsibilityAnalyzer keyword gap, or plugins/ contains unrelated code.",
        });
      }
    }

    // ── C5: Tests present vs Evaluations absent ─────────────────────────
    // Common gap: tests exist but no eval infrastructure. Not a contradiction
    // (tests != evals) but worth flagging as a research-relevant warning.
    const testCount = tests.totalTestFiles || 0;
    const evalFileCount = (evals.evalFiles || []).length;
    if (testCount >= 10 && evalFileCount === 0 && !evals.hasEvaluation) {
      warnings.push({
        id: `W${warnings.length + 1}`,
        topic: "Test vs Evaluation coverage",
        severity: "medium",
        sourceA: { analyzer: "TestsAnalyzer", claim: `${testCount} test files` },
        sourceB: { analyzer: "EvaluationsAnalyzer", claim: "0 eval files, hasEvaluation=false" },
        interpretation:
          "Project has substantial test suite but no eval infrastructure. For AI projects, this means unit/integration tests exist but no benchmark/leaderboard/quality-eval harness. May be acceptable (pre-eval stage) or a gap.",
        recommendation: "LLM should note this in Negative Findings: 'No evaluation infrastructure despite test coverage'.",
      });
    }

    // ── C6: InformationFlow LLM call sites vs CapabilityOntology isAIProject ──
    // Subset of C1 but specifically for LLM call sites — these are the strongest
    // AI signal and most surprising when CapabilityOntology says not-AI.
    if (!isAI && (infoFlow.llmCallSites || []).length > 0) {
      // Already covered by C1 if other AI signals exist; only emit separate
      // contradiction if C1 did not fire (i.e., LLM call sites are the ONLY signal).
      const otherSignals =
        (prompts.prompts || []).length > 0 ||
        (tools.tools || []).length > 0 ||
        (resp.responsibilities || []).some((r) => r.responsibility === "LLM Interface");
      if (!otherSignals) {
        contradictions.push({
          id: `C${contradictions.length + 1}`,
          topic: "LLM call sites vs AI classification",
          severity: "high",
          sourceA: { analyzer: "CapabilityOntology", claim: "isAIProject=false" },
          sourceB: {
            analyzer: "InformationFlowAnalyzer",
            claim: `found ${(infoFlow.llmCallSites || []).length} LLM call sites`,
          },
          interpretation:
            "InformationFlowAnalyzer detected LLM call sites via regex (openai/anthropic/claude/gpt/...). CapabilityOntology's AI-context gate should have triggered on this — possible gate logic bug, OR InformationFlowAnalyzer false positive (e.g., LLM_NAME_RE matched a variable named 'completions' that's not LLM-related).",
          recommendation:
            "LLM should verify LLM call sites by reading the actual file — if false positive, note InformationFlowAnalyzer over-broad regex; if real, note CapabilityOntology gate bug.",
        });
      }
    }

    // ── C7: AI project classification vs InformationFlow LLM reachability ──
    // CapabilityOntology says isAIProject=true but InformationFlowAnalyzer
    // found no LLM call sites or no flows reach LLM. This is a contradiction —
    // if it's an AI project, there should be LLM calls somewhere.
    if (isAI && (infoFlow.llmCallSites || []).length === 0) {
      contradictions.push({
        id: `C${contradictions.length + 1}`,
        topic: "AI project classification vs LLM call sites",
        severity: "high",
        sourceA: { analyzer: "CapabilityOntology", claim: "isAIProject=true" },
        sourceB: {
          analyzer: "InformationFlowAnalyzer",
          claim: "0 LLM call sites detected",
        },
        interpretation:
          "CapabilityOntology classified this as an AI project (has prompts/tools/LLM-Interface responsibility) but InformationFlowAnalyzer found no LLM call sites via regex. Possible causes: (1) LLM calls use non-standard names not in LLM_NAME_RE, (2) LLM calls are in files not parsed by SymbolsAnalyzer, (3) AI project classification is a false positive (prompts/tools are test fixtures or docs).",
        recommendation:
          "LLM should verify by searching for actual LLM API calls (openai.chat.completions.create, anthropic.messages.create, etc.) in source code. If real LLM calls exist, note InformationFlowAnalyzer regex gap; if not, note CapabilityOntology false positive.",
      });
    }

    // ── C8: LLM call sites exist but no flow reaches LLM ─────────────────
    // InformationFlowAnalyzer detected LLM call sites (regex on symbol names)
    // but none of the BFS-traversed flows reach them. This is a strong
    // contradiction — the call sites exist in source, but the static call
    // graph cannot connect entrypoints to them. Common root causes:
    //   (1) SDK method-chain calls: `client.chat.completions.create()` — the
    //       call site is a method on a dynamically-typed client object, not
    //       a top-level function SymbolsAnalyzer indexed.
    //   (2) Spawned subprocess: daemon calls `spawn('claude', [...])` and
    //       parses stdout — LLM inference happens in the child process,
    //       invisible to the parent's static call graph.
    //   (3) Framework routing: FastAPI `@router.post(...)` registers handlers
    //       at runtime via dependency injection; BFS on import graph cannot
    //       traverse route → handler → service → LLM call site.
    //   (4) Rust mod/use not resolved: LLM call site node has 0 in/out edges
    //       in the architecture graph, so BFS never reaches it.
    // Observed on buzz/unsloth/open-design/openworker/worldmonitor.
    const llmCallSites = (infoFlow.llmCallSites || []).length;
    const totalFlows = (infoFlow.flows || []).length;
    const flowsReachingLLM = (infoFlow.flows || []).filter((f) => f.reachesLLM).length;
    if (llmCallSites > 0 && totalFlows > 0 && flowsReachingLLM === 0) {
      contradictions.push({
        id: `C${contradictions.length + 1}`,
        topic: "LLM call sites exist but no flow reaches them",
        severity: "high",
        sourceA: {
          analyzer: "InformationFlowAnalyzer",
          claim: `detected ${llmCallSites} LLM call site(s) via regex`,
        },
        sourceB: {
          analyzer: "InformationFlowAnalyzer",
          claim: `all ${totalFlows} BFS flow(s) have reachesLLM=false`,
        },
        interpretation:
          "InformationFlowAnalyzer found LLM-related symbol names (regex match) but its BFS over the static import graph cannot connect any entrypoint to those call sites. This is a known limitation when LLM calls happen via: (1) SDK method chains on dynamic client objects (e.g., client.chat.completions.create), (2) spawned subprocesses where LLM inference is in the child, (3) framework runtime routing (FastAPI deps, Spring DI, Eclipse extension points), (4) Rust mod/use unresolved to full module paths. The call sites ARE real; the flow conclusion is the unreliable signal.",
        recommendation:
          "LLM should treat flowsReachingLLM=0 as 'unknown — analyzer cannot trace this call graph shape', NOT as 'no LLM is invoked'. Verify by grep for actual LLM SDK calls (openai.chat.completions.create, anthropic.messages.create, client.messages.create, etc.) in source. If real LLM calls exist, downgrade F-003-style 'none reach LLM' findings to 'unknown'.",
      });
    }

    // ── Summary ─────────────────────────────────────────────────────────
    const totalContradictions = contradictions.length;
    const totalWarnings = warnings.length;
    const overall = totalContradictions > 0 ? "has-conflicts" : totalWarnings > 0 ? "has-warnings" : "stable";

    store[this.id] = {
      contradictions,
      warnings,
      summary: {
        totalContradictions,
        totalWarnings,
        overall,
        message:
          overall === "stable"
            ? "No cross-analyzer contradictions detected. All analyzers agree."
            : overall === "has-warnings"
            ? `${totalWarnings} warning(s) — analyzers agree on major claims but minor inconsistencies exist.`
            : `${totalContradictions} contradiction(s) and ${totalWarnings} warning(s) — analyzers disagree on major claims. LLM should prioritize investigation.`,
      },
    };
  }
}


export {
  // Pattern signatures
  ARCHITECTURE_PATTERNS,
  RESPONSIBILITY_RULES,
  CAPABILITY_ONTOLOGY,
  // Tokenizer
  tokenizeSymbol,
  symbolTokensMatchKw,
  // Inference engines
  ArchitecturePatternAnalyzer,
  ResponsibilityAnalyzer,
  StabilityAnalyzer,
  ChangeCouplingAnalyzer,
  InformationFlowAnalyzer,
  DependencySmellAnalyzer,
  CapabilityOntologyAnalyzer,
  DecisionAnalyzer,
  ConstraintAnalyzer,
  AssumptionAnalyzer,
  ArchitectureMetricsAnalyzer,
  TemporalAnalyzer,
  ConsistencyAnalyzer,
};
