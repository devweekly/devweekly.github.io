// Paired, blind A/B evaluation of Story Memory. Both arms use the same world state,
// model and writing brief; --no-apply-state keeps the experiment isolated.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNarrativeMemoryContext } from "../src/story-memory.js";
import { listStoryMemories } from "../src/database.js";

const argv = process.argv.slice(2);
if (argv.includes("--help")) { console.log("Usage: npm run evaluate-story-memory -- --world <id> --brief <text> [--command write|write-long] [--model <id>]"); process.exit(0); }
function arg(name, fallback = "") {
  const index = argv.indexOf("--" + name);
  return index >= 0 && argv[index + 1] && !argv[index + 1]!.startsWith("--") ? argv[index + 1]! : fallback;
}
function required(name) {
  const value = arg(name);
  if (!value.trim()) throw new Error("Missing required --" + name);
  return value;
}
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const world = required("world");
if (!/^[a-z0-9][a-z0-9-]*$/.test(world)) throw new Error("Invalid world id.");
const command = arg("command", "write");
if (command !== "write" && command !== "write-long") throw new Error("--command must be write or write-long.");
const brief = required("brief");
const mode = arg("mode", "derivative");
if (mode !== "derivative" && mode !== "continuation") throw new Error("--mode must be derivative or continuation.");
const model = arg("model");
const source = arg("source");
const context = arg("context");
const timeoutMs = arg("timeout-ms", "180000");
const maxWords = arg("max-words", command === "write-long" ? "9000" : "3500");
const scenes = arg("scenes", "6");
const retrievalLimit = arg("retrieval-limit", "6");
const stateFile = arg("state-file");
const storyUnitFile = arg("story-unit-file");
const storyArcFile = arg("story-arc-file");
const strictModel = argv.includes("--strict-model");
const readerExperience = argv.includes("--reader-experience");
const runId = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8);
const outputRoot = resolve(projectRoot, ".output", world, "story-memory-evaluation", runId);
const blindDir = resolve(outputRoot, "blind");
await mkdir(blindDir, { recursive: true });

const activeMemories = listStoryMemories(resolve(projectRoot, "worlds", world), world, "all")
  .filter(memory => memory.status === "active");
if (!activeMemories.length) throw new Error("No active Story Memories exist for this world. Complete multiple story units first.");
const previewQuery = [brief, context, source].filter(Boolean).join("\n");
const memoryPreview = buildNarrativeMemoryContext(resolve(projectRoot, "worlds", world), world, previewQuery);
if (!memoryPreview) {
  console.warn("Warning: no active memory matched the brief/context preview. The memory-enabled arm may receive no memory; inspect its recorded prompt before interpreting the pair.");
}

const commonArgs = [
  "--world", world, "--brief", brief, "--mode", mode, "--max-words", maxWords,
  "--retrieval-limit", retrievalLimit, "--no-apply-state"
];
if (model) commonArgs.push("--model", model);
if (source) commonArgs.push("--source", source);
if (context) commonArgs.push("--context", context);
if (stateFile) commonArgs.push("--state-file", stateFile);
if (storyUnitFile) commonArgs.push("--story-unit-file", storyUnitFile);
if (storyArcFile) commonArgs.push("--story-arc-file", storyArcFile);
if (strictModel) commonArgs.push("--strict-model");
if (readerExperience) commonArgs.push("--reader-experience");
if (command === "write-long") commonArgs.push("--scenes", scenes, "--timeout-ms", timeoutMs);

const order = randomBytes(1)[0] % 2 === 0 ? ["memory-on", "memory-off"] : ["memory-off", "memory-on"];
const results = {};

function runArm(arm) {
  const args = ["--import", "tsx", "src/cli.ts", command, ...commonArgs];
  if (arm === "memory-off") args.push("--no-story-memory");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: projectRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    if (!child.stdout || !child.stderr) return reject(new Error("Unable to capture CLI output streams."));
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolvePromise({ stdout, stderr, code: code ?? 1 }));
  });
}

for (const arm of order) {
  console.log("Running " + arm + " arm (" + command + ")...");
  const result = await runArm(arm);
  await writeFile(resolve(outputRoot, arm + ".stdout.log"), result.stdout, "utf8");
  await writeFile(resolve(outputRoot, arm + ".stderr.log"), result.stderr, "utf8");
  if (result.code !== 0) throw new Error(arm + " arm failed with exit code " + result.code + ". Logs: " + outputRoot);
  const match = result.stdout.match(/Saved chapter:\s*(.+)\s*$/m);
  if (!match) throw new Error("Could not locate the generated chapter path for " + arm + ". Logs: " + outputRoot);
  const chapterPath = resolve(projectRoot, match[1]!.trim());
  const chapter = await readFile(chapterPath, "utf8");
  if (!chapter.trim()) throw new Error(arm + " arm produced an empty chapter.");
  results[arm] = { outputDir: dirname(chapterPath), chapterPath };
}

const labels = randomBytes(1)[0] % 2 === 0
  ? { "memory-on": "A", "memory-off": "B" }
  : { "memory-on": "B", "memory-off": "A" };
for (const arm of ["memory-on", "memory-off"]) {
  const chapter = await readFile(results[arm].chapterPath, "utf8");
  await writeFile(resolve(blindDir, labels[arm] + ".md"), chapter, "utf8");
  await writeFile(resolve(outputRoot, labels[arm] + ".json"), JSON.stringify({
    label: labels[arm], sha256: createHash("sha256").update(chapter).digest("hex"),
    sourceRunDir: results[arm].outputDir, chapterPath: results[arm].chapterPath
  }, null, 2) + "\n", "utf8");
}
await writeFile(resolve(outputRoot, "assignment-key.json"), JSON.stringify({
  createdAt: new Date().toISOString(), world, command, model: model || "configured default",
  order, labels, memoryPreviewMatched: Boolean(memoryPreview),
  activeMemoryCountAtStart: activeMemories.length,
  memoryIdsAtStart: activeMemories.map(memory => memory.memoryId), commonArgs
}, null, 2) + "\n", "utf8");
await writeFile(resolve(outputRoot, "blind-review.md"), `# Blind review — Story Memory A/B

请先只阅读 blind/A.md 与 blind/B.md，不要查看 assignment-key.json 或各臂日志。两篇使用相同故事起点、世界状态、模型和写作参数；实验唯一计划差异是是否注入已激活的长期创作记忆。

每项按 1–5 分评分（1 明显较弱，3 相当，5 明显较强）；不要因某一版更长或更“符合设定”自动加分。

| 维度 | A | B | 判断依据 |
|---|---:|---:|---|
| 人物是否鲜活、复杂，行为有内在动机 | | | |
| 人物互动、对白是否自然并有张力 | | | |
| 情节推进、因果与场景节奏 | | | |
| 语言是否有力量，是否避免解释性啰嗦 | | | |
| 创意与意外性，是否避免套路化 | | | |
| 整体文学完成度 | | | |

**关键反证检查**
- 哪一版更像在执行一套规则、重复某种模式？
- 哪一版出现了不自然的人物行为或刻意呼应？
- 是否有一版只是换了表达，却没有真正改善文学效果？
- 如果两版差异很小或没有稳定优势，请明确记为“无可验证收益”。

结论：A / B / 无明显差异

证据（引用具体段落或场景，不写泛泛印象）：

`);
console.log("Blind pair ready: " + outputRoot);
console.log("Review A.md and B.md first. Keep assignment-key.json unopened until scoring is complete.");
