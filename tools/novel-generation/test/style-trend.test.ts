import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStyleTrendPrompt, collectStyleRegressionReports } from "../src/style-trend.js";

test("collects completed chapter and manual style regression reports without drafts", async () => {
  const root = await mkdtemp(join(tmpdir(), "style-trend-"));
  try {
    await mkdir(join(root, "run-a"), { recursive: true });
    await mkdir(join(root, "style-regression"), { recursive: true });
    await mkdir(join(root, "run-b"), { recursive: true });
    await writeFile(join(root, "run-a", "11-style-regression.md"), "chapter A report", "utf8");
    await writeFile(join(root, "style-regression", "manual.md"), "manual report", "utf8");
    await writeFile(join(root, "run-b", "chapter.md"), "not a regression report", "utf8");
    const reports = await collectStyleRegressionReports(root);
    assert.equal(reports.length, 2);
    assert.ok(reports.some(report => report.text === "chapter A report"));
    assert.ok(reports.some(report => report.text === "manual report"));
    assert.ok(!reports.some(report => report.text.includes("not a regression")));
    const prompt = buildStyleTrendPrompt({ styleProfile: "活泼、克制", reports });
    assert.match(prompt, /不要给总分/);
    assert.match(prompt, /chapter A report/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validates trend report limits", async () => {
  await assert.rejects(() => collectStyleRegressionReports("/missing", 0), /between 1 and 100/);
});
