// ===========================================================================
// java-analyzer.mjs — Mechanical Java/Eclipse/OSGi fact extractor
//
// p6.md §5-§6: "Mechanical Truth Layer" — LLM can only interpret graphs,
// not create them. This module produces deterministic structural graphs from
// Java ecosystem manifest files. No LLM calls; pure regex-based parsing.
//
// Borrowed design patterns from old_research-repo/utils.mjs (regex-based
// lightweight parsers, unified return structure) but NOT copied — extended
// to cover OSGi/Eclipse manifests that old_research-repo lacks:
//   - MANIFEST.MF  (OSGi bundle metadata: Bundle-SymbolicName, Require-Bundle)
//   - plugin.xml   (Eclipse extension points + extensions)
//   - feature.xml  (Eclipse Feature assembly: plugins + included features)
//
// Output artifacts (consumed as mechanical evidence by Evidence Agent):
//   artifacts/maven-module-graph.json   — reactor module → module edges
//   artifacts/osgi-bundle-index.json    — bundle symbolic names + dependencies
//   artifacts/osgi-extension-index.json — extension points + contributors
//   artifacts/feature-composition.json  — feature → plugin assembly map
//   artifacts/java-dependency-graph.json— unified module dependency graph
// ===========================================================================

import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 1. pom.xml parser (Maven)
// ---------------------------------------------------------------------------

/**
 * Parse pom.xml minimally via regex (no XML dependency).
 * Extracts: groupId, artifactId, version, parent, modules, dependencies,
 * properties, dependencyManagement entries.
 *
 * Borrowed pattern from old_research-repo/utils.mjs:1049 (regex-based,
 * skip <parent> for own coordinates) but extended with properties +
 * dependencyManagement + packaging type.
 */
export function parsePomXml(content) {
  // Own coordinates — skip <parent> block to avoid inheriting parent's GAV
  const withoutParent = content.replace(/<parent>[\s\S]*?<\/parent>/, "");
  const groupId = withoutParent.match(/<groupId>([^<]+)<\/groupId>/)?.[1]?.trim();
  const artifactId = withoutParent.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]?.trim();
  const version = withoutParent.match(/<version>([^<]+)<\/version>/)?.[1]?.trim();
  const packaging = withoutParent.match(/<packaging>([^<]+)<\/packaging>/)?.[1]?.trim() || "jar";

  // Parent coordinates (for inheritance chain)
  const parentMatch = content.match(/<parent>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*<version>([^<]+)<\/version>/);
  const parent = parentMatch
    ? { groupId: parentMatch[1].trim(), artifactId: parentMatch[2].trim(), version: parentMatch[3].trim() }
    : null;

  // Reactor modules (<modules><module>X</module></modules>)
  const modules = [];
  const modRe = /<module>([^<]+)<\/module>/g;
  let m;
  while ((m = modRe.exec(content)) !== null) modules.push(m[1].trim());

  // Dependencies (<dependency>: groupId + artifactId + scope + optional version)
  const dependencies = [];
  const depRe = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]*)<\/version>)?(?:\s*<scope>([^<]*)<\/scope>)?/g;
  while ((m = depRe.exec(content)) !== null) {
    dependencies.push({
      groupId: m[1].trim(),
      artifactId: m[2].trim(),
      version: m[3]?.trim() || null,
      scope: m[4]?.trim() || "compile",
    });
  }

  // Properties (Maven property interpolation: ${project.version}, ${foo.bar})
  const properties = {};
  const propRe = /<([a-zA-Z0-9_.-]+)>([^<]*)<\/\1>/g;
  // Only scan inside <properties> block
  const propsBlock = content.match(/<properties>([\s\S]*?)<\/properties>/);
  if (propsBlock) {
    let p;
    while ((p = propRe.exec(propsBlock[1])) !== null) {
      properties[p[1].trim()] = p[2].trim();
    }
  }

  return {
    type: "maven",
    groupId: groupId || parent?.groupId || null,
    artifactId: artifactId || "unknown",
    version: version || parent?.version || "unknown",
    packaging,
    parent,
    modules,
    dependencies,
    properties,
  };
}

// ---------------------------------------------------------------------------
// 2. MANIFEST.MF parser (OSGi bundle metadata)
// ---------------------------------------------------------------------------

/**
 * Parse OSGi MANIFEST.MF. This is the critical file p6.md demands — it reveals
 * the OSGi bundle dependency graph that LLM cannot infer from .java files.
 *
 * Format: RFC 822-style headers, line continuation with leading space.
 * Key headers:
 *   Bundle-SymbolicName: org.jkiss.dbeaver.model; singleton:=true
 *   Bundle-Version: 1.0.0
 *   Require-Bundle: org.eclipse.core.runtime;bundle-version="3.0",
 *                   org.jkiss.dbeaver.core;bundle-version="1.0"
 *   Export-Package: org.jkiss.dbeaver.model.struct;uses:="...",
 *                   org.jkiss.dbeaver.model.net
 *   Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=11))"
 *   Bundle-Activator: org.jkiss.dbeaver.model.DBeaverModelActivator
 *   Bundle-RequiredExecutionEnvironment: JavaSE-11
 */
export function parseManifestMf(content) {
  // Unfold continuation lines (lines starting with space belong to previous line)
  const unfolded = content.replace(/\r?\n /g, "");
  const headers = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    headers[key] = val;
  }

  // Parse "key=value;key=value" clauses separated by ","
  function parseClauses(raw) {
    if (!raw) return [];
    // Split on comma but not inside quotes
    return raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((clause) => {
      const parts = clause.split(";").map((s) => s.trim());
      const main = parts[0];
      const attrs = {};
      for (const p of parts.slice(1)) {
        const eq = p.indexOf("=");
        if (eq > 0) {
          attrs[p.slice(0, eq).trim()] = p.slice(eq + 1).trim().replace(/^"|"$/g, "");
        }
      }
      return { name: main, attributes: attrs };
    });
  }

  // Bundle-SymbolicName may have "; singleton:=true"
  const symbolicNameRaw = headers["Bundle-SymbolicName"] || "";
  const symbolicName = symbolicNameRaw.split(";")[0].trim();

  return {
    type: "osgi-bundle",
    symbolicName,
    version: headers["Bundle-Version"] || "unknown",
    activator: headers["Bundle-Activator"] || null,
    requiredExecutionEnvironment: headers["Bundle-RequiredExecutionEnvironment"] || headers["Require-Capability"] || null,
    requireBundle: parseClauses(headers["Require-Bundle"]).map((c) => ({
      symbolicName: c.name,
      version: c.attributes["bundle-version"] || null,
      optional: c.attributes["resolution"] === "optional",
      reexport: c.attributes["visibility"] === "reexport",
    })),
    exportPackage: parseClauses(headers["Export-Package"]).map((c) => ({
      package: c.name,
      uses: c.attributes.uses ? c.attributes.uses.split(",").map((s) => s.trim()) : [],
      version: c.attributes.version || null,
    })),
    requirePackage: parseClauses(headers["Import-Package"]).map((c) => ({
      package: c.name,
      version: c.attributes.version || null,
    })),
    requireCapability: parseClauses(headers["Require-Capability"]).map((c) => ({
      namespace: c.name,
      filter: c.attributes.filter || null,
    })),
  };
}

// ---------------------------------------------------------------------------
// 3. plugin.xml parser (Eclipse extension registry)
// ---------------------------------------------------------------------------

/**
 * Parse Eclipse plugin.xml — the extension point registry.
 * This is p6.md's "extension graph": which plugin contributes to which
 * extension point. LLM cannot infer this from .java code.
 *
 * Structure:
 *   <plugin>
 *     <extension point="org.eclipse.ui.views">
 *       <view class="..." id="..." name="..."/>
 *     </extension>
 *     <extension-point id="..." name="..." schema="..."/>
 *   </plugin>
 */
export function parsePluginXml(content) {
  const extensions = [];
  const extensionPoints = [];

  // <extension point="X"> ... </extension>  (non-greedy)
  const extRe = /<extension\s+[^>]*point="([^"]+)"[^>]*>([\s\S]*?)<\/extension>/g;
  let m;
  while ((m = extRe.exec(content)) !== null) {
    const point = m[1].trim();
    const body = m[2];
    // Extract child elements with their attributes
    const children = [];
    const childRe = /<(\w+)\s+([^/>]*)\/?>/g;
    let c;
    while ((c = childRe.exec(body)) !== null) {
      const tag = c[1];
      const attrsStr = c[2];
      const attrs = {};
      const attrRe = /(\w+[:\w-]*)\s*=\s*"([^"]*)"/g;
      let a;
      while ((a = attrRe.exec(attrsStr)) !== null) {
        attrs[a[1]] = a[2];
      }
      children.push({ tag, attributes: attrs });
    }
    extensions.push({ point, children });
  }

  // <extension-point id="X" name="..." schema="..."/>
  const epRe = /<extension-point\s+[^>]*id="([^"]+)"[^>]*(?:name="([^"]*)")?[^>]*\/?>/g;
  while ((m = epRe.exec(content)) !== null) {
    extensionPoints.push({ id: m[1].trim(), name: m[2]?.trim() || null });
  }

  return { type: "eclipse-plugin-xml", extensions, extensionPoints };
}

// ---------------------------------------------------------------------------
// 4. feature.xml parser (Eclipse Feature assembly)
// ---------------------------------------------------------------------------

/**
 * Parse Eclipse feature.xml — the product assembly descriptor.
 * This is p6.md's "feature composition" graph: how a product is assembled
 * from plugins + sub-features.
 *
 * Structure:
 *   <feature id="org.jkiss.dbeaver.ce" label="DBeaver Community Edition" version="25.0.0">
 *     <plugin id="org.jkiss.dbeaver.core" download-size="0" install-size="0" version="0.0.0"/>
 *     <includes id="org.jkiss.dbeaver.base.feature" version="0.0.0"/>
 *     <requires>
 *       <import plugin="org.eclipse.core.runtime"/>
 *     </requires>
 *   </feature>
 */
export function parseFeatureXml(content) {
  const featureMatch = content.match(/<feature\s+([^>]*)>/);
  const attrs = {};
  if (featureMatch) {
    const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(featureMatch[1])) !== null) {
      attrs[a[1]] = a[2];
    }
  }

  // <plugin id="..." version="..."/>
  const plugins = [];
  const pluginRe = /<plugin\s+[^>]*id="([^"]+)"[^>]*(?:version="([^"]*)")?[^>]*\/?>/g;
  let m;
  while ((m = pluginRe.exec(content)) !== null) {
    plugins.push({ id: m[1].trim(), version: m[2]?.trim() || null });
  }

  // <includes id="..." version="..."/>  (sub-features)
  const includedFeatures = [];
  const incRe = /<includes\s+[^>]*id="([^"]+)"[^>]*(?:version="([^"]*)")?[^>]*\/?>/g;
  while ((m = incRe.exec(content)) !== null) {
    includedFeatures.push({ id: m[1].trim(), version: m[2]?.trim() || null });
  }

  // <requires><import plugin="..."/></requires>
  const requires = [];
  const reqRe = /<import\s+[^>]*plugin="([^"]+)"[^>]*\/?>/g;
  while ((m = reqRe.exec(content)) !== null) {
    requires.push(m[1].trim());
  }

  return {
    type: "eclipse-feature",
    id: attrs.id || "unknown",
    label: attrs.label || null,
    version: attrs.version || "unknown",
    providerName: attrs["provider-name"] || null,
    plugins,
    includedFeatures,
    requires,
  };
}

// ---------------------------------------------------------------------------
// 5. Build dependency/module/extension graphs from parsed manifests
// ---------------------------------------------------------------------------

/**
 * Build Maven reactor module graph from all pom.xml files.
 * Edges: parent → child, module → submodule, dependency (if same groupId).
 */
function buildMavenModuleGraph(pomResults) {
  const nodes = [];
  const edges = [];

  for (const { path, parsed } of pomResults) {
    const id = parsed.artifactId;
    nodes.push({
      id,
      groupId: parsed.groupId,
      version: parsed.version,
      packaging: parsed.packaging,
      path,
    });

    // Parent edge
    if (parsed.parent) {
      edges.push({ from: parsed.parent.artifactId, to: id, type: "parent" });
    }

    // Module edges (reactor submodules)
    for (const mod of parsed.modules) {
      edges.push({ from: id, to: mod, type: "module" });
    }

    // Dependency edges (only intra-project: same groupId or starts with project prefix)
    for (const dep of parsed.dependencies) {
      // Heuristic: if dep.groupId matches any known project groupId → intra-project
      const isIntraProject = pomResults.some(
        (p) => p.parsed.groupId === dep.groupId
      );
      if (isIntraProject) {
        edges.push({ from: id, to: dep.artifactId, type: "dependency", scope: dep.scope });
      }
    }
  }

  return { nodes, edges };
}

/**
 * Build OSGi bundle index + dependency graph from all MANIFEST.MF files.
 * This is the "OSGi graph" p6.md demands — LLM can only interpret it, not
 * create it.
 */
function buildOsgiGraph(manifestResults) {
  const bundles = [];
  const edges = [];

  for (const { path, parsed } of manifestResults) {
    if (!parsed.symbolicName) continue;
    bundles.push({
      symbolicName: parsed.symbolicName,
      version: parsed.version,
      activator: parsed.activator,
      path,
      exportPackages: parsed.exportPackage.map((e) => e.package),
      requirePackages: parsed.requirePackage.map((r) => r.package),
    });

    // Require-Bundle edges (bundle → bundle dependency)
    for (const req of parsed.requireBundle) {
      edges.push({
        from: parsed.symbolicName,
        to: req.symbolicName,
        type: "require-bundle",
        optional: req.optional,
        reexport: req.reexport,
      });
    }
  }

  return { bundles, edges };
}

/**
 * Build Eclipse extension index: which plugin contributes to which
 * extension point. This is the "extension graph" p6.md demands.
 */
function buildExtensionIndex(pluginXmlResults) {
  const extensionPoints = []; // declared by plugins
  const extensions = []; // contributions to extension points

  for (const { path, parsed, symbolicName } of pluginXmlResults) {
    // Extension points declared by this plugin
    for (const ep of parsed.extensionPoints) {
      extensionPoints.push({ ...ep, declaredBy: symbolicName, path });
    }
    // Extensions contributed by this plugin
    for (const ext of parsed.extensions) {
      extensions.push({
        point: ext.point,
        contributedBy: symbolicName,
        path,
        childCount: ext.children.length,
        children: ext.children.slice(0, 5), // cap for storage
      });
    }
  }

  return { extensionPoints, extensions };
}

/**
 * Build feature composition graph: which features include which plugins
 * and sub-features. This is the "product assembly" graph p6.md demands.
 */
function buildFeatureGraph(featureResults) {
  const features = [];
  const edges = []; // feature → plugin, feature → sub-feature

  for (const { path, parsed } of featureResults) {
    features.push({
      id: parsed.id,
      label: parsed.label,
      version: parsed.version,
      providerName: parsed.providerName,
      path,
    });

    for (const plugin of parsed.plugins) {
      edges.push({ from: parsed.id, to: plugin.id, type: "includes-plugin", version: plugin.version });
    }
    for (const sub of parsed.includedFeatures) {
      edges.push({ from: parsed.id, to: sub.id, type: "includes-feature", version: sub.version });
    }
    for (const req of parsed.requires) {
      edges.push({ from: parsed.id, to: req, type: "requires-plugin" });
    }
  }

  return { features, edges };
}

// ---------------------------------------------------------------------------
// 6. Top-level: analyzeJavaRepo — orchestrates all parsers + graph builders
// ---------------------------------------------------------------------------

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/**
 * Find the OSGi symbolic name for a plugin.xml by looking for the nearest
 * MANIFEST.MF in the same directory or parent directory.
 */
async function findBundleSymbolicName(pluginXmlPath, repoPath, manifestCache) {
  // plugin.xml is typically at <plugin-dir>/plugin.xml, MANIFEST.MF at <plugin-dir>/META-INF/MANIFEST.MF
  const dir = pluginXmlPath.includes("/") ? pluginXmlPath.slice(0, pluginXmlPath.lastIndexOf("/")) : "";
  const candidates = [
    join(dir, "META-INF", "MANIFEST.MF"),
    join(dir, "..", "META-INF", "MANIFEST.MF"),
  ].map((p) => join(repoPath, p));

  for (const candidate of candidates) {
    const cached = manifestCache.get(candidate);
    if (cached) return cached.symbolicName;
    if (await fileExists(candidate)) {
      try {
        const content = await readFile(candidate, "utf-8");
        const parsed = parseManifestMf(content);
        manifestCache.set(candidate, parsed);
        return parsed.symbolicName;
      } catch {}
    }
  }
  return null;
}

/**
 * Main entry point. Scans repo for Java ecosystem manifest files, parses
 * them mechanically, and produces structural graph artifacts.
 *
 * @param {string} repoPath - absolute path to repository root
 * @param {{files: string[]}} scan - file list from Stage 1 scan
 * @returns {object} with keys: mavenModuleGraph, osgiBundleIndex,
 *   osgiExtensionIndex, featureComposition, javaDependencyGraph, evidenceFacts
 */
export async function analyzeJavaRepo(repoPath, scan) {
  const files = scan.files || [];

  // Discover manifest files
  const pomFiles = files.filter((f) => f.endsWith("pom.xml"));
  const manifestFiles = files.filter((f) => f.endsWith("MANIFEST.MF"));
  const pluginXmlFiles = files.filter((f) => f.endsWith("plugin.xml") && !f.includes("/test"));
  const featureXmlFiles = files.filter((f) => f.endsWith("feature.xml"));

  const manifestCache = new Map(); // path → parsed manifest (for symbolicName lookup)

  // Parse all manifests in parallel
  const [pomResults, manifestResults, featureResults] = await Promise.all([
    Promise.all(pomFiles.map(async (f) => {
      try {
        const content = await readFile(join(repoPath, f), "utf-8");
        return { path: f, parsed: parsePomXml(content) };
      } catch { return null; }
    })).then((r) => r.filter(Boolean)),
    Promise.all(manifestFiles.map(async (f) => {
      try {
        const content = await readFile(join(repoPath, f), "utf-8");
        const parsed = parseManifestMf(content);
        manifestCache.set(join(repoPath, f), parsed);
        return { path: f, parsed };
      } catch { return null; }
    })).then((r) => r.filter(Boolean)),
    Promise.all(featureXmlFiles.map(async (f) => {
      try {
        const content = await readFile(join(repoPath, f), "utf-8");
        return { path: f, parsed: parseFeatureXml(content) };
      } catch { return null; }
    })).then((r) => r.filter(Boolean)),
  ]);

  // plugin.xml needs symbolicName from MANIFEST.MF (sequential after manifests parsed)
  const pluginXmlResults = [];
  for (const f of pluginXmlFiles) {
    try {
      const content = await readFile(join(repoPath, f), "utf-8");
      const parsed = parsePluginXml(content);
      const symbolicName = await findBundleSymbolicName(f, repoPath, manifestCache);
      pluginXmlResults.push({ path: f, parsed, symbolicName: symbolicName || f.split("/")[0] });
    } catch {}
  }

  // Build graphs
  const mavenModuleGraph = buildMavenModuleGraph(pomResults);
  const osgiGraph = buildOsgiGraph(manifestResults);
  const extensionIndex = buildExtensionIndex(pluginXmlResults);
  const featureGraph = buildFeatureGraph(featureResults);

  // Unified dependency graph (merge Maven + OSGi edges)
  const javaDependencyGraph = {
    nodes: [
      ...mavenModuleGraph.nodes.map((n) => ({ ...n, source: "maven" })),
      ...osgiGraph.bundles.map((b) => ({ id: b.symbolicName, source: "osgi", ...b })),
    ],
    edges: [
      ...mavenModuleGraph.edges.map((e) => ({ ...e, source: "maven" })),
      ...osgiGraph.edges.map((e) => ({ ...e, source: "osgi" })),
    ],
  };

  // Generate human-readable mechanical facts for Evidence Agent
  const evidenceFacts = generateEvidenceFacts({
    pomResults, manifestResults, pluginXmlResults, featureResults,
    mavenModuleGraph, osgiGraph, extensionIndex, featureGraph,
  });

  return {
    mavenModuleGraph,
    osgiBundleIndex: { bundles: osgiGraph.bundles, edges: osgiGraph.edges },
    osgiExtensionIndex: extensionIndex,
    featureComposition: { features: featureGraph.features, edges: featureGraph.edges },
    javaDependencyGraph,
    evidenceFacts,
    stats: {
      pomFiles: pomResults.length,
      manifestFiles: manifestResults.length,
      pluginXmlFiles: pluginXmlResults.length,
      featureXmlFiles: featureResults.length,
      mavenModules: mavenModuleGraph.nodes.length,
      osgiBundles: osgiGraph.bundles.length,
      extensionPoints: extensionIndex.extensionPoints.length,
      extensions: extensionIndex.extensions.length,
      features: featureGraph.features.length,
    },
  };
}

// ---------------------------------------------------------------------------
// 7. Generate human-readable mechanical facts (injected as evidence)
// ---------------------------------------------------------------------------

/**
 * Produce structured text facts from graphs. These are MECHANICAL TRUTHS —
 * observations only, no interpretation. LLM may interpret them later but
 * cannot alter them.
 *
 * Format: each fact is { observation, source, file } — matches p6.md §2
 * "Raw observation" layer (distinct from interpretation layer).
 */
function generateEvidenceFacts(data) {
  const { pomResults, manifestResults, pluginXmlResults, featureResults,
    mavenModuleGraph, osgiGraph, extensionIndex, featureGraph } = data;
  const facts = [];

  // Maven module structure
  if (pomResults.length > 0) {
    const rootPom = pomResults.find((p) => p.parsed.modules.length > 0 && !p.parsed.parent);
    if (rootPom) {
      facts.push({
        observation: `Maven reactor root: ${rootPom.parsed.groupId}:${rootPom.parsed.artifactId}:${rootPom.parsed.version} with ${rootPom.parsed.modules.length} modules: ${rootPom.parsed.modules.slice(0, 10).join(", ")}${rootPom.parsed.modules.length > 10 ? "..." : ""}`,
        source: "maven-pom",
        file: rootPom.path,
      });
    }
    for (const { path, parsed } of pomResults.slice(0, 8)) {
      if (parsed.dependencies.length > 0) {
        const intraDeps = parsed.dependencies.filter((d) =>
          pomResults.some((p) => p.parsed.groupId === d.groupId && p.parsed.artifactId === d.artifactId)
        );
        if (intraDeps.length > 0) {
          facts.push({
            observation: `Module ${parsed.artifactId} depends on intra-project modules: ${intraDeps.map((d) => d.artifactId).join(", ")}`,
            source: "maven-pom",
            file: path,
          });
        }
      }
    }
  }

  // OSGi bundle structure
  for (const { path, parsed } of manifestResults.slice(0, 12)) {
    if (!parsed.symbolicName) continue;
    const parts = [];
    if (parsed.activator) parts.push(`activator=${parsed.activator}`);
    if (parsed.requireBundle.length > 0) parts.push(`requires ${parsed.requireBundle.length} bundles: ${parsed.requireBundle.slice(0, 5).map((r) => r.symbolicName).join(", ")}`);
    if (parsed.exportPackage.length > 0) parts.push(`exports ${parsed.exportPackage.length} packages`);
    if (parts.length > 0) {
      facts.push({
        observation: `OSGi bundle ${parsed.symbolicName} (v${parsed.version}): ${parts.join("; ")}`,
        source: "osgi-manifest",
        file: path,
      });
    }
  }

  // Eclipse extension points
  if (extensionIndex.extensionPoints.length > 0) {
    facts.push({
      observation: `Repository declares ${extensionIndex.extensionPoints.length} Eclipse extension points: ${extensionIndex.extensionPoints.slice(0, 6).map((ep) => ep.id).join(", ")}${extensionIndex.extensionPoints.length > 6 ? "..." : ""}`,
      source: "plugin-xml",
      file: "(multiple plugin.xml)",
    });
  }
  if (extensionIndex.extensions.length > 0) {
    // Group by extension point to show contribution pattern
    const byPoint = new Map();
    for (const ext of extensionIndex.extensions) {
      if (!byPoint.has(ext.point)) byPoint.set(ext.point, []);
      byPoint.get(ext.point).push(ext.contributedBy);
    }
    for (const [point, contributors] of [...byPoint.entries()].slice(0, 8)) {
      facts.push({
        observation: `Extension point "${point}" has ${contributors.length} contributions from: ${contributors.slice(0, 4).join(", ")}${contributors.length > 4 ? "..." : ""}`,
        source: "plugin-xml",
        file: "(multiple plugin.xml)",
      });
    }
  }

  // Feature composition
  for (const { path, parsed } of featureResults.slice(0, 6)) {
    facts.push({
      observation: `Eclipse Feature ${parsed.id} (v${parsed.version}, "${parsed.label}"): includes ${parsed.plugins.length} plugins + ${parsed.includedFeatures.length} sub-features${parsed.requires.length > 0 ? `, requires ${parsed.requires.length} external plugins` : ""}`,
      source: "feature-xml",
      file: path,
    });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// CLI entry (for standalone testing)
// ---------------------------------------------------------------------------

// Run when invoked directly:  node java-analyzer.mjs /path/to/repo
if (process.argv[1] && process.argv[1].endsWith("java-analyzer.mjs")) {
  const repoPath = process.argv[2];
  if (!repoPath) {
    console.error("Usage: node java-analyzer.mjs <repo-path>");
    process.exit(1);
  }
  const { readdir } = await import("node:fs/promises");
  async function walk(dir, depth = 0) {
    if (depth > 5) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "target" || e.name === "bin") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) files.push(...await walk(full, depth + 1));
      else files.push(full.replace(repoPath + "/", ""));
    }
    return files;
  }
  const scan = { files: await walk(repoPath) };
  const result = await analyzeJavaRepo(repoPath, scan);
  console.log(JSON.stringify({ stats: result.stats, evidenceFacts: result.evidenceFacts }, null, 2));
}
