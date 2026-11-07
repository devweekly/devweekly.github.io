export function collectEvidence(value: unknown, path = "$."): Array<{path:string;evidence:string}> {
  const found: Array<{path:string;evidence:string}> = [];
  if (Array.isArray(value)) value.forEach((item,index)=>found.push(...collectEvidence(item,path+"["+index+"]")));
  else if (value && typeof value === "object") for (const [key,item] of Object.entries(value as Record<string,unknown>)) {
    if (key.toLowerCase().includes("evidence") && Array.isArray(item)) item.forEach((entry,index)=>{ if(typeof entry==="string"&&entry.trim())found.push({path:path+key+"["+index+"]",evidence:entry.trim()}); });
    else found.push(...collectEvidence(item,path+key+"."));
  }
  return found;
}
export function evaluateExtraction(raw:string,source:string):Record<string,unknown>{
  let parsed:unknown; try{parsed=JSON.parse(raw);}catch(error){return {jsonValid:false,parseError:error instanceof Error?error.message:String(error),outputChars:raw.length};}
  const evidence=collectEvidence(parsed),issues:Array<{path:string;evidence:string;reason:string}>=[];let grounded=0;
  for(const item of evidence){if(item.evidence.length<4)issues.push({...item,reason:"too_short"});else if(source.includes(item.evidence))grounded++;else issues.push({...item,reason:"not_exact_source_text"});}
  const root=parsed&&typeof parsed==="object"?parsed as Record<string,unknown>:{};const count=(key:string)=>Array.isArray(root[key])?(root[key] as unknown[]).length:0;
  return {jsonValid:true,outputChars:raw.length,evidenceCount:evidence.length,groundedEvidenceCount:grounded,evidenceIssueCount:issues.length,evidenceGroundingRate:evidence.length?Number((grounded/evidence.length).toFixed(4)):null,characterCount:count("characters"),eventCount:count("events"),relationshipCount:count("relationships"),sceneCount:count("scenes"),evidenceIssues:issues};
}
export function cosineSimilarity(a:number[],b:number[]):number{if(!a.length||a.length!==b.length)throw new Error("Embedding dimensions do not match.");let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){const x=a[i]??0,y=b[i]??0;dot+=x*y;aa+=x*x;bb+=y*y;}return aa===0||bb===0?0:dot/(Math.sqrt(aa)*Math.sqrt(bb));}
export function rankRetrieval(query:number[],docs:number[][],target:number){const ranked=docs.map((v,index)=>({index,score:cosineSimilarity(query,v)})).sort((a,b)=>b.score-a.score);const rank=ranked.findIndex(x=>x.index===target)+1;return {rank,reciprocalRank:rank?1/rank:0,top1:rank===1,targetSimilarity:ranked.find(x=>x.index===target)?.score??0};}
