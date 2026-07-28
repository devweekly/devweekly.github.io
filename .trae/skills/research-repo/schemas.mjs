// ===========================================================================
// schemas.mjs — Pipeline v2 Schema Definitions & Validators
//
// Four core data structures:
//   1. KnowledgeGraph    — facts (Entity/Relationship/Attributes/Evolution)
//   2. SemanticFindings  — interpretations (unified Finding objects)
//   3. RepositoryFingerprint — derived metadata (rule-generated)
//   4. EvidenceRef       — unified evidence reference format
//
// All schemas carry `version` to allow future evolution without breaking
// existing prompts.
//
// Design principle:
//   "不要向 Palantir Ontology 演进。
//    主线始终是 Mechanical Evidence → KG → Findings → Report。"
// ===========================================================================

// ---------------------------------------------------------------------------
// Schema versions
// ---------------------------------------------------------------------------

export const SCHEMA_VERSIONS = {
  knowledgeGraph: "0.1",
  findings: "0.1",
  fingerprint: "0.1",
  evidenceRef: "0.1",
};

// ---------------------------------------------------------------------------
// EvidenceRef — unified evidence reference format
// ---------------------------------------------------------------------------

export const EVIDENCE_KINDS = [
  "code",
  "test",
  "config",
  "commit",
  "readme",
  "adr",
  "rfc",
  "issue",
  "metric",
  "graph",
  "entrypoint", // CLI/main entry points (e.g., src/main.ts, packages/cli/index.ts)
  "manifest",   // package.json, Cargo.toml, pyproject.toml — declarative project metadata
];

/**
 * Validate an EvidenceRef object.
 * @param {any} ref
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateEvidenceRef(ref) {
  const errors = [];
  if (!ref || typeof ref !== "object") {
    return { ok: false, errors: ["EvidenceRef must be an object"] };
  }
  if (typeof ref.id !== "string" || !ref.id) {
    errors.push("EvidenceRef.id must be a non-empty string");
  }
  if (typeof ref.kind !== "string" || !EVIDENCE_KINDS.includes(ref.kind)) {
    errors.push(
      `EvidenceRef.kind must be one of: ${EVIDENCE_KINDS.join(", ")} (got: ${ref.kind})`
    );
  }
  // At least one of path/symbol/commit/excerpt must be present
  const hasTarget =
    ref.path || ref.symbol || ref.commit || ref.excerpt || ref.kind === "metric";
  if (!hasTarget) {
    errors.push(
      "EvidenceRef must have at least one of: path, symbol, commit, excerpt"
    );
  }
  if (ref.score !== undefined) {
    if (typeof ref.score !== "number" || ref.score < 0 || ref.score > 1) {
      errors.push("EvidenceRef.score must be a number in [0, 1]");
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Knowledge Graph schema
// ---------------------------------------------------------------------------

export const RELATIONSHIP_TYPES = [
  "depends_on",
  "uses",
  "contains",
  "exposes",
];

/**
 * Validate a Knowledge Graph object.
 *
 * Rules:
 *   - Must have version, entities[], relationships[], metadata
 *   - Each entity must have id, type, owns[], attributes, evidence[]
 *   - Entity id should NOT be a package path (e.g., "packages/ai" is bad)
 *   - Each relationship must reference existing entity ids
 *   - Evidence must be EvidenceRef format
 *   - KG must NOT contain leverage (Leverage belongs in Findings)
 *
 * @param {any} kg
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateKG(kg) {
  const errors = [];
  if (!kg || typeof kg !== "object") {
    return { ok: false, errors: ["KG must be an object"] };
  }

  // Version
  if (typeof kg.version !== "string" || !kg.version) {
    errors.push("KG.version must be a non-empty string");
  }

  // Entities
  if (!Array.isArray(kg.entities)) {
    errors.push("KG.entities must be an array");
    return { ok: false, errors };
  }

  // Leverage check — must NOT be in KG
  if (kg.leverage !== undefined) {
    errors.push(
      "KG must NOT contain 'leverage' — Leverage is an assessment, belongs in Semantic Findings"
    );
  }

  // Entity limit
  if (kg.entities.length > 20) {
    errors.push(`KG.entities exceeds limit of 20 (got ${kg.entities.length})`);
  }

  const entityIds = new Set();
  for (let i = 0; i < kg.entities.length; i++) {
    const e = kg.entities[i];
    const prefix = `KG.entities[${i}]`;

    if (typeof e.id !== "string" || !e.id) {
      errors.push(`${prefix}.id must be a non-empty string`);
    } else {
      entityIds.add(e.id);
      // Check for package-path-like ids
      if (e.id.startsWith("packages/") || e.id.includes("/src/")) {
        errors.push(
          `${prefix}.id "${e.id}" looks like a package path — use a capability name (e.g., "LLM Integration" not "packages/ai")`
        );
      }
    }

    if (e.type !== "Capability") {
      errors.push(`${prefix}.type must be "Capability" (got: ${e.type})`);
    }

    if (!Array.isArray(e.owns)) {
      errors.push(`${prefix}.owns must be an array`);
    }

    // Attributes (optional but must be object if present)
    if (e.attributes !== undefined && (typeof e.attributes !== "object" || Array.isArray(e.attributes))) {
      errors.push(`${prefix}.attributes must be an object`);
    }

    // Evidence
    if (!Array.isArray(e.evidence)) {
      errors.push(`${prefix}.evidence must be an array of EvidenceRef`);
    } else {
      for (let j = 0; j < e.evidence.length; j++) {
        const evResult = validateEvidenceRef(e.evidence[j]);
        if (!evResult.ok) {
          errors.push(`${prefix}.evidence[${j}]: ${evResult.errors.join("; ")}`);
        }
      }
    }
  }

  // Relationships
  if (!Array.isArray(kg.relationships)) {
    errors.push("KG.relationships must be an array");
  } else {
    for (let i = 0; i < kg.relationships.length; i++) {
      const r = kg.relationships[i];
      const prefix = `KG.relationships[${i}]`;

      if (typeof r.id !== "string" || !r.id) {
        errors.push(`${prefix}.id must be a non-empty string`);
      }

      if (typeof r.from !== "string" || !entityIds.has(r.from)) {
        errors.push(
          `${prefix}.from "${r.from}" does not reference a valid entity id`
        );
      }

      if (typeof r.to !== "string" || !entityIds.has(r.to)) {
        errors.push(
          `${prefix}.to "${r.to}" does not reference a valid entity id`
        );
      }

      if (!RELATIONSHIP_TYPES.includes(r.type)) {
        errors.push(
          `${prefix}.type must be one of: ${RELATIONSHIP_TYPES.join(", ")} (got: ${r.type})`
        );
      }

      if (!Array.isArray(r.evidence)) {
        // evidence can be single EvidenceRef or array — normalize
        if (r.evidence && typeof r.evidence === "object") {
          const evResult = validateEvidenceRef(r.evidence);
          if (!evResult.ok) {
            errors.push(`${prefix}.evidence: ${evResult.errors.join("; ")}`);
          }
        } else if (r.evidence !== undefined) {
          errors.push(`${prefix}.evidence must be an EvidenceRef or array of EvidenceRef`);
        }
      } else {
        for (let j = 0; j < r.evidence.length; j++) {
          const evResult = validateEvidenceRef(r.evidence[j]);
          if (!evResult.ok) {
            errors.push(`${prefix}.evidence[${j}]: ${evResult.errors.join("; ")}`);
          }
        }
      }
    }
  }

  // Metadata (optional but should be object)
  if (kg.metadata !== undefined && (typeof kg.metadata !== "object" || Array.isArray(kg.metadata))) {
    errors.push("KG.metadata must be an object");
  }

  // Evolution in metadata
  if (kg.metadata?.evolution !== undefined) {
    if (!Array.isArray(kg.metadata.evolution)) {
      errors.push("KG.metadata.evolution must be an array");
    } else {
      for (let i = 0; i < kg.metadata.evolution.length; i++) {
        const ev = kg.metadata.evolution[i];
        const prefix = `KG.metadata.evolution[${i}]`;
        if (typeof ev.trend !== "string" || !ev.trend) {
          errors.push(`${prefix}.trend must be a non-empty string`);
        }
        if (!["forward", "deprecated"].includes(ev.direction)) {
          errors.push(
            `${prefix}.direction must be "forward" or "deprecated" (got: ${ev.direction})`
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Semantic Findings schema (unified Finding object)
// ---------------------------------------------------------------------------

export const FINDING_TYPES = [
  "constraint",
  "decision",
  "tension",
  "omission",
  "leverage",
  "mental_model",
];

/**
 * Validate a Semantic Findings object.
 *
 * Rules:
 *   - Must have version and findings[]
 *   - Each Finding must have id, type, title, evidence[], confidence
 *   - Each Finding must have entity_refs or relationship_refs (KG linkage)
 *   - evidence must be EvidenceRef format
 *   - Mental model must output concepts[], NOT layers
 *
 * @param {any} findings
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateFindings(findings) {
  const errors = [];
  if (!findings || typeof findings !== "object") {
    return { ok: false, errors: ["Findings must be an object"] };
  }

  if (typeof findings.version !== "string" || !findings.version) {
    errors.push("Findings.version must be a non-empty string");
  }

  if (!Array.isArray(findings.findings)) {
    errors.push("Findings.findings must be an array");
    return { ok: false, errors };
  }

  const findingIds = new Set();
  for (let i = 0; i < findings.findings.length; i++) {
    const f = findings.findings[i];
    const prefix = `findings[${i}]`;

    if (typeof f.id !== "string" || !f.id) {
      errors.push(`${prefix}.id must be a non-empty string`);
    } else {
      findingIds.add(f.id);
    }

    if (!FINDING_TYPES.includes(f.type)) {
      errors.push(
        `${prefix}.type must be one of: ${FINDING_TYPES.join(", ")} (got: ${f.type})`
      );
    }

    if (typeof f.title !== "string" || !f.title) {
      errors.push(`${prefix}.title must be a non-empty string`);
    }

    // Evidence — must be EvidenceRef array, at least 1
    if (!Array.isArray(f.evidence) || f.evidence.length === 0) {
      errors.push(`${prefix}.evidence must be a non-empty array of EvidenceRef`);
    } else {
      for (let j = 0; j < f.evidence.length; j++) {
        const evResult = validateEvidenceRef(f.evidence[j]);
        if (!evResult.ok) {
          errors.push(`${prefix}.evidence[${j}]: ${evResult.errors.join("; ")}`);
        }
      }
    }

    // Confidence
    if (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 1) {
      errors.push(`${prefix}.confidence must be a number in [0, 1]`);
    }

    // KG linkage — must have entity_refs or relationship_refs
    const hasEntityRefs = Array.isArray(f.entity_refs) && f.entity_refs.length > 0;
    const hasRelRefs =
      Array.isArray(f.relationship_refs) && f.relationship_refs.length > 0;
    if (!hasEntityRefs && !hasRelRefs) {
      errors.push(
        `${prefix} must have entity_refs or relationship_refs (linking to KG)`
      );
    }

    // Mental model must output concepts, NOT layers
    if (f.type === "mental_model") {
      if (f.layers !== undefined) {
        errors.push(
          `${prefix}: mental_model must output concepts[], not layers`
        );
      }
      if (f.concepts !== undefined) {
        if (!Array.isArray(f.concepts)) {
          errors.push(`${prefix}.concepts must be an array`);
        } else {
          for (let j = 0; j < f.concepts.length; j++) {
            const c = f.concepts[j];
            const cprefix = `${prefix}.concepts[${j}]`;
            if (typeof c.concept !== "string" || !c.concept) {
              errors.push(`${cprefix}.concept must be a non-empty string`);
            }
            if (typeof c.responsibility !== "string" || !c.responsibility) {
              errors.push(`${cprefix}.responsibility must be a non-empty string`);
            }
            if (typeof c.boundary !== "string" || !c.boundary) {
              errors.push(`${cprefix}.boundary must be a non-empty string`);
            }
          }
        }
      }
    }

    // Decision should have intent field (Intent merged into Decision)
    if (f.type === "decision") {
      if (f.intent === undefined) {
        errors.push(
          `${prefix}: decision should have 'intent' field (Intent merged into Decision)`
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Repository Fingerprint schema
// ---------------------------------------------------------------------------

export const FINGERPRINT_FIELDS = [
  "style",
  "architecture",
  "evolution",
  "domain",
  "maturity",
  "complexity",
  "engineering_taste",
];

/**
 * Validate a Repository Fingerprint object.
 *
 * Rules:
 *   - Must have version and all 7 fields
 *   - No field should be "Unknown" (must have fallback)
 *
 * @param {any} fp
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateFingerprint(fp) {
  const errors = [];
  if (!fp || typeof fp !== "object") {
    return { ok: false, errors: ["Fingerprint must be an object"] };
  }

  if (typeof fp.version !== "string" || !fp.version) {
    errors.push("Fingerprint.version must be a non-empty string");
  }

  for (const field of FINGERPRINT_FIELDS) {
    if (typeof fp[field] !== "string" || !fp[field]) {
      errors.push(`Fingerprint.${field} must be a non-empty string`);
    } else if (fp[field].toLowerCase() === "unknown") {
      errors.push(
        `Fingerprint.${field} should not be "Unknown" — must have a fallback value`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Schema constants (for LLM prompt injection)
// ---------------------------------------------------------------------------

export const KNOWLEDGE_GRAPH_SCHEMA = {
  version: SCHEMA_VERSIONS.knowledgeGraph,
  description: "Knowledge Graph — facts only, no assessments",
  entities: {
    id: "string — capability name (e.g., 'LLM Integration', NOT 'packages/ai')",
    type: '"Capability"',
    owns: "string[] — owned file paths",
    attributes: {
      language: "string? — 'ts', 'py', 'rs'",
      stability: "string? — 'stable', 'experimental', 'deprecated'",
      visibility: "string? — 'public', 'internal'",
      confidence: "number? — 0-1",
    },
    evidence: "EvidenceRef[]",
  },
  relationships: {
    id: "string — 'rel-001'",
    from: "string — entity id",
    to: "string — entity id",
    type: '"depends_on" | "uses" | "contains" | "exposes"',
    evidence: "EvidenceRef[]",
  },
  metadata: {
    evolution: {
      trend: "string — e.g., 'Registry → Runtime → Plugin'",
      evidence: "EvidenceRef",
      direction: '"forward" | "deprecated"',
    },
  },
};

export const FINDING_SCHEMA = {
  version: SCHEMA_VERSIONS.findings,
  description: "Semantic Findings — unified Finding objects with type discriminator",
  findings: [
    {
      id: "string — 'F-001'",
      type: '"constraint" | "decision" | "tension" | "omission" | "leverage" | "mental_model"',
      title: "string — one-sentence title",
      evidence: "EvidenceRef[]",
      confidence: "number — 0-1",
      entity_refs: "string[]? — KG entity ids this Finding relates to",
      relationship_refs: "string[]? — KG relationship ids this Finding relates to",
      // type-specific:
      drives: "string[]? — for constraint: which decisions it drives",
      intent: "string? — for decision: future evolution intent",
      time_horizon: '"immediate" | "near-term" | "long-term" | "temporary"? — for decision',
      tradeoff: "string? — for decision: what was sacrificed",
      alternatives: "string[]? — for decision: alternative approaches",
      left: "string? — for tension: one side",
      right: "string? — for tension: other side",
      reason: "string? — for omission: why avoided",
      philosophy: "string? — for omission: design philosophy implied",
      blast_radius: "number? — for leverage: fan-in count",
      recovery_cost: '"low" | "medium" | "high"? — for leverage',
      concepts: "object[]? — for mental_model: {concept, owns, responsibility, boundary}",
    },
  ],
};

export const FINGERPRINT_SCHEMA = {
  version: SCHEMA_VERSIONS.fingerprint,
  description: "Repository Fingerprint — derived metadata (rule-generated, no LLM)",
  style: 'string — "Functional" | "OOP" | "Mixed"',
  architecture: 'string — "Capability-oriented" | "Layered" | "Plugin" | "Monolith"',
  evolution: 'string — "Active Migration" | "Active Development" | "Stable" | "Early"',
  domain: "string — e.g., 'Coding Agent', 'Database', 'Compiler'",
  maturity: 'string — "Production" | "Early" | "Experimental"',
  complexity: 'string — "High" | "Medium" | "Low"',
  engineering_taste: 'string — "Minimalistic" | "Enterprise" | "Academic"',
};

export const EVIDENCE_REF_SCHEMA = {
  version: SCHEMA_VERSIONS.evidenceRef,
  description: "Unified evidence reference format",
  id: "string — 'ev-001'",
  kind: '"code" | "test" | "config" | "commit" | "readme" | "adr" | "rfc" | "issue" | "metric" | "graph" | "entrypoint" | "manifest"',
  path: "string? — file path",
  symbol: "string? — function/class/module name",
  commit: "string? — commit hash",
  excerpt: "string? — code/text snippet (≤200 chars)",
  score: "number? — 0-1, evidence strength",
};
