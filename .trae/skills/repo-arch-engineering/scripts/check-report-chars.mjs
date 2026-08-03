#!/usr/bin/env node
/**
 * check-report-chars.mjs
 * ----------------------------------------------------------------------------
 * repo-arch-engineering skill · Report Length Hard Gate
 *
 * 硬性指标：最终 report.md 的「纯内容字符数」（去除所有空白字符：
 * 空格 / 制表符 / 换行 / 回车）必须 >= MIN_REPORT_CHARS（默认 12000）。
 *
 * 少于阈值 => 判定为「内容 / 深度不足」，报告禁止发布，必须回炉。
 *
 * 退出码：
 *   0 = PASS（达到门槛）
 *   1 = FAIL（内容不足，字符数 < 阈值）
 *   2 = 用法 / IO 错误
 *
 * 用法：
 *   node check-report-chars.mjs <path-to-report.md>
 *   MIN_REPORT_CHARS=20000 node check-report-chars.mjs report.md
 * ----------------------------------------------------------------------------
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIN_CHARS = Number(process.env.MIN_REPORT_CHARS ?? 12000);

const file = process.argv[2];
if (!file) {
  console.error('Usage: node check-report-chars.mjs <path-to-report.md>');
  console.error('       (optional env: MIN_REPORT_CHARS, default 12000)');
  process.exit(2);
}

const abs = resolve(file);
let text;
try {
  text = readFileSync(abs, 'utf8');
} catch (err) {
  console.error(`ERROR: cannot read ${abs}: ${err.message}`);
  process.exit(2);
}

// 纯内容字符 = 去除所有空白（\s 覆盖空格/制表符/换行/回车/换页等）
const pure = text.replace(/\s/g, '');
const count = pure.length;

const passed = count >= MIN_CHARS;

const result = {
  file: abs,
  pure_content_chars: count,
  min_required: MIN_CHARS,
  passed,
  reason: passed
    ? `report content depth sufficient (${count} >= ${MIN_CHARS} pure-content chars)`
    : `report content depth insufficient: ${count} pure-content chars < ${MIN_CHARS} required — report lacks sufficient content/depth, must be revised (continue research or expand section depth; padding with filler is forbidden)`,
};

console.log(JSON.stringify(result, null, 2));
process.exit(passed ? 0 : 1);
