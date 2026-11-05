import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { searchLibrary } from "./library.js";

export interface AnalysisRole {
  id: string;
  name: string;
  mission: string;
  query: string;
  focusVolumes: number[];
  lineRanges: Array<[number, number]>;
  rangeNotes: string[];
  questions: string[];
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
  }
];

interface VolumeSummary {
  volume: number;
  startLine: number;
  endLine: number;
  chapterCount: number;
  openingChapter: string;
  closingChapter: string;
}

interface ChapterIndexFile {
  totalLines: number;
  volumes: VolumeSummary[];
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
  if (chars < 600) issues.push(`正文过短（${chars} 字，要求至少 600 字）`);
  if (references.length < 6) issues.push(`证据行号不足（${references.length} 处，要求至少 6 处）`);
  if (!/^##\s/m.test(text)) issues.push("缺少二级标题");
  if (/TODO|待补|占位|待填/.test(text)) issues.push("残留占位文字");
  const invalid = references.filter(line => line < 1 || line > totalLines);
  if (invalid.length) issues.push(`行号越界：${invalid.slice(0, 5).join("、")}`);
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
  const parsed = JSON.parse(await readFile(path, "utf8")) as ChapterIndexFile;
  if (!parsed.totalLines || !Array.isArray(parsed.volumes)) throw new Error("Invalid chapter index: " + path);
  return parsed;
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
  ok: boolean;
  issues: string[];
}

export interface CollectResult {
  worldId: string;
  generatedAt: string;
  entries: CollectEntry[];
  complete: boolean;
}

export async function collectWorldAnalysis(worldId: string): Promise<CollectResult> {
  const analysisDir = resolve("analysis", worldId, "agent-analysis");
  const index = await loadChapterIndex(analysisDir);
  const entries: CollectEntry[] = [];

  for (const role of ANALYSIS_ROLES) {
    const relative = `analysis/${worldId}/agent-analysis/${role.id}/output.md`;
    let text = "";
    try { text = await readFile(resolve(relative), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const validation = validateAnalysisOutput(text, index.totalLines);
    entries.push({
      id: role.id, name: role.name, path: relative,
      chars: validation.chars, evidenceCount: validation.evidenceCount,
      ok: text ? validation.ok : false,
      issues: text ? validation.issues : ["尚未生成 output.md"]
    });
  }

  const result: CollectResult = {
    worldId, generatedAt: new Date().toISOString(),
    entries, complete: entries.every(entry => entry.ok)
  };
  await mkdir(analysisDir, { recursive: true });
  await writeFile(join(analysisDir, "manifest.json"), JSON.stringify(result, null, 2) + "\n", "utf8");

  const lines = [
    "# 多 Agent 文本分析结果",
    "",
    `世界：\`${worldId}\`；语料：\`original.txt\`（${index.totalLines} 行）。各 Agent 的分析成稿写入对应目录，输入包与校验规则见 \`PROTOCOL.md\`。`,
    "",
    "| Agent | 成稿 | 字数 | 证据行号 | 校验 |",
    "|---|---|---:|---:|---|"
  ];
  for (const entry of entries) {
    lines.push(`| ${entry.name} | [\`${entry.id}/output.md\`](./${entry.id}/output.md) | ${entry.chars} | ${entry.evidenceCount} | ${entry.ok ? "通过" : entry.issues.join("；")} |`);
  }
  lines.push("", result.complete
    ? "全部角色已交稿并通过格式与证据密度校验。结论仍属工作记录，引用前按行号复核。"
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
