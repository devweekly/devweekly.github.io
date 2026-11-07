export interface EvidenceIssue {
  path: string;
  evidence: string;
  reason: "empty" | "too_short" | "not_exact_source_text";
}

export function extractLocalResponseText(body: any): { text: string; source: string } {
  const choice = Array.isArray(body?.choices) ? body.choices[0] : undefined;
  const message = choice?.message ?? choice?.delta ?? {};
  const content = message.content;
  let text = "";
  let source = "choices[0].message.content";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content.map((part: any) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string" && ["text", "output_text", undefined].includes(part.type)) return part.text;
      if (typeof part?.content === "string" && part.type === "text") return part.content;
      return "";
    }).filter(Boolean).join("\n");
    source += "[]";
  }
  if (!text.trim() && typeof choice?.text === "string") { text = choice.text; source = "choices[0].text"; }
  if (!text.trim() && typeof body?.output_text === "string") { text = body.output_text; source = "output_text"; }
  if (!text.trim() && typeof body?.text === "string") { text = body.text; source = "text"; }
  return { text, source };
}

export function summarizeLocalResponse(body: any): Record<string, unknown> {
  const choice = Array.isArray(body?.choices) ? body.choices[0] : undefined;
  const message = choice?.message ?? choice?.delta;
  return {
    topLevelKeys: body && typeof body === "object" ? Object.keys(body) : [],
    id: body?.id, model: body?.model, object: body?.object,
    usage: body?.usage,
    choiceCount: Array.isArray(body?.choices) ? body.choices.length : undefined,
    finishReason: choice?.finish_reason,
    messageKeys: message && typeof message === "object" ? Object.keys(message) : [],
    contentType: Array.isArray(message?.content) ? "array" : typeof message?.content,
    contentChars: typeof message?.content === "string" ? message.content.length : undefined,
    contentPreview: typeof message?.content === "string" ? message.content.slice(0, 2000)
      : Array.isArray(message?.content) ? message.content.slice(0, 8).map((part: any) =>
        typeof part === "string" ? part.slice(0, 500)
          : { type: part?.type, text: typeof part?.text === "string" ? part.text.slice(0, 1000) : undefined, keys: part && typeof part === "object" ? Object.keys(part) : [] })
      : undefined,
    reasoningContentType: typeof message?.reasoning_content,
    reasoningContentChars: typeof message?.reasoning_content === "string" ? message.reasoning_content.length : undefined,
    reasoningPreview: typeof message?.reasoning_content === "string" ? message.reasoning_content.slice(0, 1500) : undefined,
    toolCallCount: Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0,
    refusal: message?.refusal
  };
}

export function parseComparisonResult(raw: string, source: string): Record<string, unknown> {
  const tick = String.fromCharCode(96).repeat(3);
  const cleaned = raw.trim().replace(new RegExp("^" + tick + "(?:json)?\\s*", "i"), "").replace(new RegExp("\\s*" + tick + "$"), "");
  let root: any;
  try { root = JSON.parse(cleaned); }
  catch (error) {
    return { jsonValid: false, parseError: error instanceof Error ? error.message : String(error),
      outputPreview: raw.slice(0, 1200), evidenceCount: 0, groundedEvidenceCount: 0,
      evidenceIssueCount: 0, evidenceGroundingRate: null };
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) return { jsonValid: false, parseError: "JSON root must be an object." };
  const counts: Record<string, number> = {};
  for (const key of ["characters","relationships","plotEvents","foreshadowings","macguffins","worldDetails","narrativeCraft"]) counts[key] = Array.isArray(root[key]) ? root[key].length : 0;
  const evidence: Array<{ path: string; value: string }> = [];
  const walk = (value: any, path: string): void => {
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, path + "[" + index + "]")); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "evidence") {
        if (typeof child === "string") evidence.push({ path: path + ".evidence", value: child });
        else if (Array.isArray(child)) child.forEach((item, index) => {
          if (typeof item === "string") evidence.push({ path: path + ".evidence[" + index + "]", value: item });
          else evidence.push({ path: path + ".evidence[" + index + "]", value: String(item ?? "") });
        });
      } else walk(child, path ? path + "." + key : key);
    }
  };
  walk(root, "");
  const issues: EvidenceIssue[] = [];
  for (const item of evidence) {
    if (!item.value.trim()) issues.push({ path: item.path, evidence: item.value, reason: "empty" });
    else if (item.value.trim().length < 4) issues.push({ path: item.path, evidence: item.value, reason: "too_short" });
    else if (!source.includes(item.value)) issues.push({ path: item.path, evidence: item.value, reason: "not_exact_source_text" });
  }
  const grounded = evidence.length - issues.length;
  return {
    jsonValid: true, categoryCounts: counts, evidenceCount: evidence.length,
    groundedEvidenceCount: grounded, evidenceIssueCount: issues.length,
    evidenceGroundingRate: evidence.length ? Number((grounded / evidence.length).toFixed(4)) : null,
    evidenceIssues: issues, styleAnalysisPresent: Boolean(root.styleAnalysis && typeof root.styleAnalysis === "object"),
    uncertaintyCount: Array.isArray(root.uncertainties) ? root.uncertainties.length : 0
  };
}
