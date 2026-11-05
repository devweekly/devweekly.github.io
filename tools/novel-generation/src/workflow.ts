import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadStoryState, saveStoryState, type StoryState } from "./story-state.js";
import { runAgentText, type GenerationMode } from "./generate.js";

export interface WriteWorkflowInput {
  worldId: string;
  mode: GenerationMode;
  brief: string;
  worldBible: string;
  sourceText?: string;
  contextText?: string;
  retrievedContext?: string;
  model?: string;
  maxWords: number;
  outputDir: string;
  statePath: string;
}


function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return a JSON object for story-state update.");
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

function mergeState(current: StoryState, update: Partial<StoryState>): StoryState {
  const mergeBy = <T extends object>(oldItems: T[], newItems: T[], key: (item: T) => string): T[] => {
    const map = new Map(oldItems.map(item => [key(item), item]));
    for (const item of newItems) {
      const id = key(item);
      const previous = map.get(id);
      if (previous && typeof previous === "object" && typeof item === "object") {
        const merged = { ...(previous as unknown as Record<string, unknown>), ...(item as unknown as Record<string, unknown>) };
        for (const [field, value] of Object.entries(item as unknown as Record<string, unknown>)) {
          const priorValue = (previous as unknown as Record<string, unknown>)[field];
          if (Array.isArray(value)) {
            merged[field] = [...new Set([...(Array.isArray(priorValue) ? priorValue : []), ...value])];
          }
        }
        map.set(id, merged as unknown as T);
      } else {
        map.set(id, item);
      }
    }
    return [...map.values()];
  };
  return {
    ...current,
    currentPosition: update.currentPosition || current.currentPosition,
    canonFacts: mergeBy(current.canonFacts, update.canonFacts ?? [], item => item.id),
    characters: mergeBy(current.characters, update.characters ?? [], item => item.name),
    events: mergeBy(current.events, update.events ?? [], item => item.id),
    plotThreads: mergeBy(current.plotThreads, update.plotThreads ?? [], item => item.id),
    continuityNotes: [...new Set([...current.continuityNotes, ...(update.continuityNotes ?? [])])],
    updatedAt: new Date().toISOString()
  };
}

export async function writeChapter(input: WriteWorkflowInput): Promise<string> {
  const state = await loadStoryState(input.statePath, input.worldId);
  await mkdir(input.outputDir, { recursive: true });
  if (input.retrievedContext) await writeFile(resolve(input.outputDir, "00-retrieval.md"), input.retrievedContext + "\n", "utf8");

  const common = [
    "世界设定：", input.worldBible,
    "当前故事状态（已有记录优先；不得擅自改写已确认事实）：", JSON.stringify(state, null, 2),
    input.contextText ? "用户补充的前文摘要：\n" + input.contextText : "",
    input.retrievedContext ? "从本地小说资料库检索到的相关原文片段（仅作为事实证据，不得整段复制）：\n" + input.retrievedContext : "",
    input.sourceText ? "用户提供且有权使用的续写材料：\n" + input.sourceText : "",
    input.mode === "continuation" ? "创作模式：续写。严格承接用户提供的合法文本和当前故事状态。" : "创作模式：原创衍生。不得把项目原创内容伪装成原著事实。",
    "本次创作任务：", input.brief
  ].filter(Boolean).join("\n\n");

  const plan = await runAgentText([
    "你是长篇小说的故事策划编辑。请输出可直接执行的章节计划，而不是文学评论。",
    common,
    "规划应明确：本章目标、场景顺序、每场景的视角/人物/地点/冲突/信息揭示/结果、人物选择及代价、与既有情节线的关系、结尾状态。不得为了制造反转破坏已知事实。"
  ].join("\n\n"), input.model);
  await writeFile(resolve(input.outputDir, "01-plan.md"), plan + "\n", "utf8");

  const draft = await runAgentText([
    "你是中文类型小说创作者。根据章节计划写出完整正文，不要输出分析或计划。",
    common, "章节计划：", plan,
    "目标篇幅约 " + input.maxWords + " 个中文字符。以完整场景、人物行动、对话和因果推进为准。避免设定说明堆积和重复表达。"
  ].join("\n\n"), input.model);
  await writeFile(resolve(input.outputDir, "02-draft.md"), draft + "\n", "utf8");

  const review = await runAgentText([
    "你是严格的长篇小说责任编辑。只审查这份章节，不要重写。",
    common, "章节计划：", plan, "章节正文：", draft,
    "按以下维度给出具体问题及证据：连续性、人物动机、世界规则、因果、节奏、场景清晰度、对话自然度、情节推进、未兑现铺垫。区分确定错误与主观建议。最后给出必须修改项清单；没有问题则明确说明。"
  ].join("\n\n"), input.model);
  await writeFile(resolve(input.outputDir, "03-review.md"), review + "\n", "utf8");

  const chapter = await runAgentText([
    "你是小说作者。根据审查意见修订正文，只输出最终小说正文。",
    common, "原章节计划：", plan, "初稿：", draft, "编辑审查意见：", review,
    "修订时优先解决事实冲突、人物行为不一致和因果断裂；不要为了满足意见而机械扩写。保持完整章节。"
  ].join("\n\n"), input.model);
  await writeFile(resolve(input.outputDir, "chapter.md"), chapter + "\n", "utf8");

  const stateText = await runAgentText([
    "你是小说连续性资料管理员。根据旧状态和最终章节，提取本章造成的状态变化。",
    "只输出合法 JSON 对象，不要 Markdown 代码围栏。结构：",
    JSON.stringify({
      currentPosition: "string",
      canonFacts: [{ id: "stable-id", fact: "fact", source: "chapter id", confidence: "confirmed|inferred|original" }],
      characters: [{ name: "name", status: "current status", location: "optional", abilities: ["only changed/new known abilities"], knowledge: ["new knowledge"], goals: ["current goals"], relationships: ["changed relationships"] }],
      events: [{ id: "stable-id", summary: "event", position: "story position", participants: ["name"], consequences: ["consequence"] }],
      plotThreads: [{ id: "stable-id", title: "thread", status: "open|active|resolved|abandoned", lastUpdated: "chapter id", notes: "latest state" }],
      continuityNotes: ["facts future chapters must preserve"]
    }, null, 2),
    "旧状态：", JSON.stringify(state, null, 2), "最终章节：", chapter,
    "只记录章节明确支持的内容。无法确认的内容不要写入 canonFacts；推断必须标为 inferred。人物和情节线只输出本章新增或发生变化的记录。"
  ].join("\n\n"), input.model);

  try {
    const update = extractJson(stateText) as Partial<StoryState>;
    const nextState = mergeState(state, update);
    await saveStoryState(input.statePath, nextState);
    await writeFile(resolve(input.outputDir, "04-state-update.json"), JSON.stringify(nextState, null, 2) + "\n", "utf8");
  } catch (error) {
    await writeFile(resolve(input.outputDir, "04-state-update-error.txt"), String(error) + "\n\n" + stateText, "utf8");
    throw new Error("Chapter was generated, but story-state update failed. See 04-state-update-error.txt; do not start the next chapter until reconciled.");
  }

  return chapter;
}
