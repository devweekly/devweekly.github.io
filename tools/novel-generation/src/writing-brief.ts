// 把全书知识库（novel_* 表）压成一份可注入的写作事实包。
// 与分析参考不同：这里的内容是全书已经写成的事实，用于约束本章，不是创意建议。
import { listNovelBeats, listNovelCharacterProfiles, listNovelCharacters, listNovelForeshadowings, listNovelThreads } from "./database.js";
import {
  WRITING_BRIEF_ACTIVE_THREAD_BONUS,
  WRITING_BRIEF_ALIAS_LIMIT,
  WRITING_BRIEF_CLIP_LONG_CHARS,
  WRITING_BRIEF_CLIP_MEDIUM_CHARS,
  WRITING_BRIEF_CLIP_SHORT_CHARS,
  WRITING_BRIEF_DEFAULT_BEATS,
  WRITING_BRIEF_DEFAULT_CHARACTERS,
  WRITING_BRIEF_DEFAULT_FORESHADOWINGS,
  WRITING_BRIEF_DEFAULT_THREADS,
  WRITING_BRIEF_EXPLICIT_CLUE_BONUS,
  WRITING_BRIEF_MAX_CHARS,
  WRITING_BRIEF_NAME_HIT_SCORE,
  WRITING_BRIEF_QUERY_LIMIT_CHARACTERS,
  WRITING_BRIEF_QUERY_LIMIT_FORESHADOWINGS,
  WRITING_BRIEF_QUERY_LIMIT_THREADS,
  WRITING_BRIEF_SUSPENDED_THREAD_BONUS,
  WRITING_BRIEF_UNRESOLVED_LIMIT
} from "./constants.js";

export interface WritingBriefOptions {
  worldDir: string;
  worldId: string;
  /** 创作任务与场景指向。用它决定哪些人物、情节线与伏笔与本章相关。 */
  query: string;
  maxChars?: number;
  characterLimit?: number;
  threadLimit?: number;
  foreshadowingLimit?: number;
  beatLimit?: number;
}

const STOP_TERMS = new Set([
  "人物", "角色", "故事", "情节", "发展", "可能", "当前", "本章", "这一", "一个", "一些",
  "已经", "正在", "之后", "之前", "然后", "因此", "因为", "但是", "如果", "没有", "什么",
  "如何", "是否", "自己", "他们", "我们", "对方", "事情", "发生", "关系", "方面", "可以",
  "需要", "成为", "开始", "继续", "以及", "这个", "那个", "其中", "通过", "对于"
]);

/** 中文按二字词切，够用且不引入词典；英文与数字按整词。 */
export function briefTerms(text: string): Set<string> {
  const normalized = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const terms = new Set(normalized.split(/\s+/u).filter(token => token.length > 1 && !STOP_TERMS.has(token)));
  const compact = normalized.replace(/\s/gu, "");
  for (let i = 0; i < compact.length - 1; i++) {
    const pair = compact.slice(i, i + 2);
    if (!STOP_TERMS.has(pair)) terms.add(pair);
  }
  return terms;
}

function overlap(text: string, query: Set<string>): number {
  if (!text) return 0;
  const own = briefTerms(text);
  let score = 0;
  for (const term of query) {
    if (!own.has(term)) continue;
    score += term.length > 2 ? 2 : 1;
  }
  return score;
}

const clip = (text: string, max: number): string => {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length <= max ? value : value.slice(0, max) + "…";
};

const chapterLabel = (value: unknown): string => {
  const chapter = Number(value);
  return Number.isFinite(chapter) && chapter > 0 ? "第 " + chapter + " 章" : "章次未标注";
};

/**
 * 只挑与本次任务相关的人物、未收情节线、未回收伏笔，再补最近三章的既成事实。
 * 输出按字符上限截断，宁可少给也不挤掉正文上下文。
 */
export function buildWritingBrief(options: WritingBriefOptions): string {
  const query = briefTerms(options.query);
  if (!query.size) return "";
  const maxChars = options.maxChars ?? WRITING_BRIEF_MAX_CHARS;

  // 逐批抽取的原始观察太碎（主角动辄上百条），优先用合并档案描述人物。
  const profiles = listNovelCharacterProfiles(options.worldDir, options.worldId);
  const characters = listNovelCharacters(options.worldDir, options.worldId, { limit: WRITING_BRIEF_QUERY_LIMIT_CHARACTERS })
    .map(character => {
      const names = [character.name, ...character.aliases];
      // 名字出现在任务描述里，比任何词面重合都更能说明本章会写到这个人。
      const nameHit = names.reduce((best, name) => {
        const compact = name.replace(/\s/g, "");
        return compact.length > 1 && options.query.includes(compact) ? Math.max(best, WRITING_BRIEF_NAME_HIT_SCORE) : best;
      }, 0);
      const summary = profiles.get(character.name)?.summary ?? "";
      const textScore = overlap([character.role, character.bio, character.voice, summary].join(" "), query);
      return { character, summary, score: nameHit + textScore };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.character.mentionTotal - a.character.mentionTotal)
    .slice(0, options.characterLimit ?? WRITING_BRIEF_DEFAULT_CHARACTERS)
    .map(({ character, summary }) => {
      const aliases = character.aliases.length ? "（" + character.aliases.slice(0, WRITING_BRIEF_ALIAS_LIMIT).join("、") + "）" : "";
      // 有合并档案就用画像；否则退回 role——它是首次识别那一批的定位，不是当前处境。
      const gist = summary ? "｜" + clip(summary, WRITING_BRIEF_CLIP_LONG_CHARS) : character.role ? "｜" + clip(character.role, WRITING_BRIEF_CLIP_SHORT_CHARS) : "";
      return "- " + character.name + aliases + gist +
        "（出场 " + chapterLabel(character.firstChapter) + "–" + chapterLabel(character.lastChapter).replace("第 ", "") + "）";
    });

  type ThreadRow = { title: string; status: string; summary: string; firstChapter: number | null; lastChapter: number | null; keyTurns: string[]; unresolved: string[] };
  const threads = (listNovelThreads(options.worldDir, options.worldId, { limit: WRITING_BRIEF_QUERY_LIMIT_THREADS }) as unknown as ThreadRow[])
    .map(thread => {
      // 状态只是排序偏好，不是相关性：没有词面重合的线不能因为「进行中」就进包。
      const relevance = overlap([thread.title, thread.summary, thread.keyTurns.join(" ")].join(" "), query);
      return { thread, score: relevance > 0 ? relevance + (thread.status === "进行中" ? WRITING_BRIEF_ACTIVE_THREAD_BONUS : thread.status === "悬置" ? WRITING_BRIEF_SUSPENDED_THREAD_BONUS : 0) : 0 };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.threadLimit ?? WRITING_BRIEF_DEFAULT_THREADS)
    .map(({ thread }) => "- " + thread.title + "（" + thread.status + "，" +
      chapterLabel(thread.firstChapter) + "–" + chapterLabel(thread.lastChapter).replace("第 ", "") + "）：" +
      clip(thread.summary, WRITING_BRIEF_CLIP_LONG_CHARS) + (thread.unresolved.length ? "；未解：" + clip(thread.unresolved.slice(0, WRITING_BRIEF_UNRESOLVED_LIMIT).join("；"), WRITING_BRIEF_CLIP_SHORT_CHARS) : ""));

  type ClueRow = { clue: string; meaning: string; firstAppearance: string; status: string; confidence: string; chapterOrdinal: number | null };
  const foreshadowings = (listNovelForeshadowings(options.worldDir, options.worldId, { limit: WRITING_BRIEF_QUERY_LIMIT_FORESHADOWINGS }) as unknown as ClueRow[])
    .filter(item => item.status !== "已回收" && item.status !== "已收束")
    .map(item => {
      const relevance = overlap([item.clue, item.meaning, item.firstAppearance].join(" "), query);
      return { item, score: relevance > 0 ? relevance + (item.confidence === "明确线索" ? WRITING_BRIEF_EXPLICIT_CLUE_BONUS : 0) : 0 };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.foreshadowingLimit ?? WRITING_BRIEF_DEFAULT_FORESHADOWINGS)
    .map(({ item }) => "- " + clip(item.clue, WRITING_BRIEF_CLIP_SHORT_CHARS) + "（" + item.status + "／" + item.confidence + "，" +
      chapterLabel(item.chapterOrdinal) + "）：" + clip(item.meaning, WRITING_BRIEF_CLIP_MEDIUM_CHARS));

  const beats = listNovelBeats(options.worldDir, options.worldId, { limit: options.beatLimit ?? WRITING_BRIEF_DEFAULT_BEATS, latest: true })
    .reverse()
    .map(beat => "- " + chapterLabel(beat.chapterOrdinal) + "：" + clip(String(beat.summary), WRITING_BRIEF_CLIP_LONG_CHARS));

  const sections = [
    characters.length ? "### 相关人物（跨卷画像；当前处境以故事状态为准）\n" + characters.join("\n") : "",
    threads.length ? "### 仍未收的情节线\n" + threads.join("\n") : "",
    foreshadowings.length ? "### 可用伏笔（未回收）\n" + foreshadowings.join("\n") : "",
    beats.length ? "### 时间线锚点（全书最近既成事实）\n" + beats.join("\n") : ""
  ].filter(Boolean);
  if (!sections.length) return "";

  const header = [
    "以下内容来自全书知识库，是已经写成的事实与仍未收的线，不是创意建议。",
    "人物条目是跨卷合并后的画像，可能停留在某一卷的判断上；人物此刻的位置、能力与知情范围以故事状态为准。",
    "与本次创作冲突时以这里的事实为准；可以承接、回避或改造未收线，但不得把已写明的事当成没发生。"
  ].join("\n");
  const body = header + "\n\n" + sections.join("\n\n");
  return body.length > maxChars ? body.slice(0, maxChars) + "\n\n（事实包已按长度截断；缺项请用 story-kb 查询核对。）" : body;
}
