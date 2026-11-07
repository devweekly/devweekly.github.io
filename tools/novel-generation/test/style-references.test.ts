import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addStyleReference, archiveStyleReference, listStyleReferences, listStyleReferenceHistory, readStyleReferenceVersion } from "../src/style-references.js";

test("style reference updates preserve the previous approved sample", async () => {
  const root = await mkdtemp(join(tmpdir(), "style-reference-"));
  const source = join(root, "dialogue.md");
  const world = join(root, "world");
  try {
    await mkdir(world, { recursive: true });
    await writeFile(source, "first version", "utf8");
    assert.equal((await addStyleReference(world, source)).action, "added");
    assert.equal((await addStyleReference(world, source)).action, "unchanged");
    await writeFile(source, "second version", "utf8");
    const updated = await addStyleReference(world, source);
    assert.equal(updated.action, "updated");
    assert.ok(updated.archivePath);
    assert.equal(await readFile(join(world, "style-references", "dialogue.md"), "utf8"), "second version");
    assert.equal(await readFile(updated.archivePath!, "utf8"), "first version");
    const historyVersion = updated.archivePath!.split("/").at(-1)!;
    assert.equal(await readStyleReferenceVersion(world, "dialogue.md", historyVersion), "first version");
    assert.equal((await listStyleReferenceHistory(world, "dialogue.md")).length, 1);
    assert.equal((await listStyleReferences(world))[0]?.name, "dialogue.md");
    const archived = await archiveStyleReference(world, "dialogue.md");
    assert.equal(archived.action, "archived");
    assert.equal(await listStyleReferences(world).then(items => items.length), 0);
    assert.equal(await readFile(archived.archivePath!, "utf8"), "second version");
    assert.equal((await listStyleReferenceHistory(world, "dialogue.md")).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects non-text and empty style references", async () => {
  const root = await mkdtemp(join(tmpdir(), "style-reference-"));
  try {
    const bad = join(root, "sample.json");
    const empty = join(root, "empty.md");
    await writeFile(bad, "{}", "utf8");
    await writeFile(empty, "  ", "utf8");
    await assert.rejects(() => addStyleReference(root, bad), /\.md or \.txt/);
    await assert.rejects(() => addStyleReference(root, empty), /empty/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
