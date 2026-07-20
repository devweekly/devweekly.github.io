#!/usr/bin/env node
/**
 * Enterprise Research Agent — Single-file Research Machinery
 *
 * 定位：Evidence-driven research 的确定性骨架。
 * LLM 负责语义工作（planning / evidence interpretation / identity decisions / correlation / report writing），
 * JS 负责状态管理、Ontology 校验、Gap 计算、Report schema 校验、Mermaid 导出、持久化。
 *
 * Core Concepts:
 *   - Lightweight Ontology (Schema only, no instances) — entity types + allowed relations + required properties
 *   - Research Graph (Working Memory) — entities + relationships + evidence + identity aliases
 *   - Canonical Identity — aliases merged into one entity
 *   - Evidence — traceable source + confidence + extracted claims
 *   - Research Report — Finding → Evidence → Confidence → Conflicts → Gaps → Recommendations
 *
 * Workflow:
 *   Question → Planning → Evidence Collection → Identity Resolution
 *            → Evidence Correlation → Gap Analysis → External Verification → Report
 *
 * 设计原则：
 *   - Ontology 服务于 Research，而不是让 Research 服务于 Ontology
 *   - 不做完整 Knowledge Graph / OWL / RDF / SPARQL
 *   - 不强调 Multi-Agent 框架（单 agent + workflow 即可）
 *   - Graph 是 Investigation 的 Working Memory，不是最终结果
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ============================================================
// 1. Lightweight Ontology（Schema-only，不存实例）
//
//    Ontology 仅定义 schema：
//      - entityTypes: 每种实体的 properties (with types) + required + relations + expectedRelations
//      - relations: { relationType: targetEntityType }
//      - expectedRelations: Gap Analysis 会软提示缺失的关系
//
//    所有实例存在 Research Graph 中。
// ============================================================

const ONTOLOGY = {
  Vendor: {
    description: 'External supplier or service provider',
    properties: { website: 'string', category: 'string', headquarters: 'string' },
    requiredProperties: ['website'],
    relations: {
      used_by: 'Application',
      provides: 'Product',
      contracted_by: 'Contract',
    },
    expectedRelations: ['used_by', 'contracted_by'],
  },
  Application: {
    description: 'Business application or system',
    properties: { owner: 'string', criticality: 'string', lifecycle: 'string' },
    requiredProperties: ['owner', 'lifecycle'],
    relations: {
      implemented_by: 'Repository',
      owned_by: 'Team',
      supports: 'Capability',
      affected_by: 'Incident',
      subject_to: 'Regulation',
    },
    expectedRelations: ['owned_by', 'implemented_by'],
  },
  Repository: {
    description: 'Source code repository',
    properties: { url: 'string', language: 'string', lastCommit: 'string' },
    requiredProperties: [],
    relations: {
      belongs_to: 'Team',
      implements: 'Application',
    },
    expectedRelations: ['belongs_to'],
  },
  Team: {
    description: 'Organizational team',
    properties: { name: 'string', department: 'string' },
    requiredProperties: ['name'],
    relations: {
      owns: 'Application',
      owns_repo: 'Repository',
      member: 'Person',
    },
    expectedRelations: [],
  },
  Person: {
    description: 'Individual person',
    properties: { email: 'string', role: 'string', title: 'string' },
    requiredProperties: ['email'],
    relations: {
      member_of: 'Team',
    },
    expectedRelations: [],
  },
  Project: {
    description: 'Initiative or delivery project',
    properties: { status: 'string', startDate: 'string', endDate: 'string' },
    requiredProperties: ['status'],
    relations: {
      delivers: 'Capability',
      affects: 'Application',
      owned_by: 'Team',
    },
    expectedRelations: [],
  },
  Capability: {
    description: 'Business or technical capability',
    properties: { description: 'string', maturity: 'string' },
    requiredProperties: [],
    relations: {
      supported_by: 'Application',
      supports: 'BusinessProcess',
    },
    expectedRelations: [],
  },
  BusinessProcess: {
    description: 'Business process',
    properties: { name: 'string', description: 'string' },
    requiredProperties: ['name'],
    relations: {
      supported_by: 'Capability',
    },
    expectedRelations: [],
  },
  Regulation: {
    description: 'Regulatory requirement or standard',
    properties: { jurisdiction: 'string', effectiveDate: 'string', description: 'string' },
    requiredProperties: ['jurisdiction'],
    relations: {
      impacts: 'Application',
      mandates: 'Control',
    },
    expectedRelations: ['impacts'],
  },
  Control: {
    description: 'Security or compliance control',
    properties: { framework: 'string', description: 'string' },
    requiredProperties: [],
    relations: {
      satisfies: 'Regulation',
      mitigates: 'Risk',
    },
    expectedRelations: [],
  },
  Incident: {
    description: 'Operational incident or outage',
    properties: { date: 'string', severity: 'string', description: 'string' },
    requiredProperties: ['date'],
    relations: {
      affects: 'Application',
      caused_by: 'Repository',
    },
    expectedRelations: ['affects'],
  },
  Risk: {
    description: 'Identified risk',
    properties: { likelihood: 'string', impact: 'string', description: 'string' },
    requiredProperties: [],
    relations: {
      affects: 'Application',
      mitigated_by: 'Control',
    },
    expectedRelations: [],
  },
  Contract: {
    description: 'Vendor or service contract',
    properties: { startDate: 'string', endDate: 'string', value: 'string', status: 'string' },
    requiredProperties: ['startDate'],
    relations: {
      with: 'Vendor',
    },
    expectedRelations: [],
  },
  Document: {
    description: 'Reference document or knowledge asset',
    properties: { url: 'string', lastUpdated: 'string', title: 'string' },
    requiredProperties: ['url'],
    relations: {},
    expectedRelations: [],
  },
};

function validateEntityType(type) {
  return Object.prototype.hasOwnProperty.call(ONTOLOGY, type);
}

function validateRelation(fromType, relationType, toType) {
  const def = ONTOLOGY[fromType];
  if (!def) return { valid: false, reason: `Unknown entity type: ${fromType}` };
  const expectedToType = def.relations[relationType];
  if (!expectedToType) {
    const allowed = Object.keys(def.relations);
    return {
      valid: false,
      reason: `Relation "${relationType}" not allowed for ${fromType}. Allowed: ${allowed.join(', ') || '(none)'}`,
    };
  }
  if (expectedToType !== toType) {
    return {
      valid: false,
      reason: `Relation "${relationType}" on ${fromType} must target ${expectedToType}, got ${toType}`,
    };
  }
  return { valid: true };
}

// ============================================================
// 2. Research Graph（Working Memory）
//
//    Graph 不是最终结果，是 Investigation 的 Working Memory。
//    每次研究都会持续补充。
// ============================================================

class ResearchGraph {
  constructor() {
    this.task = null;
    this.createdAt = null;
    this.entities = new Map();      // id → entity
    this.relationships = [];        // [{ id, from, to, type, confidence, evidenceIds[] }]
    this.evidence = new Map();      // id → evidence
    this.aliases = new Map();       // aliasLower → entityId
    this._counters = { entity: 0, evidence: 0, relationship: 0 };
  }

  // ----- Entity -----

  addEntity({ type, name, aliases = [], summary = '', properties = {} }) {
    if (!validateEntityType(type)) {
      throw new Error(`Unknown entity type: ${type}. Valid: ${Object.keys(ONTOLOGY).join(', ')}`);
    }
    if (!name || !name.trim()) throw new Error('Entity name is required');

    // Identity Resolution: 检查 name/alias 是否已指向某个实体
    const existingByName = this._findEntityIdByNameOrAlias(name);
    if (existingByName) {
      const existing = this.entities.get(existingByName);
      for (const a of aliases) this._registerAlias(a, existingByName);
      existing.properties = { ...existing.properties, ...properties };
      if (summary && !existing.summary) existing.summary = summary;
      return { id: existingByName, entity: existing, merged: true };
    }

    for (const alias of aliases) {
      const existingByAlias = this._findEntityIdByNameOrAlias(alias);
      if (existingByAlias) {
        const existing = this.entities.get(existingByAlias);
        this._registerAlias(name, existingByAlias);
        for (const a of aliases) this._registerAlias(a, existingByAlias);
        existing.properties = { ...existing.properties, ...properties };
        if (summary && !existing.summary) existing.summary = summary;
        return { id: existingByAlias, entity: existing, merged: true };
      }
    }

    // 创建新实体
    this._counters.entity++;
    const id = `e${this._counters.entity}`;
    const entity = {
      id,
      type,
      name: name.trim(),
      aliases: [...aliases],
      summary,
      properties: { ...properties },
      evidenceIds: [],
      createdAt: new Date().toISOString(),
    };
    this.entities.set(id, entity);
    this._registerAlias(name, id);
    for (const a of aliases) this._registerAlias(a, id);
    return { id, entity, merged: false };
  }

  _registerAlias(name, entityId) {
    if (!name) return;
    const key = String(name).trim().toLowerCase();
    if (!key) return;
    this.aliases.set(key, entityId);
  }

  _findEntityIdByNameOrAlias(name) {
    if (!name) return null;
    return this.aliases.get(String(name).trim().toLowerCase()) || null;
  }

  findEntity(nameOrAlias) {
    const id = this._findEntityIdByNameOrAlias(nameOrAlias);
    return id ? this.entities.get(id) : null;
  }

  getEntity(id) {
    return this.entities.get(id) || null;
  }

  listEntities({ type } = {}) {
    const all = Array.from(this.entities.values());
    return type ? all.filter((e) => e.type === type) : all;
  }

  // ----- Evidence -----

  addEvidence({ source, uri, content, confidence = 0.5, extractedAt }) {
    if (!source) throw new Error('Evidence source is required');
    if (!uri && !content) throw new Error('Evidence must have uri or content');
    this._counters.evidence++;
    const id = `ev${this._counters.evidence}`;
    const ev = {
      id,
      source,
      uri: uri || '',
      content: content || '',
      confidence,
      extractedAt: extractedAt || new Date().toISOString(),
    };
    this.evidence.set(id, ev);
    return ev;
  }

  linkEvidence({ entityId, evidenceId }) {
    const entity = this.entities.get(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);
    if (!this.evidence.has(evidenceId)) throw new Error(`Evidence not found: ${evidenceId}`);
    if (!entity.evidenceIds.includes(evidenceId)) entity.evidenceIds.push(evidenceId);
    return { entityId, evidenceId };
  }

  // ----- Relationship -----

  addRelationship({ from, to, type, confidence = 0.5, evidence: evidenceIds = [] }) {
    const fromEntity = this.entities.get(from);
    const toEntity = this.entities.get(to);
    if (!fromEntity) throw new Error(`Source entity not found: ${from}`);
    if (!toEntity) throw new Error(`Target entity not found: ${to}`);

    // Ontology 校验
    const v = validateRelation(fromEntity.type, type, toEntity.type);
    if (!v.valid) throw new Error(`Ontology violation: ${v.reason}`);

    // Dedupe：同 from/to/type 已存在 → 合并 confidence (max) + union evidence
    const existing = this.relationships.find(
      (r) => r.from === from && r.to === to && r.type === type
    );
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      for (const evId of evidenceIds) {
        if (!existing.evidenceIds.includes(evId)) existing.evidenceIds.push(evId);
      }
      return { id: existing.id, relationship: existing, merged: true };
    }

    this._counters.relationship++;
    const id = `r${this._counters.relationship}`;
    const rel = {
      id,
      from,
      to,
      type,
      confidence,
      evidenceIds: [...evidenceIds],
      createdAt: new Date().toISOString(),
    };
    this.relationships.push(rel);
    return { id, relationship: rel, merged: false };
  }

  listRelationships({ from, to, type } = {}) {
    return this.relationships.filter(
      (r) => (!from || r.from === from) && (!to || r.to === to) && (!type || r.type === type)
    );
  }

  // ----- Identity Resolution -----

  resolveIdentity({ canonicalId, aliasIds }) {
    const canonical = this.entities.get(canonicalId);
    if (!canonical) throw new Error(`Canonical entity not found: ${canonicalId}`);

    const mergedIds = [];
    const errors = [];

    for (const aliasId of aliasIds) {
      if (aliasId === canonicalId) continue;
      const alias = this.entities.get(aliasId);
      if (!alias) {
        errors.push(`Entity not found: ${aliasId}`);
        continue;
      }
      if (alias.type !== canonical.type) {
        errors.push(`Type mismatch: ${aliasId} is ${alias.type}, canonical is ${canonical.type}`);
        continue;
      }

      // 合并 aliases
      for (const a of [alias.name, ...alias.aliases]) {
        if (!canonical.aliases.includes(a)) canonical.aliases.push(a);
        this._registerAlias(a, canonicalId);
      }

      // 合并 properties / summary / evidence
      canonical.properties = { ...canonical.properties, ...alias.properties };
      if (!canonical.summary && alias.summary) canonical.summary = alias.summary;
      for (const evId of alias.evidenceIds) {
        if (!canonical.evidenceIds.includes(evId)) canonical.evidenceIds.push(evId);
      }

      // 重新指向 relationships
      for (const rel of this.relationships) {
        if (rel.from === aliasId) rel.from = canonicalId;
        if (rel.to === aliasId) rel.to = canonicalId;
      }
      this._dedupeRelationships();

      this.entities.delete(aliasId);
      mergedIds.push(aliasId);
    }

    return { canonicalId, mergedIds, errors };
  }

  _dedupeRelationships() {
    const seen = new Map();
    const keep = [];
    for (const rel of this.relationships) {
      const key = `${rel.from}|${rel.to}|${rel.type}`;
      if (seen.has(key)) {
        const ex = seen.get(key);
        ex.confidence = Math.max(ex.confidence, rel.confidence);
        for (const evId of rel.evidenceIds) {
          if (!ex.evidenceIds.includes(evId)) ex.evidenceIds.push(evId);
        }
      } else {
        seen.set(key, rel);
        keep.push(rel);
      }
    }
    this.relationships = keep;
  }

  // ----- Serialization -----

  toJSON() {
    return {
      task: this.task,
      createdAt: this.createdAt,
      entities: Array.from(this.entities.values()),
      relationships: this.relationships,
      evidence: Array.from(this.evidence.values()),
      aliases: Array.from(this.aliases.entries()).map(([k, v]) => ({ alias: k, entityId: v })),
      counters: this._counters,
    };
  }

  static fromJSON(data) {
    const g = new ResearchGraph();
    g.task = data.task;
    g.createdAt = data.createdAt;
    g._counters = data.counters || { entity: 0, evidence: 0, relationship: 0 };
    for (const e of data.entities || []) g.entities.set(e.id, e);
    for (const ev of data.evidence || []) g.evidence.set(ev.id, ev);
    g.relationships = data.relationships || [];
    for (const { alias, entityId } of data.aliases || []) g.aliases.set(alias, entityId);
    return g;
  }

  // ----- Stats -----

  stats() {
    return {
      task: this.task,
      entityCount: this.entities.size,
      evidenceCount: this.evidence.size,
      relationshipCount: this.relationships.length,
      entityTypes: this._countByType(),
    };
  }

  _countByType() {
    const counts = {};
    for (const e of this.entities.values()) counts[e.type] = (counts[e.type] || 0) + 1;
    return counts;
  }
}

// ============================================================
// 3. Gap Analysis（deterministic，基于 Ontology）
//
//    对比 Graph 中每个实体与 Ontology 定义，输出 missing required property / missing expected relation。
//    Gap 不是失败，是研究发现。
// ============================================================

function analyzeGaps(graph) {
  const gaps = [];
  for (const entity of graph.entities.values()) {
    const def = ONTOLOGY[entity.type];
    if (!def) continue;

    // 缺失必填属性
    for (const prop of def.requiredProperties) {
      if (!entity.properties[prop]) {
        gaps.push({
          entityId: entity.id,
          entityName: entity.name,
          entityType: entity.type,
          gapType: 'missing_property',
          detail: `${prop} (required)`,
          severity: 'high',
        });
      }
    }

    // 缺失预期关系
    for (const relType of def.expectedRelations) {
      const has = graph.relationships.some((r) => r.from === entity.id && r.type === relType);
      if (!has) {
        const target = def.relations[relType];
        gaps.push({
          entityId: entity.id,
          entityName: entity.name,
          entityType: entity.type,
          gapType: 'missing_relation',
          detail: `${relType} → ${target} (expected)`,
          severity: 'medium',
        });
      }
    }

    // 实体无证据支撑
    if (entity.evidenceIds.length === 0) {
      gaps.push({
        entityId: entity.id,
        entityName: entity.name,
        entityType: entity.type,
        gapType: 'no_evidence',
        detail: 'Entity has no supporting evidence',
        severity: 'medium',
      });
    }
  }
  return gaps;
}

// ============================================================
// 4. Report Schema + Validation
//
//    每个结论必须可追溯到证据。
//    企业最怕："AI 怎么知道的？"
// ============================================================

const REPORT_REQUIRED_SECTIONS = [
  'task', 'executiveSummary', 'keyFindings', 'supportingEvidence',
  'confidence', 'conflicts', 'knowledgeGaps', 'recommendations',
];

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

function validateReport(report, graph) {
  const errors = [];
  const warnings = [];

  for (const section of REPORT_REQUIRED_SECTIONS) {
    if (!(section in report)) errors.push(`Missing required section: ${section}`);
  }

  // keyFindings: 每条必须有 evidenceIds 引用
  if (Array.isArray(report.keyFindings)) {
    report.keyFindings.forEach((f, i) => {
      if (!f.id) errors.push(`keyFindings[${i}]: missing id`);
      if (!f.statement) errors.push(`keyFindings[${i}] (${f.id || '?'}): missing statement`);
      if (!f.evidenceIds || f.evidenceIds.length === 0) {
        errors.push(`keyFindings[${i}] (${f.id || '?'}): must have at least one evidenceId`);
      }
      if (f.confidence && !CONFIDENCE_LEVELS.includes(f.confidence)) {
        errors.push(`keyFindings[${i}] (${f.id}): confidence must be one of ${CONFIDENCE_LEVELS.join('/')}`);
      }
      if (f.evidenceIds) {
        for (const evId of f.evidenceIds) {
          if (!graph.evidence.has(evId)) {
            errors.push(`keyFindings[${i}] (${f.id}): evidenceId ${evId} not found in graph`);
          }
        }
      }
    });
  }

  // supportingEvidence: evidenceId 必须存在
  if (Array.isArray(report.supportingEvidence)) {
    report.supportingEvidence.forEach((se, i) => {
      if (!se.evidenceId) errors.push(`supportingEvidence[${i}]: missing evidenceId`);
      else if (!graph.evidence.has(se.evidenceId)) {
        errors.push(`supportingEvidence[${i}]: evidenceId ${se.evidenceId} not found in graph`);
      }
    });
  }

  if (Array.isArray(report.conflicts)) {
    report.conflicts.forEach((c, i) => {
      if (!c.description) errors.push(`conflicts[${i}]: missing description`);
      if (!c.evidenceIds || c.evidenceIds.length === 0) {
        warnings.push(`conflicts[${i}]: no evidenceIds — conflict should reference evidence`);
      }
    });
  }

  if (Array.isArray(report.knowledgeGaps)) {
    report.knowledgeGaps.forEach((g, i) => {
      if (!g.description) errors.push(`knowledgeGaps[${i}]: missing description`);
    });
  }

  if (Array.isArray(report.recommendations)) {
    report.recommendations.forEach((r, i) => {
      if (!r.action) errors.push(`recommendations[${i}]: missing action`);
      if (r.priority && !['high', 'medium', 'low'].includes(r.priority)) {
        warnings.push(`recommendations[${i}]: priority should be high/medium/low`);
      }
    });
  }

  if (report.confidence && report.confidence.overall) {
    if (!CONFIDENCE_LEVELS.includes(report.confidence.overall)) {
      errors.push(`confidence.overall must be one of ${CONFIDENCE_LEVELS.join('/')}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// 生成报告模板：LLM 在此基础上填 findings / recommendations
function reportTemplate(graph) {
  const gaps = analyzeGaps(graph);
  return {
    task: graph.task || '',
    executiveSummary: '',
    keyFindings: [],
    supportingEvidence: Array.from(graph.evidence.values()).map((ev) => ({
      evidenceId: ev.id,
      source: ev.source,
      uri: ev.uri,
      summary: ev.content.slice(0, 100),
      confidence: ev.confidence,
    })),
    confidence: {
      overall: '',
      rationale: '',
    },
    conflicts: [],
    knowledgeGaps: gaps.map((g) => ({
      description: `${g.entityName} (${g.entityType}): missing ${g.detail}`,
      entityId: g.entityId,
      missingRelation: g.gapType === 'missing_relation' ? g.detail : undefined,
      severity: g.severity,
    })),
    recommendations: [],
  };
}

// ============================================================
// 5. Mermaid Export
// ============================================================

function graphToMermaid(graph, { maxNodes = 50 } = {}) {
  const entities = Array.from(graph.entities.values());
  if (entities.length === 0) return 'flowchart LR\n    empty["(empty graph)"]';
  if (entities.length > maxNodes) {
    return `flowchart LR\n    %% Graph too large (${entities.length} entities > ${maxNodes}). Use --max-nodes to increase.`;
  }

  const lines = ['flowchart LR'];
  for (const e of entities) {
    const label = `${e.name} (${e.type})`.replace(/"/g, "'");
    lines.push(`    ${e.id}["${label}"]`);
  }
  for (const r of graph.relationships) {
    lines.push(`    ${r.from} -->|${r.type}| ${r.to}`);
  }
  return lines.join('\n');
}

// ============================================================
// 6. Persistence
// ============================================================

function saveGraph(graph, file) {
  fs.writeFileSync(file, JSON.stringify(graph.toJSON(), null, 2));
}

function loadGraph(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`State file not found: ${file}. Run 'init' first.`);
  }
  return ResearchGraph.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// ============================================================
// 7. CLI
// ============================================================

function printUsage() {
  console.log(`
Usage: node research.mjs <command> [options]

Commands:
  init --task <name> [--state <file>]                  Initialize new research graph
  status [--state <file>]                              Show graph summary
  list-ontology [--type <T>]                           List entity types and relations
  add-entity --type <T> --name <N> [--aliases a,b] [--summary ...] [--props k=v,k=v] [--state <file>]
  find-entity <name> [--state <file>]                  Find entity by name or alias
  list-entities [--type <T>] [--state <file>]          List entities
  add-evidence --source <S> [--uri <U>] [--content <C>] [--confidence 0.5] [--state <file>]
  link-evidence --entity <id> --evidence <id> [--state <file>]
  add-relationship --from <id> --to <id> --type <T> [--confidence 0.5] [--evidence ev1,ev2] [--state <file>]
  resolve-identity --canonical <id> --aliases <id1,id2> [--state <file>]
  analyze-gaps [--state <file>]                        Compute gaps based on Ontology
  show-graph [--state <file>] [--max-nodes 50]         Output Mermaid flowchart
  report-template [--output <file>] [--state <file>]   Generate report template
  validate-report --report <file> [--state <file>]     Validate report schema

Options:
  --state <file>    State file path (default: ./research-state.json)
  --task <name>     Research task name (for init)
  --type <T>        Entity type (Vendor, Application, Repository, Team, Person, Project,
                    Capability, BusinessProcess, Regulation, Control, Incident, Risk, Contract, Document)
  --name <N>        Entity name
  --aliases <list>  Comma-separated aliases
  --summary <text>  Entity summary
  --props <list>    Comma-separated key=value properties
  --source <S>      Evidence source (Confluence, GitHub, Jira, LeanIX, ServiceNow, Vendor, ...)
  --uri <U>         Evidence URI
  --content <C>     Evidence content
  --confidence <n>  Confidence 0-1 (default 0.5)
  --from <id>       Source entity ID
  --to <id>         Target entity ID
  --evidence <list> Comma-separated evidence IDs
  --canonical <id>  Canonical entity ID (for resolve-identity)
  --output <file>   Output file path
  --max-nodes <n>   Max nodes for Mermaid export (default 50)
  --help, -h        Show this help

Examples:
  node research.mjs init --task "Research RiskConcile"
  node research.mjs add-entity --type Vendor --name "RiskConcile" --aliases "RC,riskconcile-api" --props "website=https://riskconcile.com"
  node research.mjs add-evidence --source GitHub --uri "https://github.com/org/riskconcile-api" --content "Repo exists" --confidence 0.95
  node research.mjs add-relationship --from e1 --to e2 --type used_by --evidence ev1
  node research.mjs resolve-identity --canonical e1 --aliases e2,e3
  node research.mjs analyze-gaps
  node research.mjs show-graph
`);
}

function parseProps(s) {
  if (!s) return {};
  const out = {};
  for (const pair of s.split(',')) {
    const [k, ...rest] = pair.split('=');
    if (k) out[k.trim()] = rest.join('=').trim();
  }
  return out;
}

function parseList(s) {
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function getStateFile(argv) {
  const i = argv.indexOf('--state');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : './research-state.json';
}

function argValue(argv, key) {
  const i = argv.indexOf(key);
  return i >= 0 ? argv[i + 1] : null;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const command = argv[0];
  const stateFile = getStateFile(argv);

  try {
    switch (command) {
      case 'init': {
        const task = argValue(argv, '--task') || 'Untitled Research';
        const g = new ResearchGraph();
        g.task = task;
        g.createdAt = new Date().toISOString();
        saveGraph(g, stateFile);
        console.log(`✓ Initialized research graph: "${task}"`);
        console.log(`  State: ${stateFile}`);
        break;
      }

      case 'status': {
        const g = loadGraph(stateFile);
        const s = g.stats();
        console.log(`Task:        ${s.task}`);
        console.log(`Created:     ${g.createdAt}`);
        console.log(`Entities:    ${s.entityCount}`);
        console.log(`Evidence:    ${s.evidenceCount}`);
        console.log(`Relations:   ${s.relationshipCount}`);
        console.log(`By type:     ${Object.entries(s.entityTypes).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`);
        break;
      }

      case 'list-ontology': {
        const type = argValue(argv, '--type');
        if (type) {
          const def = ONTOLOGY[type];
          if (!def) {
            console.error(`Unknown type: ${type}. Valid: ${Object.keys(ONTOLOGY).join(', ')}`);
            process.exit(1);
          }
          console.log(`Type:        ${type}`);
          console.log(`Description: ${def.description}`);
          console.log(`Properties:  ${Object.keys(def.properties).join(', ') || '(none)'}`);
          console.log(`Required:    ${def.requiredProperties.join(', ') || '(none)'}`);
          console.log(`Relations:`);
          for (const [rel, target] of Object.entries(def.relations)) {
            console.log(`  ${rel} → ${target}`);
          }
          if (def.expectedRelations.length) {
            console.log(`Expected (Gap Analysis): ${def.expectedRelations.join(', ')}`);
          }
        } else {
          console.log('Entity Types:\n');
          for (const [t, def] of Object.entries(ONTOLOGY)) {
            console.log(`  [${t}] ${def.description}`);
            console.log(`    Required:   ${def.requiredProperties.join(', ') || '(none)'}`);
            const rels = Object.entries(def.relations).map(([k, v]) => `${k}→${v}`).join(', ');
            console.log(`    Relations:  ${rels || '(none)'}`);
            if (def.expectedRelations.length) {
              console.log(`    Expected:   ${def.expectedRelations.join(', ')}`);
            }
            console.log('');
          }
        }
        break;
      }

      case 'add-entity': {
        const g = loadGraph(stateFile);
        const type = argValue(argv, '--type');
        const name = argValue(argv, '--name');
        const aliases = parseList(argValue(argv, '--aliases'));
        const summary = argValue(argv, '--summary') || '';
        const props = parseProps(argValue(argv, '--props'));
        if (!type || !name) {
          console.error('Error: --type and --name are required');
          process.exit(1);
        }
        const result = g.addEntity({ type, name, aliases, summary, properties: props });
        saveGraph(g, stateFile);
        if (result.merged) {
          console.log(`✓ Merged into existing entity ${result.id} (${result.entity.type}: ${result.entity.name})`);
        } else {
          console.log(`✓ Added entity ${result.id}: ${type} "${name}"`);
          if (aliases.length) console.log(`  Aliases: ${aliases.join(', ')}`);
        }
        break;
      }

      case 'find-entity': {
        const g = loadGraph(stateFile);
        const name = argv[1];
        if (!name) {
          console.error('Error: name is required (positional argument)');
          process.exit(1);
        }
        const e = g.findEntity(name);
        if (!e) {
          console.log(`Not found: ${name}`);
          process.exit(1);
        }
        console.log(`Entity: ${e.id}`);
        console.log(`  Type:     ${e.type}`);
        console.log(`  Name:     ${e.name}`);
        if (e.aliases.length) console.log(`  Aliases:  ${e.aliases.join(', ')}`);
        if (e.summary) console.log(`  Summary:  ${e.summary}`);
        if (Object.keys(e.properties).length) {
          console.log(`  Properties:`);
          for (const [k, v] of Object.entries(e.properties)) console.log(`    ${k}: ${v}`);
        }
        if (e.evidenceIds.length) console.log(`  Evidence: ${e.evidenceIds.join(', ')}`);
        break;
      }

      case 'list-entities': {
        const g = loadGraph(stateFile);
        const type = argValue(argv, '--type');
        const entities = g.listEntities({ type });
        if (entities.length === 0) {
          console.log(`No entities${type ? ` of type ${type}` : ''}`);
          break;
        }
        console.log(`Entities (${entities.length}):`);
        for (const e of entities) {
          const alias = e.aliases.length ? ` (aliases: ${e.aliases.join(', ')})` : '';
          console.log(`  ${e.id} [${e.type}] ${e.name}${alias}`);
        }
        break;
      }

      case 'add-evidence': {
        const g = loadGraph(stateFile);
        const source = argValue(argv, '--source');
        const uri = argValue(argv, '--uri');
        const content = argValue(argv, '--content');
        const confidence = parseFloat(argValue(argv, '--confidence') || '0.5');
        if (!source) {
          console.error('Error: --source is required');
          process.exit(1);
        }
        const ev = g.addEvidence({ source, uri, content, confidence });
        saveGraph(g, stateFile);
        console.log(`✓ Added evidence ${ev.id}: source=${source}, confidence=${confidence}`);
        break;
      }

      case 'link-evidence': {
        const g = loadGraph(stateFile);
        const entityId = argValue(argv, '--entity');
        const evidenceId = argValue(argv, '--evidence');
        if (!entityId || !evidenceId) {
          console.error('Error: --entity and --evidence are required');
          process.exit(1);
        }
        g.linkEvidence({ entityId, evidenceId });
        saveGraph(g, stateFile);
        console.log(`✓ Linked ${evidenceId} to ${entityId}`);
        break;
      }

      case 'add-relationship': {
        const g = loadGraph(stateFile);
        const from = argValue(argv, '--from');
        const to = argValue(argv, '--to');
        const type = argValue(argv, '--type');
        const confidence = parseFloat(argValue(argv, '--confidence') || '0.5');
        const evidenceIds = parseList(argValue(argv, '--evidence'));
        if (!from || !to || !type) {
          console.error('Error: --from, --to, --type are required');
          process.exit(1);
        }
        const result = g.addRelationship({ from, to, type, confidence, evidence: evidenceIds });
        saveGraph(g, stateFile);
        if (result.merged) {
          console.log(`✓ Merged into existing relationship ${result.id} (${from} -[${type}]-> ${to})`);
        } else {
          console.log(`✓ Added relationship ${result.id}: ${from} -[${type}]-> ${to}`);
        }
        break;
      }

      case 'resolve-identity': {
        const g = loadGraph(stateFile);
        const canonicalId = argValue(argv, '--canonical');
        const aliasIds = parseList(argValue(argv, '--aliases'));
        if (!canonicalId || !aliasIds.length) {
          console.error('Error: --canonical and --aliases are required');
          process.exit(1);
        }
        const result = g.resolveIdentity({ canonicalId, aliasIds });
        saveGraph(g, stateFile);
        console.log(`✓ Resolved identity: canonical=${canonicalId}`);
        if (result.mergedIds.length) console.log(`  Merged: ${result.mergedIds.join(', ')}`);
        if (result.errors.length) {
          console.log(`  Errors:`);
          for (const e of result.errors) console.log(`    ${e}`);
        }
        break;
      }

      case 'analyze-gaps': {
        const g = loadGraph(stateFile);
        const gaps = analyzeGaps(g);
        if (gaps.length === 0) {
          console.log('✓ No gaps detected');
          break;
        }
        console.log(`Found ${gaps.length} gap(s):\n`);
        const byEntity = {};
        for (const gap of gaps) {
          const key = `${gap.entityId} (${gap.entityName})`;
          if (!byEntity[key]) byEntity[key] = [];
          byEntity[key].push(gap);
        }
        for (const [entity, entityGaps] of Object.entries(byEntity)) {
          console.log(`  ${entity} [${entityGaps[0].entityType}]`);
          for (const gap of entityGaps) {
            const icon = gap.severity === 'high' ? '⚠' : '·';
            console.log(`    ${icon} [${gap.gapType}] ${gap.detail} (${gap.severity})`);
          }
        }
        break;
      }

      case 'show-graph': {
        const g = loadGraph(stateFile);
        const maxNodes = parseInt(argValue(argv, '--max-nodes') || '50', 10);
        console.log(graphToMermaid(g, { maxNodes }));
        break;
      }

      case 'report-template': {
        const g = loadGraph(stateFile);
        const template = reportTemplate(g);
        const outputPath = argValue(argv, '--output');
        const json = JSON.stringify(template, null, 2);
        if (outputPath) {
          fs.writeFileSync(outputPath, json);
          console.log(`✓ Report template written to ${outputPath}`);
        } else {
          console.log(json);
        }
        break;
      }

      case 'validate-report': {
        const g = loadGraph(stateFile);
        const reportFile = argValue(argv, '--report');
        if (!reportFile) {
          console.error('Error: --report is required');
          process.exit(1);
        }
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        const result = validateReport(report, g);
        if (result.valid) {
          console.log('✓ Report is valid');
          if (result.warnings.length) {
            console.log('\nWarnings:');
            for (const w of result.warnings) console.log(`  · ${w}`);
          }
        } else {
          console.log('✗ Report has errors:');
          for (const e of result.errors) console.log(`  · ${e}`);
          if (result.warnings.length) {
            console.log('\nWarnings:');
            for (const w of result.warnings) console.log(`  · ${w}`);
          }
          process.exit(1);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

// ESM 入口守卫：只在直接执行时运行 CLI，import 时不运行
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) main();

// Exports for programmatic use（test runner / library import）
export {
  ONTOLOGY,
  ResearchGraph,
  analyzeGaps,
  validateReport,
  reportTemplate,
  graphToMermaid,
  saveGraph,
  loadGraph,
  validateRelation,
  validateEntityType,
};
