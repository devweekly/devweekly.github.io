import { readFileSync, existsSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import {
  SOURCE_EXTENSIONS,
  LANGUAGE_EXTENSIONS,
  ARCHITECTURE_SIGNAL_DIRS,
} from "./config.mjs";
import {
  walkDir,
  readFileSafe,
  countByExtension,
  isTestFile,
  git,
  initTreeSitter,
  parseFileAST,
  findNodeModules,
  PROJECT_DISCOVERY_RULES,
} from "./utils.mjs";

// ===========================================================================
// RepositoryContext — shared analysis context for all analyzers
//
// Centralizes file tree traversal, AST parsing, content caching, manifest
// discovery, and git metadata. Every Analyzer receives the same context,
// eliminating duplicated walkDir, readFileSync, and Tree-sitter parses.
// ===========================================================================

class RepositoryContext {
  /**
   * @param {string} repoPath — absolute path to the repository root
   * @param {object} [options]
   * @param {number} [options.maxDepth=8] — max traversal depth
   */
  constructor(repoPath, options = {}) {
    this.repoPath = repoPath;
    this.options = { maxDepth: 8, ...options };
    this.nodeModulesDir = findNodeModules();
    this.changedFiles = options.changedFiles ?? null;
    this.lang = options.lang || null;

    // Lazy caches
    this._entries = null;
    this._files = null;
    this._filteredFiles = null;
    this._dirs = null;
    this._contentCache = new Map();
    this._astCache = new Map();
    this._manifest = undefined;
    this._gitInfo = null;
    this._isGitRepo = null;
  }

  // -------------------------------------------------------------------------
  // File system access
  // -------------------------------------------------------------------------

  /** All entries (files + dirs) discovered under the repo root. */
  get entries() {
    if (this._entries === null) {
      this._entries = walkDir(this.repoPath, this.options.maxDepth);
    }
    return this._entries;
  }

  /** All file entries (not affected by changedFiles filter). */
  get allFiles() {
    if (this._files === null) {
      this._files = this.entries.filter((e) => e.type === "file");
    }
    return this._files;
  }

  /** File entries only. If changedFiles is set, only files in changedFiles are returned. */
  get files() {
    if (this.changedFiles && this.changedFiles.size > 0) {
      if (this._filteredFiles === null) {
        this._filteredFiles = this.allFiles.filter((f) =>
          this.changedFiles.has(this.rel(f.path))
        );
      }
      return this._filteredFiles;
    }
    return this.allFiles;
  }

  /** Directory entries only. */
  get dirs() {
    if (this._dirs === null) {
      this._dirs = this.entries.filter((e) => e.type === "dir");
    }
    return this._dirs;
  }

  /** All source code files (not affected by changedFiles filter). */
  get allSourceFiles() {
    return this.allFiles.filter((f) => SOURCE_EXTENSIONS.has(f.ext));
  }

  /** Source code files only (extensions in SOURCE_EXTENSIONS). */
  get sourceFiles() {
    return this.files.filter((f) => SOURCE_EXTENSIONS.has(f.ext));
  }

  /** Absolute path of a relative path inside the repository. */
  resolve(relPath) {
    return join(this.repoPath, relPath);
  }

  /** Relative path from an absolute path inside the repository. */
  rel(absolutePath) {
    return relative(this.repoPath, absolutePath);
  }

  /** Read file content safely, cached. */
  readFile(relPath) {
    if (this._contentCache.has(relPath)) return this._contentCache.get(relPath);
    const content = readFileSafe(join(this.repoPath, relPath));
    this._contentCache.set(relPath, content);
    return content;
  }

  /** Read absolute file path safely. */
  readFileAbsolute(absolutePath) {
    const relPath = relative(this.repoPath, absolutePath);
    return this.readFile(relPath);
  }

  /** Check if a relative path exists inside the repo. */
  exists(relPath) {
    return existsSync(join(this.repoPath, relPath));
  }

  // -------------------------------------------------------------------------
  // Manifest / language
  // -------------------------------------------------------------------------

  /** Detected project manifest (the highest-priority manifest rule wins). */
  get manifest() {
    if (this._manifest === undefined) {
      this._manifest = this._detectManifest();
    }
    return this._manifest;
  }

  _detectManifest() {
    const manifestRules = PROJECT_DISCOVERY_RULES
      .filter((r) => r.category === "manifest" && r.parser)
      .sort((a, b) => b.priority - a.priority);
    for (const m of manifestRules) {
      const fullPath = join(this.repoPath, m.file);
      if (!existsSync(fullPath)) continue;
      try {
        const content = readFileSync(fullPath, "utf-8");
        return { language: m.language, entry: m.file, ...m.parser(content) };
      } catch {
        return { language: m.language, entry: m.file, name: "unknown", version: "unknown" };
      }
    }
    return null;
  }

  /** Primary programming language of the repository. */
  get language() {
    return this.manifest?.language ?? this._inferLanguage();
  }

  _inferLanguage() {
    const counts = countByExtension(this.files);
    const ranked = Object.entries(counts)
      .filter(([ext]) => SOURCE_EXTENSIONS.has(ext))
      .sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return "unknown";
    const topExt = ranked[0][0];
    for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
      if (exts.includes(topExt)) return lang;
    }
    return "unknown";
  }

  // -------------------------------------------------------------------------
  // Tree-sitter AST access
  // -------------------------------------------------------------------------

  /**
   * Parse a file with Tree-sitter and return its AST.
   * Results are cached by absolute path.
   */
  async parseAST(filePath) {
    await initTreeSitter();
    if (this._astCache.has(filePath)) return this._astCache.get(filePath);
    const tree = await parseFileAST(filePath);
    this._astCache.set(filePath, tree);
    return tree;
  }

  /** Parse a file identified by its repo-relative path. */
  async parseRelAST(relPath) {
    return this.parseAST(join(this.repoPath, relPath));
  }

  // -------------------------------------------------------------------------
  // Git helpers
  // -------------------------------------------------------------------------

  get isGitRepo() {
    if (this._isGitRepo === null) {
      this._isGitRepo = git(this.repoPath, "rev-parse", "--is-inside-work-tree")
        .trim() === "true";
    }
    return this._isGitRepo;
  }

  /** Run a git subcommand inside the repository. */
  git(...args) {
    return git(this.repoPath, ...args);
  }

  // -------------------------------------------------------------------------
  // Discovery helpers
  // -------------------------------------------------------------------------

  /** Test files discovered via filename regex patterns. */
  get testFiles() {
    return this.files.filter((f) => isTestFile(f.name));
  }

  /** Files inside directories named as architecture signals. */
  get architectureSignalFiles() {
    return this.files.filter((f) => {
      const parts = relative(this.repoPath, f.path).split(sep);
      return parts.some((p) => ARCHITECTURE_SIGNAL_DIRS.has(p.toLowerCase()));
    });
  }
}

export { RepositoryContext };
