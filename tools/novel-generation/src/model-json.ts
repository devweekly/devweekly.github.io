/**
 * 模型输出常在 JSON 前后夹围栏、说明文字，或在字符串里放裸换行/制表符、尾逗号、不加引号的键。
 * 这里分两步处理：
 * 1) extractJsonText 只定位「第一个完整 JSON 对象」。这步不能交给 jsonrepair：
 *    实测它对首尾带说明文字的输出会拼接出错误结构（如把前后文本当作字符串数组成员），
 *    也无法在两个相邻对象之间选出第一个。
 * 2) 已定位的对象交给 jsonrepair 库修复裸控制字符、尾逗号、单引号、裸键等常见坏损，
 *    不再手写字符扫描器。
 * 字段语义仍由各调用方的 schema 校验；本模块只负责把文本变成可解析的 JSON。
 */
import { jsonrepair } from "jsonrepair";

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

export function parseJsonObject(raw: string): unknown {
  const object = extractJsonText(raw);
  try {
    return JSON.parse(object) as unknown;
  } catch (error) {
    // 库能修就修；库也修不了时抛原始 SyntaxError——它带出错位置，比库的报错更容易回溯是哪条模型输出坏损。
    try {
      return JSON.parse(jsonrepair(object)) as unknown;
    } catch {
      throw error;
    }
  }
}
