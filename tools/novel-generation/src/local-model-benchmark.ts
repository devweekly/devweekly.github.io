// 本地小模型能力评测的纯函数集：不带任何 I/O，供 scripts 与手动基准对比复用。
// 评测的对象是模型的「原始 JSON 解析 + 证据锁定」能力，因此这里刻意不走
// parseJsonObject / jsonrepair 修复链路——修复会把解析失败悄悄变成成功，掩盖真实短板。
export function collectEvidence(
  value: unknown,
  path = "$"
): Array<{ path: string; evidence: string }> {
  const found: Array<{ path: string; evidence: string }> = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...collectEvidence(item, path + "[" + index + "]"));
    });
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // 键名包含 "evidence" 且值为数组时按证据字段收集；其余字段递归下探。
      if (key.toLowerCase().includes("evidence") && Array.isArray(item)) {
        item.forEach((entry, index) => {
          if (typeof entry === "string" && entry.trim()) {
            found.push({ path: path + "." + key + "[" + index + "]", evidence: entry.trim() });
          }
        });
      } else {
        found.push(...collectEvidence(item, path + "." + key));
      }
    }
  }
  return found;
}

export function evaluateExtraction(raw: string, source: string): Record<string, unknown> {
  // 刻意用裸 JSON.parse：本函数评测的是模型能否直接输出合法 JSON，
  // 解析失败必须如实上报 jsonValid:false，而不是经修复后伪装成通过。
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      jsonValid: false,
      parseError: error instanceof Error ? error.message : String(error),
      outputChars: raw.length
    };
  }
  const evidence = collectEvidence(parsed);
  const issues: Array<{ path: string; evidence: string; reason: string }> = [];
  let grounded = 0;
  for (const item of evidence) {
    if (item.evidence.length < 4) issues.push({ ...item, reason: "too_short" });
    else if (source.includes(item.evidence)) grounded++;
    else issues.push({ ...item, reason: "not_exact_source_text" });
  }
  const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const count = (key: string) => Array.isArray(root[key]) ? (root[key] as unknown[]).length : 0;
  return {
    jsonValid: true,
    outputChars: raw.length,
    evidenceCount: evidence.length,
    groundedEvidenceCount: grounded,
    evidenceIssueCount: issues.length,
    evidenceGroundingRate: evidence.length ? Number((grounded / evidence.length).toFixed(4)) : null,
    characterCount: count("characters"),
    eventCount: count("events"),
    relationshipCount: count("relationships"),
    sceneCount: count("scenes"),
    evidenceIssues: issues
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) throw new Error("Embedding dimensions do not match.");
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  // 零向量夹角无定义，返回 0 表示「无相关」，避免 NaN 污染后续排序。
  return aa === 0 || bb === 0 ? 0 : dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

export function rankRetrieval(query: number[], docs: number[][], target: number) {
  const ranked = docs
    .map((vector, index) => ({ index, score: cosineSimilarity(query, vector) }))
    .sort((a, b) => b.score - a.score);
  const rank = ranked.findIndex(x => x.index === target) + 1;
  return {
    rank,
    // 1/rank 是 MRR 的单样本贡献；目标不在结果里时记 0 分。
    reciprocalRank: rank ? 1 / rank : 0,
    top1: rank === 1,
    targetSimilarity: ranked.find(x => x.index === target)?.score ?? 0
  };
}
