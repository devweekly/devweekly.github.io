import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStyleRegressionPrompt, loadStyleRegressionReferences } from "../src/style-regression.js";

test("style regression compares approved references with candidates without imitation or gating", () => {
  const prompt = buildStyleRegressionPrompt({
    styleProfile: "叙述克制，人物声音有差异",
    references: [{ label: "approved-1.md", text: "她把信折好。" }],
    candidates: [{ label: "chapter-new.md", text: "他站在门外，没有敲门。" }],
    sceneType: "quiet dialogue"
  });
  assert.match(prompt, /识别可能的风格漂移/);
  assert.match(prompt, /区分有意的场景变化/);
  assert.match(prompt, /不要复制参考文本/);
  assert.match(prompt, /不触发自动改写/);
  assert.match(prompt, /quiet dialogue/);
});

test("missing reference samples cannot produce a no-drift conclusion", () => {
  const prompt = buildStyleRegressionPrompt({
    styleProfile: "叙述克制",
    references: [],
    candidates: [{ label: "chapter.md", text: "他没有回答。" }]
  });
  assert.match(prompt, /无法判断与原著的风格距离/);
  assert.match(prompt, /不能得出“没有风格漂移”/);
  assert.match(prompt, /不能表述为与原著一致/);
});

test("pipeline discovers curated style references automatically and bounds their size", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-style-"));
  try {
    const world = join(root, "world");
    const refs = join(world, "style-references");
    await mkdir(refs, { recursive: true });
    await writeFile(join(refs, "02-dialogue.md"), "对白样本", "utf8");
    await writeFile(join(refs, "01-scene.txt"), "场景样本", "utf8");
    await writeFile(join(refs, "ignore.json"), "ignored", "utf8");
    const samples = await loadStyleRegressionReferences(world);
    assert.deepEqual(samples.map(sample => sample.label), ["01-scene.txt", "02-dialogue.md"]);
    assert.equal(samples.length, 2);
    assert.deepEqual(await loadStyleRegressionReferences(join(root, "missing-world")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
