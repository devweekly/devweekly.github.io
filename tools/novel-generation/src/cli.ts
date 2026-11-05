import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateStory, type GenerationMode } from "./generate.js";
import { ingestFiles, listTextFiles, searchLibrary } from "./library.js";
import { writeChapter } from "./workflow.js";
import { loadStoryState } from "./story-state.js";
import { analyzeLibrary } from "./analysis.js";
import { prepareWorldAnalysis, collectWorldAnalysis, analysisStatus } from "./world-analysis.js";
import { readModelCatalog, resolveAgentModel, isManagedSession, MODEL_PREFERENCE, HY4_MODEL_IDS } from "./agent-runtime.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
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
    "  npm run dev -- analyze-world --world conghuoniao --phase prepare|status|collect",
    "  npm run dev -- models",
    "  npm run dev -- write --brief \"story direction\" [--world conghuoniao] [--mode derivative|continuation] [--source file] [--context file] [--model model] [--max-words 3000] [--apply-state]",
    "  npm run dev -- generate --brief \"story idea\" [--mode derivative|continuation] [--source file] [--context file] [--out file]"
  ].join("\n"));
  process.exit(2);
}

function safeWorldId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(value)) throw new Error("Invalid world id: " + value);
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "generate" && command !== "write" && command !== "ingest" && command !== "search" && command !== "analyze" && command !== "analyze-world" && command !== "models") usage();

  const worldId = safeWorldId(arg("--world") ?? "conghuoniao");
  const libraryDir = resolve("worlds", worldId, "library");

  if (command === "analyze-world") {
    const phase = arg("--phase") ?? "status";
    if (phase === "prepare") {
      const result = await prepareWorldAnalysis(worldId);
      console.log("Prepared " + result.roles + " agent input packs.");
      console.log("Directory: " + result.dir);
    } else if (phase === "collect") {
      const result = await collectWorldAnalysis(worldId);
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
    const resolved = resolveAgentModel(undefined, catalog);
    const hy4 = catalog.filter(model => HY4_MODEL_IDS.some(id => id === model.id));
    console.log("模型偏好：" + MODEL_PREFERENCE.join(" → "));
    console.log("目录模型数：" + catalog.length);
    console.log("hy4 系列：" + (hy4.length ? hy4.map(model => model.id + "(" + (model.credits ?? "?") + ")").join(", ") : "未读到"));
    console.log("deepseek-v4.1-flash：" + (catalog.some(model => model.id === "deepseek-v4.1-flash") ? "可用" : "目录未列出"));
    console.log("本次首选：" + resolved.model + "；回退：" + (resolved.fallbacks.join(" → ") || "无") + "；来源：" + resolved.source);
    console.log("执行环境：" + (isManagedSession() ? "IDE/Agent 托管，子进程已隔离宿主会话并自选端口" : "普通终端"));
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
  const model = arg("--model");
  const maxWords = Number(arg("--max-words") ?? 3000);
  if (!Number.isInteger(maxWords) || maxWords < 300 || maxWords > 20000) throw new Error("--max-words must be an integer between 300 and 20000.");

  if (command === "write") {
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = resolve(".output", worldId, runId);
    const statePath = resolve("worlds", worldId, "story-state.json");
    const mode = (arg("--mode") ?? (sourceText ? "continuation" : "derivative")) as GenerationMode;
    if (mode !== "derivative" && mode !== "continuation") throw new Error("Unsupported mode: " + mode);
    if (mode === "continuation" && !sourceText) throw new Error("Continuation mode requires --source with text you provide or are authorized to use.");

    const retrievalLimit = Number(arg("--retrieval-limit") ?? 6);
    if (!Number.isInteger(retrievalLimit) || retrievalLimit < 1 || retrievalLimit > 20) {
      throw new Error("--retrieval-limit must be between 1 and 20.");
    }
    const state = await loadStoryState(statePath, worldId);
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
    let annotationsByChunk = new Map<string, { entities?: unknown[]; events?: unknown[]; relations?: unknown[] }>();
    try {
      const annotationStore = JSON.parse(await readFile(resolve(libraryDir, "annotations.json"), "utf8")) as {
        annotations?: Array<{ chunkId: string; entities?: unknown[]; events?: unknown[]; relations?: unknown[] }>;
      };
      annotationsByChunk = new Map((annotationStore.annotations ?? []).map(item => [item.chunkId, item]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const retrievedContext = retrieved.map((hit, index) => {
      const annotation = annotationsByChunk.get(hit.id);
      return "[" + (index + 1) + ", score " + hit.score.toFixed(2) + "] " + hit.source + " / " + hit.chapter +
        " (offset " + hit.start + "-" + hit.end + ")\n" + hit.text +
        (annotation ? "\n抽取标注：\n" + JSON.stringify(annotation) : "");
    }).join("\n\n");

    const applyState = process.argv.includes("--apply-state");
    const chapter = await writeChapter({
      worldId, mode, brief, worldBible, styleProfile, sourceText, contextText, retrievedContext, model, maxWords,
      outputDir, statePath, applyState
    });
    console.log("\nSaved chapter: " + resolve(outputDir, "chapter.md"));
    console.log("State proposal: " + resolve(outputDir, "08-state-update.json"));
    console.log(applyState ? "Updated story state: " + statePath : "Story state unchanged; pass --apply-state after review.");
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
