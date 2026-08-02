// ===========================================================================
// llm-runner.mjs — Unified LLM invocation entry point (Hybrid Architecture)
//
// Based on research-cli.js design. Responsibilities:
//   1. Detect available CLI (OpenCode → Copilot fallback)
//   2. Provide unified `invokeLLM(prompt, options)` interface
//   3. Support structured JSON output for pipeline integration
//   4. Streaming-aware (aggregates OpenCode chunk events)
//
// Design principle (Hybrid Architecture):
//   Script produces Mechanical Truth (AST/Graph/Metrics/Evidence).
//   LLM produces Semantic Truth (Architecture judgment/Tradeoffs/Report).
//   This module is the ONLY bridge between the two layers.
//
// Usage:
//   import { invokeLLM, detectCLI } from "./llm-runner.mjs";
//   const cli = await detectCLI();
//   const result = await invokeLLM("Analyze this architecture...", { model: "gpt-5" });
// ===========================================================================

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants, appendFileSync, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

// ---------------------------------------------------------------------------
// .env loader (project root) — reads OPENROUTER_API_KEY etc.
// ---------------------------------------------------------------------------

let _envCache = null;

/**
 * Load .env file from project root (cwd or ancestors). Returns a flat object.
 * Cached after first call. Does NOT override process.env — callers should
 * check process.env first, then fall back to this.
 */
function loadEnvFile() {
  if (_envCache !== null) return _envCache;
  const candidates = [
    join(process.cwd(), ".env"),
    join(process.cwd(), "..", ".env"),
    join(process.cwd(), "..", "..", ".env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf-8");
        const env = {};
        for (const line of content.split("\n")) {
          const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
          if (!m) continue;
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) ||
              (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          env[m[1]] = v;
        }
        _envCache = env;
        return env;
      } catch {
        // continue to next candidate
      }
    }
  }
  _envCache = {};
  return _envCache;
}

/**
 * Resolve OPENROUTER_API_KEY from process.env or .env file.
 * @returns {string|null}
 */
function getOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  return loadEnvFile().OPENROUTER_API_KEY || null;
}

// ---------------------------------------------------------------------------
// CLI detection (OpenCode → Copilot fallback)
// ---------------------------------------------------------------------------

let cachedCLI = null;

/**
 * Clear the cached CLI path. Mainly useful for tests that switch CLI mocks.
 */
export function clearCLICache() {
  cachedCLI = null;
}

/**
 * Search PATH for an executable command.
 * @param {string} cmd
 * @returns {Promise<string|null>} absolute path or null
 */
async function which(cmd) {
  const paths = (process.env.PATH || "").split(delimiter);
  for (const p of paths) {
    if (!p) continue;
    try {
      const full = `${p}/${cmd}`;
      await access(full, constants.X_OK);
      return full;
    } catch {
      // continue searching
    }
  }
  return null;
}

/**
 * Detect available AI Coding CLI.
 * Priority: OpenCode CLI > GitHub Copilot CLI.
 * @returns {Promise<{name: "opencode"|"copilot", path: string}>}
 * @throws {Error} if neither is installed
 */
export async function detectCLI() {
  if (cachedCLI) return cachedCLI;

  const opencode = await which("opencode");
  if (opencode) {
    cachedCLI = { name: "opencode", path: opencode };
    return cachedCLI;
  }

  const copilot = (await which("github-copilot")) || (await which("copilot"));
  if (copilot) {
    cachedCLI = { name: "copilot", path: copilot };
    return cachedCLI;
  }

  throw new Error(
    "Neither OpenCode CLI nor Copilot CLI is installed. " +
      "Install one of them, or set RESEARCH_REPO_LLM_CMD to a custom command " +
      "(must read prompt from stdin and write text to stdout)."
  );
}

// ---------------------------------------------------------------------------
// Low-level process runner
// ---------------------------------------------------------------------------

/**
 * Spawn a child process, write stdin, collect stdout/stderr, resolve on close.
 * @param {string} command
 * @param {string[]} args
 * @param {string} stdin
 * @param {number} [timeoutMs] — default 0 means no timeout
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function run(command, args, stdin, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdinClosed = false;
    let killedByTimeout = false;
    let timeoutId = null;

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        killedByTimeout = true;
        child.kill("SIGTERM");
        // Force kill after grace period if still alive
        setTimeout(() => child.kill("SIGKILL"), 5000);
      }, timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (killedByTimeout) {
        reject(new Error(`LLM invocation timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    function closeStdin() {
      if (!stdinClosed) {
        stdinClosed = true;
        child.stdin.end();
      }
    }

    if (!stdin || stdin.length === 0) {
      closeStdin();
      return;
    }

    // Handle backpressure when writing large prompts to OpenCode CLI
    const canContinue = child.stdin.write(stdin);
    if (canContinue) {
      closeStdin();
    } else {
      child.stdin.once("drain", closeStdin);
    }
  });
}

// ---------------------------------------------------------------------------
// OpenRouter provider (curl-based, equivalent to OpenCode CLI)
// ---------------------------------------------------------------------------

/**
 * Invoke OpenRouter Chat Completions API via curl.
 *
 * Model routing: opts.model "openrouter/<model>" → uses "<model>".
 * If <model> is empty or "free", defaults to "openrouter/free".
 *
 * API key resolution: process.env.OPENROUTER_API_KEY → .env file in project root.
 *
 * Uses curl with --data @- (stdin) to avoid shell-escaping issues on long prompts.
 * curl --max-time bounds the total wall-clock time (slightly less than timeoutMs
 * to let Node's own timeout win the race).
 *
 * @param {string} prompt — full prompt (system+user already combined)
 * @param {object} opts — merged options (model, jsonMode, timeoutMs, reasoning, etc.)
 * @returns {Promise<string>} model output text
 */
/**
 * Detect safety-filter responses from free-tier models.
 * openrouter/free randomly routes to different models; some (e.g.
 * nvidia/nemotron-nano-9b-v2:free) return "User Safety: safe" instead of
 * actual content. Retrying usually routes to a different, usable model.
 */
const SAFETY_FILTER_PATTERNS = [
  /^User Safety:\s*safe$/i,
  /^I cannot help/i,
  /^I'm unable to/i,
  /^I'm sorry, but I can/i,
  /^This request has been blocked/i,
  /^Content policy/i,
  /^Safe$/i,
];

function isSafetyFilterResponse(text) {
  const trimmed = text.trim();
  if (trimmed.length > 120) return false; // safety messages are short
  if (trimmed.includes("{") || trimmed.includes("[")) return false; // has JSON structure
  return SAFETY_FILTER_PATTERNS.some((p) => p.test(trimmed));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function invokeOpenRouter(prompt, opts) {
  const apiKey = getOpenRouterKey();
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY not found. Set it in project-root .env or process.env. " +
      "(Model was specified as \"openrouter/...\" but no API key is available.)"
    );
  }

  const rawModel = opts.model.replace(/^openrouter\//, "");
  const model = rawModel || "openrouter/free";

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
  };
  // NOTE: Do NOT set body.response_format = { type: "json_object" }.
  // The openrouter/free aggregator routes to models (e.g. nvidia/nemotron-nano-9b-v2:free)
  // that don't support JSON mode and return empty content when it's set.
  // Instead, jsonMode is handled via prompt instruction in invokeLLM() (already
  // appended "Return ONLY valid JSON..."), and parseJSONLenient() tolerates
  // markdown fences / prose wrappers in the response.
  if (opts.reasoning) {
    body.reasoning = { enabled: true };
  }

  const payload = JSON.stringify(body);
  const curlMaxTime = Math.max(10, Math.floor((opts.timeoutMs || 300000) / 1000) - 5);

  const curlArgs = [
    "-s", "-S",
    "--max-time", String(curlMaxTime),
    "https://openrouter.ai/api/v1/chat/completions",
    "-H", "Content-Type: application/json",
    "-H", `Authorization: Bearer ${apiKey}`,
    "-d", "@-",
  ];

  // Retry loop: openrouter/free randomly routes to different models; some
  // return safety-filter stubs ("User Safety: safe") instead of content.
  // Retrying usually routes to a usable model. Safety responses return fast
  // (4-10s), so retries don't significantly increase total runtime.
  const MAX_SAFETY_RETRIES = 3;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_SAFETY_RETRIES; attempt++) {
    const { stdout, stderr, code } = await run("curl", curlArgs, payload, opts.timeoutMs || 300000);
    if (code !== 0) {
      throw new Error(`OpenRouter curl exited ${code}: ${stderr || stdout.slice(0, 300)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new Error(
        `OpenRouter response is not valid JSON: ${err.message}\n--- stdout (first 500) ---\n${stdout.slice(0, 500)}`
      );
    }

    if (parsed.error) {
      const msg = parsed.error.message || JSON.stringify(parsed.error);
      throw new Error(`OpenRouter API error: ${msg}`);
    }

    const content = parsed.choices?.[0]?.message?.content || "";
    if (!content) {
      throw new Error(
        `OpenRouter returned empty content. Full response:\n${JSON.stringify(parsed).slice(0, 500)}`
      );
    }

    const trimmed = content.trim();

    // Check for safety-filter response — retry if detected
    if (isSafetyFilterResponse(trimmed) && attempt < MAX_SAFETY_RETRIES) {
      console.warn(`  [openrouter] Safety-filter response "${trimmed.slice(0, 40)}" — retry ${attempt + 1}/${MAX_SAFETY_RETRIES}`);
      // Brief delay before retry (allows OpenRouter router to pick a different model)
      await sleep(500 * (attempt + 1));
      continue;
    }

    return trimmed;
  }

  // Exhausted retries — return last error or throw
  throw lastError || new Error("OpenRouter: exhausted safety-filter retries");
}

/**
 * Parse OpenCode CLI streaming JSON output and aggregate model text.
 * OpenCode emits one JSON event per line; we extract `content` from
 * `type: "chunk"` or `type: "text"` events.
 *
 * @param {string} stdout
 * @returns {string} aggregated model output
 */
function aggregateOpenCodeOutput(stdout) {
  const lines = stdout.split("\n").filter(Boolean);
  let output = "";
  let finalResult = "";
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      // OpenCode v1.18+ streaming events: { type: "text", part: { text: "..." } }
      if (event.type === "chunk" || event.type === "text") {
        const part = event.part || event;
        if (typeof part.content === "string") {
          output += part.content;
        } else if (typeof part.text === "string") {
          output += part.text;
        } else if (typeof event.content === "string") {
          output += event.content;
        }
      } else if (event.type === "result") {
        // Final result event may contain full text
        if (typeof event.text === "string") {
          finalResult = event.text;
        } else if (event.part && typeof event.part.text === "string") {
          finalResult = event.part.text;
        }
      }
    } catch {
      // Ignore non-JSON lines (status messages, progress, etc.)
    }
  }
  return output || finalResult;
}

// ---------------------------------------------------------------------------
// LLM call logging (llm-calls.jsonl — per-call detail for post-run debugging)
// ---------------------------------------------------------------------------

/**
 * Append a structured LLM call record to <workDir>/llm-calls.jsonl.
 * Records: ts, label, prompt size + preview, response size, duration, status, error.
 * Best-effort: silently skips if no pipeline logger / workDir is bound.
 */
function logLLMCall(entry) {
  const logger = globalThis.__pipelineLogger;
  if (!logger || !logger.workDir) return;
  try {
    appendFileSync(join(logger.workDir, "llm-calls.jsonl"), JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // logging must never break the pipeline
  }
}

// ---------------------------------------------------------------------------
// Public API: invokeLLM
// ---------------------------------------------------------------------------

/**
 * Default LLM options.
 */
export const DEFAULT_LLM_OPTIONS = {
  /**
   * Default model. Routing by prefix:
   *   "openrouter/<model>" → OpenRouter API (curl, needs OPENROUTER_API_KEY)
   *   "opencode/<model>"   → OpenCode CLI
   *   other                → OpenCode CLI (legacy)
   * OpenRouter is preferred when available — OpenCode free tier is unstable
   * (frequent 120s+ timeouts). Override per-call via options.model or globally
   * via RESEARCH_REPO_MODEL env var.
   */
  model: process.env.RESEARCH_REPO_MODEL || "openrouter/openrouter/free",
  /** Optional system prompt prepended to user prompt */
  systemPrompt: null,
  /** If true, instructs LLM to return strictly JSON */
  jsonMode: false,
  /** Override CLI detection (mainly for testing) */
  cli: null,
  /** Timeout in ms (0 = no timeout). Default 5 min to bound total runtime. */
  timeoutMs: 300000,
  /** Label for pipeline logging (used by research.mjs to identify calls) */
  _label: "unnamed",
  /** Number of retries on timeout (default: 0 — fail fast, let caller fallback) */
  retryCount: 0,
  /** Enable OpenRouter reasoning (model-dependent, adds latency). Default false. */
  reasoning: false,
};

/**
 * Invoke LLM with a prompt and return the model's text response.
 *
 * Uses OpenCode CLI if available, falls back to Copilot CLI.
 * If `RESEARCH_REPO_LLM_CMD` env var is set, uses that custom command instead
 * (must read prompt from stdin, write text to stdout).
 *
 * @param {string} prompt — user prompt
 * @param {Partial<typeof DEFAULT_LLM_OPTIONS>} [options]
 * @returns {Promise<string>} model output text
 */
export async function invokeLLM(prompt, options = {}) {
  const opts = { ...DEFAULT_LLM_OPTIONS, ...options };

  // Inject JSON mode instruction
  const finalPrompt = opts.jsonMode
    ? `${prompt}\n\nReturn ONLY valid JSON. Do not include any explanation, markdown code blocks, or additional text outside the JSON.`
    : prompt;

  // Prepend system prompt if provided
  const fullPrompt = opts.systemPrompt
    ? `[System]\n${opts.systemPrompt}\n\n[User]\n${finalPrompt}`
    : finalPrompt;

  const callLabel = opts._label || "unnamed";
  const promptChars = fullPrompt.length;
  const startTs = Date.now();

  // Retry once on timeout if retryCount > 0
  const maxRetries = opts.retryCount !== undefined ? opts.retryCount : 1;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let result;
      // Route by model prefix: "openrouter/..." → OpenRouter API (curl)
      if (opts.model && opts.model.startsWith("openrouter/")) {
        result = await invokeOpenRouter(fullPrompt, opts);
      }
      // Custom command via env var (highest priority — used by tests)
      else if (process.env.RESEARCH_REPO_LLM_CMD) {
        const cmd = process.env.RESEARCH_REPO_LLM_CMD;
        const parts = cmd.split(/\s+/);
        const { stdout, code } = await run(parts[0], parts.slice(1), fullPrompt, opts.timeoutMs);
        if (code !== 0) {
          throw new Error(`RESEARCH_REPO_LLM_CMD exited with ${code}`);
        }
        result = stdout.trim();
      } else {
        // Auto-detect CLI
        const cli = opts.cli || (await detectCLI());

        if (cli.name === "opencode") {
          const modelArg = opts.model.includes("/") ? opts.model : opts.model;
          const args = ["run", "--model", modelArg, "--format", "json"];
          const { stdout, stderr, code } = await run(cli.path, args, fullPrompt, opts.timeoutMs);
          if (code !== 0) {
            throw new Error(`OpenCode CLI exited ${code}: ${stderr || stdout}`);
          }
          result = aggregateOpenCodeOutput(stdout).trim();
        } else if (cli.name === "copilot") {
          const args = ["chat", "--json"];
          const { stdout, stderr, code } = await run(cli.path, args, fullPrompt, opts.timeoutMs);
          if (code !== 0) {
            throw new Error(`Copilot CLI exited ${code}: ${stderr || stdout}`);
          }
          try {
            const parsed = JSON.parse(stdout);
            if (typeof parsed === "string") result = parsed;
            else if (parsed.text) result = String(parsed.text);
            else if (parsed.content) result = String(parsed.content);
            else if (parsed.response) result = String(parsed.response);
            else result = stdout.trim();
          } catch {
            result = stdout.trim();
          }
        } else {
          throw new Error(`Unknown CLI: ${cli.name}`);
        }
      }

      const duration_ms = Date.now() - startTs;
      // Log success via global logger if available
      if (globalThis.__pipelineLogger) {
        globalThis.__pipelineLogger.llmCall(callLabel, {
          promptChars,
          status: "success",
          duration_ms,
          model: opts.model,
        });
      }
      logLLMCall({
        ts: new Date().toISOString(),
        label: callLabel,
        model: opts.model,
        promptChars,
        promptPreview: fullPrompt.slice(0, 200),
        responseChars: result.length,
        duration_ms,
        status: "success",
      });
      return result;
    } catch (err) {
      lastError = err;
      const duration_ms = Date.now() - startTs;
      const isTimeout = err.message && err.message.includes("timed out");

      if (attempt < maxRetries && isTimeout) {
        if (globalThis.__pipelineLogger) {
          globalThis.__pipelineLogger.llmCall(callLabel, {
            promptChars,
            status: "timeout",
            duration_ms,
            model: opts.model,
            error: `attempt ${attempt + 1}, retrying`,
          });
        }
        console.warn(`  LLM "${callLabel}" timed out (${(duration_ms / 1000).toFixed(0)}s), retrying (${attempt + 1}/${maxRetries})...`);
        continue;
      }

      if (globalThis.__pipelineLogger) {
        globalThis.__pipelineLogger.llmCall(callLabel, {
          promptChars,
          status: isTimeout ? "timeout" : "error",
          duration_ms,
          model: opts.model,
          error: err.message,
        });
      }
      logLLMCall({
        ts: new Date().toISOString(),
        label: callLabel,
        model: opts.model,
        promptChars,
        promptPreview: fullPrompt.slice(0, 200),
        responseChars: 0,
        duration_ms,
        status: isTimeout ? "timeout" : "error",
        error: err.message,
      });
      throw err;
    }
  }

  throw lastError;
}

/**
 * Attempt to parse JSON with common LLM output issues fixed.
 * Handles: unescaped newlines in strings, trailing commas, single quotes.
 */
function parseJSONLenient(text) {
  // Normalize Chinese quotes to escaped ASCII quotes before parsing.
  // LLMs frequently output Chinese double/single quotes inside JSON string values,
  // which break standard JSON parsers.
  text = text.replace(/[“”]/g, '\\"');
  text = text.replace(/[‘’]/g, "'");

  // First try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // Continue to fix attempts
  }

  // Fix trailing commas
  let fixed = text.replace(/,(\s*[}\]])/g, "$1");

  try {
    return JSON.parse(fixed);
  } catch {
    // Continue
  }

  // Escape literal newlines/tabs/carriage returns inside JSON strings.
  // LLMs often emit raw line breaks inside string values, which JSON does not allow.
  // Run this BEFORE extracting a JSON substring so that unterminated strings do not
  // confuse the bracket-matching extractor.
  fixed = escapeWhitespaceInJSONStrings(fixed);

  try {
    return JSON.parse(fixed);
  } catch {
    // Continue
  }

  // Extract JSON object/array from surrounding prose
  const extracted = extractJSON(fixed);
  if (extracted !== null) {
    try {
      return JSON.parse(extracted);
    } catch {
      // Continue
    }
  }

  throw new Error(
    `Cannot parse JSON after all fix attempts\n--- Extracted ---\n${fixed.slice(0, 500)}`
  );
}

function escapeWhitespaceInJSONStrings(text) {
  let result = "";
  let inString = false;
  let escapeNext = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      i++;
      continue;
    }

    if (char === "\\") {
      result += char;
      escapeNext = true;
      i++;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    if (inString && char === "\n") {
      result += "\\n";
      i++;
      continue;
    }

    if (inString && char === "\t") {
      result += "\\t";
      i++;
      continue;
    }

    if (inString && char === "\r") {
      result += "\\r";
      i++;
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

function extractJSON(text) {
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  let start = -1;
  let openChar = "";
  let closeChar = "";

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
    openChar = "{";
    closeChar = "}";
  } else if (firstBracket !== -1) {
    start = firstBracket;
    openChar = "[";
    closeChar = "]";
  }

  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;

  for (let i = start; i < text.length; i++) {
    const c = text[i];

    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;

    if (c === openChar) { depth++; continue; }
    if (c === closeChar) {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end !== -1) {
    return text.slice(start, end);
  }
  return null;
}

/**
 * Invoke LLM and parse response as JSON.
 * Throws if response is not valid JSON.
 *
 * @param {string} prompt
 * @param {Partial<typeof DEFAULT_LLM_OPTIONS>} [options]
 * @returns {Promise<any>} parsed JSON object
 */
export async function invokeLLMJSON(prompt, options = {}) {
  const text = await invokeLLM(prompt, { ...options, jsonMode: true });
  // Strip markdown code fences — handle prose before/after fences
  let cleaned = text;
  const fenceStart = cleaned.match(/```(?:json)?\s*\n/i);
  if (fenceStart) {
    const startIdx = fenceStart.index + fenceStart[0].length;
    const fenceEnd = cleaned.lastIndexOf("```");
    if (fenceEnd > startIdx) {
      cleaned = cleaned.slice(startIdx, fenceEnd);
    } else {
      cleaned = cleaned.slice(startIdx);
    }
  }
  cleaned = cleaned.trim();

  try {
    return parseJSONLenient(cleaned);
  } catch (err) {
    throw new Error(
      `LLM did not return valid JSON: ${err.message}\n--- Response preview ---\n${cleaned.slice(0, 500)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Pipeline integration helper
// ---------------------------------------------------------------------------

/**
 * Render a prompt template by substituting {placeholder} tokens.
 * Used by hybrid-pipeline.mjs to inject evidence brief into skill prompts.
 *
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function renderPrompt(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key)
      ? String(vars[key])
      : match;
  });
}
