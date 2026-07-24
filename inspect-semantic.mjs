// Inspector for the 7 new architecture-semantics analyzers.
import fs from "node:fs";
const file = process.argv[2];
if (!file) {
  console.error("Usage: node inspect-semantic.mjs <full.json>");
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, "utf8"));

console.log("=== 1. Architecture Pattern ===");
const ap = data.archPattern || {};
console.log("primaryPattern:", ap.primaryPattern);
console.log("allPatterns:", ap.allPatterns);
for (const p of (ap.patterns || []).slice(0, 3)) {
  console.log(`  - ${p.pattern} (conf=${p.confidence}): ${p.evidence.join(", ")}`);
}

console.log("\n=== 2. Responsibility Matrix ===");
const r = data.responsibility || {};
console.log(`mappedModules: ${r.mappedModules}/${r.totalModules}`);
for (const item of (r.responsibilities || []).slice(0, 8)) {
  if (item.responsibility !== "Uncategorized") {
    console.log(`  - ${item.module} → ${item.responsibility} (conf=${item.confidence}, files=${item.fileCount})`);
  }
}

console.log("\n=== 3. Stability (A/I) ===");
const st = data.stability || {};
console.log("zoneDistribution:", JSON.stringify(st.zoneDistribution));
console.log("painModules:", (st.painModules || []).map((m) => m.module).join(", ") || "(none)");
console.log("uselessnessModules:", (st.uselessnessModules || []).map((m) => m.module).join(", ") || "(none)");
for (const m of (st.modules || []).slice(0, 5)) {
  console.log(`  - ${m.module}: I=${m.instability} A=${m.abstractness} zone=${m.zone} (Ca=${m.ca} Ce=${m.ce})`);
}

console.log("\n=== 4. Change Coupling ===");
const cc = data.changeCoupling || {};
console.log(`totalPairs: ${cc.totalPairs}, logicalPairs: ${cc.logicalPairs}, commits: ${cc.totalCommitsAnalyzed}`);
for (const p of (cc.coupledPairs || []).slice(0, 5)) {
  console.log(`  - [${p.type}] ${p.files[0]} ↔ ${p.files[1]} (count=${p.coChangeCount}, ratio=${p.coChangeRatio})`);
}

console.log("\n=== 5. Information Flow ===");
const ifl = data.informationFlow || {};
console.log(`totalFlows: ${ifl.totalFlows}, reachesLLM: ${ifl.reachesLLM}`);
for (const f of (ifl.flows || []).slice(0, 3)) {
  console.log(`  - ${f.name} (cov=${f.coverage}, conf=${f.confidence}):`);
  for (const s of f.steps) {
    console.log(`      ${s.step}. ${s.module} → ${s.role}${s.isLLMCall ? " [LLM]" : ""}`);
  }
}

console.log("\n=== 6. Dependency Smells ===");
const ds = data.dependencySmell || {};
console.log("byType:", JSON.stringify(ds.byType));
console.log("highSeverity:", ds.highSeverity);
for (const s of (ds.smells || []).slice(0, 5)) {
  console.log(`  - [${s.severity}] ${s.type}: ${s.from || s.module || ""} → ${s.to || ""} — ${s.rule}`);
}

console.log("\n=== 7. Capability Ontology ===");
const co = data.capabilityOntology || {};
console.log(`coveredCapabilities: ${co.coveredCapabilities}/${co.totalCapabilities}`);
console.log("capabilityMatrix:", JSON.stringify(co.capabilityMatrix));
console.log("missingCapabilities:", co.missingCapabilities);
console.log("strongCapabilities:", co.strongCapabilities);
console.log("weakCapabilities:", co.weakCapabilities);
for (const c of (co.capabilities || []).slice(0, 5)) {
  console.log(`  - ${c.capability}: maturity=${c.maturity} coverage=${c.coverage} modules=${c.modules.join(",")}`);
}
