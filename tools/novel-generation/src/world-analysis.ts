import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { searchLibrary } from "./library.js";
import { runAgentText } from "./generate.js";
import { parseJsonObject } from "./model-json.js";
import { z } from "zod";
import {
  AGENT_REPORT_MIN_CHARS,
  AGENT_REPORT_MIN_REFERENCES,
  AGENT_REPORT_MIN_SECTIONS,
  DEFAULT_PROBE_TIMEOUT_MS,
  INVALID_REF_REPORT_LIMIT
} from "./constants.js";

/**
 * fact：句子里的具体事实（数值、名称、身份、事件结果）必须被该句引用行支持；
 *       概括、评价、因果判断属于分析本身，引用写不出它们是正常的。
 * proposal：在 fact 之上，项目原创的设想即使带具体细节也不要求引用。
 */
export type EvidencePolicy = "fact" | "proposal";

export interface AnalysisRole {
  id: string;
  name: string;
  mission: string;
  query: string;
  focusVolumes: number[];
  lineRanges: Array<[number, number]>;
  rangeNotes: string[];
  questions: string[];
  evidencePolicy: EvidencePolicy;
}

export const ANALYSIS_ROLES: AnalysisRole[] = [
  {
    id: "main-plot",
    name: "主线剧情 Agent",
    mission: "梳理全书主线推进、卷间因果与长期情节线，判断结构如何变化。不写正文，不新增设定。",
    query: "睚眦 神庭 思凡 太岁 十主 红旗帮 果实脱落 结算",
    focusVolumes: [1, 3, 5, 7, 11, 13, 17],
    lineRanges: [[7295, 7950], [16360, 16400], [26000, 26060], [47188, 47210], [60160, 60180], [81474, 81500], [114287, 114310]],
    rangeNotes: ["首次结算与规则确立", "睚眦长期事件开启", "思凡八苦与果实脱落", "能力三层次的归纳", "神庭之路开启条件", "登顶结算与专属忍土", "南洋六年后的危局"],
    questions: [
      "主线如何从单次事件的求生转为制度层博弈，转折发生在哪一卷、依据是什么",
      "睚眦、神庭、思凡、南洋四条长期线各自的开启位置、推进节点和当前状态",
      "卷与卷之间真正构成因果链的连接点，哪些只是时间上的先后",
      "已埋设但未回收的伏笔，以及回收时需要遵守的既有事实",
      "接续卷 17 时不可绕开的主线硬约束"
    ],
    evidencePolicy: "fact"
  },
  {
    id: "creative",
    name: "创意剧情 Agent",
    mission: "基于原文未展开的边角，提出可写的衍生与续写方向，标明证据、冲突、代价和风险。不写正文，不把建议写成已发生的正史。",
    query: "残篇 卷轴 拍卖 忍土 阎昭会 天母 妈祖 水株公园",
    focusVolumes: [2, 4, 6, 8, 10, 12, 14, 16],
    lineRanges: [[7682, 7790], [44630, 44645], [59402, 59510], [81720, 81745], [98773, 99100], [99611, 99670]],
    rangeNotes: ["现实与果实的人物分岔", "忍土替身规则", "被摘取果实的准入门槛", "果实养料与结算细则", "母冠与阎昭会", "阎昭会下属拍卖机构"],
    questions: [
      "哪些普通人、边缘职业、地方组织或未展开事件可以承载新故事，而不依赖主角出场",
      "提出至少四个方向，每个写清时间点、地点、与原著的关联依据、核心冲突、代价和连续性风险",
      "至少给出一个低风险方向与一个高风险方向，并说明风险来自哪里",
      "哪些方向明确不可碰，因为它们会与已确认的结算结果、时间线或人物状态冲突",
      "把每个方向标为项目原创，不与原著事实混写"
    ],
    evidencePolicy: "proposal"
  },
  {
    id: "style",
    name: "文风 Agent",
    mission: "分析叙事方式与语言节奏，产出可检查的抽象写作约束。不复制原句，不要求模仿特定作者的标志性表达。",
    query: "第一章 结算 大枪落幕 天色 风 血 笑",
    focusVolumes: [1, 3, 7, 13, 15, 17],
    lineRanges: [[9, 60], [3418, 3460], [7295, 7330], [84243, 84310], [99456, 99480], [118050, 118087]],
    rangeNotes: ["现实开篇的感官铺陈", "打斗段落与系统面板", "结算文本的信息密度", "蒸汽城市的场景建立", "新人物视角开篇", "末卷的对白与行动"],
    questions: [
      "第三人称限知的实现方式，以及新卷从他人视角起笔的功能",
      "句长、段落长度、对白与叙述比例在动作段和日常段的差异",
      "感官细节、时代器物和系统面板各自承担什么信息功能",
      "章节与卷的收束方式，以及悬念如何分布",
      "各卷之间可辨认的风格差异，哪些差异来自题材而非笔法",
      "给出可以直接用于写作检查的抽象约束，不写特定句式模板"
    ],
    evidencePolicy: "fact"
  },
  {
    id: "characters",
    name: "人物与关系 Agent",
    mission: "分析人物动机、信息边界、关系代价与声音差异，核对能力面板和身份变化。",
    query: "李阎 查小刀 余束 貘 丹娘 赵剑中 郑秀 与共者",
    focusVolumes: [1, 3, 7, 8, 15, 17],
    lineRanges: [[12187, 12225], [18105, 18135], [28115, 28150], [46250, 46290], [46470, 46495], [118055, 118087]],
    rangeNotes: ["作者单章的身份划分", "查小刀的能力面板", "位阶说明", "丹娘与李阎的日常", "赵剑中的神庭提议", "末卷查小刀的行事方式"],
    questions: [
      "李阎从散阶到八极行走的动机与目标变化，哪些节点由结算或位阶说明直接支持",
      "与共者机制如何影响搭档关系的收益与代价，而不只是人物好恶",
      "余束、貘、赵剑中分别提供什么信息，哪些信息后来被修正或仍属人物推断",
      "主要人物的知识边界：谁在什么时候知道什么，续写时不能让谁提前知道什么",
      "不同身份的人物在对白层面的可辨认差异，以及不该出现的口吻",
      "列出本地全文无法确认的人物状态，标为待核实"
    ],
    evidencePolicy: "fact"
  },
  {
    id: "continuity",
    name: "世界观与连续性 Agent",
    mission: "核对果实规则、数值、时间线与证据口径的一致性，产出续写必须遵守的硬约束清单。",
    query: "结算 评价 觉醒度 位阶 果实 探索度 权限 脱落",
    focusVolumes: [1, 3, 5, 9, 11, 16],
    lineRanges: [[7207, 7353], [10640, 10715], [28122, 28148], [47240, 47282], [81474, 81494], [110674, 110700]],
    rangeNotes: ["首次结算的数值", "果实记录与探索笔记", "九位阶四层次", "指定果实的例外规则", "登顶结算", "果实脱落后的结算"],
    questions: [
      "果实编号、命名与再进入权在不同卷是否一致，哪几处写法存在歧义",
      "评价档位、阎浮点数、购买权限、觉醒度门槛的数值前后是否冲突",
      "现实侧与果实内的时间跨度如何对应，哪些卷是同一果实的再次进入",
      "哪些规则来自正文或结算报告，哪些只是人物转述，哪些来自作者单章",
      "本地全文内部有无明显矛盾或未解释的口径变化",
      "给出续写硬约束清单和待核实清单，每条注明证据行号"
    ],
    evidencePolicy: "fact"
  }
];

/**
 * chapter-index.json 由 analysis/build-corpus-index.mjs 生成，是 schemaVersion 2 的富结构
 * （顶层元数据 + 每卷 chapters[]）。这里只取卷表与总行数，其余字段必须允许存在。
 */
const VolumeSummarySchema = z.object({
  volume: z.number().int().positive(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  chapterCount: z.number().int().nonnegative(),
  openingChapter: z.string(),
  closingChapter: z.string()
});

const ChapterIndexSchema = z.object({
  totalLines: z.number().int().positive(),
  volumes: z.array(VolumeSummarySchema)
});

type VolumeSummary = z.infer<typeof VolumeSummarySchema>;
type ChapterIndexFile = z.infer<typeof ChapterIndexSchema>;

const EvidenceReviewResponseSchema = z.object({
  decisions: z.array(z.object({
    index: z.number().int().nonnegative(),
    supported: z.boolean(),
    reason: z.string().min(1),
    unsupported: z.preprocess(value => {
      if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean);
      if (typeof value === "string" && value.trim()) return [value.trim()];
      return [];
    }, z.array(z.string())).default([])
  }))
});

export interface EvidenceReferenceCheck {
  ok: boolean;
  references: number[];
  claims: EvidenceClaim[];
  issues: string[];
}

/** 一条可核验主张：一句带引用行号的话。段落是组织单位，句子才是判断单位。 */
export interface EvidenceClaim {
  text: string;
  lines: number[];
  section: string;
}

/**
 * 项目原创约束、说明性引子和清单不是「关于原著的结论」，本来就不需要 L#### 行号。
 * 把它们当缺证据的结论会让整份审查在调用模型前就 fail-closed。
 */
function isNonClaimParagraph(text: string): boolean {
  if (/项目原创|整理层约束|不指向特定|^以下|^注[：:]|^说明[：:]/.test(text)) return true;
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  return lines.length > 1 && lines.every(line => /^(?:[-*•]|\d+[.)、])\s/.test(line));
}

/**
 * 分号分句只在引用跟得住的时候拆：`A（L1）；B（L2）` 拆成两条，
 * `A（L1）；B` 合成一条——B 靠前一句的引用兜底，拆开就没人核它了。
 */
function splitClauses(sentence: string): string[] {
  const parts = sentence.split(/(?<=；)/).filter(part => part.trim());
  const merged: string[] = [];
  let pending = "";
  for (const part of parts) {
    const current = pending + part;
    if (/\bL\d+\b/.test(current)) {
      merged.push(current);
      pending = "";
    } else {
      pending = current;
    }
  }
  if (pending) {
    if (merged.length) merged[merged.length - 1] += pending;
    else merged.push(pending);
  }
  return merged;
}

/**
 * 分析成稿的段落常并列五六条主张、各自带引用，按段判定会把整段否掉而说不出哪句有问题。
 * 这里按句切分，只把自带 L#### 的句子列入待审；句中的评价、过渡和提案不要求逐句有证据。
 */
export function splitEvidenceClaims(text: string): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  let section = "";
  for (const block of text.split(/\n\s*\n/)) {
    const paragraph = block.trim();
    if (!paragraph) continue;
    if (/^#{1,6}\s/.test(paragraph)) {
      section = paragraph.replace(/^#{1,6}\s*/, "").trim();
      continue;
    }
    if (/^\s*\x60{3}/.test(paragraph)) continue;
    if (section.startsWith("待核实")) continue;
    if (isNonClaimParagraph(paragraph) && !/\bL\d+\b/.test(paragraph)) continue;
    for (const sentence of paragraph.split(/(?<=[。！？])/)) {
      if (!sentence.trim()) continue;
      for (const clause of splitClauses(sentence.trim())) {
        const lines = [...clause.matchAll(/\bL(\d+)\b/g)].map(match => Number(match[1]));
        if (!lines.length) continue;
        claims.push({ text: clause.trim(), lines: [...new Set(lines)], section });
      }
    }
  }
  return claims;
}

export function validateEvidenceReferences(text: string, sourceLines: string[]): EvidenceReferenceCheck {
  const references = [...text.matchAll(/\bL(\d+)\b/g)].map(match => Number(match[1]));
  const issues: string[] = [];
  const claims = splitEvidenceClaims(text);
  let section = "";
  for (const paragraph of text.split(/\n\s*\n/)) {
    const block = paragraph.trim();
    if (!block || /^\s*\x60{3}/.test(block)) continue;
    if (/^#{1,6}\s/.test(block)) {
      section = block.replace(/^#{1,6}\s*/, "").trim();
      continue;
    }
    if (section.startsWith("待核实")) continue;
    if (/\bL\d+\b/.test(block)) continue;
    if (!isNonClaimParagraph(block)) issues.push("结论段落缺少原文行号引用：" + block.slice(0, 60));
  }
  for (const line of references) {
    if (line < 1 || line > sourceLines.length) issues.push("L" + line + " 超出原文范围");
    else if (!sourceLines[line - 1]?.trim()) issues.push("L" + line + " 指向空行");
  }
  if (!claims.length) issues.push("没有找到带原文行号的可审查结论句子");
  return { ok: issues.length === 0, references, claims, issues };
}

export interface SemanticEvidenceReview {
  ok: boolean;
  policy: EvidencePolicy;
  checked: number;
  supported: number;
  rejected: number;
  issues: string[];
  decisions: Array<{ claim: string; section: string; lines: number[]; supported: boolean; reason: string; unsupported: string[] }>;
}

/**
 * 分析稿标的是行号锚点，不是逐字对齐的引文：同一段结算的数值常在锚点上下几行。
 * 核验时给出锚点邻行，避免把「引了段落开头」误判成「引错了地方」。
 */
export function evidenceWindow(lines: number[], radius: number, totalLines: number, cap = 16): number[] {
  if (radius <= 0) return [...new Set(lines)].sort((a, b) => a - b);
  const picked = new Set<number>(lines);
  for (let step = 1; step <= radius && picked.size < cap; step++) {
    for (const line of lines) {
      for (const target of [line - step, line + step]) {
        if (picked.size >= cap) break;
        if (target >= 1 && target <= totalLines) picked.add(target);
      }
    }
  }
  return [...picked].sort((a, b) => a - b);
}

const POLICY_PROMPT: Record<EvidencePolicy, string> = {
  fact: "核验范围只到具体事实：数值、点数、百分比、名称、编号、身份、时间、事件结果、谁做了什么。这些出现在句中就必须在引用行里找得到；找不到、数值不符或归属错误即判不支持，并写进 unsupported。概括、评价、因果解释、结构性判断不要求引用行写出，即使看起来像论断也一律放过——那不是证据问题。",
  proposal: "核验范围只到具体事实：数值、名称、编号、身份、时间、事件结果。项目原创的设想、方案、假设场景不需要引用行支持，哪怕写得再具体也放过；只有句中对原著的复述（谁做了什么、原文写了什么数）与引用行不符时才判不支持，并写进 unsupported。概括与评价同样放过。"
};

export async function reviewAnalysisEvidence(
  text: string,
  sourceLines: string[],
  options: { policy: EvidencePolicy; model?: string; timeoutMs?: number; window?: number } = { policy: "fact" }
): Promise<SemanticEvidenceReview> {
  const check = validateEvidenceReferences(text, sourceLines);
  const policy = options.policy;
  // 引用行越界或某段漏标行号，只影响那些句子；其余句子仍应逐句核验。
  const issues: string[] = [...check.issues.filter(issue => !issue.startsWith("没有找到"))];
  if (!check.claims.length) {
    return { ok: false, policy, checked: 0, supported: 0, rejected: 0, issues, decisions: [] };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const radius = Math.max(0, Math.min(options.window ?? 2, 6));
  const decisions: SemanticEvidenceReview["decisions"] = [];
  let failedBatches = 0;

  const unsupportedDecision = (claim: EvidenceClaim, reason: string): SemanticEvidenceReview["decisions"][number] =>
    ({ claim: claim.text, section: claim.section, lines: claim.lines, supported: false, reason, unsupported: [] });

  /** 批次越大越容易被截断；解析失败就二分重试，最小到一句。 */
  const reviewBatch = async (batch: EvidenceClaim[], label: string): Promise<void> => {
    const candidates = batch.map((claim, index) => ({
      index,
      section: claim.section,
      claim: claim.text,
      evidence: evidenceWindow(claim.lines, radius, sourceLines.length)
        .map(line => "L" + line + (claim.lines.includes(line) ? ": " : "（邻行）: ") + sourceLines[line - 1])
    }));
    const prompt = [
      "你是小说研究报告的证据审查员。判断每个待审句子里的具体事实，是否与该句自己引用的原文行一致。",
      POLICY_PROMPT[policy],
      "只核对事实是否对得上，不评价观点是否合理、结构是否清晰或文笔如何。",
      "标 L#### 的是作者指定的锚点行，标「邻行」的是同一段落的相邻行，两者都可作依据。\n"
      + "不能再往外扩；数值、名称、身份与这些行不符时，写清是哪一项。",
      "卷次、章次归属由章节目录确定，引用行不写「第几卷」不算错误；同一数值的不同写法（97/100 与 97100）也不判。",
      "判断性短语（最集中、只作、不可推算、未收、应改判）属于分析结论，不进 unsupported。",
      "区分原文明确事实、作者设定、人物推断；原文未明确的结论不能判为明确支持。",
      "每个 index 必须恰好返回一项；不确定、缺项或格式错误均按不支持处理。reason 一句话，不超过 60 字。",
      "只输出 JSON：{decisions:[{index:number,supported:boolean,reason:string,unsupported:string[]}]}。",
      "待审句子与原文证据：",
      JSON.stringify(candidates)
    ].join("\n\n");

    let raw: string;
    try {
      raw = await runAgentText(prompt, options.model, timeoutMs);
    } catch (error) {
      failedBatches++;
      issues.push(label + " 语义审查失败：" + (error instanceof Error ? error.message : String(error)));
      for (const claim of batch) decisions.push(unsupportedDecision(claim, "模型审查失败，按不支持处理"));
      return;
    }

    let parsed: ReturnType<typeof EvidenceReviewResponseSchema.safeParse> | undefined;
    try {
      parsed = EvidenceReviewResponseSchema.safeParse(parseJsonObject(raw));
    } catch {
      parsed = undefined;
    }
    if (!parsed || !parsed.success) {
      if (batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        await reviewBatch(batch.slice(0, middle), `${label}.1`);
        await reviewBatch(batch.slice(middle), `${label}.2`);
        return;
      }
      issues.push(label + " 审查返回格式无效");
      for (const claim of batch) decisions.push(unsupportedDecision(claim, "审查输出格式无效，按不支持处理"));
      return;
    }

    const byIndex = new Map(parsed.data.decisions.map(item => [item.index, item]));
    batch.forEach((claim, index) => {
      const decision = byIndex.get(index);
      if (!decision) {
        issues.push(label + " 缺少第 " + (index + 1) + " 句的审查结果");
        decisions.push(unsupportedDecision(claim, "审查结果缺失，按不支持处理"));
      } else {
        decisions.push({ claim: claim.text, section: claim.section, lines: claim.lines, supported: decision.supported, reason: decision.reason, unsupported: decision.unsupported });
      }
    });
  };

  const batchSize = 12;
  for (let offset = 0; offset < check.claims.length; offset += batchSize) {
    await reviewBatch(check.claims.slice(offset, offset + batchSize), "第 " + (Math.floor(offset / batchSize) + 1) + " 批");
  }
  const supported = decisions.filter(item => item.supported).length;
  const rejected = decisions.length - supported;
  if (rejected) {
    // 模型不可用是基础设施失败，不是「结论被判定不支持」，两者不能混为同一句诊断。
    issues.push(failedBatches
      ? `${rejected} 句结论因 ${failedBatches} 批模型审查失败而无法核验（非语义判定，请检查 CLI 登录）`
      : `${rejected} 句结论未通过原文证据核验`);
  }
  return { ok: decisions.length === check.claims.length && rejected === 0 && !issues.length, policy, checked: decisions.length, supported, rejected, issues, decisions };
}

export interface OutputValidation {
  ok: boolean;
  chars: number;
  evidenceCount: number;
  issues: string[];
}

export function validateAnalysisOutput(text: string, totalLines: number): OutputValidation {
  const issues: string[] = [];
  const chars = text.replace(/\s/g, "").length;
  const references = [...text.matchAll(/\bL(\d+)\b/g)].map(match => Number(match[1]));
  if (chars < AGENT_REPORT_MIN_CHARS) issues.push(`正文过短（${chars} 字，要求至少 ${AGENT_REPORT_MIN_CHARS} 字）`);
  if (references.length < AGENT_REPORT_MIN_REFERENCES) issues.push(`证据行号不足（${references.length} 处，要求至少 ${AGENT_REPORT_MIN_REFERENCES} 处）`);
  const sections = [...text.matchAll(/^##\s/gm)].length;
  if (sections < AGENT_REPORT_MIN_SECTIONS) issues.push(`二级标题不足（${sections} 个，要求至少 ${AGENT_REPORT_MIN_SECTIONS} 个）`);
  if (/TODO|待补|占位|待填/.test(text)) issues.push("残留占位文字");
  const invalid = references.filter(line => line < 1 || line > totalLines);
  if (invalid.length) issues.push(`行号越界：${invalid.slice(0, INVALID_REF_REPORT_LIMIT).join("、")}`);
  return { ok: issues.length === 0, chars, evidenceCount: references.length, issues };
}

function volumeTable(volumes: VolumeSummary[]): string {
  const rows = ["| 卷 | 行范围 | 章数 | 首章 | 末章 |", "|---:|---|---:|---|---|"];
  for (const volume of volumes) {
    rows.push(`| ${volume.volume} | ${volume.startLine}–${volume.endLine} | ${volume.chapterCount} | ${volume.openingChapter} | ${volume.closingChapter} |`);
  }
  return rows.join("\n");
}

async function loadChapterIndex(analysisDir: string): Promise<ChapterIndexFile> {
  const path = resolve(analysisDir, "..", "chapter-index.json");
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  const parsed = ChapterIndexSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid chapter index " + path + ": " + parsed.error.issues.map(issue => issue.message).join("; "));
  return parsed.data;
}

const COMMON_RULES = [
  "证据口径：`原著明确`（正文、结算报告、系统面板）、`作者设定`（作者单章）、`人物推断`（角色转述或猜测）、`待核实`（只有现象不能定论）。前两类可作正史，后两类必须标明。",
  "每个关键结论后用 `L####` 标注 `original.txt` 的行号；行号必须真实存在，可用 Grep / Read 自行核对。",
  "不得补造人物、事件、数值、规则或章节；无法确认的写进「待核实」，不要用推测填空。",
  "不复制章节正文，不改写原句充当自己的表达；引用只保留必要的极短片段。",
  "中文成稿，以连贯段落为主；列表只用于真正独立、可逐项检查的事项，不写「引入句 + 多点列表 + 加粗总结」的模板结构。",
  "不写对话应答语、工作过程、版本说明或空泛过渡句；不使用模板化排比和夸大结论。",
  "文件末尾数行为空行，证据行号必须指向有内容的行；末卷最后有效行是 L118087。",
  "区分事实、人物判断和本 Agent 的分析；本 Agent 提出的创作建议一律标为项目原创。"
].join("\n");

function buildInput(role: AnalysisRole, index: ChapterIndexFile, hits: Awaited<ReturnType<typeof searchLibrary>>, outputPath: string): string {
  const ranges = role.lineRanges.map(([start, end], position) =>
    `- L${start}–L${end}：${role.rangeNotes[position] ?? "建议精读"}`
  ).join("\n");
  const hitRows = hits.map((hit, position) =>
    `| ${position + 1} | ${hit.chapter} | ${hit.start}–${hit.end} | ${hit.score.toFixed(1)} | ${hit.text.slice(0, 46).replace(/\|/g, "\\|").replace(/\s+/g, " ")}… |`
  ).join("\n");

  return [
    `# ${role.name}｜分析输入包`,
    "",
    "## 角色与任务",
    "",
    role.mission,
    "",
    "## 必须回答的问题",
    "",
    ...role.questions.map((question, position) => `${position + 1}. ${question}`),
    "",
    "## 证据源与边界",
    "",
    `- 原文：\`original.txt\`，共 ${index.totalLines} 行；可用 Grep / Read 按行号核对。`,
    "- 检索库：`worlds/conghuoniao/library/index.json`（带重叠的全文切片）。",
    "- 已有分析：`analysis/conghuoniao/volumes.md`、`analysis/conghuoniao/analysis-report.md`。",
    "- 世界资料：`worlds/conghuoniao/` 下的 `world-bible.md`、`yanfu-system.md`、`fruit-worlds.md`、`characters.md`、`timeline.md`。",
    "- 这些文档是索引，不是正史；与原文冲突时以原文为准，并把冲突写进结论。",
    "",
    COMMON_RULES,
    "",
    "## 建议精读区间",
    "",
    ranges,
    "",
    `重点卷：${role.focusVolumes.join("、")}。区间只是起点，允许按线索自行扩展检索。`,
    "",
    "## 本地检索命中（章节定位用，摘要不构成证据）",
    "",
    "偏移是章节内字符位置，不是 `original.txt` 的行号；结论里的 `L####` 必须回到原文用 Grep / Read 核对。",
    "",
    "| # | 章节 | 偏移 | 相关度 | 片段开头 |",
    "|---:|---|---|---:|---|",
    hitRows || "| — | 未命中 | — | — | 改用行号区间自行检索 |",
    "",
    "## 卷结构",
    "",
    volumeTable(index.volumes),
    "",
    "## 输出契约",
    "",
    `- 写入路径：\`${outputPath}\`，只写这一份文件。`,
    "- 篇幅 900–1800 字（不含空白），至少 8 处 `L####` 证据行号，全部在原文行数范围内。",
    "- 至少三个二级标题；结尾设「## 待核实」小节，列出本角色无法从全文确认的事项。",
    "- 不写执行过程或工具调用记录；成稿应能直接交付读者。",
    ""
  ].join("\n");
}

const PROTOCOL = [
  "# 多 Agent 文本分析协议",
  "",
  "分析对象是本地全文 `original.txt` 与已入库的检索库。每个 Agent 只负责一个视角，读取自己的 `input.md`，把成稿写入同目录的 `output.md`，不改写其他 Agent 的文件，也不改写 `worlds/` 下的正史资料。",
  "",
  "| Agent | 目录 | 职责 |",
  "|---|---|---|",
  ...ANALYSIS_ROLES.map(role => `| ${role.name} | \`${role.id}/\` | ${role.mission} |`),
  "",
  "执行顺序：先运行 `prepare` 生成输入包，再由各 Agent 独立分析并写入 `output.md`，最后运行 `collect` 校验并汇总。`status` 可随时查看哪些角色尚未交稿。",
  "collect 默认读取本地 original.txt，核对引用行是否真实存在且非空，只做确定性校验；缺失原文或行数不一致时该角色不通过。加 --evidence-review 才会用独立模型逐句判断引用原文是否支持该句的陈述。主线、人物、连续性三类逐句严格核验；创意与文风两类只核句中的原文事实，提案与评价豁免。模型调用失败或任一句不支持时该角色不通过。",
  "",
  "```bash",
  "npm run dev -- analyze-world --world conghuoniao --phase prepare",
  "npm run dev -- analyze-world --world conghuoniao --phase status",
  "npm run dev -- analyze-world --world conghuoniao --phase collect",
  "```",
  "",
  "输入包与输出文档都随代码提交，便于复核每个结论的依据。分析结论是工作记录，不自动等于原著正史；`collect` 只做格式与证据密度校验，不判断观点对错。",
  ""
].join("\n");

export interface PrepareResult { roles: number; dir: string; }

export async function prepareWorldAnalysis(worldId: string): Promise<PrepareResult> {
  const analysisDir = resolve("analysis", worldId, "agent-analysis");
  const libraryDir = resolve("worlds", worldId, "library");
  const index = await loadChapterIndex(analysisDir);
  await mkdir(analysisDir, { recursive: true });
  await writeFile(join(analysisDir, "PROTOCOL.md"), PROTOCOL, "utf8");

  for (const role of ANALYSIS_ROLES) {
    const roleDir = join(analysisDir, role.id);
    await mkdir(roleDir, { recursive: true });
    const hits = await searchLibrary(libraryDir, role.query, 6);
    const outputPath = `analysis/${worldId}/agent-analysis/${role.id}/output.md`;
    await writeFile(join(roleDir, "input.md"), buildInput(role, index, hits, outputPath), "utf8");
  }
  return { roles: ANALYSIS_ROLES.length, dir: analysisDir };
}

export interface CollectEntry {
  id: string;
  name: string;
  path: string;
  chars: number;
  evidenceCount: number;
  evidenceReview?: SemanticEvidenceReview;
  ok: boolean;
  issues: string[];
}

export interface CollectResult {
  worldId: string;
  generatedAt: string;
  entries: CollectEntry[];
  complete: boolean;
}

/**
 * 默认只做确定性交接校验（格式、证据密度、引用行号与原文行数）。
 * 逐段语义证据核验需显式 `--evidence-review`，会调用模型并把不支持的结论计入 complete。
 */
export async function collectWorldAnalysis(
  worldId: string,
  options: { sourcePath?: string; model?: string; timeoutMs?: number; evidenceReview?: boolean; evidenceWindow?: number } = {}
): Promise<CollectResult> {
  const analysisDir = resolve("analysis", worldId, "agent-analysis");
  const index = await loadChapterIndex(analysisDir);
  const sourcePath = resolve(options.sourcePath ?? "original.txt");
  let sourceLines: string[] | undefined;
  try {
    sourceLines = (await readFile(sourcePath, "utf8")).split(/\r?\n/);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const entries: CollectEntry[] = [];

  for (const role of ANALYSIS_ROLES) {
    const relative = `analysis/${worldId}/agent-analysis/${role.id}/output.md`;
    let text = "";
    try { text = await readFile(resolve(relative), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const validation = validateAnalysisOutput(text, index.totalLines);
    const issues = [...validation.issues];
    let referenceOk = true;
    let evidenceReview: SemanticEvidenceReview | undefined;
    if (text && validation.ok) {
      if (!sourceLines) {
        issues.push("找不到原文文件：" + sourcePath + "，无法核验引用行号");
        referenceOk = false;
      } else if (sourceLines.length !== index.totalLines) {
        issues.push("原文行数 " + sourceLines.length + " 与 chapter-index 的 " + index.totalLines + " 不一致");
        referenceOk = false;
      } else if (options.evidenceReview) {
        evidenceReview = await reviewAnalysisEvidence(text, sourceLines, {
          policy: role.evidencePolicy, model: options.model, timeoutMs: options.timeoutMs, window: options.evidenceWindow
        });
        issues.push(...evidenceReview.issues);
      }
    }
    entries.push({
      id: role.id, name: role.name, path: relative,
      chars: validation.chars, evidenceCount: validation.evidenceCount,
      ...(evidenceReview ? { evidenceReview } : {}),
      ok: Boolean(text) && validation.ok && referenceOk &&
        (options.evidenceReview ? evidenceReview?.ok === true : true),
      issues: text ? issues : ["尚未生成 output.md"]
    });
  }

  const complete = entries.every(entry => entry.ok);
  let generatedAt = new Date().toISOString();
  // 成稿没变时复用旧时间戳，重复运行 collect 不制造无意义的 diff。
  try {
    const previous = JSON.parse(await readFile(join(analysisDir, "manifest.json"), "utf8")) as CollectResult;
    if (previous.worldId === worldId && previous.complete === complete &&
        JSON.stringify(previous.entries) === JSON.stringify(entries)) {
      generatedAt = previous.generatedAt;
    }
  } catch { /* 尚无 manifest */ }
  const result: CollectResult = { worldId, generatedAt, entries, complete };
  await mkdir(analysisDir, { recursive: true });
  await writeFile(join(analysisDir, "manifest.json"), JSON.stringify(result, null, 2) + "\n", "utf8");

  const lines = [
    "# 多 Agent 文本分析结果",
    "",
    `世界：\`${worldId}\`；语料：\`original.txt\`（${index.totalLines} 行）。各 Agent 的分析成稿写入对应目录，输入包与校验规则见 \`PROTOCOL.md\`。`,
    "",
    "| Agent | 成稿 | 字数 | 证据行号 | 核验口径 | 语义核验 | 校验 |",
    "|---|---|---:|---:|---|---|---|"
  ];
  for (const entry of entries) {
    const role = ANALYSIS_ROLES.find(item => item.id === entry.id);
    const policy = role?.evidencePolicy === "proposal" ? "事实＋提案豁免" : "事实核验";
    const review = entry.evidenceReview ? entry.evidenceReview.supported + "/" + entry.evidenceReview.checked + " 句通过" : "未执行";
    lines.push(`| ${entry.name} | [\`${entry.id}/output.md\`](./${entry.id}/output.md) | ${entry.chars} | ${entry.evidenceCount} | ${policy} | ${review} | ${entry.ok ? "通过" : entry.issues.join("；")} |`);
  }
  lines.push("", result.complete
    ? (options.evidenceReview
      ? "全部角色已交稿并通过格式、证据密度与逐句语义核验。结论仍属工作记录，引用前按行号复核。"
      : "全部角色已交稿并通过格式、证据密度与引用行号校验。逐句事实核验可用 --evidence-review 开启；引用前仍应按行号复核。")
    : "存在未通过项，见上表；补齐后重新运行 `collect`。", "");
  await writeFile(join(analysisDir, "index.md"), lines.join("\n"), "utf8");
  return result;
}

export async function analysisStatus(worldId: string): Promise<string[]> {
  const analysisDir = resolve("analysis", worldId, "agent-analysis");
  const index = await loadChapterIndex(analysisDir);
  const lines: string[] = [];
  for (const role of ANALYSIS_ROLES) {
    const relative = `analysis/${worldId}/agent-analysis/${role.id}/output.md`;
    let text = "";
    try { text = await readFile(resolve(relative), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const validation = validateAnalysisOutput(text, index.totalLines);
    lines.push(`${role.id.padEnd(12)} ${text ? (validation.ok ? "OK     " : "CHECK  ") : "MISSING"}  ${validation.chars} 字 / ${validation.evidenceCount} 证据${validation.issues.length ? " / " + validation.issues.join("；") : ""}`);
  }
  return lines;
}
