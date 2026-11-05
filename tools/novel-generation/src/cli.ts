import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateStory, type GenerationMode } from "./generate.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function usage(): never {
  console.error("Usage: npm run dev -- generate --brief \"story idea\" [--mode derivative|continuation] [--source file] [--context file] [--out file] [--model model] [--max-words number]");
  process.exit(2);
}

async function main(): Promise<void> {
  if (process.argv[2] !== "generate") usage();
  const brief = arg("--brief");
  if (!brief) usage();

  const mode = (arg("--mode") ?? "derivative") as GenerationMode;
  if (mode !== "derivative" && mode !== "continuation") throw new Error("Unsupported mode: " + mode);
  const sourcePath = arg("--source");
  if (mode === "continuation" && !sourcePath) throw new Error("Continuation mode requires --source with text you provide or are authorized to use.");

  const sourceText = sourcePath ? await readFile(resolve(sourcePath), "utf8") : undefined;
  const contextPath = arg("--context");
  const contextText = contextPath ? await readFile(resolve(contextPath), "utf8") : undefined;
  const worldId = arg("--world") ?? "conghuoniao";
  const worldBible = await readFile(resolve("worlds", worldId, "world-bible.md"), "utf8");
  const outputPath = resolve(arg("--out") ?? ".output/" + worldId + "-" + Date.now() + ".md");

  const result = await generateStory({
    brief, mode, worldId, worldBible, sourceText, contextText,
    model: arg("--model"), maxWords: Number(arg("--max-words") ?? 3000)
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result, "utf8");
  console.log("\nSaved: " + outputPath);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
