import { access, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Resolve the only legal retrieval corpus for a world.
 * Historical universes must use their bounded local snapshot; source-canon is
 * identity metadata, never permission to search the parent's full-book index.
 */
export async function resolveWorldLibraryDir(worldId: string, worldsRoot = path.resolve("worlds")): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(worldId)) throw new Error("Invalid world id.");
  const worldDir = path.resolve(worldsRoot, worldId);
  const pointerPath = path.join(worldDir, "source-canon.json");
  let pointer: { sourceWorldId?: string; readOnly?: boolean } | undefined;
  try { pointer = JSON.parse(await readFile(pointerPath, "utf8")) as { sourceWorldId?: string; readOnly?: boolean }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!pointer?.readOnly) return path.join(worldDir, "library");
  if (!pointer.sourceWorldId || !/^[a-z0-9][a-z0-9-]*$/i.test(pointer.sourceWorldId)) {
    throw new Error("故事宇宙的 Source Canon 指针无效；为避免检索到其他世界的剧情，已停止检索。");
  }
  const boundedLibraryDir = path.join(worldDir, "library");
  try { await access(path.join(boundedLibraryDir, "index.json")); }
  catch {
    throw new Error("该故事宇宙缺少按起点章节截断的原文检索索引。为避免检索到起点之后的剧情，拒绝回退到原文项目的全书索引。请重新创建宇宙或修复时点索引。");
  }
  return boundedLibraryDir;
}
