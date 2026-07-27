// ===========================================================================
// stage-checks.mjs — Pipeline stage validation for E2E tests.
//
// Verifies a completed research output directory one stage at a time:
//   Stage 0: Analyzer output (evidence-store/full.json)
//   Stage 1: Evidence Brief (evidence-brief.md)
//   Stage 2: Research Questions (00-research-questions.md)
//   Stage 3: Hypotheses (01-hypotheses.md)
//   Stage 4: Ontology (02-ontology.md)
//   Stage 5: Opponent (04-opponent.md)
//   Stage 6: Cross Validation (05-cross-validation.md)
//   Stage 7: Report (report.md or 07-report.md)
//
// Any stage failure short-circuits downstream checks so the caller knows
// exactly which layer broke.
// ===========================================================================

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const STAGES = [
  { id: "analyzer", file: "evidence-store/full.json", required: true },
  { id: "evidence-brief", file: "evidence-brief.md", required: true },
  { id: "questions", file: "00-research-questions.md", required: false },
  { id: "hypotheses", file: "01-hypotheses.md", required: false },
  { id: "ontology", file: "02-ontology.md", required: false },
  { id: "opponent", file: "04-opponent.md", required: false },
  { id: "cross-validation", file: "05-cross-validation.md", required: false },
  { id: "report", file: "report.md", required: true, alt: "07-report.md" },
];

export function checkStage(name, condition, message, stage) {
  return {
    stage,
    name,
    ok: condition,
    message: condition ? undefined : message,
  };
}

export function validateAnalyzerStage(dir) {
  const stage = "analyzer";
  const path = join(dir, "evidence-store/full.json");
  const checks = [];

  checks.push(checkStage("full.json exists", existsSync(path), `Missing ${path}`, stage));
  if (!checks.at(-1).ok) return checks;

  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    checks.push(checkStage("full.json is valid JSON", false, err.message, stage));
    return checks;
  }

  const requiredRoots = [
    { key: "repository", alt: "discovery" },
    { key: "archetypeHints", alt: "_archetypeHints" },
    { key: "symbols", alt: null },
    { key: "architecture", alt: null },
    { key: "prompts", alt: null },
    { key: "tools", alt: null },
    { key: "tests", alt: null },
    { key: "evaluations", alt: null },
  ];
  for (const { key, alt } of requiredRoots) {
    const present = data[key] !== undefined || (alt && data[alt] !== undefined);
    checks.push(checkStage(`has ${key}`, present, `Missing root key: ${key}${alt ? ` or ${alt}` : ""}`, stage));
  }

  const repository = data.repository || data.discovery;
  const archetypeHints = data.archetypeHints || data._archetypeHints;
  checks.push(checkStage("repository has name", typeof (repository?.name || repository?.repoName) === "string", "Missing repository/discovery name", stage));
  checks.push(checkStage("archetypeHints has archetype", typeof archetypeHints?.archetype === "string" || typeof archetypeHints?.signals === "object", "Missing archetypeHints/archetype", stage));
  checks.push(checkStage("symbols has semantic data", Array.isArray(data.symbols?.functions) || Array.isArray(data.symbols?.classes) || typeof data.symbols?.totalFunctions === "number", "Missing symbols.functions/classes", stage));

  return checks;
}

export function validateEvidenceBriefStage(dir) {
  const stage = "evidence-brief";
  const path = join(dir, "evidence-brief.md");
  const checks = [];

  checks.push(checkStage("evidence-brief.md exists", existsSync(path), `Missing ${path}`, stage));
  if (!checks.at(-1).ok) return checks;

  const text = readFileSync(path, "utf-8");
  const hasIdentity = /(^|\n)#{1,3}\s*Repository\s+Identity/i.test(text) || /(^|\n)#{1,3}\s*Evidence\s+Summary/i.test(text);
  const hasArchetype = /(^|\n)#{1,3}\s*Archetype\s+Hints/i.test(text) || /(^|\n)#{1,3}\s*Archetype\s+Assessment/i.test(text);
  const hasEvidence = /(^|\n)#{1,3}\s*Key\s+Evidence/i.test(text) || /(^|\n)#{1,3}\s*Findings\b/i.test(text) || /(^|\n)#{1,3}\s*Evidence\s+Summary/i.test(text);
  const hasDecisions = /(^|\n)#{1,3}\s*Design\s+Decisions/i.test(text) || /(^|\n)#{1,3}\s*Decisions\b/i.test(text) || /(^|\n)#{1,3}\s*Decision\s+Report/i.test(text);

  checks.push(checkStage("has Repository Identity / Evidence Summary", hasIdentity, "Missing Repository Identity or Evidence Summary", stage));
  checks.push(checkStage("has Archetype Hints / Assessment", hasArchetype, "Missing Archetype Hints or Assessment", stage));
  checks.push(checkStage("has Key Evidence / Findings", hasEvidence, "Missing Key Evidence or Findings", stage));
  checks.push(checkStage("has Design Decisions / Decisions", hasDecisions, "Missing Design Decisions or Decisions", stage));

  return checks;
}

export function validateQuestionsStage(dir) {
  const stage = "questions";
  const path = join(dir, "00-research-questions.md");
  const checks = [];

  checks.push(checkStage("00-research-questions.md exists", existsSync(path), `Missing ${path}`, stage));
  if (!checks.at(-1).ok) return checks;

  const text = readFileSync(path, "utf-8");
  checks.push(checkStage("has Archetype section", /(^|\n)#{1,3}\s*Archetype/i.test(text), "Missing Archetype section", stage));
  checks.push(checkStage("has Top 5 Questions", /(^|\n)#{1,3}\s*Top\s+5\s+Questions/i.test(text), "Missing Top 5 Questions", stage));

  const questionCount = ((text || "").match(/^#{1,3}\s+Q\d+[:.]/gim) || []).length;
  checks.push(checkStage("has at least 5 questions", questionCount >= 5, `Found ${questionCount} questions`, stage));

  return checks;
}

export function validateHypothesesStage(dir) {
  const stage = "hypotheses";
  const path = join(dir, "01-hypotheses.md");
  const checks = [];

  checks.push(checkStage("01-hypotheses.md exists", existsSync(path), `Missing ${path}`, stage));
  if (!checks.at(-1).ok) return checks;

  const text = readFileSync(path, "utf-8");
  checks.push(checkStage("has Hypothesis section", /(^|\n)#{1,3}\s*Hypotheses?/i.test(text), "Missing Hypothesis section", stage));
  checks.push(checkStage("has Prior field", /\bPrior\b/i.test(text), "Missing Prior field", stage));
  checks.push(checkStage("has Evidence field", /\bEvidence\b/i.test(text), "Missing Evidence field", stage));
  checks.push(checkStage("has Posterior field", /\bPosterior\b/i.test(text), "Missing Posterior field", stage));
  checks.push(checkStage("has Competing Hypothesis", /Competing\s+Hypothesis/i.test(text), "Missing Competing Hypothesis", stage));

  return checks;
}

export function validateOntologyStage(dir) {
  const stage = "ontology";
  const path = join(dir, "02-ontology.md");
  const checks = [];

  checks.push(checkStage("02-ontology.md exists", existsSync(path), `Missing ${path}`, stage));
  if (!checks.at(-1).ok) return checks;

  const text = readFileSync(path, "utf-8");
  checks.push(checkStage("has Ontology section", /(^|\n)#{1,3}\s*(Behavior\s+)?Ontology/i.test(text), "Missing Ontology section", stage));

  return checks;
}

export function validateOpponentStage(dir) {
  const stage = "opponent";
  const path = join(dir, "04-opponent.md");
  const checks = [];

  checks.push(checkStage("04-opponent.md exists", existsSync(path), `Missing ${path}`, stage));
  if (!checks.at(-1).ok) return checks;

  const text = readFileSync(path, "utf-8");
  checks.push(checkStage("has Opponent Report", /(^|\n)#{1,3}\s*Opponent\s+Report/i.test(text), "Missing Opponent Report header", stage));
  const hasCounterEvidence =
    /Counter\s+Evidence/i.test(text) ||
    /反证|反例|替代解释|缺失证据|直接矛盾|测试反例|攻击/i.test(text);
  checks.push(checkStage("has counter evidence", hasCounterEvidence, "Missing counter evidence markers", stage));

  return checks;
}

export function validateCrossValidationStage(dir) {
  const stage = "cross-validation";
  const path = join(dir, "05-cross-validation.md");
  const checks = [];

  checks.push(checkStage("05-cross-validation.md exists", existsSync(path), `Missing ${path}`, stage));
  if (!checks.at(-1).ok) return checks;

  const text = readFileSync(path, "utf-8");
  checks.push(checkStage("has Cross Validation section", /(^|\n)#{1,3}\s*Cross\s+Validation/i.test(text), "Missing Cross Validation section", stage));
  checks.push(checkStage("mentions Evidence Graph", /Evidence\s+Graph/i.test(text), "Missing Evidence Graph", stage));

  return checks;
}

export function validateReportStage(dir) {
  const stage = "report";
  const path = existsSync(join(dir, "report.md")) ? join(dir, "report.md") : join(dir, "07-report.md");
  const checks = [];

  checks.push(checkStage("report exists", existsSync(path), "Missing report.md or 07-report.md", stage));
  if (!checks.at(-1).ok) return checks;

  const text = readFileSync(path, "utf-8");
  checks.push(checkStage("has Executive Summary", /(^|\n)#{1,2}\s*Executive\s+Summary/i.test(text), "Missing Executive Summary", stage));
  checks.push(checkStage("has Top Claims", /(^|\n)#{1,3}\s*Top\s+Claims/i.test(text), "Missing Top Claims", stage));
  checks.push(checkStage("has Quality Gate", /(^|\n)#{1,4}\s*Quality\s+Gate/i.test(text), "Missing Quality Gate", stage));
  checks.push(checkStage("has Reading Guide", /Reading\s+Guide/i.test(text), "Missing Reading Guide", stage));

  const claimCount = ((text || "").match(/^#{1,3}\s+Claim\s+\d+/gim) || []).length;
  checks.push(checkStage("has at least 2 claims", claimCount >= 2, `Found ${claimCount} claims`, stage));

  return checks;
}

export function validateAllStages(dir) {
  const allChecks = [
    ...validateAnalyzerStage(dir),
    ...validateEvidenceBriefStage(dir),
    ...validateQuestionsStage(dir),
    ...validateHypothesesStage(dir),
    ...validateOntologyStage(dir),
    ...validateOpponentStage(dir),
    ...validateCrossValidationStage(dir),
    ...validateReportStage(dir),
  ];

  const failed = allChecks.filter((c) => !c.ok);
  const passed = allChecks.filter((c) => c.ok);

  return {
    ok: failed.length === 0,
    dir,
    total: allChecks.length,
    passed: passed.length,
    failed: failed.length,
    checks: allChecks,
  };
}
