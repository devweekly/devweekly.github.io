// 从本地全文 original.txt 生成可复现的卷/章索引与语料画像。
// 运行：node analysis/build-corpus-index.mjs
// 输入只读取本地文件，输出只写 analysis/conghuoniao/ 下的 JSON 与 Markdown。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const inputPath = resolve(root, "original.txt");
const outDir = join(root, "analysis", "conghuoniao");

const raw = await readFile(inputPath, "utf8");
const lines = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
const totalChars = raw.replace(/\s/g, "").length;

const CHAPTER = /^[ \t\u3000]*第([〇零一二三四五六七八九十百千万两0-9０-９]+)章[ \t\u3000]*(.*)$/;
const DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function cnToNumber(text) {
  if (/^[0-9０-９]+$/.test(text)) return Number(text.replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10)));
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const char of text) {
    if (char in DIGITS) digit = DIGITS[char];
    else if (char === "十") { section += (digit || 1) * 10; digit = 0; }
    else if (char === "百") { section += (digit || 1) * 100; digit = 0; }
    else if (char === "千") { section += (digit || 1) * 1000; digit = 0; }
    else if (char === "万") { total += (section + digit) * 10000; section = 0; digit = 0; }
    else return -1;
  }
  return total + section + digit;
}

const headings = [];
for (let i = 0; i < lines.length; i++) {
  const match = CHAPTER.exec(lines[i]);
  if (match) headings.push({ line: i + 1, number: cnToNumber(match[1]), title: lines[i].trim(), label: match[2].trim() });
}

// 章号重置为 1 视为新卷起点；卷之间还夹杂作者单章、卷末总结等非章节文本。
const volumeStarts = headings.filter(h => h.number === 1).map(h => h.line);
const volumes = [];
for (let v = 0; v < volumeStarts.length; v++) {
  const start = volumeStarts[v];
  const end = v + 1 < volumeStarts.length ? volumeStarts[v + 1] - 1 : lines.length;
  const chapters = headings.filter(h => h.line >= start && h.line <= end);
  const body = lines.slice(start - 1, end).join("\n");
  volumes.push({
    volume: v + 1,
    startLine: start,
    endLine: end,
    openingChapter: chapters[0]?.title ?? null,
    closingChapter: chapters[chapters.length - 1]?.title ?? null,
    chapterCount: chapters.length,
    chars: body.replace(/\s/g, "").length,
    chapters: chapters.map((h, index) => ({
      volume: v + 1,
      sequenceInVolume: index + 1,
      printedNumber: h.number,
      title: h.title,
      label: h.label,
      line: h.line
    }))
  });
}

// 卷间插入段：非章节、非空白、位于上一卷最后一章之后到下一卷首章之前。
const INTERLUDE = /总结|感言|单章|随笔|请假|通知|上架|封推|求票|说明/;
const interludes = [];
for (let v = 0; v < volumes.length; v++) {
  const volume = volumes[v];
  const lastChapterLine = volume.chapters[volume.chapters.length - 1]?.line ?? volume.startLine;
  for (let line = lastChapterLine + 1; line <= volume.endLine; line++) {
    const text = lines[line - 1].trim();
    if (text && text !== "------------" && INTERLUDE.test(text) && text.length < 60) {
      interludes.push({ beforeVolume: v + 1, line, text: text.slice(0, 60) });
    }
  }
}

const TERMS = [
  "阎浮行走", "阎浮果实", "阎浮事件", "阎浮点数", "觉醒度", "购买权限", "传承", "技能", "专精",
  "结算", "评价", "貘", "太岁", "姑获鸟", "睚眦", "龙虎气", "阎昭会", "十主", "代行者", "母冠",
  "思凡", "脱落者", "果实脱落", "忍土", "神庭", "天母", "李阎", "查小刀", "余束", "茱蒂", "丹娘",
  "郑秀", "赵剑中", "天保仔", "裴东升", "红旗帮", "九龙城寨", "壬辰", "大屿山"
];
const termFrequency = Object.fromEntries(
  TERMS.map(term => [term, raw.split(term).length - 1])
);

const FRUIT_CODE = /[天地人神鬼鳞羽毛介倮][·・][甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥][〇零一二三四五六七八九十百千万0-9]*/g;
const fruitCodes = Object.fromEntries(
  [...raw.matchAll(FRUIT_CODE)]
    .map(match => match[0])
    .reduce((map, code) => map.set(code, (map.get(code) ?? 0) + 1), new Map())
    .entries()
);

const publicSurvey = {
  surveyedAt: "2026-11-05",
  reportedTotalChapters: 787,
  firstVolumeTitlesFromPublicCatalog: 42,
  note: "公开目录调查与本地全文的章数差异保留为待核验项；本地全文末卷未完结，不能据公开总数推定缺失章节。"
};

const chapterIndex = {
  schemaVersion: 2,
  work: "从姑获鸟开始",
  author: "活儿该",
  sourceFile: "original.txt",
  sourceType: "user-provided local full text",
  sourceHash,
  generatedAt: new Date().toISOString(),
  totalLines: lines.length,
  totalChars,
  chapterCount: headings.length,
  volumeCount: volumes.length,
  volumeBoundaryRule: "章号重置为 1（含带缩进的标题行）；卷间作者单章与卷末总结不计入章节数",
  textCollected: true,
  publicSurvey,
  volumes
};

const profile = {
  schemaVersion: 1,
  generatedAt: chapterIndex.generatedAt,
  totalLines: lines.length,
  totalChars,
  chapterCount: headings.length,
  volumeCount: volumes.length,
  volumeCharDistribution: volumes.map(v => ({ volume: v.volume, chapters: v.chapterCount, chars: v.chars })),
  termFrequency,
  fruitCodeFrequency: Object.fromEntries(Object.entries(fruitCodes).sort((a, b) => b[1] - a[1])),
  interludes
};

const volumeLines = [
  "# 本地全文卷章结构",
  "",
  "由 `analysis/build-corpus-index.mjs` 从 `original.txt` 生成。章号按原文保留，作者修订、二合一与补章会造成同卷章号重复或跳号，属原文现象，不做补齐。",
  "",
  "| 卷 | 起始行 | 结束行 | 章数 | 字数 | 首章 | 末章 |",
  "|---:|---:|---:|---:|---:|---|---|"
];
for (const v of volumes) {
  volumeLines.push(`| ${v.volume} | ${v.startLine} | ${v.endLine} | ${v.chapterCount} | ${v.chars} | ${v.openingChapter} | ${v.closingChapter} |`);
}
volumeLines.push("", `合计：${volumes.length} 卷 / ${headings.length} 章 / ${totalChars.toLocaleString("en-US")} 字（不含空白）。`, "");

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "chapter-index.json"), JSON.stringify(chapterIndex, null, 2) + "\n", "utf8");
await writeFile(join(outDir, "corpus-profile.json"), JSON.stringify(profile, null, 2) + "\n", "utf8");
await writeFile(join(outDir, "volumes.md"), volumeLines.join("\n"), "utf8");
console.log(`Indexed ${volumes.length} volumes / ${headings.length} chapters / ${totalChars} chars.`);
