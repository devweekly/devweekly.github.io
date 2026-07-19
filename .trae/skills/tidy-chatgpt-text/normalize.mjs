#!/usr/bin/env node
/**
 * LLM Markdown Normalizer — V1
 *
 * 定位：基于 mdast 的 Markdown 静态分析与自动规范化引擎。
 * JS 负责确定性分析与机械修复，LLM 只负责需要语义理解的改写和转换。
 *
 * Hybrid Architecture:
 *   JS  →  AST 解析 + 确定性机械修复 + 检测 + Issue 生成
 *   LLM → 语义保持改写 + 去 AI 味 + ASCII→Mermaid
 *
 * 双 API（Rule 修改 AST 的两种方式）:
 *   ctx.fix(...)     — 95% 场景：deterministic + local + conflict-free，直接 mutate
 *   ctx.propose(...) —  5% 场景：LLM Rewrite / Heading Merge / Diagram Conversion / Paragraph Merge
 *
 * 三种运行模式:
 *   --check   Dry Run，只检测输出问题清单，退出码 0/1
 *   --report  自动修复 + 输出 issues.json
 *   --fix     自动修复 + 输出结果（默认）
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import { visit as unistVisit } from 'unist-util-visit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ============================================================
//  1. Config & Profiles（strict / default / relaxed + extends）
// ============================================================

const PROFILES = {
  strict: {
    confidenceThreshold: 0.90,
    rules: {
      allowEmoji: false,
      preferTable: true,
      aiCleanup: true,
      asciiDiagramAction: 'mermaid',
    },
  },
  default: {
    confidenceThreshold: 0.80,
    rules: {
      allowEmoji: false,
      preferTable: true,
      aiCleanup: true,
      asciiDiagramAction: 'mermaid',
    },
  },
  relaxed: {
    confidenceThreshold: 0.70,
    rules: {
      allowEmoji: true,
      preferTable: false,
      aiCleanup: true,
      asciiDiagramAction: 'mermaid',
    },
  },
};

// resolveProfile: 支持 extends + rules 覆盖（programmatic 用，CLI 用预设名）
function resolveProfile(name, overrides) {
  const base = PROFILES[name] || PROFILES.default;
  if (!overrides) return base;
  const extended = overrides.extends ? resolveProfile(overrides.extends) : base;
  return {
    ...extended,
    ...overrides,
    extends: undefined,
    rules: { ...extended.rules, ...(overrides.rules || {}) },
  };
}

const AI_PHRASES = [
  '真正重要的是', '其实真正重要的是', '核心在于', '关键点在于', '值得注意的是',
  '需要强调的是', '值得一提的是', '不仅如此', '接下来我们来看', '让我们来看',
  '总的来说', '综上所述', '总而言之', '事实上', '实际上', '其实', '当然', '确实',
  '首先', '其次', '最后', '总的来讲', '总体而言',
];

const AI_FIRST_PERSON = ['我建议', '我觉得', '我认为', '我会', '我不会', '我想', '我们需要', '我们可以'];

// ============================================================
//  2. Rule Metadata Registry
//
//  Rule 不再只是代码，而是 Metadata。
//  CLI / Report / Docs 全部可从 RULES 自动生成。
//  投入极低，收益极高。
// ============================================================

const RULES = {};

function registerRule(meta) {
  if (!meta.id) throw new Error('registerRule: id is required');
  RULES[meta.id] = {
    id: meta.id,
    category: meta.category || 'general',
    autofix: meta.autofix ?? false,
    llm: meta.llm ?? false,
    confidence: meta.confidence ?? 0,
    tags: meta.tags || [],
    description: meta.description || '',
  };
}

// Pre-declare all rule metadata（Pass 内引用这些 id）
registerRule({ id: 'remove-empty-paragraph', category: 'whitespace', autofix: true, llm: false, confidence: 0.99, tags: ['paragraph'], description: 'Remove empty paragraph' });
registerRule({ id: 'trim-trailing-whitespace', category: 'whitespace', autofix: true, llm: false, confidence: 0.99, tags: ['text'], description: 'Trim trailing whitespace' });
registerRule({ id: 'merge-adjacent-lists', category: 'structure', autofix: true, llm: false, confidence: 0.85, tags: ['list'], description: 'Merge adjacent lists of same type' });
registerRule({ id: 'heading-skip-level', category: 'structure', autofix: true, llm: false, confidence: 0.90, tags: ['heading'], description: 'Fix heading skip level' });
registerRule({ id: 'code-block-missing-lang', category: 'validation', autofix: false, llm: true, confidence: 0.95, tags: ['code'], description: 'Code block missing language identifier' });
registerRule({ id: 'ascii-diagram', category: 'diagram', autofix: false, llm: true, confidence: 0.78, tags: ['ascii', 'mermaid'], description: 'ASCII diagram detected, convert to mermaid or table' });
registerRule({ id: 'diagram-ir-extracted', category: 'diagram', autofix: true, llm: false, confidence: 0.85, tags: ['ascii', 'ir'], description: 'Auto-extracted Diagram IR from ASCII' });
registerRule({ id: 'ai-phrase', category: 'ai-style', autofix: false, llm: true, confidence: 0.62, tags: ['phrase'], description: 'AI template phrase detected' });
registerRule({ id: 'ai-first-person-heading', category: 'ai-style', autofix: false, llm: true, confidence: 0.75, tags: ['heading', 'first-person'], description: 'First-person voice in heading' });
registerRule({ id: 'fragment-sentence', category: 'structure', autofix: false, llm: true, confidence: 0.92, tags: ['paragraph', 'fragment'], description: 'Fragmented short paragraphs should merge' });
registerRule({ id: 'mermaid-node-name-escape', category: 'validation', autofix: false, llm: true, confidence: 0.95, tags: ['mermaid'], description: 'Mermaid node name needs escaping' });

// ============================================================
//  3. Parser & Stringifier
// ============================================================

const parser = unified().use(remarkParse).use(remarkGfm);
const stringifier = unified().use(remarkStringify).use(remarkGfm, {
  bullet: '-',
  listItemIndent: 'one',
  fences: true,
});

const parseMarkdown = (text) => parser.parse(text);
const stringifyMarkdown = (tree) => stringifier.stringify(tree);

// ============================================================
//  4. AST Mutation Layer（安全工具）
//
//  所有 AST 修改都经过这里，避免直接构造 node 导致 position/data 缺失。
// ============================================================

function cloneNode(node) {
  return structuredClone(node);
}

function createNode(type, props = {}) {
  return {
    type,
    ...(props.children ? { children: props.children } : {}),
    ...(props.value !== undefined ? { value: props.value } : {}),
    ...(props.depth ? { depth: props.depth } : {}),
    ...(props.ordered !== undefined ? { ordered: props.ordered } : {}),
    ...(props.lang ? { lang: props.lang } : {}),
    ...props,
  };
}

function replaceNode(parent, index, newNode) {
  if (!parent || !parent.children || index < 0 || index >= parent.children.length) {
    throw new Error(`replaceNode: invalid index ${index}`);
  }
  parent.children[index] = newNode;
}

function removeNode(parent, index) {
  if (!parent || !parent.children || index < 0 || index >= parent.children.length) {
    throw new Error(`removeNode: invalid index ${index}`);
  }
  parent.children.splice(index, 1);
}

function insertNode(parent, index, newNode) {
  if (!parent || !parent.children) {
    throw new Error('insertNode: parent has no children');
  }
  parent.children.splice(index, 0, newNode);
}

function mergeChildren(parent, startIdx, endIdx, mergedChildren) {
  parent.children.splice(startIdx, endIdx - startIdx, ...mergedChildren);
}

// ============================================================
//  5. AST Utils（基于 unist-util-visit）
// ============================================================

function collectText(node) {
  const parts = [];
  unistVisit(node, 'text', (t) => parts.push(t.value));
  return parts.join('');
}

function getStartLine(node) {
  return node?.position?.start?.line ?? -1;
}

function getEndLine(node) {
  return node?.position?.end?.line ?? -1;
}

function getContextChunk(fullLines, startLine, endLine, beforeLines = 2, afterLines = 2) {
  if (startLine < 0) return { before: '', chunk: '', after: '' };
  const s = Math.max(0, startLine - 1 - beforeLines);
  const e = Math.min(fullLines.length, endLine + afterLines);
  const chunkLines = fullLines.slice(startLine - 1, endLine);
  const beforeLinesArr = fullLines.slice(s, startLine - 1);
  const afterLinesArr = fullLines.slice(endLine, e);
  return {
    before: beforeLinesArr.join('\n'),
    chunk: chunkLines.join('\n'),
    after: afterLinesArr.join('\n'),
  };
}

// ============================================================
//  6. RuleContext（Pass 执行上下文，双 API）
//
//  ctx.fix(...)     — 95% 场景：deterministic + local + conflict-free
//                     内部：check threshold → mutate → record change → record applied issue
//  ctx.propose(...) — 5% 场景：可能冲突的操作（LLM Rewrite / Heading Merge / Diagram Conversion / Paragraph Merge）
//                     输出 Edit Proposal，由 Planner 统一仲裁 + 应用
//  ctx.report(...)  — 只检测，不修改
// ============================================================

// Explainability — 自动推导 issue 的 matched 和 why
function deriveMatched(issue) {
  const sample = issue.sample || '';
  const rule = issue.rule || '';
  if (rule.includes('ascii') || rule.includes('diagram')) {
    return ['包含箭头/树字符的 ASCII 图', '无法被 Markdown 渲染器渲染'];
  }
  if (rule.includes('phrase')) return [`检测到 AI 口头禅: "${sample}"`];
  if (rule.includes('first-person')) return [`标题含第一人称: "${sample}"`];
  if (rule.includes('fragment')) return ['连续短段落', '每段小于 20 字符', '破坏信息密度'];
  if (rule.includes('mermaid')) return ['Mermaid 节点名含空格未转义'];
  if (rule.includes('lang')) return ['代码块缺少语言标识'];
  if (rule.includes('empty-paragraph')) return ['空段落无内容'];
  if (rule.includes('trailing-whitespace')) return ['行尾有多余空白字符'];
  if (rule.includes('merge') && rule.includes('list')) return ['两个相邻同类 list 节点', '中间仅隔空行'];
  if (rule.includes('heading') && rule.includes('skip')) return ['Heading 层级跳跃'];
  return [rule];
}

function deriveWhy(issue) {
  const rule = issue.rule || '';
  const suggestion = issue.suggestion || '';
  if (suggestion) return suggestion;
  if (rule.includes('ascii')) return 'ASCII 图无法渲染，应转为 Mermaid 或表格';
  if (rule.includes('phrase')) return 'AI 口头禅降低专业性，应删除';
  if (rule.includes('first-person')) return '第一人称语气不符合技术文档规范';
  if (rule.includes('fragment')) return '碎片化段落破坏信息密度';
  if (rule.includes('mermaid')) return '节点名未转义会导致 Mermaid 渲染错误';
  if (rule.includes('empty-paragraph')) return '空段落占用版面，应删除';
  if (rule.includes('trailing-whitespace')) return '行尾空白造成 diff 噪音';
  if (rule.includes('merge') && rule.includes('list')) return '同类列表分离降低结构一致性';
  if (rule.includes('heading') && rule.includes('skip')) return 'Heading 跳级破坏文档结构';
  return '';
}

class RuleContext {
  constructor({ tree, fullLines, profile, profileName, level, mode }) {
    this.tree = tree;
    this.fullLines = fullLines;
    this.profile = profile;
    this.profileName = profileName;
    this.level = level;
    this.mode = mode;
    this.canAuto = mode !== 'check';
    this.changes = [];
    this.issues = [];
    this.issueCounter = 1;
    this.aiScore = null;
    this.symbols = null;
    this.stats = {
      emptyParagraphs: 0,
      mergedLists: 0,
      headingSkips: 0,
      asciiDiagrams: 0,
      aiPhrases: 0,
      fragmentSentences: 0,
      mermaidIssues: 0,
      trailingWhitespace: 0,
    };
    this._proposals = [];
  }

  visit(test, fn) {
    return unistVisit(this.tree, test, fn);
  }

  // ===== 95% 场景：deterministic + local + conflict-free =====
  // 调用方传入 apply() 回调执行 mutation，ctx.fix 负责阈值判断 + 记录
  fix({ rule, pass, confidence, location, sample = '', suggestion = '', context, apply }) {
    if (this.canAuto && confidence >= (this.profile.confidenceThreshold || 0)) {
      // 执行 mutation
      if (typeof apply === 'function') apply();
      this.changes.push({ rule, pass, action: 'applied', location });
      this.issues.push({
        id: `issue-${String(this.issueCounter++).padStart(3, '0')}`,
        rule, pass,
        severity: 'low',
        confidence,
        action: 'auto_fix',
        applied: true,
        location,
        context: context || { chunk: '' },
        sample,
        suggestion,
        evidence: {
          matched: deriveMatched({ rule, sample }),
          why: deriveWhy({ rule, suggestion }),
        },
      });
    } else {
      // check 模式或低于阈值：只报告
      this.issues.push({
        id: `issue-${String(this.issueCounter++).padStart(3, '0')}`,
        rule, pass,
        severity: 'low',
        confidence,
        action: 'auto_fix',
        applied: false,
        location,
        context: context || { chunk: '' },
        sample,
        suggestion,
        evidence: {
          matched: deriveMatched({ rule, sample }),
          why: deriveWhy({ rule, suggestion }),
        },
      });
    }
  }

  // ===== 只检测不修改 =====
  report(issue) {
    const fullIssue = {
      id: `issue-${String(this.issueCounter++).padStart(3, '0')}`,
      ...issue,
      evidence: issue.evidence || {
        matched: deriveMatched(issue),
        why: deriveWhy(issue),
      },
      applied: issue.applied ?? false,
    };
    this.issues.push(fullIssue);
    return fullIssue;
  }

  // ===== 5% 场景：可能冲突的操作，输出 Edit Proposal =====
  // edit: { targetNode, parent, index, operation, newNode?, confidence, reason, rule, pass }
  propose(edit) {
    this._proposals.push(edit);
  }

  applied(rule, pass, detail = {}) {
    this.changes.push({ rule, pass, action: 'applied', ...detail });
  }

  mutate = {
    clone: cloneNode,
    create: createNode,
    replace: replaceNode,
    remove: removeNode,
    insert: insertNode,
    mergeChildren: mergeChildren,
  };
}

// ============================================================
//  7. Planner + Conflict Resolver（仅用于 ctx.propose 的 5% 场景）
//
//  多个 Rule 可能对同一节点提出 Edit，按 confidence 仲裁，保留胜者
// ============================================================

function resolveConflicts(proposals) {
  const groups = new Map();
  for (const p of proposals) {
    const key = p.targetNode || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const resolved = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      resolved.push(group[0]);
    } else {
      group.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      const winner = group[0];
      winner.conflictResolved = true;
      winner.conflictLosers = group.slice(1).map((g) => ({ rule: g.rule, confidence: g.confidence }));
      resolved.push(winner);
    }
  }
  return resolved;
}

function applyEdits(ctx, edits) {
  // 按 startLine 倒序排序，避免 index 漂移
  edits.sort((a, b) => {
    const la = a.targetNode?.position?.start?.line || a.location?.startLine || 0;
    const lb = b.targetNode?.position?.start?.line || b.location?.startLine || 0;
    return lb - la;
  });
  for (const edit of edits) {
    try {
      if (edit.operation === 'remove' && edit.parent && edit.index != null) {
        removeNode(edit.parent, edit.index);
        ctx.applied(edit.rule, edit.pass, { operation: 'remove', reason: edit.reason });
      } else if (edit.operation === 'replace' && edit.parent && edit.index != null && edit.newNode) {
        replaceNode(edit.parent, edit.index, edit.newNode);
        ctx.applied(edit.rule, edit.pass, { operation: 'replace', reason: edit.reason });
      } else if (edit.operation === 'insert' && edit.parent && edit.index != null && edit.newNode) {
        insertNode(edit.parent, edit.index, edit.newNode);
        ctx.applied(edit.rule, edit.pass, { operation: 'insert', reason: edit.reason });
      }
    } catch (e) {
      ctx.report({
        rule: edit.rule,
        pass: edit.pass || 'applyEdits',
        severity: 'low',
        confidence: 0,
        action: 'error',
        location: { startLine: -1, endLine: -1 },
        context: { chunk: '' },
        sample: '',
        suggestion: `Edit apply failed: ${e.message}`,
      });
    }
  }
}

// ============================================================
//  8. Pass Pipeline（简单 after: [] 依赖，拓扑排序）
//
//  Pass 接口:
//    { name, levels, after: [], run(ctx) }
//
//  after: ['diagram-detection']  表示此 Pass 在 diagram-detection 之后执行
//  不需要 produces/consumes/resources，Markdown 用不着 Compiler Framework 那一套
// ============================================================

const pipeline = [];

function registerPass(pass) {
  if (!pass.after) pass.after = [];
  pipeline.push(pass);
}

// 简单拓扑排序（DFS，基于 after 约束）
function topoSortPasses(passes) {
  const sorted = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(pass) {
    if (visited.has(pass.name)) return;
    if (visiting.has(pass.name)) return; // 环检测：跳过
    visiting.add(pass.name);
    for (const afterName of pass.after || []) {
      const dep = passes.find((p) => p.name === afterName);
      if (dep) visit(dep);
    }
    visiting.delete(pass.name);
    visited.add(pass.name);
    sorted.push(pass);
  }

  for (const p of passes) visit(p);
  return sorted;
}

function runPasses(ctx) {
  const activePasses = pipeline.filter((p) => p.levels.includes(ctx.level));
  const sorted = topoSortPasses(activePasses);

  for (const pass of sorted) {
    try {
      pass.run(ctx);
    } catch (e) {
      ctx.report({
        rule: pass.name,
        pass: pass.name,
        severity: 'high',
        confidence: 0,
        action: 'error',
        location: { startLine: -1, endLine: -1 },
        context: { chunk: '' },
        sample: '',
        suggestion: `Pass error: ${e.message}`,
      });
    }
  }

  // 5% 场景：统一应用 Proposals（如果有）
  if (ctx._proposals && ctx._proposals.length > 0) {
    const resolved = resolveConflicts(ctx._proposals);
    applyEdits(ctx, resolved);
  }
}

// ============================================================
//  9. Passes
// ============================================================

// ---- Pass 1: Whitespace（95% 用 ctx.fix） ----
registerPass({
  name: 'whitespace',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    // 1.1 移除空 paragraph
    const emptyParas = [];
    unistVisit(ctx.tree, 'paragraph', (node, index, parent) => {
      if ((node.children || []).length === 0) {
        emptyParas.push({ node, index, parent });
      }
    });
    emptyParas.reverse();
    for (const { node, index, parent } of emptyParas) {
      const line = getStartLine(node);
      ctx.fix({
        rule: 'remove-empty-paragraph',
        pass: 'whitespace',
        confidence: 0.99,
        location: { startLine: line, endLine: line },
        apply: () => {
          if (parent) ctx.mutate.remove(parent, index);
          ctx.stats.emptyParagraphs++;
        },
      });
    }

    // 1.2 行尾空白去除
    if (ctx.canAuto) {
      let count = 0;
      unistVisit(ctx.tree, 'text', (node) => {
        if (node.value && /[ \t]$/.test(node.value)) {
          const lines = node.value.split('\n');
          let changed = false;
          const trimmed = lines.map((l) => {
            const t = l.replace(/[ \t]+$/, '');
            if (t !== l) changed = true;
            return t;
          });
          if (changed) {
            node.value = trimmed.join('\n');
            count++;
          }
        }
      });
      if (count > 0) {
        ctx.applied('trim-trailing-whitespace', 'whitespace', { count });
        ctx.stats.trailingWhitespace += count;
      }
    }
  },
});

// ---- Pass 2: Block Structure（95% 用 ctx.fix） ----
registerPass({
  name: 'block-structure',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    // 2.1 相邻同类列表合并
    const listPairs = [];
    unistVisit(ctx.tree, 'list', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      const next = parent.children[index + 1];
      if (next && next.type === 'list' && next.ordered === node.ordered) {
        listPairs.push({ node, next, index, parent });
      }
    });
    listPairs.reverse();
    for (const { node, next, index, parent } of listPairs) {
      const startLine = getStartLine(node);
      const endLine = getEndLine(next);
      ctx.fix({
        rule: 'merge-adjacent-lists',
        pass: 'block-structure',
        confidence: 0.85,
        location: { startLine, endLine },
        context: getContextChunk(ctx.fullLines, startLine, endLine, 1, 1),
        apply: () => {
          node.children.push(...next.children);
          ctx.mutate.remove(parent, index + 1);
          ctx.stats.mergedLists++;
        },
      });
    }

    // 2.2 Heading 跳级修复
    const headings = [];
    unistVisit(ctx.tree, 'heading', (h) => headings.push(h));
    for (let i = 0; i < headings.length - 1; i++) {
      const cur = headings[i];
      const next = headings[i + 1];
      if (next.depth > cur.depth + 1) {
        const startLine = getStartLine(next);
        const endLine = getEndLine(next);
        const sample = `h${cur.depth} → h${next.depth}`;
        ctx.fix({
          rule: 'heading-skip-level',
          pass: 'block-structure',
          confidence: 0.90,
          location: { startLine, endLine },
          context: getContextChunk(ctx.fullLines, startLine, endLine, 1, 1),
          sample,
          suggestion: `Promote heading to h${cur.depth + 1}`,
          apply: () => {
            next.depth = cur.depth + 1;
            ctx.stats.headingSkips++;
          },
        });
      }
    }
  },
});

// ---- Pass 3: Inline Structure（只检测） ----
registerPass({
  name: 'inline-structure',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    unistVisit(ctx.tree, 'code', (code) => {
      if (!code.lang || code.lang.trim() === '') {
        const startLine = getStartLine(code);
        const endLine = getEndLine(code);
        ctx.report({
          rule: 'code-block-missing-lang',
          pass: 'inline-structure',
          severity: 'low',
          confidence: 0.95,
          action: 'llm_required',
          location: { startLine, endLine },
          context: getContextChunk(ctx.fullLines, startLine, endLine, 1, 1),
          sample: (code.value || '').slice(0, 80),
          suggestion: 'Add language identifier to code fence',
        });
      }
    });
  },
});

// ---- Pass 4: Diagram Detection（report + 可选 propose for 5% 场景） ----
registerPass({
  name: 'diagram-detection',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    unistVisit(ctx.tree, (node) => {
      if (node.type !== 'paragraph' && node.type !== 'code') return;
      if (node.type === 'code' && node.lang && node.lang.includes('mermaid')) return;
      const text = node.type === 'code' ? (node.value || '') : collectText(node);
      if (!text || text.length < 4) return;

      const score = scoreAsciiDiagram(text);
      if (score.score >= 0.60) {
        const startLine = getStartLine(node);
        const endLine = getEndLine(node);
        const context = getContextChunk(ctx.fullLines, startLine, endLine, 2, 2);
        ctx.report({
          rule: 'ascii-diagram',
          pass: 'diagram-detection',
          severity: score.score >= 0.8 ? 'high' : 'medium',
          confidence: Math.round(score.score * 100) / 100,
          action: 'llm_required',
          location: { startLine, endLine },
          context,
          sample: text.slice(0, 200),
          suggestion: 'Convert ASCII diagram to mermaid or table',
          metadata: { scoreBreakdown: score.breakdown, diagramType: score.diagramType },
        });
        ctx.stats.asciiDiagrams++;

        // 自动提取 Diagram IR（如果可识别）
        if (ctx.profile.rules.asciiDiagramAction === 'mermaid' && score.diagramType !== 'unknown') {
          const ir = parseDiagramIR(text, score.diagramType);
          if (ir && ir.nodes.length > 0) {
            ctx.report({
              rule: 'diagram-ir-extracted',
              pass: 'diagram-detection',
              severity: 'low',
              confidence: 0.85,
              action: 'auto_fix',
              location: { startLine, endLine },
              context,
              sample: JSON.stringify(ir),
              suggestion: `Auto-generated DiagramIR (${score.diagramType}), ${ir.nodes.length} nodes, ${ir.edges.length} edges. Mermaid preview available.`,
              metadata: { ir, mermaidPreview: generateMermaid(ir) },
              applied: true,
            });
          }
        }
      }
    });
  },
});

// ---- Pass 5: AI Score（4 维：phrase + heading + emoji + fragment） ----
registerPass({
  name: 'ai-score',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    const score = computeAiScore(ctx.tree, ctx.profile);
    ctx.aiScore = score;

    // 为每个 AI 短语生成 issue
    const phraseOccurrences = [];
    unistVisit(ctx.tree, 'paragraph', (node) => {
      const text = collectText(node);
      const startLine = getStartLine(node);
      for (const phrase of AI_PHRASES) {
        let idx = 0;
        while ((idx = text.indexOf(phrase, idx)) !== -1) {
          const localLine = text.slice(0, idx).split('\n').length;
          const lineNum = startLine + localLine - 1;
          phraseOccurrences.push({ phrase, line: lineNum });
          idx += phrase.length;
        }
      }
    });

    ctx.aiScore.phraseCount = phraseOccurrences.length;
    ctx.stats.aiPhrases = phraseOccurrences.length;

    const maxIssues = 10;
    for (let i = 0; i < Math.min(maxIssues, phraseOccurrences.length); i++) {
      const occ = phraseOccurrences[i];
      ctx.report({
        rule: 'ai-phrase',
        pass: 'ai-score',
        severity: 'low',
        confidence: 0.62,
        action: 'llm_required',
        location: { startLine: occ.line, endLine: occ.line },
        context: getContextChunk(ctx.fullLines, occ.line, occ.line, 1, 1),
        sample: occ.phrase,
        suggestion: 'Remove or rephrase AI template phrase',
      });
    }

    // 第一人称出现在 heading
    if (score.firstPersonHeading > 0) {
      unistVisit(ctx.tree, 'heading', (node) => {
        const text = collectText(node);
        for (const phrase of AI_FIRST_PERSON) {
          if (text.includes(phrase)) {
            const line = getStartLine(node);
            ctx.report({
              rule: 'ai-first-person-heading',
              pass: 'ai-score',
              severity: 'medium',
              confidence: 0.75,
              action: 'llm_required',
              location: { startLine: line, endLine: line },
              context: getContextChunk(ctx.fullLines, line, line, 1, 1),
              sample: phrase,
              suggestion: 'Remove first-person voice from heading',
            });
            break;
          }
        }
      });
    }
  },
});

// ---- Pass 6: Fragment Detection（report，合并走 LLM） ----
registerPass({
  name: 'fragment-detection',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    const children = ctx.tree.children || [];
    for (let i = 0; i < children.length - 1; i++) {
      const a = children[i];
      const b = children[i + 1];
      if (a.type !== 'paragraph' || b.type !== 'paragraph') continue;
      const textA = collectText(a);
      const textB = collectText(b);
      if (textA.length > 0 && textA.length < 15 && textB.length > 0 && textB.length < 15) {
        const startLine = getStartLine(a);
        const endLine = getEndLine(b);
        ctx.report({
          rule: 'fragment-sentence',
          pass: 'fragment-detection',
          severity: 'low',
          confidence: 0.92,
          action: 'llm_required',
          location: { startLine, endLine },
          context: getContextChunk(ctx.fullLines, startLine, endLine, 1, 1),
          sample: `${textA} ... ${textB}`,
          suggestion: 'Merge fragmented short paragraphs into one sentence',
        });
        ctx.stats.fragmentSentences++;
      }
    }
  },
});

// ---- Pass 7: Mermaid Validation（只检测） ----
registerPass({
  name: 'mermaid-validation',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    unistVisit(ctx.tree, 'code', (code) => {
      if (!code.lang || !code.lang.includes('mermaid')) return;
      const lines = (code.value || '').split('\n');
      const codeStartLine = getStartLine(code);
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const m = line.match(/(?:-->|---|->|=>|==>)\s*([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5\s]{2,})(?=\s*(?:-->|---|->|=>|==>|$|\|))/);
        if (m) {
          const node = m[1].trim();
          if (node.includes(' ') && !node.startsWith('"')) {
            const actualLine = codeStartLine + li;
            ctx.report({
              rule: 'mermaid-node-name-escape',
              pass: 'mermaid-validation',
              severity: 'medium',
              confidence: 0.95,
              action: 'llm_required',
              location: { startLine: actualLine, endLine: actualLine },
              context: { chunk: line },
              sample: node,
              suggestion: `Wrap node name in quotes: "${node}"`,
            });
            ctx.stats.mermaidIssues++;
          }
        }
      }
    });
  },
});

// ============================================================
//  10. ASCII Diagram Scoring（多维打分，避免误判）
// ============================================================

function scoreAsciiDiagram(text) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { score: 0, breakdown: {}, diagramType: 'unknown' };

  const breakdown = {};
  let score = 0;

  const shortLines = lines.filter((l) => l.trim().length < 30).length;
  const shortRatio = shortLines / lines.length;
  if (shortRatio >= 0.7) {
    score += 0.3;
    breakdown.shortLines = 0.3;
  } else {
    breakdown.shortLines = 0;
  }

  const arrowChars = (text.match(/[↓↑→←]/g) || []).length;
  const arrowSymbols = (text.match(/(-->|->|=>|==>|↑|↓)/g) || []).length;
  const totalArrows = arrowChars + arrowSymbols;
  if (totalArrows >= 2) {
    score += 0.3;
    breakdown.arrows = 0.3;
  } else if (totalArrows === 1) {
    score += 0.1;
    breakdown.arrows = 0.1;
  } else {
    breakdown.arrows = 0;
  }

  const treeChars = (text.match(/[│├└─┌┐┘]{3,}/g) || []).length;
  if (treeChars >= 1) {
    score += 0.2;
    breakdown.treeChars = 0.2;
  } else {
    breakdown.treeChars = 0;
  }

  const punctCount = (text.match(/[。.！!？?]/g) || []).length;
  if (punctCount === 0 && lines.length >= 2) {
    score += 0.2;
    breakdown.noPunctuation = 0.2;
  } else {
    breakdown.noPunctuation = 0;
  }

  const indentLevels = new Set();
  for (const l of lines) {
    const indent = l.match(/^(\s*)/)[1].length;
    if (indent > 0) indentLevels.add(indent);
  }
  if (indentLevels.size >= 2) {
    score += 0.1;
    breakdown.indentHierarchy = 0.1;
  } else {
    breakdown.indentHierarchy = 0;
  }

  let diagramType = 'unknown';
  if (treeChars >= 1 || indentLevels.size >= 2) {
    diagramType = 'tree';
  } else if (arrowChars >= 2 || arrowSymbols >= 2) {
    diagramType = 'flow';
  }

  return {
    score: Math.min(1, Math.round(score * 100) / 100),
    breakdown,
    diagramType,
  };
}

// ============================================================
//  11. Diagram IR + Mermaid Generator
//
//  Detector 提取结构化 IR，Generator 生成 mermaid 代码。
//  可测试、可自动生成，减少对 LLM 的依赖。
// ============================================================

function parseDiagramIR(text, diagramType) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const nodes = [];
  const edges = [];
  const seen = new Set();

  function addNode(name) {
    const clean = name.replace(/[│├└─→←↓↑]/g, '').trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      nodes.push(clean);
    }
    return clean;
  }

  if (diagramType === 'flow') {
    const arrowOnlyRe = /^[↓↑→←│├└─]+$|^(-->|->|=>|==>|─{2,}>?)$/;
    const merged = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (arrowOnlyRe.test(trimmed)) {
        if (merged.length > 0) {
          merged[merged.length - 1] += ' ' + trimmed + ' ';
        }
      } else {
        if (merged.length > 0 && /(?:↓|↑|→|←|-->|->|=>|==>)\s*$/.test(merged[merged.length - 1])) {
          merged[merged.length - 1] += trimmed;
        } else {
          merged.push(trimmed);
        }
      }
    }

    for (const line of merged) {
      const parts = line.split(/[↓↑→←]|-->|->|=>|==>/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        for (let i = 0; i < parts.length - 1; i++) {
          const a = addNode(parts[i]);
          const b = addNode(parts[i + 1]);
          if (a && b) edges.push([a, b]);
        }
      } else if (parts.length === 1) {
        addNode(parts[0]);
      }
    }
  } else if (diagramType === 'tree') {
    const hasTreeChars = lines.some((l) => /[│├└]/.test(l));
    if (hasTreeChars) {
      const rootName = addNode(lines[0].replace(/[│├└─]/g, '').trim());
      const stack = [{ indent: 0, name: rootName }];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const bars = (line.match(/│/g) || []).length;
        const indent = bars;
        const name = addNode(line.replace(/[│├└─]/g, '').trim());
        if (!name) continue;
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }
        if (stack.length > 0) {
          edges.push([stack[stack.length - 1].name, name]);
        }
        stack.push({ indent, name });
      }
    } else {
      const stack = [];
      for (const line of lines) {
        const indent = line.match(/^(\s*)/)[1].length;
        const name = addNode(line.trim());
        if (!name) continue;
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }
        if (stack.length > 0) {
          edges.push([stack[stack.length - 1].name, name]);
        }
        stack.push({ indent, name });
      }
    }
  }

  return { type: diagramType, nodes, edges };
}

function generateMermaid(ir) {
  if (!ir || !ir.nodes || ir.nodes.length === 0) return '';

  const lines = [];
  if (ir.type === 'tree' || ir.type === 'flow') {
    lines.push('flowchart TD');
    for (const node of ir.nodes) {
      // 节点名只含字母数字和空格 → 转下划线 ID，不加标签（空格→下划线视觉可读）
      // 节点名含其他特殊字符（括号/引号/斜杠等）→ 加引号标签保留原文
      if (/^[A-Za-z0-9 ]+$/.test(node)) {
        lines.push(`    ${nodeId(node)}`);
      } else {
        lines.push(`    ${nodeId(node)}["${node}"]`);
      }
    }
    for (const [a, b] of ir.edges) {
      lines.push(`    ${nodeId(a)} --> ${nodeId(b)}`);
    }
  }
  return lines.join('\n');
}

// 节点 ID：保留原词可读性，空格替换为下划线，禁止无意义缩写
function nodeId(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

// ============================================================
//  12. AI Score（4 维：phrase + heading + emoji + fragment）
//
//  Rule Engine 做不到真正判断 readability/coherence/style 等维度，
//  这些交给 LLM。Rule-based Prior + LLM Review 即可。
// ============================================================

function computeAiScore(tree, _profile) {
  const breakdown = {};

  let fullText = '';
  let sentenceCount = 0;
  let phraseCount = 0;
  unistVisit(tree, 'paragraph', (node) => {
    const text = collectText(node);
    fullText += text + '\n';
    sentenceCount += text.split(/[。.！!？?\n]+/).filter((s) => s.trim().length > 0).length;
    for (const phrase of AI_PHRASES) {
      let idx = 0;
      while ((idx = text.indexOf(phrase, idx)) !== -1) {
        phraseCount++;
        idx += phrase.length;
      }
    }
  });
  breakdown.phrase = sentenceCount > 0 ? Math.min(1, phraseCount / sentenceCount / 0.3) : 0;

  let headingCount = 0;
  let firstPersonHeading = 0;
  unistVisit(tree, 'heading', (node) => {
    headingCount++;
    const text = collectText(node);
    for (const phrase of AI_FIRST_PERSON) {
      if (text.includes(phrase)) {
        firstPersonHeading++;
        break;
      }
    }
  });
  breakdown.heading = headingCount > 0 ? Math.min(1, firstPersonHeading / headingCount) : 0;

  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}]/gu;
  const emojiCount = (fullText.match(emojiRegex) || []).length;
  breakdown.emoji = fullText.length > 0 ? Math.min(1, emojiCount / (fullText.length / 500)) : 0;

  const paragraphs = [];
  unistVisit(tree, 'paragraph', (node) => paragraphs.push(collectText(node)));
  const shortParas = paragraphs.filter((p) => p.length > 0 && p.length < 20).length;
  breakdown.fragmentation = paragraphs.length > 0 ? Math.min(1, shortParas / paragraphs.length / 0.3) : 0;

  const weights = { phrase: 0.4, heading: 0.25, emoji: 0.15, fragmentation: 0.2 };
  const total = Object.entries(weights).reduce(
    (sum, [k, w]) => sum + (breakdown[k] || 0) * w,
    0
  );

  const round2 = (n) => Math.round(n * 100) / 100;

  return {
    total: round2(total),
    breakdown: {
      phrase: round2(breakdown.phrase),
      heading: round2(breakdown.heading),
      emoji: round2(breakdown.emoji),
      fragmentation: round2(breakdown.fragmentation),
    },
    phraseCount,
    sentenceCount,
    firstPersonHeading,
    headingCount,
    emojiCount,
    recommendCleanup: total > 0.25 || phraseCount > 3,
  };
}

// ============================================================
//  13. Symbol Table（简化版：5 个 key，结束）
//
//  Markdown 没有 namespace/scope/cross-reference 这种语义，
//  不需要演进成 Language Server。保持:
//    { headings, tables, codeBlocks, diagrams, links }
// ============================================================

function extractSymbolTable(tree) {
  const symbols = {
    headings: [],
    tables: [],
    codeBlocks: [],
    diagrams: [],
    links: [],
  };

  unistVisit(tree, 'heading', (node) => {
    symbols.headings.push({
      level: node.depth,
      text: collectText(node),
      line: getStartLine(node),
    });
  });

  unistVisit(tree, 'table', (node) => {
    const rows = node.children ? node.children.length : 0;
    symbols.tables.push({ line: getStartLine(node), rows });
  });

  unistVisit(tree, 'code', (node) => {
    const lang = node.lang || '';
    symbols.codeBlocks.push({ line: getStartLine(node), lang });
    if (lang.toLowerCase() === 'mermaid') {
      symbols.diagrams.push({ line: getStartLine(node), type: 'mermaid' });
    }
  });

  unistVisit(tree, 'link', (node) => {
    if (node.url) {
      symbols.links.push({ url: node.url, text: collectText(node).slice(0, 60), line: getStartLine(node) });
    }
  });

  return symbols;
}

// ============================================================
//  14. Validators
// ============================================================

function validate(tree, original, normalized, level, ctx) {
  const result = { markdown: 'pass', mermaid: 'pass', semantic: 'pass', warnings: [] };

  const headings = [];
  unistVisit(tree, 'heading', (h) => headings.push(h));
  for (let i = 0; i < headings.length - 1; i++) {
    if (headings[i + 1].depth > headings[i].depth + 1) {
      result.markdown = 'warn';
      result.warnings.push('Heading skip level');
      break;
    }
  }

  if (ctx.stats.mermaidIssues > 0) {
    result.mermaid = 'warn';
  }

  if (level === 'L0') {
    const a = original.replace(/\s/g, '');
    const b = normalized.replace(/\s/g, '');
    if (a !== b) {
      result.semantic = 'fail';
      result.warnings.push('L0 violation: text content changed');
    }
  }

  return result;
}

// ============================================================
//  15. Issue Schema Output（保留 evidence，去掉 v2 冗余字段）
// ============================================================

function buildIssueSchema(document, profileName, level, ctx, validation, totalTokens) {
  const autoFixable = ctx.issues.filter((i) => i.action === 'auto_fix').length;
  const llmRequired = ctx.issues.filter((i) => i.action === 'llm_required').length;

  const issueTokens = ctx.issues.reduce((sum, i) => {
    return sum + (i.context?.chunk?.length || 0) / 2 + 50;
  }, 0);

  return {
    document,
    profile: profileName,
    level,
    stats: {
      totalTokens: Math.round(totalTokens),
      issueTokens: Math.round(issueTokens),
      savings: totalTokens > 0 ? `${Math.round((1 - issueTokens / totalTokens) * 100)}%` : '0%',
      issues: ctx.issues.length,
      autoFixable,
      llmRequired,
      appliedFixes: ctx.changes.length,
    },
    symbols: ctx.symbols || {},
    appliedFixes: ctx.changes,
    issues: ctx.issues,
    aiScore: ctx.aiScore || { total: 0, breakdown: {}, recommendCleanup: false },
    rules: Object.values(RULES),
    validation,
  };
}

// ============================================================
//  16. Reporter（人类可读的 check 模式输出）
// ============================================================

function buildCheckReport(ctx) {
  const lines = [];
  const autoFixable = ctx.issues.filter((i) => i.action === 'auto_fix');
  const llmRequired = ctx.issues.filter((i) => i.action === 'llm_required');

  lines.push(`Found ${ctx.issues.length} issues:`);
  lines.push('');

  const byRule = {};
  for (const iss of ctx.issues) {
    if (!byRule[iss.rule]) byRule[iss.rule] = [];
    byRule[iss.rule].push(iss);
  }

  for (const [rule, list] of Object.entries(byRule)) {
    const first = list[0];
    const icon = first.action === 'auto_fix' ? '✓' : '⚠';
    const tag = first.action === 'auto_fix' ? 'auto-fixable' : 'llm-required';
    const meta = RULES[rule] || {};
    const category = meta.category ? `(${meta.category})` : '';
    lines.push(`  ${icon} ${String(list.length).padStart(2, ' ')} ${rule.padEnd(30)} [${tag}, confidence ${first.confidence}] ${category}`);
  }

  lines.push('');
  lines.push('Summary:');
  lines.push(`  Applied:    ${ctx.changes.length} fixes`);
  lines.push(`  Auto-fix:   ${autoFixable.length} (pass --fix to apply)`);
  lines.push(`  LLM-req:    ${llmRequired.length} (pass --json to export)`);

  if (ctx.aiScore) {
    const b = ctx.aiScore.breakdown;
    lines.push(`  AI Score:   ${ctx.aiScore.total} (phrase=${b.phrase}, heading=${b.heading}, emoji=${b.emoji}, frag=${b.fragmentation})`);
    if (ctx.symbols) {
      const s = ctx.symbols;
      lines.push(`  Symbols:    ${s.headings?.length || 0} headings, ${s.tables?.length || 0} tables, ${s.codeBlocks?.length || 0} code, ${s.diagrams?.length || 0} diagrams, ${s.links?.length || 0} links`);
    }
    if (ctx.aiScore.recommendCleanup) lines.push('    ⚠ recommend L2 cleanup');
  }

  // Rule Metadata 统计（从 RULES registry 自动生成）
  const ruleCount = Object.keys(RULES).length;
  const categories = [...new Set(Object.values(RULES).map((r) => r.category))];
  lines.push(`  Rules:      ${ruleCount} registered (${categories.join(', ')})`);

  return lines.join('\n');
}

// ============================================================
//  17. Pipeline Runner
// ============================================================

function runPipeline(input, opts) {
  const { level = 'L1', profileName = 'default', mode = 'fix', document: docName } = opts;
  const profile = resolveProfile(profileName);

  const fullLines = input.split('\n');
  const totalTokens = input.length / 2;

  const tree = parseMarkdown(input);
  const ctx = new RuleContext({
    tree,
    fullLines,
    profile,
    profileName,
    level,
    mode,
  });

  // Symbol Table（简化版，Pass 通过 ctx.symbols 访问）
  ctx.symbols = extractSymbolTable(tree);

  // 运行 Pass Pipeline（topo sort + dual API）
  runPasses(ctx);

  // Stringify
  const normalized = stringifyMarkdown(tree);

  // Validate
  const treeAfter = parseMarkdown(normalized);
  const validation = validate(treeAfter, input, normalized, level, ctx);

  const issueSchema = buildIssueSchema(
    docName || 'input.md',
    profileName,
    level,
    ctx,
    validation,
    totalTokens
  );

  return {
    normalized,
    issueSchema,
    checkReport: buildCheckReport(ctx),
    ctx,
    validation,
  };
}

// ============================================================
//  18. CLI
// ============================================================

function printUsage() {
  console.log(`
Usage:
  node normalize.mjs <file.md> [options]

Modes (choose one):
  --check          Dry run - only detect issues, no changes (exit 0/1)
  --report         Auto-fix + output issues.json
  --fix            Auto-fix + output result (default)

Options:
  --level L0|L1|L2          Normalization level (default: L1)
  --profile <name>          Profile: strict|default|relaxed (default: default)
  --json <file>             Output issues.json to file (use with --report)
  -o <file>                 Output normalized markdown to file
  --doc <name>              Document name for issue schema
  --list-rules              List all registered rules with metadata

Examples:
  node normalize.mjs input.md --check
  node normalize.mjs input.md --report --json issues.json
  node normalize.mjs input.md --fix -o output.md
  node normalize.mjs input.md --profile strict --level L2
  node normalize.mjs --list-rules
  cat file.md | node normalize.mjs --level L2
`);
}

function listRules() {
  console.log('Registered Rules:\n');
  const byCategory = {};
  for (const rule of Object.values(RULES)) {
    if (!byCategory[rule.category]) byCategory[rule.category] = [];
    byCategory[rule.category].push(rule);
  }
  for (const [cat, rules] of Object.entries(byCategory)) {
    console.log(`[${cat}]`);
    for (const r of rules) {
      const flags = [
        r.autofix ? 'autofix' : '',
        r.llm ? 'llm' : '',
      ].filter(Boolean).join(',');
      console.log(`  ${r.id.padEnd(30)} confidence=${r.confidence} [${flags}] tags=[${r.tags.join(',')}]`);
      if (r.description) console.log(`    ${r.description}`);
    }
    console.log('');
  }
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (argv.includes('--list-rules')) {
    listRules();
    process.exit(0);
  }

  let input = '';
  let level = 'L1';
  let profileName = 'default';
  let mode = 'fix';
  let outFile = null;
  let jsonFile = null;
  let docName = 'input.md';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') mode = 'check';
    else if (a === '--report') mode = 'report';
    else if (a === '--fix') mode = 'fix';
    else if (a === '--level') level = argv[++i] || 'L1';
    else if (a === '--profile') profileName = argv[++i] || 'default';
    else if (a === '--json') jsonFile = argv[++i];
    else if (a === '-o') outFile = argv[++i];
    else if (a === '--doc') docName = argv[++i];
    else if (!a.startsWith('-') && !input) {
      input = fs.readFileSync(a, 'utf8');
      docName = path.basename(a);
    }
  }

  if (!input) {
    try {
      input = fs.readFileSync('/dev/stdin', 'utf8');
    } catch (e) {
      console.error('Error: no input file and stdin is empty');
      printUsage();
      process.exit(1);
    }
  }

  const result = runPipeline(input, { level, profileName, mode, document: docName });

  if (mode === 'check') {
    console.log(result.checkReport);
    const hasIssues = result.issueSchema.stats.issues > 0;
    process.exit(hasIssues ? 1 : 0);
  } else if (mode === 'report') {
    if (jsonFile) {
      fs.writeFileSync(jsonFile, JSON.stringify(result.issueSchema, null, 2));
      process.stderr.write(`Issues written to ${jsonFile} (${result.issueSchema.stats.issues} issues)\n`);
    }
    process.stdout.write(result.normalized);
  } else {
    if (outFile) {
      fs.writeFileSync(outFile, result.normalized);
      process.stderr.write(result.checkReport + '\n');
      process.stderr.write(`\nWritten to ${outFile}\n`);
    } else {
      process.stderr.write(result.checkReport + '\n\n');
      process.stdout.write(result.normalized);
    }
  }
}

// Export for programmatic use（test runner / library import）
export { runPipeline, registerPass, registerRule, RULES, PROFILES, resolveProfile };

// ESM 入口守卫：只在直接执行时运行 CLI，import 时不运行
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) main();
