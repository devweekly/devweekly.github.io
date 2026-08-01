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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WORKING_DIR = resolve(process.cwd(), ".working");
const DEFAULT_MODEL = "opencode/deepseek-v4-flash-free";

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

  // Per scan.md:86: write pending_invalidation for Evidence/Reasoning to read
  const contextPath = join(workDir, "context.json");
  const existingContext = await tryReadJson(contextPath);
  if (existingContext) {
    existingContext.pending_invalidation = { changed_files: changed, target_commit: commit };
    await writeJson(contextPath, existingContext);
    console.log(`  pending_invalidation set (${changed.length} files)\n`);
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

  const codeExts = [".py", ".js", ".ts", ".mjs", ".rs", ".go", ".java"];
  const isCode = (f) => codeExts.some((ext) => f.endsWith(ext));

  // Full exploration only on the first round; subsequent rounds drill into the weakest dimension.
  if (isFirstRun) {
    // 1. Metadata files
    for (const file of ["package.json", "README.md", "ARCHITECTURE.md", "pyproject.toml", "setup.py", "Cargo.toml"]) {
      if (seen(file, "元数据")) continue;
      const fullPath = join(repoPath, file);
      if (await fileExists(fullPath)) {
        const content = await readFile(fullPath, "utf-8");
        evidence.push({ path: file, content: content.slice(0, 800), purpose: `元数据:round:${round}` });
      }
    }

    // 2. Entry points and top-level modules
    const rootFiles = scan.files.filter((f) => !f.includes("/") && isCode(f)).slice(0, 5);
    for (const file of rootFiles) {
      if (seen(file, "入口文件")) continue;
      const fullPath = join(repoPath, file);
      if (await fileExists(fullPath)) {
        const content = await readFile(fullPath, "utf-8");
        evidence.push({ path: file, content: content.slice(0, 600), purpose: `入口文件:round:${round}` });
      }
    }

    // 3. Largest source files (proxy for complexity centers)
    const codeFiles = scan.files.filter(isCode);
    const largestFiles = [];
    for (const file of codeFiles.slice(0, 50)) {
      try {
        const s = await stat(join(repoPath, file));
        largestFiles.push({ file, size: s.size });
      } catch {}
    }
    largestFiles.sort((a, b) => b.size - a.size);
    for (const { file } of largestFiles.slice(0, 3)) {
      if (seen(file, "大型文件")) continue;
      const content = await readFile(join(repoPath, file), "utf-8");
      evidence.push({ path: file, content: content.slice(0, 500), purpose: `大型文件:round:${round}` });
    }
  }

  // 4. Focus-area files (heuristic: directory names matching focus)
  const focusDirs = {
    runtime: ["runtime", "engine", "loop", "async", "executor"],
    architecture: ["core", "model", "models", "architecture", "layers", "modules"],
    design_decisions: ["config", "policy", "decision", "tradeoff"],
    testing: ["tests", "test", "testing", "pytest"],
    deployment: ["deploy", "docker", "k8s", "ci", "github"],
    history: ["changelog", "history", "migrations", "docs"],
  };
  const focusKeywords = focusDirs[focus] || focusDirs.architecture;
  const focusFiles = scan.files
    .filter((f) => isCode(f) && focusKeywords.some((kw) => f.toLowerCase().includes(kw)))
    .slice(0, 5);
  for (const file of focusFiles) {
    if (seen(file, `focus:${focus}`)) continue;
    const fullPath = join(repoPath, file);
    if (await fileExists(fullPath)) {
      const content = await readFile(fullPath, "utf-8");
      evidence.push({ path: file, content: content.slice(0, 600), purpose: `focus:${focus}:round:${round}` });
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
    const prompt = `
你是 Evidence Agent。为每个文件片段提炼 1-3 条研究洞察（key_findings）。
洞察应该回答："这个文件揭示了什么设计意图/约束/模式/风险？"，而不是复述文件内容。

文件片段：
${batch.map((e, i) => `[${baseIndex + i}] ${e.path} (purpose: ${e.purpose})\n${(e.content || "").slice(0, 400)}`).join("\n\n---\n\n")}

输出 JSON：
{"findings":[{"index":${baseIndex},"key_findings":["洞察1","洞察2"],"evidence_strength":"A","related_questions":["R1-Q1"]}]}

要求：
- 每个文件 1-3 条 key_findings
- evidence_strength: A=源码实现直接证明, B=配置/文档, C=推断
- related_questions 可空
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
      enriched.push({
        ...batch[i],
        key_findings: Array.isArray(f.key_findings) && f.key_findings.length > 0
          ? f.key_findings
          : ["原始内容片段，待进一步解读"],
        evidence_strength: f.evidence_strength || "B",
        related_questions: Array.isArray(f.related_questions) ? f.related_questions : [],
      });
    }
  }
  return enriched;
}

function evidenceToInsightStr(evidence) {
  return evidence
    .map((e) => `--- ${e.path} (${e.purpose || "mechanical-scan"}) ---\n${(e.key_findings || []).join("; ")}`)
    .join("\n\n");
}

async function buildRepositoryModel(repoType, evidence) {
  const evidenceStr = evidenceToInsightStr(evidence);
  const prompt = `
构建 Repository Model，保持简洁（最多各 4 条）。
仓库类型: ${repoType.type}
证据洞察: ${evidenceStr}
5 维模型: structure(modules+boundaries), behavior(control_flow+data_flow), ownership(state+responsibility), extension(plugin_points+public_api), evolution(major_changes+current_direction)
输出 JSON。
`;
  try {
    return await invokeLLMJSON(prompt, { model: DEFAULT_MODEL, _label: "buildRepositoryModel" });
  } catch (err) {
    console.warn("  Repository model build failed:", err.message);
    return {
      structure: { modules: [], boundaries: [] },
      behavior: { control_flow: [], data_flow: [] },
      ownership: { state: [], responsibility: [] },
      extension: { plugin_points: [], public_api: [] },
      evolution: { major_changes: [], current_direction: "" },
    };
  }
}

// Unified Architecture Interpretation + Risk + Challenge.
// Split into two parallel calls to bound per-call output size and runtime:
//   - interpretCore: 6 core interpretation items (constraints/forces/invariants/decisions/tradeoffs/mental_model)
//   - riskAndChallenge: 7 risk/extra items + full challenge
// Each call's JSON schema is half the original → faster, more stable on large repos.
async function interpretAnalyzeAndChallenge(repoType, model, evidence) {
  const evidenceStr = evidenceToInsightStr(evidence);
  const modelSummary = condenseModelForInterpretation(model);

  const [coreRes, riskRes] = await Promise.allSettled([
    interpretCore(repoType, modelSummary, evidenceStr),
    riskAndChallenge(repoType, modelSummary, evidenceStr),
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
async function interpretCore(repoType, modelSummary, evidenceStr) {
  const prompt = `
你是 Architecture Research Agent。基于 Repository Model 和证据，解释系统的工程思想。
严格控制输出长度，每个列表最多 3 项。

仓库类型: ${repoType.type}
Model: ${JSON.stringify(modelSummary, null, 2)}
证据洞察: ${evidenceStr}

输出 JSON（严格 JSON，不要 markdown 代码块）:
{
  "engineering_constraints": [{"constraint":"约束","evidence":["证据"]}],
  "architectural_forces": [{"force":"作用力","evidence":["证据"]}],
  "architecture_invariants": [{"invariant":"不变量","evidence":["证据"]}],
  "design_decisions": [{"decision":"决策","chosen":"选择","rejected":["被拒绝方案"],"rejected_reason":"为什么拒绝","tradeoff":"牺牲了什么换取了什么","mature_alternatives_compared":[{"alternative":"方案","why_not":"为什么不用","evidence":["证据"]}]}],
  "tradeoffs": [{"tradeoff":"权衡","evidence":["证据"]}],
  "maintainer_mental_model": "维护者心智划分（一句话）"
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
async function riskAndChallenge(repoType, modelSummary, evidenceStr) {
  const prompt = `
你是 Architecture Research Agent。基于 Repository Model 和证据，评估修改风险并挑战中心假设。
严格控制输出长度，每个列表最多 3 项。

仓库类型: ${repoType.type}
Model: ${JSON.stringify(modelSummary, null, 2)}
证据洞察: ${evidenceStr}

输出 JSON（严格 JSON，不要 markdown 代码块）:
{
  "intentional_omissions": [{"omission":"省略","why":"理由","evidence":["证据"]}],
  "architectural_tensions": [{"tension":"张力","evidence":["证据"]}],
  "complexity_drivers": [{"driver":"复杂度来源","evidence":["证据"]}],
  "leverage_points": [{"point":"杠杆点","evidence":["证据"]}],
  "blast_radius": [{"component":"组件","impact_scope":["影响1","影响2"],"risk_level":"Critical|High|Medium|Low"}],
  "change_difficulty": [{"change":"修改","difficulty":"Low|Medium|High","reason":"理由"}],
  "design_smells": [{"smell":"smell名称","type":"deliberate","evidence":["证据"]}],
  "challenge": {
    "center_hypothesis": "一句话中心假设",
    "key_assumptions": [{"assumption":"假设","evidence":["证据"],"challenged":true,"survived":true}],
    "competing_interpretations": [{"interpretation":"备选解释","evidence":["证据"],"confidence":"medium"}],
    "challenges": [{"target":"被质疑的决策/假设","method":"假设翻转|边界测试|移除测试|时间测试","counter_evidence":"反证或 null","result":"survived|weakened|overturned","notes":"补充说明"}]
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
async function planAndReason(repoType, scan, evidence, previousQuestions, previousCoverage, interpretation, challenge, plan) {
  const DIMENSIONS = ["runtime", "architecture", "design_decisions", "testing", "deployment", "history"];
  const count = plan.firstRun ? 6 : 3;
  const evidenceSummary = evidence
    .slice(-15)
    .map((e) => `- ${e.path}: ${(e.key_findings || []).join("; ")}`)
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
    const coverage = result?.coverage || computeCoverageFallback(result?.questions || previousQuestions || [], previousCoverage);
    const ratios = Object.entries(coverage).map(([, v]) => (typeof v === "number" ? v : v?.ratio ?? 0));
    const allCovered = ratios.length > 0 && ratios.every((r) => r >= 0.8);
    return {
      questions: Array.isArray(result?.questions) ? result.questions : generateFallbackQuestions(repoType, plan, count),
      coverage,
      next_focus: result?.next_focus || (allCovered ? "converged" : Object.entries(coverage).sort((a, b) => (typeof a[1] === "number" ? a[1] : a[1]?.ratio ?? 0) - (typeof b[1] === "number" ? b[1] : b[1]?.ratio ?? 0))[0]?.[0] || "architecture"),
      converged: Boolean(result?.converged) || allCovered,
      reasoning: result?.reasoning || "",
    };
  } catch (err) {
    console.warn("  Planner+Reasoning failed:", err.message);
    const fallbackQuestions = generateFallbackQuestions(repoType, plan, count);
    const fallbackCoverage = computeCoverageFallback(fallbackQuestions, previousCoverage);
    const nextFocus = Object.entries(fallbackCoverage).sort((a, b) => (a[1].ratio ?? a[1]) - (b[1].ratio ?? b[1]))[0]?.[0] || "architecture";
    return {
      questions: fallbackQuestions,
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

  let evidence = await mechanicalAnalysis(
    repoPath,
    scan,
    plan.focus || "architecture",
    plan.firstRun !== false,
    existingPaths,
    plan.round
  );

  // Enrich with research insights (evidence.md:56 — key_findings must be insights, not summaries)
  console.log(`  4a.1: Enriching ${evidence.length} evidence items with findings...`);
  evidence = await enrichEvidenceWithFindings(evidence);

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
      key_findings: e.key_findings,
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

  console.log("  4b: Building Repository Model...");
  const model = await buildRepositoryModel(repoType, evidenceFromLog);

  // Interpretation + Risk + Challenge — unified into one LLM call
  console.log("  4c: Architecture interpretation + risk + challenge (unified)...");
  const { interpretation, challenge } = await interpretAnalyzeAndChallenge(repoType, model, evidenceFromLog);

  // Persist intermediate reasoning artifacts so the report stage can be resumed independently.
  await writeJson(join(workDir, "interpretation.json"), interpretation);
  await writeJson(join(workDir, "challenge.json"), challenge);

  // Unified Planner + Reasoning: one LLM call updates question status, coverage, next focus, convergence.
  console.log("  4e: Planning + reasoning (unified)...");
  const previousQuestions = plan.firstRun ? [] : (resume.context?.questions || []);
  const previousCoverage = plan.firstRun ? {} : (resume.context?.coverage || {});
  const planResult = await planAndReason(
    repoType,
    scan,
    evidenceFromLog,
    previousQuestions,
    previousCoverage,
    interpretation,
    challenge,
    plan
  );

  // Normalize question IDs
  const allQuestions = planResult.questions.map((q) => ({
    ...q,
    id: q.id && q.id.startsWith("R") ? q.id : `R${plan.round}-${(q.id || "").replace(/^Q/, "")}`,
  }));

  return {
    plan,
    evidence: evidenceFromLog, // Return evidence from log, not memory
    questions: allQuestions,
    model,
    interpretation,
    challenge,
    coverage: planResult.coverage,
    next_focus: planResult.next_focus,
    converged: planResult.converged,
    reasoning: planResult.reasoning,
  };
}

// ---------------------------------------------------------------------------
// Stage 5: Report
// ---------------------------------------------------------------------------

function renderReport(repoType, result) {
  const model = result.model || {};
  const interp = result.interpretation || {};
  const challenge = result.challenge || {};
  const coverage = result.coverage || {};

  const sections = [];

  // 1. 执行摘要
  sections.push(`## 1 执行摘要`);
  const coveredDims = Object.entries(coverage)
    .filter(([, v]) => (typeof v === "number" ? v : v?.ratio ?? 0) >= 0.8)
    .map(([k]) => k);
  sections.push(`**仓库类型**：${repoType.type || "Unknown"}。`);
  sections.push(`**中心假设**：${challenge.center_hypothesis || "(未设置)"}。`);
  sections.push(`**覆盖维度**：${coveredDims.length > 0 ? coveredDims.join(", ") : "暂无"}。`);
  const topDecisions = (interp.design_decisions || []).slice(0, 3).map((d) => d.decision);
  sections.push(`**关键决策**：${topDecisions.length > 0 ? topDecisions.join(" / ") : "待进一步分析"}。`);
  sections.push(`\n`);

  // 2. Runtime
  sections.push(`## 2 Runtime`);
  const controlFlow = (model.behavior?.control_flow || []).slice(0, 5);
  if (controlFlow.length > 0) {
    sections.push(controlFlow.map((cf) => `- ${cf.name || cf.description || JSON.stringify(cf)}`).join("\n"));
  } else {
    sections.push(`- 当前证据不足以完整描述运行时。建议补充入口文件和主循环分析。`);
  }
  sections.push(`\n`);

  // 3. Architecture
  sections.push(`## 3 Architecture`);
  const modules = (model.structure?.modules || []).slice(0, 5);
  if (modules.length > 0) {
    sections.push(modules.map((m) => `- **${m.name || "(未命名)"}**：${(m.description || "").slice(0, 120)}`).join("\n"));
  }
  const boundaries = (model.structure?.boundaries || []).slice(0, 5);
  if (boundaries.length > 0) {
    sections.push(`\n**边界**：`);
    sections.push(boundaries.map((b) => `- ${b.name || b.description || JSON.stringify(b)}`).join("\n"));
  }
  sections.push(`\n`);

  // 4. Key Decisions
  sections.push(`## 4 Key Decisions`);
  const decisions = (interp.design_decisions || []).slice(0, 4);
  if (decisions.length > 0) {
    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i];
      sections.push(`### D${i + 1}: ${d.decision || "(未命名决策)"}`);
      sections.push(`**选择**：${d.chosen || "—"} | **拒绝**：${(d.rejected || []).join(", ") || "—"}`);
      sections.push(`**理由**：${d.rejected_reason || d.tradeoff || "—"}`);
      sections.push(`**证据**：${(d.evidence || []).slice(0, 3).join(", ") || "待补充"}\n`);
    }
  } else {
    sections.push(`- 当前证据不足以提取明确的关键决策。`);
  }
  sections.push(`\n`);

  // 5. 模型质疑
  sections.push(`## 5 模型质疑`);
  const challenges = (challenge.challenges || []).slice(0, 5);
  if (challenges.length > 0) {
    for (const c of challenges) {
      sections.push(`### ${c.target || "(未命名)"}`);
      sections.push(`**结果**：${c.result || "survived"} | **方法**：${c.method || "—"}`);
      sections.push(`**证据**：${c.counter_evidence || "无反证"}`);
      sections.push(`**备注**：${c.notes || "—"}\n`);
    }
  } else {
    sections.push(`- 本轮未生成质疑记录。`);
  }
  sections.push(`\n`);

  // 6. 维护者手册
  sections.push(`## 6 维护者手册`);
  const leverage = (interp.leverage_points || []).slice(0, 3).map((l) => l.point || l);
  sections.push(`- **How to Extend**：${leverage.length > 0 ? leverage.join("；") : "参考 extension points 和 public API"}`);
  const debugTargets = (model.structure?.modules || []).slice(0, 2).map((m) => m.name);
  sections.push(`- **How to Debug**：从 ${debugTargets.length > 0 ? debugTargets.join(", ") : "核心模块"} 的边界日志入手。`);
  const migrationTargets = (interp.complexity_drivers || []).slice(0, 2).map((d) => d.driver || d);
  sections.push(`- **How to Migrate**：关注 ${migrationTargets.length > 0 ? migrationTargets.join(", ") : "历史演进"}。`);
  const removalAssumptions = (challenge.key_assumptions || []).slice(0, 2).map((a) => a.assumption);
  sections.push(`- **How to Remove**：检查 ${removalAssumptions.length > 0 ? removalAssumptions.join(", ") : "关键假设"} 的耦合范围。\n`);

  // 7. Architecture Risk Analysis
  sections.push(`## 7 Architecture Risk Analysis（Blast Radius）`);
  const blastRadius = (interp.blast_radius || []).slice(0, 5);
  if (blastRadius.length > 0) {
    sections.push(`| 修改点 | 影响范围 | 风险等级 |`);
    sections.push(`| --- | --- | --- |`);
    for (const br of blastRadius) {
      sections.push(`| ${br.component || "—"} | ${(br.impact_scope || []).join(", ") || "—"} | ${br.risk_level || "—"} |`);
    }
  } else {
    sections.push(`- 当前证据不足以评估 blast radius。`);
  }
  sections.push(`\n`);

  // 8. Change Difficulty
  sections.push(`## 8 Change Difficulty`);
  const changeDifficulty = (interp.change_difficulty || []).slice(0, 6);
  if (changeDifficulty.length > 0) {
    sections.push(`| 修改 | 难度 | 理由 |`);
    sections.push(`| --- | --- | --- |`);
    for (const cd of changeDifficulty) {
      sections.push(`| ${cd.change || "—"} | ${cd.difficulty || "—"} | ${cd.reason || "—"} |`);
    }
  } else {
    sections.push(`- 当前证据不足以评估修改难度。`);
  }
  sections.push(`\n`);

  // 9. Design Smells
  sections.push(`## 9 Design Smells`);
  const designSmells = (interp.design_smells || []).slice(0, 5);
  if (designSmells.length > 0) {
    for (const s of designSmells) {
      sections.push(`- **${s.smell || "—"}**（${s.type || "deliberate"}）：${(s.evidence || []).join(", ") || "—"}`);
    }
  } else {
    sections.push(`- 未发现明显的 deliberate smell 或 tech debt。`);
  }
  sections.push(`\n`);

  // 10. Unresolved Questions
  sections.push(`## 10 Unresolved Questions`);
  const unresolvedDims = Object.entries(coverage).filter(([, v]) => (typeof v === "number" ? v : v?.ratio ?? 0) < 0.5);
  if (unresolvedDims.length > 0) {
    for (const [dim, v] of unresolvedDims) {
      const ratio = typeof v === "number" ? v : v?.ratio ?? 0;
      sections.push(`- **${dim}**（覆盖率 ${(ratio * 100).toFixed(0)}%）：证据不足，建议补充 ${dim} 相关源码或测试。`);
    }
  } else {
    sections.push(`- 所有维度覆盖率均 ≥ 50%。`);
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
  const report = renderReport(repoType, { ...result, interpretation, challenge });
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
    console.log("Skipping gated checks. Report remains in report-draft.md (no checkpoint published).\n");
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
