// ===========================================================================
// knowledge-base.mjs — Knowledge extraction and Brain update helpers
//
// This module provides the script-layer scaffolding for:
//   Stage 8: Knowledge Extraction (LLM extracts knowledge units from report)
//   Stage 9: Brain Update (apply extracted units to the global Brain)
//
// The LLM does the semantic work (reading the report and identifying which
// patterns/decisions/tradeoffs are worth extracting). This module handles:
//   - Parsing knowledge-units.json files
//   - Applying units to the Brain (create new / merge existing)
//   - Detecting novelty (what does this repo contribute vs known patterns?)
//   - Generating a Brain Brief for the Question Planner
//
// Flow:
//   report.md  --[LLM Stage 8]-->  knowledge-units.json
//   knowledge-units.json  --[this module]-->  Brain update
//   Brain  --[this module]-->  brain-brief.json  --[LLM Stage 0]-->  questions
// ===========================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Brain, createKnowledgeUnit, validateKnowledgeUnit } from "./brain.mjs";
import { CONCEPT_RELATIONS } from "./config.mjs";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a knowledge-units.json file produced by Stage 8 (Knowledge Extraction).
 * Expected format:
 *   {
 *     "repoName": "openai-agents-python",
 *     "units": [ { id, type, title, description, evidence, confidence, ... }, ... ],
 *     "conceptEdges": [ { source, relation, target, evidence }, ... ]
 *   }
 * @param {string} filePath - Path to knowledge-units.json
 * @returns {{ repoName: string, units: object[], conceptEdges: object[] }}
 */
export function parseKnowledgeUnits(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Knowledge units file not found: ${filePath}`);
  }
  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  return {
    repoName: data.repoName || "unknown",
    units: data.units || [],
    conceptEdges: data.conceptEdges || [],
  };
}

// ---------------------------------------------------------------------------
// Applying knowledge to the Brain
// ---------------------------------------------------------------------------

/**
 * Apply a set of extracted knowledge units to the Brain.
 * For each unit:
 *   - If it's new → create
 *   - If it already exists (same id or similar title) → merge (increment confidence)
 *
 * @param {Brain} brain - The Brain instance
 * @param {object[]} units - Knowledge units to apply
 * @param {string} repoName - Repository name (for evidence tracking)
 * @returns {{ created: object[], merged: object[], errors: string[] }}
 */
export function applyToBrain(brain, units, repoName) {
  const created = [];
  const merged = [];
  const errors = [];

  for (const rawUnit of units) {
    try {
      const unit = createKnowledgeUnit(rawUnit);
      const { valid, errors: validationErrors } = validateKnowledgeUnit(unit);
      if (!valid) {
        errors.push(`${unit.id || "(unknown)"}: ${validationErrors.join("; ")}`);
        continue;
      }
      const result = brain.addOrUpdate(unit, repoName);
      if (result.action === "created") {
        created.push(result.unit);
      } else {
        merged.push(result.unit);
      }
    } catch (err) {
      errors.push(`${rawUnit.id || rawUnit.title || "(unknown)"}: ${err.message}`);
    }
  }

  return { created, merged, errors };
}

/**
 * Apply concept graph edges to the Brain.
 * @param {Brain} brain
 * @param {object[]} edges - [{ source, relation, target, evidence? }]
 * @returns {{ applied: number, errors: string[] }}
 */
export function applyConceptEdges(brain, edges) {
  let applied = 0;
  const errors = [];
  for (const edge of edges) {
    try {
      if (!CONCEPT_RELATIONS.includes(edge.relation)) {
        errors.push(`${edge.source} -${edge.relation}-> ${edge.target}: unknown relation`);
        continue;
      }
      brain.addConceptEdge(edge);
      applied++;
    } catch (err) {
      errors.push(`${edge.source || "?"} -${edge.relation || "?"}-> ${edge.target || "?"}: ${err.message}`);
    }
  }
  return { applied, errors };
}

// ---------------------------------------------------------------------------
// Novelty Detection
// ---------------------------------------------------------------------------

/**
 * Detect which knowledge units are novel vs already known by the Brain.
 * This is used by Stage 9 (Brain Update) to decide what to add.
 *
 * A unit is "novel" if:
 *   - No existing unit with the same id
 *   - No existing unit with a similar title (keyword overlap > 0.5)
 *
 * @param {Brain} brain
 * @param {object[]} candidateUnits - Units extracted from a report
 * @returns {{ novel: object[], known: { unit: object, matchedBy: object, score: number }[] }}
 */
export function detectNovelty(brain, candidateUnits) {
  const novel = [];
  const known = [];

  for (const candidate of candidateUnits) {
    // Check by exact id match
    const existing = brain.get(candidate.type, candidate.id);
    if (existing) {
      known.push({ unit: candidate, matchedBy: existing, score: 1.0 });
      continue;
    }

    // Check by title similarity
    const similar = brain.findSimilar(candidate.type, candidate.title || "");
    const bestMatch = similar[0];
    if (bestMatch && bestMatch.score >= 0.5) {
      known.push({ unit: candidate, matchedBy: bestMatch.unit, score: bestMatch.score });
      continue;
    }

    // No match found — this is novel
    novel.push(candidate);
  }

  return { novel, known };
}

// ---------------------------------------------------------------------------
// Brain Brief generation (for Question Planner)
// ---------------------------------------------------------------------------

/**
 * Generate a Brain Brief — a compact JSON summary of what the Brain already
 * knows. This file is read by the Question Planner (Stage 0) to make research
 * "Brain-first": the planner focuses questions on novelty rather than
 * re-discovering known patterns.
 *
 * Output: brain-brief.json in the working folder
 *
 * @param {Brain} brain
 * @param {string} outputDir - Working folder directory
 * @returns {string} path to brain-brief.json
 */
export function generateBrainBrief(brain, outputDir) {
  const brief = brain.exportBrief();
  // Add a human-readable summary section
  brief._summary = {
    totalEstablishedPatterns: brief.establishedPatterns.length,
    totalKnownDecisions: brief.recentDecisions.length,
    totalVocabulary: brief.vocabulary.length,
    totalAntiPatterns: brief.antiPatterns.length,
    guidance:
      "When generating Research Questions, AVOID asking about patterns the Brain already knows. " +
      "Focus on what is NOVEL about this repository compared to established patterns. " +
      "If a known pattern appears here, ask WHY it was chosen and HOW it differs, not WHAT it is.",
  };
  const outPath = join(outputDir, "brain-brief.json");
  writeFileSync(outPath, JSON.stringify(brief, null, 2));
  return outPath;
}

// ---------------------------------------------------------------------------
// Full brain update from knowledge-units.json
// ---------------------------------------------------------------------------

/**
 * Full pipeline: read knowledge-units.json → detect novelty → apply to Brain.
 * Used by the `brain-update` CLI command.
 *
 * @param {Brain} brain
 * @param {string} knowledgeUnitsPath - Path to knowledge-units.json
 * @returns {{ repoName: string, created: object[], merged: object[], novel: object[], known: object[], conceptEdges: number, errors: string[] }}
 */
export function updateBrainFromFile(brain, knowledgeUnitsPath) {
  const { repoName, units, conceptEdges } = parseKnowledgeUnits(knowledgeUnitsPath);

  // Detect novelty BEFORE applying (for reporting)
  const { novel, known } = detectNovelty(brain, units);

  // Apply all units to the brain (create new + merge existing)
  const { created, merged, errors } = applyToBrain(brain, units, repoName);

  // Apply concept graph edges
  const { applied: edgeCount, errors: edgeErrors } = applyConceptEdges(brain, conceptEdges);
  errors.push(...edgeErrors);

  return {
    repoName,
    created,
    merged,
    novel,
    known,
    conceptEdges: edgeCount,
    errors,
  };
}
