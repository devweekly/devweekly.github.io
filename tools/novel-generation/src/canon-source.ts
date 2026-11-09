import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CanonSourcePaths {
  projectRoot?: string;
  worldDir?: string;
}

/**
 * Resolve the canonical full text for a source world or historical universe.
 * Source projects use <projectRoot>/original.txt, with a world-local legacy
 * fallback. Historical universes must use their own bounded local copy only.
 */
export async function resolveOriginalCanonPath(
  worldId: string,
  options: CanonSourcePaths = {}
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(worldId)) throw new Error("Invalid world id.");
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const worldDir = path.resolve(options.worldDir ?? path.join(projectRoot, "worlds", worldId));

  let isUniverse = false;
  try {
    isUniverse = (await stat(path.join(worldDir, "universe.json"))).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const localPath = path.join(worldDir, "original.txt");
  const projectPath = path.join(projectRoot, "original.txt");
  const candidates = isUniverse ? [localPath] : [projectPath, localPath];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const message = isUniverse
    ? "故事宇宙缺少自己的时点原文副本：" + localPath + "。为避免读取完整原著并泄漏起点之后的剧情，拒绝回退到项目根目录 original.txt。请从有效父宇宙重新创建或修复该副本。"
    : "找不到原著全文。已检查 " + projectPath + " 和 " + localPath + "；请确认 original.txt 位于 novel-generation 项目根目录。";
  throw Object.assign(new Error(message), { code: "ENOENT" });
}

/** Return the original prefix ending immediately before a chapter heading line. */
export function truncateCanonAtLine(text: string, endBeforeLine?: number, allowAlreadyBounded = false): string {
  if (endBeforeLine === undefined) return text;
  if (!Number.isSafeInteger(endBeforeLine) || endBeforeLine < 2) {
    throw new Error("原文时点边界行号无效，拒绝生成未截断的故事宇宙原文副本。");
  }
  const lineCount = text.split(/\\r?\\n/).length;
  if (endBeforeLine > lineCount) {
    if (allowAlreadyBounded) return text;
    throw new Error("原文时点边界超出全文范围，无法安全截断。");
  }
  let offset = 0;
  for (let line = 1; line < endBeforeLine; line++) {
    const newline = text.indexOf("\n", offset);
    if (newline < 0) throw new Error("原文时点边界超出全文范围，无法安全截断。");
    offset = newline + 1;
  }
  // Remove the line break immediately before the excluded chapter heading.
  let end = offset;
  if (end > 0 && text[end - 1] === "\n") end--;
  if (end > 0 && text[end - 1] === "\r") end--;
  return text.slice(0, end);
}

/**
 * Create an independent, as-of copy for a universe. The source project may
 * store original.txt outside worlds/<id>; never assume cp(worldDir) included it.
 */
export async function copyOriginalCanonToUniverse(
  sourceWorldId: string,
  targetDir: string,
  projectRoot = process.cwd(),
  endBeforeLine?: number,
  allowAlreadyBounded = false
): Promise<boolean> {
  let source: string;
  try {
    source = await resolveOriginalCanonPath(sourceWorldId, { projectRoot });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const text = await readFile(source, "utf8");
  const boundedText = truncateCanonAtLine(text, endBeforeLine, allowAlreadyBounded);
  await writeFile(path.join(targetDir, "original.txt"), boundedText, "utf8");
  return true;
}
