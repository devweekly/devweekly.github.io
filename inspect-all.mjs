// Cross-repo inspector: extracts semantic layer highlights from all repos
// to spot false positives/negatives patterns.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || ".";
const dirs = readdirSync(root).filter((d) => d.startsWith("research-") && d.endsWith("-20260725"));

const rows = [];
for (const dir of dirs) {
  const fullJson = join(root, dir, "evidence-store", "full.json");
  let data;
  try {
    data = JSON.parse(readFileSync(fullJson, "utf8"));
  } catch {
    continue;
  }

  const d = data.discovery || {};
  const ap = data.archPattern || {};
  const r = data.responsibility || {};
  const st = data.stability || {};
  const cc = data.changeCoupling || {};
  const ifl = data.informationFlow || {};
  const ds = data.dependencySmell || {};
  const co = data.capabilityOntology || {};
  const arch = data.architecture || {};

  rows.push({
    repo: d.repoName || dir.replace(/^research-/, "").replace(/-20260725$/, ""),
    lang: d.manifest?.language || "?",
    files: d.totalSourceFiles || 0,
    nodes: arch.totalNodes || 0,
    edges: arch.totalEdges || 0,
    pattern: ap.primaryPattern || "Unknown",
    patternConf: (ap.patterns?.[0]?.confidence || 0).toFixed(2),
    altPatterns: (ap.patterns || []).slice(1, 3).map((p) => `${p.pattern}(${p.confidence})`).join(", "),
    respMapped: `${r.mappedModules || 0}/${r.totalModules || 0}`,
    topResp: (r.responsibilities || []).filter((x) => x.responsibility !== "Uncategorized").slice(0, 3).map((x) => `${x.module}=${x.responsibility}`).join("; "),
    painModules: (st.painModules || []).length,
    uselessModules: (st.uselessnessModules || []).length,
    couplingTotal: cc.totalPairs || 0,
    couplingLogical: cc.logicalPairs || 0,
    flowsTotal: ifl.totalFlows || 0,
    reachesLLM: ifl.reachesLLM ? "Y" : "N",
    smellsTotal: ds.totalSmells || 0,
    smellsHigh: ds.highSeverity || 0,
    capCovered: `${co.coveredCapabilities || 0}/${co.totalCapabilities || 10}`,
    capStrong: (co.strongCapabilities || []).join(","),
    capMissing: (co.missingCapabilities || []).join(","),
  });
}

// Print as table
const cols = ["repo", "lang", "files", "nodes", "edges", "pattern", "patternConf", "respMapped", "painModules", "couplingLogical", "flowsTotal", "reachesLLM", "smellsHigh", "capCovered", "capStrong", "capMissing"];
console.log(cols.join("\t"));
for (const row of rows) {
  console.log(cols.map((c) => row[c]).join("\t"));
}

console.log("\n--- Top Responsibilities per repo ---");
for (const row of rows) {
  console.log(`${row.repo}: ${row.topResp}`);
}

console.log("\n--- Alt patterns ---");
for (const row of rows) {
  if (row.altPatterns) console.log(`${row.repo}: ${row.pattern} → alt: ${row.altPatterns}`);
}
