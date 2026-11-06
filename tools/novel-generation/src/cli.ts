import { readFile, mkdir, writeFile } from "node:fs/promises";
import { databaseStatus, readAnnotationsByChunkIds, readStoryAnalysis, listNovelCharacters, listNovelThreads, listNovelForeshadowings, listNovelBeats, readNovelKbMeta, novelKnowledgeOverview, exportNovelKnowledge, listNovelCharacterProfiles } from "./database.js";
import { basename, dirname, join, resolve, sep } from "node:path";
import { generateStory, type GenerationMode } from "./generate.js";
import { ingestFiles, listTextFiles, searchLibrary } from "./library.js";
import { writeChapter } from "./workflow.js";
import { loadStoryState } from "./story-state.js";
import { loadRunStoryState } from "./stage-cache.js";
import { analyzeLibrary } from "./analysis.js";
import { analyzeStoryCorpus } from "./story-analysis.js";
import { buildStoryAnalysisContext } from "./story-analysis-context.js";
import { buildWritingBrief } from "./writing-brief.js";
import { indexNovelStructure } from "./novel-kb.js";
import { buildVolumeArcs, listVolumeArcs } from "./story-arcs.js";
import { buildCharacterProfiles } from "./character-profile.js";
import { prepareWorldAnalysis, collectWorldAnalysis, analysisStatus } from "./world-analysis.js";
import {
  readModelCatalog, resolveAgentModel, isManagedSession, readConfiguredModel,
  MODEL_PREFERENCE, HY4_MODEL_IDS, DEFAULT_MODEL_ID
} from "./agent-runtime.js";
import { checkRuntime } from "./runtime-check.js";
import { readTaskProfiles, STAGE_KEYS } from "./task-profiles.js";
import { writeLongChapter, chineseChars } from "./long-chapter.js";
import { loadChapters, runRegression } from "./regression.js";

/** `--model --evidence-review` 这种漏值不该把下一个开关当成取值。 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

function valuesAfter(name: string): string[] {
  const i = process.argv.indexOf(name);
  if (i < 0) return [];
  const values: string[] = [];
  for (let j = i + 1; j < process.argv.length && !process.argv[j]?.startsWith("--"); j++) {
    values.push(process.argv[j] as string);
  }
  return values;
}

function usage(): never {
  console.error([
    "Usage:",
    "  npm run dev -- ingest --world conghuoniao --input ./private/novel.txt [more files or directories]",
    "  npm run dev -- search --world conghuoniao --query \"人物或事件关键词\" [--limit 8]",
    "  npm run dev -- analyze --world conghuoniao [--limit 20] [--model model]",
    "  npm run dev -- analyze-story --world conghuoniao [--model model] [--timeout-ms 180000] [--max-chars 14000] [--shard 0/4] [--merge-only]",
    "  npm run dev -- index-story --world conghuoniao [--catalog analysis/conghuoniao/chapter-index.json]",
    "  npm run dev -- analyze-arcs --world conghuoniao [--model model] [--force]",
    "  npm run dev -- analyze-profiles --world conghuoniao [--top 24] [--names 李阎,查小刀] [--model model] [--force]",
    "  npm run dev -- story-kb --world conghuoniao [--type overview|arcs|characters|threads|foreshadowings|beats|export] [--query 关键词] [--status 状态] [--from 1] [--to 100] [--limit 50]",
    "  npm run dev -- analyze-world --world conghuoniao --phase prepare|status|collect [--source original.txt] [--model model] [--timeout-ms 90000] [--evidence-review] [--evidence-window 2]",
    "  npm run dev -- db-status --world conghuoniao",
    "  npm run dev -- models",
    "  npm run dev -- check-runtime [--model model] [--timeout-ms 90000]",
    "  npm run dev -- regress --world conghuoniao --chapter 13 [--brief \"本章任务\"] [--model deepseek-v4.1-flash] [--review-model glm-5.3-flash] [--context-lines 90] [--timeout-ms 240000]",
    "  npm run dev -- write --brief \"story direction\" [--world conghuoniao] [--mode derivative|continuation] [--source file] [--context file] [--model model] [--max-words 3000] [--strict-model] [--accept-review] [--no-apply-state] [--resume-dir .output/<world>/<run-id>]",
    "  npm run dev -- write-long --brief \"story direction\" [--scenes 8] [--max-words 10000] [--timeout-ms 180000] [--model model] [--strict-model] [--accept-review] [--no-apply-state] [--resume-dir .output/<world>/long-<run-id>]",
    "  npm run dev -- generate --brief \"story idea\" [--mode derivative|continuation] [--source file] [--context file] [--out file]"
  ].join("\n"));
  process.exit(2);
}

function resolveRunOutputDir(worldId: string, kind: "write" | "write-long", fallback: string): string {
  const requested = arg("--resume-dir");
  if (!requested) return fallback;
  const outputDir = resolve(requested);
  const worldOutputRoot = resolve(".output", worldId) + sep;
  if (!outputDir.startsWith(worldOutputRoot)) {
    throw new Error("--resume-dir must point inside .output/" + worldId + ".");
  }
  const isLong = basename(outputDir).startsWith("long-");
  if ((kind === "write-long") !== isLong) {
    throw new Error("--resume-dir points to a different pipeline type.");
  }
  return outputDir;
}

function safeWorldId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(value)) throw new Error("Invalid world id: " + value);
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "generate" && command !== "write" && command !== "write-long" && command !== "regress" && command !== "ingest" && command !== "search" && command !== "analyze" && command !== "analyze-story" && command !== "index-story" && command !== "story-kb" && command !== "analyze-arcs" && command !== "analyze-profiles" && command !== "analyze-world" && command !== "models" && command !== "check-runtime" && command !== "db-status") usage();

  const worldId = safeWorldId(arg("--world") ?? "conghuoniao");
  const libraryDir = resolve("worlds", worldId, "library");

  if (command === "db-status") {
    const worldDir = resolve("worlds", worldId);
    await loadStoryState(resolve(worldDir, "story-state.json"), worldId);
    await searchLibrary(libraryDir, "__sqlite_migration_probe__", 1);
    readAnnotationsByChunkIds(worldDir, worldId, ["__sqlite_migration_probe__"]);
    console.log(JSON.stringify(databaseStatus(worldDir, worldId), null, 2));
    return;
  }

  if (command === "index-story") {
    const worldDir = resolve("worlds", worldId);
    await loadStoryState(resolve(worldDir, "story-state.json"), worldId);
    const result = await indexNovelStructure(worldId, { worldDir, catalogPath: arg("--catalog") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "analyze-arcs") {
    const worldDir = resolve("worlds", worldId);
    await loadStoryState(resolve(worldDir, "story-state.json"), worldId);
    const result = await buildVolumeArcs(worldId, {
      worldDir, model: arg("--model"),
      timeoutMs: Number(arg("--timeout-ms") ?? 180_000),
      force: process.argv.includes("--force")
    });
    console.log(JSON.stringify({ volumes: result.arcs.length, generated: result.generated, cached: result.cached }, null, 2));
    return;
  }

  if (command === "analyze-profiles") {
    const worldDir = resolve("worlds", worldId);
    const result = await buildCharacterProfiles(worldId, {
      worldDir,
      model: arg("--model"),
      top: Number(arg("--top") ?? 24),
      timeoutMs: Number(arg("--timeout-ms") ?? 150_000),
      force: process.argv.includes("--force"),
      names: (arg("--names") ?? "").split(",").map(name => name.trim()).filter(Boolean)
    });
    console.log(JSON.stringify({
      profiles: result.profiles.length,
      generated: result.generated,
      cached: result.cached,
      failed: result.failed,
      skipped: result.skipped
    }, null, 2));
    return;
  }

  if (command === "story-kb") {
    const worldDir = resolve("worlds", worldId);
    const type = arg("--type") ?? "characters";
    const limit = Number(arg("--limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new Error("--limit must be between 1 and 2000.");
    if (type === "export") {
      const out = resolve(arg("--out") ?? join("worlds", worldId, "story-kb.json"));
      const snapshot = exportNovelKnowledge(worldDir, worldId);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(snapshot) + "\n", "utf8");
      console.log(JSON.stringify({ out, characters: snapshot.characters.length, characterProfiles: snapshot.characterProfiles.length, threads: snapshot.threads.length, foreshadowings: snapshot.foreshadowings.length, beats: snapshot.beats.length, arcs: snapshot.arcs.length }, null, 2));
    }
    else if (type === "overview") console.log(JSON.stringify(novelKnowledgeOverview(worldDir, worldId), null, 2));
    else if (type === "arcs") console.log(JSON.stringify({ arcs: listVolumeArcs(worldDir, worldId) }, null, 2));
    else if (type === "characters") {
      const profiles = listNovelCharacterProfiles(worldDir, worldId);
      const characters = listNovelCharacters(worldDir, worldId, { query: arg("--query"), limit })
        .map(character => ({ ...character, profile: profiles.get(character.name) ?? null }));
      console.log(JSON.stringify({ meta: readNovelKbMeta(worldDir, worldId), characters }, null, 2));
    }
    else if (type === "threads") console.log(JSON.stringify({ threads: listNovelThreads(worldDir, worldId, { limit, status: arg("--status"), query: arg("--query") }) }, null, 2));
    else if (type === "foreshadowings") console.log(JSON.stringify({ foreshadowings: listNovelForeshadowings(worldDir, worldId, { limit, status: arg("--status"), query: arg("--query") }) }, null, 2));
    else if (type === "beats") console.log(JSON.stringify({ beats: listNovelBeats(worldDir, worldId, { from: Number(arg("--from") ?? 0), to: Number(arg("--to") ?? 9999), limit }) }, null, 2));
    else throw new Error("--type must be overview, arcs, characters, threads, foreshadowings, beats or export.");
    return;
  }

  if (command === "analyze-world") {
    const phase = arg("--phase") ?? "status";
    if (phase === "prepare") {
      const result = await prepareWorldAnalysis(worldId);
      console.log("Prepared " + result.roles + " agent input packs.");
      console.log("Directory: " + result.dir);
    } else if (phase === "collect") {
      const timeoutMs = Number(arg("--timeout-ms") ?? 90_000);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 600_000) {
        throw new Error("--timeout-ms must be an integer between 5000 and 600000.");
      }
      const result = await collectWorldAnalysis(worldId, {
        sourcePath: arg("--source") ?? "original.txt",
        model: arg("--model"),
        timeoutMs,
        evidenceReview: process.argv.includes("--evidence-review"),
        evidenceWindow: process.argv.includes("--evidence-review") ? Number(arg("--evidence-window") ?? 2) : 0
      });
      for (const entry of result.entries) {
        console.log(entry.id.padEnd(12) + (entry.ok ? " OK   " : " CHECK") + " " + entry.chars + " chars / " + entry.evidenceCount + " refs" + (entry.issues.length ? " / " + entry.issues.join("; ") : ""));
      }
      console.log("Manifest: " + resolve("analysis", worldId, "agent-analysis", "manifest.json"));
      if (!result.complete) process.exitCode = 1;
    } else if (phase === "status") {
      for (const line of await analysisStatus(worldId)) console.log(line);
    } else throw new Error("Unsupported --phase: " + phase);
    return;
  }

  if (command === "models") {
    const catalog = readModelCatalog({ projectRoot: process.cwd() });
    const resolved = resolveAgentModel(undefined, catalog, undefined);
    const hy4 = catalog.filter(model => HY4_MODEL_IDS.some(id => id === model.id));
    const target = catalog.find(model => model.id === resolved.model);
    console.log("默认模型：" + DEFAULT_MODEL_ID + "；配置文件：" + (readConfiguredModel() ?? "未设置"));
    console.log("模型链：" + MODEL_PREFERENCE.join(" → "));
    console.log("目录模型数：" + catalog.length);
    console.log("hy4free：" + (hy4.length ? hy4.map(model => model.id + "(" + (model.credits ?? "?") + ")").join(", ") : "未读到"));
    console.log("deepseek-v4.1-flash：" + (catalog.some(model => model.id === "deepseek-v4.1-flash") ? "可用" : "目录未列出"));
    if (target && target.credits !== 0) console.log("计费提示：" + target.id + " credits=" + target.credits);
    console.log("本次首选：" + resolved.model + "；回退：" + (resolved.fallbacks.join(" → ") || "无") + "；来源：" + resolved.source);
    console.log("执行环境：" + (isManagedSession() ? "IDE/Agent 托管，子进程已隔离宿主会话并自选端口" : "普通终端"));
    console.log("实际请求模型请用 npm run dev -- check-runtime 核对 CLI 日志");
    const profiles = readTaskProfiles();
    const summary = STAGE_KEYS.map(stage => `${stage} ${profiles[stage].thinkingMode}/${profiles[stage].effort}`).join(" · ");
    console.log("推理档案：" + summary);
    console.log("会话：各阶段独立 query，不复用 pool session；跨场景靠显式文本交接");
    return;
  }

  if (command === "check-runtime") {
    const timeoutMs = Number(arg("--timeout-ms") ?? 90_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 600_000) {
      throw new Error("--timeout-ms must be an integer between 5000 and 600000.");
    }
    const result = await checkRuntime({ timeoutMs, model: arg("--model") });
    for (const line of result.lines) console.log(line);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "regress") {
    const chapterIndex = Number(arg("--chapter") ?? "");
    if (!Number.isInteger(chapterIndex) || chapterIndex < 1) throw new Error("--chapter 需要 1 起的整数，对应全书目录中的章序。");
    const contextLines = Number(arg("--context-lines") ?? 90);
    if (!Number.isInteger(contextLines) || contextLines < 10 || contextLines > 400) {
      throw new Error("--context-lines must be an integer between 10 and 400.");
    }
    const timeoutMs = Number(arg("--timeout-ms") ?? 240_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
      throw new Error("--timeout-ms must be an integer between 30000 and 600000.");
    }
    const targetWords = Number(arg("--max-words") ?? 0);
    if (!Number.isInteger(targetWords) || targetWords < 0 || targetWords > 20_000) {
      throw new Error("--max-words must be an integer between 0 and 20000；0 表示与原章同长。");
    }
    const indexPath = resolve("analysis", worldId, "chapter-index.json");
    const chapters = loadChapters(JSON.parse(await readFile(indexPath, "utf8")) as Parameters<typeof loadChapters>[0]);
    const chapter = chapters.find(item => item.index === chapterIndex);
    if (!chapter) throw new Error(`第 ${chapterIndex} 章不存在；本书共 ${chapters.length} 章。`);
    const styleProfile = await readOptional(resolve("worlds", worldId, "style-profile.md"));
    const styleRhythm = await readOptional(resolve("analysis", worldId, "style-rhythm.md"));
    const profiles = readTaskProfiles();
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const result = await runRegression({
      worldId,
      corpusPath: resolve("original.txt"),
      chapters,
      chapterIndex,
      contextLines,
      targetWords,
      brief: arg("--brief") ?? "承接前文，在同一时空里推进一条已有的情节线：写具体的人在做具体的事，遇到阻力、做出选择并承担后果。",
      model: arg("--model") ?? "deepseek-v4.1-flash",
      reviewModel: arg("--review-model") ?? "glm-5.3-flash",
      timeoutMs,
      styleProfile,
      styleRhythm,
      profileA: profiles.scene,
      profileB: { ...profiles.scene, thinkingMode: "adaptive", effort: "high" },
      reviewProfile: profiles.review,
      repair: process.argv.includes("--repair"),
      outputDir: resolve(".output", "regression", runId),
      archiveDir: resolve("analysis", worldId, "regression", "chapter-" + String(chapterIndex).padStart(3, "0"))
    });
    console.log(`对照章节：${result.chapter.title}（卷 ${result.chapter.volume}）`);
    for (const candidate of result.candidates) {
      const m = candidate.metrics;
      console.log(
        `候选 ${candidate.id}：${candidate.profile.thinkingMode}/${candidate.profile.effort} · ${candidate.chars} 汉字 · ` +
        `平均句长 ${m.meanSentence} · 短句 ${(m.shortRatio * 100).toFixed(0)}% · 长句 ${(m.longRatio * 100).toFixed(0)}% · ` +
        `节奏距离 ${candidate.distance} · ${candidate.seconds}s` +
        (candidate.repaired ? ` · 修订 ${(candidate.scoreBefore * 100).toFixed(0)}%→${(candidate.scoreAfter * 100).toFixed(0)}%` : " · 未修订")
      );
    }
    console.log("评审报告：" + result.reviewPath);
    console.log("归档：" + result.archiveDir);
    return;
  }

  if (command === "ingest") {
    const inputs = valuesAfter("--input");
    if (!inputs.length) usage();
    const files = await listTextFiles(inputs);
    if (!files.length) throw new Error("No .txt or .md files found in the supplied paths.");
    const count = await ingestFiles(worldId, files, libraryDir);
    console.log("Indexed " + count + " text chunks from " + files.length + " file(s).");
    console.log("Library: " + libraryDir);
    return;
  }

  if (command === "analyze") {
    const limit = Number(arg("--limit") ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be between 1 and 100.");
    const timeoutMs = Number(arg("--timeout-ms") ?? 60_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 600_000) {
      throw new Error("--timeout-ms must be an integer between 5000 and 600000.");
    }
    const result = await analyzeLibrary(libraryDir, worldId, limit, arg("--model"), timeoutMs);
    console.log("Analyzed chunks: " + result.processed);
    console.log("Failed chunks: " + result.failed);
    console.log("Remaining chunks: " + result.remaining);
    console.log("Annotations: " + resolve(libraryDir, "annotations.json"));
    return;
  }

  if (command === "analyze-story") {
    const timeoutMs = Number(arg("--timeout-ms") ?? 180_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
      throw new Error("--timeout-ms must be between 30000 and 600000.");
    }
    const shardArg = arg("--shard");
    let shard: { index: number; count: number } | undefined;
    if (shardArg) {
      const match = shardArg.match(/^(\d+)\/(\d+)$/);
      if (!match) throw new Error("--shard must look like 0/4.");
      shard = { index: Number(match[1]), count: Number(match[2]) };
    }
    const result = await analyzeStoryCorpus(worldId, {
      model: arg("--model"), timeoutMs, shard,
      mergeOnly: process.argv.includes("--merge-only"),
      limit: arg("--limit") ? Number(arg("--limit")) : undefined,
      maxChars: Number(arg("--max-chars") ?? 14_000),
      worldDir: resolve("worlds", worldId),
      catalogPath: arg("--catalog")
    });
    const snapshot = result.snapshot;
    console.log(JSON.stringify({
      batches: result.batches,
      processed: result.processed,
      cached: result.cached,
      failed: result.failed,
      pending: result.pending,
      skipped: result.skipped,
      ...(snapshot ? {
        worldId: snapshot.worldId,
        analyzedAt: snapshot.analyzedAt,
        characters: snapshot.characters.length,
        plotThreads: snapshot.plotThreads.length,
        foreshadowings: snapshot.foreshadowings.length,
        beats: (snapshot as { beats?: unknown[] }).beats?.length ?? 0,
        malformedBeats: result.malformedBeats,
        database: resolve("worlds", worldId, "novel.db")
      } : {})
    }, null, 2));
    return;
  }

  if (command === "search") {
    const query = arg("--query");
    if (!query) usage();
    const limit = Number(arg("--limit") ?? 8);
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("--limit must be between 1 and 30.");
    const hits = await searchLibrary(libraryDir, query, limit);
    for (const hit of hits) console.log("\n[" + hit.score.toFixed(2) + "] " + hit.source + " / " + hit.chapter + " / chunk " + hit.chunkIndex + "\n" + hit.text);
    if (!hits.length) console.log("No matching passages found.");
    return;
  }

  const brief = arg("--brief");
  if (!brief) usage();
  const sourcePath = arg("--source");
  const contextPath = arg("--context");
  const sourceText = sourcePath ? await readFile(resolve(sourcePath), "utf8") : undefined;
  const contextText = contextPath ? await readFile(resolve(contextPath), "utf8") : undefined;
  const worldBible = await readFile(resolve("worlds", worldId, "world-bible.md"), "utf8");
  let styleProfile: string | undefined;
  try { styleProfile = await readFile(resolve("worlds", worldId, "style-profile.md"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let styleRhythm: string | undefined;
  try { styleRhythm = await readFile(resolve("analysis", worldId, "style-rhythm.md"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const model = arg("--model");
  const maxWords = Number(arg("--max-words") ?? 3000);
  if (!Number.isInteger(maxWords) || maxWords < 300 || maxWords > 20000) throw new Error("--max-words must be an integer between 300 and 20000.");

  if (command === "write") {
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = resolveRunOutputDir(worldId, "write", resolve(".output", worldId, runId));
    const statePath = resolve("worlds", worldId, "story-state.json");
    const mode = (arg("--mode") ?? (sourceText ? "continuation" : "derivative")) as GenerationMode;
    if (mode !== "derivative" && mode !== "continuation") throw new Error("Unsupported mode: " + mode);
    if (mode === "continuation" && !sourceText) throw new Error("Continuation mode requires --source with text you provide or are authorized to use.");

    const retrievalLimit = Number(arg("--retrieval-limit") ?? 6);
    if (!Number.isInteger(retrievalLimit) || retrievalLimit < 1 || retrievalLimit > 20) {
      throw new Error("--retrieval-limit must be between 1 and 20.");
    }
    const state = await loadRunStoryState(statePath, worldId, outputDir, "write");
    const activeThreads = state.plotThreads
      .filter(thread => thread.status === "open" || thread.status === "active")
      .map(thread => thread.title);
    const retrievalQuery = [
      brief,
      contextText ?? "",
      sourceText?.slice(-1500) ?? "",
      state.currentPosition,
      ...activeThreads,
      ...state.characters.slice(0, 12).map(character => character.name)
    ].join("\n");
    const retrieved = await searchLibrary(libraryDir, retrievalQuery, retrievalLimit);
    const storyAnalysisContext = buildStoryAnalysisContext(readStoryAnalysis(resolve("worlds", worldId), worldId), retrievalQuery);
    const writingBrief = buildWritingBrief({ worldDir: resolve("worlds", worldId), worldId, query: retrievalQuery });
    console.error("[write] 注入：事实包 " + writingBrief.length + " 字 / 分析参考 " + storyAnalysisContext.length + " 字 / 检索片段 " + retrieved.length + " 条");
    const annotationsByChunk = readAnnotationsByChunkIds(resolve("worlds", worldId), worldId, retrieved.map(hit => hit.id)) as Map<string, { entities?: unknown[]; events?: unknown[]; relations?: unknown[] }>;
    const retrievedContext = retrieved.map((hit, index) => {
      const annotation = annotationsByChunk.get(hit.id);
      return "[" + (index + 1) + ", score " + hit.score.toFixed(2) + "] " + hit.source + " / " + hit.chapter +
        " (offset " + hit.start + "-" + hit.end + ")\n" + hit.text +
        (annotation ? "\n抽取标注：\n" + JSON.stringify(annotation) : "");
    }).join("\n\n");

    const applyState = !process.argv.includes("--no-apply-state");
    const chapter = await writeChapter({
      worldId, worldDir: resolve("worlds", worldId), mode, brief, worldBible, styleProfile, styleRhythm, sourceText, contextText, retrievedContext, storyAnalysisContext, writingBrief, model,
      strictModel: process.argv.includes("--strict-model"),
      acceptReview: process.argv.includes("--accept-review"), maxWords,
      outputDir, statePath, applyState
    });
    console.log("\nSaved chapter: " + resolve(outputDir, "chapter.md"));
    console.log("State proposal: " + resolve(outputDir, "08-state-update.json"));
    console.log(applyState ? "Story state automatically updated: " + statePath : "Story state unchanged (isolated/dry-run mode).");
    if (!chapter.trim()) throw new Error("Generated chapter is empty.");
    return;
  }

  if (command === "write-long") {
    const scenes = Number(arg("--scenes") ?? 8);
    if (!Number.isInteger(scenes) || scenes < 2 || scenes > 20) throw new Error("--scenes must be an integer between 2 and 20.");
    const timeoutMs = Number(arg("--timeout-ms") ?? 180_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
      throw new Error("--timeout-ms must be an integer between 30000 and 600000.");
    }
    const mode = (arg("--mode") ?? (sourceText ? "continuation" : "derivative")) as GenerationMode;
    if (mode !== "derivative" && mode !== "continuation") throw new Error("Unsupported mode: " + mode);
    if (mode === "continuation" && !sourceText) throw new Error("Continuation mode requires --source with text you provide or are authorized to use.");
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = resolveRunOutputDir(worldId, "write-long", resolve(".output", worldId, "long-" + runId));
    const statePath = resolve("worlds", worldId, "story-state.json");
    const longState = await loadRunStoryState(statePath, worldId, outputDir, "write-long");
    const storyAnalysisQuery = [brief, contextText ?? "", sourceText?.slice(-1500) ?? "", longState.currentPosition, ...longState.plotThreads.filter(thread => thread.status === "open" || thread.status === "active").map(thread => thread.title), ...longState.characters.slice(0, 12).map(character => character.name)].join("\n");
    const storyAnalysisContext = buildStoryAnalysisContext(readStoryAnalysis(resolve("worlds", worldId), worldId), storyAnalysisQuery);
    const writingBrief = buildWritingBrief({ worldDir: resolve("worlds", worldId), worldId, query: storyAnalysisQuery });
    console.error("[write-long] 注入：事实包 " + writingBrief.length + " 字 / 分析参考 " + storyAnalysisContext.length + " 字");
    const retrievalLimit = Number(arg("--retrieval-limit") ?? 4);
    if (!Number.isInteger(retrievalLimit) || retrievalLimit < 1 || retrievalLimit > 12) {
      throw new Error("--retrieval-limit must be an integer between 1 and 12.");
    }
    const chapter = await writeLongChapter({
      worldId, worldDir: resolve("worlds", worldId), mode, brief, worldBible, styleProfile, styleRhythm, sourceText, contextText, storyAnalysisContext, writingBrief, model,
      strictModel: process.argv.includes("--strict-model"),
      acceptReview: process.argv.includes("--accept-review"),
      maxWords, scenes, timeoutMs, outputDir, statePath, libraryDir, retrievalLimit,
      applyState: !process.argv.includes("--no-apply-state")
    });
    console.log("\nSaved chapter: " + resolve(outputDir, "chapter.md"));
    console.log("Scenes: " + scenes + " · Chinese characters: " + chineseChars(chapter));
    console.log("Rhythm metrics: " + resolve(outputDir, "06-rhythm-metrics.json"));
    console.log("State proposal: " + resolve(outputDir, "07-state-update.json"));
    if (!chapter.trim()) throw new Error("Generated chapter is empty.");
    return;
  }

  const mode = (arg("--mode") ?? "derivative") as GenerationMode;
  if (mode !== "derivative" && mode !== "continuation") throw new Error("Unsupported mode: " + mode);
  if (mode === "continuation" && !sourceText) throw new Error("Continuation mode requires --source with text you provide or are authorized to use.");
  const outputPath = resolve(arg("--out") ?? ".output/" + worldId + "-" + Date.now() + ".md");
  const result = await generateStory({ brief, mode, worldId, worldBible, sourceText, contextText, model, maxWords });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result + "\n", "utf8");
  console.log("\nSaved: " + outputPath);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
