import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface StageEntry {
  inputHash: string;
  outputFile: string;
  outputHash: string;
  completedAt: string;
}
interface RunManifest {
  schemaVersion: 1;
  stages: Record<string, StageEntry>;
}
const manifestQueues = new Map<string, Promise<void>>();

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readManifest(path: string): Promise<RunManifest> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object") throw new Error("Invalid pipeline manifest.");
    const manifest = value as Partial<RunManifest>;
    if (manifest.schemaVersion !== 1 || !manifest.stages || typeof manifest.stages !== "object") {
      throw new Error("Unsupported pipeline manifest.");
    }
    return manifest as RunManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, stages: {} };
    throw error;
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = path + "." + process.pid + ".tmp";
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

async function updateManifest(path: string, key: string, entry: StageEntry): Promise<void> {
  const previous = manifestQueues.get(path) ?? Promise.resolve();
  const next = previous.then(async () => {
    const manifest = await readManifest(path);
    manifest.stages[key] = entry;
    await atomicWrite(path, JSON.stringify(manifest, null, 2) + "\n");
  });
  manifestQueues.set(path, next);
  await next;
}

/**
 * A stage is reusable only when its complete prompt/config fingerprint and the
 * stored output hash both match. Partial writes are never considered complete.
 */
export async function runCachedStage(input: {
  dir: string;
  key: string;
  outputFile: string;
  fingerprint: string;
  execute: () => Promise<string>;
}): Promise<string> {
  await mkdir(input.dir, { recursive: true });
  const manifestPath = resolve(input.dir, "pipeline-manifest.json");
  const inputHash = hash(input.fingerprint);
  const manifest = await readManifest(manifestPath);
  const previous = manifest.stages[input.key];
  if (previous && previous.inputHash === inputHash && previous.outputFile === input.outputFile) {
    try {
      const cached = await readFile(resolve(input.dir, input.outputFile), "utf8");
      if (hash(cached) === previous.outputHash && cached.trim()) return cached.trimEnd();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const generated = (await input.execute()).trim();
  if (!generated) throw new Error("Stage " + input.key + " returned empty output; it was not checkpointed.");
  const output = generated + "\n";
  await atomicWrite(resolve(input.dir, input.outputFile), output);
  await updateManifest(manifestPath, input.key, {
    inputHash,
    outputFile: input.outputFile,
    outputHash: hash(output),
    completedAt: new Date().toISOString()
  });
  return generated;
}
