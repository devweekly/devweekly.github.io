#!/usr/bin/env node
/**
 * Test Runner — Snapshot-based regression testing
 *
 * 流程:
 *   1. 遍历 fixtures/*.md
 *   2. 对每个 fixture 运行 runPipeline（--fix 模式）
 *   3. 对比 normalized 输出到 expected/<name>.md（首次运行自动生成 snapshot）
 *   4. 对比 issues snapshot 到 expected/<name>.issues.json
 *   5. 报告 pass/fail
 *
 * 用法:
 *   node test/run.mjs              # 运行所有测试
 *   node test/run.mjs --update     # 更新所有 snapshot
 *   node test/run.mjs whitespace   # 只跑指定 fixture
 */

import { runPipeline } from '../normalize.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const EXPECTED_DIR = path.join(__dirname, 'expected');

function runFixture(fixtureName, update = false) {
  const fixturePath = path.join(FIXTURES_DIR, fixtureName);
  const input = fs.readFileSync(fixturePath, 'utf8');

  // 运行 pipeline（L1, default profile, fix 模式）
  const result = runPipeline(input, {
    level: 'L1',
    profileName: 'default',
    mode: 'fix',
    document: fixtureName,
  });

  const expectedMdPath = path.join(EXPECTED_DIR, fixtureName);
  const expectedIssuesPath = path.join(EXPECTED_DIR, fixtureName.replace('.md', '.issues.json'));

  // Markdown snapshot
  let mdPassed = true;
  let mdMessage = '';
  if (!fs.existsSync(expectedMdPath) || update) {
    fs.writeFileSync(expectedMdPath, result.normalized);
    mdMessage = update ? 'snapshot updated' : 'snapshot created (first run)';
    mdPassed = update ? true : true; // first run = pass (created)
  } else {
    const expected = fs.readFileSync(expectedMdPath, 'utf8');
    if (expected === result.normalized) {
      mdMessage = 'match';
    } else {
      mdPassed = false;
      mdMessage = 'MISMATCH';
    }
  }

  // Issues snapshot（只比较 rule/location/action，不比较 id/timestamps）
  const issuesSummary = result.issueSchema.issues.map((i) => ({
    rule: i.rule,
    pass: i.pass,
    action: i.action,
    confidence: i.confidence,
    applied: i.applied,
    location: i.location,
  }));
  let issuesPassed = true;
  let issuesMessage = '';
  if (!fs.existsSync(expectedIssuesPath) || update) {
    fs.writeFileSync(expectedIssuesPath, JSON.stringify(issuesSummary, null, 2));
    issuesMessage = update ? 'snapshot updated' : 'snapshot created (first run)';
  } else {
    const expected = JSON.parse(fs.readFileSync(expectedIssuesPath, 'utf8'));
    if (JSON.stringify(expected) === JSON.stringify(issuesSummary)) {
      issuesMessage = 'match';
    } else {
      issuesPassed = false;
      issuesMessage = 'MISMATCH';
    }
  }

  return {
    fixture: fixtureName,
    mdPassed,
    mdMessage,
    issuesPassed,
    issuesMessage,
    issueCount: result.issueSchema.stats.issues,
    appliedCount: result.issueSchema.stats.appliedFixes,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const update = argv.includes('--update');
  const filter = argv.find((a) => !a.startsWith('--'));

  const fixtures = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.md'));
  const toRun = filter ? fixtures.filter((f) => f.includes(filter)) : fixtures;

  if (toRun.length === 0) {
    console.log('No fixtures found' + (filter ? ` matching "${filter}"` : ''));
    process.exit(1);
  }

  console.log(`Running ${toRun.length} fixture(s)${update ? ' (UPDATE MODE)' : ''}...\n`);

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const fixture of toRun) {
    const r = runFixture(fixture, update);
    results.push(r);
    const allPass = r.mdPassed && r.issuesPassed;
    const icon = allPass ? '✓' : '✗';
    console.log(`  ${icon} ${fixture.padEnd(25)} md=${r.mdMessage}, issues=${r.issuesMessage} (${r.issueCount} issues, ${r.appliedCount} applied)`);
    if (allPass) passed++;
    else failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed, ${toRun.length} total`);

  // 失败时输出 diff hint
  if (failed > 0) {
    console.log('\nTo update snapshots: node test/run.mjs --update');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
