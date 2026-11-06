import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { runAgentText } from "./generate.js";
import { parseJsonObject } from "./model-json.js";
import { readTaskProfiles } from "./task-profiles.js";
import type { StoryState } from "./story-state.js";

const MilestoneSchema=z.object({id:z.string().min(1),title:z.string().min(1),purpose:z.string().min(1),turningPoint:z.string().default(""),consequence:z.string().default(""),status:z.enum(["planned","reached","revised","deferred"]).default("planned")}).strict();
const ThreadSchema=z.object({id:z.string().min(1),title:z.string().min(1),goal:z.string().default(""),stakes:z.string().default(""),currentPressure:z.string().default(""),nextPossibilities:z.array(z.string()).default([]),status:z.enum(["planned","active","paused","resolved"]).default("planned")}).strict();
const BodySchema=z.object({corePremise:z.string().min(1),centralConflict:z.string().min(1),protagonistLongTermGoal:z.string().min(1),stakes:z.array(z.string()).default([]),endDirection:z.string().min(1),majorMilestones:z.array(MilestoneSchema).max(30).default([]),longTermThreads:z.array(ThreadSchema).max(30).default([]),revealPlan:z.array(z.string()).default([]),constraints:z.array(z.string()).default([]),openQuestions:z.array(z.string()).default([]),revisionNotes:z.array(z.string()).default([])}).strict();
const PlanSchema=BodySchema.extend({schemaVersion:z.literal(1),worldId:z.string().min(1),status:z.enum(["draft","active"]),updatedAt:z.string().min(1)}).strict();
export type StoryPlan=z.infer<typeof PlanSchema>;
export function validateStoryPlan(value:unknown,worldId?:string):StoryPlan{const plan=PlanSchema.parse(value);if(worldId&&plan.worldId!==worldId)throw new Error("Story plan world mismatch: expected "+worldId+", found "+plan.worldId);return plan;}
export async function loadStoryPlan(path:string,worldId:string):Promise<StoryPlan|undefined>{try{return validateStoryPlan(JSON.parse(await readFile(path,"utf8")) as unknown,worldId);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}}
export async function saveStoryPlan(path:string,plan:StoryPlan):Promise<void>{const valid=validateStoryPlan(plan,plan.worldId);await mkdir(dirname(path),{recursive:true});const tmp=path+".tmp";await writeFile(tmp,JSON.stringify(valid,null,2)+"\n","utf8");await rename(tmp,path);}
export function formatStoryPlan(plan:StoryPlan|undefined):string{
 if(!plan||plan.status!=="active")return "";
 return ["长期主线（作者确认的方向性规划；不是已经发生的事实，也不是逐章任务清单）：","核心构想："+plan.corePremise,"核心矛盾："+plan.centralConflict,"主角长期目标："+plan.protagonistLongTermGoal,"失败代价："+(plan.stakes.join("；")||"未限定"),"最终方向："+plan.endDirection,
 plan.majorMilestones.length?"关键节点（未来方向，以实际故事状态为准）："+plan.majorMilestones.map(x=>`[${x.status}] ${x.title}：${x.purpose}${x.turningPoint?"；转折："+x.turningPoint:""}${x.consequence?"；影响："+x.consequence:""}`).join("\n"):"",
 plan.longTermThreads.length?"长期剧情线："+plan.longTermThreads.map(x=>`[${x.status}] ${x.title}：目标 ${x.goal}；利害 ${x.stakes}；当前压力 ${x.currentPressure}；可选发展 ${x.nextPossibilities.join(" / ")}`).join("\n"):"",
 plan.revealPlan.length?"秘密与揭示方向："+plan.revealPlan.join("；"):"",plan.constraints.length?"核心约束："+plan.constraints.join("；"):"",plan.openQuestions.length?"尚未决定的问题："+plan.openQuestions.join("；"):"",
 "执行原则：主线提供长期方向，不要求每章都显式推进主线；允许日常、支线、人物关系和局部故事形成完整体验。新剧情可以改变未来路径，但不得篡改已经发生的事实。若当前故事状态与规划冲突，以已发生事实为准，并把调整留给未来规划，不要强行 retcon。"].filter(Boolean).join("\n");
}
export async function generateStoryPlan(input:{worldId:string;worldBible:string;state:StoryState;storyAnalysisContext?:string;previousPlan?:StoryPlan;model?:string}):Promise<StoryPlan>{
 const prompt=["角色：长篇网络小说总纲架构师。建立或修订全书长期主线，不写章节正文，不生成逐章大纲。","只输出 JSON 对象，不要 Markdown。字段："+JSON.stringify({corePremise:"string",centralConflict:"string",protagonistLongTermGoal:"string",stakes:["string"],endDirection:"string",majorMilestones:[{id:"stable-id",title:"string",purpose:"string",turningPoint:"string",consequence:"string",status:"planned"}],longTermThreads:[{id:"stable-id",title:"string",goal:"string",stakes:"string",currentPressure:"string",nextPossibilities:["string"],status:"planned"}],revealPlan:["string"],constraints:["string"],openQuestions:["string"],revisionNotes:["string"]},null,2),
 "规划原则：主线回答故事长期讲什么、核心矛盾、主角长期目标、失败代价和最终方向。节点只规划重大转折，不固定未来几万字的场景或每章事件。只保留真正有因果联系的长期剧情线，说明目标、利害和当前压力。主线与支线通过人物选择、事件后果和信息揭示互相影响；允许卷级/单元故事闭环，不要求每章推进主线。区分已发生事实、原文推断和未来创作方向。以当前故事状态为准，不得为迁就旧规划篡改已发生事实。不要凭空发明秘密、伏笔或宏大阴谋；不确定内容放入 openQuestions。避免空泛口号。",
 "世界设定：",input.worldBible,"当前故事状态（已发生事实优先）：",JSON.stringify(input.state,null,2),input.storyAnalysisContext?"全书语料分析（只作参考，可能包含推断）：\n"+input.storyAnalysisContext:"尚无可用的全书语料分析。",input.previousPlan?"上一版规划（保留仍成立的方向和稳定 ID，必要时修订）：\n"+JSON.stringify(input.previousPlan,null,2):"首次建立长期主线。","生成可直接生效、供后续章节创作参考的完整规划；规划是方向性参考，不是逐章任务清单。"].join("\n\n");
 const raw=await runAgentText(prompt,input.model,180000,readTaskProfiles().plot,true);
 return PlanSchema.parse({...BodySchema.parse(parseJsonObject(raw)),schemaVersion:1,worldId:input.worldId,status:"draft",updatedAt:new Date().toISOString()});
}
