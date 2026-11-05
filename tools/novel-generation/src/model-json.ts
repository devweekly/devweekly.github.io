/**
 * 模型输出常在 JSON 前后夹围栏、说明文字，或在字符串里放裸换行/制表符、尾逗号。
 * 这里只负责拿到「第一个完整 JSON 对象」，字段语义仍由各调用方的 schema 校验。
 */

function stripFence(raw: string): string {
  return raw.trim()
    .replace(/^\s*`{3}(?:json)?\s*/i, "")
    .replace(/\s*`{3}\s*$/i, "")
    .trim();
}

/** 按括号计数截取，跳过字符串内的括号与转义，避免尾随说明文字里的 `}` 污染 JSON。 */
export function extractJsonText(raw: string): string {
  const text = stripFence(raw);
  const start = text.indexOf("{");
  if (start < 0) throw new Error("Model output contains no JSON object.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const ch = text[index] as string;
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error("Model output contains no complete JSON object.");
}

/** 把字符串内的裸控制字符转义，并去掉数组/对象末尾的逗号。 */
export function repairJsonText(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) { out += "\\u" + code.toString(16).padStart(4, "0"); continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "," && /^\s*[}\]]/.test(text.slice(i + 1))) continue;
    out += ch;
  }
  return out;
}

export function parseJsonObject(raw: string): unknown {
  const object = extractJsonText(raw);
  try {
    return JSON.parse(object) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return JSON.parse(repairJsonText(object)) as unknown;
    throw error;
  }
}
