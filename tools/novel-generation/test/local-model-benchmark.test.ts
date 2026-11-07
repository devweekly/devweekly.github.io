import test from "node:test";
import assert from "node:assert/strict";
import { collectEvidence, cosineSimilarity, evaluateExtraction, rankRetrieval } from "../src/local-model-benchmark.js";
test("extraction evaluation checks exact evidence grounding",()=>{const r=evaluateExtraction(JSON.stringify({characters:[{name:"甲",evidence:["他推开了门走进屋中","改写过的证据"]}]}),"他推开了门走进屋中。");assert.equal(r.jsonValid,true);assert.equal(r.evidenceCount,2);assert.equal(r.groundedEvidenceCount,1);assert.equal(r.evidenceIssueCount,1);});
test("invalid JSON is reported without throwing",()=>{assert.equal(evaluateExtraction("{bad","source").jsonValid,false);});
test("nested evidence arrays are collected",()=>{assert.deepEqual(collectEvidence({items:[{evidence:["引用"]}]}),[{path:"$.items.[0]evidence[0]",evidence:"引用"}]);});
test("cosine similarity and retrieval ranking are deterministic",()=>{assert.equal(cosineSimilarity([1,0],[1,0]),1);assert.equal(cosineSimilarity([1,0],[0,1]),0);const r=rankRetrieval([1,0],[[0,1],[1,0]],1);assert.equal(r.rank,1);assert.equal(r.top1,true);});
