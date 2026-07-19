#!/usr/bin/env node
/**
 * LLM Markdown Normalizer Engine — 单文件可执行（ESM，基于 unified/remark）
 *
 * Hybrid Architecture:
 *   JS  →  AST 解析 + 确定性机械修复 + 检测 + Issue 生成
 *   LLM → 语义保持改写 + 去 AI 味 + ASCII→Mermaid（需要语义判断）
 *
 * 架构改进（v2）:
 *   1. 使用 unist-util-visit 进行全树遍历（含 nested list/blockquote/table cell）
 *   2. Pass Pipeline 架构：显式 Pass 数组，每个 Pass 接收 RuleContext
 *   3. AST Mutation Layer：所有 mutation 经安全工具（cloneNode/replaceNode/createNode）
 *   4. ASCII 图评分制：多维打分（short lines + arrows + tree chars + no punctuation）
 *   5. AI Score 多维：phrase + heading + emoji + fragmentation
 *   6. Diagram IR + Mermaid Generator：detector 与 generator 分离
 *   7. Profile 配置增强：每个 profile 含 rules 配置
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

// ============================================================
//  1. Config & Profiles（含 rules 配置）
// ============================================================

const PROFILES = {
  'technical-doc': {
    headingDepth: 3,
    confidenceThreshold: 0.80,
    mermaid: true,
    rules: {
      allowEmoji: false,
      preferTable: true,
      aiCleanup: true,
      maxHeadingDepth: 4,
      asciiDiagramAction: 'mermaid',
    },
  },
  'blog': {
    headingDepth: 4,
    confidenceThreshold: 0.70,
    mermaid: true,
    rules: {
      allowEmoji: true,
      preferTable: false,
      aiCleanup: true,
      maxHeadingDepth: 5,
      asciiDiagramAction: 'mermaid',
    },
  },
  'rfc': {
    headingDepth: 3,
    confidenceThreshold: 0.90,
    mermaid: false,
    rules: {
      allowEmoji: false,
      preferTable: true,
      aiCleanup: false,
      maxHeadingDepth: 4,
      asciiDiagramAction: 'preserve',
    },
  },
  'architecture': {
    headingDepth: 4,
    confidenceThreshold: 0.80,
    mermaid: true,
    rules: {
      allowEmoji: false,
      preferTable: true,
      aiCleanup: true,
      maxHeadingDepth: 4,
      asciiDiagramAction: 'mermaid',
      allowedMermaidTypes: ['erDiagram', 'sequenceDiagram', 'flowchart', 'classDiagram'],
    },
  },
};

const AI_PHRASES = [
  '真正重要的是', '其实真正重要的是', '核心在于', '关键点在于', '值得注意的是',
  '需要强调的是', '值得一提的是', '不仅如此', '接下来我们来看', '让我们来看',
  '总的来说', '综上所述', '总而言之', '事实上', '实际上', '其实', '当然', '确实',
  '首先', '其次', '最后', '总的来讲', '总体而言',
];

const AI_FIRST_PERSON = ['我建议', '我觉得', '我认为', '我会', '我不会', '我想', '我们需要', '我们可以'];

// ============================================================
//  2. Parser & Stringifier
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
//  3. AST Mutation Layer（安全工具）
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
//  4. AST Utils（基于 unist-util-visit）
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
//  5. RuleContext（Pass 执行上下文）
//
//  每个 Pass 接收 RuleContext，包含:
//    - tree, fullLines, profile, level, mode
//    - visit(test, fn): 全树遍历（含 nested）
//    - report(issue): 记录 issue
//    - applied(change): 记录已应用的修复
//    - canAuto: 是否允许自动修复
//    - mutate: AST mutation 工具集
//    - symbols: v2 Symbol Table（Document Index）
// ============================================================

// v2: Explainability — 自动推导 issue 的 matched 和 why
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
  return [rule];
}

function deriveWhy(issue) {
  const rule = issue.rule || '';
  const suggestion = issue.suggestion || '';
  if (suggestion) return suggestion;
  if (rule.includes('ascii')) return 'ASCII 图无法渲染，应转为 Mermaid 或表格';
  if (rule.includes('phrase')) return 'AI 口头禅降低专业性，应删除';
  if (rule.includes('first-person')) return '第一人称语气不符合技术文档规范';
  if (rule.includes('fragment')) return '碎片化段落无法被 Document IR 识别为完整 Section';
  if (rule.includes('mermaid')) return '节点名未转义会导致 Mermaid 渲染错误';
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
  }

  visit(test, fn) {
    return unistVisit(this.tree, test, fn);
  }

  // v2: Issue 升级为 Evidence
  // 每个 issue 自动带 explainability（matched + why），调用方可传入自定义 evidence 覆盖
  report(issue) {
    // 自动生成基础 evidence（如果调用方未提供）
    const autoEvidence = issue.evidence || {
      matched: deriveMatched(issue),
      why: deriveWhy(issue),
    };
    const fullIssue = {
      id: `issue-${String(this.issueCounter++).padStart(3, '0')}`,
      ...issue,
      evidence: autoEvidence,
      applied: issue.applied ?? false,
    };
    this.issues.push(fullIssue);
    return fullIssue;
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
//  6. Pass 基类 & Pipeline
//
//  每个 Pass: { name, levels, run(ctx) }
//  Pipeline 是 Pass 数组，按顺序执行。
//  新增 Pass 只需 push 到 pipeline 数组。
// ============================================================

const pipeline = [];

function registerPass(pass) {
  pipeline.push(pass);
}

function runPasses(ctx) {
  for (const pass of pipeline) {
    if (!pass.levels.includes(ctx.level)) continue;
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
}

// ============================================================
//  7. Passes
// ============================================================

// ---- Pass 1: Whitespace ----
registerPass({
  name: 'whitespace',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    // 1.1 移除空 paragraph（用 visit 遍历整棵树，含 nested）
    const emptyParas = [];
    unistVisit(ctx.tree, 'paragraph', (node, index, parent) => {
      if ((node.children || []).length === 0) {
        emptyParas.push({ node, index, parent });
      }
    });
    emptyParas.reverse();
    for (const { node, index, parent } of emptyParas) {
      const line = getStartLine(node);
      const confidence = 0.99;
      if (ctx.canAuto && confidence >= ctx.profile.confidenceThreshold) {
        if (parent) ctx.mutate.remove(parent, index);
        ctx.applied('remove-empty-paragraph', this.name, { line });
        ctx.stats.emptyParagraphs++;
      } else {
        ctx.report({
          rule: 'remove-empty-paragraph',
          pass: 'whitespace',
          severity: 'low',
          confidence,
          action: 'auto_fix',
          location: { startLine: line, endLine: line },
          context: { chunk: '' },
          sample: '',
          suggestion: 'Remove empty paragraph',
        });
      }
    }

    // 1.2 行尾空白去除（text 节点内）
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
        ctx.applied('trim-trailing-whitespace', this.name, { count });
        ctx.stats.trailingWhitespace += count;
      }
    }
  },
});

// ---- Pass 2: Block Structure（用 visit 遍历全树，含 nested） ----
registerPass({
  name: 'block-structure',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    // 2.1 相邻同类列表合并（root level + nested）
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
      const confidence = 0.85;
      const startLine = getStartLine(node);
      const endLine = getEndLine(next);
      if (ctx.canAuto && confidence >= ctx.profile.confidenceThreshold) {
        node.children.push(...next.children);
        ctx.mutate.remove(parent, index + 1);
        ctx.applied('merge-adjacent-lists', this.name, { line: startLine });
        ctx.stats.mergedLists++;
      } else {
        ctx.report({
          rule: 'merge-adjacent-lists',
          pass: 'block-structure',
          severity: 'low',
          confidence,
          action: 'auto_fix',
          location: { startLine, endLine },
          context: getContextChunk(ctx.fullLines, startLine, endLine, 1, 1),
          sample: '',
          suggestion: 'Merge adjacent lists of same type',
        });
      }
    }

    // 2.2 Heading 跳级检测与修复
    const headings = [];
    unistVisit(ctx.tree, 'heading', (h) => headings.push(h));
    for (let i = 0; i < headings.length - 1; i++) {
      const cur = headings[i];
      const next = headings[i + 1];
      if (next.depth > cur.depth + 1) {
        const confidence = 0.90;
        const startLine = getStartLine(next);
        const endLine = getEndLine(next);
        const sample = `h${cur.depth} → h${next.depth}`;
        if (ctx.canAuto && confidence >= ctx.profile.confidenceThreshold) {
          next.depth = cur.depth + 1;
          ctx.applied('heading-skip-level', this.name, { line: startLine, detail: sample });
          ctx.stats.headingSkips++;
        } else {
          ctx.report({
            rule: 'heading-skip-level',
            pass: 'block-structure',
            severity: 'medium',
            confidence,
            action: 'auto_fix',
            location: { startLine, endLine },
            context: getContextChunk(ctx.fullLines, startLine, endLine, 1, 1),
            sample,
            suggestion: `Promote heading to h${cur.depth + 1}`,
          });
        }
      }
    }
  },
});

// ---- Pass 3: Inline Structure ----
registerPass({
  name: 'inline-structure',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    // 代码块缺语言标注（只能报告，不能自动补全）
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

// ---- Pass 4: Diagram Detection（评分制） ----
registerPass({
  name: 'diagram-detection',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    unistVisit(ctx.tree, (node) => {
      if (node.type !== 'paragraph' && node.type !== 'code') return;
      // 跳过 mermaid 代码块（已经是图，不需要转）
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

        // 如果 profile 要求 mermaid 且 diagramType 可识别，尝试自动生成 IR
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

// ---- Pass 5: AI Score（多维评分） ----
registerPass({
  name: 'ai-score',
  levels: ['L0', 'L1', 'L2'],
  run(ctx) {
    const score = computeAiScore(ctx.tree, ctx.profile);
    ctx.aiScore = score;

    // 为每个 AI 短语生成 issue（基于 paragraph 定位）
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

    // 第一人称出现在 heading，单独报告
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

// ---- Pass 6: Fragment Sentence Detection ----
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

// ---- Pass 7: Mermaid Validation ----
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
//  8. ASCII Diagram Scoring（多维打分，避免误判）
// ============================================================

function scoreAsciiDiagram(text) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { score: 0, breakdown: {}, diagramType: 'unknown' };

  const breakdown = {};
  let score = 0;

  // 1. 短行比例（每行 < 30 字符）
  const shortLines = lines.filter((l) => l.trim().length < 30).length;
  const shortRatio = shortLines / lines.length;
  if (shortRatio >= 0.7) {
    score += 0.3;
    breakdown.shortLines = 0.3;
  } else {
    breakdown.shortLines = 0;
  }

  // 2. 箭头/连接符
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

  // 3. 树形字符
  const treeChars = (text.match(/[│├└─┌┐┘]{3,}/g) || []).length;
  if (treeChars >= 1) {
    score += 0.2;
    breakdown.treeChars = 0.2;
  } else {
    breakdown.treeChars = 0;
  }

  // 4. 无句末标点（不是完整句子）
  const punctCount = (text.match(/[。.！!？?]/g) || []).length;
  if (punctCount === 0 && lines.length >= 2) {
    score += 0.2;
    breakdown.noPunctuation = 0.2;
  } else {
    breakdown.noPunctuation = 0;
  }

  // 5. 缩进层级（暗示树结构）
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

  // 判断图类型
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
//  9. Diagram IR + Mermaid Generator
//
//  Detector 提取结构化 IR，Generator 生成 mermaid 代码。
//  这样可测试、可自动生成，减少对 LLM 的依赖。
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
    // 支持两种格式:
    //   1. 单行多节点: A --> B --> C
    //   2. 跨行箭头: A\n  ↓\nB\n  ↓\nC
    // 把箭头单独成行的格式合并成 "A ↓ B ↓ C" 单行
    const arrowOnlyRe = /^[↓↑→←│├└─]+$|^(-->|->|=>|==>|─{2,}>?)$/;
    const merged = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (arrowOnlyRe.test(trimmed)) {
        // 箭头行：附加到上一行末尾（用空格分隔）
        if (merged.length > 0) {
          merged[merged.length - 1] += ' ' + trimmed + ' ';
        }
      } else {
        // 普通节点行：如果上一行以箭头结尾（被附加过），说明应该和上一行合并
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
    // 两种树形格式:
    //   1. 缩进式: "Root\n  Child1\n  Child2"
    //   2. 树字符式: "Root\n├── Child1\n├── Child2\n└── Child3"
    const hasTreeChars = lines.some((l) => /[│├└]/.test(l));
    if (hasTreeChars) {
      // 树字符式：根据 ├── └── 前缀判断层级
      const rootName = addNode(lines[0].replace(/[│├└─]/g, '').trim());
      const rootIndent = 0;
      const stack = [{ indent: rootIndent, name: rootName }];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // 计算层级：│ 的数量 + (├ 或 └ 的深度)
        const bars = (line.match(/│/g) || []).length;
        const indent = bars;
        const name = addNode(line.replace(/[│├└─]/g, '').trim());
        if (!name) continue;
        // 弹出栈中 indent >= 当前的
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }
        if (stack.length > 0) {
          edges.push([stack[stack.length - 1].name, name]);
        }
        stack.push({ indent, name });
      }
    } else {
      // 缩进式
      const stack = []; // [{ indent, name }]
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
// 含其他特殊字符（括号/引号/斜杠）的节点，ID 仍转下划线，但渲染时需要加引号标签（由调用方判断）
function nodeId(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

// ============================================================
//  10. AI Score（多维评分）
// ============================================================

function computeAiScore(tree, _profile) {
  // v2: 多维 Quality Model
  // 从单一 AI Score 扩展为 readability/fragmentation/redundancy/structure/aiStyle/consistency/markdownQuality/technicalWriting
  const breakdown = {};

  // 1. Phrase density
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

  // 2. Heading pattern（第一人称在 heading 中）
  let headingCount = 0;
  let firstPersonHeading = 0;
  const headingLevels = [];
  unistVisit(tree, 'heading', (node) => {
    headingCount++;
    headingLevels.push(node.depth || 0);
    const text = collectText(node);
    for (const phrase of AI_FIRST_PERSON) {
      if (text.includes(phrase)) {
        firstPersonHeading++;
        break;
      }
    }
  });
  breakdown.heading = headingCount > 0 ? Math.min(1, firstPersonHeading / headingCount) : 0;

  // 3. Emoji density
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}]/gu;
  const emojiCount = (fullText.match(emojiRegex) || []).length;
  breakdown.emoji = fullText.length > 0 ? Math.min(1, emojiCount / (fullText.length / 500)) : 0;

  // 4. Fragmentation（短段落比例）
  const paragraphs = [];
  unistVisit(tree, 'paragraph', (node) => paragraphs.push(collectText(node)));
  const shortParas = paragraphs.filter((p) => p.length > 0 && p.length < 20).length;
  breakdown.fragmentation = paragraphs.length > 0 ? Math.min(1, shortParas / paragraphs.length / 0.3) : 0;

  // === v2 Quality Model 多维扩展 ===

  // 5. Readability: 平均句长合理性 + 段落长度分布
  const avgSentenceLen = sentenceCount > 0 ? fullText.length / sentenceCount : 0;
  // 理想句长 15-40 字，偏离越多可读性越低
  const readabilityDeviation = avgSentenceLen < 15 ? (15 - avgSentenceLen) / 15 : avgSentenceLen > 40 ? (avgSentenceLen - 40) / 40 : 0;
  breakdown.readability = Math.max(0, Math.min(1, 1 - readabilityDeviation));

  // 6. Redundancy: 重复短语/重复段落比例
  const paraTexts = paragraphs.map((p) => p.trim()).filter((p) => p.length > 0);
  const uniqueParas = new Set(paraTexts).size;
  breakdown.redundancy = paraTexts.length > 0 ? Math.min(1, (paraTexts.length - uniqueParas) / paraTexts.length) : 0;

  // 7. Structure: heading 层级连续性（跳级扣分）
  let structurePenalty = 0;
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] - headingLevels[i - 1] > 1) structurePenalty++;
  }
  breakdown.structure = headingLevels.length > 1 ? Math.max(0, 1 - structurePenalty / headingLevels.length) : 1;

  // 8. aiStyle: phrase + firstPersonHeading + emoji 综合
  breakdown.aiStyle = Math.min(1, breakdown.phrase * 0.5 + breakdown.heading * 0.3 + breakdown.emoji * 0.2);

  // 9. Consistency: 列表类型一致性（ordered/unordered 混用扣分）
  let listCount = 0;
  let orderedCount = 0;
  let unorderedCount = 0;
  unistVisit(tree, 'list', (node) => {
    listCount++;
    if (node.ordered) orderedCount++;
    else unorderedCount++;
  });
  // 单一类型 = 高一致性
  breakdown.consistency = listCount > 0 ? 1 - (Math.min(orderedCount, unorderedCount) / listCount) : 1;

  // 10. markdownQuality: 代码块语言标识完整度
  let codeCount = 0;
  let codeWithLang = 0;
  unistVisit(tree, 'code', (node) => {
    codeCount++;
    if (node.lang && node.lang.trim().length > 0) codeWithLang++;
  });
  breakdown.markdownQuality = codeCount > 0 ? codeWithLang / codeCount : 1;

  // 11. technicalWriting: 标题层级深度合理性 + 段落数/标题数比例
  const avgParaPerHeading = headingCount > 0 ? paragraphs.length / headingCount : 0;
  // 理想: 每个标题下 2-5 段
  const twDeviation = avgParaPerHeading < 1 ? (1 - avgParaPerHeading) : avgParaPerHeading > 8 ? (avgParaPerHeading - 8) / 8 : 0;
  breakdown.technicalWriting = Math.max(0, Math.min(1, 1 - twDeviation));

  // 旧版加权综合分（向后兼容 aiScore.total）
  const weights = { phrase: 0.4, heading: 0.25, emoji: 0.15, fragmentation: 0.2 };
  const total = Object.entries(weights).reduce(
    (sum, [k, w]) => sum + (breakdown[k] || 0) * w,
    0
  );

  const round2 = (n) => Math.round(n * 100) / 100;

  return {
    // 旧版字段（向后兼容）
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
    // v2 Quality Model 多维
    quality: {
      overall: round2(total),
      radar: {
        readability: round2(breakdown.readability),
        fragmentation: round2(breakdown.fragmentation),
        redundancy: round2(breakdown.redundancy),
        structure: round2(breakdown.structure),
        aiStyle: round2(breakdown.aiStyle),
        consistency: round2(breakdown.consistency),
        markdownQuality: round2(breakdown.markdownQuality),
        technicalWriting: round2(breakdown.technicalWriting),
      },
      metrics: {
        phraseCount,
        sentenceCount,
        firstPersonHeading,
        emojiCount,
      },
      recommendCleanup: total > 0.25 || phraseCount > 3,
    },
  };
}

// ============================================================
//  v2: Symbol Table 提取（Document Index）
//  Rule 不需要遍历 AST，直接通过 ctx.symbols 访问文档结构
// ============================================================
function extractSymbolTable(tree) {
  const symbols = {
    headings: [],
    tables: [],
    codeBlocks: [],
    diagrams: [],
    entities: [],
    mermaid: [],
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
    // mermaid 块单独索引
    if (lang.toLowerCase() === 'mermaid') {
      symbols.mermaid.push({
        line: getStartLine(node),
        type: detectMermaidType(node.value || ''),
      });
    }
  });

  // 收集实体名（heading 文本 + 列表项首词）作为轻量 entity 索引
  const entitySet = new Set();
  unistVisit(tree, 'heading', (node) => {
    const text = collectText(node).trim();
    if (text.length > 0 && text.length <= 40) entitySet.add(text);
  });
  symbols.entities = Array.from(entitySet).slice(0, 50);

  return symbols;
}

function detectMermaidType(code) {
  const firstLine = code.split('\n').find((l) => l.trim().length > 0) || '';
  const m = firstLine.match(/^(flowchart|graph|stateDiagram|sequenceDiagram|mindmap|classDiagram|erDiagram|journey|requirementDiagram|timeline|gitGraph|quadrantChart)/i);
  return m ? m[1].toLowerCase() : 'unknown';
}

// ============================================================
//  11. Validators
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
//  12. Issue Schema Output
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
    // v2: Symbol Table（Document Index），Rule 通过 ctx.symbols 访问文档结构
    symbols: ctx.symbols || {},
    appliedFixes: ctx.changes,
    issues: ctx.issues,
    // 旧版 aiScore（向后兼容）
    aiScore: ctx.aiScore || { total: 0, breakdown: {}, recommendCleanup: false },
    // v2: 多维 Quality Model
    quality: (ctx.aiScore && ctx.aiScore.quality) || {
      overall: 0,
      radar: {},
      metrics: {},
      recommendCleanup: false,
    },
    validation,
  };
}

// ============================================================
//  13. Reporter（人类可读的 check 模式输出）
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
    lines.push(`  ${icon} ${String(list.length).padStart(2, ' ')} ${rule.padEnd(30)} [${tag}, confidence ${first.confidence}]`);
  }

  lines.push('');
  lines.push('Summary:');
  lines.push(`  Applied:    ${ctx.changes.length} fixes`);
  lines.push(`  Auto-fix:   ${autoFixable.length} (pass --fix to apply)`);
  lines.push(`  LLM-req:    ${llmRequired.length} (pass --json to export)`);
  if (ctx.aiScore) {
    const b = ctx.aiScore.breakdown;
    lines.push(`  AI Score:   ${ctx.aiScore.total} (phrase=${b.phrase}, heading=${b.heading}, emoji=${b.emoji}, frag=${b.fragmentation})`);
    // v2: 多维 Quality Model
    if (ctx.aiScore.quality && ctx.aiScore.quality.radar) {
      const r = ctx.aiScore.quality.radar;
      lines.push(`  Quality:    readability=${r.readability}, structure=${r.structure}, aiStyle=${r.aiStyle}, consistency=${r.consistency}, mdQuality=${r.markdownQuality}`);
    }
    // v2: Symbol Table 统计
    if (ctx.symbols) {
      const s = ctx.symbols;
      const symbolCount = (s.headings?.length || 0) + (s.tables?.length || 0) + (s.codeBlocks?.length || 0) + (s.mermaid?.length || 0);
      lines.push(`  Symbols:    ${symbolCount} (${s.headings?.length || 0} headings, ${s.tables?.length || 0} tables, ${s.codeBlocks?.length || 0} code, ${s.mermaid?.length || 0} mermaid)`);
    }
    if (ctx.aiScore.recommendCleanup) lines.push('    ⚠ recommend L2 cleanup');
  }

  return lines.join('\n');
}

// ============================================================
//  14. Pipeline Runner
// ============================================================

function runPipeline(input, opts) {
  const { level = 'L1', profileName = 'technical-doc', mode = 'fix' } = opts;
  const profile = PROFILES[profileName] || PROFILES['technical-doc'];
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

  // v2: 提取 Symbol Table（Document Index），供 Pass 通过 ctx.symbols 访问
  ctx.symbols = extractSymbolTable(tree);

  // 运行 Pass Pipeline
  runPasses(ctx);

  // Stringify
  const normalized = stringifyMarkdown(tree);

  // Validate（用 normalized 后的 tree）
  const treeAfter = parseMarkdown(normalized);
  const validation = validate(treeAfter, input, normalized, level, ctx);

  const issueSchema = buildIssueSchema(
    opts.document || 'input.md',
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
//  15. CLI
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
  --profile <name>          Profile: technical-doc|blog|rfc|architecture
  --json <file>             Output issues.json to file (use with --report)
  -o <file>                 Output normalized markdown to file
  --doc <name>              Document name for issue schema

Examples:
  node normalize.mjs input.md --check
  node normalize.mjs input.md --report --json issues.json
  node normalize.mjs input.md --fix -o output.md
  cat file.md | node normalize.mjs --level L2
`);
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  let input = '';
  let level = 'L1';
  let profileName = 'technical-doc';
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
    else if (a === '--profile') profileName = argv[++i] || 'technical-doc';
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

main();
