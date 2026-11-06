import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  deleteNovelCharacterProfiles, listNovelCharacterObservations, listNovelCharacterProfiles, syncNovelCharacterProfiles,
  type NovelCharacterObservationRow, type NovelCharacterProfileRow
} from "./database.js";
import { runAgentText } from "./generate.js";
import {
  PROFILE_ANALYSIS_DEFAULT_TIMEOUT_MS,
  PROFILE_DEFAULT_TOP,
  PROFILE_OUTPUT_ARC_LIMIT,
  PROFILE_OUTPUT_CONTRADICTIONS_LIMIT,
  PROFILE_OUTPUT_STAGES_LIMIT,
  PROFILE_OUTPUT_TRAITS_LIMIT,
  PROFILE_PROMPT_ALIAS_LIMIT,
  PROFILE_SAMPLE_DEFAULT,
  PROFILE_SAMPLE_PERSONALITY
} from "./constants.js";
import { parseJsonObject } from "./model-json.js";
import { readTaskProfiles } from "./task-profiles.js";

/** 提示词或采样口径变了就换缓存键，避免复用旧档案。 */
export const PROFILE_PROMPT_VERSION = 1;

/** 少于这个数就不合并：信息量不足时模型会靠常识补全。 */
export const MIN_OBSERVATIONS = 4;

const stringList = z.preprocess(value => {
  if (Array.isArray(value)) return value.map(item => typeof item === "string" ? item : JSON.stringify(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}, z.array(z.string())).default([]);

const ProfileSchema = z.object({
  summary: z.string().default(""),
  stages: stringList,
  traits: stringList,
  contradictions: stringList,
  arc: stringList
});

/**
 * 逐批抽取的观察按章节顺序堆叠，首尾信息量最大（初次登场与最新状态）。
 * 超过上限时保留首尾各四分之一，中间等距取样，避免只留下开头几卷。
 */
export function sampleChronologically<T>(items: T[], limit: number): T[] {
  if (limit <= 0) return [];
  if (items.length <= limit) return items.slice();
  const edge = Math.max(1, Math.floor(limit / 4));
  const middle = limit - edge * 2;
  const result = items.slice(0, edge);
  const rest = items.slice(edge, items.length - edge);
  if (middle > 0 && rest.length) {
    for (let index = 0; index < middle; index++) {
      const position = Math.min(rest.length - 1, Math.floor((index + 0.5) * rest.length / middle));
      result.push(rest[position] as T);
    }
  }
  return [...result, ...items.slice(items.length - edge)];
}

export interface ProfilePromptInput {
  name: string;
  aliases: string[];
  role: string;
  bio: string;
  firstChapter: number | null;
  lastChapter: number | null;
  observations: { personality: string[]; desires: string[]; contradictions: string[]; arc: string[] };
  totals: { personality: number; desires: number; contradictions: number; arc: number };
}

/**
 * 逐批抽取的结果是同一个人在不同阶段的多次描述，不是重复条目：
 * 实测 193 条性格描述两两相似度都低于 0.6，去重去不掉，只能合并。
 */
export function buildProfilePrompt(input: ProfilePromptInput): string {
  const span = (input.firstChapter === null ? "未知" : "第 " + input.firstChapter + " 章") +
    " – " + (input.lastChapter === null ? "未知" : "第 " + input.lastChapter + " 章");
  return [
    "你在整理一部长篇小说的人物档案。下面这些描述来自逐批阅读，" +
      "每一批只看到几章，所以同一个人在不同批次里被反复描述，措辞各异，角度也不同。",
    "任务：把它们合并成一份档案，保留前后变化，不要简单堆叠标签，也不要引入原文没有的内容。",
    "",
    "人物：" + input.name + (input.aliases.length ? "（又称：" + input.aliases.slice(0, PROFILE_PROMPT_ALIAS_LIMIT).join("、") + "）" : ""),
    "出场范围：" + span,
    "首次识别到的身份作用：" + (input.role || "未标注"),
    "初次小传：" + (input.bio || "未标注"),
    "",
    "原始观察（采样自 " + input.totals.personality + "/" + input.totals.desires + "/" +
      input.totals.contradictions + "/" + input.totals.arc + " 条性格/欲望/矛盾/走向，按章节顺序）：",
    JSON.stringify({
      personality: input.observations.personality,
      desires: input.observations.desires,
      contradictions: input.observations.contradictions,
      arc: input.observations.arc
    }, null, 1),
    "",
    "输出要求：",
    "1. summary：150–250 字画像。写他实际怎么做事、对谁不一样、哪一点前后变了；不要用「性格复杂」「亦正亦邪」这类空话。",
    "2. stages：3–5 条阶段性变化，每条写「早期/中期/后期：……」，只写观察里确实出现的转变。",
    "3. traits：3–6 条稳定的性格特征，每条一句话，带一个具体行为作证据。",
    "4. contradictions：3–6 条内在矛盾，写成「一边……一边……」的对立，不要写成优缺点列表。",
    "5. arc：3–5 条可能的走向，标注「可能」；这是创作参考，不是既定剧情。",
    "6. 观察之间冲突时保留冲突，不要强行调停；无法判断的宁可不写。",
    "只输出 JSON：{summary:string,stages:string[],traits:string[],contradictions:string[],arc:string[]}",
    "不要 Markdown、不要解释、不要额外字段。"
  ].join("\n");
}

export interface CharacterProfileBuildOptions {
  worldDir: string;
  model?: string;
  top?: number;
  timeoutMs?: number;
  force?: boolean;
  outputDir?: string;
  /** 只重建指定人物，便于抽查。 */
  names?: string[];
}

function cacheKey(input: ProfilePromptInput, model: string): string {
  return createHash("sha256").update(JSON.stringify({
    version: PROFILE_PROMPT_VERSION, model, name: input.name,
    totals: input.totals,
    sample: input.observations
  })).digest("hex");
}

export interface CharacterProfileResult {
  profiles: NovelCharacterProfileRow[];
  generated: number;
  cached: number;
  failed: string[];
  /** 观察太少，合并只能靠猜，直接跳过。 */
  skipped: string[];
}

export async function buildCharacterProfiles(worldId: string, options: CharacterProfileBuildOptions): Promise<CharacterProfileResult> {
  const worldDir = options.worldDir;
  const outputDir = options.outputDir ?? resolve(".output", worldId, "character-profiles");
  const model = options.model ?? "";
  const profile = readTaskProfiles().plan;
  const existing = options.force ? new Map<string, NovelCharacterProfileRow>() : listNovelCharacterProfiles(worldDir, worldId);
  const wanted = options.names?.length ? new Set(options.names) : undefined;

  const observations = listNovelCharacterObservations(worldDir, worldId, { limit: options.top ?? PROFILE_DEFAULT_TOP })
    .filter(character => !wanted || wanted.has(character.name));

  const results: NovelCharacterProfileRow[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  let generated = 0;
  let cached = 0;

  for (const character of observations) {
    const totalObservations = character.personality.length + character.desires.length +
      character.contradictions.length + character.arc.length;
    // 只有身份和一句小传时，合并出来的「画像」全是模型补的，不如不写。
    if (totalObservations < MIN_OBSERVATIONS) { skipped.push(character.name); continue; }
    const input = toPromptInput(character);
    const key = cacheKey(input, model);
    const dir = join(outputDir, key);
    const path = join(dir, character.characterId + ".json");
    let parsed = await readCached(path);
    if (parsed) {
      cached++;
      console.log("[character-profile] " + character.name + " · cache hit");
    } else if (existing.has(character.name) && !options.force) {
      // 已有档案且输入没变时，缓存键不会命中（键包含采样内容），
      // 这种情况直接沿用库里的结果，不重复花钱。
      cached++;
      results.push(existing.get(character.name) as NovelCharacterProfileRow);
      continue;
    } else {
      console.log("[character-profile] " + character.name + " · " + character.personality.length + " 条原始观察");
      // 观察多的时候模型容易写到一半被截断；失败就减半采样再问一次，而不是整条放弃。
      const attempts: ProfilePromptInput[] = [input, toPromptInput(character, 0.5)];
      let lastError: unknown;
      for (const [index, candidate] of attempts.entries()) {
        try {
          const raw = await runAgentText(buildProfilePrompt(candidate), options.model, options.timeoutMs ?? PROFILE_ANALYSIS_DEFAULT_TIMEOUT_MS, profile);
          parsed = ProfileSchema.parse(parseJsonObject(raw));
          if (index > 0) console.warn("[character-profile] " + character.name + " 减半采样后成功");
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!parsed) {
        failed.push(character.name);
        console.warn("[character-profile] " + character.name + " 输出无效：" + (lastError instanceof Error ? lastError.message : String(lastError)));
        continue;
      }
      await mkdir(dir, { recursive: true });
      const temporary = path + ".tmp";
      await writeFile(temporary, JSON.stringify(parsed, null, 2) + "\n", "utf8");
      await rename(temporary, path);
      generated++;
    }
    results.push({
      characterId: character.characterId,
      name: character.name,
      summary: parsed.summary.trim(),
      stages: parsed.stages.slice(0, PROFILE_OUTPUT_STAGES_LIMIT),
      traits: parsed.traits.slice(0, PROFILE_OUTPUT_TRAITS_LIMIT),
      contradictions: parsed.contradictions.slice(0, PROFILE_OUTPUT_CONTRADICTIONS_LIMIT),
      arc: parsed.arc.slice(0, PROFILE_OUTPUT_ARC_LIMIT),
      observationCount: character.personality.length + character.desires.length + character.contradictions.length + character.arc.length,
      model: model || "default",
      generatedAt: new Date().toISOString()
    });
  }

  const usable = results.filter(item => item.summary);
  if (usable.length) syncNovelCharacterProfiles(worldDir, worldId, usable);
  // 之前生成过、这次观察数掉到阈值以下的，档案要一并清掉，避免留下过期版本。
  if (skipped.length) deleteNovelCharacterProfiles(worldDir, worldId, skipped);
  return { profiles: usable, generated, cached, failed, skipped };
}

function toPromptInput(character: NovelCharacterObservationRow, scale = 1): ProfilePromptInput {
  const size = (base: number) => Math.max(2, Math.round(base * scale));
  return {
    name: character.name,
    aliases: character.aliases,
    role: character.role,
    bio: character.bio,
    firstChapter: character.firstChapter,
    lastChapter: character.lastChapter,
    observations: {
      personality: sampleChronologically(character.personality, size(PROFILE_SAMPLE_PERSONALITY)),
      desires: sampleChronologically(character.desires, size(PROFILE_SAMPLE_DEFAULT)),
      contradictions: sampleChronologically(character.contradictions, size(PROFILE_SAMPLE_DEFAULT)),
      arc: sampleChronologically(character.arc, size(PROFILE_SAMPLE_DEFAULT))
    },
    totals: {
      personality: character.personality.length,
      desires: character.desires.length,
      contradictions: character.contradictions.length,
      arc: character.arc.length
    }
  };
}

async function readCached(path: string): Promise<z.infer<typeof ProfileSchema> | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = ProfileSchema.safeParse(JSON.parse(await readFile(path, "utf8")) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
