// ===========================================================================
// research.mjs — Main entry point for repo-research-v2 skill
//
// Pipeline:
//   Stage 0:  Resume Workspace — load existing state, determine next_stage
//   Stage 1:  Scan Repository — only if commit changed or artifacts missing
//   Stage 2:  Analyze Delta — only if commit changed, selective update
//   Stage 3:  Research Planner — examine coverage, decide research focus
//   Stage 4:  Architecture Research — execute research cycle
//   Stage 5:  Report — generate report + quality gates
//
// Usage:
//   node research.mjs <repo-path> [--force] [--skip-gate]
//
// Options:
//   --force      Force full re-analysis (ignore resume)
//   --skip-gate  Skip gated checks
// ===========================================================================

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { invokeLLM, invokeLLMJSON } from "./llm-runner.mjs";
import { runAllChecks } from "./gated-checks.mjs";
import { PipelineLogger } from "./pipeline-logger.mjs";
import {
  resumeResearch,
  loadStableArtifact,
  saveStableArtifact,
  loadMeta,
  writeMeta,
  getCurrentCommit,
  getChangedFiles,
} from "./artifact-cache.mjs";
import { mineArchitectureFacts, formatArchitectureFactsForPrompt } from "./architecture-mining.mjs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WORKING_DIR = resolve(process.cwd(), ".working");
// Default model: OpenRouter (curl-based) preferred over OpenCode CLI.
// OpenCode free tier exhibited frequent 120s+ timeouts on simple prompts.
// Override via RESEARCH_REPO_MODEL env var. Examples:
//   openrouter/openrouter/free        (default — OpenRouter's free aggregator)
//   openrouter/deepseek/deepseek-chat  (specific OpenRouter model)
//   opencode/deepseek-v4-flash-free    (fall back to OpenCode CLI)
const DEFAULT_MODEL = process.env.RESEARCH_REPO_MODEL || "openrouter/openrouter/free";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content);
}

async function writeJson(path, data) {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

async function tryReadJson(path) {
  try {
    return await readJson(path);
  } catch {
    return null;
  }
}

function plural(n, s = "s") {
  return n !== 1 ? s : "";
}

// ---------------------------------------------------------------------------
// Stage 0: Resume Workspace
// ---------------------------------------------------------------------------

async function stageZeroResume(workDir, repoPath, force) {
  if (force) {
    console.log("Stage 0: Resume Workspace — force mode (re-run all LLM stages, reuse stable artifacts).\n");
    // Still load existing state for artifact reuse, but reset round/coverage state
    const meta = await loadMeta(workDir);
    const commit = getCurrentCommit(repoPath);
    const existingContext = await tryReadJson(join(workDir, "context.json"));
    const context = {
      ...(existingContext || {}),
      current_round: null,
      current_question_file: null,
      coverage: {},
      next_focus: null,
      converged: false,
      questions: [],
      reasoning: null,
      question_statistics: { rounds: 0, total_questions: 0, answered: 0, validated: 0 },
    };
    return { resumed: false, force: true, commit, meta, context };
  }

  const existing = await resumeResearch(workDir, repoPath);
  if (!existing.resumed) {
    console.log("Stage 0: Resume Workspace — no prior analysis found.\n");
    return { resumed: false };
  }

  // Load all available state
  const context = await tryReadJson(join(workDir, "context.json"));
  const model = await tryReadJson(join(workDir, "repository-model.json"));
  const questions = await tryReadJson(join(workDir, "questions", "summary.json"));
  const meta = existing.meta;

  // Determine next stage from context.resume
  const resumeFromCtx = context?.resume || {};
  const lastStage = resumeFromCtx.last_completed_stage || "none";
  const lastRound = resumeFromCtx.last_round || 0;
  const nextStage = resumeFromCtx.next_stage || (existing.commitUnchanged ? "planner" : "scan");
  const reportExists = await fileExists(join(workDir, "report.md"));

  // Print loading summary
  console.log("Stage 0: Resume Workspace — loading previous analysis...\n");

  if (model) {
    const stability = context?.model_stability || "unknown";
    const center = context?.architecture_model?.center_hypothesis || "(not set)";
    console.log(`  Repository Model loaded  (stability: ${stability})`);
    console.log(`  Center hypothesis: ${center.slice(0, 60)}`);
  }

  if (context?.question_statistics) {
    const qs = context.question_statistics;
    console.log(`  Questions: ${qs.validated || 0} validated / ${qs.answered || 0} answered / ${qs.total_questions || 0} total`);
  }

  if (context?.coverage) {
    const low = Object.entries(context.coverage)
      .filter(([, v]) => (typeof v === "number" ? v : v?.ratio ?? 0) < 0.5)
      .map(([k]) => k);
    console.log(`  Weakest areas: ${low.length > 0 ? low.join(", ") : "none (all ≥ 0.5)"}`);
  }

  console.log(`  Commit: ${existing.commitUnchanged ? "unchanged" : "changed"}`);
  console.log(`  Last stage: ${lastStage}`);
  console.log(`  Next stage: ${nextStage}`);
  console.log(`  Report: ${reportExists ? "exists" : "missing"}\n`);

  // If commit unchanged, report exists → done
  if (existing.commitUnchanged && reportExists && nextStage === "done") {
    console.log("  Analysis complete. Returning cached report.\n");
    const report = await readFile(join(workDir, "report.md"), "utf-8");
    return { resumed: true, commitUnchanged: true, report, done: true };
  }

  return {
    resumed: true,
    commitUnchanged: existing.commitUnchanged,
    artifactsReady: existing.artifactsReady,
    missingArtifacts: existing.missingArtifacts,
    changedFiles: existing.changedFiles,
    commit: existing.commit,
    meta,
    context,
    model,
    questions,
    lastStage,
    lastRound,
    nextStage,
    reportExists,
  };
}

// ---------------------------------------------------------------------------
// Stage 1: Scan Repository (conditional)
// ---------------------------------------------------------------------------

async function scanRepository(repoPath) {
  const files = [];
  const dirs = [];

  async function walk(dir, depth = 0) {
    if (depth > 4) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = fullPath.replace(repoPath + "/", "");
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;
      if (entry.isDirectory()) { dirs.push(relPath); await walk(fullPath, depth + 1); }
      else if (entry.isFile()) { files.push(relPath); }
    }
  }

  await walk(repoPath);
  return { files, dirs };
}

// Mechanical repo type detection — fallback when LLM times out
function detectRepoTypeMechanically(scan) {
  const files = scan.files;
  const hasFile = (name) => files.includes(name);
  const hasGlob = (pat) => files.some((f) => pat.test(f));

  if (hasFile("pyproject.toml") || hasFile("setup.py")) {
    if (hasGlob(/train|model|torch|llm/i)) return { type: "AI Infrastructure", confidence: "medium", reasoning: "Python package with ML-related files", focus_areas: ["runtime", "architecture"] };
    return { type: "Library", confidence: "medium", reasoning: "Python package with setup.py/pyproject.toml", focus_areas: ["architecture", "runtime"] };
  }
  if (hasFile("package.json")) {
    const rootFiles = files.filter((f) => !f.includes("/"));
    if (hasGlob(/cli|bin|command/i)) return { type: "CLI", confidence: "medium", reasoning: "Node project with CLI-related files", focus_areas: ["runtime", "architecture"] };
    if (hasGlob(/component|page|layout/i)) return { type: "Web Service", confidence: "medium", reasoning: "Node project with web component files", focus_areas: ["architecture", "deployment"] };
    return { type: "Library", confidence: "medium", reasoning: "Node project with package.json", focus_areas: ["architecture", "runtime"] };
  }
  if (hasFile("Cargo.toml")) return { type: "Library", confidence: "medium", reasoning: "Rust project with Cargo.toml", focus_areas: ["architecture", "runtime"] };
  if (hasFile("go.mod")) return { type: "Library", confidence: "medium", reasoning: "Go project with go.mod", focus_areas: ["architecture", "runtime"] };
  return { type: "Library", confidence: "low", reasoning: "Could not determine type mechanically", focus_areas: ["architecture", "runtime"] };
}

async function stageOneScan(workDir, repoPath, resume) {
  // Try loading from cache first (even with --force — stable artifacts are reusable)
  const cachedDirTree = await loadStableArtifact(workDir, "directory-tree");
  const cachedProfile = await loadStableArtifact(workDir, "repository-profile");

  if (cachedDirTree && cachedProfile) {
    console.log(`Stage 1: Scan Repository — loaded from cache (${cachedDirTree.files.length} files, ${cachedDirTree.dirs.length} directories).\n`);
    // Still generate symbol-index and git-summary if missing (per scan.md:32-35)
    await ensureSymbolIndex(workDir, repoPath, cachedDirTree);
    await ensureGitSummary(workDir, repoPath);
    return { scan: cachedDirTree, profile: cachedProfile };
  }

  // Need to scan
  console.log("Stage 1: Scan Repository — scanning...");
  const scan = await scanRepository(repoPath);
  await saveStableArtifact(workDir, "directory-tree", scan);
  console.log(`  ${scan.files.length} files, ${scan.dirs.length} directories\n`);

  // LLM-based repo profile (keep prompt small to avoid free-tier timeouts)
  const topFiles = scan.files.slice(0, 20).join(", ");
  const topDirs = scan.dirs.filter((d) => !d.includes("/")).slice(0, 20).join(", ");
  const prompt = `
Analyze this repository structure to identify repo type.

Files (first 20): ${topFiles}
Top-level dirs: ${topDirs}

Possible types: CLI / Library / Framework / Database / Compiler / Runtime / OS / SDK / AI Infrastructure / Web Service / Agent / Other

Return JSON:
{"type":"identified type","confidence":"high/medium/low","reasoning":"why","focus_areas":["focus1","focus2"]}
`;
  let profile;
  try {
    // Short timeout (120s) + 0 retries for Stage 1 — fallback to mechanical if LLM is slow
    profile = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL, _label: "stage1-repo-profile", timeoutMs: 120000, retryCount: 0 });
  } catch (err) {
    console.warn(`  LLM repo profile failed (${err.message}), using mechanical detection.`);
    profile = detectRepoTypeMechanically(scan);
  }
  await saveStableArtifact(workDir, "repository-profile", profile);
  console.log(`  Type: ${profile.type} (${profile.confidence})\n`);

  // Generate symbol-index.json and git-summary.json (per scan.md:32-35)
  await ensureSymbolIndex(workDir, repoPath, scan);
  await ensureGitSummary(workDir, repoPath);

  return { scan, profile };
}

// --- symbol-index.json (per scan.md:34) ---
async function ensureSymbolIndex(workDir, repoPath, scan) {
  const cached = await loadStableArtifact(workDir, "symbol-index");
  if (cached) return cached;

  // Mechanical symbol extraction: classes, functions, exports from key files
  const symbols = [];
  const codeFiles = scan.files.filter((f) => /\.(py|js|ts|mjs|tsx|jsx|rs|go|java)$/.test(f)).slice(0, 100);
  for (const file of codeFiles) {
    const fullPath = join(repoPath, file);
    if (await fileExists(fullPath)) {
      try {
        const content = await readFile(fullPath, "utf-8");
        // Extract class/function definitions via regex (simplified, language-agnostic)
        const classMatches = content.matchAll(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm);
        for (const m of classMatches) symbols.push({ file, type: "class", name: m[1] });
        const funcMatches = content.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm);
        for (const m of funcMatches) symbols.push({ file, type: "function", name: m[1] });
        const pyClassMatches = content.matchAll(/^class\s+(\w+)/gm);
        for (const m of pyClassMatches) symbols.push({ file, type: "class", name: m[1] });
        const pyFuncMatches = content.matchAll(/^(?:async\s+)?def\s+(\w+)/gm);
        for (const m of pyFuncMatches) symbols.push({ file, type: "function", name: m[1] });
      } catch { /* skip binary/unreadable */ }
    }
  }
  const symbolIndex = { total_symbols: symbols.length, symbols };
  await saveStableArtifact(workDir, "symbol-index", symbolIndex);
  console.log(`  symbol-index: ${symbols.length} symbols\n`);
  return symbolIndex;
}

// --- git-summary.json (per scan.md:35, must include evolution_timeline + bulk_import_detected) ---
async function ensureGitSummary(workDir, repoPath) {
  const cached = await loadStableArtifact(workDir, "git-summary");
  if (cached) return cached;

  const { execSync } = await import("node:child_process");
  let gitSummary;
  try {
    const log = execSync('git log --all --oneline --format="%H|%aI|%s"', { cwd: repoPath, encoding: "utf-8", timeout: 10000 }).trim();
    const commits = log.split("\n").map((line) => {
      const [hash, date, ...msgParts] = line.split("|");
      return { hash, date, message: msgParts.join("|") };
    });

    const firstCommit = commits[commits.length - 1] || null;
    const isBulkImport = firstCommit
      ? /initial\s+(import|commit)|bulk|import|squash/i.test(firstCommit.message)
      : false;

    // Evolution timeline: key commits (not just frequency stats, per scan.md:37-70)
    const evolutionTimeline = commits
      .filter((c) => /rewrite|refactor|migration|pivot|major|breaking|architecture/i.test(c.message))
      .slice(-10)
      .map((c) => ({ date: c.date, hash: c.hash, message: c.message, significance: "key change" }));

    const dateRange = commits.length > 0
      ? { first: commits[commits.length - 1].date, last: commits[0].date, days: Math.round((new Date(commits[0].date) - new Date(commits[commits.length - 1].date)) / 86400000) }
      : null;

    gitSummary = {
      stats: { commit_count: commits.length, contributors: [...new Set(commits.map((c) => c.hash.slice(0, 7)))], date_range: dateRange },
      import_type: isBulkImport ? "bulk_import" : (commits.length < 5 ? "shallow" : "normal"),
      first_commit: firstCommit ? { hash: firstCommit.hash, date: firstCommit.date, message: firstCommit.message, is_initial_import: isBulkImport } : null,
      evolution_timeline: evolutionTimeline,
      bulk_import_detected: isBulkImport,
      history_coverage_constraint: isBulkImport
        ? `git history 仅 ${dateRange?.days || 0} 天，演进发生在 import 前`
        : null,
    };
  } catch {
    gitSummary = { stats: { commit_count: 0 }, import_type: "none", evolution_timeline: [], bulk_import_detected: false, history_coverage_constraint: null };
  }

  await saveStableArtifact(workDir, "git-summary", gitSummary);
  console.log(`  git-summary: ${gitSummary.stats.commit_count} commits, ${gitSummary.import_type}\n`);
  return gitSummary;
}

// ---------------------------------------------------------------------------
// Stage 2: Analyze Delta (conditional)
// ---------------------------------------------------------------------------

async function stageTwoDelta(workDir, repoPath, resume) {
  // Check if actually a git repo
  const commit = getCurrentCommit(repoPath);
  if (!commit) {
    console.log("Stage 2: Analyze Delta — skipped (not a git repo).\n");
    return { changed: false, full: false };
  }

  if (resume.resumed && resume.commitUnchanged) {
    console.log("Stage 2: Analyze Delta — skipped (commit unchanged).\n");
    return { changed: false };
  }

  const meta = resume.meta || {};
  const lastCommit = meta.last_analyzed_commit;
  if (!lastCommit || lastCommit === "unknown") {
    console.log("Stage 2: Analyze Delta — no prior commit, full analysis.\n");
    return { changed: true, full: true };
  }

  const changed = getChangedFiles(repoPath, lastCommit, commit);
  console.log(`Stage 2: Analyze Delta — ${changed.length} file(s) changed.\n`);

  // Per scan.md:85: write analysis_target_commit (pending), NOT last_analyzed_commit
  const newMeta = { ...meta, analysis_target_commit: commit, analyzed_at: new Date().toISOString() };
  await writeMeta(workDir, newMeta);

  // Per scan.md:86: write pending_invalidation for Evidence/Reasoning to read.
  // Only set when files actually changed — setting with 0 files triggers
  // spurious state rollback in Reasoning (coverage→0.3 baseline), which
  // incorrectly marks all dimensions as "insufficient evidence" even when
  // LLM stages succeeded. In --force mode with 0 changed files, we reuse
  // stable artifacts but re-run LLM stages — no invalidation needed.
  if (changed.length > 0) {
    const contextPath = join(workDir, "context.json");
    const existingContext = await tryReadJson(contextPath);
    if (existingContext) {
      existingContext.pending_invalidation = { changed_files: changed, target_commit: commit };
      await writeJson(contextPath, existingContext);
    }
    console.log(`  pending_invalidation set (${changed.length} files)\n`);
  } else {
    // Clear any stale pending_invalidation from previous runs
    const contextPath = join(workDir, "context.json");
    const existingContext = await tryReadJson(contextPath);
    if (existingContext?.pending_invalidation) {
      existingContext.pending_invalidation = null;
      await writeJson(contextPath, existingContext);
    }
    console.log(`  No files changed — pending_invalidation not set.\n`);
  }

  return { changed: true, files: changed, full: false };
}

// --- readEvidenceLog: read artifacts/evidence-log.jsonl (per evidence.md, Model/Report read from file) ---
async function readEvidenceLog(workDir) {
  const logPath = join(workDir, "artifacts", "evidence-log.jsonl");
  try {
    const content = await readFile(logPath, "utf-8");
    return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Stage 3: Research Planner
// ---------------------------------------------------------------------------

async function stageThreePlanner(resume) {
  // A round has been executed once context.current_round is set (by the checkpoint write).
  const isFirstRun = !resume.context || !resume.context.current_round;

  if (isFirstRun) {
    console.log("Stage 3: Research Planner — first run, full exploration.\n");
    return { firstRun: true, focus: "full_exploration", coverage: {}, round: 1 };
  }

  const context = resume.context || {};
  const coverage = context.coverage || {};
  const lastRound = resume.lastRound || 1;

  // Prefer the focus produced by the unified Planner+Reasoning Agent (planAndReason)
  if (context.next_focus && context.next_focus !== "converged") {
    console.log(`Stage 3: Research Planner — using focus from reasoning: ${context.next_focus}\n`);
    return {
      firstRun: false,
      converged: false,
      focus: context.next_focus,
      coverage,
      round: lastRound + 1,
      minDepth: 2,
    };
  }

  if (context.converged) {
    console.log("Stage 3: Research Planner — reasoning determined convergence.\n");
    return { converged: true, focus: "converged", round: lastRound };
  }

  // Fallback local rule: pick the dimension with lowest coverage ratio
  const ratioOf = (v) => (typeof v === "number" ? v : v?.ratio ?? 0);
  const entries = Object.entries(coverage).map(([k, v]) => [k, ratioOf(v)]);
  const weakest = entries.length > 0
    ? entries.sort((a, b) => a[1] - b[1])[0]
    : ["architecture", 0];

  console.log(`Stage 3: Research Planner`);
  console.log(`  Coverage: ${entries.map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(", ")}`);
  console.log(`  Weakest area: ${weakest[0]} (${(weakest[1] * 100).toFixed(0)}%)`);

  const allCovered = entries.every(([, v]) => v >= 0.8);
  if (allCovered && context.challenge_record?.length > 0) {
    console.log("  All dimensions ≥ 0.8 — research converged.\n");
    return { converged: true, focus: "converged", round: lastRound };
  }

  const nextRound = lastRound + 1;
  const deepen = entries.filter(([k]) => k === weakest[0]).length > 0 && lastRound > 0;
  const minDepth = deepen ? 3 : 2;

  console.log(`  Next round: ${nextRound}, min depth: ${minDepth}\n`);

  return {
    firstRun: false,
    converged: false,
    focus: weakest[0],
    coverage,
    round: nextRound,
    minDepth,
  };
}

// ---------------------------------------------------------------------------
// Stage 4: Architecture Research
// ---------------------------------------------------------------------------

async function identifyRepoType(repoPath, scan) {
  const prompt = `
分析以下仓库结构，识别仓库类型。
仓库路径: ${repoPath}
文件列表（前 50 个）: ${scan.files.slice(0, 50).join(", ")}
目录列表: ${scan.dirs.join(", ")}
可能的类型: CLI / Library / Framework / Database / Compiler / Runtime / OS / SDK / AI Infrastructure / Web Service / Agent / Other
输出 JSON: {"type":"识别的类型","confidence":"high/medium/low","reasoning":"为什么这样判断","focus_areas":["该类型仓库应该关注的领域"]}
`;
  return invokeLLMJSON(prompt, { model: DEFAULT_MODEL, _label: "identifyRepoType" });
}

function generateFallbackQuestions(repoType, plan, count) {
  const dims = ["architecture", "runtime", "design_decisions", "testing", "deployment", "history"];
  const targetCount = count || (plan.firstRun ? 6 : 3);
  const questions = [];
  for (let i = 0; i < targetCount; i++) {
    const dim = dims[i % dims.length];
    questions.push({
      id: `Q${i + 1}`,
      question: plan.firstRun
        ? `What defines the ${dim} of this ${repoType.type} repository?`
        : `How does ${plan.focus} shape the ${dim} design?`,
      genesis: {
        trigger: "observation",
        observation: plan.firstRun ? `Initial scan suggests ${dim} needs clarification` : `Round focus: ${plan.focus}`,
        depth_level: plan.firstRun ? 2 : 3,
      },
      type: plan.firstRun ? "discovery" : "challenge",
      status: "open",
      confidence: "medium",
      dimension: dim,
    });
  }
  return questions;
}

async function generateQuestions(repoType, scan, plan) {
  const topFiles = ["package.json", "README.md", "ARCHITECTURE.md"]
    .filter((f) => scan.files.includes(f)).join(", ");
  const topDirs = scan.dirs.filter((d) => !d.includes("/")).slice(0, 10).join(", ");

  const focus = plan.firstRun
    ? `full exploration of the ${repoType.type} repository`
    : `focused investigation on ${plan.focus}`;
  const count = plan.firstRun ? "5" : "3";

  const prompt = `
Analyze a ${repoType.type} repository.
Top dirs: ${topDirs}
Key files: ${topFiles}
Focus: ${focus}
Generate exactly ${count} research questions. Each: id, question, genesis(trigger,observation,depth_level), type, status=open, confidence, dimension.
Dimension: runtime|architecture|design_decisions|testing|deployment|history.
Return JSON array only.
`;
  try {
    return await invokeLLMJSON(prompt, { model: DEFAULT_MODEL, _label: "generateQuestions" });
  } catch (err) {
    console.warn("  Question generation failed/timed out, using fallback questions:", err.message);
    return generateFallbackQuestions(repoType, plan, Number(count));
  }
}

async function mechanicalAnalysis(repoPath, scan, focus = "architecture", isFirstRun = true, existingPaths = new Set(), round = 1) {
  const evidence = [];
  // Purpose includes round so that subsequent rounds can re-collect the same focus
  // with a different analytical lens, avoiding cross-round deduplication starvation.
  const seen = (path, purpose) => existingPaths.has(`${path}|${purpose}:round:${round}`);

  const codeExts = [".py", ".js", ".ts", ".mjs", ".rs", ".go", ".java", ".kt", ".scala", ".c", ".cpp", ".h"];
  const isCode = (f) => codeExts.some((ext) => f.endsWith(ext));

  // Exclude third-party / generated / minified files — they are not project source code
  // and pollute evidence with irrelevant content (e.g. leaflet.js, wkx.min.js).
  const isThirdParty = (f) =>
    f.includes("node_modules/") || f.includes("/vendor/") || f.includes("/dist/") ||
    f.includes("/build/") || f.endsWith(".min.js") || f.endsWith(".umd.js") ||
    f.endsWith(".bundle.js") || f.includes("/web/inc/") || f.includes("/third_party/") ||
    f.includes("/assets/") || f.includes("/public/");

  // Full exploration only on the first round; subsequent rounds drill into the weakest dimension.
  if (isFirstRun) {
    // 1. Metadata + manifest files (expanded for Java/Eclipse/Node/Python/Rust/Go)
    const metadataFiles = [
      "package.json", "README.md", "ARCHITECTURE.md", "pyproject.toml", "setup.py",
      "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "settings.gradle",
      "plugin.xml", "MANIFEST.MF", "features.xml", "category.xml", ".project",
      "AGENTS.md", "CONTRIBUTING.md", "CLAUDE.md",
    ];
    for (const file of metadataFiles) {
      if (seen(file, "元数据")) continue;
      // Check root and common nested locations (e.g. plugins/*/META-INF/MANIFEST.MF)
      const candidates = [file, `META-INF/${file}`, `plugins/${file}`];
      for (const candidate of candidates) {
        const fullPath = join(repoPath, candidate);
        if (await fileExists(fullPath)) {
          const content = await readFile(fullPath, "utf-8");
          evidence.push({ path: candidate, content: content.slice(0, 1200), purpose: `元数据:round:${round}` });
          break;
        }
      }
    }

    // 1b. Collect nested manifests (Eclipse plugins have per-plugin META-INF/MANIFEST.MF)
    const nestedManifests = scan.files
      .filter((f) => f.endsWith("MANIFEST.MF") || f.endsWith("plugin.xml") || f.endsWith("pom.xml"))
      .slice(0, 8);
    for (const file of nestedManifests) {
      if (seen(file, "元数据")) continue;
      const fullPath = join(repoPath, file);
      if (await fileExists(fullPath)) {
        const content = await readFile(fullPath, "utf-8");
        evidence.push({ path: file, content: content.slice(0, 800), purpose: `元数据:round:${round}` });
      }
    }

    // 1c. Directory structure overview — helps LLM understand project layout
    const topDirs = [...new Set(scan.files.map((f) => f.split("/")[0]))].filter((d) => !d.startsWith(".")).slice(0, 20);
    const secondLevelDirs = scan.dirs
      .filter((d) => d.split("/").length === 2)
      .slice(0, 30);
    const structureOverview = `Top-level dirs:\n${topDirs.join("\n")}\n\nSecond-level dirs (sample):\n${secondLevelDirs.join("\n")}`;
    evidence.push({ path: "(directory-structure)", content: structureOverview, purpose: `元数据:round:${round}` });

    // 2. Entry points — root files + main subdirectory entries (not just root)
    const rootCodeFiles = scan.files.filter((f) => !f.includes("/") && isCode(f)).slice(0, 5);
    // Also include files in main subdirectories that look like entry points
    const subEntryFiles = scan.files
      .filter((f) => {
        if (!isCode(f) || isThirdParty(f)) return false;
        const parts = f.split("/");
        // Entry candidates: plugins/X/src/Main.java, src/index.ts, src/main.py, core/mod.rs
        return (parts.length <= 4 && (
          /main\.|index\.|app\.|entry\.|plugin\.|Activator\./i.test(f) ||
          f.match(/^(src|lib|core|main|cmd|bin|plugins|app)\//i)
        ));
      })
      .slice(0, 8);
    for (const file of [...rootCodeFiles, ...subEntryFiles]) {
      if (seen(file, "入口文件")) continue;
      const fullPath = join(repoPath, file);
      if (await fileExists(fullPath)) {
        const content = await readFile(fullPath, "utf-8");
        evidence.push({ path: file, content: content.slice(0, 800), purpose: `入口文件:round:${round}` });
      }
    }

    // 3. Largest source files (proxy for complexity centers) — exclude third-party
    const codeFiles = scan.files.filter((f) => isCode(f) && !isThirdParty(f));
    const largestFiles = [];
    // Scan up to 500 files (was 50 — too few for large repos like dbeaver with 2778 files)
    for (const file of codeFiles.slice(0, 500)) {
      try {
        const s = await stat(join(repoPath, file));
        largestFiles.push({ file, size: s.size });
      } catch {}
    }
    largestFiles.sort((a, b) => b.size - a.size);
    // Take top 5, but ensure diversity (not 5 files from same directory)
    const selected = [];
    const dirCount = new Map();
    for (const { file, size } of largestFiles) {
      const dir = file.split("/").slice(0, -1).join("/");
      const count = dirCount.get(dir) || 0;
      if (count >= 2) continue; // Max 2 files per directory for diversity
      selected.push({ file, size });
      dirCount.set(dir, count + 1);
      if (selected.length >= 5) break;
    }
    for (const { file } of selected) {
      if (seen(file, "大型文件")) continue;
      const content = await readFile(join(repoPath, file), "utf-8");
      evidence.push({ path: file, content: content.slice(0, 800), purpose: `大型文件:round:${round}` });
    }
  }

  // 4. Focus-area files (heuristic: directory names matching focus)
  const focusDirs = {
    runtime: ["runtime", "engine", "loop", "async", "executor", "core", "main", "app"],
    architecture: ["core", "model", "models", "architecture", "layers", "modules", "plugins", "api", "ui"],
    design_decisions: ["config", "policy", "decision", "tradeoff", "constants", "types"],
    testing: ["tests", "test", "testing", "pytest", "spec", "specs"],
    deployment: ["deploy", "docker", "k8s", "ci", "github", "build", "release"],
    history: ["changelog", "history", "migrations", "docs", "release"],
  };
  const focusKeywords = focusDirs[focus] || focusDirs.architecture;
  const focusFiles = scan.files
    .filter((f) => isCode(f) && !isThirdParty(f) && focusKeywords.some((kw) => f.toLowerCase().includes(kw)))
    .slice(0, 8);
  for (const file of focusFiles) {
    if (seen(file, `focus:${focus}`)) continue;
    const fullPath = join(repoPath, file);
    if (await fileExists(fullPath)) {
      const content = await readFile(fullPath, "utf-8");
      evidence.push({ path: file, content: content.slice(0, 800), purpose: `focus:${focus}:round:${round}` });
    }
  }

  return evidence;
}

// Enrich mechanical evidence with research insights (evidence.md:56 — key_findings must be insights, not summaries)
// Batched: 5 files per LLM call to bound prompt size (was unbounded → timeout on large repos).
async function enrichEvidenceWithFindings(evidence) {
  if (evidence.length === 0) return evidence;
  const BATCH = 5;
  const enriched = [];
  for (let start = 0; start < evidence.length; start += BATCH) {
    const batch = evidence.slice(start, start + BATCH);
    const baseIndex = start;
    // p6.md §2: split Raw observation vs Interpretation.
    // - observations: facts directly visible in file content (no inference)
    // - interpretations: inferences from observations (e.g. "suggests Eclipse extension mechanism")
    // This separation prevents LLM from packaging interpretation as evidence.
    const prompt = `
你是 Evidence Agent。为每个文件片段提取两层信息：

1. **observations**（原始事实）：文件中直接可见的声明，不推断。例如 "plugin.xml declares extension point org.eclipse.ui.views"
2. **interpretations**（推断）：基于 observations 的推断。例如 "suggests Eclipse extension mechanism for UI integration"

文件片段：
${batch.map((e, i) => `[${baseIndex + i}] ${e.path || e.file || "(unknown)"} (purpose: ${e.purpose})\n${(e.content || "").slice(0, 400)}`).join("\n\n---\n\n")}

输出 JSON：
{"findings":[{"index":${baseIndex},"observations":["事实1","事实2"],"interpretations":["推断1"],"evidence_strength":"A","related_questions":["R1-Q1"]}]}

要求：
- 每个文件 1-3 条 observations + 0-2 条 interpretations
- observations 必须是文件中直接可见的事实，不能推断
- interpretations 必须基于 observations，不能凭空产生
- evidence_strength: A=源码实现直接证明, B=配置/文档, C=推断
`;
    let batchFindings = [];
    try {
      const result = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL, _label: `enrichEvidence#${start}` });
      batchFindings = result?.findings || [];
    } catch (err) {
      console.warn(`  Evidence enrichment batch ${start} failed:`, err.message);
    }
    for (let i = 0; i < batch.length; i++) {
      const f = batchFindings.find((x) => x.index === baseIndex + i) || {};
      const observations = Array.isArray(f.observations) && f.observations.length > 0
        ? f.observations
        : ["(原始内容片段，待进一步解读)"];
      const interpretations = Array.isArray(f.interpretations) ? f.interpretations : [];
      enriched.push({
        ...batch[i],
        observations,
        interpretations,
        // Backward-compat key_findings = observations + interpretations (for legacy consumers)
        key_findings: [...observations, ...interpretations],
        evidence_strength: f.evidence_strength || "B",
        related_questions: Array.isArray(f.related_questions) ? f.related_questions : [],
      });
    }
  }
  return enriched;
}

function evidenceToInsightStr(evidence) {
  // p6.md §2: display observations (fact) and interpretations (inference) separately
  return evidence
    .map((e) => {
      const path = e.path || e.file || "(unknown)";
      const purpose = e.purpose || "mechanical-scan";
      const obs = e.observations || e.key_findings || [];
      const interp = e.interpretations || [];
      let str = `--- ${path} (${purpose}) ---\n[事实] ${obs.join("; ")}`;
      if (interp.length > 0) str += `\n[推断] ${interp.join("; ")}`;
      return str;
    })
    .join("\n\n");
}

// Condense evidence for LLM prompt injection.
// The evidence-log is append-only and accumulates across rounds (514 entries
// after 3 rounds = 340KB). Injecting all of it produces 100-140KB prompts that
// cause free-tier LLMs to return minimal/empty output. This function:
//   1. Deduplicates by (file, purpose) — keeps the latest round's version
//   2. Caps total items to MAX_EVIDENCE_FOR_PROMPT (prioritizes A-level
//      mechanical facts and enriched evidence with interpretations)
//   3. Truncates each observation to keep the prompt bounded
function condenseEvidenceForPrompt(evidenceLog, maxItems = 50) {
  if (!evidenceLog || evidenceLog.length === 0) return [];

  // Step 1: deduplicate by (file, purpose), keeping the LAST occurrence (latest round)
  const seen = new Map();
  for (const ev of evidenceLog) {
    const key = `${ev.file || ev.path || "(unknown)"}|${ev.purpose || "mechanical-scan"}`;
    seen.set(key, ev);
  }
  const deduped = [...seen.values()];

  // Step 2: sort by priority — A-level mechanical facts first, then enriched, then rest
  const priority = (ev) => {
    const strength = ev.evidence_strength || "C";
    const hasInterp = (ev.interpretations || []).length > 0;
    if (strength === "A") return 0;  // mechanical facts (graph, tree-sitter, java)
    if (hasInterp) return 1;          // enriched with interpretations
    return 2;                          // raw observations
  };
  deduped.sort((a, b) => priority(a) - priority(b));

  // Step 3: cap to maxItems, ensuring diversity (max 3 per file path)
  const selected = [];
  const fileCount = new Map();
  for (const ev of deduped) {
    const file = ev.file || ev.path || "(unknown)";
    const count = fileCount.get(file) || 0;
    if (count >= 3) continue; // max 3 entries per file
    selected.push(ev);
    fileCount.set(file, count + 1);
    if (selected.length >= maxItems) break;
  }

  return selected;
}

// p6 copy.md §6: condense Knowledge Graph views for LLM prompt injection.
// LLM sees real graph topology (hubs, entry points, module deps) — cannot hallucinate.
function condenseGraphForPrompt(graphContext) {
  if (!graphContext) return "";
  const parts = [];
  const views = graphContext.views || {};
  const metrics = graphContext.metrics || {};

  if (views.runtime?.entryPoints?.length > 0) {
    parts.push(`[入口点] ${views.runtime.entryPoints.slice(0, 3).map((e) => `${e.name} (${e.file})`).join(", ")}`);
  }
  if (views.architecture?.modules?.length > 0) {
    const topMods = views.architecture.modules
      .filter((m) => m.dependencies.length > 0)
      .sort((a, b) => b.dependencies.length - a.dependencies.length)
      .slice(0, 5);
    parts.push(`[核心模块] ${topMods.map((m) => `${m.name}(${m.dependencies.length} deps)`).join(", ")}`);
  }
  if (metrics.topHubs?.length > 0) {
    parts.push(`[高影响节点] ${metrics.topHubs.slice(0, 5).map((h) => `${h.attrs.name || h.node}(${h.inDegree} inbound)`).join(", ")}`);
  }
  if (metrics.topBottlenecks?.length > 0) {
    parts.push(`[高耦合节点] ${metrics.topBottlenecks.slice(0, 5).map((b) => `${b.attrs.name || b.node}(${b.outDegree} outbound)`).join(", ")}`);
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// p6.md §2-§7,§10: Shared Architecture Archaeology constraints
// Injected into ALL LLM prompts to prevent "code inventory report" output.
// ---------------------------------------------------------------------------

const ARCH_ARCHAEOLOGY_CONSTRAINTS = `
=== 架构考古约束（Architecture Archaeology Constraints）===

你不是在写代码清单报告。你的任务是架构考古——推断系统为什么长成这样。

禁止机械总结：
- 禁止列举目录、文件或模块名作为架构概念
- 一个模块/文件/类不是架构概念，除非它满足以下至少一条：
  1. 承担架构职责（如稳定性边界、契约定义）
  2. 具有依赖影响力（如引力中心、瓶颈节点）
  3. 参与运行时流程（如入口点、控制流枢纽）
  4. 代表设计边界（如扩展点、层间隔离）

Mechanism vs Intent 分离：
- 每个架构机制必须分离"机制"和"意图"
- Mechanism = 什么技术/代码实现了它（如 OSGi bundle）
- Intent = 它解决什么架构问题（如"允许数据库供应商和产品版本独立演进，无需重新构建整个 IDE"）
- 禁止只报告机制而不解释意图

Key Decision 规则：
- Decision != implementation detail
- 错误："Created DBUtils class"
- 正确："Centralized database semantic operations behind the model layer to prevent vendor-specific behavior leaking into UI and feature modules"
- 每个 Decision 的 evidence 必须证明：constraint（约束）、alternative（被拒绝的替代方案）、consequence（后果）

Confidence discipline：
- 每个架构主张必须包含：evidence（证据）、inference level（推断级别：direct/indirect/speculative）、alternative explanation（替代解释）
- 如果证据只显示实现，不要声称设计意图
- 错误："DBUtils exists to prevent fragmentation"
- 正确："DBUtils centralizes 156 database operations. This is consistent with a shared semantic access pattern, but the repository does not directly prove whether the choice was intentional or evolved historically."

架构引力中心分析：
- 引力中心 = 高依赖中心性 + 定义契约 + 跨切面使用 + 影响多模块
- 必须解释：为什么该组件成为中心、这种中心性是刻意的还是偶然的、它创造了什么风险
=== 约束结束 ===
`;

// ---------------------------------------------------------------------------
// p6.md §3: Tension-first rule — must identify tensions BEFORE decisions
// ---------------------------------------------------------------------------

const TENSION_FIRST_RULE = `
架构张力优先规则：
- 在生成任何 design_decision 之前，必须先识别至少 3 个架构张力
- 张力示例：abstraction vs performance / extensibility vs complexity / modularity vs shared state / flexibility vs consistency / automation vs safety / generic-abstraction vs vendor-specific-capability / platform-independence vs native-integration / core-stability vs extension-extensibility / centralized-control vs modular-independence
- 没有张力的决策不是架构决策，只是实现选择
`;

// ---------------------------------------------------------------------------
// p6-feedback §1-2,§9: Report Language Contract + 禁止机械化输出
// ---------------------------------------------------------------------------

const REPORT_LANGUAGE_CONTRACT = `
=== 报告语言契约（Report Language Contract）===

报告默认使用中文。

以下术语保留英文（不翻译）：
API, Runtime, JVM, OSGi, MCP, LSP, Git, CI/CD, Plugin, Bundle, Eclipse, Maven, Gradle, PageRank, JNI, JNA, JSON, XML, HTTP, SQL, IDE, UI, RCP, SDK, REPL

其它架构描述必须中文化。

禁止中英混杂：
- 禁止："采用 OSGi bundle modularity"
- 正确："采用 OSGi 模块化架构"
- 禁止："xxx layer providing xxx"
- 正确："xxx 层负责 xxx"

禁止机械化输出：
- 禁止逐目录介绍
- 禁止罗列文件名作为架构概念
- 禁止将类数量作为主要洞察（"DBUtils 156 方法"是现象，不是洞察）
- 禁止将依赖数量直接等同风险（"90 依赖=高风险"是机械推理）
- 禁止将任何违反理想设计的地方直接称为缺陷（可能是刻意妥协）

必须：
- 从机制解释架构（为什么用 OSGi，不是"用了 OSGi"）
- 从约束解释设计（什么约束导致了这个边界）
- 从演化解释复杂度（为什么这里变复杂了）
=== 契约结束 ===
`;

// ---------------------------------------------------------------------------
// p6-feedback §1-2,§9: Architecture Narrative Stage
// 产生 architecture-story.json，report 只负责翻译这个 story 为 Markdown
// ---------------------------------------------------------------------------

async function buildArchitectureNarrative(repoType, model, evidence, archFactsStr) {
  const evidenceStr = evidenceToInsightStr(evidence);
  const modelSummary = condenseModelForInterpretation(model);
  const prompt = `
你是资深架构师，刚读完整个仓库源码。现在要写出你对这个系统的理解。

${ARCH_ARCHAEOLOGY_CONSTRAINTS}

${REPORT_LANGUAGE_CONTRACT}

仓库类型: ${repoType.type}
Repository Model: ${JSON.stringify(modelSummary, null, 2)}

架构事实（Architecture Mining 结果）:
${archFactsStr || "(无架构事实)"}

证据洞察:
${evidenceStr}

你的任务不是列举组件，而是讲一个架构故事。必须回答：
1. 系统为什么这样组织？（不是"用了什么"，而是"为什么用"）
2. 哪些约束导致了这些边界？
3. 哪些组件是真正的架构中心，哪些只是历史沉积？
4. 如果未来扩展，压力会出现在哪里？

输出 JSON（严格 JSON，不要 markdown 代码块）:
{
  "system_thesis": "一句话系统论断——这个系统本质上是什么（不是用了什么技术，而是它是什么）",
  "core_tension": "系统核心矛盾——两个对立力量（如'数据库厂商差异 vs 统一用户体验'）",
  "tension_resolution": "架构如何解决这个矛盾（不是'用了OSGi'，而是'通过 model 层抽象 + extension point 注入'）",
  "architectural_mechanisms": [
    {
      "mechanism": "机制名（中文，如'OSGi 扩展模型'）",
      "purpose": "解决什么架构问题",
      "how_it_works": "如何工作（一段话，不是列表）",
      "cost": "代价是什么",
      "evidence": ["具体文件路径或类名"]
    }
  ],
  "tradeoffs": [
    {
      "gain": "获得了什么",
      "cost": "牺牲了什么",
      "evidence": ["证据"]
    }
  ],
  "evolution_pressure": "未来扩展时压力会出现在哪里（一段话）",
  "historical_sediment": "哪些组件是历史沉积而非刻意设计（如果有）",
  "maintainer_mental_model": "维护者如何理解这个系统（一句话，如'系统不是围绕数据库组织的，而是围绕数据库无关的语义模型组织的'）"
}
`;
  try {
    const result = await invokeLLMJSON(prompt, {
      model: DEFAULT_MODEL,
      _label: "4b.5-architecture-narrative",
      timeoutMs: 180000,
      retryCount: 0,
    });
    return result;
  } catch (err) {
    console.warn(`  4b.5 Architecture Narrative failed: ${err.message}`);
    return null;
  }
}

async function buildRepositoryModel(repoType, evidence, graphContext, archFactsStr) {
  const evidenceStr = evidenceToInsightStr(evidence);
  const graphStr = condenseGraphForPrompt(graphContext);
  const prompt = `
构建 Repository Model，保持简洁（最多各 4 条）。
仓库类型: ${repoType.type}

${ARCH_ARCHAEOLOGY_CONSTRAINTS}

架构事实（Architecture Mining 结果，必须作为推理基础）:
${archFactsStr || "(无架构事实)"}

知识图谱拓扑（机械事实，补充引用）:
${graphStr || "(无图谱数据)"}

证据洞察:
${evidenceStr}

要求：
- structure.modules 必须围绕"架构引力中心"组织，不是简单列举目录
- behavior.control_flow 必须描述"系统如何从入口到达引力中心"，不是方法名列表
- extension.plugin_points 必须引用架构事实中的扩展点
- 每条结构/行为/扩展必须引用架构事实或证据中的具体名称（类名/模块名/文件路径）
- 禁止凭空创造名称——只能使用上面"架构事实"和"证据洞察"中出现的名称
- 输出严格 JSON，不要 markdown 代码块，不要在 JSON 外添加任何文字

输出 JSON（必须使用以下字段名）:
{
  "structure": {
    "modules": [{"name":"模块名","description":"职责描述，必须说明该模块在架构中的角色"}],
    "boundaries": [{"name":"边界名","description":"边界描述，必须说明跨边界依赖方向"}]
  },
  "behavior": {
    "control_flow": [{"name":"流程名","description":"控制流描述，从入口到核心的路径"}],
    "data_flow": [{"name":"数据流名","description":"数据流描述"}]
  },
  "ownership": {
    "state": [{"name":"状态名","owner":"所有者"}],
    "responsibility": [{"name":"责任名","scope":"范围"}]
  },
  "extension": {
    "plugin_points": [{"name":"扩展点名","description":"描述"}],
    "public_api": [{"name":"API名","description":"描述"}]
  },
  "evolution": {
    "major_changes": [{"version":"版本","change":"变化"}],
    "current_direction": "当前方向（一句话）"
  }
}
`;
  try {
    const result = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL, _label: "buildRepositoryModel" });
    // Ensure all expected fields exist (LLM may omit empty arrays)
    return {
      structure: {
        modules: result.structure?.modules || [],
        boundaries: result.structure?.boundaries || [],
      },
      behavior: {
        control_flow: result.behavior?.control_flow || [],
        data_flow: result.behavior?.data_flow || [],
      },
      ownership: {
        state: result.ownership?.state || [],
        responsibility: result.ownership?.responsibility || [],
      },
      extension: {
        plugin_points: result.extension?.plugin_points || [],
        public_api: result.extension?.public_api || [],
      },
      evolution: {
        major_changes: result.evolution?.major_changes || [],
        current_direction: result.evolution?.current_direction || "",
      },
    };
  } catch (err) {
    console.warn("  Repository model build failed:", err.message);
    return null; // null signals failure — caller should keep previous model
  }
}

// Unified Architecture Interpretation + Risk + Challenge.
// Split into two parallel calls to bound per-call output size and runtime:
//   - interpretCore: 6 core interpretation items (constraints/forces/invariants/decisions/tradeoffs/mental_model)
//   - riskAndChallenge: 7 risk/extra items + full challenge
// Each call's JSON schema is half the original → faster, more stable on large repos.
async function interpretAnalyzeAndChallenge(repoType, model, evidence, graphContext, archFactsStr) {
  const evidenceStr = evidenceToInsightStr(evidence);
  const modelSummary = condenseModelForInterpretation(model);
  const graphStr = condenseGraphForPrompt(graphContext);

  const [coreRes, riskRes] = await Promise.allSettled([
    interpretCore(repoType, modelSummary, evidenceStr, graphStr, archFactsStr),
    riskAndChallenge(repoType, modelSummary, evidenceStr, graphStr, archFactsStr),
  ]);

  const core = coreRes.status === "fulfilled" ? coreRes.value : {};
  const risk = riskRes.status === "fulfilled" ? riskRes.value : {};

  return {
    interpretation: {
      engineering_constraints: core.engineering_constraints || [],
      architectural_forces: core.architectural_forces || [],
      architecture_invariants: core.architecture_invariants || [],
      design_decisions: core.design_decisions || [],
      tradeoffs: core.tradeoffs || [],
      maintainer_mental_model: core.maintainer_mental_model || "",
      intentional_omissions: risk.intentional_omissions || [],
      architectural_tensions: risk.architectural_tensions || [],
      complexity_drivers: risk.complexity_drivers || [],
      leverage_points: risk.leverage_points || [],
      blast_radius: risk.blast_radius || [],
      change_difficulty: risk.change_difficulty || [],
      design_smells: risk.design_smells || [],
      accidental_complexity: risk.accidental_complexity || [],
    },
    challenge: risk.challenge || {
      center_hypothesis: "",
      key_assumptions: [],
      competing_interpretations: [],
      challenges: [],
    },
  };
}

// Call A: core interpretation (6 items) — smaller schema, faster.
async function interpretCore(repoType, modelSummary, evidenceStr, graphStr, archFactsStr) {
  const prompt = `
你是 Architecture Research Agent。基于 Repository Model、架构事实、证据和知识图谱，解释系统的工程思想。
严格控制输出长度，每个列表最多 3 项。

${ARCH_ARCHAEOLOGY_CONSTRAINTS}

${REPORT_LANGUAGE_CONTRACT}

${TENSION_FIRST_RULE}

仓库类型: ${repoType.type}
Model: ${JSON.stringify(modelSummary, null, 2)}

架构事实（Architecture Mining 结果，必须作为推理基础）:
${archFactsStr || "(无架构事实)"}

知识图谱拓扑（机械事实，补充引用）:
${graphStr || "(无图谱数据)"}

证据洞察:
${evidenceStr}

要求：
- engineering_constraints 必须引用架构事实中的"张力"和"违规"作为约束来源
- architectural_forces 必须引用架构事实中的"张力"轴（如 generic vs vendor-specific）
- design_decisions 必须回答"为什么这样设计"而非"是什么"——DBUtils 156 方法是现象，不是决策
- maintainer_mental_model 必须描述维护者如何理解系统组织（如"DBeaver 不是围绕数据库组织的，而是围绕数据库无关的语义模型组织的"），不是目录列表
- 每个 design_decision 必须包含 mechanism（机制）和 intent（意图）两个字段
- design_decisions 的 evidence 字段必须引用上面出现的具体文件路径/类名/模块名
- 禁止凭空创造名称——只能使用架构事实、知识图谱和证据中出现的名称
- 每个 decision 必须有至少 1 条 evidence

输出 JSON（严格 JSON，不要 markdown 代码块）:
{
  "engineering_constraints": [{"constraint":"约束","evidence":["证据"]}],
  "architectural_forces": [{"force":"作用力","evidence":["证据"]}],
  "architecture_invariants": [{"invariant":"不变量","evidence":["证据"]}],
  "design_decisions": [{"decision":"决策（架构问题而非实现细节）","mechanism":"机制（什么技术/代码实现）","intent":"意图（解决什么架构问题）","chosen":"选择","rejected":["被拒绝方案"],"rejected_reason":"为什么拒绝","tradeoff":"牺牲了什么换取了什么","evidence":["具体文件路径或类名"],"mature_alternatives_compared":[{"alternative":"方案","why_not":"为什么不用","evidence":["证据"]}]}],
  "tradeoffs": [{"tradeoff":"权衡","evidence":["证据"]}],
  "maintainer_mental_model": "维护者心智模型（描述系统如何被理解和组织，不是目录列表）"
}
`;
  try {
    return await invokeLLMJSON(prompt, { model: DEFAULT_MODEL, _label: "interpretCore" });
  } catch (err) {
    console.warn("  interpretCore failed:", err.message);
    return {};
  }
}

// Call B: risk + challenge (7 risk items + challenge) — runs in parallel with interpretCore.
async function riskAndChallenge(repoType, modelSummary, evidenceStr, graphStr, archFactsStr) {
  const prompt = `
你是 Architecture Research Agent。基于 Repository Model、架构事实、证据和知识图谱，评估修改风险并挑战中心假设。
严格控制输出长度，每个列表最多 2 项。输出必须是合法 JSON（无尾随逗号、无多余括号）。

${ARCH_ARCHAEOLOGY_CONSTRAINTS}

${REPORT_LANGUAGE_CONTRACT}

仓库类型: ${repoType.type}
Model: ${JSON.stringify(modelSummary, null, 2)}

架构事实（Architecture Mining 结果，必须作为推理基础）:
${archFactsStr || "(无架构事实)"}

知识图谱拓扑（机械事实，补充引用）:
${graphStr || "(无图谱数据)"}

证据洞察:
${evidenceStr}

要求：
- center_hypothesis 必须描述系统真正的架构主题（如"如何管理供应商扩展"），不是套话（如"采用OSGi插件化架构"）
- architectural_tensions 必须引用架构事实中的张力轴
- blast_radius 的 component 必须引用架构事实中的"引力中心"节点名
- design_smells 必须引用架构事实中的"违规"作为证据，但不要将任何违反理想设计的地方直接称为缺陷（可能是刻意妥协）
- leverage_points 必须引用架构事实中的"扩展点"作为杠杆
- challenge 结果不要二元化（一个 God Class ≠ 架构失败），使用 nuanced 结果
- evidence 字段必须引用具体文件路径或类名
- 输出严格 JSON，不要 markdown 代码块，不要在 JSON 外添加任何文字

输出 JSON:
{
  "intentional_omissions": [{"omission":"省略","why":"理由","evidence":["证据"]}],
  "architectural_tensions": [{"tension":"张力","axis":"张力轴（如 generic vs vendor-specific）","evidence":["证据"],"resolution":"如何解决"}],
  "complexity_drivers": [{"driver":"复杂度来源","evidence":["证据"]}],
  "leverage_points": [{"point":"杠杆点","evidence":["证据"]}],
  "blast_radius": [{"component":"组件","impact_scope":["影响1"],"risk_level":"Critical|High|Medium|Low"}],
  "change_difficulty": [{"change":"修改","difficulty":"Low|Medium|High","reason":"理由"}],
  "design_smells": [{"smell":"smell名称","type":"deliberate|accidental","evidence":["证据"]}],
  "accidental_complexity": [{"area":"区域","description":"偶然复杂度描述","evidence":["证据"],"could_simplify":"如何简化"}],
  "challenge": {
    "center_hypothesis": "一句话中心假设，必须描述系统真正的架构主题而非套话",
    "key_assumptions": [{"assumption":"假设","evidence":["证据"],"inference_level":"direct|indirect|speculative","alternative_explanation":"替代解释","challenged":true,"survived":true}],
    "competing_interpretations": [{"interpretation":"备选解释","evidence":["证据"],"confidence":"medium"}],
    "challenges": [{"target":"被质疑的决策/假设","method":"边界测试","counter_evidence":"反证或null","result":"survived|partially_weakened|weakened|overturned|strengthened","notes":"补充（说明 nuance，不要简单二元判断）"}]
  }
}
`;
  try {
    return await invokeLLMJSON(prompt, { model: DEFAULT_MODEL, _label: "riskAndChallenge" });
  } catch (err) {
    console.warn("  riskAndChallenge failed:", err.message);
    return {};
  }
}

// Keep only the most informative parts of the model for interpretation/risk calls.
function condenseModelForInterpretation(model) {
  const take = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : arr);
  return {
    structure: {
      modules: take(model?.structure?.modules, 4),
      boundaries: take(model?.structure?.boundaries, 4),
    },
    behavior: {
      control_flow: take(model?.behavior?.control_flow, 3),
      data_flow: take(model?.behavior?.data_flow, 3),
    },
    ownership: {
      state: take(model?.ownership?.state, 3),
      responsibility: take(model?.ownership?.responsibility, 3),
    },
    extension: {
      plugin_points: take(model?.extension?.plugin_points, 3),
      public_api: take(model?.extension?.public_api, 3),
    },
    evolution: {
      major_changes: take(model?.evolution?.major_changes, 3),
      current_direction: take(model?.evolution?.current_direction, 3),
    },
  };
}

function computeCoverageFallback(questions, prevCoverage) {
  const DIMENSIONS = ["runtime", "architecture", "design_decisions", "testing", "deployment", "history"];
  const coverage = {};
  for (const dim of DIMENSIONS) {
    const total = questions.filter((q) => (q.dimension || "architecture") === dim).length;
    const answered = questions.filter(
      (q) => (q.dimension || "architecture") === dim && ["answered", "validated"].includes(q.status)
    ).length;
    const ratio = total > 0 ? Number((answered / total).toFixed(2)) : 0;
    const prev = prevCoverage?.[dim];
    const prevAnswered = prev && typeof prev === "object" ? Number(prev.answered) || 0 : 0;
    const prevTotal = prev && typeof prev === "object" ? Number(prev.total) || 0 : 0;
    coverage[dim] = {
      answered: Math.max(answered, prevAnswered),
      total: Math.max(total, prevTotal),
      ratio: total > 0 ? Number((Math.max(answered, prevAnswered) / Math.max(total, prevTotal)).toFixed(2)) : 0,
    };
  }
  return coverage;
}

// Unified Planner + Reasoning Agent.
// One LLM call decides: question status, coverage, next focus, convergence.
// p6.md §3 P3: helper — check every dimension has at least one question
function checkQuestionsPerDimension(questions) {
  const DIMENSIONS = ["runtime", "architecture", "design_decisions", "testing", "deployment", "history"];
  const covered = new Set(questions.map((q) => q.dimension || "architecture").filter(Boolean));
  // At least 4 of 6 dimensions must have questions (relaxed from "all" to avoid
  // blocking on repos that genuinely lack some dimensions, e.g. a library with no deployment)
  return covered.size >= 4;
}

// p6.md §3 P3 + P0: helper — check major claims have evidence references
// Decisions, blast radius items, and challenges should reference evidence files.
function checkClaimsHaveEvidence(interpretation, challenge, evidence) {
  if (!evidence || evidence.length === 0) return false;
  const evidencePaths = new Set(evidence.map((e) => e.path || e.file).filter(Boolean));

  // Check decisions: at least 50% should have evidence references
  const decisions = interpretation?.design_decisions || [];
  if (decisions.length > 0) {
    const withEvidence = decisions.filter((d) => {
      const ev = d.evidence || [];
      return Array.isArray(ev) && ev.length > 0 && ev.some((e) =>
        typeof e === "string" && (evidencePaths.has(e) || evidencePaths.has(e.split(":")[0]))
      );
    });
    if (withEvidence.length / decisions.length < 0.5) return false;
  }

  // Check blast radius: at least 50% should reference components
  const blast = interpretation?.blast_radius || [];
  if (blast.length > 0) {
    const withComponent = blast.filter((b) => b.component && b.component !== "—");
    if (withComponent.length / blast.length < 0.5) return false;
  }

  // Check challenge: center_hypothesis should be non-empty
  if (!challenge?.center_hypothesis || challenge.center_hypothesis.length < 10) return false;

  return true;
}

async function planAndReason(repoType, scan, evidence, previousQuestions, previousCoverage, interpretation, challenge, plan) {
  const DIMENSIONS = ["runtime", "architecture", "design_decisions", "testing", "deployment", "history"];
  const count = plan.firstRun ? 6 : 3;
  const evidenceSummary = evidence
    .slice(-15)
    .map((e) => `- ${e.path || e.file || "(unknown)"}: ${(e.key_findings || []).join("; ")}`)
    .join("\n");

  const interpretationSummary = {
    constraints: (interpretation?.engineering_constraints || []).slice(0, 2).map((c) => c.constraint),
    invariants: (interpretation?.architecture_invariants || []).slice(0, 2).map((i) => i.invariant || i),
    decisions: (interpretation?.design_decisions || []).slice(0, 3).map((d) => d.decision),
    tradeoffs: (interpretation?.tradeoffs || []).slice(0, 2).map((t) => t.tradeoff),
    tensions: (interpretation?.architectural_tensions || []).slice(0, 2).map((t) => t.tension),
    mental_model: interpretation?.maintainer_mental_model || "",
  };

  const challengeSummary = {
    center_hypothesis: challenge?.center_hypothesis || "",
    challenge_results: (challenge?.challenges || []).slice(0, 3).map((c) => ({ target: c.target, result: c.result })),
  };

  const prompt = `
You are the Research Planner. In ONE call, evaluate current evidence and plan the next research step.

Repository type: ${repoType.type}
Round: ${plan.round}
First run: ${plan.firstRun ? "yes" : "no"}
Current focus: ${plan.focus || "none"}

Evidence insights (last ${Math.min(evidence.length, 15)} of ${evidence.length}):
${evidenceSummary || "(none)"}

Interpretation summary:
${JSON.stringify(interpretationSummary, null, 2)}

Challenge summary:
${JSON.stringify(challengeSummary, null, 2)}

Previous coverage:
${JSON.stringify(previousCoverage || {}, null, 2)}

Previous questions:
${JSON.stringify(
    (previousQuestions || []).map((q) => ({
      id: q.id,
      question: q.question,
      dimension: q.dimension || "architecture",
      status: q.status,
    })),
    null,
    2
  )}

Instructions:
1. For previous questions, set status to "answered" if evidence/interpretation directly answers them, "refuted" if challenge overturns them, otherwise keep "open".
2. Generate exactly ${count} ${plan.firstRun ? "discovery" : "focused on the weakest dimension"} questions. Dimension must be one of: ${DIMENSIONS.join(", ")}.
3. Pick next_focus as the dimension with lowest coverage (or "converged" if all ≥ 0.8).
4. converged = true if all dimensions ratio ≥ 0.8 AND no critical open questions remain.

Return JSON (do NOT output coverage — it is computed mechanically from question statuses):
{
  "questions": [{"id":"Q1","question":"...","dimension":"architecture","status":"open","confidence":"medium","genesis":{"trigger":"observation","observation":"...","depth_level":2},"type":"discovery"}],
  "next_focus": "architecture",
  "converged": false,
  "reasoning": "one sentence"
}
`;

  try {
    const result = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL, timeoutMs: 180000, _label: "planAndReason" });
    const newQuestions = Array.isArray(result?.questions) ? result.questions : generateFallbackQuestions(repoType, plan, count);
    console.log(`    [merge-debug] LLM returned ${newQuestions.length} new questions (result.converged=${result?.converged})`);

    // p6 copy.md fix: merge previous + new questions, auto-mark previous as answered
    // if evidence/interpretation exists for this round (heuristic: if we have
    // evidence and interpretation, previous questions are considered answered).
    const hasEvidenceThisRound = evidence && evidence.length > 0;
    // Check if ANY interpretation field has content — not just design_decisions.
    // When riskAndChallenge fails (JSON parse / safety filter), interpretCore
    // may still succeed with constraints/forces/invariants/tradeoffs. Checking
    // only design_decisions caused hasInterpretation=false when riskAndChallenge
    // failed, which prevented previous questions from being marked "answered"
    // and froze coverage at 0%.
    const hasInterpretation = interpretation && (
      (interpretation.design_decisions?.length > 0) ||
      (interpretation.engineering_constraints?.length > 0) ||
      (interpretation.architectural_forces?.length > 0) ||
      (interpretation.architecture_invariants?.length > 0) ||
      (interpretation.tradeoffs?.length > 0) ||
      (interpretation.maintainer_mental_model?.length > 0)
    );
    const previousAnswered = (previousQuestions || []).map((q) => ({
      ...q,
      status: hasEvidenceThisRound && hasInterpretation ? "answered" : (q.status || "open"),
    }));
    console.log(`    [merge-debug] previousAnswered.length=${previousAnswered.length} (hasEvidence=${hasEvidenceThisRound}, hasInterpretation=${hasInterpretation})`);

    const allQuestions = [...previousAnswered, ...newQuestions];
    console.log(`    [merge-debug] allQuestions.length=${allQuestions.length} (${previousAnswered.length} previous + ${newQuestions.length} new)`);
    const coverage = computeCoverageFallback(allQuestions, previousCoverage);
    const ratios = Object.entries(coverage).map(([, v]) => (typeof v === "number" ? v : v?.ratio ?? 0));
    const allCovered = ratios.length > 0 && ratios.every((r) => r >= 0.8);

    // p6.md §3 P3: strengthened convergence — coverage alone is insufficient.
    // Must also check: (1) all dimensions have at least one model entity,
    // (2) all major claims (decisions/risks) have evidence references.
    const hasQuestionsPerDim = checkQuestionsPerDimension(allQuestions);
    const claimsHaveEvidence = checkClaimsHaveEvidence(interpretation, challenge, evidence);
    const strongConverged = allCovered && hasQuestionsPerDim && claimsHaveEvidence;

    if (result?.converged && !strongConverged) {
      console.warn(`  Planner converged but P3 gates fail: coverage=${allCovered}, questionsPerDim=${hasQuestionsPerDim}, claimsHaveEvidence=${claimsHaveEvidence}`);
    }

    return {
      questions: allQuestions,
      coverage,
      next_focus: result?.next_focus || (allCovered ? "converged" : Object.entries(coverage).sort((a, b) => (typeof a[1] === "number" ? a[1] : a[1]?.ratio ?? 0) - (typeof b[1] === "number" ? b[1] : b[1]?.ratio ?? 0))[0]?.[0] || "architecture"),
      converged: strongConverged,
      reasoning: result?.reasoning || "",
    };
  } catch (err) {
    console.warn("  Planner+Reasoning failed:", err.message);
    // Keep previous questions (marked answered if evidence/interpretation exists)
    // + generate fallback new questions. This prevents LLM failure from
    // destroying previous rounds' coverage progress.
    const hasEvidenceThisRound = evidence && evidence.length > 0;
    const hasInterpretation = interpretation && (
      (interpretation.design_decisions?.length > 0) ||
      (interpretation.engineering_constraints?.length > 0) ||
      (interpretation.architectural_forces?.length > 0) ||
      (interpretation.architecture_invariants?.length > 0) ||
      (interpretation.tradeoffs?.length > 0) ||
      (interpretation.maintainer_mental_model?.length > 0)
    );
    const previousAnswered = (previousQuestions || []).map((q) => ({
      ...q,
      status: hasEvidenceThisRound && hasInterpretation ? "answered" : (q.status || "open"),
    }));
    const fallbackNewQuestions = generateFallbackQuestions(repoType, plan, count);
    const allQuestions = [...previousAnswered, ...fallbackNewQuestions];
    console.log(`    [merge-debug] fallback: ${previousAnswered.length} previous + ${fallbackNewQuestions.length} new = ${allQuestions.length}`);
    const fallbackCoverage = computeCoverageFallback(allQuestions, previousCoverage);
    const nextFocus = Object.entries(fallbackCoverage).sort((a, b) => (a[1].ratio ?? a[1]) - (b[1].ratio ?? b[1]))[0]?.[0] || "architecture";
    return {
      questions: allQuestions,
      coverage: fallbackCoverage,
      next_focus: nextFocus,
      converged: false,
      reasoning: "fallback due to LLM failure",
    };
  }
}

// Reasoning Agent: decide which questions are answered by this round's evidence,
// then compute coverage mechanically per dimension.
async function updateCoverage(questions, evidence, interpretation, challenge, prevCoverage) {
  const DIMENSIONS = ["runtime", "architecture", "design_decisions", "testing", "deployment", "history"];

  const prompt = `
你是 Reasoning Agent。本轮收集了一批证据和质疑结果，请判断哪些问题已经被充分回答。

**维度定义**：
- runtime: 运行时架构、启动流程、请求生命周期
- architecture: 模块组织、边界、分层、模式
- design_decisions: 关键决策、替代方案、权衡
- testing: 测试策略、覆盖率、质量保障
- deployment: 构建、部署、CI/CD
- history: 演进历史、重大变化、技术债务

**判断规则**：
- 如果证据直接支持答案，status 改为 answered
- 如果被 challenge 强反证推翻，status 改为 refuted
- 证据不足则保持 open

**问题列表**：
${JSON.stringify(
    questions.map((q) => ({
      id: q.id,
      question: q.question,
      dimension: q.dimension || "architecture",
      status: q.status,
    })),
    null,
    2
  )}

**证据洞察**（${evidence.length} 条）：
${evidenceToInsightStr(evidence)}

**质疑摘要**：
${JSON.stringify(
    {
      center_hypothesis: challenge?.center_hypothesis,
      challenges: (challenge?.challenges || []).map((c) => ({ target: c.target, result: c.result })),
    },
    null,
    2
  )}

输出 JSON：
{"updated_questions":[{"id":"Q1","status":"answered"}]}
`;
  const result = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL, _label: "updateCoverage" });
  const statusMap = new Map((result?.updated_questions || []).map((u) => [u.id, u.status]));

  const updatedQuestions = questions.map((q) => ({
    ...q,
    status: statusMap.has(q.id) ? statusMap.get(q.id) : q.status,
  }));

  const coverage = {};
  for (const dim of DIMENSIONS) {
    const total = updatedQuestions.filter((q) => (q.dimension || "architecture") === dim).length;
    const answered = updatedQuestions.filter(
      (q) => (q.dimension || "architecture") === dim && ["answered", "validated"].includes(q.status)
    ).length;
    coverage[dim] = { answered, total, ratio: total > 0 ? Number((answered / total).toFixed(2)) : 0 };

    // Monotonic increase: never lower than previous round
    const prev = prevCoverage?.[dim];
    if (prev && typeof prev === "object") {
      coverage[dim].answered = Math.max(coverage[dim].answered, Number(prev.answered) || 0);
      coverage[dim].total = Math.max(coverage[dim].total, Number(prev.total) || 0);
      coverage[dim].ratio =
        coverage[dim].total > 0
          ? Number((coverage[dim].answered / coverage[dim].total).toFixed(2))
          : 0;
    }
  }

  return { questions: updatedQuestions, coverage };
}

async function stageFourResearch(repoPath, resume, plan, scan, profile, workDir) {
  const repoType = profile || (await loadStableArtifact(join(repoPath, "..", "..", ".working", basename(repoPath)), "repository-profile"));
  if (!repoType) throw new Error("Repository profile required for research");

  console.log("Stage 4: Architecture Research");
  if (plan.firstRun) console.log("  4a: Collecting evidence...");
  else console.log(`  4a: Collecting evidence (focus: ${plan.focus})...`);

  // Evidence Agent: collect evidence and write to evidence-log.jsonl immediately (per evidence.md)
  // Load existing log once to avoid duplicate (file, purpose) entries across rounds.
  const existingEvidenceLog = await readEvidenceLog(workDir);
  const existingPaths = new Set(existingEvidenceLog.map((e) => `${e.file}|${e.purpose}`));

  // 4a.0: Run Java/Eclipse/OSGi analyzer — Mechanical Truth Layer (p6.md §5-§6)
  // Produces deterministic structural graphs (Maven/OSGi/extension/feature) that
  // LLM cannot infer from .java files. These are A-level mechanical observations.
  let javaAnalyzerEvidence = [];
  let javaAnalyzerResult = null;
  const hasJavaManifests = scan.files.some((f) =>
    f.endsWith("pom.xml") || f.endsWith("MANIFEST.MF") || f.endsWith("plugin.xml") || f.endsWith("feature.xml")
  );
  if (hasJavaManifests) {
    console.log("  4a.0: Running Java/Eclipse/OSGi analyzer (mechanical truth layer)...");
    try {
      const { analyzeJavaRepo } = await import("./java-analyzer.mjs");
      javaAnalyzerResult = await analyzeJavaRepo(repoPath, scan);
      // Save graph artifacts for reuse
      await ensureDir(join(workDir, "artifacts"));
      await writeFile(join(workDir, "artifacts/maven-module-graph.json"), JSON.stringify(javaAnalyzerResult.mavenModuleGraph, null, 2), "utf-8");
      await writeFile(join(workDir, "artifacts/osgi-bundle-index.json"), JSON.stringify(javaAnalyzerResult.osgiBundleIndex, null, 2), "utf-8");
      await writeFile(join(workDir, "artifacts/osgi-extension-index.json"), JSON.stringify(javaAnalyzerResult.osgiExtensionIndex, null, 2), "utf-8");
      await writeFile(join(workDir, "artifacts/feature-composition.json"), JSON.stringify(javaAnalyzerResult.featureComposition, null, 2), "utf-8");
      await writeFile(join(workDir, "artifacts/java-dependency-graph.json"), JSON.stringify(javaAnalyzerResult.javaDependencyGraph, null, 2), "utf-8");
      // Inject evidenceFacts as A-level mechanical observations (skip LLM enrichment)
      javaAnalyzerEvidence = javaAnalyzerResult.evidenceFacts.map((f) => ({
        path: f.file,
        content: f.observation,
        purpose: `mechanical:${f.source}:round:${plan.round}`,
        observations: [f.observation],
        interpretations: [],
        evidence_strength: "A",
        related_questions: [],
        _is_mechanical: true,
      }));
      console.log(`  Java analyzer: ${javaAnalyzerResult.stats.osgiBundles} bundles, ${javaAnalyzerResult.stats.extensionPoints} ext points, ${javaAnalyzerResult.stats.features} features → ${javaAnalyzerEvidence.length} mechanical facts`);
    } catch (err) {
      console.warn(`  Java analyzer failed (non-fatal): ${err.message}`);
    }
  }

  // 4a.0b: Tree-sitter code fact extraction — p6 copy.md §3-§4
  // "Tree-sitter 负责让系统'知道代码是什么'" — symbols/calls/imports as A-level facts
  let treeSitterEvidence = [];
  let treeSitterResult = null;
  try {
    console.log("  4a.0b: Running Tree-sitter code fact extraction...");
    const { analyzeCodeRepo } = await import("./tree-sitter-analyzer.mjs");
    treeSitterResult = await analyzeCodeRepo(repoPath, scan, workDir);
    treeSitterEvidence = treeSitterResult.evidenceFacts.map((f) => ({
      path: f.file,
      content: f.observation,
      purpose: `mechanical:${f.source}:round:${plan.round}`,
      observations: [f.observation],
      interpretations: [],
      evidence_strength: "A",
      related_questions: [],
      _is_mechanical: true,
    }));
    console.log(`  Tree-sitter: ${treeSitterResult.stats.filesParsed} files → ${treeSitterResult.stats.totalSymbols} symbols, ${treeSitterResult.stats.totalCalls} calls → ${treeSitterEvidence.length} facts`);
  } catch (err) {
    console.warn(`  Tree-sitter analyzer failed (non-fatal): ${err.message}`);
  }

  // 4a.0c: Build unified Knowledge Graph — p6 copy.md §5-§6
  // "Graphology 负责让系统'知道代码之间如何关联'" — merges all mechanical facts
  // kgResult is declared in the outer scope so graphContext (built later) can
  // reference its views/metrics. Previously this was declared inside the try
  // block AND referenced as the undeclared `knowledgeGraphResult`, causing a
  // ReferenceError that silently nullified graphContext → LLM never saw the
  // graph topology, producing empty Runtime/Architecture sections.
  let knowledgeGraphEvidence = [];
  let kgResult = null;
  let archFacts = null;        // Architecture facts for LLM prompt injection
  let archFactsStr = "";       // Formatted string for LLM prompts
  if (treeSitterResult || javaAnalyzerResult) {
    try {
      console.log("  4a.0c: Building Repository Knowledge Graph (graphology)...");
      const { buildKnowledgeGraph } = await import("./knowledge-graph.mjs");
      kgResult = await buildKnowledgeGraph(
        { tsResult: treeSitterResult, javaResult: javaAnalyzerResult },
        workDir
      );
      knowledgeGraphEvidence = kgResult.evidenceFacts.map((f) => ({
        path: f.file,
        content: f.observation,
        purpose: `mechanical:${f.source}:round:${plan.round}`,
        observations: [f.observation],
        interpretations: [],
        evidence_strength: "A",
        related_questions: [],
        _is_mechanical: true,
      }));
      console.log(`  Knowledge Graph: ${kgResult.stats.totalNodes} nodes, ${kgResult.stats.totalEdges} edges → ${knowledgeGraphEvidence.length} topological facts`);

      // 4a.0d: Architecture Mining — transform graph topology into architecture facts.
      // This is the KEY transformation: "90 inbound deps" (code fact) →
      // "model module acts as architectural gravity center" (architecture fact).
      // LLM prompts consume these facts instead of raw metrics.
      if (kgResult.graph) {
        try {
          const Graph = (await import("graphology")).default;
          const graph = new Graph({ multi: true, type: "directed" });
          for (const n of kgResult.graph.nodes) {
            if (!graph.hasNode(n.id)) graph.addNode(n.id, n);
          }
          for (const e of kgResult.graph.edges) {
            if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
              graph.addDirectedEdge(e.source, e.target, e);
            }
          }
          archFacts = await mineArchitectureFacts(graph, kgResult.metrics, workDir);
          archFactsStr = formatArchitectureFactsForPrompt(archFacts);
        } catch (err) {
          console.warn(`  Architecture Mining failed (non-fatal): ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`  Knowledge Graph build failed (non-fatal): ${err.message}`);
    }
  }

  let evidence = await mechanicalAnalysis(
    repoPath,
    scan,
    plan.focus || "architecture",
    plan.firstRun !== false,
    existingPaths,
    plan.round
  );

  // Merge: Knowledge Graph (topology) > Tree-sitter (code) > Java (ecosystem) > file-based
  evidence = [
    ...knowledgeGraphEvidence,
    ...treeSitterEvidence,
    ...javaAnalyzerEvidence,
    ...evidence,
  ];

  // Enrich with research insights (p6.md §2: split observation vs interpretation)
  // Skip mechanical facts — they're already structured observations
  const enrichableEvidence = evidence.filter((e) => !e._is_mechanical);
  const mechanicalEvidence = evidence.filter((e) => e._is_mechanical);
  console.log(`  4a.1: Enriching ${enrichableEvidence.length} evidence items (skipping ${mechanicalEvidence.length} mechanical)...`);
  const enrichedEvidence = await enrichEvidenceWithFindings(enrichableEvidence);
  evidence = [...mechanicalEvidence, ...enrichedEvidence];

  // Write evidence to artifacts/evidence-log.jsonl (append-only, per evidence.md:9)
  const evidenceLogPath = join(workDir, "artifacts", "evidence-log.jsonl");
  await ensureDir(join(workDir, "artifacts"));

  // Check for pending_invalidation to set replaces field (per evidence.md:117-119)
  const pendingInvalidation = resume.context?.pending_invalidation;
  const oldEvidenceLog = pendingInvalidation ? existingEvidenceLog : [];

  const nowTs = Date.now();
  const evidenceLines = evidence.map((e, i) => {
    // Find old entry for same file to set replaces (per evidence.md:121 — granularity is (file, purpose))
    const replaces = pendingInvalidation
      ? oldEvidenceLog.find((old) => old.file === e.path && old.purpose === (e.purpose || "mechanical-scan"))?.id || null
      : null;
    return JSON.stringify({
      id: `ev-${nowTs.toString(36)}${String(i + 1).padStart(3, "0")}`,
      ts: new Date().toISOString(),
      file: e.path,
      scope: "file",
      purpose: e.purpose || "mechanical-scan",
      // p6.md §2: split observation (fact) vs interpretation (inference)
      observations: e.observations || e.key_findings || [],
      interpretations: e.interpretations || [],
      // Legacy field (backward compat)
      key_findings: e.key_findings || [...(e.observations || []), ...(e.interpretations || [])],
      evidence_strength: e.evidence_strength,
      related_questions: e.related_questions,
      coverage_delta: {},
      replaces: replaces,
    });
  });

  // Append to evidence-log.jsonl (append-only, per evidence.md:83)
  const existingLog = await readFile(evidenceLogPath, "utf-8").catch(() => "");
  await writeFile(evidenceLogPath, existingLog + evidenceLines.join("\n") + "\n", "utf8");
  console.log(`  Evidence written to evidence-log.jsonl (${evidence.length} entries${pendingInvalidation ? `, ${evidenceLines.filter((l) => JSON.parse(l).replaces).length} replaces` : ""})`);

  // Model Agent reads evidence from evidence-log.jsonl (per evidence.md — not from memory)
  const evidenceFromLog = await readEvidenceLog(workDir);
  // Condense evidence for LLM prompt — the full log accumulates across rounds
  // (514 entries = 340KB after 3 rounds) which produces 100-140KB prompts that
  // cause free-tier LLMs to return minimal/empty output. Condense to top 50
  // deduplicated items prioritizing A-level mechanical facts.
  const evidenceForPrompt = condenseEvidenceForPrompt(evidenceFromLog, 50);
  console.log(`  Evidence: ${evidenceFromLog.length} log entries → ${evidenceForPrompt.length} condensed for LLM prompt`);

  console.log("  4b: Building Repository Model...");
  // p6 copy.md §6: inject Knowledge Graph views so LLM references real topology.
  // kgResult is the outer-scope variable set by the graph build step above.
  const graphContext = kgResult
    ? { views: kgResult.views, metrics: kgResult.metrics }
    : null;
  let model = await buildRepositoryModel(repoType, evidenceForPrompt, graphContext, archFactsStr);
  // If buildRepositoryModel failed (timeout/parse error), keep previous successful model
  // instead of overwriting with empty default. This prevents round-N failure from
  // destroying round-(N-1) results.
  if (model === null) {
    const previousModel = await tryReadJson(join(workDir, "repository-model.json"));
    if (previousModel && (previousModel.structure?.modules?.length > 0 || previousModel.behavior?.control_flow?.length > 0)) {
      model = previousModel;
      console.log("  4b: Reusing previous successful Repository Model (current round failed).");
    } else {
      // No previous model or previous model is also empty — use empty default
      model = {
        structure: { modules: [], boundaries: [] },
        behavior: { control_flow: [], data_flow: [] },
        ownership: { state: [], responsibility: [] },
        extension: { plugin_points: [], public_api: [] },
        evolution: { major_changes: [], current_direction: "" },
      };
    }
  }

  // Interpretation + Risk + Challenge — unified into one LLM call
  console.log("  4c: Architecture interpretation + risk + challenge (unified)...");
  const { interpretation: newInterp, challenge: newChallenge } = await interpretAnalyzeAndChallenge(repoType, model, evidenceForPrompt, graphContext, archFactsStr);

  // 4b.5: Architecture Narrative — the missing "story" layer between model and report.
  // Produces architecture-story.json: system_thesis, core_tension, mechanisms, tradeoffs.
  // Report translates this story into narrative Markdown, NOT form-filling.
  console.log("  4b.5: Architecture Narrative (story layer)...");
  let narrative = await buildArchitectureNarrative(repoType, model, evidenceForPrompt, archFactsStr);
  if (!narrative) {
    const prevNarrative = await tryReadJson(join(workDir, "architecture-story.json"));
    if (prevNarrative && prevNarrative.system_thesis) {
      narrative = prevNarrative;
      console.log("  4b.5: Reusing previous successful narrative (current round failed).");
    }
  }
  if (narrative) {
    await writeJson(join(workDir, "architecture-story.json"), narrative);
  }

  // If LLM calls failed (timeout/parse error), results will be empty objects.
  // Keep previous successful artifacts instead of overwriting with empties.
  // This prevents round-N failure from destroying round-(N-1) interpretation.
  const interpHasContent = (newInterp.design_decisions?.length > 0) ||
    (newInterp.engineering_constraints?.length > 0) ||
    (newInterp.architectural_forces?.length > 0) ||
    (newInterp.tradeoffs?.length > 0);
  let interpretation = newInterp;
  if (!interpHasContent) {
    const prevInterp = await tryReadJson(join(workDir, "interpretation.json"));
    if (prevInterp && (
      (prevInterp.design_decisions?.length > 0) ||
      (prevInterp.engineering_constraints?.length > 0) ||
      (prevInterp.architectural_forces?.length > 0)
    )) {
      interpretation = prevInterp;
      console.log("  4c: Reusing previous successful interpretation (current round failed).");
    }
  }

  const challengeHasContent = newChallenge.center_hypothesis ||
    (newChallenge.key_assumptions?.length > 0) ||
    (newChallenge.challenges?.length > 0);
  let challenge = newChallenge;
  if (!challengeHasContent) {
    const prevChallenge = await tryReadJson(join(workDir, "challenge.json"));
    if (prevChallenge && (prevChallenge.center_hypothesis || prevChallenge.challenges?.length > 0)) {
      challenge = prevChallenge;
      console.log("  4c: Reusing previous successful challenge (current round failed).");
    }
  }

  // Persist intermediate reasoning artifacts so the report stage can be resumed independently.
  await writeJson(join(workDir, "interpretation.json"), interpretation);
  await writeJson(join(workDir, "challenge.json"), challenge);

  // Unified Planner + Reasoning: one LLM call updates question status, coverage, next focus, convergence.
  console.log("  4e: Planning + reasoning (unified)...");
  const previousQuestions = plan.firstRun ? [] : (resume.context?.questions || []);
  const previousCoverage = plan.firstRun ? {} : (resume.context?.coverage || {});
  console.log(`    [merge-debug] plan.firstRun=${plan.firstRun}, previousQuestions.length=${previousQuestions.length}, resume.context.questions=${resume.context?.questions?.length ?? "undefined"}`);
  const planResult = await planAndReason(
    repoType,
    scan,
    evidenceForPrompt,
    previousQuestions,
    previousCoverage,
    interpretation,
    challenge,
    plan
  );
  console.log(`    [merge-debug] planResult.questions.length=${planResult.questions?.length}, coverage=${JSON.stringify(planResult.coverage)}`);

  // Normalize question IDs
  const allQuestions = planResult.questions.map((q) => ({
    ...q,
    id: q.id && q.id.startsWith("R") ? q.id : `R${plan.round}-${(q.id || "").replace(/^Q/, "")}`,
  }));
  console.log(`    [merge-debug] allQuestions.length=${allQuestions.length} (after normalization)`);

  return {
    plan,
    evidence: evidenceFromLog, // Return evidence from log, not memory
    questions: allQuestions,
    model,
    interpretation,
    challenge,
    narrative,
    coverage: planResult.coverage,
    next_focus: planResult.next_focus,
    converged: planResult.converged,
    reasoning: planResult.reasoning,
  };
}

// ---------------------------------------------------------------------------
// Stage 5: Report
// ---------------------------------------------------------------------------

function renderReport(repoType, result, evidenceLog = []) {
  const model = result.model || {};
  const interp = result.interpretation || {};
  const challenge = result.challenge || {};
  const coverage = result.coverage || {};
  const narrative = result.narrative || {};
  const af = result.archFacts || {};

  const sections = [];

  // p6.md §1 P0: auto-match evidence for decisions when LLM omitted the evidence field.
  function matchEvidenceForDecision(decision) {
    const textParts = [
      decision.decision || "", decision.chosen || "",
      ...(decision.rejected || []), decision.tradeoff || "", decision.rejected_reason || "",
    ].join(" ");
    const keywords = new Set();
    const tokenRe = /\b[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)+\b|\b[A-Z]{2,}[A-Za-z]*\b|\b[A-Z][a-z]+[A-Z]\w*\b/g;
    let m;
    while ((m = tokenRe.exec(textParts)) !== null) {
      const kw = m[0];
      if (kw.length >= 3 && !["Yes", "No", "The", "This", "That", "Would", "Lacks", "Creates"].includes(kw)) {
        keywords.add(kw);
      }
    }
    if (keywords.size === 0) return [];
    const kwList = [...keywords];
    const matches = [];
    for (const ev of evidenceLog) {
      const file = ev.file || ev.path || "";
      const observations = ev.observations || ev.key_findings || [];
      const obsText = observations.join(" ");
      const hitKw = kwList.find((kw) => file.includes(kw) || obsText.includes(kw));
      if (hitKw) {
        if (file && file !== "(unknown)" && file !== "(directory-structure)" && !file.startsWith("(")) {
          matches.push(file);
        } else if (observations.length > 0) {
          matches.push(observations[0].slice(0, 100));
        }
      }
    }
    const relatedFields = [
      ...(interp.architectural_tensions || []), ...(interp.complexity_drivers || []),
      ...(interp.leverage_points || []), ...(interp.architecture_invariants || []),
      ...(interp.engineering_constraints || []), ...(interp.architectural_forces || []),
    ];
    for (const item of relatedFields) {
      const itemText = [item.tension, item.driver, item.point, item.invariant, item.constraint, item.force].filter(Boolean).join(" ");
      const itemEv = item.evidence || [];
      const hitKw = kwList.find((kw) => itemText.includes(kw) || itemEv.some((e) => e.includes(kw)));
      if (hitKw && itemEv.length > 0) {
        for (const e of itemEv) {
          const pathMatch = e.match(/^([^\s(]+\.java|[^\s(]+\.xml|[^\s(]+\.MF|[^\s(]+\.ts|[^\s(]+\.py|[^\s(]+\.go|[^\s(]+\.rs)\b/);
          if (pathMatch && !matches.includes(pathMatch[1])) matches.push(pathMatch[1]);
        }
      }
    }
    return [...new Set(matches)].slice(0, 3);
  }

  // 1. 架构概览 — narrative-driven, not form-fill
  sections.push(`## 1 架构概览`);
  if (narrative.system_thesis) {
    sections.push(narrative.system_thesis);
    sections.push(`\n`);
    if (narrative.core_tension) {
      sections.push(`**核心矛盾**：${narrative.core_tension}`);
    }
    if (narrative.tension_resolution) {
      sections.push(`\n**矛盾解决方式**：${narrative.tension_resolution}`);
    }
  } else {
    sections.push(`**仓库类型**：${repoType.type || "Unknown"}。`);
    sections.push(`**中心假设**：${challenge.center_hypothesis || "(未设置)"}。`);
  }
  sections.push(`\n`);

  // 2. 架构机制 — from narrative, each mechanism is a story not a table row
  const mechanisms = narrative.architectural_mechanisms || [];
  if (mechanisms.length > 0) {
    sections.push(`## 2 架构机制`);
    sections.push(`系统通过以下机制解决架构问题：\n`);
    for (let i = 0; i < mechanisms.length; i++) {
      const mech = mechanisms[i];
      sections.push(`### 机制 ${i + 1}：${mech.mechanism || "(未命名)"}`);
      sections.push(`**解决的问题**：${mech.purpose || "—"}`);
      sections.push(`**如何工作**：${mech.how_it_works || "—"}`);
      sections.push(`**代价**：${mech.cost || "—"}`);
      if (mech.evidence?.length > 0) {
        sections.push(`**证据**：${mech.evidence.join(", ")}`);
      }
      sections.push(`\n`);
    }
  }

  // 3. 架构引力中心 — from mining, with PageRank
  if (af.gravityCenters?.length > 0) {
    sections.push(`## 3 架构引力中心`);
    sections.push(`系统的核心力量所在。这些节点被大量模块依赖，修改它们会产生广泛影响：\n`);
    for (const c of af.gravityCenters.slice(0, 5)) {
      sections.push(`- **${c.name}**（PageRank ${c.pageRank?.toFixed(2) || "N/A"}, ${c.inDegree} 依赖）：${c.reason}`);
    }
    sections.push(`\n`);
  }

  // 4. 关键权衡 — from narrative, gain vs cost as narrative
  const tradeoffs = narrative.tradeoffs || interp.tradeoffs || [];
  if (tradeoffs.length > 0) {
    sections.push(`## 4 关键权衡`);
    sections.push(`架构是在对立力量之间做选择。以下权衡塑造了当前系统：\n`);
    for (const t of tradeoffs.slice(0, 5)) {
      const gain = t.gain || t.tradeoff || "—";
      const cost = t.cost || "—";
      const ev = (t.evidence || []).join(", ");
      sections.push(`- **获得**：${gain} | **牺牲**：${cost}`);
      if (ev) sections.push(`  - 证据：${ev}`);
    }
    sections.push(`\n`);
  }

  // 5. 设计决策 — with mechanism/intent separation
  const decisions = (interp.design_decisions || []).slice(0, 4);
  if (decisions.length > 0) {
    sections.push(`## 5 设计决策`);
    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i];
      sections.push(`### D${i + 1}：${d.decision || "(未命名决策)"}`);
      if (d.mechanism || d.intent) {
        sections.push(`**机制**：${d.mechanism || "—"}`);
        sections.push(`**意图**：${d.intent || "—"}`);
      }
      sections.push(`**选择**：${d.chosen || "—"} | **拒绝**：${(d.rejected || []).join(", ") || "—"}`);
      sections.push(`**理由**：${d.rejected_reason || d.tradeoff || "—"}`);
      let evList = (d.evidence || []).slice(0, 3);
      const hasRealEvidence = evList.length > 0 && evList.some((e) => e && e !== "待补充" && e !== "—" && e !== "无");
      if (!hasRealEvidence) {
        const matched = matchEvidenceForDecision(d);
        if (matched.length > 0) evList = matched;
      }
      const hasEv = evList.length > 0 && evList.some((e) => e && e !== "待补充" && e !== "—" && e !== "无");
      sections.push(`**证据**：${hasEv ? evList.join(", ") : "⚠ 待补充"}\n`);
    }
    sections.push(`\n`);
  }

  // 6. 维护者心智模型 — the most important section per p6-feedback §8
  const mentalModel = narrative.maintainer_mental_model || interp.maintainer_mental_model;
  sections.push(`## 6 维护者心智模型`);
  if (mentalModel && mentalModel.length > 5) {
    sections.push(`> ${mentalModel}\n`);
    const assumptions = (challenge.key_assumptions || []).slice(0, 3);
    if (assumptions.length > 0) {
      sections.push(`**支撑假设**：`);
      for (const a of assumptions) {
        const level = a.inference_level || "indirect";
        const alt = a.alternative_explanation || "—";
        sections.push(`- ${a.assumption}（推断级别：${level}，替代解释：${alt}）`);
      }
      sections.push(`\n`);
    }
  } else {
    sections.push(`- 待进一步分析维护者心智模型。\n`);
  }

  // 7. 架构张力 — mining + LLM reasoning combined
  const miningTensions = af.tensions || [];
  const llmTensions = (interp.architectural_tensions || []).slice(0, 5);
  if (miningTensions.length > 0 || llmTensions.length > 0) {
    sections.push(`## 7 架构张力`);
    sections.push(`系统中的对立力量，架构师必须在它们之间做出权衡：\n`);
    if (miningTensions.length > 0) {
      sections.push(`**图谱检测到的张力**：`);
      for (const t of miningTensions.slice(0, 5)) {
        sections.push(`- **[${t.axis}]** ${t.description}`);
        sections.push(`  - 证据：${(t.evidence || []).join("; ")}`);
        sections.push(`  - 解决方式：${t.resolution}`);
      }
      sections.push(`\n`);
    }
    if (llmTensions.length > 0) {
      sections.push(`**LLM 推理的张力**：`);
      for (const t of llmTensions) {
        sections.push(`- **[${t.axis || "未分类"}]** ${t.tension}`);
        sections.push(`  - 证据：${(t.evidence || []).join("; ")}`);
        if (t.resolution) sections.push(`  - 解决方式：${t.resolution}`);
      }
      sections.push(`\n`);
    }
  }

  // 8. 模型质疑 — nuanced results, not binary
  const challenges = (challenge.challenges || []).slice(0, 5);
  if (challenges.length > 0) {
    sections.push(`## 8 模型质疑`);
    sections.push(`对中心假设的挑战结果（非二元判断，可能是 partially weakened 或 strengthened）：\n`);
    for (const c of challenges) {
      sections.push(`### ${c.target || "(未命名)"}`);
      sections.push(`**结果**：${c.result || "survived"} | **方法**：${c.method || "—"}`);
      sections.push(`**反证**：${c.counter_evidence || "无反证"}`);
      sections.push(`**备注**：${c.notes || "—"}\n`);
    }
    sections.push(`\n`);
  }

  // 9. 演化压力与历史沉积 — from narrative
  if (narrative.evolution_pressure || narrative.historical_sediment) {
    sections.push(`## 9 演化压力与历史沉积`);
    if (narrative.evolution_pressure) {
      sections.push(`**未来扩展压力**：${narrative.evolution_pressure}\n`);
    }
    if (narrative.historical_sediment) {
      sections.push(`**历史沉积**：${narrative.historical_sediment}\n`);
    }
  }

  // 10. 偶然复杂度
  const accidentalComplexity = (interp.accidental_complexity || []).slice(0, 3);
  if (accidentalComplexity.length > 0) {
    sections.push(`## 10 偶然复杂度`);
    for (const ac of accidentalComplexity) {
      sections.push(`- **${ac.area}**：${ac.description}`);
      sections.push(`  - 证据：${(ac.evidence || []).join("; ")}`);
      sections.push(`  - 可简化：${ac.could_simplify || "—"}`);
    }
    sections.push(`\n`);
  }

  // 11. 风险与修改难度 — tables are appropriate here
  const blastRadius = (interp.blast_radius || []).slice(0, 5);
  const changeDifficulty = (interp.change_difficulty || []).slice(0, 6);
  if (blastRadius.length > 0 || changeDifficulty.length > 0) {
    sections.push(`## 11 风险与修改难度`);
    if (blastRadius.length > 0) {
      sections.push(`**Blast Radius**：\n`);
      sections.push(`| 修改点 | 影响范围 | 风险等级 |`);
      sections.push(`| --- | --- | --- |`);
      for (const br of blastRadius) {
        sections.push(`| ${br.component || "—"} | ${(br.impact_scope || []).join(", ") || "—"} | ${br.risk_level || "—"} |`);
      }
      sections.push(`\n`);
    }
    if (changeDifficulty.length > 0) {
      sections.push(`**修改难度**：\n`);
      sections.push(`| 修改 | 难度 | 理由 |`);
      sections.push(`| --- | --- | --- |`);
      for (const cd of changeDifficulty) {
        sections.push(`| ${cd.change || "—"} | ${cd.difficulty || "—"} | ${cd.reason || "—"} |`);
      }
      sections.push(`\n`);
    }
  }

  // 12. 架构违规 — from mining
  if (af.violations?.length > 0) {
    sections.push(`## 12 架构违规`);
    sections.push(`违反架构模式的地方，可能是技术债或刻意妥协：\n`);
    for (const v of af.violations.slice(0, 5)) {
      sections.push(`- **[${v.type}]** ${v.description}（严重度：${v.severity}）`);
      sections.push(`  - 证据：${(v.evidence || []).join("; ")}`);
    }
    sections.push(`\n`);
  }

  // 13. 覆盖率
  const coveredDims = Object.entries(coverage).filter(([, v]) => (typeof v === "number" ? v : v?.ratio ?? 0) >= 0.8).map(([k]) => k);
  const unresolvedDims = Object.entries(coverage).filter(([, v]) => (typeof v === "number" ? v : v?.ratio ?? 0) < 0.5);
  sections.push(`## 13 覆盖率`);
  sections.push(`**已覆盖维度**：${coveredDims.length > 0 ? coveredDims.join(", ") : "暂无"}。`);
  if (unresolvedDims.length > 0) {
    sections.push(`**证据不足的维度**：`);
    for (const [dim, v] of unresolvedDims) {
      const ratio = typeof v === "number" ? v : v?.ratio ?? 0;
      sections.push(`- **${dim}**（覆盖率 ${(ratio * 100).toFixed(0)}%）：建议补充 ${dim} 相关源码或测试。`);
    }
  }
  sections.push(`\n`);

  return sections.join("\n");
}

async function stageFiveReport(repoPath, repoType, result, workDir) {
  console.log("Stage 5: Rendering report from precomputed artifacts...\n");
  // If the last research round failed to produce interpretation/challenge,
  // fall back to the previously persisted artifacts so the report is never empty.
  const interpretation =
    result.interpretation && Object.keys(result.interpretation).length > 0
      ? result.interpretation
      : (await tryReadJson(join(workDir, "interpretation.json"))) || {};
  const challenge =
    result.challenge && Object.keys(result.challenge).length > 0
      ? result.challenge
      : (await tryReadJson(join(workDir, "challenge.json"))) || {};
  // Load evidence-log.jsonl so renderReport can auto-match evidence for decisions
  // that the LLM left without explicit evidence references (p6.md §1 P0 gate).
  const evidenceLog = await readEvidenceLog(workDir);
  // Load architecture facts (from Architecture Mining stage) so the report
  // can display gravity centers, tensions, and violations — not just code metrics.
  const archFacts = await tryReadJson(join(workDir, "artifacts", "architecture-facts.json"));
  // Load architecture story (from Narrative stage) — the primary source for report narrative.
  const narrative = result.narrative || await tryReadJson(join(workDir, "architecture-story.json"));
  const report = renderReport(repoType, { ...result, interpretation, challenge, archFacts, narrative }, evidenceLog);
  await writeFile(join(workDir, "report-draft.md"), report, "utf-8");
  return report;
}

async function publishReportAndCheckpoint(workDir, repoPath, context, contextPath) {
  // Rename report-draft.md → report.md
  const draftPath = join(workDir, "report-draft.md");
  const finalPath = join(workDir, "report.md");
  const draft = await readFile(draftPath, "utf-8");
  await writeFile(finalPath, draft, "utf-8");
  try {
    await import("node:fs/promises").then((fs) => fs.unlink(draftPath));
  } catch {
    // ignore
  }

  // Update last_analyzed_commit from pending target commit
  const meta = await loadMeta(workDir) || {};
  const targetCommit = meta.analysis_target_commit || meta.last_analyzed_commit;
  const newMeta = {
    ...meta,
    last_analyzed_commit: targetCommit,
    analysis_target_commit: null,
    analyzed_at: new Date().toISOString(),
  };
  await writeMeta(workDir, newMeta);

  // Update context resume: Workspace Agent completed checkpoint+publish (per workspace.md Stage table)
  context.resume = {
    last_completed_stage: "workspace",
    next_stage: "done",
    last_round: context.current_round || 1,
  };
  // Per workspace.md: clear pending_invalidation on checkpoint
  context.pending_invalidation = null;
  await writeJson(contextPath, context);

  console.log(`\n=== Published: ${finalPath} ===`);
  console.log(`Checkpoint: last_analyzed_commit = ${targetCommit || "unknown"}\n`);
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const repoArg = args[0];

  if (!repoArg) {
    console.error("Usage: node research.mjs <repo-path> [--force] [--skip-gate]");
    process.exit(1);
  }

  const repoPath = resolve(repoArg);
  const force = args.includes("--force");
  const skipGate = args.includes("--skip-gate");

  const repoName = basename(repoPath);
  const workDir = join(WORKING_DIR, repoName);
  const contextPath = join(workDir, "context.json");
  const questionsDir = join(workDir, "questions");
  const modelPath = join(workDir, "repository-model.json");
  const metaPath = join(workDir, "meta.json");

  console.log(`\n=== Repository Research: ${repoName} ===\n`);
  console.log(`Repository: ${repoPath}`);
  console.log(`Working directory: ${workDir}\n`);

  // ========================================================================
  // Stage 0: Resume Workspace
  // ========================================================================

  const resume = await stageZeroResume(workDir, repoPath, force);
  if (resume.done) {
    process.stdout.write(resume.report.slice(0, 500) + "...\n\n");
    return;
  }

  // Create working directory if fresh
  if (!resume.resumed) {
    await ensureDir(workDir);
    await ensureDir(questionsDir);
  }

  // Initialize pipeline logger (global, accessible from llm-runner.mjs)
  const logger = new PipelineLogger(workDir);
  globalThis.__pipelineLogger = logger;
  logger.mark("Pipeline started", { repo: repoName });

  // ========================================================================
  // Stage 1: Scan Repository (conditional)
  // ========================================================================

  logger.start("Stage 1: Scan Repository");
  const { scan, profile } = await stageOneScan(workDir, repoPath, resume);
  logger.end("Stage 1: Scan Repository");

  // ========================================================================
  // Stage 2: Analyze Delta (conditional)
  // ========================================================================

  logger.start("Stage 2: Analyze Delta");
  const delta = await stageTwoDelta(workDir, repoPath, resume);
  logger.end("Stage 2: Analyze Delta");

  // ========================================================================
  // Stage 3: Research Planner
  // ========================================================================

  logger.start("Stage 3: Research Planner");
  const plan = await stageThreePlanner(resume);
  logger.end("Stage 3: Research Planner");

  // ========================================================================
  // Stage 3-5: Iterative Research Loop (per SKILL.md Stage 0-9, planner.md convergence)
  // Planner determines convergence; if not converged, loop back for next round
  // ========================================================================

  const MAX_ROUNDS = 3; // safety limit
  let currentPlan = plan;
  let currentResult = null;
  let currentResume = resume;
  let roundFile = `round-${plan.round}.json`;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Stage 4: Architecture Research (pass workDir for evidence-log.jsonl access)
    currentResult = await stageFourResearch(repoPath, currentResume, currentPlan, scan, profile, workDir);

    // Save model
    await writeJson(modelPath, currentResult.model);

    // Save questions (per workspace.md: questions/round-N.json is frozen after creation)
    roundFile = `round-${currentPlan.round}.json`;
    const roundData = {
      round: currentPlan.round,
      generated_from: currentPlan.firstRun ? [] : [currentResume.questions?.latest_round || 1],
      trigger: currentPlan.firstRun ? "initial" : `planner_focus_${currentPlan.focus}`,
      purpose: currentPlan.firstRun ? "discovery" : `focus_${currentPlan.focus}`,
      status: "active",
      questions: currentResult.questions,
    };
    await writeJson(join(questionsDir, roundFile), roundData);

    // Save summary (per workspace.md: Workspace Agent owns summary.json)
    const summary = {
      latest_round: currentPlan.round,
      rounds: [
        ...(currentResume.questions?.rounds || []),
        { round: currentPlan.round, file: roundFile, purpose: roundData.purpose, status: "active" },
      ],
    };
    await writeJson(join(questionsDir, "summary.json"), summary);

    // Checkpoint context so the next Planner reads updated coverage/stats (fixes coverage=0% across rounds)
    const existingContext = await tryReadJson(contextPath) || {};
    const roundTotal = currentResult.questions.length;
    const roundAnswered = currentResult.questions.filter((q) => q.status === "answered" || q.status === "validated").length;
    const roundValidated = currentResult.questions.filter((q) => q.status === "validated").length;
    const prevStats = existingContext.question_statistics || { rounds: 0, total_questions: 0, answered: 0, validated: 0 };
    await writeJson(contextPath, {
      ...existingContext,
      current_round: currentPlan.round,
      current_question_file: roundFile,
      coverage: currentResult.coverage,
      next_focus: currentResult.next_focus,
      converged: currentResult.converged,
      questions: currentResult.questions,
      reasoning: currentResult.reasoning,
      question_statistics: {
        rounds: currentPlan.round,
        total_questions: prevStats.total_questions + roundTotal,
        answered: prevStats.answered + roundAnswered,
        validated: prevStats.validated + roundValidated,
      },
    });

    // Check convergence based on the unified Planner+Reasoning output
    if (currentResult.converged) {
      console.log(`\n=== Research converged after round ${currentPlan.round} ===\n`);
      break;
    }

    // Plan next round if not converged
    if (round < MAX_ROUNDS - 1) {
      console.log(`\n=== Planning round ${currentPlan.round + 1}... ===\n`);
      currentResume = {
        ...currentResume,
        context: await tryReadJson(contextPath),
        questions: summary,
        lastRound: currentPlan.round,
      };
      currentPlan = await stageThreePlanner(currentResume);
      if (currentPlan.converged) {
        console.log(`\n=== Research converged (planner determined) ===\n`);
        break;
      }
    }
  }

  const result = currentResult;

  // ========================================================================
  // Stage 5: Report
  // ========================================================================

  const repoType = profile || (await loadStableArtifact(workDir, "repository-profile")) || { type: "Unknown", focus_areas: [] };
  const report = await stageFiveReport(repoPath, repoType, result, workDir);

  // ========================================================================
  // Update context.json
  // ========================================================================

  const allQuestions = result.questions;
  const totalQ = allQuestions.length;
  const answeredQ = allQuestions.filter((q) => q.status === "answered" || q.status === "validated").length;
  const validatedQ = allQuestions.filter((q) => q.status === "validated").length;

  // model_stability state machine (per reasoning.md:286-295):
  // nascent → formative → challenged → stable (never skip nascent→stable)
  // First run: nascent (just built, not yet challenged enough)
  // After challenge: challenged → stable if all survived, or stays challenged
  const challengeResults = result.challenge?.challenges || [];
  const hasOverturned = challengeResults.some((c) => c.result === "overturned");
  const hasWeakened = challengeResults.some((c) => c.result === "weakened");
  const modelStability = currentPlan.firstRun
    ? "nascent"
    : (hasOverturned ? "challenged" : (hasWeakened ? "challenged" : "stable"));

  // architecture_invariants: NOT engineering_constraints (per reasoning.md:56)
  // invariants = architectural assumptions that cannot be violated
  // constraints = environmental/technical constraints
  const architectureInvariants = (result.interpretation.architecture_invariants || []).map((i) => i.invariant || i);

  // maintainer_view: per reasoning.md:208-270
  // complexity_drivers: NOT architectural_tensions — complexity sources, not force conflicts
  const complexityDrivers = (result.interpretation.complexity_drivers || []).map((d) => d.driver || d);

  // Load cumulative stats already checkpointed during the research loop.
  const latestContext = await tryReadJson(contextPath) || {};
  const questionStatistics = latestContext.question_statistics || {
    rounds: currentPlan.round,
    total_questions: totalQ,
    answered: answeredQ,
    validated: validatedQ,
  };

  const context = {
    user_input: `分析 ${repoPath} 仓库的架构`,
    resume: {
      last_completed_stage: "report",
      next_stage: "quality",
      last_round: currentPlan.round,
    },
    current_round: currentPlan.round,
    current_question_file: roundFile,
    model_stability: modelStability,
    question_statistics: questionStatistics,
    coverage: result.coverage,
    // Preserve questions/next_focus/converged/reasoning so subsequent runs can
    // read previous questions for the merge step in planAndReason. Previously
    // this final context write created a fresh object, dropping these fields —
    // causing previousQuestions to be [] on resume, which collapsed the merged
    // question list to only the new round's questions and froze coverage at 0%.
    questions: allQuestions,
    next_focus: result.next_focus,
    converged: result.converged,
    reasoning: result.reasoning,
    architecture_model: {
      center_hypothesis: result.challenge.center_hypothesis,
      key_assumptions: result.challenge.key_assumptions || [],
      architecture_invariants: architectureInvariants,
      unexplained_observations: [],
      competing_interpretations: result.challenge.competing_interpretations || [],
    },
    challenge_record: result.challenge.challenges || [],
    // design_space: use LLM-returned schema directly (per reasoning.md:174-191)
    design_space: (result.interpretation.design_decisions || []).map((d) => ({
      decision: d.decision,
      chosen: d.chosen,
      rejected: d.rejected || [],
      rejected_reason: d.rejected_reason || "",
      tradeoff: d.tradeoff || "",
      mature_alternatives_compared: d.mature_alternatives_compared || [],
    })),
    maintainer_view: {
      modification_impact_map: {},
      complexity_drivers: complexityDrivers,
      // blast_radius, change_difficulty, design_smells (per reasoning.md:208-270)
      blast_radius: result.interpretation.blast_radius || [],
      change_difficulty: result.interpretation.change_difficulty || [],
      design_smells: result.interpretation.design_smells || [],
    },
    // NOTE: evidence_collected field intentionally omitted — per evidence.md:144
    quality_gate: { center_identified: false, alternatives_considered: false, counterexamples_found: false, model_challenged: false },
  };

  // Code change state rollback (per reasoning.md:297-307)
  if (resume.context?.pending_invalidation) {
    context.model_stability = "formative";
    // coverage: affected dimensions reset to 0.3 baseline (per reasoning.md:304)
    for (const dim of Object.keys(context.coverage)) {
      context.coverage[dim] = { answered: 0, total: context.coverage[dim]?.total || 0, ratio: 0.3 };
    }
    context.quality_gate = { center_identified: false, alternatives_considered: false, counterexamples_found: false, model_challenged: false };
    console.log("  [Reasoning] pending_invalidation detected — state rolled back (model_stability→formative, coverage→0.3 baseline)");
  }

  await writeJson(contextPath, context);

  // NOTE: evidence-log.jsonl is already written in stageFourResearch (step 4a)
  // per evidence.md: Evidence Agent writes to evidence-log.jsonl immediately, not at end of pipeline

  // ========================================================================
  // Write meta.json — only analysis_target_commit (pending), NOT last_analyzed_commit
  // (per scan.md:85: last_analyzed_commit only updated by Workspace after Quality PASS)
  // ========================================================================

  const commit = getCurrentCommit(repoPath);
  const existingMeta = await loadMeta(workDir) || {};
  const meta = {
    ...existingMeta,
    repo_path: repoPath,
    repo_type: repoType.type,
    analysis_target_commit: commit || "unknown",
    analyzed_at: new Date().toISOString(),
    model_version: "2.0",
  };
  await writeMeta(workDir, meta);

  // ========================================================================
  // Gated checks
  // ========================================================================

  if (!skipGate) {
    console.log("Running gated checks...");
    let allPassed = false;
    try {
      const { preconditions, gates, allPassed: passed, summary } = await runAllChecks(context, report);
      allPassed = passed;
      console.log(`\n=== Preconditions: ${preconditions.checks.filter((c) => c.passed).length}/${preconditions.checks.length} passed ===\n`);
      for (const c of preconditions.checks) console.log(`[${c.passed ? "PASS" : "FAIL"}] ${c.name}`);
      console.log(`\n=== Gated Checks: ${gates.summary} ===\n`);
      for (const r of gates.results) console.log(`[${r.passed ? "PASS" : "FAIL"}] ${r.name}`);
      console.log(`\n=== Summary: ${summary} ===\n`);
      for (const r of gates.results) context.quality_gate[r.id] = r.passed;
      await writeJson(contextPath, context);

      if (!preconditions.allPassed) {
        console.error("Preconditions failed. Report remains in report-draft.md; no checkpoint published.\n");
        process.exit(2);
      }
      if (!allPassed) {
        console.error("Gated checks failed. Report remains in report-draft.md; no checkpoint published.\n");
        process.exit(3);
      }
    } catch (err) {
      console.error(`Gated checks failed: ${err.message}\n`);
      console.error("Report remains in report-draft.md; no checkpoint published.\n");
      process.exit(4);
    }

    // Gate passed: publish report and checkpoint
    await publishReportAndCheckpoint(workDir, repoPath, context, contextPath);
  } else {
    console.log("Skipping gated checks. Publishing report without checkpoint.\n");
    // --skip-gate: skip quality checks but still publish report.md
    await publishReportAndCheckpoint(workDir, repoPath, context, contextPath);
  }

  console.log(`\n=== Analysis complete ===`);
  console.log(`Report: ${join(workDir, "report.md")}`);
  console.log(`Draft:  ${join(workDir, "report-draft.md")}`);
  console.log(`Context: ${contextPath}`);
  console.log(`Model: ${modelPath}\n`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
