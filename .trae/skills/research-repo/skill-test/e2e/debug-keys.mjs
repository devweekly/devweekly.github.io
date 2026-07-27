import { readFileSync } from "node:fs";

const stdout = readFileSync(process.argv[2], "utf-8");

function extractJson(stdout) {
  let end = stdout.length - 1;
  while (end >= 0 && /\s/.test(stdout[end])) end--;
  if (end < 0) return null;
  const closer = stdout[end];
  if (closer !== "}" && closer !== "]") return null;
  const opener = closer === "}" ? "{" : "[";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = end; i >= 0; i--) {
    const ch = stdout[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === closer) depth++;
    else if (ch === opener) {
      depth--;
      if (depth === 0) return stdout.slice(i, end + 1);
    }
  }
  return null;
}

const obj = JSON.parse(extractJson(stdout));
console.log("ROOT KEYS:", Object.keys(obj).join(", "));
console.log("discovery:", Object.keys(obj.discovery || {}).join(", "));
console.log("symbols:", Object.keys(obj.symbols || {}).join(", "));
console.log("architecture:", Object.keys(obj.architecture || {}).join(", "));
console.log("archetypeHints:", Object.keys(obj.archetypeHints || obj._archetypeHints || {}).join(", "));
