// ===========================================================================
// research.mjs — Main entry point for repo-research-v2 skill
//
// Orchestrates the research pipeline with resume support:
//   Stage -1: Resume existing research (skip stable artifacts if unchanged)
//   Stage 0:  Generate stable artifacts (conditional — only if missing)
//   Stage 1:  Generate research questions
//   Stage 2:  Mechanical analysis
//   Stage 3a: Build Repository Model
//   Stage 3b: Architecture interpretation
//   Stage 3c: Challenge model
//   Stage 3d-3e: Question convergence
//   Stage 4:  Generate report
//   Gated checks
//
// Usage:
//   node research.mjs <repo-path> [--force] [--skip-gate]
//
// Options:
//   --force      Force full re-analysis even if working directory exists
//   --skip-gate  Skip gated checks
// ===========================================================================

import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
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

// ---------------------------------------------------------------------------
// Stage -1: Resume existing research
// ---------------------------------------------------------------------------

async function stageMinusOne(workDir, repoPath, force) {
  console.log("Stage -1: Resume existing research...");

  if (force) {
    console.log("  --force: full re-analysis\n");
    return { resumed: false };
  }

  const resume = await resumeResearch(workDir, repoPath);
  const reportPath = join(workDir, "report.md");

  if (resume.resumed && resume.commitUnchanged && resume.artifactsReady) {
    console.log("  Working directory found, commit unchanged, all artifacts ready.");

    // If report exists and complete, return it
    if (await fileExists(reportPath)) {
      console.log("  Report exists — returning cached result.\n");
      const report = await readFile(reportPath, "utf-8");
      return {
        resumed: true,
        commitUnchanged: true,
        artifactsReady: true,
        report,
        resume,
      };
    }

    // Report missing but artifacts ready — continue from where we left off
    console.log("  Report missing — continuing from Stage 1.\n");
    return {
      resumed: true,
      commitUnchanged: true,
      artifactsReady: true,
      report: null,
      resume,
    };
  }

  if (resume.resumed && resume.commitUnchanged && !resume.artifactsReady) {
    console.log(`  Commit unchanged but artifacts missing: ${resume.missingArtifacts.join(", ")}`);
    console.log("  Generating missing artifacts...\n");
    return {
      resumed: true,
      commitUnchanged: true,
      artifactsReady: false,
      report: null,
      resume,
    };
  }

  if (resume.resumed && !resume.commitUnchanged) {
    console.log(`  Commit changed (${resume.meta?.last_analyzed_commit || "unknown"} → ${resume.commit || "unknown"})`);
    if (resume.changedFiles.length > 0) {
      console.log(`  Changed files: ${resume.changedFiles.length}`);
    }
    console.log("  Full re-analysis required.\n");
    return {
      resumed: true,
      commitUnchanged: false,
      artifactsReady: false,
      report: null,
      resume,
    };
  }

  console.log("  Fresh analysis.\n");
  return {
    resumed: false,
    commitUnchanged: false,
    artifactsReady: false,
    report: null,
    resume,
  };
}

// ---------------------------------------------------------------------------
// Stage 0: Repository Scan (cached as directory-tree.json)
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

      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") {
        continue;
      }

      if (entry.isDirectory()) {
        dirs.push(relPath);
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  }

  await walk(repoPath);
  return { files, dirs };
}

async function stageZeroScan(workDir, repoPath, resumeResult) {
  // If resume says artifacts are ready, load from cache
  if (resumeResult.resumed && resumeResult.commitUnchanged && resumeResult.artifactsReady) {
    const cached = await loadStableArtifact(workDir, "directory-tree");
    if (cached) {
      console.log("Stage 0: Directory tree loaded from cache.");
      return cached;
    }
  }

  // Otherwise scan
  console.log("Stage 0: Scanning repository...");
  const scan = await scanRepository(repoPath);
  await saveStableArtifact(workDir, "directory-tree", scan);
  console.log(`  Found ${scan.files.length} files, ${scan.dirs.length} directories\n`);
  return scan;
}

// ---------------------------------------------------------------------------
// Stage 0: Repository Type Identification (cached as repository-profile.json)
// ---------------------------------------------------------------------------

async function stageZeroType(workDir, repoTypeGuess, scan, resumeResult) {
  if (resumeResult.resumed && resumeResult.commitUnchanged && resumeResult.artifactsReady) {
    const cached = await loadStableArtifact(workDir, "repository-profile");
    if (cached) {
      console.log(`  Repository profile loaded from cache: ${cached.type} (${cached.confidence})\n`);
      return cached;
    }
  }

  console.log("Identifying repository type...");
  const repoType = await repoTypeGuess(scan);
  await saveStableArtifact(workDir, "repository-profile", repoType);
  console.log(`  Type: ${repoType.type} (${repoType.confidence})\n`);
  return repoType;
}

async function identifyRepoType(repoPath, scan) {
  const prompt = `
分析以下仓库结构，识别仓库类型。

仓库路径: ${repoPath}
文件列表（前 50 个）: ${scan.files.slice(0, 50).join(", ")}
目录列表: ${scan.dirs.join(", ")}

可能的类型: CLI / Library / Framework / Database / Compiler / Runtime / OS / SDK / AI Infrastructure / Web Service / Agent / Other

输出 JSON（严格 JSON，无 markdown）:
{
  "type": "识别的类型",
  "confidence": "high/medium/low",
  "reasoning": "为什么这样判断，引用哪些文件/目录",
  "focus_areas": ["该类型仓库应该关注的领域"]
}
`;

  const result = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
  return result;
}

// ---------------------------------------------------------------------------
// Stage 1: Question Generation
// ---------------------------------------------------------------------------

async function generateQuestions(repoPath, repoType, scan) {
  const topFiles = ["package.json", "README.md", "ARCHITECTURE.md", "AGENTS.md", "CONTRIBUTING.md"]
    .filter((f) => scan.files.includes(f))
    .join(", ");
  const topDirs = scan.dirs
    .filter((d) => !d.includes("/") || d.split("/").length === 2)
    .slice(0, 20)
    .join(", ");

  const prompt = `
You are analyzing a ${repoType.type} repository. Focus areas: ${repoType.focus_areas.join(", ")}

Top-level directories: ${topDirs}
Key files: ${topFiles}

Generate 6-10 research questions. Return ONLY a JSON array like this:
[{"id":"Q1","question":"Why does the system use X?","genesis":{"trigger":"observation","observation":"Seen pattern X","depth_level":2},"type":"critical","status":"open","confidence":"medium"}]
`;

  const result = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
  return result;
}

// ---------------------------------------------------------------------------
// Stage 2: Mechanical Analysis
// ---------------------------------------------------------------------------

async function mechanicalAnalysis(repoPath, scan) {
  const evidence = [];

  const keyFiles = ["package.json", "README.md", "ARCHITECTURE.md"];
  for (const file of keyFiles) {
    const fullPath = join(repoPath, file);
    if (await fileExists(fullPath)) {
      const content = await readFile(fullPath, "utf-8");
      evidence.push({ path: file, content: content.slice(0, 800), purpose: "元数据" });
    }
  }

  const srcFiles = scan.files.filter((f) => f.startsWith("src/") || f.startsWith("server/") || f.startsWith("api/"));
  for (const file of srcFiles.slice(0, 5)) {
    const fullPath = join(repoPath, file);
    if (await fileExists(fullPath)) {
      const content = await readFile(fullPath, "utf-8");
      evidence.push({ path: file, content: content.slice(0, 500), purpose: "代码" });
    }
  }

  return evidence;
}

// ---------------------------------------------------------------------------
// Stage 3a: Build Repository Model
// ---------------------------------------------------------------------------

async function buildRepositoryModel(repoPath, repoType, evidence) {
  const evidenceStr = evidence
    .map((e) => `--- ${e.path} ---\n${e.content}`)
    .join("\n\n");

  const prompt = `
你是一个架构分析师。基于以下证据，构建 Repository Model。

仓库类型: ${repoType.type}
关注领域: ${repoType.focus_areas.join(", ")}

证据:
${evidenceStr}

构建 Repository Model，描述 5 个维度:
1. 结构模型 (模块、目录、组件及其边界)
2. 行为模型 (控制流、数据流、运行流程)
3. 归属模型 (状态、职责、生命周期归属)
4. 扩展模型 (插件机制、扩展点、公共 API)
5. 演进模型 (架构演进与历史变化)

输出 JSON（严格 JSON，无 markdown）:
{
  "structure": { "modules": [{"name": "模块名", "path": "路径", "description": "描述"}], "boundaries": [{"from": "模块A", "to": "模块B", "direction": "单向/双向"}] },
  "behavior": { "control_flow": ["控制流描述"], "data_flow": ["数据流描述"] },
  "ownership": { "state": [{"name": "状态名", "owner": "模块/组件"}], "responsibility": [{"name": "职责", "owner": "模块/组件"}] },
  "extension": { "plugin_points": ["扩展点"], "public_api": ["公共 API"] },
  "evolution": { "major_changes": [{"change": "变更描述", "impact": "影响"}], "current_direction": "当前演进方向" }
}
`;

  const result = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
  return result;
}

// ---------------------------------------------------------------------------
// Stage 3b: Architecture Interpretation
// ---------------------------------------------------------------------------

async function architectureInterpretation(repoPath, repoType, model, evidence) {
  const evidenceStr = evidence
    .map((e) => `--- ${e.path} ---\n${e.content}`)
    .join("\n\n");

  const prompt = `
你是一个架构分析师。基于 Repository Model 和证据，重建系统背后的工程思想。

仓库类型: ${repoType.type}

Repository Model:
${JSON.stringify(model, null, 2)}

证据:
${evidenceStr}

产出以下类型（每个都必须引用证据）:
- 工程约束 (engineering_constraints)
- 架构作用力 (architectural_forces)
- 设计决策 (design_decisions) — 每个必须有 rejected 替代方案
- 权衡 (tradeoffs)
- 有意省略 (intentional_omissions)
- 架构张力 (architectural_tensions)
- 杠杆点 (leverage_points)
- 维护者心智模型 (maintainer_mental_model)

输出 JSON（严格 JSON，无 markdown）:
{
  "engineering_constraints": [{"constraint": "约束", "evidence": ["证据"]}],
  "architectural_forces": [{"force": "作用力", "evidence": ["证据"]}],
  "design_decisions": [{"decision": "决策", "chosen": "选择", "rejected": ["被拒绝方案"], "why": "理由", "evidence": ["证据"]}],
  "tradeoffs": [{"tradeoff": "权衡", "evidence": ["证据"]}],
  "intentional_omissions": [{"omission": "省略", "why": "理由", "evidence": ["证据"]}],
  "architectural_tensions": [{"tension": "张力", "evidence": ["证据"]}],
  "leverage_points": [{"point": "杠杆点", "evidence": ["证据"]}],
  "maintainer_mental_model": "维护者如何心智划分系统"
}
`;

  const result = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
  return result;
}

// ---------------------------------------------------------------------------
// Stage 3c: Challenge Model
// ---------------------------------------------------------------------------

async function challengeModel(repoPath, interpretation, model) {
  const prompt = `
你是一个批判性架构评审员。挑战以下架构解释。

架构解释:
${JSON.stringify(interpretation, null, 2)}

Repository Model:
${JSON.stringify(model, null, 2)}

对每个关键结论执行以下检验:
1. 移除测试: 如果移除这个组件/模式，系统还能成立吗？
2. 假设翻转: 如果结论是相反的，哪些证据应该存在？
3. 边界测试: 这个结论在什么条件下不成立？
4. 时间测试: 这个决策在最开始时也是最优的吗？

输出 JSON（严格 JSON，无 markdown）:
{
  "challenges": [{"target": "被挑战的结论", "challenge": "挑战问题", "method": "移除测试/假设翻转/边界测试/时间测试", "outcome": "survived/refuted/modified", "evidence": ["证据"], "model_delta": "挑战后模型变化"}],
  "center_hypothesis": "一句话架构中心假设",
  "key_assumptions": [{"assumption": "假设", "evidence": ["证据"], "challenged": true, "survived": true}],
  "competing_interpretations": [{"interpretation": "备选解释", "evidence": ["证据"], "confidence": "high/medium/low"}]
}
`;

  const result = await invokeLLMJSON(prompt, { model: DEFAULT_MODEL });
  return result;
}

// ---------------------------------------------------------------------------
// Stage 4: Generate Report
// ---------------------------------------------------------------------------

async function generateReport(repoPath, repoType, model, interpretation, challenge, questions) {
  const prompt = `
你是一个架构报告撰写专家。基于以下材料，生成一份中文报告。

仓库类型: ${repoType.type}

Repository Model:
${JSON.stringify(model, null, 2)}

架构解释:
${JSON.stringify(interpretation, null, 2)}

挑战结果:
${JSON.stringify(challenge, null, 2)}

问题状态:
${JSON.stringify(questions, null, 2)}

报告必须使用中文，覆盖以下维度（详见 report-schema.md）:
1. 执行摘要 — 系统一句话定位 + 核心发现
2. 仓库心智模型 — 维护者如何心智划分系统
3. 架构 — 系统如何组织
4. 工程决策 — 为什么这样设计
5. 设计空间 — 被拒绝的替代方案及理由
6. 模型挑战 — 哪些结论被挑战过、挑战结果、反证记录
7. 修改影响地图 — 修改 X 影响哪些层
8. 可复用知识 — 可迁移的思想
9. 意外发现 — 与预期不符的架构现象
10. 未解问题 — 无法验证的问题

**重要**: 报告应该像 Martin Fowler 的文章一样，是一篇连贯的叙事，不是分析器输出拼接。
**重要**: 必须包含架构中心假设。
**重要**: 每个设计决策必须说明被拒绝的替代方案。
**重要**: 必须说明哪些结论被挑战过，挑战结果如何。
**重要**: 必须说明修改 X 影响哪些层。

输出 Markdown 格式的报告（直接输出报告内容，不要 JSON 包装）。
`;

  const result = await invokeLLM(prompt, { model: DEFAULT_MODEL });
  return result;
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
  const round1Path = join(questionsDir, "round-1.json");
  const summaryPath = join(questionsDir, "summary.json");
  const modelPath = join(workDir, "repository-model.json");
  const reportPath = join(workDir, "report.md");
  const metaPath = join(workDir, "meta.json");

  console.log(`\n=== Repository Research: ${repoName} ===\n`);
  console.log(`Repository: ${repoPath}`);
  console.log(`Working directory: ${workDir}\n`);

  // ==========================================================================
  // Stage -1: Resume existing research
  // ==========================================================================

  const resumeResult = await stageMinusOne(workDir, repoPath, force);

  // If resume returned a cached report, we're done
  if (resumeResult.report) {
    console.log(resumeResult.report.slice(0, 500) + "...\n");
    return;
  }

  // Create working directory if fresh
  if (!resumeResult.resumed) {
    await ensureDir(workDir);
  }

  // ==========================================================================
  // Stage 0: Stable Artifact Generation (conditional)
  // ==========================================================================

  // Directory tree (from cache or fresh scan)
  const scan = await stageZeroScan(workDir, repoPath, resumeResult);

  // Repository profile (from cache or LLM)
  const repoType = await stageZeroType(workDir, (s) => identifyRepoType(repoPath, s), scan, resumeResult);

  // ==========================================================================
  // Stage 1: Generate research questions
  // ==========================================================================

  console.log("Stage 1: Generating research questions...");
  await ensureDir(questionsDir);
  const questions = await generateQuestions(repoPath, repoType, scan);

  const round1 = {
    round: 1,
    generated_from: [],
    trigger: "Repository type identification",
    purpose: "Discovery",
    questions: questions.map((q) => ({
      ...q,
      id: q.id && q.id.startsWith("R1-") ? q.id : `R1-${(q.id || "").replace(/^Q/, "")}`,
    })),
  };
  await writeJson(round1Path, round1);

  const summary = {
    latest_round: 1,
    rounds: [{ round: 1, file: "round-1.json", purpose: "Discovery", status: "active" }],
  };
  await writeJson(summaryPath, summary);

  console.log(`  Generated ${round1.questions.length} questions (round-1)\n`);

  // ==========================================================================
  // Stage 2: Mechanical analysis
  // ==========================================================================

  console.log("Stage 2: Mechanical analysis...");
  const evidence = await mechanicalAnalysis(repoPath, scan);
  console.log(`  Collected ${evidence.length} evidence items\n`);

  // ==========================================================================
  // Stage 3a: Build Repository Model
  // ==========================================================================

  console.log("Stage 3a: Building Repository Model...");
  let model;
  try {
    model = await buildRepositoryModel(repoPath, repoType, evidence);
    await writeJson(modelPath, model);
    console.log("  Model built\n");
  } catch (err) {
    console.error(`Error building model: ${err.message}`);
    process.exit(1);
  }

  // ==========================================================================
  // Stage 3b: Architecture interpretation
  // ==========================================================================

  console.log("Stage 3b: Architecture interpretation...");
  let interpretation;
  try {
    interpretation = await architectureInterpretation(repoPath, repoType, model, evidence);
    console.log("  Interpretation complete\n");
  } catch (err) {
    console.error(`Error in interpretation: ${err.message}`);
    process.exit(1);
  }

  // ==========================================================================
  // Stage 3c: Challenge model
  // ==========================================================================

  console.log("Stage 3c: Challenging model...");
  let challenge;
  try {
    challenge = await challengeModel(repoPath, interpretation, model);
    console.log("  Challenge complete\n");
  } catch (err) {
    console.error(`Error in challenge: ${err.message}`);
    process.exit(1);
  }

  // ==========================================================================
  // Stage 4: Generate report
  // ==========================================================================

  console.log("Stage 4: Generating report...");
  let report;
  try {
    report = await generateReport(repoPath, repoType, model, interpretation, challenge, questions);
    await writeFile(reportPath, report, "utf-8");
    console.log("  Report generated\n");
  } catch (err) {
    console.error(`Error generating report: ${err.message}`);
    process.exit(1);
  }

  // ==========================================================================
  // Build context.json
  // ==========================================================================

  const allQuestions = round1.questions;
  const totalQ = allQuestions.length;
  const answeredQ = allQuestions.filter((q) => q.status === "answered" || q.status === "validated").length;
  const validatedQ = allQuestions.filter((q) => q.status === "validated").length;

  const context = {
    user_input: `分析 ${repoPath} 仓库的架构、设计模式和工程实现`,
    current_round: 1,
    current_question_file: "questions/round-1.json",
    model_stability: "stable",
    question_statistics: {
      rounds: 1,
      total_questions: totalQ,
      answered: answeredQ,
      validated: validatedQ,
    },
    architecture_model: {
      center_hypothesis: challenge.center_hypothesis,
      key_assumptions: challenge.key_assumptions || [],
      architecture_invariants: (interpretation.engineering_constraints || []).map((c) => c.constraint),
      unexplained_observations: [],
      competing_interpretations: challenge.competing_interpretations || [],
    },
    challenge_record: challenge.challenges || [],
    design_space: (interpretation.design_decisions || []).map((d) => ({
      decision: d.decision,
      chosen: d.chosen,
      rejected: d.rejected,
      why_chosen: d.why,
      why_rejected: d.why,
      confidence: "high",
      evidence: d.evidence,
    })),
    maintainer_view: {
      modification_impact_map: {},
      complexity_drivers: (interpretation.architectural_tensions || []).map((t) => t.tension),
    },
    evidence_collected: evidence.map((e) => ({
      path: e.path,
      purpose: e.purpose,
      key_findings: [],
      surprises: [],
      unanswered: [],
    })),
    quality_gate: {
      center_identified: false,
      alternatives_considered: false,
      counterexamples_found: false,
      model_challenged: false,
    },
  };
  await writeJson(contextPath, context);

  // ==========================================================================
  // Write meta.json (with commit tracking)
  // ==========================================================================

  const commit = getCurrentCommit(repoPath);
  const meta = {
    repo_path: repoPath,
    repo_type: repoType.type,
    last_analyzed_commit: commit || "unknown",
    analyzed_at: new Date().toISOString(),
    model_version: "1.0",
  };
  await writeJson(metaPath, meta);

  // ==========================================================================
  // Run gated checks
  // ==========================================================================

  if (!skipGate) {
    console.log("Running gated checks...");
    try {
      const { preconditions, gates, allPassed, summary } = await runAllChecks(context, report);

      console.log(`\n=== Preconditions: ${preconditions.checks.filter((c) => c.passed).length}/${preconditions.checks.length} passed ===\n`);
      for (const check of preconditions.checks) {
        console.log(`[${check.passed ? "PASS" : "FAIL"}] ${check.name}`);
      }

      console.log(`\n=== Gated Checks: ${gates.summary} ===\n`);
      for (const result of gates.results) {
        console.log(`[${result.passed ? "PASS" : "FAIL"}] ${result.name}`);
      }

      console.log(`\n=== Summary: ${summary} ===\n`);

      for (const result of gates.results) {
        context.quality_gate[result.id] = result.passed;
      }
      await writeJson(contextPath, context);
    } catch (err) {
      console.error(`Gated checks failed: ${err.message}\n`);
    }
  }

  console.log(`\n=== Analysis complete ===`);
  console.log(`Report: ${reportPath}`);
  console.log(`Context: ${contextPath}`);
  console.log(`Model: ${modelPath}\n`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
