// ===========================================================================
// skill-test/lib/prompt-renderer.mjs
//
// Render a prompt template from prompts/ directory with test fixtures.
// Replaces common placeholders like {repoName} and {questionIndex}.
// ===========================================================================

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../prompts");

export function renderPrompt(promptName, vars = {}) {
  const filePath = join(PROMPTS_DIR, `${promptName}.md`);
  let template = readFileSync(filePath, "utf-8");

  for (const [key, value] of Object.entries(vars)) {
    template = template.replaceAll(`{${key}}`, value);
  }

  return template;
}

export function loadEvidenceBrief(fixtureName) {
  const filePath = join(__dirname, `../fixtures/${fixtureName}/evidence-brief.md`);
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function loadQuestions(fixtureName) {
  const filePath = join(__dirname, `../fixtures/${fixtureName}/00-research-questions.md`);
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function loadReport(fixtureName) {
  const filePath = join(__dirname, `../fixtures/${fixtureName}/report.md`);
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}
