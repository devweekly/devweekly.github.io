// 唯一 CLI 入口：参数解析、worldId 校验（^[a-z0-9][a-z0-9-]*$）、命令分派，以及把
// brief / 故事当前位置 / 未结情节线 / 人物组装成检索查询。所有路径经 resolve() 锚定 CWD，
// 必须在 tools/novel-generation 目录运行，换目录会把 worlds/、.output/、analysis/ 读写到错误位置。
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { databaseStatus, readAnnotationsByChunkIds, readStoryAnalysis, listNovelCharacters, listNovelThreads, listNovelForeshadowings, listNovelBeats, readNovelKbMeta, novelKnowledgeOverview, exportNovelKnowledge, listNovelCharacterProfiles, listNovelCharacterChapterStates } from "./database.js";
import { basename, dirname, join, resolve, sep } from "node:path";
import { generateStory, runAgentText, type GenerationMode } from "./generate.js";
import { ingestFiles, listTextFiles, searchLibrary } from "./library.js";
import { writeChapter } from "./workflow.js";
import { loadStoryState } from "./story-state.js";
import { buildStoryStateGraph, filterGraph, filterStoryStateGraph } from "./story-state-graph.js";
import { loadRunStoryState } from "./stage-cache.js";
import { analyzeLibrary } from "./analysis.js";
import { analyzeStoryCorpus } from "./story-analysis.js";
import { buildStoryAnalysisContext } from "./story-analysis-context.js";
import { buildWritingBrief } from "./writing-brief.js";
import {
  MAX_AGENT_TIMEOUT_MS,
  MAX_MAX_WORDS,
  MAX_SCENES,
  MIN_AGENT_TIMEOUT_MS,
  MIN_MAX_WORDS,
  MIN_SCENES,
  MIN_WRITE_TIMEOUT_MS,
  PROFILE_ANALYSIS_DEFAULT_TIMEOUT_MS,
  DEFAULT_REGRESSION_TIMEOUT_MS,
  STORY_ANALYSIS_QUERY_CHARACTERS,
  ANALYSIS_BATCH_CHARS,
  ANALYSIS_DEFAULT_TIMEOUT_MS,
  QUERY_CONTEXT_CHARACTERS,
  QUERY_SOURCE_TAIL_CHARS,
  DEFAULT_AGENT_TIMEOUT_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  KB_DEFAULT_LIMIT,
  KB_MAX_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  DEFAULT_ANALYZE_LIMIT,
  MAX_ANALYZE_LIMIT,
  DEFAULT_MAX_WORDS,
  DEFAULT_SCENES,
  WRITE_RETRIEVAL_LIMIT,
  WRITE_LONG_RETRIEVAL_LIMIT,
  PROFILE_DEFAULT_TOP,
  DEFAULT_CONTEXT_LINES,
  MIN_CONTEXT_LINES,
  MAX_CONTEXT_LINES
} from "./constants.js";
import { indexNovelStructure } from "./novel-kb.js";
import { buildVolumeArcs, listVolumeArcs } from "./story-arcs.js";
import { buildCharacterProfiles } from "./character-profile.js";
import { analyzeCharacterChapterStates } from "./character-chapter-state.js";
import { prepareWorldAnalysis, collectWorldAnalysis, analysisStatus } from "./world-analysis.js";
import {
  readModelCatalog, resolveAgentModel, isManagedSession, readConfiguredModel,
  MODEL_PREFERENCE, HY4_MODEL_IDS, DEFAULT_MODEL_ID
} from "./agent-runtime.js";
import { checkRuntime } from "./runtime-check.js";
import { readTaskProfiles, STAGE_KEYS } from "./task-profiles.js";
import { writeLongChapter, chineseChars } from "./long-chapter.js";
import { loadChapters, runRegression } from "./regression.js";
import { formatStoryPlan, generateStoryPlan, loadStoryPlan, saveStoryPlan } from "./story-plan.js";
import { buildStyleDistillationPrompt } from "./style-distillation.js";
import { buildStyleRegressionPrompt } from "./style-regression.js";
import { buildStyleTrendPrompt, collectStyleRegressionReports } from "./style-trend.js";
import { addStyleReference, archiveStyleReference, listStyleReferences, listStyleReferenceHistory } from "./style-references.js";
import { runRoleplaySandbox } from "./roleplay-sandbox.js";
import { analyzeCorpusCraft, buildCorpusCraftContext } from "./corpus-craft.js";
import { rebuildVaneIndex, searchVane } from "./vane-retrieval.js";

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
    "  npm run dev -- analyze --world conghuoniao [--limit 20 | --all] [--batch-size 20] [--model model]",
    "  npm run dev -- distill-style --world conghuoniao --input ./private/style-sample-1.txt ./private/style-sample-2.md [--out .output/<world>/style-profile-candidate.md] [--activate] [--model model]",
    "  npm run dev -- style-regress --world conghuoniao --reference ./benchmarks/ref-1.md [more files] --candidate .output/chapter.md [more files] [--scene-type dialogue] [--out .output/<world>/style-regression/report.md]",
    "  npm run dev -- style-trend --world conghuoniao [--limit 30] [--model model] [--out .output/<world>/style-regression-trend/report.md]",
    "  npm run dev -- style-reference --world conghuoniao --list | --history [dialogue.md] | --add ./samples/dialogue.md [more files] | --remove dialogue.md",
    "  npm run dev -- roleplay-sandbox --world conghuoniao --brief \"场景设定\" --characters 人物甲,人物乙 [--model model] [--out file]",
    "  npm run dev -- analyze-story --world conghuoniao [--model model] [--timeout-ms 180000] [--max-chars 14000] [--shard 0/4] [--merge-only] [--delta]",
    "  npm run dev -- plan-story --world conghuoniao [--model model] [--draft] [--activate-candidate <file>]  # 默认生成后自动激活；--draft 仅保存实验草稿",
    "  npm run dev -- index-story --world conghuoniao [--catalog analysis/conghuoniao/chapter-index.json]",
    "  npm run dev -- analyze-arcs --world conghuoniao [--model model] [--force]",
    "  npm run dev -- analyze-profiles --world conghuoniao [--top 24] [--names 李阎,查小刀] [--model model] [--force]",
    "  npm run dev -- analyze-character-states --world conghuoniao [--limit 20] [--shard 0/4] [--names 李阎,查小刀] [--model model] [--force]",
    "  npm run dev -- analyze-corpus-craft --world conghuoniao [--limit 20] [--shard 0/4] [--model model] [--timeout-ms 180000] [--force]",
    "  npm run dev -- vane-index --world conghuoniao",
    "  npm run dev -- story-kb --world conghuoniao [--type overview|arcs|characters|character-states|threads|foreshadowings|beats|graph|export] [--query 关键词] [--status 状态] [--from 1] [--to 100] [--limit 50]",
    "  npm run dev -- story-state --world conghuoniao [--type overview|characters|events|threads|relationships|foreshadowings|macguffins|graph] [--query 关键词] [--limit 500]",
    "  npm run dev -- analyze-world --world conghuoniao --phase prepare|status|collect [--source original.txt] [--model model] [--timeout-ms 90000] [--evidence-review] [--evidence-window 2]",
    "  npm run dev -- db-status --world conghuoniao",
    "  npm run dev -- verify-world --world conghuoniao",
    "  npm run dev -- models",
    "  npm run dev -- check-runtime [--model model] [--timeout-ms 90000]",
    "  npm run dev -- regress --world conghuoniao --chapter 13 [--brief \"本章任务\"] [--model deepseek-v4.1-flash] [--review-model glm-5.3-flash] [--context-lines 90] [--timeout-ms 240000]",
    "  npm run dev -- write --brief \"story direction\" [--world conghuoniao] [--mode derivative|continuation] [--source file] [--context file] [--model model] [--max-words 3000] [--strict-model] [--no-apply-state] [--resume-dir .output/<world>/<run-id>]",
    "  npm run dev -- write-long --brief \"story direction\" [--scenes 8] [--max-words 10000] [--timeout-ms 180000] [--model model] [--strict-model] [--no-apply-state] [--resume-dir .output/<world>/long-<run-id>]",
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

/** Candidate artifacts must stay inside the world's ignored .output directory. */
function resolveWorldOutputPath(requested: string | undefined, worldId: string, fallback: string): string {
  const root = resolve(".output", worldId);
  const output = resolve(requested ?? fallback);
  if (output !== root && !output.startsWith(root + sep)) {
    throw new Error("--out must point inside " + root + " to avoid overwriting project or canon files.");
  }
  return output;
}

const COMMANDS = new Set([
  "generate", "write", "write-long", "regress", "ingest", "search", "analyze", "analyze-story",
  "index-story", "story-kb", "story-state", "analyze-arcs", "analyze-profiles", "analyze-character-states",
  "analyze-world", "models", "check-runtime", "db-status", "verify-world", "plan-story", "distill-style",
  "style-regress", "roleplay-sandbox", "style-reference", "style-trend", "analyze-corpus-craft", "vane-index"
]);

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!COMMANDS.has(command as string)) usage();

  const worldId = safeWorldId(arg("--world") ?? "conghuoniao");
  const libraryDir = resolve("worlds", worldId, "library");

  if (command === "roleplay-sandbox") {
    const brief = arg("--brief");
    const names = (arg("--characters") ?? "").split(",").map(name => name.trim()).filter(Boolean);
    if (!brief || !names.length) usage();
    const worldDir = resolve("worlds", worldId);
    const state = await loadStoryState(resolve(worldDir, "story-state.json"), worldId);
    const characters = state.characters.filter(character => names.includes(character.name));
    const missing = names.filter(name => !characters.some(character => character.name === name));
    if (missing.length) throw new Error("人物不在当前 Story State 中：" + missing.join("、"));
    const characterProfiles = listNovelCharacterProfiles(worldDir, worldId);
    const enrichedCharacters = characters.map(character => ({
      ...character,
      longTermProfile: characterProfiles.get(character.name) ?? null
    }));
    const storyAnalysisContext = buildStoryAnalysisContext(
      readStoryAnalysis(worldDir, worldId),
      [brief, ...names].join("\n")
    );
    const worldBible = await readFile(resolve(worldDir, "world-bible.md"), "utf8");
    const timeoutMs = Number(arg("--timeout-ms") ?? DEFAULT_AGENT_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_AGENT_TIMEOUT_MS || timeoutMs > MAX_AGENT_TIMEOUT_MS) {
      throw new Error("--timeout-ms must be between " + MIN_AGENT_TIMEOUT_MS + " and " + MAX_AGENT_TIMEOUT_MS + ".");
    }
    const transcript = await runRoleplaySandbox({
      brief,
      worldBible,
      characters: enrichedCharacters,
      storyAnalysisContext,
      model: arg("--model"),
      timeoutMs,
      profile: readTaskProfiles().creative
    });
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const out = resolveWorldOutputPath(arg("--out"), worldId, join(".output", worldId, "roleplay-sandbox", runId + ".md"));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, transcript, "utf8");
    console.log("推演记录已保存（非正史）：" + out);
    return;
  }

  if (command === "verify-world") {
    const worldDir = resolve("worlds", worldId);
    const status = databaseStatus(worldDir, worldId);
    const snapshot = readStoryAnalysis(worldDir, worldId);
    let chunks = 0;
    let reviewedAnnotations = 0;
    let annotationFailures = 0;
    let annotationFileAvailable = false;
    try {
      const index = JSON.parse(await readFile(join(libraryDir, "index.json"), "utf8")) as { chunks?: unknown[] };
      chunks = Array.isArray(index.chunks) ? index.chunks.length : 0;
    } catch { /* report missing index below */ }
    try {
      const store = JSON.parse(await readFile(join(libraryDir, "annotations.json"), "utf8")) as {
        annotations?: Array<{ chunkId?: string; evidenceReviews?: unknown[] }>; failures?: unknown[];
      };
      annotationFileAvailable = true;
      reviewedAnnotations = new Set((store.annotations ?? []).filter(item => item.chunkId && Array.isArray(item.evidenceReviews)).map(item => item.chunkId)).size;
      annotationFailures = (store.failures ?? []).length;
    } catch { /* report missing annotation store below */ }
    const v6Complete = Boolean(snapshot && snapshot.analysisVersion === 6 && snapshot.complete === true && snapshot.storyGraph);
    const annotationsComplete = chunks > 0 && reviewedAnnotations === chunks && status.annotations === reviewedAnnotations && annotationFailures === 0;
    console.log(JSON.stringify({
      worldId, database: status,
      originalStoryGraph: {
        complete: v6Complete, analysisVersion: snapshot?.analysisVersion ?? null,
        sourceHash: snapshot?.sourceHash ?? null, analyzedAt: snapshot?.analyzedAt ?? null,
        nextStep: v6Complete ? null : "npm run dev -- analyze-story --world " + worldId + " --delta --merge-only"
      },
      annotations: {
        libraryChunks: chunks, reviewed: reviewedAnnotations, failures: annotationFailures,
        databaseRows: status.annotations, fileAvailable: annotationFileAvailable,
        complete: annotationsComplete,
        nextStep: annotationsComplete ? null : "npm run dev -- analyze --world " + worldId + " --all --batch-size 20"
      },
      characterChapterStates: {
        rows: status.novelCharacterChapterStates,
        nextStep: status.novelCharacterChapterStates ? null : "npm run dev -- analyze-character-states --world " + worldId
      }
    }, null, 2));
    return;
  }

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
      timeoutMs: Number(arg("--timeout-ms") ?? DEFAULT_AGENT_TIMEOUT_MS),
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
      top: Number(arg("--top") ?? PROFILE_DEFAULT_TOP),
      timeoutMs: Number(arg("--timeout-ms") ?? PROFILE_ANALYSIS_DEFAULT_TIMEOUT_MS),
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

  if (command === "analyze-corpus-craft") {
    const shardArg = arg("--shard");
    let shard: { index: number; count: number } | undefined;
    if (shardArg) {
      const match = shardArg.match(/^(\d+)\/(\d+)$/);
      if (!match) throw new Error("--shard must look like 0/4.");
      shard = { index: Number(match[1]), count: Number(match[2]) };
      if (shard.count < 1 || shard.index >= shard.count) throw new Error("--shard index must be less than shard count.");
    }
    const limitArg = arg("--limit");
    const limit = limitArg === undefined ? undefined : Number(limitArg);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer.");
    const timeoutMs = Number(arg("--timeout-ms") ?? DEFAULT_AGENT_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_WRITE_TIMEOUT_MS || timeoutMs > MAX_AGENT_TIMEOUT_MS) {
      throw new Error("--timeout-ms must be between " + MIN_WRITE_TIMEOUT_MS + " and " + MAX_AGENT_TIMEOUT_MS + ".");
    }
    const result = await analyzeCorpusCraft(worldId, {
      worldDir: resolve("worlds", worldId), model: arg("--model"), timeoutMs,
      limit, shard, force: process.argv.includes("--force")
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed) process.exitCode = 1;
    return;
  }

  if (command === "vane-index") {
    const result = await rebuildVaneIndex(worldId, resolve("worlds", worldId));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "analyze-character-states") {
    const shardArg = arg("--shard");
    let shard: { index: number; count: number } | undefined;
    if (shardArg) {
      const match = shardArg.match(/^(\d+)\/(\d+)$/);
      if (!match) throw new Error("--shard must look like 0/4.");
      shard = { index: Number(match[1]), count: Number(match[2]) };
    }
    const limitArg = arg("--limit");
    const limit = limitArg === undefined ? undefined : Number(limitArg);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer.");
    const timeoutMs = Number(arg("--timeout-ms") ?? DEFAULT_AGENT_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_WRITE_TIMEOUT_MS || timeoutMs > MAX_AGENT_TIMEOUT_MS) {
      throw new Error("--timeout-ms must be between " + MIN_WRITE_TIMEOUT_MS + " and " + MAX_AGENT_TIMEOUT_MS + ".");
    }
    const result = await analyzeCharacterChapterStates(worldId, {
      worldDir: resolve("worlds", worldId), model: arg("--model"),
      timeoutMs,
      force: process.argv.includes("--force"), limit, shard,
      names: (arg("--names") ?? "").split(",").map(name => name.trim()).filter(Boolean)
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "story-state") {
    const worldDir = resolve("worlds", worldId);
    const state = await loadStoryState(resolve(worldDir, "story-state.json"), worldId);
    const type = arg("--type") ?? "overview";
    const query = (arg("--query") ?? "").trim().toLocaleLowerCase();
    const limit = Number(arg("--limit") ?? (type === "graph" ? 500 : 100));
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error("--limit must be between 1 and 5000.");
    const matches = (value: unknown): boolean => !query || (JSON.stringify(value ?? null) ?? "").toLocaleLowerCase().includes(query);
    const take = <T,>(items: T[]): T[] => items.filter(matches).slice(0, limit);
    if (type === "overview") {
      console.log(JSON.stringify({
        worldId: state.worldId, updatedAt: state.updatedAt, currentPosition: state.currentPosition,
        counts: {
          characters: state.characters.length, events: state.events.length, plotThreads: state.plotThreads.length,
          relationshipUpdates: state.relationshipUpdates?.length ?? 0,
          foreshadowingUpdates: state.foreshadowingUpdates?.length ?? 0,
          macguffinUpdates: state.macguffinUpdates?.length ?? 0,
          arcMilestones: state.characters.reduce((sum, character) => sum + (character.arcMilestones?.length ?? 0), 0)
        }
      }, null, 2));
    } else if (type === "characters") console.log(JSON.stringify({ characters: take(state.characters) }, null, 2));
    else if (type === "events") console.log(JSON.stringify({ events: take(state.events) }, null, 2));
    else if (type === "threads") console.log(JSON.stringify({ plotThreads: take(state.plotThreads) }, null, 2));
    else if (type === "relationships") console.log(JSON.stringify({ relationshipUpdates: take(state.relationshipUpdates ?? []) }, null, 2));
    else if (type === "foreshadowings") console.log(JSON.stringify({ foreshadowingUpdates: take(state.foreshadowingUpdates ?? []) }, null, 2));
    else if (type === "macguffins") console.log(JSON.stringify({ macguffinUpdates: take(state.macguffinUpdates ?? []) }, null, 2));
    else if (type === "graph") {
      const graph = filterStoryStateGraph(buildStoryStateGraph(state), query, limit);
      console.log(JSON.stringify(graph, null, 2));
    }
    else throw new Error("--type must be overview, characters, events, threads, relationships, foreshadowings, macguffins or graph.");
    return;
  }

  if (command === "story-kb") {
    const worldDir = resolve("worlds", worldId);
    const type = arg("--type") ?? "characters";
    const limit = Number(arg("--limit") ?? KB_DEFAULT_LIMIT);
    if (!Number.isInteger(limit) || limit < 1 || limit > KB_MAX_LIMIT) throw new Error("--limit must be between 1 and " + KB_MAX_LIMIT + ".");
    if (type === "export") {
      const out = resolve(arg("--out") ?? join("worlds", worldId, "story-kb.json"));
      const snapshot = exportNovelKnowledge(worldDir, worldId);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(snapshot) + "\n", "utf8");
      console.log(JSON.stringify({
        out,
        characters: snapshot.characters.length,
        characterProfiles: snapshot.characterProfiles.length,
        characterChapterStates: snapshot.characterChapterStates.length,
        threads: snapshot.threads.length,
        foreshadowings: snapshot.foreshadowings.length,
        beats: snapshot.beats.length,
        arcs: snapshot.arcs.length
      }, null, 2));
    }
    else if (type === "overview") console.log(JSON.stringify(novelKnowledgeOverview(worldDir, worldId), null, 2));
    else if (type === "arcs") console.log(JSON.stringify({ arcs: listVolumeArcs(worldDir, worldId) }, null, 2));
    else if (type === "characters") {
      const profiles = listNovelCharacterProfiles(worldDir, worldId);
      const characters = listNovelCharacters(worldDir, worldId, { query: arg("--query"), limit })
        .map(character => ({ ...character, profile: profiles.get(character.name) ?? null }));
      console.log(JSON.stringify({ meta: readNovelKbMeta(worldDir, worldId), characters }, null, 2));
    }
    else if (type === "character-states") {
      // --from/--to 未传时不传条件，而不是传 NaN；Number(undefined) 会被当成有效过滤。
      console.log(JSON.stringify({
        states: listNovelCharacterChapterStates(worldDir, worldId, {
          name: arg("--query"),
          fromOrdinal: arg("--from") ? Number(arg("--from")) : undefined,
          toOrdinal: arg("--to") ? Number(arg("--to")) : undefined,
          limit
        })
      }, null, 2));
    }
    else if (type === "threads") console.log(JSON.stringify({ threads: listNovelThreads(worldDir, worldId, { limit, status: arg("--status"), query: arg("--query") }) }, null, 2));
    else if (type === "foreshadowings") console.log(JSON.stringify({ foreshadowings: listNovelForeshadowings(worldDir, worldId, { limit, status: arg("--status"), query: arg("--query") }) }, null, 2));
    else if (type === "beats") console.log(JSON.stringify({ beats: listNovelBeats(worldDir, worldId, { from: Number(arg("--from") ?? 0), to: Number(arg("--to") ?? Number.MAX_SAFE_INTEGER), limit }) }, null, 2));
    else if (type === "graph") {
      const snapshot = readStoryAnalysis(worldDir, worldId);
      const graph = snapshot?.storyGraph;
      if (!snapshot || !graph || snapshot.analysisVersion !== 6 || snapshot.complete !== true) {
        throw new Error("A complete v6 original story graph is not available. Finish all analyze-story v6 batches, then run --delta --merge-only before querying the graph.");
      }
      const query = arg("--query") ?? "";
      console.log(JSON.stringify({
        worldId, analysisVersion: snapshot.analysisVersion, complete: snapshot.complete,
        sourceHash: snapshot.sourceHash, ...filterGraph(graph, query, limit)
      }, null, 2));
    }
    else throw new Error("--type must be overview, arcs, characters, character-states, threads, foreshadowings, beats, graph or export.");
    return;
  }

  if (command === "analyze-world") {
    const phase = arg("--phase") ?? "status";
    if (phase === "prepare") {
      const result = await prepareWorldAnalysis(worldId);
      console.log("Prepared " + result.roles + " agent input packs.");
      console.log("Directory: " + result.dir);
    } else if (phase === "collect") {
      const timeoutMs = Number(arg("--timeout-ms") ?? DEFAULT_PROBE_TIMEOUT_MS);
      if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_AGENT_TIMEOUT_MS || timeoutMs > MAX_AGENT_TIMEOUT_MS) {
        throw new Error("--timeout-ms must be an integer between " + MIN_AGENT_TIMEOUT_MS + " and " + MAX_AGENT_TIMEOUT_MS + ".");
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

  if (command === "plan-story") {
    const worldDir = resolve("worlds", worldId);
    const candidatePath = arg("--activate-candidate");
    if (candidatePath) {
      const candidate = await loadStoryPlan(resolve(candidatePath), worldId);
      if (!candidate || candidate.status !== "draft") throw new Error("--activate-candidate must point to a valid draft plan for this world.");
      const activePath = resolve(worldDir, "story-plan.json");
      const previousPlan = await loadStoryPlan(activePath, worldId);
      if (previousPlan) {
        const historyDir = resolve(worldDir, "story-plan-history");
        await mkdir(historyDir, { recursive: true });
        const historyPath = resolve(historyDir, previousPlan.updatedAt.replace(/[^a-zA-Z0-9.-]/g, "_") + ".json");
        await writeFile(historyPath, JSON.stringify(previousPlan, null, 2) + "\n", { encoding: "utf8", flag: "wx" }).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        });
      }
      await saveStoryPlan(activePath, { ...candidate, status: "active", updatedAt: new Date().toISOString() });
      console.log(JSON.stringify({ status: "active", output: activePath, source: resolve(candidatePath), archivedPreviousPlan: Boolean(previousPlan) }, null, 2));
      return;
    }
    const worldBible = await readFile(resolve(worldDir, "world-bible.md"), "utf8");
    const state = await loadStoryState(resolve(worldDir, "story-state.json"), worldId);
    const query = [state.currentPosition, ...state.plotThreads.map(thread => thread.title), ...state.characters.slice(0, STORY_ANALYSIS_QUERY_CHARACTERS).map(character => character.name)].join("\n");
    const analysisContext = buildStoryAnalysisContext(readStoryAnalysis(worldDir, worldId), query);
    const previousPlan = await loadStoryPlan(resolve(worldDir, "story-plan.json"), worldId);
    const candidate = await generateStoryPlan({worldId,worldBible,state,storyAnalysisContext:analysisContext,previousPlan,model:arg("--model")});
    const draftOnly = process.argv.includes("--draft");
    const outputPath = draftOnly
      ? resolve(".output", worldId, "story-plan-draft-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json")
      : resolve(worldDir, "story-plan.json");
    await saveStoryPlan(outputPath, { ...candidate, status: draftOnly ? "draft" : "active" });
    console.log(JSON.stringify({
      status: draftOnly ? "draft" : "active",
      output: outputPath,
      milestones: candidate.majorMilestones.length,
      longTermThreads: candidate.longTermThreads.length,
      previousPlanLoaded: Boolean(previousPlan),
      note: draftOnly
        ? "已保存隔离草稿，不影响正式写作上下文。"
        : "新主线已自动生效；可在 Web Workbench 中事后检查或手动修订。"
    }, null, 2));
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
    const timeoutMs = Number(arg("--timeout-ms") ?? DEFAULT_PROBE_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_AGENT_TIMEOUT_MS || timeoutMs > MAX_AGENT_TIMEOUT_MS) {
      throw new Error("--timeout-ms must be an integer between " + MIN_AGENT_TIMEOUT_MS + " and " + MAX_AGENT_TIMEOUT_MS + ".");
    }
    const result = await checkRuntime({ timeoutMs, model: arg("--model") });
    for (const line of result.lines) console.log(line);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "regress") {
    const chapterIndex = Number(arg("--chapter") ?? "");
    if (!Number.isInteger(chapterIndex) || chapterIndex < 1) throw new Error("--chapter 需要 1 起的整数，对应全书目录中的章序。");
    const contextLines = Number(arg("--context-lines") ?? DEFAULT_CONTEXT_LINES);
    if (!Number.isInteger(contextLines) || contextLines < MIN_CONTEXT_LINES || contextLines > MAX_CONTEXT_LINES) {
      throw new Error("--context-lines must be an integer between " + MIN_CONTEXT_LINES + " and " + MAX_CONTEXT_LINES + ".");
    }
    const timeoutMs = Number(arg("--timeout-ms") ?? DEFAULT_REGRESSION_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_WRITE_TIMEOUT_MS || timeoutMs > MAX_AGENT_TIMEOUT_MS) {
      throw new Error("--timeout-ms must be an integer between " + MIN_WRITE_TIMEOUT_MS + " and " + MAX_AGENT_TIMEOUT_MS + ".");
    }
    const targetWords = Number(arg("--max-words") ?? 0);
    if (!Number.isInteger(targetWords) || targetWords < 0 || targetWords > MAX_MAX_WORDS) {
      throw new Error("--max-words must be an integer between 0 and " + MAX_MAX_WORDS + "；0 表示与原章同长。");
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

  if (command === "style-reference") {
    const worldDir = resolve("worlds", worldId);
    const additions = valuesAfter("--add");
    const removal = arg("--remove");
    const listing = process.argv.includes("--list");
    const history = process.argv.includes("--history");
    if (Number(Boolean(additions.length)) + Number(Boolean(removal)) + Number(listing) + Number(history) !== 1) {
      throw new Error("Choose exactly one operation: --list, --history [filename], --add <file...>, or --remove <active-filename>.");
    }
    if (listing) {
      console.log(JSON.stringify(await listStyleReferences(worldDir), null, 2));
      return;
    }
    if (history) {
      console.log(JSON.stringify(await listStyleReferenceHistory(worldDir, arg("--history")), null, 2));
      return;
    }
    if (removal) {
      console.log(JSON.stringify(await archiveStyleReference(worldDir, removal), null, 2));
      return;
    }
    const changes = [];
    for (const file of additions) changes.push(await addStyleReference(worldDir, file));
    console.log(JSON.stringify(changes, null, 2));
    return;
  }

  if (command === "style-trend") {
    const styleProfile = await readOptional(resolve("worlds", worldId, "style-profile.md"));
    if (!styleProfile?.trim()) throw new Error("No active worlds/" + worldId + "/style-profile.md; distill and activate a style profile first.");
    const limit = Number(arg("--limit") ?? 30);
    const reports = await collectStyleRegressionReports(resolve(".output", worldId), limit);
    if (reports.length < 2) throw new Error("At least two completed style regression reports are required; found " + reports.length + ".");
    const report = await runAgentText(
      buildStyleTrendPrompt({ styleProfile, reports }),
      arg("--model"),
      undefined,
      readTaskProfiles().styleDistill
    );
    if (!report.trim()) throw new Error("Style trend analysis returned an empty report.");
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const out = resolveWorldOutputPath(arg("--out"), worldId,
      join(".output", worldId, "style-regression-trend", runId + ".md"));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, report.trim() + "\n", "utf8");
    console.log(JSON.stringify({ out, reports: reports.length, gate: false }, null, 2));
    return;
  }

  if (command === "style-regress") {
    const referenceFiles = valuesAfter("--reference");
    const candidateFiles = valuesAfter("--candidate");
    if (!referenceFiles.length || !candidateFiles.length) usage();
    const styleProfile = await readOptional(resolve("worlds", worldId, "style-profile.md"));
    if (!styleProfile?.trim()) throw new Error("No active worlds/" + worldId + "/style-profile.md; distill and activate a style profile first.");
    const readSamples = async (files: string[]) => Promise.all(files.map(async file => {
      const path = resolve(file);
      if (!/\.(txt|md)$/i.test(path)) throw new Error("Style regression samples must be .txt or .md files: " + file);
      const text = await readFile(path, "utf8");
      if (!text.trim()) throw new Error("Style regression sample is empty: " + file);
      return { label: file, text };
    }));
    const [references, candidates] = await Promise.all([readSamples(referenceFiles), readSamples(candidateFiles)]);
    const totalChars = [...references, ...candidates].reduce((sum, sample) => sum + sample.text.length, 0);
    const maxChars = Number(arg("--max-sample-chars") ?? 120000);
    if (!Number.isInteger(maxChars) || maxChars < 2000 || maxChars > 160000) {
      throw new Error("--max-sample-chars must be between 2000 and 160000.");
    }
    if (totalChars > maxChars) throw new Error("Style regression samples contain " + totalChars + " characters; maximum is " + maxChars + ".");
    const report = await runAgentText(
      buildStyleRegressionPrompt({ styleProfile, references, candidates, sceneType: arg("--scene-type") }),
      arg("--model"),
      undefined,
      readTaskProfiles().styleDistill
    );
    if (!report.trim()) throw new Error("Style regression returned an empty report.");
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const out = resolveWorldOutputPath(arg("--out"), worldId,
      join(".output", worldId, "style-regression", runId + ".md"));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, report.trim() + "\n", "utf8");
    console.log(JSON.stringify({ out, references: references.length, candidates: candidates.length, sampleChars: totalChars, gate: false }, null, 2));
    return;
  }

  if (command === "distill-style") {
    const inputs = valuesAfter("--input");
    if (!inputs.length) usage();
    const maxSampleChars = Number(arg("--max-sample-chars") ?? 80000);
    if (!Number.isInteger(maxSampleChars) || maxSampleChars < 2000 || maxSampleChars > 160000) {
      throw new Error("--max-sample-chars must be between 2000 and 160000.");
    }
    const samples = await Promise.all(inputs.map(async file => {
      const path = resolve(file);
      if (!/\.(txt|md)$/i.test(path)) throw new Error("Style samples must be .txt or .md files: " + file);
      return { label: file, text: await readFile(path, "utf8") };
    }));
    const totalChars = samples.reduce((sum, sample) => sum + sample.text.length, 0);
    if (totalChars > maxSampleChars) {
      throw new Error("Style samples contain " + totalChars + " characters; reduce the inputs or raise --max-sample-chars (maximum 160000).");
    }
    const profile = await runAgentText(
      buildStyleDistillationPrompt(samples),
      arg("--model"),
      undefined,
      readTaskProfiles().styleDistill
    );
    if (!profile.trim()) throw new Error("Style distillation returned an empty profile.");
    const out = resolveWorldOutputPath(arg("--out"), worldId, join(".output", worldId, "style-profile-candidate.md"));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, profile.trim() + "\n", "utf8");
    let activated = false;
    if (process.argv.includes("--activate")) {
      const activePath = resolve("worlds", worldId, "style-profile.md");
      const previous = await readOptional(activePath);
      if (previous?.trim()) {
        const archive = resolveWorldOutputPath(undefined, worldId,
          join(".output", worldId, "style-profile-history", new Date().toISOString().replace(/[:.]/g, "-") + ".md"));
        await mkdir(dirname(archive), { recursive: true });
        await writeFile(archive, previous, "utf8");
      }
      await mkdir(dirname(activePath), { recursive: true });
      await writeFile(activePath, profile.trim() + "\n", "utf8");
      activated = true;
    }
    console.log(JSON.stringify({ out, samples: samples.length, sampleChars: totalChars, activated }, null, 2));
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
    const limit = Number(arg("--limit") ?? DEFAULT_ANALYZE_LIMIT);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ANALYZE_LIMIT) throw new Error("--limit must be between 1 and " + MAX_ANALYZE_LIMIT + ".");
    const timeoutMs = Number(arg("--timeout-ms") ?? ANALYSIS_DEFAULT_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_AGENT_TIMEOUT_MS || timeoutMs > MAX_AGENT_TIMEOUT_MS) {
      throw new Error("--timeout-ms must be an integer between " + MIN_AGENT_TIMEOUT_MS + " and " + MAX_AGENT_TIMEOUT_MS + ".");
    }
    const batchSize = Number(arg("--batch-size") ?? limit);
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("--batch-size must be between 1 and 500.");
    let processed = 0;
    let failed = 0;
    let remaining = 0;
    let unattempted = 0;
    let batches = 0;
    do {
      const result = await analyzeLibrary(libraryDir, worldId, process.argv.includes("--all") ? batchSize : limit, arg("--model"), timeoutMs);
      processed += result.processed;
      failed += result.failed;
      remaining = result.remaining;
      unattempted = result.unattempted;
      batches++;
      console.log("[analyze] batch " + batches + " · processed " + result.processed + " · failed " + result.failed + " · unattempted " + result.unattempted + " · remaining " + result.remaining);
      if (!process.argv.includes("--all") || remaining === 0 || (result.processed === 0 && unattempted === 0)) break;
    } while (true);
    console.log(JSON.stringify({ processed, failed, unattempted, remaining, batches, complete: remaining === 0, annotations: resolve(libraryDir, "annotations.json") }, null, 2));
    return;
  }

  if (command === "analyze-story") {
    const timeoutMs = Number(arg("--timeout-ms") ?? DEFAULT_AGENT_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_WRITE_TIMEOUT_MS || timeoutMs > MAX_AGENT_TIMEOUT_MS) {
      throw new Error("--timeout-ms must be between " + MIN_WRITE_TIMEOUT_MS + " and " + MAX_AGENT_TIMEOUT_MS + ".");
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
      delta: process.argv.includes("--delta"),
      limit: arg("--limit") ? Number(arg("--limit")) : undefined,
      maxChars: Number(arg("--max-chars") ?? ANALYSIS_BATCH_CHARS),
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
    const limit = Number(arg("--limit") ?? DEFAULT_SEARCH_LIMIT);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) throw new Error("--limit must be between 1 and " + MAX_SEARCH_LIMIT + ".");
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
  const maxWords = Number(arg("--max-words") ?? DEFAULT_MAX_WORDS);
  if (!Number.isInteger(maxWords) || maxWords < MIN_MAX_WORDS || maxWords > MAX_MAX_WORDS) throw new Error("--max-words must be an integer between " + MIN_MAX_WORDS + " and " + MAX_MAX_WORDS + ".");

  if (command === "write") {
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = resolveRunOutputDir(worldId, "write", resolve(".output", worldId, runId));
    const statePath = resolve("worlds", worldId, "story-state.json");
    const mode = (arg("--mode") ?? (sourceText ? "continuation" : "derivative")) as GenerationMode;
    if (mode !== "derivative" && mode !== "continuation") throw new Error("Unsupported mode: " + mode);
    if (mode === "continuation" && !sourceText) throw new Error("Continuation mode requires --source with text you provide or are authorized to use.");

    const retrievalLimit = Number(arg("--retrieval-limit") ?? WRITE_RETRIEVAL_LIMIT);
    if (!Number.isInteger(retrievalLimit) || retrievalLimit < 1 || retrievalLimit > 20) {
      throw new Error("--retrieval-limit must be between 1 and 20.");
    }
    const state = await loadRunStoryState(statePath, worldId, outputDir, "write");
    const storyPlanText = formatStoryPlan(await loadStoryPlan(resolve("worlds", worldId, "story-plan.json"), worldId));
    let storyArcText = "";
    try { storyArcText = await readFile(resolve("worlds", worldId, "story-arc.md"), "utf8"); }\n    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const activeThreads = state.plotThreads
      .filter(thread => thread.status === "open" || thread.status === "active")
      .map(thread => thread.title);
    const retrievalQuery = [
      brief,
      contextText ?? "",
      sourceText?.slice(-QUERY_SOURCE_TAIL_CHARS) ?? "",
      state.currentPosition,
      ...activeThreads,
      storyPlanText,
      ...state.characters.slice(0, QUERY_CONTEXT_CHARACTERS).map(character => character.name)
    ].join("\n");
    const retrieved = await searchLibrary(libraryDir, retrievalQuery, retrievalLimit);
    let storyAnalysisContext = buildStoryAnalysisContext(readStoryAnalysis(resolve("worlds", worldId), worldId), retrievalQuery);
    const corpusCraftContext = await buildCorpusCraftContext(worldId, retrievalQuery);
    if (corpusCraftContext) storyAnalysisContext += "\n\n" + corpusCraftContext;
    try {
      const vaneHits = await searchVane(worldId, retrievalQuery, Math.min(retrievalLimit, 6));
      if (vaneHits.length) storyAnalysisContext += "\n\n## Vane 原文与分析素材检索\n" + vaneHits.map((hit, index) => "["+(index+1)+"] "+hit.id+" (score "+hit.score.toFixed(3)+")\n"+hit.text).join("\n\n");
    } catch (error) { console.error("[write] Vane 检索不可用，继续使用 SQLite/BM25：" + String(error)); }
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
      worldId, worldDir: resolve("worlds", worldId), mode, brief, worldBible, styleProfile, sourceText, contextText, retrievedContext, storyAnalysisContext, writingBrief, storyPlanText, storyArcText, model,
      strictModel: process.argv.includes("--strict-model"),
      maxWords,
      outputDir, statePath, applyState
    });
    console.log("\nSaved chapter: " + resolve(outputDir, "chapter.md"));
    console.log("State proposal: " + resolve(outputDir, "08-state-update.json"));
    console.log(applyState ? "Story state automatically updated: " + statePath : "Story state unchanged (isolated/dry-run mode).");
    if (!chapter.trim()) throw new Error("Generated chapter is empty.");
    return;
  }

  if (command === "write-long") {
    const scenes = Number(arg("--scenes") ?? DEFAULT_SCENES);
    if (!Number.isInteger(scenes) || scenes < MIN_SCENES || scenes > MAX_SCENES) throw new Error("--scenes must be an integer between " + MIN_SCENES + " and " + MAX_SCENES + ".");
    const timeoutMs = Number(arg("--timeout-ms") ?? DEFAULT_AGENT_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_WRITE_TIMEOUT_MS || timeoutMs > MAX_AGENT_TIMEOUT_MS) {
      throw new Error("--timeout-ms must be an integer between " + MIN_WRITE_TIMEOUT_MS + " and " + MAX_AGENT_TIMEOUT_MS + ".");
    }
    const mode = (arg("--mode") ?? (sourceText ? "continuation" : "derivative")) as GenerationMode;
    if (mode !== "derivative" && mode !== "continuation") throw new Error("Unsupported mode: " + mode);
    if (mode === "continuation" && !sourceText) throw new Error("Continuation mode requires --source with text you provide or are authorized to use.");
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = resolveRunOutputDir(worldId, "write-long", resolve(".output", worldId, "long-" + runId));
    const statePath = resolve("worlds", worldId, "story-state.json");
    const longState = await loadRunStoryState(statePath, worldId, outputDir, "write-long");
    const storyPlanText = formatStoryPlan(await loadStoryPlan(resolve("worlds", worldId, "story-plan.json"), worldId));
    // 检索查询按优先级拼装：本次 brief / 主线方向 / 传统衍生文尾段 / 原著定位句、
    // 活跃情节线标题与有限人数。顺序影响 BM25 召回，不要随意调换。
    const storyAnalysisQuery = [
      brief,
      storyPlanText,
      contextText ?? "",
      sourceText?.slice(-QUERY_SOURCE_TAIL_CHARS) ?? "",
      longState.currentPosition,
      ...longState.plotThreads
        .filter(thread => thread.status === "open" || thread.status === "active")
        .map(thread => thread.title),
      ...longState.characters.slice(0, QUERY_CONTEXT_CHARACTERS).map(character => character.name)
    ].join("\n");
    let storyAnalysisContext = buildStoryAnalysisContext(readStoryAnalysis(resolve("worlds", worldId), worldId), storyAnalysisQuery);
    const corpusCraftContext = await buildCorpusCraftContext(worldId, storyAnalysisQuery);
    if (corpusCraftContext) storyAnalysisContext += "\n\n" + corpusCraftContext;
    try {
      const vaneHits = await searchVane(worldId, storyAnalysisQuery, 6);
      if (vaneHits.length) storyAnalysisContext += "\n\n## Vane 原文与分析素材检索\n" + vaneHits.map((hit, index) => "["+(index+1)+"] "+hit.id+" (score "+hit.score.toFixed(3)+")\n"+hit.text).join("\n\n");
    } catch (error) { console.error("[write-long] Vane 检索不可用，继续使用 SQLite/BM25：" + String(error)); }
    const writingBrief = buildWritingBrief({ worldDir: resolve("worlds", worldId), worldId, query: storyAnalysisQuery });
    console.error("[write-long] 注入：事实包 " + writingBrief.length + " 字 / 分析参考 " + storyAnalysisContext.length + " 字");
    const retrievalLimit = Number(arg("--retrieval-limit") ?? WRITE_LONG_RETRIEVAL_LIMIT);
    if (!Number.isInteger(retrievalLimit) || retrievalLimit < 1 || retrievalLimit > 12) {
      throw new Error("--retrieval-limit must be an integer between 1 and 12.");
    }
    const chapter = await writeLongChapter({
      worldId, worldDir: resolve("worlds", worldId), mode, brief, worldBible, styleProfile, sourceText, contextText, storyAnalysisContext, writingBrief, storyPlanText, model,
      strictModel: process.argv.includes("--strict-model"),
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
