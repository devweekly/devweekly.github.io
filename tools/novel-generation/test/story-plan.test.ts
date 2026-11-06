import test from "node:test";
import assert from "node:assert/strict";
import {formatStoryPlan,validateStoryPlan} from "../src/story-plan.js";
const plan={schemaVersion:1 as const,worldId:"test-world",status:"active" as const,updatedAt:"2026-11-06T00:00:00.000Z",corePremise:"追查世界异变",centralConflict:"生存与秩序",protagonistLongTermGoal:"找到根源",stakes:["失去同伴"],endDirection:"面对逃避的选择",majorMilestones:[{id:"reveal",title:"发现来源",purpose:"改变认知",turningPoint:"证据指向过去",consequence:"调查转向",status:"planned" as const}],longTermThreads:[{id:"faction",title:"势力争夺",goal:"控制线索",stakes:"城市存亡",currentPressure:"争夺升级",nextPossibilities:["结盟","冲突"],status:"active" as const}],revealPlan:["异变关联旧文明"],constraints:["主角未知真相"],openQuestions:["旧文明为何消失"],revisionNotes:[]};
test("validates plan schema and world identity",()=>{assert.equal(validateStoryPlan(plan,"test-world").majorMilestones.length,1);assert.throws(()=>validateStoryPlan(plan,"other"));assert.throws(()=>validateStoryPlan({...plan,unexpected:true}));});
test("renders active plan as directional context",()=>{const text=formatStoryPlan(plan);assert.match(text,/不是已经发生的事实/);assert.match(text,/不要求每章都显式推进主线/);assert.match(text,/以已发生事实为准/);});
test("does not inject draft plans",()=>{assert.equal(formatStoryPlan({...plan,status:"draft"}),"");});
