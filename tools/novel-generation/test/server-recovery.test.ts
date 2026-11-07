import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverWorkbenchRuns } from "../src/server.js";

test("startup recovery removes abandoned universe staging directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-recovery-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    const worlds = join(root, "worlds");
    const abandoned = join(worlds, ".staging-u-0123456789abcdef");
    const unrelated = join(worlds, ".staging-not-a-universe");
    await mkdir(abandoned, { recursive: true });
    await mkdir(unrelated, { recursive: true });
    await writeFile(join(abandoned, "partial.json"), "{}");
    await recoverWorkbenchRuns();
    await assert.rejects(() => access(abandoned));
    await access(unrelated);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
