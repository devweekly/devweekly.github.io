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
import { constants } from "node:fs";
import { delimiter } from "node:path";

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
// Public API: invokeLLM
// ---------------------------------------------------------------------------

/**
 * Default LLM options.
 */
export const DEFAULT_LLM_OPTIONS = {
  // Default: free model via OpenCode CLI (verified working with hybrid pipeline)
  model: "opencode/deepseek-v4-flash-free",
  /** Optional system prompt prepended to user prompt */
  systemPrompt: null,
  /** If true, instructs LLM to return strictly JSON */
  jsonMode: false,
  /** Override CLI detection (mainly for testing) */
  cli: null,
  /** Timeout in ms (0 = no timeout) */
  timeoutMs: 300000,
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

  // Custom command via env var (highest priority — used by tests)
  if (process.env.RESEARCH_REPO_LLM_CMD) {
    const cmd = process.env.RESEARCH_REPO_LLM_CMD;
    const parts = cmd.split(/\s+/);
    const { stdout, code } = await run(parts[0], parts.slice(1), fullPrompt, opts.timeoutMs);
    if (code !== 0) {
      throw new Error(`RESEARCH_REPO_LLM_CMD exited with ${code}`);
    }
    return stdout.trim();
  }

  // Auto-detect CLI
  const cli = opts.cli || (await detectCLI());

  if (cli.name === "opencode") {
    // OpenCode CLI v1.18+: use --format json (not --json), -m for model
    // Model format: provider/model (e.g., "openai/gpt-5", "anthropic/claude-sonnet-4")
    // If user passes bare model name, try as-is first
    const modelArg = opts.model.includes("/") ? opts.model : opts.model;
    const args = ["run", "--model", modelArg, "--format", "json"];
    const { stdout, stderr, code } = await run(cli.path, args, fullPrompt, opts.timeoutMs);
    if (code !== 0) {
      throw new Error(`OpenCode CLI exited ${code}: ${stderr || stdout}`);
    }
    return aggregateOpenCodeOutput(stdout).trim();
  }

  if (cli.name === "copilot") {
    const args = ["chat", "--json"];
    const { stdout, stderr, code } = await run(cli.path, args, fullPrompt, opts.timeoutMs);
    if (code !== 0) {
      throw new Error(`Copilot CLI exited ${code}: ${stderr || stdout}`);
    }
    // Copilot CLI may emit plain text or JSON; try JSON parse first
    try {
      const parsed = JSON.parse(stdout);
      if (typeof parsed === "string") return parsed;
      if (parsed.text) return String(parsed.text);
      if (parsed.content) return String(parsed.content);
      if (parsed.response) return String(parsed.response);
    } catch {
      // Not JSON — return raw stdout
    }
    return stdout.trim();
  }

  throw new Error(`Unknown CLI: ${cli.name}`);
}

/**
 * Attempt to parse JSON with common LLM output issues fixed.
 * Handles: unescaped newlines in strings, trailing commas, single quotes.
 */
function parseJSONLenient(text) {
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

  // Extract JSON object/array from surrounding prose
  // Find the first { or [ and match its closing bracket
  const firstBrace = fixed.indexOf("{");
  const firstBracket = fixed.indexOf("[");
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

  if (start !== -1) {
    // Find the matching closing bracket by tracking depth
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;

    for (let i = start; i < fixed.length; i++) {
      const c = fixed[i];

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
      fixed = fixed.slice(start, end);
      try { return JSON.parse(fixed); } catch { /* continue */ }
    }
  }

  // Try to fix unescaped newlines inside strings
  let result = "";
  let inString = false;
  let escapeNext = false;
  let i = 0;

  while (i < fixed.length) {
    const char = fixed[i];

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

  try {
    return JSON.parse(result);
  } catch (err) {
    throw new Error(
      `Cannot parse JSON after all fix attempts: ${err.message}\n--- Extracted ---\n${result.slice(0, 500)}`
    );
  }
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
