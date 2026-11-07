import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import os from "node:os";
import { buildAnalysisUnits, type AnalysisUnit } from "../src/novel-kb.js";
import { runAgentText } from "../src/generate.js";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : fallback;
};
const world = arg("world", "conghuoniao");
const base = (process.env.LM_STUDIO_BASE_URL || arg("local-url", "http://127.0.0.1:1234/v1")).replace(/\/+$/, "");
const localModelArg = process.env.LM_STUDIO_MODEL || arg("local-model", "");
const deepseekModel = arg("deepseek-model", "deepseek-v4.1-flash");
const count = Math.max(1, Math.min(12, Number(arg("chapters", "6"))));
const maxChars = Math.max(3000, Math.min(30000, Number(arg("max-chars", "12000"))));
const timeoutMs = Math.max(30000, Math.min(900000, Number(arg("timeout-ms", "300000"))));
const maxTokens = Math.max(1000, Math.min(12000, Number(arg("max-tokens", "6000"))));
const chapterIds = arg("chapter-ids", "").split(",").map(s => s.trim()).filter(Boolean);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(".output", world, "model-comparison", runId);
const zipPath = resolve(arg("out", join(outDir, "model-comparison-" + world + "-" + runId + ".zip")));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

function choose(units: AnalysisUnit[]): AnalysisUnit[] {
  const eligible = units.filter(u => u.ordinal > 0);
  if (chapterIds.length) {
    const map = new Map(eligible.map(u => [u.chapterId, u]));
    const missing = chapterIds.filter(id => !map.has(id));
    if (missing.length) throw new Error("章节 ID 不存在：" + missing.join(", "));
    return chapterIds.map(id => map.get(id)!);
  }
  if (eligible.length <= count) return eligible;
  if (count === 1) return [eligible[Math.floor((eligible.length - 1) / 2)]!];
  return [...new Set(Array.from({ length: count }, (_, i) => Math.round(i * (eligible.length - 1) / (count - 1))))].map(i => eligible[i]!);
}
function excerpt(text: string): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.65), tail = maxChars - head;
  return { text: text.slice(0, head) + "\n\n【中间部分因长度限制省略】\n\n" + text.slice(-tail), truncated: true };
}
function promptFor(u: AnalysisUnit, source: string): string {
  return [
    "你是中文长篇小说的原著分析助手。分析的唯一目标是帮助后续续写出更好的小说。",
    "最高原则：文学性、文笔、艺术风格高于结构完整和字段覆盖。分析是参考资料，不是创作规则；人物不是固定标签，人物可以变化、反转和出乎意料。",
    "只根据给出的章节原文分析，不调用外部知识，不补充原文没有的设定。输出严格 JSON，不要 Markdown。",
    "JSON 字段：",
    '{"characters":[{"name":"","observedActions":[],"goals":[],"knowledge":[],"contradictions":[],"possibleArc":[],"evidence":[]}],',
    '"relationships":[{"from":"","to":"","dynamic":"","change":"","evidence":[]}],',
    '"plotEvents":[{"event":"","cause":"","consequence":"","participants":[],"importance":"main|subplot|local|unclear","evidence":[]}],',
    '"foreshadowings":[{"clue":"","possibleMeanings":[],"status":"introduced|reinforced|paid_off|unclear","confidence":"high|medium|low","evidence":[]}],',
    '"macguffins":[{"name":"","significance":"","holdersOrSeekers":[],"changes":[],"evidence":[]}],',
    '"worldDetails":[{"category":"","detail":"","howItEntersDailyLife":"","evidence":[]}],',
    '"narrativeCraft":[{"observation":"","effect":"","evidence":[]}],',
    '"styleAnalysis":{"narrativeVoice":"","pacing":"","dialogue":"","imagery":"","emotionalControl":"","distinctiveStrengths":[],"avoidFlattening":[]},',
    '"uncertainties":[]}',
    "要求：少而准，允许空数组；每条 evidence 必须是原文中连续、逐字、可精确搜索的片段，建议 8-60 个汉字；不得意译、拼接或改写。人物动机与关系从行动和互动观察，不把一时表现当恒定性格。伏笔只能标记疑似线索。区分因果、动机、条件和时间先后。风格分析关注叙事效果，不给出模仿句式的模板、句长配额或写作配方。不得推断全书结局。",
    "章节：" + u.chapterId + " / " + u.title,
    "原文（若中间有省略，仅分析可见内容）：\n" + source
  ].join("\n\n");
}
function parseResult(raw: string, source: string): Record<string, unknown> {
  const tick = String.fromCharCode(96).repeat(3);
  const cleaned = raw.trim().replace(new RegExp("^" + tick + "(?:json)?\\s*", "i"), "").replace(new RegExp("\\s*" + tick + "$"), "");
  let root: any;
  try { root = JSON.parse(cleaned); } catch { return { jsonValid: false, evidenceCount: 0, groundedEvidenceCount: 0, evidenceGroundingRate: null }; }
  if (!root || typeof root !== "object" || Array.isArray(root)) return { jsonValid: false };
  const counts: Record<string, number> = {};
  for (const k of ["characters","relationships","plotEvents","foreshadowings","macguffins","worldDetails","narrativeCraft"]) counts[k] = Array.isArray(root[k]) ? root[k].length : 0;
  const evidence: string[] = [];
  const walk = (v: any): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== "object") return;
    if (typeof v.evidence === "string") evidence.push(v.evidence);
    if (Array.isArray(v.evidence)) evidence.push(...v.evidence.filter((x: unknown): x is string => typeof x === "string"));
    for (const [k, child] of Object.entries(v)) if (k !== "evidence") walk(child);
  };
  walk(root);
  const grounded = evidence.filter(e => e.trim().length >= 4 && source.includes(e));
  return { jsonValid: true, categoryCounts: counts, evidenceCount: evidence.length, groundedEvidenceCount: grounded.length,
    evidenceGroundingRate: evidence.length ? Number((grounded.length / evidence.length).toFixed(4)) : null,
    styleAnalysisPresent: Boolean(root.styleAnalysis && typeof root.styleAnalysis === "object"),
    uncertaintyCount: Array.isArray(root.uncertainties) ? root.uncertainties.length : 0 };
}
async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init), body = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + ": " + body.slice(0, 1000));
  return JSON.parse(body);
}
const authHeaders = (): Record<string,string> => process.env.LM_API_TOKEN ? { Authorization: "Bearer " + process.env.LM_API_TOKEN } : {};
async function localModels(): Promise<string[]> {
  const data = await getJson(base + "/models", { headers: authHeaders(), signal: AbortSignal.timeout(15000) });
  return Array.isArray(data.data) ? data.data.map((m: any) => String(m.id || "")).filter(Boolean) : [];
}
async function localCall(prompt: string, model: string): Promise<any> {
  const start = Date.now();
  const body = await getJson(base + "/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("LM Studio 未返回文本。");
  return { text, elapsedMs: Date.now() - start, usage: body.usage, responseModel: body.model };
}
async function deepseekCall(prompt: string): Promise<any> {
  const start = Date.now();
  const text = await runAgentText(prompt, deepseekModel, timeoutMs, undefined, false);
  return { text, elapsedMs: Date.now() - start };
}

/* Dependency-free ZIP writer, copied in spirit from package-review. */
const CRC = (() => { const t = new Uint32Array(256); for (let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(b: Buffer): number { let c=0xffffffff; for(const x of b)c=(CRC[(c^x)&255] as number)^(c>>>8); return (c^0xffffffff)>>>0; }
function zip(files: Array<{path:string;data:Buffer}>): Buffer {
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;const now=new Date();
  const tm=((now.getHours()<<11)|(now.getMinutes()<<5)|Math.floor(now.getSeconds()/2))&65535;
  const dt=(((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate())&65535;
  for(const f of files){const n=Buffer.from(f.path,"utf8"),d=deflateRawSync(f.data,{level:9}),use=d.length<f.data.length,b=use?d:f.data,m=use?8:0,c=crc32(f.data);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(m,8);h.writeUInt16LE(tm,10);h.writeUInt16LE(dt,12);h.writeUInt32LE(c,14);h.writeUInt32LE(b.length,18);h.writeUInt32LE(f.data.length,22);h.writeUInt16LE(n.length,26);h.writeUInt16LE(0,28);local.push(h,n,b);
    const q=Buffer.alloc(46);q.writeUInt32LE(0x02014b50,0);q.writeUInt16LE(20,4);q.writeUInt16LE(20,6);q.writeUInt16LE(0x800,8);q.writeUInt16LE(m,10);q.writeUInt16LE(tm,12);q.writeUInt16LE(dt,14);q.writeUInt32LE(c,16);q.writeUInt32LE(b.length,20);q.writeUInt32LE(f.data.length,24);q.writeUInt16LE(n.length,28);q.writeUInt32LE(offset,42);central.push(q,n);offset+=h.length+n.length+b.length;}
  const dir=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,dir,end]);
}
async function main(): Promise<void> {
  const { units } = await buildAnalysisUnits(world, { worldDir: resolve("worlds", world) });
  const selected = choose(units);
  if (!selected.length) throw new Error("没有可用于对比的章节。");
  const models = await localModels();
  const localModel = localModelArg || (models.length === 1 ? models[0]! : "");
  if (!localModel) throw new Error("LM Studio 没有唯一可用模型，请加载目标模型或指定 --local-model。可见模型：" + models.join(", "));
  if (models.length && !models.includes(localModel)) throw new Error("指定模型不在 LM Studio /v1/models 列表中：" + localModel);
  await mkdir(outDir, { recursive: true });
  const records: any[] = [];
  const manifest: any = { schemaVersion:1, runId, world, createdAt:new Date().toISOString(),
    host:{platform:process.platform,arch:process.arch,node:process.version,os:os.release(),totalMemoryBytes:os.totalmem()},
    settings:{localBaseUrl:base,localModel,deepseekModel,maxChars,timeoutMs,maxTokens,localTemperature:0.2,deepseekSampling:"CodeBuddy SDK defaults; temperature not exposed"},
    localModelsVisibleAtStart:models,chapters:[] };
  for (const unit of selected) {
    const source = excerpt(unit.text), prompt = promptFor(unit, source.text);
    const record: any = { chapterId:unit.chapterId,ordinal:unit.ordinal,title:unit.title,originalCharCount:unit.text.length,
      inputCharCount:source.text.length,inputTruncated:source.truncated,sourceHash:sha(unit.text),promptHash:sha(prompt),
      sourceExcerpt:source.text,prompt,local:null,deepseek:null };
    console.log("\n[" + unit.chapterId + "] " + unit.title);
    try { const r=await localCall(prompt,localModel);record.local={...r,evaluation:parseResult(r.text,source.text)};console.log("  LM Studio: "+r.elapsedMs+"ms"); }
    catch(e){record.local={error:e instanceof Error?e.message:String(e)};console.error("  LM Studio 失败："+record.local.error);}
    try { const r=await deepseekCall(prompt);record.deepseek={...r,evaluation:parseResult(r.text,source.text)};console.log("  DeepSeek: "+r.elapsedMs+"ms"); }
    catch(e){record.deepseek={error:e instanceof Error?e.message:String(e)};console.error("  DeepSeek 失败："+record.deepseek.error);}
    records.push(record);
    await writeFile(join(outDir,unit.chapterId+".json"),json(record),"utf8");
    manifest.chapters.push({chapterId:unit.chapterId,title:unit.title,local:record.local.evaluation??{error:record.local.error},deepseek:record.deepseek.evaluation??{error:record.deepseek.error}});
    await writeFile(join(outDir,"manifest.json"),json(manifest),"utf8");
  }
  const lines = ["# 本地模型与 DeepSeek 原著分析对比","","- World: "+world,"- Local: "+localModel,"- DeepSeek: "+deepseekModel,"- Chapters: "+selected.length,"",
    "| Chapter | Local JSON | Local evidence | DeepSeek JSON | DeepSeek evidence |","|---|---:|---:|---:|---:|",
    ...records.map(r=>"| "+r.chapterId+" | "+(r.local.evaluation?.jsonValid?"有效":"失败")+" | "+(r.local.evaluation?.evidenceGroundingRate??"—")+" | "+(r.deepseek.evaluation?.jsonValid?"有效":"失败")+" | "+(r.deepseek.evaluation?.evidenceGroundingRate??"—")+" |"),
    "","证据命中率仅检查引用是否为输入文本中的连续原文，不代表观察正确或文学质量。JSON 有效也不代表分析质量好。","","## 人工评审重点",
    "1. 人物是否准确识别；行为、动机、认知是否有原文依据，是否避免把人物固定化。",
    "2. 是否识别真正推动情节的事件与因果，而非把时间先后当因果。",
    "3. 是否克制地识别伏笔，保留不确定性。",
    "4. 是否捕捉人物关系的动态变化和意料之外但合理的可能性。",
    "5. 是否理解社会、历史、民俗、组织和超自然设定如何进入日常生活。",
    "6. 风格分析是否抓住叙事效果、节奏、对白与情绪，而不是生成模仿模板。",
    "7. 最重要：分析能否帮助写出更好的小说，而不是让续写变成按清单交作业。",
    "","## 限制",
    "- 两边使用相同章节摘录与 prompt；调用顺序为本地模型后 DeepSeek。",
    "- 本地请求使用 temperature=0.2；CodeBuddy SDK 当前封装不暴露等价 temperature，采样参数不完全相同。",
    "- DeepSeek 通过现有 CodeBuddy SDK 调用，不做模型回退；失败会原样记录。",
    "- 不打包完整原著、数据库或密钥；会打包被抽样章节摘录以便核验 evidence。",
    "- 分析只服务续写，不是正史，不是人物行为约束；文学性始终优先。",""];
  const report=lines.join("\n");
  await writeFile(join(outDir,"REPORT.md"),report,"utf8");
  const files=[{path:"REPORT.md",data:Buffer.from(report)},{path:"manifest.json",data:Buffer.from(json(manifest))},
    ...records.map(r=>({path:r.chapterId+".json",data:Buffer.from(json(r))}))];
  await mkdir(dirname(zipPath),{recursive:true});await writeFile(zipPath,zip(files));
  console.log("\n对比完成：" + zipPath);
  if(records.every(r=>r.local.error&&r.deepseek.error))process.exitCode=1;
}
main().catch(e=>{console.error(e instanceof Error?e.stack:String(e));process.exitCode=1;});
