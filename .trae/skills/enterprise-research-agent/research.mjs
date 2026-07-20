#!/usr/bin/env node
/**
 * Enterprise Research Agent — ResearchSession Machinery (single-file)
 *
 * v3 设计：Research = Investigation + Analysis
 *   - Investigation: 收集 Evidence, 建立 Canonical Identity, 形成 Evidence Graph
 *   - Analysis: 发现 Gap, 检测 Contradiction, 评估 Confidence, 形成 Finding
 *
 * Core Objects:
 *   - ResearchSession: 贯穿全流程的工作上下文（Research Context）
 *     { goal, plan, graph, findings, gaps, contradictions, confidence, report,
 *       visitedSources, pendingQuestions, rejectedHypotheses }
 *   - EvidenceGraph: Working Memory（entities + relationships + evidence + aliases）
 *   - Evidence: 可追溯单元 { source, uri, content, confidence, lastUpdated, claims, metadata }
 *   - Canonical Identity: aliases 合并到统一实体
 *   - Contradiction: 同一实体的同一属性出现冲突值（基于 claims 检测）
 *   - Confidence: high/medium/low，基于 evidence 数量 / source 权重 / cross validation / freshness
 *
 * Workflow:
 *   Question → Planning → Investigation (Collection + Identity + Correlation)
 *            → Analysis (Gap + Contradiction + Confidence) → External Verification → Report
 *
 * 设计原则：
 *   - Evidence First / Identity Before Search / Entity-Centric / Traceable by Design
 *   - Connector Agnostic（Connector Adapter 统一输出 Evidence）
 *   - Incremental Knowledge（ResearchSession 持久化）
 *   - 不做完整 Knowledge Graph / OWL / RDF / SPARQL
 *   - 不强调 Multi-Agent 框架
 *   - 不发明 DSL Rule Language
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ============================================================
// 1. Lightweight Research Ontology（"Ontology" 在本项目中仅出现一次）
//
//    Schema-only：定义 entity types 的 properties / required / relations / expectedRelations。
//    所有实例存在 EvidenceGraph 中。不做 OWL / RDF / SPARQL / Description Logic / Rule Engine。
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
// 2. Evidence Graph（Working Memory）
//
//    EvidenceGraph 不是最终结果，是 Investigation 的 Working Memory。
//    内部存储：entities / relationships / evidence / aliases。
//    每个 Entity 持有 evidenceIds[]；每条 Evidence 持有 claims[]。
// ============================================================

class EvidenceGraph {
  constructor() {
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

  // ----- Evidence（Evidence Model 的实现）-----
  //
  //   Evidence 是 Research Agent 的最小操作单元，不是 Document。
  //   每条 Evidence 包含：
  //     - source:         来源（Connector Adapter 名，如 GitHub / Jira / LeanIX / Vendor / External）
  //     - uri:            原始位置
  //     - content:        抽取内容（free text）
  //     - confidence:     LLM 判定的初始可信度 0-1
  //     - lastUpdated:    源数据的最后更新时间（用于 Freshness 评估）
  //     - extractedAt:    LLM 抽取该 Evidence 的时间
  //     - claims:         结构化断言 [{ property, value }]，用于 Contradiction Detection
  //     - metadata:       Connector Adapter 附加信息（free-form object）

  addEvidence({ source, uri, content, confidence = 0.5, lastUpdated, extractedAt, claims = [], metadata = {} }) {
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
      lastUpdated: lastUpdated || '',
      extractedAt: extractedAt || new Date().toISOString(),
      claims: claims.map((c) => ({ property: String(c.property), value: String(c.value) })),
      metadata: metadata || {},
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
      entities: Array.from(this.entities.values()),
      relationships: this.relationships,
      evidence: Array.from(this.evidence.values()),
      aliases: Array.from(this.aliases.entries()).map(([k, v]) => ({ alias: k, entityId: v })),
      counters: this._counters,
    };
  }

  static fromJSON(data) {
    const g = new EvidenceGraph();
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
// ============================================================

function analyzeGaps(graph) {
  const gaps = [];
  for (const entity of graph.entities.values()) {
    const def = ONTOLOGY[entity.type];
    if (!def) continue;

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
// 4. Contradiction Detection（deterministic，基于 claims）
//
//    同一实体的同一 property 出现不同 value → contradiction。
//    比 Gap 更有价值：Gap 是"没找到"，Contradiction 是"找到了但互相打架"。
//
//    例：
//      LeanIX evidence claims: [{property:'owner', value:'Team A'}]
//      GitHub evidence claims: [{property:'owner', value:'Team B'}]
//      → 同实体的 owner 属性冲突
// ============================================================

function analyzeContradictions(graph) {
  const contradictions = [];

  for (const entity of graph.entities.values()) {
    // 收集该实体所有 evidence 的 claims
    // property → Map<valueLower, evidenceIds[]>
    const claimsByProperty = new Map();

    for (const evId of entity.evidenceIds) {
      const ev = graph.evidence.get(evId);
      if (!ev || !Array.isArray(ev.claims)) continue;
      for (const claim of ev.claims) {
        if (!claimsByProperty.has(claim.property)) {
          claimsByProperty.set(claim.property, new Map());
        }
        const valueMap = claimsByProperty.get(claim.property);
        const valueKey = String(claim.value).trim().toLowerCase();
        if (!valueMap.has(valueKey)) valueMap.set(valueKey, { value: claim.value, evidenceIds: [], sources: new Set() });
        const entry = valueMap.get(valueKey);
        entry.evidenceIds.push(evId);
        entry.sources.add(ev.source);
      }
    }

    // 同 property 多个不同 value → contradiction
    for (const [property, valueMap] of claimsByProperty) {
      if (valueMap.size > 1) {
        const values = Array.from(valueMap.values()).map((v) => ({
          value: v.value,
          evidenceIds: v.evidenceIds,
          sources: Array.from(v.sources),
        }));
        contradictions.push({
          entityId: entity.id,
          entityName: entity.name,
          entityType: entity.type,
          property,
          values,
          description: `${entity.name} (${entity.type}) has conflicting ${property}: ${values.map((v) => v.value).join(' vs ')}`,
          severity: 'high',
        });
      }
    }
  }

  return contradictions;
}

// ============================================================
// 5. Confidence Assessment（deterministic，基于 Evidence Model）
//
//    评估每个 entity 的可信度：
//      base 0.3
//      + evidence 数量 (cap +0.3)
//      + source 多样性 (cap +0.2)
//      × source 权重 (max source weight 0.4-0.95)
//      + cross validation (多源同值，cap +0.15)
//      - staleness penalty (>365 天，cap -0.2)
//      - contradiction penalty (cap -0.3)
//
//    最终 score → level: high (>=0.7) / medium (>=0.4) / low (<0.4)
// ============================================================

const SOURCE_WEIGHTS = {
  // 权威官方源
  Vendor: 0.9,
  Regulation: 0.95,
  Academic: 0.85,
  // 系统记录（事实型）
  ServiceNow: 0.85,
  LeanIX: 0.85,
  GitHub: 0.8,
  // 协作/工单
  Jira: 0.7,
  Confluence: 0.6,
  Wiki: 0.5,
  // 外部弱信号
  News: 0.4,
  Web: 0.4,
  External: 0.5,
  Default: 0.5,
};

function getSourceWeight(source) {
  return SOURCE_WEIGHTS[source] != null ? SOURCE_WEIGHTS[source] : SOURCE_WEIGHTS.Default;
}

function assessConfidence(graph, entityId) {
  if (entityId) {
    return _assessEntity(graph, entityId);
  }
  // 整体 graph 评估
  const perEntity = {};
  let total = 0;
  let count = 0;
  for (const id of graph.entities.keys()) {
    const r = _assessEntity(graph, id);
    perEntity[id] = { level: r.level, score: r.score };
    total += r.score;
    count++;
  }
  const overall = count > 0 ? total / count : 0;
  return {
    level: _scoreToLevel(overall),
    score: Number(overall.toFixed(3)),
    rationale: _overallRationale(graph, overall),
    perEntity,
  };
}

function _assessEntity(graph, entityId) {
  const entity = graph.entities.get(entityId);
  if (!entity) return { level: 'low', score: 0, rationale: 'Entity not found', factors: {} };

  const evidence = entity.evidenceIds.map((id) => graph.evidence.get(id)).filter(Boolean);
  if (evidence.length === 0) {
    return {
      level: 'low',
      score: 0.1,
      rationale: 'No supporting evidence',
      factors: { evidenceCount: 0, sourceCount: 0, maxSourceWeight: 0, crossValidatedClaims: 0, staleEvidence: 0, contradictions: 0 },
    };
  }

  let score = 0.3; // base

  // Evidence count
  score += Math.min(0.3, evidence.length * 0.1);

  // Source diversity
  const sources = new Set(evidence.map((e) => e.source));
  score += Math.min(0.2, sources.size * 0.1);

  // Source weight (max)
  const maxSourceWeight = Math.max(...evidence.map((e) => getSourceWeight(e.source)));
  score = score * 0.7 + maxSourceWeight * 0.3;

  // Cross validation: same property+value from multiple sources
  const claimMap = new Map(); // key=property|value → Set<source>
  for (const ev of evidence) {
    for (const claim of ev.claims || []) {
      const key = `${claim.property}|${String(claim.value).trim().toLowerCase()}`;
      if (!claimMap.has(key)) claimMap.set(key, new Set());
      claimMap.get(key).add(ev.source);
    }
  }
  let crossValidated = 0;
  for (const srcs of claimMap.values()) {
    if (srcs.size > 1) crossValidated++;
  }
  score += Math.min(0.15, crossValidated * 0.05);

  // Staleness penalty
  const now = Date.now();
  let staleCount = 0;
  for (const ev of evidence) {
    if (ev.lastUpdated) {
      const t = new Date(ev.lastUpdated).getTime();
      if (!Number.isNaN(t)) {
        const ageDays = (now - t) / (1000 * 60 * 60 * 24);
        if (ageDays > 365) staleCount++;
      }
    }
  }
  if (staleCount > 0) score -= Math.min(0.2, staleCount * 0.1);

  // Contradiction penalty
  const contradictions = analyzeContradictions(graph).filter((c) => c.entityId === entityId);
  if (contradictions.length > 0) score -= Math.min(0.3, contradictions.length * 0.15);

  score = Math.max(0, Math.min(1, score));

  return {
    level: _scoreToLevel(score),
    score: Number(score.toFixed(3)),
    rationale: _entityRationale(evidence, staleCount, contradictions.length, crossValidated, maxSourceWeight),
    factors: {
      evidenceCount: evidence.length,
      sourceCount: sources.size,
      maxSourceWeight,
      crossValidatedClaims: crossValidated,
      staleEvidence: staleCount,
      contradictions: contradictions.length,
    },
  };
}

function _scoreToLevel(score) {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

function _entityRationale(evidence, staleCount, contradictionCount, crossValidated, maxSourceWeight) {
  const parts = [];
  parts.push(`${evidence.length} evidence`);
  parts.push(`${new Set(evidence.map((e) => e.source)).size} sources`);
  if (crossValidated > 0) parts.push(`${crossValidated} cross-validated`);
  if (staleCount > 0) parts.push(`${staleCount} stale`);
  if (contradictionCount > 0) parts.push(`${contradictionCount} contradiction${contradictionCount > 1 ? 's' : ''}`);
  parts.push(`max source weight ${maxSourceWeight.toFixed(2)}`);
  return parts.join(', ');
}

function _overallRationale(graph, overall) {
  const contradictions = analyzeContradictions(graph);
  const gaps = analyzeGaps(graph);
  const parts = [];
  parts.push(`avg score ${overall.toFixed(2)}`);
  parts.push(`${graph.entities.size} entities`);
  parts.push(`${graph.evidence.size} evidence`);
  if (contradictions.length > 0) parts.push(`${contradictions.length} contradiction${contradictions.length > 1 ? 's' : ''}`);
  if (gaps.length > 0) parts.push(`${gaps.length} gap${gaps.length > 1 ? 's' : ''}`);
  return parts.join(', ');
}

// ============================================================
// 6. Research Report Schema + Validation
//
//    每个结论必须可追溯到证据。企业最怕："AI 怎么知道的？"
//    Report 包含 8 个 required sections：
//      task, executiveSummary, keyFindings, supportingEvidence,
//      confidence, conflicts, knowledgeGaps, recommendations
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

// 生成报告模板：预填 supportingEvidence + knowledgeGaps + conflicts
function reportTemplate(session) {
  const graph = session.graph;
  const gaps = session.gaps.length ? session.gaps : analyzeGaps(graph);
  const contradictions = session.contradictions.length ? session.contradictions : analyzeContradictions(graph);
  const confidence = session.confidence || assessConfidence(graph);

  return {
    task: session.goal || '',
    executiveSummary: '',
    keyFindings: [],
    supportingEvidence: Array.from(graph.evidence.values()).map((ev) => ({
      evidenceId: ev.id,
      source: ev.source,
      uri: ev.uri,
      summary: ev.content.slice(0, 100),
      confidence: ev.confidence,
      lastUpdated: ev.lastUpdated || '',
    })),
    confidence: {
      overall: confidence.level || '',
      score: confidence.score || 0,
      rationale: confidence.rationale || '',
    },
    conflicts: contradictions.map((c) => ({
      description: c.description,
      entityId: c.entityId,
      property: c.property,
      values: c.values,
      evidenceIds: c.values.flatMap((v) => v.evidenceIds),
      severity: c.severity,
    })),
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
// 7. Mermaid Export
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
// 8. ResearchSession（贯穿全流程的工作上下文 / Research Context）
//
//    v3 核心对象：把所有概念自然串联起来。
//    不引入数据库 / 状态机 / 框架，仅是一个逻辑模型 + JSON 持久化。
//
//    LLM 在每个 Phase 都应调用 session-context 查看"我现在研究到哪里"。
// ============================================================

class ResearchSession {
  constructor(goal) {
    this.goal = goal;
    this.createdAt = new Date().toISOString();
    this.plan = [];              // [{ id, objective, status, createdAt, updatedAt }]
    this.graph = new EvidenceGraph();
    this.findings = [];          // 报告撰写时填充
    this.gaps = [];              // 由 analyze() 计算
    this.contradictions = [];    // 由 analyze() 计算
    this.confidence = null;      // 由 analyze() 计算
    this.report = null;
    this.visitedSources = [];    // [{ source, uri, at }]
    this.pendingQuestions = [];  // LLM 填充
    this.rejectedHypotheses = []; // LLM 填充
    this._planCounter = 0;
  }

  // ----- Plan -----

  addPlanItem({ objective, status = 'pending' }) {
    if (!objective) throw new Error('Plan item objective is required');
    this._planCounter++;
    const id = `p${this._planCounter}`;
    const item = { id, objective, status, createdAt: new Date().toISOString() };
    this.plan.push(item);
    return { id, planItem: item };
  }

  updatePlanItem(id, status) {
    const item = this.plan.find((p) => p.id === id);
    if (!item) throw new Error(`Plan item not found: ${id}`);
    if (!['pending', 'in_progress', 'done', 'skipped'].includes(status)) {
      throw new Error(`Invalid status: ${status}. Valid: pending, in_progress, done, skipped`);
    }
    item.status = status;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  // ----- Visited Sources -----

  recordVisitedSource({ source, uri }) {
    if (!source) throw new Error('Visited source requires --source');
    const uriKey = uri || '';
    if (!this.visitedSources.some((v) => v.source === source && v.uri === uriKey)) {
      this.visitedSources.push({ source, uri: uriKey, at: new Date().toISOString() });
    }
  }

  // ----- Research Context helpers -----

  addPendingQuestion(question) {
    if (!question) throw new Error('Pending question is required');
    if (!this.pendingQuestions.includes(question)) {
      this.pendingQuestions.push(question);
    }
  }

  resolvePendingQuestion(question) {
    const i = this.pendingQuestions.indexOf(question);
    if (i >= 0) this.pendingQuestions.splice(i, 1);
  }

  rejectHypothesis(hypothesis, reason) {
    if (!hypothesis) throw new Error('Hypothesis is required');
    this.rejectedHypotheses.push({ hypothesis, reason: reason || '', at: new Date().toISOString() });
  }

  // ----- Analysis（一次性跑 Gap + Contradiction + Confidence）-----

  analyze() {
    this.gaps = analyzeGaps(this.graph);
    this.contradictions = analyzeContradictions(this.graph);
    this.confidence = assessConfidence(this.graph);
    return {
      gaps: this.gaps,
      contradictions: this.contradictions,
      confidence: this.confidence,
    };
  }

  // ----- Research Context（LLM 判断"研究到哪里"的依据）-----

  context() {
    return {
      goal: this.goal,
      planProgress: {
        total: this.plan.length,
        done: this.plan.filter((p) => p.status === 'done').length,
        inProgress: this.plan.filter((p) => p.status === 'in_progress').length,
        pending: this.plan.filter((p) => p.status === 'pending').length,
        skipped: this.plan.filter((p) => p.status === 'skipped').length,
      },
      graph: this.graph.stats(),
      openGaps: this.gaps.length,
      openContradictions: this.contradictions.length,
      confidence: this.confidence ? this.confidence.level : 'unassessed',
      pendingQuestions: this.pendingQuestions.length,
      rejectedHypotheses: this.rejectedHypotheses.length,
      visitedSources: this.visitedSources.length,
      hasReport: !!this.report,
    };
  }

  // ----- Serialization -----

  toJSON() {
    return {
      goal: this.goal,
      createdAt: this.createdAt,
      plan: this.plan,
      graph: this.graph.toJSON(),
      findings: this.findings,
      gaps: this.gaps,
      contradictions: this.contradictions,
      confidence: this.confidence,
      report: this.report,
      visitedSources: this.visitedSources,
      pendingQuestions: this.pendingQuestions,
      rejectedHypotheses: this.rejectedHypotheses,
      _planCounter: this._planCounter,
    };
  }

  static fromJSON(data) {
    const s = new ResearchSession(data.goal);
    s.createdAt = data.createdAt;
    s.plan = data.plan || [];
    s.graph = EvidenceGraph.fromJSON(data.graph || {});
    s.findings = data.findings || [];
    s.gaps = data.gaps || [];
    s.contradictions = data.contradictions || [];
    s.confidence = data.confidence || null;
    s.report = data.report || null;
    s.visitedSources = data.visitedSources || [];
    s.pendingQuestions = data.pendingQuestions || [];
    s.rejectedHypotheses = data.rejectedHypotheses || [];
    s._planCounter = data._planCounter || 0;
    return s;
  }
}

// ============================================================
// 9. Persistence
// ============================================================

function saveSession(session, file) {
  fs.writeFileSync(file, JSON.stringify(session.toJSON(), null, 2));
}

function loadSession(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Session file not found: ${file}. Run 'init' first.`);
  }
  return ResearchSession.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// ============================================================
// 10. CLI
// ============================================================

function printUsage() {
  console.log(`
Usage: node research.mjs <command> [options]

Enterprise Research Agent — Evidence-driven research machinery.
Research = Investigation + Analysis. ResearchSession is the working context.

Commands:
  init --goal <name> [--session <file>]                          Initialize new research session
  session-status [--session <file>]                              Show full session context (goal, plan, graph, analysis)
  session-context [--session <file>]                             Output Research Context as JSON (for LLM self-check)

  add-plan-item --objective <text> [--session <file>]            Add investigation sub-task to plan
  update-plan-item --id <id> --status <status> [--session <file>] Update plan item status
  record-source --source <S> [--uri <U>] [--session <file>]      Record visited Connector Adapter source
  add-pending-question <text> [--session <file>]                 Add open question to research context
  reject-hypothesis --hypothesis <text> [--reason <text>] [--session <file>]
                                                                  Record rejected hypothesis

  list-ontology [--type <T>]                                     List entity types and relations
  add-entity --type <T> --name <N> [--aliases a,b] [--summary ...] [--props k=v,...] [--session <file>]
  find-entity <name> [--session <file>]                          Find entity by name or alias
  list-entities [--type <T>] [--session <file>]

  add-evidence --source <S> [--uri <U>] [--content <C>] [--confidence 0.5]
                [--last-updated <ISO date>] [--claims prop=val,...] [--session <file>]
  link-evidence --entity <id> --evidence <id> [--session <file>]
  add-relationship --from <id> --to <id> --type <T> [--confidence 0.5] [--evidence ev1,ev2] [--session <file>]
  resolve-identity --canonical <id> --aliases <id1,id2> [--session <file>]

  analyze [--session <file>]                                     Run Gap + Contradiction + Confidence together
  analyze-gaps [--session <file>]                                Compute gaps based on Ontology
  analyze-contradictions [--session <file>]                      Detect contradictions based on claims
  assess-confidence [--entity <id>] [--session <file>]           Assess confidence (per entity or overall)

  show-graph [--session <file>] [--max-nodes 50]                 Output Mermaid flowchart
  report-template [--output <file>] [--session <file>]           Generate report template (pre-fills evidence + gaps + conflicts)
  validate-report --report <file> [--session <file>]             Validate report schema

Options:
  --session <file>     Session file path (default: ./research-session.json)
  --goal <name>        Research goal (for init)
  --objective <text>   Plan item objective
  --status <status>    Plan item status: pending | in_progress | done | skipped
  --type <T>           Entity type (Vendor, Application, Repository, Team, Person, Project,
                       Capability, BusinessProcess, Regulation, Control, Incident, Risk, Contract, Document)
  --name <N>           Entity name
  --aliases <list>     Comma-separated aliases
  --summary <text>     Entity summary
  --props <list>       Comma-separated key=value properties
  --source <S>         Connector Adapter source (Confluence, GitHub, Jira, LeanIX, ServiceNow,
                       Vendor, Regulation, External, News, Academic, Web, ...)
  --uri <U>            Evidence URI
  --content <C>        Evidence content
  --confidence <n>     Confidence 0-1 (default 0.5)
  --last-updated <d>   Source last-updated ISO date (for Freshness assessment)
  --claims <list>      Comma-separated property=value claims (for Contradiction Detection)
  --from <id>          Source entity ID
  --to <id>            Target entity ID
  --evidence <list>    Comma-separated evidence IDs
  --canonical <id>     Canonical entity ID (for resolve-identity)
  --hypothesis <text>  Hypothesis text (for reject-hypothesis)
  --reason <text>      Rejection reason
  --output <file>      Output file path
  --max-nodes <n>      Max nodes for Mermaid export (default 50)
  --help, -h           Show this help

Examples:
  node research.mjs init --goal "Research RiskConcile"
  node research.mjs add-plan-item --objective "Identify vendor background"
  node research.mjs add-entity --type Vendor --name "RiskConcile" --aliases "RC,riskconcile-api" --props "website=https://riskconcile.com"
  node research.mjs add-evidence --source GitHub --uri "https://github.com/org/riskconcile-api" \\
    --content "Repo exists, 142 commits" --confidence 0.95 --last-updated 2025-09-12 \\
    --claims "owner=Team A,status=active"
  node research.mjs add-evidence --source LeanIX --uri "leanix/app/RC" \\
    --content "App registered" --confidence 0.85 --claims "owner=Team B"
  node research.mjs link-evidence --entity e1 --evidence ev1
  node research.mjs add-relationship --from e1 --to e2 --type used_by --evidence ev1
  node research.mjs resolve-identity --canonical e1 --aliases e2,e3
  node research.mjs analyze                  # runs Gap + Contradiction + Confidence
  node research.mjs analyze-contradictions   # detects conflicting owner: Team A vs Team B
  node research.mjs assess-confidence        # overall confidence with factors
  node research.mjs session-context          # JSON snapshot for LLM self-check
  node research.mjs report-template --output report.json
  node research.mjs validate-report --report report.json
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

function parseClaims(s) {
  if (!s) return [];
  return parseList(s).map((pair) => {
    const [prop, ...rest] = pair.split('=');
    return { property: prop.trim(), value: rest.join('=').trim() };
  });
}

function getSessionFile(argv) {
  const i = argv.indexOf('--session');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : './research-session.json';
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
  const sessionFile = getSessionFile(argv);

  try {
    switch (command) {
      case 'init': {
        const goal = argValue(argv, '--goal') || 'Untitled Research';
        const s = new ResearchSession(goal);
        saveSession(s, sessionFile);
        console.log(`✓ Initialized research session: "${goal}"`);
        console.log(`  Session: ${sessionFile}`);
        break;
      }

      case 'session-status': {
        const s = loadSession(sessionFile);
        const ctx = s.context();
        console.log(`Goal:          ${ctx.goal}`);
        console.log(`Created:       ${s.createdAt}`);
        console.log(``);
        console.log(`Plan:          ${ctx.planProgress.total} items ` +
          `(done=${ctx.planProgress.done}, in_progress=${ctx.planProgress.inProgress}, ` +
          `pending=${ctx.planProgress.pending}, skipped=${ctx.planProgress.skipped})`);
        for (const p of s.plan) {
          const icon = p.status === 'done' ? '✓' : p.status === 'in_progress' ? '›' : p.status === 'skipped' ? '×' : '·';
          console.log(`  ${icon} ${p.id}: ${p.objective} [${p.status}]`);
        }
        console.log(``);
        console.log(`Graph:`);
        console.log(`  Entities:       ${ctx.graph.entityCount}`);
        console.log(`  Evidence:       ${ctx.graph.evidenceCount}`);
        console.log(`  Relationships:  ${ctx.graph.relationshipCount}`);
        const types = Object.entries(ctx.graph.entityTypes || {}).map(([k, v]) => `${k}=${v}`).join(', ');
        if (types) console.log(`  By type:        ${types}`);
        console.log(``);
        console.log(`Analysis:`);
        console.log(`  Gaps:           ${ctx.openGaps}`);
        console.log(`  Contradictions: ${ctx.openContradictions}`);
        console.log(`  Confidence:     ${ctx.confidence}${s.confidence ? ` (score=${s.confidence.score})` : ''}`);
        console.log(``);
        console.log(`Context:`);
        console.log(`  Visited sources:     ${ctx.visitedSources}`);
        console.log(`  Pending questions:   ${ctx.pendingQuestions}`);
        console.log(`  Rejected hypotheses: ${ctx.rejectedHypotheses}`);
        console.log(`  Has report:          ${ctx.hasReport}`);
        break;
      }

      case 'session-context': {
        const s = loadSession(sessionFile);
        console.log(JSON.stringify(s.context(), null, 2));
        break;
      }

      case 'add-plan-item': {
        const s = loadSession(sessionFile);
        const objective = argValue(argv, '--objective');
        if (!objective) {
          console.error('Error: --objective is required');
          process.exit(1);
        }
        const result = s.addPlanItem({ objective });
        saveSession(s, sessionFile);
        console.log(`✓ Added plan item ${result.id}: ${objective}`);
        break;
      }

      case 'update-plan-item': {
        const s = loadSession(sessionFile);
        const id = argValue(argv, '--id');
        const status = argValue(argv, '--status');
        if (!id || !status) {
          console.error('Error: --id and --status are required');
          process.exit(1);
        }
        s.updatePlanItem(id, status);
        saveSession(s, sessionFile);
        console.log(`✓ Updated ${id} → ${status}`);
        break;
      }

      case 'record-source': {
        const s = loadSession(sessionFile);
        const source = argValue(argv, '--source');
        const uri = argValue(argv, '--uri') || '';
        if (!source) {
          console.error('Error: --source is required');
          process.exit(1);
        }
        s.recordVisitedSource({ source, uri });
        saveSession(s, sessionFile);
        console.log(`✓ Recorded visited source: ${source}${uri ? ` (${uri})` : ''}`);
        break;
      }

      case 'add-pending-question': {
        const s = loadSession(sessionFile);
        const q = argv.slice(1).join(' ').trim();
        if (!q || q.startsWith('--')) {
          console.error('Error: question text is required (positional argument)');
          process.exit(1);
        }
        s.addPendingQuestion(q);
        saveSession(s, sessionFile);
        console.log(`✓ Added pending question: ${q}`);
        break;
      }

      case 'reject-hypothesis': {
        const s = loadSession(sessionFile);
        const hypothesis = argValue(argv, '--hypothesis');
        const reason = argValue(argv, '--reason') || '';
        if (!hypothesis) {
          console.error('Error: --hypothesis is required');
          process.exit(1);
        }
        s.rejectHypothesis(hypothesis, reason);
        saveSession(s, sessionFile);
        console.log(`✓ Rejected hypothesis: ${hypothesis}`);
        if (reason) console.log(`  Reason: ${reason}`);
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
        const s = loadSession(sessionFile);
        const type = argValue(argv, '--type');
        const name = argValue(argv, '--name');
        const aliases = parseList(argValue(argv, '--aliases'));
        const summary = argValue(argv, '--summary') || '';
        const props = parseProps(argValue(argv, '--props'));
        if (!type || !name) {
          console.error('Error: --type and --name are required');
          process.exit(1);
        }
        const result = s.graph.addEntity({ type, name, aliases, summary, properties: props });
        saveSession(s, sessionFile);
        if (result.merged) {
          console.log(`✓ Merged into existing entity ${result.id} (${result.entity.type}: ${result.entity.name})`);
        } else {
          console.log(`✓ Added entity ${result.id}: ${type} "${name}"`);
          if (aliases.length) console.log(`  Aliases: ${aliases.join(', ')}`);
        }
        break;
      }

      case 'find-entity': {
        const s = loadSession(sessionFile);
        const name = argv[1];
        if (!name) {
          console.error('Error: name is required (positional argument)');
          process.exit(1);
        }
        const e = s.graph.findEntity(name);
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
        const s = loadSession(sessionFile);
        const type = argValue(argv, '--type');
        const entities = s.graph.listEntities({ type });
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
        const s = loadSession(sessionFile);
        const source = argValue(argv, '--source');
        const uri = argValue(argv, '--uri');
        const content = argValue(argv, '--content');
        const confidence = parseFloat(argValue(argv, '--confidence') || '0.5');
        const lastUpdated = argValue(argv, '--last-updated') || '';
        const claims = parseClaims(argValue(argv, '--claims'));
        if (!source) {
          console.error('Error: --source is required');
          process.exit(1);
        }
        const ev = s.graph.addEvidence({ source, uri, content, confidence, lastUpdated, claims });
        saveSession(s, sessionFile);
        console.log(`✓ Added evidence ${ev.id}: source=${source}, confidence=${confidence}` +
          (lastUpdated ? `, lastUpdated=${lastUpdated}` : '') +
          (claims.length ? `, claims=${claims.length}` : ''));
        break;
      }

      case 'link-evidence': {
        const s = loadSession(sessionFile);
        const entityId = argValue(argv, '--entity');
        const evidenceId = argValue(argv, '--evidence');
        if (!entityId || !evidenceId) {
          console.error('Error: --entity and --evidence are required');
          process.exit(1);
        }
        s.graph.linkEvidence({ entityId, evidenceId });
        saveSession(s, sessionFile);
        console.log(`✓ Linked ${evidenceId} to ${entityId}`);
        break;
      }

      case 'add-relationship': {
        const s = loadSession(sessionFile);
        const from = argValue(argv, '--from');
        const to = argValue(argv, '--to');
        const type = argValue(argv, '--type');
        const confidence = parseFloat(argValue(argv, '--confidence') || '0.5');
        const evidenceIds = parseList(argValue(argv, '--evidence'));
        if (!from || !to || !type) {
          console.error('Error: --from, --to, --type are required');
          process.exit(1);
        }
        const result = s.graph.addRelationship({ from, to, type, confidence, evidence: evidenceIds });
        saveSession(s, sessionFile);
        if (result.merged) {
          console.log(`✓ Merged into existing relationship ${result.id} (${from} -[${type}]-> ${to})`);
        } else {
          console.log(`✓ Added relationship ${result.id}: ${from} -[${type}]-> ${to}`);
        }
        break;
      }

      case 'resolve-identity': {
        const s = loadSession(sessionFile);
        const canonicalId = argValue(argv, '--canonical');
        const aliasIds = parseList(argValue(argv, '--aliases'));
        if (!canonicalId || !aliasIds.length) {
          console.error('Error: --canonical and --aliases are required');
          process.exit(1);
        }
        const result = s.graph.resolveIdentity({ canonicalId, aliasIds });
        saveSession(s, sessionFile);
        console.log(`✓ Resolved identity: canonical=${canonicalId}`);
        if (result.mergedIds.length) console.log(`  Merged: ${result.mergedIds.join(', ')}`);
        if (result.errors.length) {
          console.log(`  Errors:`);
          for (const e of result.errors) console.log(`    ${e}`);
        }
        break;
      }

      case 'analyze': {
        const s = loadSession(sessionFile);
        const result = s.analyze();
        saveSession(s, sessionFile);
        console.log(`✓ Analysis complete:\n`);
        console.log(`  Gaps:           ${result.gaps.length}`);
        console.log(`  Contradictions: ${result.contradictions.length}`);
        console.log(`  Confidence:     ${result.confidence.level} (score=${result.confidence.score})`);
        console.log(`  Rationale:      ${result.confidence.rationale}`);
        break;
      }

      case 'analyze-gaps': {
        const s = loadSession(sessionFile);
        const gaps = analyzeGaps(s.graph);
        s.gaps = gaps;
        saveSession(s, sessionFile);
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

      case 'analyze-contradictions': {
        const s = loadSession(sessionFile);
        const contradictions = analyzeContradictions(s.graph);
        s.contradictions = contradictions;
        saveSession(s, sessionFile);
        if (contradictions.length === 0) {
          console.log('✓ No contradictions detected');
          break;
        }
        console.log(`Found ${contradictions.length} contradiction(s):\n`);
        for (const c of contradictions) {
          console.log(`  ⚠ ${c.entityId} (${c.entityName}) [${c.entityType}]`);
          console.log(`    property: ${c.property}`);
          for (const v of c.values) {
            console.log(`    value:    "${v.value}" (evidence: ${v.evidenceIds.join(', ')}; sources: ${v.sources.join(', ')})`);
          }
          console.log(`    severity: ${c.severity}`);
          console.log('');
        }
        break;
      }

      case 'assess-confidence': {
        const s = loadSession(sessionFile);
        const entityId = argValue(argv, '--entity');
        const result = assessConfidence(s.graph, entityId);
        s.confidence = entityId ? s.confidence : result;
        saveSession(s, sessionFile);

        if (entityId) {
          const entity = s.graph.getEntity(entityId);
          console.log(`Confidence for ${entityId} (${entity ? entity.name : '?'}): ${result.level} (score=${result.score})`);
          console.log(`  Rationale: ${result.rationale}`);
          console.log(`  Factors:`);
          for (const [k, v] of Object.entries(result.factors)) {
            console.log(`    ${k}: ${v}`);
          }
        } else {
          console.log(`Overall Confidence: ${result.level} (score=${result.score})`);
          console.log(`  Rationale: ${result.rationale}`);
          console.log(`\nPer-entity:`);
          for (const [id, info] of Object.entries(result.perEntity)) {
            const entity = s.graph.getEntity(id);
            const name = entity ? entity.name : '?';
            console.log(`  ${id} (${name})`.padEnd(35) + ` ${info.level.padEnd(7)} (${info.score})`);
          }
        }
        break;
      }

      case 'show-graph': {
        const s = loadSession(sessionFile);
        const maxNodes = parseInt(argValue(argv, '--max-nodes') || '50', 10);
        console.log(graphToMermaid(s.graph, { maxNodes }));
        break;
      }

      case 'report-template': {
        const s = loadSession(sessionFile);
        // 确保 analysis 已跑过
        if (!s.gaps.length && !s.contradictions.length && !s.confidence) {
          s.analyze();
        }
        const template = reportTemplate(s);
        const outputPath = argValue(argv, '--output');
        const json = JSON.stringify(template, null, 2);
        if (outputPath) {
          fs.writeFileSync(outputPath, json);
          console.log(`✓ Report template written to ${outputPath}`);
          console.log(`  Pre-filled: ${template.supportingEvidence.length} evidence, ` +
            `${template.conflicts.length} conflicts, ${template.knowledgeGaps.length} gaps`);
        } else {
          console.log(json);
        }
        break;
      }

      case 'validate-report': {
        const s = loadSession(sessionFile);
        const reportFile = argValue(argv, '--report');
        if (!reportFile) {
          console.error('Error: --report is required');
          process.exit(1);
        }
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        const result = validateReport(report, s.graph);
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

// Exports for programmatic use
export {
  ONTOLOGY,
  SOURCE_WEIGHTS,
  EvidenceGraph,
  ResearchSession,
  analyzeGaps,
  analyzeContradictions,
  assessConfidence,
  validateReport,
  reportTemplate,
  graphToMermaid,
  saveSession,
  loadSession,
  validateRelation,
  validateEntityType,
  getSourceWeight,
};
