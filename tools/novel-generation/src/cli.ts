import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateStory, type GenerationMode } from "./generate.js";
import { ingestFiles, listTextFiles, searchLibrary } from "./library.js";
import { writeChapter } from "./workflow.js";
import { loadStoryState } from "./story-state.js";

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
    "  npm run dev -- write --brief \"story direction\" [--world conghuoniao] [--mode derivative|continuation] [--source file] [--context file] [--model model] [--max-words 3000]",
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
  if (command !== "generate" && command !== "write" && command !== "ingest" && command !== "search") usage();

  const worldId = safeWorldId(arg("--world") ?? "conghuoniao");
  const libraryDir = resolve("worlds", worldId, "library");

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
    const retrievedContext = retrieved.map((hit, index) =>
      "[" + (index + 1) + ", score " + hit.score.toFixed(2) + "] " + hit.source + " / " + hit.chapter +
      " (offset " + hit.start + "-" + hit.end + ")\n" + hit.text
    ).join("\n\n");

    const chapter = await writeChapter({
      worldId, mode, brief, worldBible, sourceText, contextText, retrievedContext, model, maxWords,
      outputDir, statePath
    });
    console.log("\nSaved chapter: " + resolve(outputDir, "chapter.md"));
    console.log("Updated story state: " + statePath);
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
