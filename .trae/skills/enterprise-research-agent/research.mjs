#!/usr/bin/env node
/**
 * Enterprise Research Agent — ResearchSession Machinery (single-file)
 *
 * 设计：Research = Investigation + Analysis，由 Question Tree + Decision Loop 驱动
 *   - Investigation: 收集 Evidence, 建立 Canonical Identity, 形成 Evidence Graph
 *   - Analysis: 发现 Gap, 检测 Contradiction, 评估 Confidence, 形成 Finding
 *   - Question Tree: 由 Evidence 驱动动态生长，受 Ontology + Budget 约束
 *   - Decision Loop: 确定性判断 Continue / Finish（Expand-Converge 模型）
 *   - Claim Model: 结论作为一等对象，分类型管理（Fact/Statistic/Analysis/...）
 *   - Traceability: 每条 Claim 必须可追溯到 Evidence + Source，Claim Coverage Ratio ≥ 0.9
 *
 * Core Objects:
 *   - ResearchSession: 贯穿全流程的工作上下文（Research Context）
 *     { goal, contract, budget, plan, questionTree, graph, claims,
 *       findings, gaps, contradictions, confidence, report,
 *       visitedSources, pendingQuestions, rejectedHypotheses, _lastSnapshot }
 *   - ResearchContract: 用户确认的研究契约 { question, scope, expectedOutput, evidenceRequirement }
 *   - ResearchBudget: 研究预算 { depth, maxQuestions, maxEvidence, timeLimitMinutes }
 *   - QuestionTree: 动态问题树（Evidence-driven, Ontology-guided, Budget-aware）
 *   - ClaimStore: Claim 一等对象存储（type + evidenceIds + reasoning + verified）
 *   - EvidenceGraph: Working Memory（entities + relationships + evidence + aliases）
 *   - Evidence: 可追溯单元 { source, uri, content, confidence, lastUpdated, claims, metadata }
 *   - Canonical Identity: aliases 合并到统一实体
 *   - Contradiction: 同一实体的同一属性出现冲突值（基于 claims 检测）
 *   - Confidence: high/medium/low，基于 evidence 数量 / source 权重 / cross validation / freshness
 *
 * Workflow (Expand-Converge):
 *   Question → Contract → Planning + Budget + Root Questions
 *            ↻ Evidence Collection → Identity → Correlation → Question Generation → Decision
 *            → Analysis (Gap + Contradiction + Confidence + Claim Coverage)
 *            → External Verification → Report (with Traceability Layer)
 *
 * 设计原则（Research Heuristics）：
 *   - Goal-driven: 所有子问题必须服务于研究目标
 *   - Evidence-driven: 新问题必须由已有证据触发
 *   - Ontology-guided: 只沿领域模型允许的关系扩展
 *   - Novelty-seeking: 优先探索能带来新 Entity/Relationship/Conflict/Gap 的方向
 *   - Budget-aware: 受 depth / maxQuestions / maxEvidence / time 约束
 *   - Confidence-driven: 关键结论置信度不足时优先补证据
 *
 * Research Rules（硬约束）：
 *   - 不创建无证据支撑的 fact/statistic/historical/expert_opinion claim
 *   - 每条 fact 必须有 claim_id + evidence_id + source_id
 *   - 证据不足时标注为 hypothesis，不写为结论
 *   - 不隐藏冲突证据
 *   - 每个来源必须可检索（uri 非空）
 *   - 区分 observed / inference / recommendation
 *
 * 不做：
 *   - 完整 Knowledge Graph / OWL / RDF / SPARQL
 *   - Multi-Agent 框架强调
 *   - DSL Rule Language
 *   - SQLite / Neo4j 持久化（仅 JSON）
 *   - 独立 Verification Agent（由 LLM 自检 + Claim Coverage 校验承担）
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
      for (const a of aliases) {
        if (!existing.aliases.includes(a)) existing.aliases.push(a);
        this._registerAlias(a, existingByName);
      }
      existing.properties = { ...existing.properties, ...properties };
      if (summary && !existing.summary) existing.summary = summary;
      return { id: existingByName, entity: existing, merged: true };
    }

    for (const alias of aliases) {
      const existingByAlias = this._findEntityIdByNameOrAlias(alias);
      if (existingByAlias) {
        const existing = this.entities.get(existingByAlias);
        if (!existing.aliases.includes(name)) existing.aliases.push(name);
        this._registerAlias(name, existingByAlias);
        for (const a of aliases) {
          if (!existing.aliases.includes(a)) existing.aliases.push(a);
          this._registerAlias(a, existingByAlias);
        }
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

  addEvidence({ source, uri, content, confidence = 0.5, lastUpdated, extractedAt, claims = [], metadata = {}, sourceMetadata = null }) {
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
      sourceMetadata: sourceMetadata || null,
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
// 3. Research Contract & Budget
//
//    Research Contract：用户确认研究范围与证据要求，避免 Agent 跑偏。
//    Research Budget：限制 depth / maxQuestions / maxEvidence / time，防止无限发散。
//
//    Contract 不是配置文件，是 Agent 与用户的"研究契约"——
//    Agent 必须先 set-contract，让用户确认后再开始研究。
// ============================================================

const DEFAULT_BUDGET = {
  depth: 3,              // Question Tree 最大深度
  maxQuestions: 40,      // Question Tree 节点数上限
  maxEvidence: 300,      // Evidence 总数上限
  timeLimitMinutes: 8,   // 时间预算（分钟）
};

const DEFAULT_EVIDENCE_REQUIREMENT = {
  minSources: 3,                  // 最少独立 source 数
  primarySourceRatio: 0.6,        // 主源占比（Vendor / Regulation / Academic / 官方文档）
  claimCoverageRatio: 0.9,        // Claim Coverage Ratio 下限
};

function createContract({ question, scope = {}, expectedOutput = {}, evidenceRequirement = {} }) {
  if (!question || !question.trim()) {
    throw new Error('Contract question is required');
  }
  return {
    question: question.trim(),
    scope: scope || {},
    expectedOutput: {
      type: (expectedOutput && expectedOutput.type) || 'research_report',
      ...(expectedOutput || {}),
    },
    evidenceRequirement: {
      ...DEFAULT_EVIDENCE_REQUIREMENT,
      ...evidenceRequirement,
    },
    createdAt: new Date().toISOString(),
    confirmedAt: null, // 用户确认后由 LLM 通过 set-contract --confirm 写入
  };
}

function createBudget({ depth, maxQuestions, maxEvidence, timeLimitMinutes } = {}) {
  const b = {
    depth: depth != null ? Number(depth) : DEFAULT_BUDGET.depth,
    maxQuestions: maxQuestions != null ? Number(maxQuestions) : DEFAULT_BUDGET.maxQuestions,
    maxEvidence: maxEvidence != null ? Number(maxEvidence) : DEFAULT_BUDGET.maxEvidence,
    timeLimitMinutes: timeLimitMinutes != null ? Number(timeLimitMinutes) : DEFAULT_BUDGET.timeLimitMinutes,
  };
  if (b.depth < 1) throw new Error('budget.depth must be >= 1');
  if (b.maxQuestions < 1) throw new Error('budget.maxQuestions must be >= 1');
  if (b.maxEvidence < 1) throw new Error('budget.maxEvidence must be >= 1');
  if (b.timeLimitMinutes < 1) throw new Error('budget.timeLimitMinutes must be >= 1');
  return b;
}

// 检查预算使用情况：返回 { withinBudget, usage, reasons[] }
//    session 必须有 graph / questionTree / createdAt
function checkBudget(session) {
  const b = session.budget || DEFAULT_BUDGET;
  const reasons = [];
  const usage = {
    depth: session.questionTree ? session.questionTree.maxDepth() : 0,
    questions: session.questionTree ? session.questionTree.questions.size : 0,
    evidence: session.graph ? session.graph.evidence.size : 0,
    elapsedMinutes: session.createdAt
      ? (Date.now() - new Date(session.createdAt).getTime()) / 60000
      : 0,
  };

  if (usage.depth >= b.depth) reasons.push(`depth ${usage.depth} >= ${b.depth}`);
  if (usage.questions >= b.maxQuestions) reasons.push(`questions ${usage.questions} >= ${b.maxQuestions}`);
  if (usage.evidence >= b.maxEvidence) reasons.push(`evidence ${usage.evidence} >= ${b.maxEvidence}`);
  if (usage.elapsedMinutes >= b.timeLimitMinutes) {
    reasons.push(`time ${usage.elapsedMinutes.toFixed(1)}min >= ${b.timeLimitMinutes}min`);
  }

  return {
    withinBudget: reasons.length === 0,
    usage,
    limit: { ...b },
    reasons,
  };
}

// ============================================================
// 4. Research Question Tree（Evidence-driven 动态生长）
//
//    不是一次性规划，而是 Evidence-driven 动态生长。
//    每条新 Evidence 可触发新 Question；每个新 Question 受 Ontology + Budget 约束。
//
//    Question 字段：
//      - id, text, parentId, depth, status
//      - triggeredByEvidenceId / triggeredByEntityId  ← Evidence-driven 的体现
//      - planItemId                                      ← 与 plan 关联（plan 是骨架，QuestionTree 是活的）
//      - generatedEntityIds / generatedRelationshipIds  ← 答案产出
//      - createdAt / updatedAt
//
//    status: open → investigating → answered | pruned
// ============================================================

const QUESTION_STATUS = ['open', 'investigating', 'answered', 'pruned'];

class QuestionTree {
  constructor() {
    this.questions = new Map(); // id → question
    this._counter = 0;
  }

  addQuestion({ text, parentId = null, triggeredByEvidenceId = null, triggeredByEntityId = null, planItemId = null }) {
    if (!text || !text.trim()) throw new Error('Question text is required');

    let depth = 0;
    if (parentId) {
      const parent = this.questions.get(parentId);
      if (!parent) throw new Error(`Parent question not found: ${parentId}`);
      depth = parent.depth + 1;
    }

    this._counter++;
    const id = `q${this._counter}`;
    const q = {
      id,
      text: text.trim(),
      parentId,
      depth,
      status: 'open',
      triggeredByEvidenceId: triggeredByEvidenceId || null,
      triggeredByEntityId: triggeredByEntityId || null,
      planItemId: planItemId || null,
      generatedEntityIds: [],
      generatedRelationshipIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    this.questions.set(id, q);
    return { id, question: q };
  }

  updateQuestion(id, { status, generatedEntityIds, generatedRelationshipIds }) {
    const q = this.questions.get(id);
    if (!q) throw new Error(`Question not found: ${id}`);
    if (status != null) {
      if (!QUESTION_STATUS.includes(status)) {
        throw new Error(`Invalid status: ${status}. Valid: ${QUESTION_STATUS.join(', ')}`);
      }
      q.status = status;
    }
    if (generatedEntityIds != null) {
      for (const eid of generatedEntityIds) {
        if (!q.generatedEntityIds.includes(eid)) q.generatedEntityIds.push(eid);
      }
    }
    if (generatedRelationshipIds != null) {
      for (const rid of generatedRelationshipIds) {
        if (!q.generatedRelationshipIds.includes(rid)) q.generatedRelationshipIds.push(rid);
      }
    }
    q.updatedAt = new Date().toISOString();
    return q;
  }

  getQuestion(id) {
    return this.questions.get(id) || null;
  }

  listQuestions({ status, parentId } = {}) {
    let all = Array.from(this.questions.values());
    if (status) all = all.filter((q) => q.status === status);
    if (parentId !== undefined) all = all.filter((q) => q.parentId === parentId);
    return all;
  }

  maxDepth() {
    let max = 0;
    for (const q of this.questions.values()) {
      if (q.depth > max) max = q.depth;
    }
    return max;
  }

  stats() {
    const byStatus = { open: 0, investigating: 0, answered: 0, pruned: 0 };
    for (const q of this.questions.values()) byStatus[q.status] = (byStatus[q.status] || 0) + 1;
    return {
      total: this.questions.size,
      ...byStatus,
      maxDepth: this.maxDepth(),
    };
  }

  toJSON() {
    return {
      questions: Array.from(this.questions.values()),
      counter: this._counter,
    };
  }

  static fromJSON(data) {
    const t = new QuestionTree();
    t._counter = (data && data.counter) || 0;
    for (const q of (data && data.questions) || []) t.questions.set(q.id, q);
    return t;
  }
}

// ============================================================
// 5. Claim Model（分类型管理）
//
//    Claim 是 Research Report 的最小结论单元，比 Evidence 更接近"判断"。
//    每条 Claim 必须可追溯到 Evidence + Source；类型决定证据要求。
//
//    类型与证据要求：
//      fact / statistic / historical / expert_opinion → 必须有 evidenceIds
//      analysis                                          → 必须有 evidenceIds + reasoning
//      recommendation                                    → 必须有 reasoning
//
//    Claim Coverage Ratio = (Claims with Evidence) / Total Claims
//      目标 ≥ 0.9（由 contract.evidenceRequirement.claimCoverageRatio 配置）
// ============================================================

const CLAIM_TYPES = ['fact', 'statistic', 'historical', 'expert_opinion', 'analysis', 'recommendation'];

const CLAIM_EVIDENCE_REQUIREMENTS = {
  fact: { requiresEvidence: true, requiresReasoning: false },
  statistic: { requiresEvidence: true, requiresReasoning: false },
  historical: { requiresEvidence: true, requiresReasoning: false },
  expert_opinion: { requiresEvidence: true, requiresReasoning: false },
  analysis: { requiresEvidence: true, requiresReasoning: true },
  recommendation: { requiresEvidence: false, requiresReasoning: true },
};

class ClaimStore {
  constructor() {
    this.claims = new Map(); // id → claim
    this._counter = 0;
  }

  addClaim({ text, type, evidenceIds = [], reasoning = '', confidence = 0.5, supportingClaimIds = [], entityId = null }) {
    if (!text || !text.trim()) throw new Error('Claim text is required');
    if (!CLAIM_TYPES.includes(type)) {
      throw new Error(`Invalid claim type: ${type}. Valid: ${CLAIM_TYPES.join(', ')}`);
    }
    const req = CLAIM_EVIDENCE_REQUIREMENTS[type];
    if (req.requiresEvidence && (!evidenceIds || evidenceIds.length === 0)) {
      throw new Error(`Claim of type "${type}" requires at least one evidenceId`);
    }
    if (req.requiresReasoning && (!reasoning || !reasoning.trim())) {
      throw new Error(`Claim of type "${type}" requires reasoning`);
    }

    this._counter++;
    const id = `c${this._counter}`;
    const claim = {
      id,
      text: text.trim(),
      type,
      evidenceIds: [...evidenceIds],
      reasoning: reasoning || '',
      confidence,
      supportingClaimIds: [...supportingClaimIds],
      entityId: entityId || null,
      verified: false,
      verificationNote: '',
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    this.claims.set(id, claim);
    return { id, claim };
  }

  verifyClaim(id, { verified = true, note = '' } = {}) {
    const c = this.claims.get(id);
    if (!c) throw new Error(`Claim not found: ${id}`);
    c.verified = !!verified;
    c.verificationNote = note || c.verificationNote;
    c.updatedAt = new Date().toISOString();
    return c;
  }

  linkEvidence(id, evidenceIds) {
    const c = this.claims.get(id);
    if (!c) throw new Error(`Claim not found: ${id}`);
    if (!Array.isArray(evidenceIds)) evidenceIds = [evidenceIds];
    for (const evId of evidenceIds) {
      if (!c.evidenceIds.includes(evId)) c.evidenceIds.push(evId);
    }
    c.updatedAt = new Date().toISOString();
    return c;
  }

  getClaim(id) {
    return this.claims.get(id) || null;
  }

  listClaims({ type, verified } = {}) {
    let all = Array.from(this.claims.values());
    if (type) all = all.filter((c) => c.type === type);
    if (verified === true) all = all.filter((c) => c.verified);
    if (verified === false) all = all.filter((c) => !c.verified);
    return all;
  }

  // Claim Coverage Ratio = claims with evidence / total claims
  coverage() {
    const all = Array.from(this.claims.values());
    if (all.length === 0) {
      return {
        total: 0,
        withEvidence: 0,
        verified: 0,
        coverageRatio: 1.0,
        verifiedRatio: 1.0,
        unverifiedClaimIds: [],
      };
    }
    const withEvidence = all.filter((c) => c.evidenceIds.length > 0);
    const verified = all.filter((c) => c.verified);
    return {
      total: all.length,
      withEvidence: withEvidence.length,
      verified: verified.length,
      coverageRatio: Number((withEvidence.length / all.length).toFixed(3)),
      verifiedRatio: Number((verified.length / all.length).toFixed(3)),
      unverifiedClaimIds: all.filter((c) => !c.verified).map((c) => c.id),
    };
  }

  toJSON() {
    return {
      claims: Array.from(this.claims.values()),
      counter: this._counter,
    };
  }

  static fromJSON(data) {
    const s = new ClaimStore();
    s._counter = (data && data.counter) || 0;
    for (const c of (data && data.claims) || []) s.claims.set(c.id, c);
    return s;
  }
}

// ============================================================
// 6. Gap Analysis（deterministic，基于 Ontology）
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

function _alternativeInterpretationsForProperty(property) {
  const map = {
    owner: ['Different systems use different ownership definitions', 'Team reassignment is in progress', 'Data synchronization delay'],
    lifecycle: ['Different environments have different statuses', 'Legacy data not updated'],
    criticality: ['Business criticality differs from technical criticality', 'Assessment is context-dependent'],
    headquarters: ['Subsidiary vs parent company location', 'Remote-first workforce'],
    category: ['Vendor category differs by procurement system', 'Product line classification mismatch'],
  };
  return map[property] || ['Sources may define this property differently', 'Further investigation needed'];
}

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
          alternativeInterpretations: _alternativeInterpretationsForProperty(property),
          unknown: true,
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
// 8.5 Evidence Quality & Source Metadata Helpers
//
//    Evidence 内嵌 sourceMetadata：{ type, authority, independence, retrievedAt }
//    不做独立 Source Register / Source DB，避免引入 MDM 生命周期。
// ============================================================

const SOURCE_TYPE_AUTHORITY = {
  system_of_record: 0.85,
  official: 0.92,
  primary: 0.80,
  secondary: 0.60,
  hearsay: 0.20,
  generated: 0.10,
};

function _defaultAuthorityForSourceType(type) {
  return SOURCE_TYPE_AUTHORITY[type] || 0.5;
}

function _evidenceContentHash(ev) {
  const str = `${ev.source}|${ev.uri}|${ev.content}`;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

function _evidenceFreshness(ev) {
  const now = Date.now();
  if (ev.lastUpdated) {
    const t = new Date(ev.lastUpdated).getTime();
    if (!Number.isNaN(t)) {
      const ageDays = (now - t) / (1000 * 60 * 60 * 24);
      if (ageDays > 365) return { score: 0.2, flag: 'stale_365d' };
      if (ageDays > 180) return { score: 0.5, flag: 'stale_180d' };
      if (ageDays > 90) return { score: 0.8, flag: 'stale_90d' };
      return { score: 1.0, flag: null };
    }
  }
  return { score: 0.7, flag: 'no_lastUpdated' };
}

function assessEvidenceQuality(evidenceArray) {
  const evidenceList = Array.isArray(evidenceArray) ? evidenceArray : Array.from(evidenceArray.values ? evidenceArray.values() : []);
  const contentHashes = new Map(); // hash → ev.id
  const results = [];

  for (const ev of evidenceList) {
    const sourceMetadata = ev.sourceMetadata || {};
    const type = sourceMetadata.type || 'unknown';
    const authority = sourceMetadata.authority || _defaultAuthorityForSourceType(type);
    const independence = sourceMetadata.independence != null ? sourceMetadata.independence : 1.0;
    const { score: freshnessScore, flag: freshnessFlag } = _evidenceFreshness(ev);

    const hash = _evidenceContentHash(ev);
    let classification = type;
    let flags = [];
    if (freshnessFlag) flags.push(freshnessFlag);

    if (contentHashes.has(hash) && contentHashes.get(hash) !== ev.id) {
      classification = 'duplicate';
      flags.push('duplicate');
    } else {
      contentHashes.set(hash, ev.id);
    }

    if (freshnessScore < 0.5 && classification !== 'duplicate') {
      classification = 'outdated';
    }

    const qualityScore = Number(((authority * 0.35 + freshnessScore * 0.35 + independence * 0.3)).toFixed(3));

    results.push({
      evidenceId: ev.id,
      classification,
      authority,
      freshnessScore,
      independence,
      qualityScore,
      flags,
    });
  }

  return results;
}

function assessEvidenceQualityById(graph, evidenceId) {
  const ev = graph.evidence.get(evidenceId);
  if (!ev) throw new Error(`Evidence not found: ${evidenceId}`);
  const [result] = assessEvidenceQuality([ev]);
  return result;
}

function adjustConfidenceByCoverage(confidence, coverage) {
  if (!coverage || coverage.total === 0) return confidence;
  const ratio = coverage.coverageRatio;
  let score = confidence.score;
  if (ratio < 0.5) score -= 0.3;
  else if (ratio < 0.7) score -= 0.15;
  else if (ratio < 0.9) score -= 0.05;
  score = Math.max(0, Math.min(1, score));
  return {
    ...confidence,
    score: Number(score.toFixed(3)),
    level: _scoreToLevel(score),
    coveragePenalty: Number((confidence.score - score).toFixed(3)),
  };
}

function assessCompletion(session) {
  const coverage = session.claims ? session.claims.coverage() : { coverageRatio: 1.0, total: 0 };
  const rawConfidence = session.confidence || (session.graph.entities.size > 0 ? assessConfidence(session.graph) : { score: 0, level: 'low' });
  const confidence = adjustConfidenceByCoverage(rawConfidence, coverage);
  const gaps = session.gaps.length ? session.gaps : analyzeGaps(session.graph);
  const contradictions = session.contradictions.length ? session.contradictions : analyzeContradictions(session.graph);
  const openQuestions = session.questionTree
    ? session.questionTree.listQuestions({ status: 'open' }).length +
      session.questionTree.listQuestions({ status: 'investigating' }).length
    : 0;

  const coverageRatio = coverage.total === 0 ? 1.0 : coverage.coverageRatio;
  const confidenceScore = confidence.score;
  const remainingUnknowns = gaps.length;
  const remainingRisks = contradictions.length;

  const unknownPenalty = Math.min(1, remainingUnknowns * 0.15);
  const riskPenalty = Math.min(1, remainingRisks * 0.2);
  const questionPenalty = Math.min(1, openQuestions * 0.1);

  const completionScore = Number((
    coverageRatio * 0.3 +
    confidenceScore * 0.3 +
    (1 - unknownPenalty) * 0.15 +
    (1 - riskPenalty) * 0.15 +
    (1 - questionPenalty) * 0.1
  ).toFixed(3));

  let recommendation;
  if (completionScore >= 0.85 && coverageRatio >= 0.9 && remainingUnknowns === 0 && remainingRisks === 0) {
    recommendation = 'finish';
  } else if (completionScore >= 0.6) {
    recommendation = 'finish_with_gaps';
  } else {
    recommendation = 'continue';
  }

  return {
    coverageRatio,
    confidenceLevel: confidence.level,
    confidenceScore,
    remainingUnknowns,
    remainingRisks,
    openQuestions,
    completionScore,
    recommendation,
  };
}

// ============================================================
// 9. Decision & Budget（Expand-Converge 核心）
//
//    确定性 Decision 函数 —— 不用 LLM，不用 ML，不用 Tree Search。
//    比较 current snapshot 与 last snapshot：
//      - 新 Entity / Relationship / Conflict / Gap  → Continue
//      - 关键 Confidence 仍低                       → Continue
//      - 仍有 open/investigating Question           → Continue
//      - Budget 超限                                → Finish
//      - 否则                                        → Finish
//
//    Decide 后会把当前 snapshot 写回 session._lastSnapshot，供下次 diff。
// ============================================================

function decide(session) {
  const budgetCheck = checkBudget(session);

  // 若 confidence 未评估，则先计算一次（确保 Decision 有最新信号）
  let confidence = session.confidence;
  if (!confidence && session.graph && session.graph.entities.size > 0) {
    confidence = assessConfidence(session.graph);
    // 不写回 session.confidence（只用于本次 Decision），避免副作用
  }
  // Coverage 影响 confidence：低 coverage 时 confidence 降级
  const claimCoverage = session.claims ? session.claims.coverage() : null;
  if (confidence) {
    confidence = adjustConfidenceByCoverage(confidence, claimCoverage);
  }

  // Completion Assessment：综合研究完整度
  const completion = assessCompletion(session);

  const snapshot = {
    entityCount: session.graph ? session.graph.entities.size : 0,
    evidenceCount: session.graph ? session.graph.evidence.size : 0,
    relationshipCount: session.graph ? session.graph.relationships.length : 0,
    gapCount: session.gaps ? session.gaps.length : 0,
    contradictionCount: session.contradictions ? session.contradictions.length : 0,
    openQuestions:
      (session.questionTree ? session.questionTree.listQuestions({ status: 'open' }).length : 0) +
      (session.questionTree ? session.questionTree.listQuestions({ status: 'investigating' }).length : 0),
  };

  const last = session._lastSnapshot || null;
  const reasons = [];
  let decision = 'finish';

  // Budget 超限 → 强制 Finish
  if (!budgetCheck.withinBudget) {
    reasons.push(`Budget exceeded: ${budgetCheck.reasons.join('; ')}`);
    decision = 'finish';
  } else {
    // 与上次 snapshot 比较 —— Expand 阶段
    if (last) {
      const dEnt = snapshot.entityCount - last.entityCount;
      const dRel = snapshot.relationshipCount - last.relationshipCount;
      const dCon = snapshot.contradictionCount - last.contradictionCount;
      const dGap = snapshot.gapCount - last.gapCount;
      if (dEnt > 0) { reasons.push(`new Entity (+${dEnt})`); decision = 'continue'; }
      if (dRel > 0) { reasons.push(`new Relationship (+${dRel})`); decision = 'continue'; }
      if (dCon > 0) { reasons.push(`new Conflict (+${dCon})`); decision = 'continue'; }
      if (dGap > 0) { reasons.push(`new Gap (+${dGap})`); decision = 'continue'; }
    } else {
      // 首次 decide → 一定 Continue（除非 graph 空）
      if (snapshot.entityCount > 0 || snapshot.evidenceCount > 0) {
        reasons.push('first snapshot with evidence');
        decision = 'continue';
      }
    }
    // Confidence-driven：关键结论置信度不足 → Continue
    if (confidence && confidence.level === 'low') {
      reasons.push('overall confidence is low');
      decision = 'continue';
    }
    // 仍有开放问题 → Continue
    if (snapshot.openQuestions > 0) {
      reasons.push(`${snapshot.openQuestions} open question(s)`);
      decision = 'continue';
    }
    // Converge：没有新增价值 → Finish
    if (decision === 'finish') {
      reasons.push('no new value — converging to report');
    }
    // Completion Assessment：综合完整度不足时继续研究
    if (completion.recommendation === 'continue' && decision === 'finish') {
      reasons.push(`completion score ${completion.completionScore} too low — continue research`);
      decision = 'continue';
    }
    if (decision === 'finish') {
      reasons.push(`completion assessment: ${completion.recommendation}`);
    }
  }

  // 写回 snapshot（用于下次 diff）
  session._lastSnapshot = snapshot;

  return {
    decision, // 'continue' | 'finish'
    reasons,
    snapshot,
    lastSnapshot: last,
    budget: budgetCheck,
    confidence: confidence ? { level: confidence.level, score: confidence.score } : null,
    completion,
  };
}

// ============================================================
// 10. Research Report Schema + Validation（含 Traceability Layer）
//
//    每个结论必须可追溯到证据。企业最怕："AI 怎么知道的？"
//    Report 9 个 required section：
//      task, executiveSummary, keyFindings, supportingEvidence,
//      confidence, conflicts, knowledgeGaps, recommendations, traceability
//
//    Traceability Layer：
//      - claimCoverageRatio: Claims with Evidence / Total Claims
//      - totalClaims / claimsWithEvidence / verifiedClaims
//      - unverifiedClaimIds[]
//      - sourceCount / evidenceCount
//
//    Claim Type Rules（由 validateReport 强制）：
//      - fact/statistic/historical/expert_opinion MUST have evidenceIds
//      - analysis MUST have evidenceIds + reasoning
//      - recommendation MUST have reasoning
// ============================================================

const REPORT_REQUIRED_SECTIONS = [
  'task', 'executiveSummary', 'keyFindings', 'supportingEvidence',
  'confidence', 'conflicts', 'knowledgeGaps', 'recommendations', 'traceability',
];

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

// 默认 Claim Coverage Ratio 阈值（可被 contract.evidenceRequirement.claimCoverageRatio 覆盖）
const DEFAULT_CLAIM_COVERAGE_THRESHOLD = 0.9;

function validateReport(report, graph, options = {}) {
  const errors = [];
  const warnings = [];

  // options.contract 可携带 evidenceRequirement.claimCoverageRatio
  const claimCoverageThreshold =
    (options.contract && options.contract.evidenceRequirement && options.contract.evidenceRequirement.claimCoverageRatio)
    || DEFAULT_CLAIM_COVERAGE_THRESHOLD;
  // options.claims 可携带 ClaimStore（用于校验 claimId 引用 + Claim 类型规则）
  const claims = options.claims || null;

  for (const section of REPORT_REQUIRED_SECTIONS) {
    if (!(section in report)) errors.push(`Missing required section: ${section}`);
  }

  if (Array.isArray(report.keyFindings)) {
    report.keyFindings.forEach((f, i) => {
      if (!f.id) errors.push(`keyFindings[${i}]: missing id`);
      if (!f.statement) errors.push(`keyFindings[${i}] (${f.id || '?'}): missing statement`);
      // keyFindings 可引用 claimIds 或直接引用 evidenceIds（二选一即可）
      const hasEvidence = f.evidenceIds && f.evidenceIds.length > 0;
      const hasClaims = f.claimIds && f.claimIds.length > 0;
      if (!hasEvidence && !hasClaims) {
        errors.push(`keyFindings[${i}] (${f.id || '?'}): must have at least one evidenceId or claimId`);
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
      // 校验 claimId 引用
      if (f.claimIds && claims) {
        for (const cId of f.claimIds) {
          if (!claims.claims.has(cId)) {
            errors.push(`keyFindings[${i}] (${f.id}): claimId ${cId} not found in claim store`);
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

  // Traceability Layer 校验
  if (report.traceability) {
    const t = report.traceability;
    if (typeof t.claimCoverageRatio !== 'number') {
      errors.push('traceability.claimCoverageRatio must be a number');
    } else if (claims && claims.claims.size > 0 && t.claimCoverageRatio < claimCoverageThreshold) {
      warnings.push(
        `traceability.claimCoverageRatio ${t.claimCoverageRatio} < threshold ${claimCoverageThreshold} — confidence will be downgraded`
      );
    }
    if (typeof t.totalClaims !== 'number') {
      warnings.push('traceability.totalClaims should be a number');
    }
    if (!Array.isArray(t.unverifiedClaimIds)) {
      warnings.push('traceability.unverifiedClaimIds should be an array');
    }
  }

  // Claim 类型规则校验（当 ClaimStore 提供时）
  if (claims) {
    for (const claim of claims.claims.values()) {
      const req = CLAIM_EVIDENCE_REQUIREMENTS[claim.type];
      if (req.requiresEvidence && claim.evidenceIds.length === 0) {
        errors.push(`Claim ${claim.id} (type=${claim.type}): requires at least one evidenceId`);
      }
      if (req.requiresReasoning && !claim.reasoning) {
        errors.push(`Claim ${claim.id} (type=${claim.type}): requires reasoning`);
      }
      // evidenceIds 必须在 graph 中存在
      for (const evId of claim.evidenceIds) {
        if (!graph.evidence.has(evId)) {
          errors.push(`Claim ${claim.id}: evidenceId ${evId} not found in graph`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// 生成报告模板：预填 supportingEvidence + knowledgeGaps + conflicts + traceability
function reportTemplate(session) {
  const graph = session.graph;
  const gaps = session.gaps.length ? session.gaps : analyzeGaps(graph);
  const contradictions = session.contradictions.length ? session.contradictions : analyzeContradictions(graph);
  const rawConfidence = session.confidence || assessConfidence(graph);
  const claimCoverage = session.claims ? session.claims.coverage() : null;
  const confidence = adjustConfidenceByCoverage(rawConfidence, claimCoverage);
  const sources = new Set(Array.from(graph.evidence.values()).map((e) => e.source));

  const completion = assessCompletion(session);
  const traceability = {
    claimCoverageRatio: claimCoverage ? claimCoverage.coverageRatio : 1.0,
    totalClaims: claimCoverage ? claimCoverage.total : 0,
    claimsWithEvidence: claimCoverage ? claimCoverage.withEvidence : 0,
    verifiedClaims: claimCoverage ? claimCoverage.verified : 0,
    unverifiedClaimIds: claimCoverage ? claimCoverage.unverifiedClaimIds : [],
    sourceCount: sources.size,
    evidenceCount: graph.evidence.size,
    completion,
  };

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
      alternativeInterpretations: c.alternativeInterpretations || [],
      unknown: c.unknown === true,
    })),
    knowledgeGaps: gaps.map((g) => ({
      description: `${g.entityName} (${g.entityType}): missing ${g.detail}`,
      entityId: g.entityId,
      missingRelation: g.gapType === 'missing_relation' ? g.detail : undefined,
      severity: g.severity,
    })),
    recommendations: [],
    traceability,
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
// 11. ResearchSession（贯穿全流程的工作上下文 / Research Context）
//
//    核心对象：把所有概念自然串联起来。
//    不引入数据库 / 状态机 / 框架，仅是一个逻辑模型 + JSON 持久化。
//
//    字段：
//      - goal:               研究目标
//      - contract:           Research Contract（用户确认的研究契约）
//      - budget:             Research Budget（depth/maxQuestions/maxEvidence/time）
//      - plan:               骨架子任务
//      - questionTree:       动态问题树（Evidence-driven, Expand-Converge）
//      - graph:              EvidenceGraph（Working Memory）
//      - claims:             ClaimStore（一等 Claim 对象 + Coverage）
//      - findings/gaps/contradictions/confidence: 由 analyze() 计算
//      - _lastSnapshot:      上次 decide() 的快照（用于 diff 判断新增价值）
//
//    LLM 在每个 Phase 都应调用 session-context 查看"我现在研究到哪里"。
// ============================================================

class ResearchSession {
  constructor(goal) {
    this.goal = goal;
    this.createdAt = new Date().toISOString();
    this.contract = null;          // ResearchContract
    this.budget = null;            // ResearchBudget（如未设置，checkBudget 用 DEFAULT_BUDGET）
    this.plan = [];                // [{ id, objective, status, createdAt, updatedAt }]
    this.questionTree = new QuestionTree(); // 动态问题树
    this.graph = new EvidenceGraph();
    this.claims = new ClaimStore();         // Claim 一等对象
    this.findings = [];            // 报告撰写时填充
    this.gaps = [];                // 由 analyze() 计算
    this.contradictions = [];      // 由 analyze() 计算
    this.confidence = null;        // 由 analyze() 计算
    this.report = null;
    this.visitedSources = [];      // [{ source, uri, at }]
    this.pendingQuestions = [];    // LLM 填充（自由文本，与 QuestionTree 互补）
    this.rejectedHypotheses = []; // LLM 填充
    this._planCounter = 0;
    this._lastSnapshot = null;     // 上次 decide() 的 snapshot
  }

  // ----- Contract & Budget -----

  setContract(contract) {
    if (!contract || !contract.question) throw new Error('Contract must have question');
    this.contract = contract;
    return this.contract;
  }

  confirmContract() {
    if (!this.contract) throw new Error('No contract to confirm. Call setContract first.');
    this.contract.confirmedAt = new Date().toISOString();
    return this.contract;
  }

  setBudget(budget) {
    this.budget = budget;
    return this.budget;
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

  // ----- Question Tree（委托给 QuestionTree）-----

  addQuestion({ text, parentId = null, triggeredByEvidenceId = null, triggeredByEntityId = null, planItemId = null }) {
    return this.questionTree.addQuestion({ text, parentId, triggeredByEvidenceId, triggeredByEntityId, planItemId });
  }

  updateQuestion(id, { status, generatedEntityIds, generatedRelationshipIds }) {
    return this.questionTree.updateQuestion(id, { status, generatedEntityIds, generatedRelationshipIds });
  }

  // ----- Claim Store（委托给 ClaimStore）-----

  addClaim({ text, type, evidenceIds = [], reasoning = '', confidence = 0.5, supportingClaimIds = [], entityId = null }) {
    return this.claims.addClaim({ text, type, evidenceIds, reasoning, confidence, supportingClaimIds, entityId });
  }

  verifyClaim(id, { verified = true, note = '' } = {}) {
    return this.claims.verifyClaim(id, { verified, note });
  }

  linkClaimEvidence(claimId, evidenceIds) {
    return this.claims.linkEvidence(claimId, evidenceIds);
  }

  claimCoverage() {
    return this.claims.coverage();
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

  // ----- Decision（Expand-Converge）-----

  decide() {
    return decide(this);
  }

  checkBudget() {
    return checkBudget(this);
  }

  // ----- Research Context（LLM 判断"研究到哪里"的依据）-----

  context() {
    return {
      goal: this.goal,
      contract: this.contract
        ? {
            question: this.contract.question,
            confirmed: !!this.contract.confirmedAt,
            claimCoverageThreshold: this.contract.evidenceRequirement
              ? this.contract.evidenceRequirement.claimCoverageRatio
              : DEFAULT_CLAIM_COVERAGE_THRESHOLD,
          }
        : null,
      budget: this.budget
        ? checkBudget(this)
        : { usingDefaults: true, ...checkBudget(this) },
      planProgress: {
        total: this.plan.length,
        done: this.plan.filter((p) => p.status === 'done').length,
        inProgress: this.plan.filter((p) => p.status === 'in_progress').length,
        pending: this.plan.filter((p) => p.status === 'pending').length,
        skipped: this.plan.filter((p) => p.status === 'skipped').length,
      },
      questionTree: this.questionTree.stats(),
      graph: this.graph.stats(),
      claims: this.claims.coverage(),
      openGaps: this.gaps.length,
      openContradictions: this.contradictions.length,
      confidence: this.confidence ? this.confidence.level : 'unassessed',
      pendingQuestions: this.pendingQuestions.length,
      rejectedHypotheses: this.rejectedHypotheses.length,
      visitedSources: this.visitedSources.length,
      hasReport: !!this.report,
      lastSnapshot: this._lastSnapshot,
    };
  }

  // ----- Serialization -----

  toJSON() {
    return {
      goal: this.goal,
      createdAt: this.createdAt,
      contract: this.contract,
      budget: this.budget,
      plan: this.plan,
      questionTree: this.questionTree.toJSON(),
      graph: this.graph.toJSON(),
      claims: this.claims.toJSON(),
      findings: this.findings,
      gaps: this.gaps,
      contradictions: this.contradictions,
      confidence: this.confidence,
      report: this.report,
      visitedSources: this.visitedSources,
      pendingQuestions: this.pendingQuestions,
      rejectedHypotheses: this.rejectedHypotheses,
      _planCounter: this._planCounter,
      _lastSnapshot: this._lastSnapshot,
    };
  }

  static fromJSON(data) {
    const s = new ResearchSession(data.goal);
    s.createdAt = data.createdAt;
    s.contract = data.contract || null;
    s.budget = data.budget || null;
    s.plan = data.plan || [];
    s.questionTree = QuestionTree.fromJSON(data.questionTree || {});
    s.graph = EvidenceGraph.fromJSON(data.graph || {});
    s.claims = ClaimStore.fromJSON(data.claims || {});
    s.findings = data.findings || [];
    s.gaps = data.gaps || [];
    s.contradictions = data.contradictions || [];
    s.confidence = data.confidence || null;
    s.report = data.report || null;
    s.visitedSources = data.visitedSources || [];
    s.pendingQuestions = data.pendingQuestions || [];
    s.rejectedHypotheses = data.rejectedHypotheses || [];
    s._planCounter = data._planCounter || 0;
    s._lastSnapshot = data._lastSnapshot || null;
    return s;
  }
}

// ============================================================
// 12. Persistence
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
// 13. Benchmark & Eval Harness
// ============================================================

const BENCHMARK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'benchmark');
const EVAL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'eval');

function _jsonFixturePath(dir, id) {
  return path.join(dir, `${id}.json`);
}

function _listFixtures(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function _approxEqual(a, b, epsilon = 0.001) {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= epsilon;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => _approxEqual(v, b[i], epsilon));
  }
  return a === b;
}

function _buildGraphFromFixture(input) {
  const graph = new EvidenceGraph();
  for (const e of input.entities || []) {
    graph.addEntity({
      type: e.type,
      name: e.name,
      aliases: e.aliases || [],
      summary: e.summary || '',
      properties: e.properties || {},
    });
  }
  const evidenceIdMap = {};
  for (const ev of input.evidence || []) {
    const created = graph.addEvidence({
      source: ev.source,
      uri: ev.uri || '',
      content: ev.content || '',
      confidence: ev.confidence != null ? ev.confidence : 0.5,
      lastUpdated: ev.lastUpdated || '',
      claims: ev.claims || [],
      sourceMetadata: ev.sourceMetadata || null,
    });
    evidenceIdMap[ev.id] = created.id;
    if (ev.entityId && graph.getEntity(ev.entityId)) {
      graph.linkEvidence({ entityId: ev.entityId, evidenceId: created.id });
    }
  }
  for (const r of input.relationships || []) {
    graph.addRelationship({
      from: r.from,
      to: r.to,
      type: r.type,
      confidence: r.confidence != null ? r.confidence : 0.5,
      evidence: (r.evidenceIds || []).map((id) => evidenceIdMap[id] || id).filter(Boolean),
    });
  }
  return graph;
}

function _buildClaimStoreFromFixture(input) {
  const store = new ClaimStore();
  for (const c of input.claims || []) {
    const claim = store.addClaim({
      text: c.text,
      type: c.type,
      evidenceIds: c.evidenceIds || [],
      reasoning: c.reasoning || '',
      confidence: c.confidence != null ? c.confidence : 0.5,
    });
    if (c.verified === true) {
      store.verifyClaim(claim.id, { verified: true });
    }
  }
  return store;
}

function _runBenchmarkTask(task) {
  const category = task.category || task.id;
  const result = { task: task.id, category, title: task.title, passed: false, actual: {}, expected: task.expected, errors: [] };
  try {
    switch (category) {
      case 'claim': {
        const store = _buildClaimStoreFromFixture(task.input);
        const cov = store.coverage();
        result.actual = {
          coverageRatio: cov.coverageRatio,
          verifiedRatio: cov.verifiedRatio,
          total: cov.total,
          withEvidence: cov.withEvidence,
          unverifiedCount: cov.total - cov.verified,
        };
        break;
      }
      case 'gap': {
        const graph = _buildGraphFromFixture(task.input);
        const gaps = analyzeGaps(graph);
        result.actual = {
          count: gaps.length,
          types: gaps.map((g) => g.gapType),
          severities: gaps.map((g) => g.severity).sort(),
        };
        break;
      }
      case 'contradiction': {
        const graph = _buildGraphFromFixture(task.input);
        const contradictions = analyzeContradictions(graph);
        result.actual = {
          count: contradictions.length,
          properties: contradictions.map((c) => c.property).sort(),
          values: contradictions.map((c) => c.values.map((v) => v.value).sort()).sort(),
          unknown: contradictions.map((c) => c.unknown),
        };
        break;
      }
      case 'confidence': {
        const graph = _buildGraphFromFixture(task.input);
        const confidence = assessConfidence(graph);
        result.actual = {
          level: confidence.level,
          score: confidence.score,
        };
        break;
      }
      case 'evidence-quality': {
        const graph = _buildGraphFromFixture(task.input);
        const qualities = assessEvidenceQuality(graph.evidence);
        const byId = {};
        for (const q of qualities) byId[q.evidenceId] = q;
        result.actual = {
          classifications: qualities.map((q) => q.classification),
          ev1QualityScore: byId.ev1?.qualityScore,
          ev2QualityScore: byId.ev2?.qualityScore,
          ev3QualityScore: byId.ev3?.qualityScore,
          count: qualities.length,
        };
        break;
      }
      default:
        throw new Error(`Unknown benchmark category: ${category}`);
    }

    for (const [key, expectedValue] of Object.entries(task.expected)) {
      if (!_approxEqual(result.actual[key], expectedValue)) {
        result.errors.push(`${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(result.actual[key])}`);
      }
    }
    result.passed = result.errors.length === 0;
  } catch (err) {
    result.errors.push(err.message);
    result.passed = false;
  }
  return result;
}

function runBenchmark({ taskId = null } = {}) {
  const ids = taskId ? [taskId] : _listFixtures(BENCHMARK_DIR);
  if (ids.length === 0) {
    console.log('No benchmark fixtures found.');
    return { passed: true, results: [] };
  }

  const results = [];
  let allPassed = true;
  for (const id of ids) {
    const file = _jsonFixturePath(BENCHMARK_DIR, id);
    if (!fs.existsSync(file)) {
      results.push({ task: id, passed: false, errors: ['Fixture not found'] });
      allPassed = false;
      continue;
    }
    const task = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = _runBenchmarkTask(task);
    results.push(r);
    if (!r.passed) allPassed = false;
  }
  return { passed: allPassed, results };
}

function _runScenario(scenario) {
  const result = { scenario: scenario.id, title: scenario.title, passed: false, errors: [] };
  try {
    const session = new ResearchSession(scenario.setup?.goal || 'Eval');

    // Apply contract
    if (scenario.setup?.contract) {
      session.setContract(createContract(scenario.setup.contract));
    }

    // Build graph
    if (scenario.setup?.graph) {
      session.graph = _buildGraphFromFixture(scenario.setup.graph);
    }

    // Build claims
    if (scenario.setup?.claims) {
      session.claims = _buildClaimStoreFromFixture({ claims: scenario.setup.claims });
    }

    // Run analysis if requested
    if (scenario.setup?.runAnalyze) {
      session.analyze();
    }

    // Assertions
    for (const assertion of scenario.assertions || []) {
      switch (assertion.type) {
        case 'contract_valid': {
          if (!session.contract) {
            result.errors.push('contract_valid: no contract set');
          } else if (!session.contract.question || !session.contract.question.trim()) {
            result.errors.push('contract_valid: contract question is empty');
          }
          break;
        }
        case 'claim_has_evidence': {
          const claims = session.claims.listClaims({ type: assertion.claimType || undefined });
          const bad = claims.filter((c) => c.evidenceIds.length === 0);
          if (bad.length) {
            result.errors.push(`claim_has_evidence: ${bad.length} ${assertion.claimType || 'claim'}(s) without evidence: ${bad.map((c) => c.id).join(', ')}`);
          }
          break;
        }
        case 'coverage_min': {
          const cov = session.claims.coverage();
          if (cov.coverageRatio < assertion.min) {
            result.errors.push(`coverage_min: ${cov.coverageRatio} < ${assertion.min}`);
          }
          break;
        }
        case 'contradiction_count': {
          const contradictions = analyzeContradictions(session.graph);
          if (contradictions.length < assertion.min) {
            result.errors.push(`contradiction_count: ${contradictions.length} < ${assertion.min}`);
          }
          break;
        }
        case 'confidence_level': {
          const confidence = assessConfidence(session.graph);
          const expected = assertion.level;
          const order = { low: 0, medium: 1, high: 2 };
          if (order[confidence.level] < order[expected]) {
            result.errors.push(`confidence_level: ${confidence.level} < ${expected}`);
          }
          break;
        }
        case 'evidence_quality_min': {
          const q = assessEvidenceQualityById(session.graph, assertion.evidenceId);
          if (q.qualityScore < assertion.min) {
            result.errors.push(`evidence_quality_min ${assertion.evidenceId}: ${q.qualityScore} < ${assertion.min}`);
          }
          break;
        }
        case 'evidence_quality_max': {
          const q = assessEvidenceQualityById(session.graph, assertion.evidenceId);
          if (q.qualityScore > assertion.max) {
            result.errors.push(`evidence_quality_max ${assertion.evidenceId}: ${q.qualityScore} > ${assertion.max}`);
          }
          break;
        }
        case 'completion_recommendation': {
          const completion = assessCompletion(session);
          if (completion.recommendation !== assertion.expected) {
            result.errors.push(`completion_recommendation: ${completion.recommendation} !== ${assertion.expected}`);
          }
          break;
        }
        case 'completion_min_score': {
          const completion = assessCompletion(session);
          if (completion.completionScore < assertion.min) {
            result.errors.push(`completion_min_score: ${completion.completionScore} < ${assertion.min}`);
          }
          break;
        }
        default:
          result.errors.push(`Unknown assertion type: ${assertion.type}`);
      }
    }

    result.passed = result.errors.length === 0;
  } catch (err) {
    result.errors.push(err.message);
    result.passed = false;
  }
  return result;
}

function runEval({ scenarioId = null } = {}) {
  const ids = scenarioId ? [scenarioId] : _listFixtures(EVAL_DIR);
  if (ids.length === 0) {
    console.log('No eval scenarios found.');
    return { passed: true, results: [] };
  }

  const results = [];
  let allPassed = true;
  for (const id of ids) {
    const file = _jsonFixturePath(EVAL_DIR, id);
    if (!fs.existsSync(file)) {
      results.push({ scenario: id, passed: false, errors: ['Scenario not found'] });
      allPassed = false;
      continue;
    }
    const scenario = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = _runScenario(scenario);
    results.push(r);
    if (!r.passed) allPassed = false;
  }
  return { passed: allPassed, results };
}

// ============================================================
// 14. CLI
// ============================================================

function printUsage() {
  console.log(`
Usage: node research.mjs <command> [options]

Enterprise Research Agent — Evidence-driven research machinery.
Research = Investigation + Analysis, driven by Question Tree + Decision Loop.
ResearchSession is the working context. Claim Coverage Ratio ≥ 0.9 enforced.

Commands:
  init --goal <name> [--session <file>]                          Initialize new research session

  set-contract --question <text> [--scope <json>]                Set Research Contract (user must confirm)
                  [--expected-output <json>] [--min-sources 3]
                  [--primary-source-ratio 0.6] [--claim-coverage-ratio 0.9]
                  [--confirm] [--session <file>]
  set-budget [--depth 3] [--max-questions 40]                    Set Research Budget
              [--max-evidence 300] [--time-limit-minutes 8] [--session <file>]
  confirm-contract [--session <file>]                            Mark contract as confirmed by user

  session-status [--session <file>]                              Show full session context (contract, budget, plan, questions, graph, claims, analysis)
  session-context [--session <file>]                             Output Research Context as JSON (for LLM self-check)

  add-plan-item --objective <text> [--session <file>]            Add investigation sub-task to plan
  update-plan-item --id <id> --status <status> [--session <file>] Update plan item status

  add-question --text <text> [--parent <id>]                     Add question to Question Tree (root if no --parent)
                [--triggered-by-evidence <id>] [--triggered-by-entity <id>]
                [--plan-item <id>] [--session <file>]
  update-question --id <id> [--status <status>]                  Update question status / generated artifacts
                  [--generated-entities e1,e2] [--generated-relationships r1,r2] [--session <file>]
  list-questions [--status <S>] [--parent <id>] [--session <file>] List questions (default: all)

  record-source --source <S> [--uri <U>] [--session <file>]      Record visited Connector Adapter source
  add-pending-question <text> [--session <file>]                 Add open question to research context (free text)
  reject-hypothesis --hypothesis <text> [--reason <text>] [--session <file>]
                                                                  Record rejected hypothesis

  list-ontology [--type <T>]                                     List entity types and relations
  add-entity --type <T> --name <N> [--aliases a,b] [--summary ...] [--props k=v,...] [--session <file>]
  find-entity <name> [--session <file>]                          Find entity by name or alias
  list-entities [--type <T>] [--session <file>]

  add-evidence --source <S> [--uri <U>] [--content <C>] [--confidence 0.5]
               [--last-updated <ISO date>] [--claims prop=val,...]
               [--source-type system_of_record|official|primary|secondary|hearsay|generated]
               [--source-authority 0.85] [--source-independence 1.0]
               [--source-retrieved-at <ISO date>] [--session <file>]
  assess-evidence --id <evidenceId> [--session <file>]
  link-evidence --entity <id> --evidence <id> [--session <file>]
  add-relationship --from <id> --to <id> --type <T> [--confidence 0.5] [--evidence ev1,ev2] [--session <file>]
  resolve-identity --canonical <id> --aliases <id1,id2> [--session <file>]

  add-claim --text <text> --type <T>                             Add a Claim (first-class conclusion unit)
              [--evidence ev1,ev2] [--reasoning <text>] [--confidence 0.5]
              [--supports c1,c2] [--entity <id>] [--session <file>]
              T = fact|statistic|historical|expert_opinion|analysis|recommendation
              (fact/statistic/historical/expert_opinion require --evidence; analysis requires --evidence + --reasoning;
               recommendation requires --reasoning)
  verify-claim --id <id> [--verified] [--note <text>] [--session <file>] Mark claim as verified/unverified
  link-claim-evidence --id <id> --evidence <ev1,ev2,...> [--session <file>] Attach additional evidence to existing claim
  list-claims [--type <T>] [--verified] [--session <file>]       List claims (filter by type or verification status)
  coverage [--session <file>]                                    Show Claim Coverage Ratio

  analyze [--session <file>]                                     Run Gap + Contradiction + Confidence together
  analyze-gaps [--session <file>]                                Compute gaps based on Ontology
  analyze-contradictions [--session <file>]                      Detect contradictions based on claims
  assess-confidence [--entity <id>] [--session <file>]           Assess confidence (per entity or overall)

  decide [--session <file>]                                      Deterministic Decision: Continue or Finish?
                                                                  (based on new Entity/Relationship/Conflict/Gap,
                                                                   open questions, confidence, budget, completion)
  completion-assessment [--session <file>]                       Output completion assessment (coverage/confidence/unknowns/risks/questions)
  check-budget [--session <file>]                                Show budget usage vs limits

  show-graph [--session <file>] [--max-nodes 50]                 Output Mermaid flowchart
  report-template [--output <file>] [--session <file>]           Generate report template (pre-fills evidence + gaps + conflicts + traceability)
  validate-report --report <file> [--session <file>]             Validate report schema (incl. Traceability Layer + Claim rules)

  benchmark [--task <id>]                                        Run deterministic algorithm benchmarks
  eval [--scenario <id>]                                         Run behavioral eval scenarios

Options:
  --session <file>                  Session file path (default: ./research-session.json)
  --goal <name>                     Research goal (for init)
  --question <text>                 Research Contract question
  --scope <json>                    Research Contract scope (JSON string)
  --expected-output <json>          Research Contract expected output (JSON string)
  --min-sources <n>                 Min independent sources (default 3)
  --primary-source-ratio <n>        Primary source ratio 0-1 (default 0.6)
  --claim-coverage-ratio <n>        Claim Coverage Ratio threshold 0-1 (default 0.9)
  --confirm                         Mark contract as confirmed (with set-contract)
  --depth <n>                       Budget: max Question Tree depth (default 3)
  --max-questions <n>               Budget: max questions (default 40)
  --max-evidence <n>                Budget: max evidence count (default 300)
  --time-limit-minutes <n>          Budget: time limit in minutes (default 8)
  --objective <text>                Plan item objective
  --status <status>                 Plan item status: pending | in_progress | done | skipped
                                    Question status: open | investigating | answered | pruned
  --text <text>                     Question text (for add-question) or Claim text (for add-claim)
  --type <T>                        Entity type (Vendor, Application, Repository, Team, Person, Project,
                                    Capability, BusinessProcess, Regulation, Control, Incident, Risk, Contract, Document)
                                    OR Claim type (fact, statistic, historical, expert_opinion, analysis, recommendation)
  --parent <id>                     Parent question ID (for add-question)
  --triggered-by-evidence <id>      Evidence that triggered this question
  --triggered-by-entity <id>        Entity that triggered this question
  --plan-item <id>                  Associated plan item ID
  --generated-entities <list>       Comma-separated entity IDs generated by answering this question
  --generated-relationships <list>  Comma-separated relationship IDs generated by answering this question
  --name <N>                        Entity name
  --aliases <list>                  Comma-separated aliases
  --summary <text>                  Entity summary
  --props <list>                    Comma-separated key=value properties
  --source <S>                      Connector Adapter source (Confluence, GitHub, Jira, LeanIX, ServiceNow,
                                    Vendor, Regulation, External, News, Academic, Web, ...)
  --uri <U>                         Evidence URI
  --content <C>                     Evidence content
  --confidence <n>                  Confidence 0-1 (default 0.5)
  --last-updated <d>                Source last-updated ISO date (for Freshness assessment)
  --claims <list>                   Comma-separated property=value claims (for Contradiction Detection)
  --from <id>                       Source entity ID
  --to <id>                         Target entity ID
  --evidence <list>                 Comma-separated evidence IDs (for add-relationship or add-claim)
  --reasoning <text>                Claim reasoning (required for analysis/recommendation claim types)
  --supports <list>                 Comma-separated supporting claim IDs
  --entity <id>                     Entity ID (for link-evidence, add-claim)
  --verified                        Mark claim as verified (default true; use --verified false to unverify)
  --note <text>                     Verification note (for verify-claim)
  --canonical <id>                  Canonical entity ID (for resolve-identity)
  --hypothesis <text>               Hypothesis text (for reject-hypothesis)
  --reason <text>                   Rejection reason
  --output <file>                   Output file path
  --max-nodes <n>                   Max nodes for Mermaid export (default 50)
  --source-type <type>              Evidence source metadata type
  --source-authority <0-1>          Evidence source authority score
  --source-independence <0-1>       Evidence source independence score
  --source-retrieved-at <ISO date>  Evidence source retrieved timestamp
  --task <id>                       Benchmark task id
  --scenario <id>                   Eval scenario id
  --help, -h                        Show this help

Examples:
  node research.mjs init --goal "Research RiskConcile"

  # Set contract and budget (Phase 0)
  node research.mjs set-contract --question "Research RiskConcile as a vendor" \\
    --scope '{"industry":"RegTech"}' --min-sources 4 --claim-coverage-ratio 0.95 --confirm
  node research.mjs set-budget --depth 3 --max-questions 30 --time-limit-minutes 10

  # Plan + Question Tree (Phase 1)
  node research.mjs add-plan-item --objective "Identify vendor background"
  node research.mjs add-question --text "What is RiskConcile?" --plan-item p1
  node research.mjs add-question --text "Which applications use RiskConcile?" --parent q1 --plan-item p2

  # Evidence Collection (Phase 2)
  node research.mjs add-entity --type Vendor --name "RiskConcile" --aliases "RC,riskconcile-api" --props "website=https://riskconcile.com"
  node research.mjs add-evidence --source GitHub --uri "https://github.com/org/riskconcile-api" \\
    --content "Repo exists, 142 commits" --confidence 0.95 --last-updated 2025-09-12 \\
    --claims "owner=Team A,status=active"
  node research.mjs add-evidence --source LeanIX --uri "leanix/app/RC" \\
    --content "App registered" --confidence 0.85 --claims "owner=Team B"
  node research.mjs link-evidence --entity e1 --evidence ev1
  node research.mjs add-relationship --from e1 --to e2 --type used_by --evidence ev1
  node research.mjs resolve-identity --canonical e1 --aliases e2,e3

  # Question Tree growth (Phase 2-4, Evidence-driven)
  node research.mjs add-question --text "Which team owns the riskconcile-api repo?" \\
    --parent q2 --triggered-by-evidence ev1 --triggered-by-entity e2
  node research.mjs update-question --id q2 --status answered --generated-entities e2

  # Claims (Phase 5)
  node research.mjs add-claim --text "RiskConcile is used by RC Migration Tool" --type fact \\
    --evidence ev1,ev2 --confidence 0.9
  node research.mjs add-claim --text "Resolve owner conflict before signing contract" --type recommendation \\
    --reasoning "Owner discrepancy blocks contract ownership assignment"
  node research.mjs verify-claim --id c1 --note "Cross-validated with LeanIX"
  node research.mjs coverage

  # Analysis + Decision Loop
  node research.mjs analyze
  node research.mjs decide                  # Continue or Finish? (deterministic)
  node research.mjs check-budget            # Budget usage

  # Report
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
        console.log(`  Next: set-contract --question <text> --confirm`);
        break;
      }

      case 'set-contract': {
        const s = loadSession(sessionFile);
        const question = argValue(argv, '--question');
        if (!question) {
          console.error('Error: --question is required');
          process.exit(1);
        }
        const scopeStr = argValue(argv, '--scope');
        const expectedOutStr = argValue(argv, '--expected-output');
        const minSources = argValue(argv, '--min-sources');
        const primaryRatio = argValue(argv, '--primary-source-ratio');
        const coverageRatio = argValue(argv, '--claim-coverage-ratio');
        const confirm = argv.includes('--confirm');

        let scope = {};
        let expectedOutput = {};
        try { if (scopeStr) scope = JSON.parse(scopeStr); } catch (e) {
          console.error(`Error: --scope is not valid JSON: ${e.message}`);
          process.exit(1);
        }
        try { if (expectedOutStr) expectedOutput = JSON.parse(expectedOutStr); } catch (e) {
          console.error(`Error: --expected-output is not valid JSON: ${e.message}`);
          process.exit(1);
        }
        const evidenceRequirement = {};
        if (minSources) evidenceRequirement.minSources = Number(minSources);
        if (primaryRatio) evidenceRequirement.primarySourceRatio = Number(primaryRatio);
        if (coverageRatio) evidenceRequirement.claimCoverageRatio = Number(coverageRatio);

        const contract = createContract({ question, scope, expectedOutput, evidenceRequirement });
        if (confirm) contract.confirmedAt = new Date().toISOString();
        s.setContract(contract);
        saveSession(s, sessionFile);
        console.log(`✓ Set Research Contract`);
        console.log(`  Question:    ${contract.question}`);
        console.log(`  Confirmed:   ${contract.confirmedAt ? 'yes' : 'no (run confirm-contract after user review)'}`);
        console.log(`  Evidence req:`);
        console.log(`    min sources:           ${contract.evidenceRequirement.minSources}`);
        console.log(`    primary source ratio:  ${contract.evidenceRequirement.primarySourceRatio}`);
        console.log(`    claim coverage ratio:  ${contract.evidenceRequirement.claimCoverageRatio}`);
        break;
      }

      case 'confirm-contract': {
        const s = loadSession(sessionFile);
        s.confirmContract();
        saveSession(s, sessionFile);
        console.log(`✓ Contract confirmed at ${s.contract.confirmedAt}`);
        break;
      }

      case 'set-budget': {
        const s = loadSession(sessionFile);
        const depth = argValue(argv, '--depth');
        const maxQ = argValue(argv, '--max-questions');
        const maxE = argValue(argv, '--max-evidence');
        const tlm = argValue(argv, '--time-limit-minutes');
        const budget = createBudget({
          depth: depth != null ? Number(depth) : undefined,
          maxQuestions: maxQ != null ? Number(maxQ) : undefined,
          maxEvidence: maxE != null ? Number(maxE) : undefined,
          timeLimitMinutes: tlm != null ? Number(tlm) : undefined,
        });
        s.setBudget(budget);
        saveSession(s, sessionFile);
        console.log(`✓ Set Research Budget`);
        console.log(`  depth:             ${budget.depth}`);
        console.log(`  max questions:     ${budget.maxQuestions}`);
        console.log(`  max evidence:      ${budget.maxEvidence}`);
        console.log(`  time limit (min):  ${budget.timeLimitMinutes}`);
        break;
      }

      case 'session-status': {
        const s = loadSession(sessionFile);
        const ctx = s.context();
        console.log(`Goal:          ${ctx.goal}`);
        console.log(`Created:       ${s.createdAt}`);
        console.log(``);
        console.log(`Contract:      ${ctx.contract ? ctx.contract.question : '(not set)'}` +
          (ctx.contract ? ` [${ctx.contract.confirmed ? 'confirmed' : 'unconfirmed'}]` : ''));
        console.log(`  Coverage threshold: ${ctx.contract ? ctx.contract.claimCoverageThreshold : DEFAULT_CLAIM_COVERAGE_THRESHOLD}`);
        console.log(``);
        console.log(`Budget:        ${s.budget ? `depth=${s.budget.depth}, maxQ=${s.budget.maxQuestions}, maxE=${s.budget.maxEvidence}, time=${s.budget.timeLimitMinutes}min` : '(using defaults)'}`);
        const bu = ctx.budget;
        console.log(`  Usage:       depth=${bu.usage.depth}, questions=${bu.usage.questions}, evidence=${bu.usage.evidence}, elapsed=${bu.usage.elapsedMinutes.toFixed(1)}min`);
        if (!bu.withinBudget) console.log(`  ⚠ Exceeded:  ${bu.reasons.join('; ')}`);
        console.log(``);
        console.log(`Plan:          ${ctx.planProgress.total} items ` +
          `(done=${ctx.planProgress.done}, in_progress=${ctx.planProgress.inProgress}, ` +
          `pending=${ctx.planProgress.pending}, skipped=${ctx.planProgress.skipped})`);
        for (const p of s.plan) {
          const icon = p.status === 'done' ? '✓' : p.status === 'in_progress' ? '›' : p.status === 'skipped' ? '×' : '·';
          console.log(`  ${icon} ${p.id}: ${p.objective} [${p.status}]`);
        }
        console.log(``);
        console.log(`Question Tree: ${ctx.questionTree.total} questions ` +
          `(open=${ctx.questionTree.open}, investigating=${ctx.questionTree.investigating}, ` +
          `answered=${ctx.questionTree.answered}, pruned=${ctx.questionTree.pruned}, maxDepth=${ctx.questionTree.maxDepth})`);
        console.log(``);
        console.log(`Graph:`);
        console.log(`  Entities:       ${ctx.graph.entityCount}`);
        console.log(`  Evidence:       ${ctx.graph.evidenceCount}`);
        console.log(`  Relationships:  ${ctx.graph.relationshipCount}`);
        const types = Object.entries(ctx.graph.entityTypes || {}).map(([k, v]) => `${k}=${v}`).join(', ');
        if (types) console.log(`  By type:        ${types}`);
        console.log(``);
        console.log(`Claims:`);
        console.log(`  Total:          ${ctx.claims.total}`);
        console.log(`  With evidence:  ${ctx.claims.withEvidence} (coverage=${ctx.claims.coverageRatio})`);
        console.log(`  Verified:       ${ctx.claims.verified} (ratio=${ctx.claims.verifiedRatio})`);
        if (ctx.claims.unverifiedClaimIds.length) {
          console.log(`  Unverified:     ${ctx.claims.unverifiedClaimIds.join(', ')}`);
        }
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

      case 'add-question': {
        const s = loadSession(sessionFile);
        const text = argValue(argv, '--text');
        const parentId = argValue(argv, '--parent') || null;
        const triggeredByEvidence = argValue(argv, '--triggered-by-evidence') || null;
        const triggeredByEntity = argValue(argv, '--triggered-by-entity') || null;
        const planItem = argValue(argv, '--plan-item') || null;
        if (!text) {
          console.error('Error: --text is required');
          process.exit(1);
        }
        const result = s.addQuestion({
          text, parentId, triggeredByEvidenceId: triggeredByEvidence,
          triggeredByEntityId: triggeredByEntity, planItemId: planItem,
        });
        saveSession(s, sessionFile);
        console.log(`✓ Added question ${result.id} (depth=${result.question.depth})`);
        if (parentId) console.log(`  Parent:           ${parentId}`);
        if (triggeredByEvidence) console.log(`  Triggered by ev:  ${triggeredByEvidence}`);
        if (triggeredByEntity) console.log(`  Triggered by ent: ${triggeredByEntity}`);
        if (planItem) console.log(`  Plan item:        ${planItem}`);
        break;
      }

      case 'update-question': {
        const s = loadSession(sessionFile);
        const id = argValue(argv, '--id');
        const status = argValue(argv, '--status');
        const genEnt = parseList(argValue(argv, '--generated-entities'));
        const genRel = parseList(argValue(argv, '--generated-relationships'));
        if (!id) {
          console.error('Error: --id is required');
          process.exit(1);
        }
        s.updateQuestion(id, {
          status: status || undefined,
          generatedEntityIds: genEnt.length ? genEnt : undefined,
          generatedRelationshipIds: genRel.length ? genRel : undefined,
        });
        saveSession(s, sessionFile);
        console.log(`✓ Updated question ${id}`);
        if (status) console.log(`  Status:                 ${status}`);
        if (genEnt.length) console.log(`  Generated entities:     ${genEnt.join(', ')}`);
        if (genRel.length) console.log(`  Generated relationships:${genRel.join(', ')}`);
        break;
      }

      case 'list-questions': {
        const s = loadSession(sessionFile);
        const status = argValue(argv, '--status');
        // 区分 "--parent" 未出现 vs "--parent <id>" vs "--parent" (root only)
        const parentIdx = argv.indexOf('--parent');
        let parentId;
        if (parentIdx < 0) {
          parentId = undefined; // 不过滤
        } else {
          const next = argv[parentIdx + 1];
          parentId = next && !next.startsWith('--') ? next : null; // null = root only
        }
        const list = s.questionTree.listQuestions({
          status: status || undefined,
          parentId,
        });
        if (list.length === 0) {
          console.log('No questions found');
          break;
        }
        console.log(`Questions (${list.length}):`);
        for (const q of list) {
          const indent = '  '.repeat(q.depth);
          const trigger = q.triggeredByEvidenceId ? ` [ev:${q.triggeredByEvidenceId}]` : '';
          const triggerE = q.triggeredByEntityId ? ` [ent:${q.triggeredByEntityId}]` : '';
          const plan = q.planItemId ? ` (plan:${q.planItemId})` : '';
          console.log(`${indent}${q.id} [${q.status}] (d=${q.depth}) ${q.text}${trigger}${triggerE}${plan}`);
          if (q.generatedEntityIds.length) console.log(`${indent}  ↳ entities: ${q.generatedEntityIds.join(', ')}`);
          if (q.generatedRelationshipIds.length) console.log(`${indent}  ↳ rels:     ${q.generatedRelationshipIds.join(', ')}`);
        }
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
        // 过滤掉 --session 及其值，剩余 tokens 拼成问题文本
        const tokens = argv.slice(1).filter((tok, i, arr) => {
          if (tok === '--session') return false;
          if (i > 0 && arr[i - 1] === '--session') return false;
          return true;
        });
        const q = tokens.join(' ').trim();
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

      case 'assess-evidence': {
        const s = loadSession(sessionFile);
        const evidenceId = argValue(argv, '--id');
        if (!evidenceId) {
          console.error('Error: --id is required');
          process.exit(1);
        }
        const result = assessEvidenceQualityById(s.graph, evidenceId);
        console.log(JSON.stringify(result, null, 2));
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
        const sourceType = argValue(argv, '--source-type') || '';
        const sourceAuthority = parseFloat(argValue(argv, '--source-authority') || '0');
        const sourceIndependence = parseFloat(argValue(argv, '--source-independence') || '0');
        const sourceRetrievedAt = argValue(argv, '--source-retrieved-at') || '';
        if (!source) {
          console.error('Error: --source is required');
          process.exit(1);
        }
        const sourceMetadata = sourceType
          ? {
              type: sourceType,
              authority: sourceAuthority || _defaultAuthorityForSourceType(sourceType),
              independence: sourceIndependence || 1.0,
              retrievedAt: sourceRetrievedAt || new Date().toISOString(),
            }
          : null;
        const ev = s.graph.addEvidence({ source, uri, content, confidence, lastUpdated, claims, sourceMetadata });
        saveSession(s, sessionFile);
        console.log(`✓ Added evidence ${ev.id}: source=${source}, confidence=${confidence}` +
          (lastUpdated ? `, lastUpdated=${lastUpdated}` : '') +
          (claims.length ? `, claims=${claims.length}` : '') +
          (ev.sourceMetadata ? `, sourceMetadata=${ev.sourceMetadata.type}` : ''));
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

      case 'add-claim': {
        const s = loadSession(sessionFile);
        const text = argValue(argv, '--text');
        const type = argValue(argv, '--type');
        const evidenceIds = parseList(argValue(argv, '--evidence'));
        const reasoning = argValue(argv, '--reasoning') || '';
        const confidence = parseFloat(argValue(argv, '--confidence') || '0.5');
        const supportingClaimIds = parseList(argValue(argv, '--supports'));
        const entityId = argValue(argv, '--entity') || null;
        if (!text || !type) {
          console.error('Error: --text and --type are required');
          process.exit(1);
        }
        try {
          const result = s.addClaim({
            text, type, evidenceIds, reasoning, confidence,
            supportingClaimIds, entityId,
          });
          saveSession(s, sessionFile);
          console.log(`✓ Added claim ${result.id} (type=${type}, confidence=${confidence})`);
          if (evidenceIds.length) console.log(`  Evidence:    ${evidenceIds.join(', ')}`);
          if (reasoning) console.log(`  Reasoning:   ${reasoning}`);
          if (supportingClaimIds.length) console.log(`  Supports:    ${supportingClaimIds.join(', ')}`);
          if (entityId) console.log(`  Entity:      ${entityId}`);
        } catch (e) {
          console.error(`Error: ${e.message}`);
          process.exit(1);
        }
        break;
      }

      case 'verify-claim': {
        const s = loadSession(sessionFile);
        const id = argValue(argv, '--id');
        if (!id) {
          console.error('Error: --id is required');
          process.exit(1);
        }
        // 支持 --verified (boolean flag) 或 --verified false 显式取消验证
        const verifiedIdx = argv.indexOf('--verified');
        let verified = true;
        if (verifiedIdx >= 0) {
          const next = argv[verifiedIdx + 1];
          if (next === undefined || next.startsWith('--')) {
            verified = true; // boolean flag: --verified
          } else if (next === 'true' || next === '') {
            verified = true;
          } else if (next === 'false') {
            verified = false;
          } else {
            verified = true; // unknown value, treat as truthy flag
          }
        }
        const note = argValue(argv, '--note') || '';
        const c = s.verifyClaim(id, { verified, note });
        saveSession(s, sessionFile);
        console.log(`✓ Claim ${id} marked ${c.verified ? 'verified' : 'unverified'}`);
        if (note) console.log(`  Note: ${note}`);
        break;
      }

      case 'link-claim-evidence': {
        const s = loadSession(sessionFile);
        const id = argValue(argv, '--id');
        if (!id) {
          console.error('Error: --id is required');
          process.exit(1);
        }
        const evList = argValue(argv, '--evidence');
        if (!evList) {
          console.error('Error: --evidence <ev1,ev2,...> is required');
          process.exit(1);
        }
        const evidenceIds = evList.split(',').map((x) => x.trim()).filter(Boolean);
        const c = s.linkClaimEvidence(id, evidenceIds);
        saveSession(s, sessionFile);
        console.log(`✓ Linked ${evidenceIds.length} evidence to claim ${id}`);
        console.log(`  Evidence: ${c.evidenceIds.join(', ')}`);
        break;
      }

      case 'list-claims': {
        const s = loadSession(sessionFile);
        const type = argValue(argv, '--type');
        const verifiedFlag = argv.includes('--verified');
        let verifiedFilter;
        if (verifiedFlag) {
          // 支持 --verified false
          const idx = argv.indexOf('--verified');
          const next = argv[idx + 1];
          verifiedFilter = next === 'false' ? false : true;
        }
        const list = s.claims.listClaims({ type: type || undefined, verified: verifiedFilter });
        if (list.length === 0) {
          console.log('No claims found');
          break;
        }
        console.log(`Claims (${list.length}):`);
        for (const c of list) {
          const v = c.verified ? '✓' : '·';
          console.log(`  ${v} ${c.id} [${c.type}] (conf=${c.confidence}) ${c.text}`);
          if (c.evidenceIds.length) console.log(`      evidence: ${c.evidenceIds.join(', ')}`);
          if (c.reasoning) console.log(`      reasoning: ${c.reasoning}`);
          if (c.verificationNote) console.log(`      note: ${c.verificationNote}`);
        }
        const cov = s.claims.coverage();
        console.log(`\nCoverage: ${cov.withEvidence}/${cov.total} = ${cov.coverageRatio} (verified: ${cov.verified}/${cov.total} = ${cov.verifiedRatio})`);
        break;
      }

      case 'coverage': {
        const s = loadSession(sessionFile);
        const cov = s.claimCoverage();
        console.log(`Claim Coverage:`);
        console.log(`  Total claims:         ${cov.total}`);
        console.log(`  Claims with evidence: ${cov.withEvidence}`);
        console.log(`  Coverage ratio:       ${cov.coverageRatio}`);
        console.log(`  Verified claims:      ${cov.verified}`);
        console.log(`  Verified ratio:       ${cov.verifiedRatio}`);
        if (cov.unverifiedClaimIds.length) {
          console.log(`  Unverified:           ${cov.unverifiedClaimIds.join(', ')}`);
        }
        const threshold = s.contract && s.contract.evidenceRequirement
          ? s.contract.evidenceRequirement.claimCoverageRatio
          : DEFAULT_CLAIM_COVERAGE_THRESHOLD;
        if (cov.total > 0) {
          const status = cov.coverageRatio >= threshold ? '✓ pass' : '✗ below threshold';
          console.log(`  Threshold:            ${threshold} (${status})`);
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

      case 'decide': {
        const s = loadSession(sessionFile);
        // 确保 analysis 已跑过
        if (!s.confidence) s.analyze();
        const result = s.decide();
        saveSession(s, sessionFile);
        const icon = result.decision === 'continue' ? '↻' : '✓';
        console.log(`${icon} Decision: ${result.decision.toUpperCase()}`);
        console.log(`  Reasons:`);
        for (const r of result.reasons) console.log(`    - ${r}`);
        console.log(`  Snapshot:`);
        console.log(`    entities:       ${result.snapshot.entityCount}`);
        console.log(`    evidence:       ${result.snapshot.evidenceCount}`);
        console.log(`    relationships:  ${result.snapshot.relationshipCount}`);
        console.log(`    gaps:           ${result.snapshot.gapCount}`);
        console.log(`    contradictions: ${result.snapshot.contradictionCount}`);
        console.log(`    open questions: ${result.snapshot.openQuestions}`);
        if (result.lastSnapshot) {
          console.log(`  Last snapshot diff:`);
          console.log(`    Δentities:       ${result.snapshot.entityCount - result.lastSnapshot.entityCount}`);
          console.log(`    Δrelationships:  ${result.snapshot.relationshipCount - result.lastSnapshot.relationshipCount}`);
          console.log(`    Δgaps:           ${result.snapshot.gapCount - result.lastSnapshot.gapCount}`);
          console.log(`    Δcontradictions: ${result.snapshot.contradictionCount - result.lastSnapshot.contradictionCount}`);
        }
        if (result.confidence) {
          console.log(`  Confidence:    ${result.confidence.level} (score=${result.confidence.score})`);
        }
        console.log(`  Budget: ${result.budget.withinBudget ? '✓ within' : '✗ exceeded'}`);
        if (!result.budget.withinBudget) {
          console.log(`    ${result.budget.reasons.join('; ')}`);
        }
        if (result.decision === 'continue') {
          console.log(`\n→ Continue Expand: collect more evidence, generate new questions.`);
        } else {
          console.log(`\n→ Converge to Report: run 'report-template' to finalize.`);
        }
        break;
      }

      case 'completion-assessment': {
        const s = loadSession(sessionFile);
        if (!s.confidence) s.analyze();
        const result = assessCompletion(s);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'check-budget': {
        const s = loadSession(sessionFile);
        const result = checkBudget(s);
        console.log(`Budget: ${result.withinBudget ? '✓ within' : '✗ exceeded'}`);
        console.log(`  Limits:`);
        console.log(`    depth:             ${result.limit.depth}`);
        console.log(`    max questions:     ${result.limit.maxQuestions}`);
        console.log(`    max evidence:      ${result.limit.maxEvidence}`);
        console.log(`    time limit (min):  ${result.limit.timeLimitMinutes}`);
        console.log(`  Usage:`);
        console.log(`    depth:             ${result.usage.depth}`);
        console.log(`    questions:         ${result.usage.questions}`);
        console.log(`    evidence:          ${result.usage.evidence}`);
        console.log(`    elapsed (min):     ${result.usage.elapsedMinutes.toFixed(1)}`);
        if (!result.withinBudget) {
          console.log(`  ⚠ Exceeded:`);
          for (const r of result.reasons) console.log(`    - ${r}`);
        }
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
          console.log(`  Traceability: coverage=${template.traceability.claimCoverageRatio} ` +
            `(${template.traceability.claimsWithEvidence}/${template.traceability.totalClaims} claims), ` +
            `${template.traceability.sourceCount} sources, ${template.traceability.evidenceCount} evidence`);
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
        const result = validateReport(report, s.graph, {
          contract: s.contract,
          claims: s.claims,
        });
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

      case 'benchmark': {
        const taskId = argValue(argv, '--task');
        const { passed, results } = runBenchmark({ taskId });
        console.log(`Benchmark: ${passed ? '✓ all passed' : '✗ some failed'} (${results.length} task(s))\n`);
        for (const r of results) {
          console.log(`${r.passed ? '✓' : '✗'} ${r.task}${r.title ? ` — ${r.title}` : ''}`);
          if (!r.passed) {
            for (const e of r.errors) console.log(`    · ${e}`);
          }
        }
        if (!passed) process.exit(1);
        break;
      }

      case 'eval': {
        const scenarioId = argValue(argv, '--scenario');
        const { passed, results } = runEval({ scenarioId });
        console.log(`Eval: ${passed ? '✓ all passed' : '✗ some failed'} (${results.length} scenario(s))\n`);
        for (const r of results) {
          console.log(`${r.passed ? '✓' : '✗'} ${r.scenario}${r.title ? ` — ${r.title}` : ''}`);
          if (!r.passed) {
            for (const e of r.errors) console.log(`    · ${e}`);
          }
        }
        if (!passed) process.exit(1);
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
  // Ontology
  ONTOLOGY,
  validateEntityType,
  validateRelation,
  // Graph + Evidence
  EvidenceGraph,
  getSourceWeight,
  SOURCE_WEIGHTS,
  // Contract + Budget
  DEFAULT_BUDGET,
  DEFAULT_EVIDENCE_REQUIREMENT,
  DEFAULT_CLAIM_COVERAGE_THRESHOLD,
  createContract,
  createBudget,
  checkBudget,
  // Question Tree
  QuestionTree,
  QUESTION_STATUS,
  // Claim Store
  ClaimStore,
  CLAIM_TYPES,
  CLAIM_EVIDENCE_REQUIREMENTS,
  // Analysis
  analyzeGaps,
  analyzeContradictions,
  assessConfidence,
  // Decision
  decide,
  // Report
  REPORT_REQUIRED_SECTIONS,
  CONFIDENCE_LEVELS,
  validateReport,
  reportTemplate,
  // Visualization
  graphToMermaid,
  // Session + Persistence
  ResearchSession,
  saveSession,
  loadSession,
};
