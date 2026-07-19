#!/usr/bin/env node
/**
 * LLM Markdown Normalizer Engine — 单文件可执行（ESM，基于 unified/remark）
 *
 * Hybrid Architecture:
 *   JS  →  AST 解析 + 机械修复 + 检测 + Issue 生成（确定性规则）
 *   LLM → 语义保持改写 + 去 AI 味 + ASCII→Mermaid（需要语义判断）
 *
 * 三种运行模式:
 *   --check   Dry Run，只检测输出问题清单
 *   --report  输出 normalized markdown + issues.json
 *   --fix     自动修复高置信度问题 + 输出
 *
 * 架构（单文件内逻辑分区）:
 *   parser/      markdown AST 解析
 *   passes/      自动修复规则（whitespace, list, heading, fence）
 *   detectors/   问题检测器（ascii, aiPhrase, fragment）
 *   validators/  校验器（markdown, mermaid, semantic）
 *   ruleEngine   confidence 驱动的规则引擎
 *   issueSchema  Issue JSON 输出生成
 *   cli          命令行入口
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import fs from 'fs';
import path from 'path';

// ============================================================
//  1. Config
// ============================================================

const PROFILES = {
  'technical-doc': { headingDepth: 3, confidenceThreshold: 0.80, mermaid: true },
  'blog':          { headingDepth: 4, confidenceThreshold: 0.70, mermaid: true },
  'rfc':           { headingDepth: 3, confidenceThreshold: 0.90, mermaid: false },
  'architecture':  { headingDepth: 4, confidenceThreshold: 0.80, mermaid: true },
};

const AI_PHRASES = [
  '真正重要的是', '其实真正重要的是', '核心在于', '关键点在于', '值得注意的是',
  '需要强调的是', '值得一提的是', '不仅如此', '接下来我们来看', '让我们来看',
  '总的来说', '综上所述', '总而言之', '事实上', '实际上', '其实', '当然', '确实',
  '首先', '其次', '最后', '总的来讲', '总体而言',
];

// ============================================================
//  2. Parser
// ============================================================

const parser = unified().use(remarkParse).use(remarkGfm);
const stringifier = unified().use(remarkStringify).use(remarkGfm, {
  bullet: '-',
  listItemIndent: 'one',
  fences: true,
});

function parseMarkdown(text) {
  return parser.parse(text);
}

function stringifyMarkdown(tree) {
  return stringifier.stringify(tree);
}

// ============================================================
//  3. Utils: tree walking, line mapping, text collection
// ============================================================

function visit(tree, test, visitor) {
  function walk(node, parent, index, position) {
    if (typeof test === 'string' ? node.type === test : test(node)) {
      visitor(node, parent, index, position);
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        walk(node.children[i], node, i, { start: node.position?.start });
      }
    }
  }
  walk(tree, null, 0, {});
}

function collectText(node) {
  const parts = [];
  visit(node, 'text', (t) => parts.push(t.value));
  return parts.join('');
}

function getStartLine(node) {
  return node.position?.start?.line ?? -1;
}

function getEndLine(node) {
  return node.position?.end?.line ?? -1;
}

function getContextChunk(fullLines, startLine, endLine, beforeLines = 2, afterLines = 2) {
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
//  4. Rule Engine（Passes: Whitespace, Block Structure, Inline Structure）
//
// 每条规则: {
//   name, pass, confidence, levels,
//   auto: bool（是否可自动修复）,
//   apply(tree, ctx): void  // 修改 tree + 记录 changes
// }
//
// confidence >= profile.confidenceThreshold 的规则自动执行
// 低于阈值的只记录 issue，不执行
// ============================================================

const passes = {
  whitespace: [],
  block: [],
  inline: [],
};

function registerPass(rule) {
  if (rule.pass === 'whitespace') passes.whitespace.push(rule);
  else if (rule.pass === 'block') passes.block.push(rule);
  else if (rule.pass === 'inline') passes.inline.push(rule);
}

function runPasses(tree, level, profile, ctx, fullLines, allowAuto) {
  const allRules = [...passes.whitespace, ...passes.block, ...passes.inline];
  for (const rule of allRules) {
    if (!rule.levels.includes(level)) continue;
    const canAuto = allowAuto && rule.auto && rule.confidence >= profile.confidenceThreshold;
    try {
      rule.apply(tree, ctx, { canAuto, profile }, fullLines);
    } catch (e) {
      ctx.issues.push({
        id: `issue-${String(ctx.issueCounter++).padStart(3, '0')}`,
        rule: rule.name,
        pass: rule.pass,
        severity: 'high',
        confidence: 0,
        action: 'error',
        location: { startLine: -1, endLine: -1 },
        context: { chunk: '' },
        sample: '',
        suggestion: `Rule error: ${e.message}`,
      });
    }
  }
}

// ---- Pass 1: Whitespace ----

// 规则: 移除空 paragraph（连续空行的 AST 表现）
registerPass({
  name: 'remove-empty-paragraph',
  pass: 'whitespace',
  confidence: 0.99,
  levels: ['L0', 'L1', 'L2'],
  auto: true,
  apply(tree, ctx, { canAuto }) {
    const children = tree.children;
    let count = 0;
    for (let i = children.length - 1; i >= 0; i--) {
      const n = children[i];
      if (n.type === 'paragraph' && (n.children || []).length === 0) {
        const line = getStartLine(n);
        count++;
        if (canAuto) {
          children.splice(i, 1);
          ctx.changes.push({ rule: this.name, pass: this.pass, action: 'applied', line });
        } else {
          ctx.issues.push({
            id: `issue-${String(ctx.issueCounter++).padStart(3, '0')}`,
            rule: this.name,
            pass: this.pass,
            severity: 'low',
            confidence: this.confidence,
            action: 'auto_fix',
            location: { startLine: line, endLine: line },
            context: { chunk: '' },
            sample: '',
            suggestion: 'Remove empty paragraph',
            applied: false,
          });
        }
      }
    }
    if (count > 0 && canAuto) ctx.stats.emptyParagraphs += count;
  },
});

// 规则: 行尾空白去除（通过 stringify 前处理 raw text，或用 text 节点值处理）
registerPass({
  name: 'trim-trailing-whitespace',
  pass: 'whitespace',
  confidence: 0.99,
  levels: ['L0', 'L1', 'L2'],
  auto: true,
  apply(tree, ctx, { canAuto }) {
    if (!canAuto) return; // 纯机械操作，check 模式不报 issue
    let count = 0;
    visit(tree, 'text', (node) => {
      if (node.value && /[ \t]$/.test(node.value)) {
        // text 节点可能跨越多行，需要处理每行的行尾空白
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
    // 处理 code 块内的行尾空白（保留 code 内容，只处理 fence 自身？不，code 内容不改）
    if (count > 0) {
      ctx.changes.push({ rule: this.name, pass: this.pass, action: 'applied', count });
    }
  },
});

// ---- Pass 2: Block Structure ----

// 规则: 相邻同类列表合并
registerPass({
  name: 'merge-adjacent-lists',
  pass: 'block',
  confidence: 0.85,
  levels: ['L1', 'L2'],
  auto: true,
  apply(tree, ctx, { canAuto }) {
    const children = tree.children;
    let count = 0;
    for (let i = 0; i < children.length - 1; i++) {
      const a = children[i];
      const b = children[i + 1];
      if (a.type === 'list' && b.type === 'list' && a.ordered === b.ordered) {
        count++;
        const startLine = getStartLine(a);
        const endLine = getEndLine(b);
        if (canAuto) {
          a.children.push(...b.children);
          children.splice(i + 1, 1);
          ctx.changes.push({ rule: this.name, pass: this.pass, action: 'applied', line: startLine });
          i--;
        } else {
          ctx.issues.push({
            id: `issue-${String(ctx.issueCounter++).padStart(3, '0')}`,
            rule: this.name,
            pass: this.pass,
            severity: 'low',
            confidence: this.confidence,
            action: 'auto_fix',
            location: { startLine, endLine },
            context: { chunk: '' },
            sample: '',
            suggestion: 'Merge adjacent lists of same type',
            applied: false,
          });
        }
      }
    }
    if (count > 0 && canAuto) ctx.stats.mergedLists += count;
  },
});

// 规则: Heading 跳级检测与修复（h1→h3 视为跳级）
registerPass({
  name: 'heading-skip-level',
  pass: 'block',
  confidence: 0.90,
  levels: ['L0', 'L1', 'L2'],
  auto: true,
  apply(tree, ctx, { canAuto, profile }) {
    const headings = [];
    visit(tree, 'heading', (h) => headings.push(h));
    let count = 0;
    for (let i = 0; i < headings.length - 1; i++) {
      const cur = headings[i];
      const next = headings[i + 1];
      if (next.depth > cur.depth + 1) {
        count++;
        const startLine = getStartLine(next);
        const endLine = getEndLine(next);
        const sample = `h${cur.depth} → h${next.depth}`;
        if (canAuto) {
          next.depth = cur.depth + 1;
          ctx.changes.push({ rule: this.name, pass: this.pass, action: 'applied', line: startLine, detail: sample });
        } else {
          ctx.issues.push({
            id: `issue-${String(ctx.issueCounter++).padStart(3, '0')}`,
            rule: this.name,
            pass: this.pass,
            severity: 'medium',
            confidence: this.confidence,
            action: 'auto_fix',
            location: { startLine, endLine },
            context: { chunk: '' },
            sample,
            suggestion: `Promote heading to h${cur.depth + 1}`,
            applied: false,
          });
        }
      }
    }
    if (count > 0 && canAuto) ctx.stats.headingSkips += count;
  },
});

// ---- Pass 3: Inline Structure ----

// 规则: 代码块缺语言标注
registerPass({
  name: 'code-block-missing-lang',
  pass: 'inline',
  confidence: 0.95,
  levels: ['L0', 'L1', 'L2'],
  auto: false, // 不能自动补全语言，只能报告
  apply(tree, ctx, opts, fullLines) {
    const codes = [];
    visit(tree, 'code', (c) => codes.push(c));
    for (const code of codes) {
      if (!code.lang || code.lang.trim() === '') {
        const startLine = getStartLine(code);
        const endLine = getEndLine(code);
        const context = fullLines ? getContextChunk(fullLines, startLine, endLine, 1, 1) : { chunk: '' };
        ctx.issues.push({
          id: `issue-${String(ctx.issueCounter++).padStart(3, '0')}`,
          rule: this.name,
          pass: this.pass,
          severity: 'low',
          confidence: this.confidence,
          action: 'llm_required',
          location: { startLine, endLine },
          context,
          sample: (code.value || '').slice(0, 80),
          suggestion: 'Add language identifier to code fence',
          applied: false,
        });
      }
    }
  },
});

// ============================================================
//  5. Detectors（只检测，不修改 tree）
//
// 每个 detector: {
//   name, pass, confidence, detect(tree, ctx): void  // 只 push issues
// }
// ============================================================

const detectors = [];

function registerDetector(d) {
  detectors.push(d);
}

function runDetectors(tree, fullLines, ctx, profile) {
  for (const d of detectors) {
    try {
      d.detect(tree, fullLines, ctx, profile);
    } catch (e) {
      ctx.issues.push({
        id: `issue-${String(ctx.issueCounter++).padStart(3, '0')}`,
        rule: d.name,
        pass: d.pass,
        severity: 'high',
        confidence: 0,
        action: 'error',
        location: { startLine: -1, endLine: -1 },
        context: { chunk: '' },
        sample: '',
        suggestion: `Detector error: ${e.message}`,
      });
    }
  }
}

// 检测器: ASCII 图
registerDetector({
  name: 'ascii-diagram',
  pass: 'Block Structure',
  confidence: 0.78,
  detect(tree, fullLines, ctx) {
    const children = tree.children || [];
    for (let i = 0; i < children.length; i++) {
      const n = children[i];
      if (n.type !== 'paragraph' && n.type !== 'code') continue;
      const text = n.type === 'code' ? (n.value || '') : collectText(n);
      const arrows = (text.match(/[↓↑→←]/g) || []).length;
      const treeChars = (text.match(/[│├└─]{3,}/g) || []).length;
      const dashArrows = (text.match(/(-->|->|=>|==>)/g) || []).length;
      if (arrows >= 2 || treeChars >= 1 || dashArrows >= 3) {
        const startLine = getStartLine(n);
        const endLine = getEndLine(n);
        const context = getContextChunk(fullLines, startLine, endLine, 2, 2);
        ctx.issues.push({
          id: `issue-${String(ctx.issueCounter++).padStart(3, '0')}`,
          rule: this.name,
          pass: this.pass,
          severity: 'medium',
          confidence: this.confidence,
          action: 'llm_required',
          location: { startLine, endLine },
          context,
          sample: text.slice(0, 200),
          suggestion: 'Convert ASCII diagram to mermaid or table',
          applied: false,
        });
        ctx.stats.asciiDiagrams++;
      }
    }
  },
});

// 检测器: AI 短语密度
registerDetector({
  name: 'ai-phrase-density',
  pass: 'Style Rewrite',
  confidence: 0.85,
  detect(tree, fullLines, ctx) {
    // 收集所有 paragraph 节点（在 paragraph 粒度上定位行号更准确）
    let fullText = '';
    const paraInfos = []; // { startLine, text, offset }
    visit(tree, 'paragraph', (node) => {
      const paraText = collectText(node);
      paraInfos.push({
        startLine: getStartLine(node),
        text: paraText,
        offset: fullText.length,
      });
      fullText += paraText + '\n';
    });

    const sentences = fullText.split(/[。.！!？?\n]+/).filter(s => s.trim().length > 0);

    // 在每个 paragraph 内查找 AI 短语
    const phraseOccurrences = [];
    for (const { startLine, text } of paraInfos) {
      for (const phrase of AI_PHRASES) {
        let idx = 0;
        while ((idx = text.indexOf(phrase, idx)) !== -1) {
          const localLine = text.slice(0, idx).split('\n').length;
          const lineNum = startLine + localLine - 1;
          phraseOccurrences.push({ phrase, line: lineNum });
          idx += phrase.length;
        }
      }
    }

    const score = sentences.length > 0 ? phraseOccurrences.length / sentences.length : 0;
    ctx.aiDensity = {
      score: Math.round(score * 100) / 100,
      phraseCount: phraseOccurrences.length,
      sentenceCount: sentences.length,
      recommendCleanup: score > 0.15,
    };

    // 为每个出现的 AI 短语生成 issue（只生成前 10 个避免泛滥）
    const maxIssues = 10;
    for (let i = 0; i < Math.min(maxIssues, phraseOccurrences.length); i++) {
      const occ = phraseOccurrences[i];
      const lineNum = occ.line;
      const context = getContextChunk(fullLines, lineNum, lineNum, 1, 1);
      ctx.issues.push({
        id: `issue-${String(ctx.issueCounter++).padStart(3, '0')}`,
        rule: 'ai-phrase',
        pass: 'Style Rewrite',
        severity: 'low',
        confidence: 0.62,
        action: 'llm_required',
        location: { startLine: lineNum, endLine: lineNum },
        context,
        sample: occ.phrase,
        suggestion: 'Remove or rephrase AI template phrase',
        applied: false,
      });
    }
    ctx.stats.aiPhrases += phraseOccurrences.length;
  },
});

// 检测器: 碎片句子（段落太短 + 被空行拆开）
registerDetector({
  name: 'fragment-sentence',
  pass: 'Semantic Rewrite',
  confidence: 0.92,
  detect(tree, fullLines, ctx) {
    const children = tree.children || [];
    for (let i = 0; i < children.length - 2; i++) {
      const a = children[i];
      const b = children[i + 1];
      if (a.type === 'paragraph' && b.type === 'paragraph') {
        const textA = collectText(a);
        const textB = collectText(b);
        // 两个短段落连续，且长度都 < 15 字 → 疑似碎片
        if (textA.length < 15 && textB.length < 15 && textA.length > 0 && textB.length > 0) {
          const startLine = getStartLine(a);
          const endLine = getEndLine(b);
          const context = getContextChunk(fullLines, startLine, endLine, 1, 1);
          ctx.issues.push({
            id: `issue-${String(ctx.issueCounter++).padStart(3, '0')}`,
            rule: this.name,
            pass: this.pass,
            severity: 'low',
            confidence: this.confidence,
            action: 'llm_required',
            location: { startLine, endLine },
            context,
            sample: `${textA} ... ${textB}`,
            suggestion: 'Merge fragmented short paragraphs into one sentence',
            applied: false,
          });
          ctx.stats.fragmentSentences++;
        }
      }
    }
  },
});

// 检测器: Mermaid 节点名转义检查
registerDetector({
  name: 'mermaid-node-name-escape',
  pass: 'Diagram',
  confidence: 0.95,
  detect(tree, fullLines, ctx) {
    visit(tree, 'code', (code) => {
      if (!code.lang || !code.lang.includes('mermaid')) return;
      const lines = (code.value || '').split('\n');
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        // 匹配箭头右侧未加引号的含空格节点名
        const patterns = [
          /(-->|---|-\. -|==>|~~~)\s*([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5\s]{2,})(?=\s*(?:-->|---|-\. -|==>|~~~|$|\|))/g,
        ];
        for (const pat of patterns) {
          let m;
          while ((m = pat.exec(line)) !== null) {
            const node = m[2].trim();
            if (node.includes(' ') && !node.startsWith('"') && !node.startsWith("'")) {
              const codeStartLine = getStartLine(code);
              const actualLine = codeStartLine + li;
              ctx.issues.push({
                id: `issue-${String(ctx.issueCounter++).padStart(3, '0')}`,
                rule: this.name,
                pass: this.pass,
                severity: 'medium',
                confidence: this.confidence,
                action: 'llm_required',
                location: { startLine: actualLine, endLine: actualLine },
                context: { chunk: line },
                sample: node,
                suggestion: `Wrap node name in quotes: "${node}"`,
                applied: false,
              });
              ctx.stats.mermaidIssues++;
              break; // 每行只报一个
            }
          }
        }
      }
    });
  },
});

// ============================================================
//  6. Validators
// ============================================================

function validate(tree, original, normalized, level, ctx) {
  const result = { markdown: 'pass', mermaid: 'pass', semantic: 'pass', warnings: [] };

  // Markdown 合法性: heading 层级、code fence（parser 已保证配对）
  const headings = [];
  visit(tree, 'heading', (h) => headings.push(h));
  for (let i = 0; i < headings.length - 1; i++) {
    if (headings[i + 1].depth > headings[i].depth + 1) {
      result.markdown = 'warn';
      result.warnings.push('Heading skip level');
      break;
    }
  }

  // Mermaid 合法性（基于 detector 结果）
  if (ctx.stats.mermaidIssues > 0) {
    result.mermaid = 'warn';
  }

  // L0 语义一致性（纯文字对比）
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
//  7. Issue Schema Output
// ============================================================

function buildIssueSchema(document, profileName, level, ctx, validation, totalTokens) {
  const autoFixable = ctx.issues.filter(i => i.action === 'auto_fix').length;
  const llmRequired = ctx.issues.filter(i => i.action === 'llm_required').length;

  // 估算 issue tokens（粗略: 每个 chunk ~100-300 tokens）
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
    appliedFixes: ctx.changes,
    issues: ctx.issues,
    aiDensity: ctx.aiDensity || { score: 0, phraseCount: 0, sentenceCount: 0, recommendCleanup: false },
    validation,
  };
}

// ============================================================
//  8. Reporter（人类可读的 check 模式输出）
// ============================================================

function buildCheckReport(ctx, profileName) {
  const lines = [];
  const autoFixable = ctx.issues.filter(i => i.action === 'auto_fix');
  const llmRequired = ctx.issues.filter(i => i.action === 'llm_required');

  lines.push(`Found ${ctx.issues.length} issues:`);
  lines.push('');

  // 按类型分组
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
  if (ctx.aiDensity) {
    lines.push(`  AI Density: ${ctx.aiDensity.score} (phrases=${ctx.aiDensity.phraseCount}, sentences=${ctx.aiDensity.sentenceCount})`);
    if (ctx.aiDensity.recommendCleanup) lines.push('    ⚠ recommend L2 cleanup');
  }

  return lines.join('\n');
}

// ============================================================
//  9. Main Pipeline
// ============================================================

function createCtx() {
  return {
    changes: [],
    issues: [],
    issueCounter: 1,
    aiDensity: null,
    stats: {
      emptyParagraphs: 0,
      mergedLists: 0,
      headingSkips: 0,
      asciiDiagrams: 0,
      aiPhrases: 0,
      fragmentSentences: 0,
      mermaidIssues: 0,
    },
  };
}

function runPipeline(input, opts) {
  const { level = 'L1', profileName = 'technical-doc', mode = 'fix' } = opts;
  const profile = PROFILES[profileName] || PROFILES['technical-doc'];
  const fullLines = input.split('\n');
  const totalTokens = input.length / 2; // 粗略估算

  const ctx = createCtx();

  // Parse
  const tree = parseMarkdown(input);

  // Passes（check 模式只检测不修复，fix/report 模式自动修复高置信度规则）
  const allowAuto = mode !== 'check';
  runPasses(tree, level, profile, ctx, fullLines, allowAuto);

  // Stringify (pass 之后)
  const normalized = stringifyMarkdown(tree);
  const normalizedLines = normalized.split('\n');

  // Detectors（在 pass 之后的 tree 上运行，行号对应 normalized 文本）
  const treeAfter = parseMarkdown(normalized);
  runDetectors(treeAfter, normalizedLines, ctx, profile);

  // Validate
  const validation = validate(treeAfter, input, normalized, level, ctx);

  // Build issue schema
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
    checkReport: buildCheckReport(ctx, profileName),
    ctx,
    validation,
  };
}

// ============================================================
//  10. CLI
// ============================================================

function printUsage() {
  console.log(`
Usage:
  node normalize.mjs <file.md> [options]

Modes (choose one):
  --check          Dry run - only detect issues, no changes
  --report         Analyze + auto-fix + output issues.json
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

  // Output
  if (mode === 'check') {
    // check 模式: 只输出报告到 stdout
    console.log(result.checkReport);
    const hasIssues = result.issueSchema.stats.issues > 0;
    process.exit(hasIssues ? 1 : 0);
  } else if (mode === 'report') {
    // report 模式: normalized 到 stdout，issues 到 json 文件
    if (jsonFile) {
      fs.writeFileSync(jsonFile, JSON.stringify(result.issueSchema, null, 2));
      process.stderr.write(`Issues written to ${jsonFile} (${result.issueSchema.stats.issues} issues)\n`);
    }
    process.stdout.write(result.normalized);
  } else {
    // fix 模式（默认）: 输出修复后的 markdown
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
