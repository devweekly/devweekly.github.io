import { readdir, readFile, mkdir, writeFile, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname, join, resolve } from "node:path";

export interface StyleReferenceEntry { name: string; chars: number; updatedAt: string; }
export interface StyleReferenceChange { name: string; action: "added" | "unchanged" | "updated" | "archived"; archivePath?: string; }

function validName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\") && /\.(md|txt)$/i.test(name);
}
function stamp(): string { return new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8); }

export async function listStyleReferences(worldDir: string): Promise<StyleReferenceEntry[]> {
  const directory = join(worldDir, "style-references");
  let entries: string[];
  try { entries = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const result: StyleReferenceEntry[] = [];
  for (const name of entries.filter(validName).sort()) {
    const path = join(directory, name);
    const text = await readFile(path, "utf8");
    result.push({ name, chars: text.length, updatedAt: (await stat(path)).mtime.toISOString() });
  }
  return result;
}

/** Replace an approved sample only after archiving the previous exact bytes. */
export async function addStyleReference(worldDir: string, sourceFile: string): Promise<StyleReferenceChange> {
  const source = resolve(sourceFile);
  const name = basename(source);
  if (!validName(name)) throw new Error("Style reference must be a .md or .txt file.");
  const text = await readFile(source, "utf8");
  if (!text.trim()) throw new Error("Style reference is empty: " + sourceFile);
  const directory = join(worldDir, "style-references");
  await mkdir(directory, { recursive: true });
  const target = join(directory, name);
  let previous: string | undefined;
  try { previous = await readFile(target, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (previous === text) return { name, action: "unchanged" };
  let archivePath: string | undefined;
  if (previous !== undefined) {
    const archiveDir = join(directory, ".history", name);
    await mkdir(archiveDir, { recursive: true });
    archivePath = join(archiveDir, stamp() + extname(name));
    await writeFile(archivePath, previous, { encoding: "utf8", flag: "wx" });
  }
  await writeFile(target, text, "utf8");
  return { name, action: previous === undefined ? "added" : "updated", ...(archivePath ? { archivePath } : {}) };
}

export async function archiveStyleReference(worldDir: string, name: string): Promise<StyleReferenceChange> {
  if (!validName(name)) throw new Error("Provide an active style reference filename ending in .md or .txt.");
  const directory = join(worldDir, "style-references");
  const target = join(directory, name);
  const text = await readFile(target, "utf8");
  const archiveDir = join(directory, ".history", name);
  await mkdir(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, stamp() + extname(name));
  await writeFile(archivePath, text, { encoding: "utf8", flag: "wx" });
  const { unlink } = await import("node:fs/promises");
  await unlink(target);
  return { name, action: "archived", archivePath };
}
