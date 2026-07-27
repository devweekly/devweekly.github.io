// ===========================================================================
// snapshot-manager.mjs — Snapshot comparison and update for E2E research output.
//
// Snapshot directory layout mirrors the research output directory:
//   skill-test/e2e/snapshots/<fixture>/
//     evidence-store/full.json
//     evidence-brief.md
//     report.md
//     00-research-questions.md
//     ...
//
// Usage:
//   compareSnapshot(dir, fixtureName)  -> { ok, changed[], diffs[] }
//   updateSnapshot(dir, fixtureName)   -> writes current output to snapshot dir
// ===========================================================================

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";

const SNAPSHOT_ROOT = join(import.meta.dirname, "snapshots");

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function listFiles(dir, base = "") {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const relPath = base ? join(base, name) : name;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...listFiles(fullPath, relPath));
    } else {
      entries.push(relPath);
    }
  }
  return entries;
}

function jsonDiff(a, b) {
  // Normalize objects to stable string form for comparison.
  const aText = JSON.stringify(a, null, 2);
  const bText = JSON.stringify(b, null, 2);
  if (aText === bText) return null;
  return { type: "json", before: aText, after: bText };
}

function textDiff(a, b) {
  if (a === b) return null;
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const changes = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    const left = aLines[i];
    const right = bLines[i];
    if (left !== right) {
      changes.push({ line: i + 1, before: left, after: right });
    }
  }
  return { type: "text", changes };
}

function compareFile(snapshotPath, currentPath, relPath) {
  const currentText = readFileSync(currentPath, "utf-8");

  if (!existsSync(snapshotPath)) {
    return { relPath, status: "added", diff: { type: "added", content: currentText } };
  }

  const snapshotText = readFileSync(snapshotPath, "utf-8");
  if (snapshotText === currentText) {
    return { relPath, status: "unchanged", diff: null };
  }

  if (relPath.endsWith(".json")) {
    try {
      const diff = jsonDiff(JSON.parse(snapshotText), JSON.parse(currentText));
      return { relPath, status: "changed", diff };
    } catch {
      return { relPath, status: "changed", diff: textDiff(snapshotText, currentText) };
    }
  }

  return { relPath, status: "changed", diff: textDiff(snapshotText, currentText) };
}

export function compareSnapshot(dir, fixtureName) {
  const snapshotDir = join(SNAPSHOT_ROOT, fixtureName);
  const result = {
    ok: true,
    fixture: fixtureName,
    unchanged: [],
    changed: [],
    added: [],
    diffs: [],
  };

  if (!existsSync(snapshotDir)) {
    result.ok = false;
    result.diffs.push({ relPath: "*", status: "missing-snapshot", message: `No snapshot found at ${snapshotDir}` });
    return result;
  }

  const currentFiles = listFiles(dir);
  const snapshotFiles = new Set(listFiles(snapshotDir));

  for (const relPath of currentFiles) {
    const snapshotPath = join(snapshotDir, relPath);
    const currentPath = join(dir, relPath);
    const comparison = compareFile(snapshotPath, currentPath, relPath);

    if (comparison.status === "unchanged") {
      result.unchanged.push(relPath);
    } else if (comparison.status === "added") {
      result.added.push(relPath);
      result.ok = false;
    } else {
      result.changed.push(relPath);
      result.ok = false;
    }

    if (comparison.diff) {
      result.diffs.push(comparison);
    }
  }

  for (const relPath of snapshotFiles) {
    if (!currentFiles.includes(relPath)) {
      result.ok = false;
      result.diffs.push({
        relPath,
        status: "removed",
        message: "File exists in snapshot but not in current output",
      });
    }
  }

  return result;
}

export function updateSnapshot(dir, fixtureName) {
  const snapshotDir = join(SNAPSHOT_ROOT, fixtureName);
  ensureDir(snapshotDir);

  const files = listFiles(dir);
  for (const relPath of files) {
    const source = join(dir, relPath);
    const target = join(snapshotDir, relPath);
    ensureDir(dirname(target));
    copyFileSync(source, target);
  }

  return { fixture: fixtureName, snapshotDir, fileCount: files.length };
}

export function printSnapshotDiff(result) {
  if (result.ok && result.unchanged.length > 0) {
    console.log(`  Snapshot ${result.fixture}: unchanged (${result.unchanged.length} files)`);
    return;
  }

  console.log(`  Snapshot ${result.fixture}:`);
  for (const diff of result.diffs) {
    if (diff.status === "missing-snapshot") {
      console.log(`    ⚠ ${diff.message}`);
      continue;
    }
    if (diff.status === "removed") {
      console.log(`    ✗ ${diff.relPath}: removed in current output`);
      continue;
    }
    if (diff.status === "added") {
      console.log(`    ✗ ${diff.relPath}: new file`);
      continue;
    }

    console.log(`    ✗ ${diff.relPath}: changed`);
    if (diff.diff?.type === "text" && diff.diff.changes) {
      for (const change of diff.diff.changes.slice(0, 5)) {
        console.log(`      line ${change.line}:`);
        console.log(`        - ${change.before ?? "(none)"}`);
        console.log(`        + ${change.after ?? "(none)"}`);
      }
      if (diff.diff.changes.length > 5) {
        console.log(`      ... and ${diff.diff.changes.length - 5} more changed lines`);
      }
    } else if (diff.diff?.type === "json") {
      console.log(`      JSON structure changed (${diff.diff.before.length} -> ${diff.diff.after.length} chars)`);
    }
  }
}
