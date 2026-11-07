import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { searchLibrary } from "../src/library.js";
import { isVaneManifestUsable, searchVane } from "../src/vane-retrieval.js";

type Dataset = {
  schemaVersion: 1;
  worldId: string;
  queries: Array<{ id: string; query: string; relevantChunkIds: string[] }>;
};
type Metric = { recallAt5: number; mrrAt10: number; ndcgAt10: number };
type RankedResult = { ids: string[]; latencyMs: number; metrics: Metric };

function score(rankedIds: string[], relevantIds: string[]): Metric {
  const relevant = new Set(relevantIds);
  const top5 = rankedIds.slice(0, 5);
  const top10 = rankedIds.slice(0, 10);
  const recallAt5 = new Set(top5.filter(id => relevant.has(id))).size / relevant.size;
  const first = top10.findIndex(id => relevant.has(id));
  const mrrAt10 = first < 0 ? 0 : 1 / (first + 1);
  const dcg = top10.reduce((sum, id, index) => sum + (relevant.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
  const idealHits = Math.min(relevant.size, 10);
  const idcg = Array.from({ length: idealHits }, (_, index) => 1 / Math.log2(index + 2)).reduce((a, b) => a + b, 0);
  return { recallAt5, mrrAt10, ndcgAt10: idcg ? dcg / idcg : 0 };
}

function average(rows: Metric[]): Metric {
  if (!rows.length) return { recallAt5: 0, mrrAt10: 0, ndcgAt10: 0 };
  return {
    recallAt5: rows.reduce((sum, row) => sum + row.recallAt5, 0) / rows.length,
    mrrAt10: rows.reduce((sum, row) => sum + row.mrrAt10, 0) / rows.length,
    ndcgAt10: rows.reduce((sum, row) => sum + row.ndcgAt10, 0) / rows.length
  };
}

export function retrievalMetrics(rankedIds: string[], relevantIds: string[]): Metric {
  if (!relevantIds.length) throw new Error("Each retrieval query must have at least one relevant chunk ID.");
  return score(rankedIds, relevantIds);
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const worldId = arg("--world");
  const datasetPath = resolve(arg("--dataset") ?? "benchmarks/retrieval-eval.json");
  if (!worldId) throw new Error("Usage: npm run evaluate-retrieval -- --world <worldId> [--dataset file] [--out file]");
  const dataset = JSON.parse(await readFile(datasetPath, "utf8")) as Dataset;
  if (dataset.schemaVersion !== 1 || dataset.worldId !== worldId || !Array.isArray(dataset.queries) || !dataset.queries.length) {
    throw new Error("Dataset must be schemaVersion 1, match --world, and contain at least one query.");
  }
  const index = JSON.parse(await readFile(resolve("worlds", worldId, "library", "index.json"), "utf8")) as {
    worldId: string; chunks: Array<{ id: string }>;
  };
  if (index.worldId !== worldId) throw new Error("Library index world mismatch.");
  const knownIds = new Set(index.chunks.map(chunk => chunk.id));
  for (const item of dataset.queries) {
    if (!item.id || !item.query?.trim() || !item.relevantChunkIds?.length) throw new Error("Invalid query item: " + JSON.stringify(item));
    const unknown = item.relevantChunkIds.filter(id => !knownIds.has(id));
    if (unknown.length) throw new Error("Unknown relevant chunk IDs in query " + item.id + ": " + unknown.join(", "));
  }
  let vaneAvailable = false;
  let vaneVectorMode = false;
  try {
    const manifest = JSON.parse(await readFile(resolve("worlds", worldId, "vane-index", "manifest.json"), "utf8")) as unknown;
    if (isVaneManifestUsable(manifest, worldId)) {
      const packageName = "@vane-rs/node";
      await import(packageName);
      vaneAvailable = true;
      vaneVectorMode = manifest.vectorMode === true;
    }
  } catch { /* missing native binding or local index */ }

  const perQuery: Array<{ id: string; query: string; relevantChunkIds: string[]; bm25: RankedResult; vane: RankedResult }> = [];
  for (const item of dataset.queries) {
    const bm25Start = performance.now();
    const bm25Hits = await searchLibrary(resolve("worlds", worldId, "library"), item.query, 10);
    const bm25Latency = performance.now() - bm25Start;
    const vaneStart = performance.now();
    const vaneHits = vaneAvailable ? await searchVane(worldId, item.query, 10) : [];
    const vaneLatency = performance.now() - vaneStart;
    const bm25Ids = bm25Hits.map(hit => hit.id);
    const vaneIds = vaneHits.map(hit => hit.id.startsWith("chunk:") ? hit.id.slice(6) : hit.id).filter(id => knownIds.has(id));
    perQuery.push({
      id: item.id, query: item.query, relevantChunkIds: item.relevantChunkIds,
      bm25: { ids: bm25Ids, latencyMs: Number(bm25Latency.toFixed(2)), metrics: score(bm25Ids, item.relevantChunkIds) },
      vane: { ids: vaneIds, latencyMs: Number(vaneLatency.toFixed(2)), metrics: score(vaneIds, item.relevantChunkIds) }
    });
  }
  const report = {
    schemaVersion: 1, worldId, evaluatedAt: new Date().toISOString(), dataset: datasetPath,
    queryCount: perQuery.length, vaneAvailable, vaneVectorMode,
    aggregate: {
      bm25: average(perQuery.map(row => row.bm25.metrics)),
      vane: average(perQuery.map(row => row.vane.metrics))
    },
    perQuery
  };
  const output = arg("--out")
    ? resolve(arg("--out") as string)
    : resolve(".output", worldId, "retrieval-evaluation", new Date().toISOString().replace(/[:.]/g, "-") + ".json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ output, queryCount: report.queryCount, vaneAvailable, vaneVectorMode, aggregate: report.aggregate }, null, 2));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
