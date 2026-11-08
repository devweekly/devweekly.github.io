import { copyFile, rename, rm, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

export interface CanonSourcePaths {
  projectRoot?: string;
  worldDir?: string;
}

/**
 * Resolve the canonical full text for a source world or historical universe.
 *
 * Source projects use <projectRoot>/original.txt as the canonical corpus,
 * with worlds/<id>/original.txt retained only for legacy installations.
 * Historical universes are different: they must have their own bounded copy.
 * A missing bounded copy is an error, never permission to read the full source.
 */
export async function resolveOriginalCanonPath(
  worldId: string,
  options: CanonSourcePaths = {}
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(worldId)) throw new Error("Invalid world id.");
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const worldDir = path.resolve(options.worldDir ?? path.join(projectRoot, "worlds", worldId));
  const expectedWorldDir = path.join(projectRoot, "worlds", worldId);
  if (options.worldDir === undefined && worldDir !== expectedWorldDir) throw new Error("Invalid world path.");

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

/** Copy a canonical corpus into a universe, preferring reflink but always falling back to a real copy. */
export async function copyOriginalCanonToUniverse(
  sourceWorldId: string,
  targetDir: string,
  projectRoot = process.cwd()
): Promise<boolean> {
  let source: string;
  try {
    source = await resolveOriginalCanonPath(sourceWorldId, { projectRoot });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }

  const target = path.join(targetDir, "original.txt");
  const temporary = target + ".reflink-" + process.pid;
  try {
    await copyFile(source, temporary, fsConstants.COPYFILE_FICLONE_FORCE);
    await rename(temporary, target);
    return true;
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EXDEV", "EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL"].includes(code ?? "")) throw error;
    // Do not rely on cp(sourceWorldDir, stagingDir): the canonical file may
    // live at the project root and therefore is not inside sourceWorldDir.
    await copyFile(source, target);
    return true;
  }
}
