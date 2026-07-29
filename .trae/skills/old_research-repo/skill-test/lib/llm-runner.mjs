// ===========================================================================
// llm-runner.mjs — Optional LLM invocation helper for deterministic test tooling.
//
// The research-repo Skill test suite is deterministic by default. This helper
// lets advanced users wire an LLM command when they want LLM-in-the-loop
// fixture generation or live E2E reports.
//
// Configuration:
//   RESEARCH_REPO_LLM_CMD  — shell command that reads a prompt from stdin and
//                            writes the generated text to stdout.
//
// Example:
//   RESEARCH_REPO_LLM_CMD="llm -m claude-3-5-sonnet" \
//     node skill-test/fixture-generator.mjs ./duckdb duckdb --llm
//
// If the command is not configured, runLlm() returns null so callers can fall
// back to deterministic stubs.
// ===========================================================================

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function isLlmAvailable() {
  return Boolean(process.env.RESEARCH_REPO_LLM_CMD);
}

export function runLlm(prompt, { timeout = 300000 } = {}) {
  const cmd = process.env.RESEARCH_REPO_LLM_CMD;
  if (!cmd) return null;

  const result = spawnSync(cmd, [], {
    input: prompt,
    encoding: "utf-8",
    timeout,
    shell: true,
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(
      `LLM command failed (exit ${result.status}): ${result.stderr || "unknown error"}`
    );
  }

  return (result.stdout || "").trim();
}

export function loadPromptTemplate(name, replacements = {}) {
  const path = new URL(`../../prompts/${name}.md`, import.meta.url);
  let text = readFileSync(path, "utf-8");
  for (const [key, value] of Object.entries(replacements)) {
    text = text.replaceAll(`{${key}}`, String(value));
  }
  return text;
}
