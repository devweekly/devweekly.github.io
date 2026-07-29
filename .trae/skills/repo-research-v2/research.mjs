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
    // Still load existing state for artifact reuse
    const meta = await loadMeta(workDir);
    const commit = getCurrentCommit(repoPath);
    const context = await tryReadJson(join(workDir, "context.json"));
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
  const nextStage = resumeFromCtx.next_stage || (existing.commitUnchanged ? "Stage 3" : "Stage 1");
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
      .filter(([, v]) => v < 0.5)
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

async function stageOneScan(workDir, repoPath, resume) {
  // Try loading from cache first (even with --force — stable artifacts are reusable)
  const cachedDirTree = await loadStableArtifact(workDir, "directory-tree");
  const cachedProfile = await loadStableArtifact(workDir, "repository-profile");

  if (cachedDirTree && cachedProfile) {
    console.log(`Stage 1: Scan Repository — loaded from cache (${cachedDirTree.files.length} files, ${cachedDirTree.dirs.length} directories).\n`);
    return { scan: cachedDirTree, profile: cachedProfile };
  }

  // Need to scan
  console.log("Stage 1: Scan Repository — scanning...");
  const scan = await scanRepository(repoPath);
  await saveStableArtifact(workDir, "directory-tree", scan);
  console.log(`  ${scan.files.length} files, ${scan.dirs.length} directories\n`);

  // LLM-based repo profile
  const prompt = `
Analyze this repository structure to identify repo type.

Files (first 50): ${scan.files.slice(0, 50).join(", ")}
Dirs: ${scan.dirs.join(", ")}

Possible types: CLI / Library / Framework / Database / Compiler / Runtime / OS / SDK / AI Infrastructure / Web Service / Agent / Other

Return JSON:
{"type":"identified type","confidence":"high/medium/low","reasoning":"why","focus_areas":["focus1","focus2"]}
`;
  const profile = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
  await saveStableArtifact(workDir, "repository-profile", profile);
  console.log(`  Type: ${profile.type} (${profile.confidence})\n`);

  return { scan, profile };
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

  // Update meta commit now (so subsequent runs see the new commit)
  const newMeta = { ...meta, last_analyzed_commit: commit, analyzed_at: new Date().toISOString() };
  await writeMeta(workDir, newMeta);

  return { changed: true, files: changed, full: false };
}

// ---------------------------------------------------------------------------
// Stage 3: Research Planner
// ---------------------------------------------------------------------------

async function stageThreePlanner(resume) {
  const isFirstRun = !resume.resumed;

  if (isFirstRun) {
    console.log("Stage 3: Research Planner — first run, full exploration.\n");
    return { firstRun: true, focus: "full_exploration", coverage: {}, round: 1 };
  }

  // Subsequent runs: examine coverage, plan focus
  const context = resume.context || {};
  const coverage = context.coverage || {};
  const lastRound = resume.lastRound || 1;

  // Find weakest dimension
  const entries = Object.entries(coverage);
  const weakest = entries.length > 0
    ? entries.sort((a, b) => a[1] - b[1])[0]
    : ["architecture", 0];

  console.log(`Stage 3: Research Planner`);
  console.log(`  Coverage: ${entries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  Weakest area: ${weakest[0]} (${weakest[1]})`);

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
  return invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
}

async function generateQuestions(repoType, scan, plan) {
  const topFiles = ["package.json", "README.md", "ARCHITECTURE.md", "AGENTS.md", "CONTRIBUTING.md"]
    .filter((f) => scan.files.includes(f)).join(", ");
  const topDirs = scan.dirs.filter((d) => !d.includes("/") || d.split("/").length === 2).slice(0, 20).join(", ");

  const focus = plan.firstRun
    ? `full exploration of the ${repoType.type} repository`
    : `focused investigation on ${plan.focus}`;
  const count = plan.firstRun ? "6-10" : "3-5";
  const depthHint = plan.minDepth ? `minimum depth_level ${plan.minDepth}` : "include some depth 1-2 questions";

  const prompt = `
You are analyzing a ${repoType.type} repository.
Top-level directories: ${topDirs}
Key files: ${topFiles}
Focus: ${focus}
Generate ${count} research questions. Each must have genesis (trigger+observation+depth_level). Depth: ${depthHint}.
Return ONLY a JSON array like:
[{"id":"Q1","question":"Why X?","genesis":{"trigger":"observation","observation":"Pattern X","depth_level":2},"type":"critical","status":"open","confidence":"medium"}]
`;
  return invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
}

async function mechanicalAnalysis(repoPath, scan) {
  const evidence = [];
  for (const file of ["package.json", "README.md", "ARCHITECTURE.md"]) {
    const fullPath = join(repoPath, file);
    if (await fileExists(fullPath)) {
      const content = await readFile(fullPath, "utf-8");
      evidence.push({ path: file, content: content.slice(0, 500), purpose: "元数据" });
    }
  }
  const srcFiles = scan.files.filter((f) => f.startsWith("src/") || f.startsWith("server/") || f.startsWith("api/"));
  for (const file of srcFiles.slice(0, 3)) {
    const fullPath = join(repoPath, file);
    if (await fileExists(fullPath)) {
      const content = await readFile(fullPath, "utf-8");
      evidence.push({ path: file, content: content.slice(0, 400), purpose: "代码" });
    }
  }
  return evidence;
}

async function buildRepositoryModel(repoType, evidence) {
  const evidenceStr = evidence.map((e) => `--- ${e.path} ---\n${e.content}`).join("\n\n");
  const prompt = `
构建 Repository Model，保持简洁（最多各 4 条）。
仓库类型: ${repoType.type}
证据: ${evidenceStr}
5 维模型: structure(modules+boundaries), behavior(control_flow+data_flow), ownership(state+responsibility), extension(plugin_points+public_api), evolution(major_changes+current_direction)
输出 JSON。
`;
  return invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
}

async function architectureInterpretation(repoType, model, evidence) {
  const evidenceStr = evidence.map((e) => `--- ${e.path} ---\n${e.content}`).join("\n\n");
  const prompt = `
基于 Repository Model 重建系统的工程思想。
仓库类型: ${repoType.type}
Model: ${JSON.stringify(model, null, 2)}
证据: ${evidenceStr}
产出以下类型（最多各 3 条，必须引用证据）: engineering_constraints, architectural_forces, design_decisions（每个必须有 rejected 替代方案）, tradeoffs, intentional_omissions, architectural_tensions, leverage_points, maintainer_mental_model
输出 JSON（严格 JSON，保持简洁）:
{"engineering_constraints":[{"constraint":"约束","evidence":["证据"]}],"architectural_forces":[{"force":"作用力","evidence":["证据"]}],"design_decisions":[{"decision":"决策","chosen":"选择","rejected":["被拒绝方案"],"why":"理由","evidence":["证据"]}],"tradeoffs":[{"tradeoff":"权衡","evidence":["证据"]}],"intentional_omissions":[{"omission":"省略","why":"理由","evidence":["证据"]}],"architectural_tensions":[{"tension":"张力","evidence":["证据"]}],"leverage_points":[{"point":"杠杆点","evidence":["证据"]}],"maintainer_mental_model":"维护者心智划分"}
`;
  return invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
}

async function challengeModel(interpretation, model) {
  const prompt = `
挑战以下架构解释。对每个结论执行: 移除测试、假设翻转、边界测试、时间测试。
架构解释: ${JSON.stringify(interpretation, null, 2)}
Model: ${JSON.stringify(model, null, 2)}
最多选择 3 个关键挑战，保持 JSON 简洁。
输出 JSON:
{"challenges":[{"target":"被挑战结论","challenge":"挑战问题","method":"移除测试","outcome":"survived/refuted/modified","evidence":["证据"],"model_delta":"变化"}],"center_hypothesis":"一句话中心假设","key_assumptions":[{"assumption":"假设","evidence":["证据"],"challenged":true,"survived":true}],"competing_interpretations":[{"interpretation":"备选","evidence":["证据"],"confidence":"medium"}]}
`;
  return invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
}

async function stageFourResearch(repoPath, resume, plan, scan, profile) {
  const repoType = profile || (await loadStableArtifact(join(repoPath, "..", "..", ".working", basename(repoPath)), "repository-profile"));
  if (!repoType) throw new Error("Repository profile required for research");

  console.log("Stage 4: Architecture Research");
  if (plan.firstRun) console.log("  4a: Collecting evidence...");
  else console.log(`  4a: Collecting evidence (focus: ${plan.focus})...`);

  const evidence = await mechanicalAnalysis(repoPath, scan);

  // Generate questions
  const questions = await generateQuestions(repoType, scan, plan);

  // Build model (full or update)
  console.log("  4b: Building Repository Model...");
  const model = plan.firstRun
    ? await buildRepositoryModel(repoType, evidence)
    : await buildRepositoryModel(repoType, evidence);

  // Interpretation
  console.log("  4c: Architecture interpretation...");
  const interpretation = await architectureInterpretation(repoType, model, evidence);

  // Challenge
  console.log("  4d: Challenging model...");
  const challenge = await challengeModel(interpretation, model);

  // Converge
  console.log("  4e: Converging...");

  const allQuestions = questions.map((q) => ({
    ...q,
    id: q.id && q.id.startsWith("R") ? q.id : `R${plan.round}-${(q.id || "").replace(/^Q/, "")}`,
  }));

  // Compute coverage estimate
  const coverage = plan.firstRun
    ? { runtime: 0.3, architecture: 0.25, design_decisions: 0.2, testing: 0.1, deployment: 0.1, history: 0.05 }
    : { ...resume.context?.coverage, [plan.focus]: Math.min(1, ((resume.context?.coverage?.[plan.focus] || 0) + 0.3)) };

  return {
    plan,
    evidence,
    questions: allQuestions,
    model,
    interpretation,
    challenge,
    coverage,
  };
}

// ---------------------------------------------------------------------------
// Stage 5: Report
// ---------------------------------------------------------------------------

async function generateReport(repoType, result) {
  const model = result.model;
  const interp = result.interpretation;
  const challenge = result.challenge;

  // Prepare concise data for the prompt
  const data = {
    repoType: repoType.type,
    centerHypothesis: challenge?.center_hypothesis || "(not set)",
    modules: (model?.structure?.modules || []).map((m) => ({ name: m.name, path: m.path, desc: (m.description || "").slice(0, 80) })),
    boundaries: (model?.structure?.boundaries || []).slice(0, 5),
    controlFlow: (model?.behavior?.control_flow || []).slice(0, 4),
    dataFlow: (model?.behavior?.data_flow || []).slice(0, 4),
    states: (model?.ownership?.state || []).slice(0, 4),
    responsibilities: (model?.ownership?.responsibility || []).slice(0, 4),
    extensionPoints: (model?.extension?.plugin_points || []).slice(0, 3),
    evolution: (model?.evolution?.major_changes || []).slice(0, 3),
    constraints: (interp?.engineering_constraints || []).slice(0, 4).map((c) => c.constraint),
    forces: (interp?.architectural_forces || []).slice(0, 3).map((f) => f.force),
    decisions: (interp?.design_decisions || []).map((d) => ({
      decision: d.decision, chosen: d.chosen, rejected: d.rejected, why: d.why,
    })),
    tradeoffs: (interp?.tradeoffs || []).slice(0, 3).map((t) => t.tradeoff),
    omissions: (interp?.intentional_omissions || []).slice(0, 3).map((o) => ({ o: o.omission, why: o.why })),
    tensions: (interp?.architectural_tensions || []).slice(0, 3).map((t) => t.tension),
    mentalModel: interp?.maintainer_mental_model || "",
    challenges: (challenge?.challenges || []).map((c) => ({ target: c.target, outcome: c.outcome, method: c.method })),
    assumptions: (challenge?.key_assumptions || []).map((a) => ({ assumption: a.assumption, survived: a.survived })),
    alternatives: (challenge?.competing_interpretations || []).slice(0, 2).map((a) => a.interpretation),
    coverage: result.coverage,
  };

  const prompt = `
你是一个架构报告撰写专家。报告必须按「研究论文」而非「总结」来写。

===== CORE RULE（最高优先级） =====
每个重要结论必须完整经历以下推理链，禁止只写结论：

[Observation] 观察到什么现象？
[Evidence] 具体证据（文件/符号/提交行号）
[Interpretation] 为什么这很重要？
[Alternative] 还有哪些可能解释？
[Challenge] 哪个解释通过了挑战？
[Conclusion] 最终结论（含置信度 + 证据数 + 反证数）

===== DATA =====
${JSON.stringify(data, null, 2)}

===== 报告结构（必需章节，严格按此顺序） =====

## 1 执行摘要
一句话定位 + 3 个核心发现 + 架构中心假设（一句话）

## 2 Runtime（运行时架构）
必须回答：
- 请求如何进入系统？数据如何流动？
- 生命周期如何结束？
- 哪些组件拥有状态？哪些只是转换器？
- 哪些地方有缓存？哪些地方并发？
- 如果组件宕机，如何降级？

## 3 Architecture（静态架构）
必须回答：
- 系统划分几层？为什么这样划分？
- 每层职责？层间依赖方向？
- 边界如何保证？哪些违反边界？
- 高耦合模块？低耦合模块？

附 Architecture Atlas（必须标注每个模块角色）:
- 🟢 Center（移除后系统不成立）
- 🔵 Core（改动影响全局）
- 🟠 High Coupling（修改需谨慎）
- 🔴 Danger（易出错）
- 🟢 Stable（很少改动）
- ⚪ Peripheral（相对独立）

## 4 Key Decisions（关键决策）
每个决策必须包含 9 字段：

| 字段 | 内容 |
|------|------|
| Chosen | 选择了什么 |
| Rejected | 至少 1 个被拒绝方案 |
| Why Chosen | 为什么选这个 |
| Why Rejected | 为什么拒绝 |
| Tradeoff | 权衡 |
| Cost | 工程成本 |
| Long-term | 长期后果 |
| Benefits | 谁受益 |
| Suffers | 谁付出代价 |

必须 Cross-Reference 到其他章节，如 [→ §Runtime 影响缓存层]。

## 5 Model Challenge（模型挑战）
每个挑战必须展开六步推理链：
[Observation] → [Evidence] → [Interpretation] → [Alternative] → [Challenge] → [Conclusion]
每个挑战标注 Confidence + Evidence Count + Counter Evidence。

## 6 Maintainer Handbook（维护者手册）
- How to Extend：新增 X 改哪些文件？
- How to Debug：Y 出问题如何定位？
- How to Migrate：从 A 迁移到 B 需要什么？
- How to Remove：删除 Z 影响什么？

## 7 Repository Tour（仓库游览）
推荐阅读顺序 + 为什么按这个顺序：
Day 1 → Day 2 → Day 3 → Day 4

## 8 Unresolved Questions
coverage<0.5 的领域，每个说明：
- 缺什么证据
- 对结论的影响
- 建议下一步调查方向

===== OUTPUT REQUIREMENTS =====
1. 每个关键结论必须走完六步推理，禁止折叠
2. 每个结论标注 Evidence Strength（Confidence / Evidence Count / Counter Evidence / Alternative）
3. 每节回答该节的必答问题，禁止留空
4. 章节间必须有 Cross-Reference（如 [→ §3 Atlas]）
5. 直接输出 Markdown，不要 JSON 包装
`;
  return invokeLLM(prompt, { model: DEFAULT_MODEL });
}

async function stageFiveReport(repoPath, repoType, result, workDir) {
  console.log("Stage 5: Generating report...\n");
  const report = await generateReport(repoType, result);
  await writeFile(join(workDir, "report.md"), report, "utf-8");
  return report;
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const repoPath = resolve(args[0]);
  const force = args.includes("--force");
  const skipGate = args.includes("--skip-gate");

  if (!repoPath) {
    console.error("Usage: node research.mjs <repo-path> [--force] [--skip-gate]");
    process.exit(1);
  }

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

  // ========================================================================
  // Stage 1: Scan Repository (conditional)
  // ========================================================================

  const { scan, profile } = await stageOneScan(workDir, repoPath, resume);

  // ========================================================================
  // Stage 2: Analyze Delta (conditional)
  // ========================================================================

  const delta = await stageTwoDelta(workDir, repoPath, resume);

  // ========================================================================
  // Stage 3: Research Planner
  // ========================================================================

  const plan = await stageThreePlanner(resume);

  // ========================================================================
  // Stage 4: Architecture Research
  // ========================================================================

  const result = await stageFourResearch(repoPath, resume, plan, scan, profile);

  // Save model
  await writeJson(modelPath, result.model);

  // Save questions
  const roundFile = `round-${plan.round}.json`;
  const roundData = {
    round: plan.round,
    generated_from: [],
    trigger: plan.firstRun ? "initial" : `planner_focus_${plan.focus}`,
    purpose: plan.firstRun ? "discovery" : `focus_${plan.focus}`,
    status: "active",
    questions: result.questions,
  };
  await writeJson(join(questionsDir, roundFile), roundData);

  const summary = {
    latest_round: plan.round,
    rounds: [
      ...(resume.questions?.rounds || []),
      { round: plan.round, file: roundFile, purpose: roundData.purpose, status: "active" },
    ],
  };
  await writeJson(join(questionsDir, "summary.json"), summary);

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

  const context = {
    user_input: `分析 ${repoPath} 仓库的架构`,
    resume: {
      last_completed_stage: "Stage 5",
      next_stage: "done",
      last_round: plan.round,
    },
    current_round: plan.round,
    current_question_file: roundFile,
    model_stability: "stable",
    question_statistics: {
      rounds: plan.round,
      total_questions: totalQ + (resume.context?.question_statistics?.total_questions || 0) - (plan.firstRun ? 0 : 0),
      answered: answeredQ + (resume.context?.question_statistics?.answered || 0),
      validated: validatedQ + (resume.context?.question_statistics?.validated || 0),
    },
    coverage: result.coverage,
    architecture_model: {
      center_hypothesis: result.challenge.center_hypothesis,
      key_assumptions: result.challenge.key_assumptions || [],
      architecture_invariants: (result.interpretation.engineering_constraints || []).map((c) => c.constraint),
      unexplained_observations: [],
      competing_interpretations: result.challenge.competing_interpretations || [],
    },
    challenge_record: result.challenge.challenges || [],
    design_space: (result.interpretation.design_decisions || []).map((d) => ({
      decision: d.decision, chosen: d.chosen, rejected: d.rejected,
      why_chosen: d.why, why_rejected: d.why, confidence: "high", evidence: d.evidence,
    })),
    maintainer_view: {
      modification_impact_map: {},
      complexity_drivers: (result.interpretation.architectural_tensions || []).map((t) => t.tension),
    },
    evidence_collected: {
      log_file: "artifacts/evidence-log.jsonl",
      count: result.evidence.length,
      last_ev_id: `ev-${String(result.evidence.length).padStart(3, "0")}`,
      note:
        "Actual evidence insights are in evidence-log.jsonl (append-only). Script-layer entries have empty key_findings; LLM Stage 4a appends entries with real key_findings.",
    },
    quality_gate: { center_identified: false, alternatives_considered: false, counterexamples_found: false, model_challenged: false },
  };
  await writeJson(contextPath, context);

  // ========================================================================
  // Write artifacts/evidence-log.jsonl (initial script-layer evidence)
  // ========================================================================

  const evidenceLogPath = join(workingDir, "artifacts", "evidence-log.jsonl");
  const evidenceLines = result.evidence.map((e, i) =>
    JSON.stringify({
      id: `ev-${String(i + 1).padStart(3, "0")}`,
      ts: new Date().toISOString(),
      file: e.path,
      scope: "file",
      purpose: e.purpose || "mechanical-scan",
      key_findings: [],
      evidence_strength: "B",
      related_questions: [],
      replaces: null,
      source: "script",
    })
  );
  await writeFile(evidenceLogPath, evidenceLines.join("\n") + "\n", "utf8");

  // ========================================================================
  // Write meta.json
  // ========================================================================

  const commit = getCurrentCommit(repoPath);
  const meta = {
    repo_path: repoPath,
    repo_type: repoType.type,
    last_analyzed_commit: commit || "unknown",
    analyzed_at: new Date().toISOString(),
    model_version: "2.0",
  };
  await writeMeta(workDir, meta);

  // ========================================================================
  // Gated checks
  // ========================================================================

  if (!skipGate) {
    console.log("Running gated checks...");
    try {
      const { preconditions, gates, allPassed, summary } = await runAllChecks(context, report);
      console.log(`\n=== Preconditions: ${preconditions.checks.filter((c) => c.passed).length}/${preconditions.checks.length} passed ===\n`);
      for (const c of preconditions.checks) console.log(`[${c.passed ? "PASS" : "FAIL"}] ${c.name}`);
      console.log(`\n=== Gated Checks: ${gates.summary} ===\n`);
      for (const r of gates.results) console.log(`[${r.passed ? "PASS" : "FAIL"}] ${r.name}`);
      console.log(`\n=== Summary: ${summary} ===\n`);
      for (const r of gates.results) context.quality_gate[r.id] = r.passed;
      await writeJson(contextPath, context);
    } catch (err) {
      console.error(`Gated checks failed: ${err.message}\n`);
    }
  }

  console.log(`\n=== Analysis complete ===`);
  console.log(`Report: ${join(workDir, "report.md")}`);
  console.log(`Context: ${contextPath}`);
  console.log(`Model: ${modelPath}\n`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
