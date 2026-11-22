import type { Bootstrap, WorkItemDetail } from "./types";
let currentActor = "u-sa";
export function setActor(actor:string) { currentActor=actor; }
async function request<T>(path:string,init:RequestInit={}):Promise<T> {
  const response=await fetch(path,{...init,headers:{"Content-Type":"application/json","x-demo-user-id":currentActor,...(init.headers || {})}});
  const payload=await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(payload.error || ("Request failed: "+response.status));
  return payload as T;
}
export const api = {
  bootstrap:()=>request<Bootstrap>("/api/bootstrap"),
  detail:(id:string)=>request<WorkItemDetail>("/api/work-items/"+id),
  createWorkItem:(body:unknown)=>request<{id:string;code:string}>("/api/work-items",{method:"POST",body:JSON.stringify(body)}),
  createArtifact:(id:string,body:unknown)=>request<{id:string;version:number}>("/api/work-items/"+id+"/artifacts",{method:"POST",body:JSON.stringify(body)}),
  createReview:(id:string,body:unknown)=>request<{id:string}>("/api/work-items/"+id+"/reviews",{method:"POST",body:JSON.stringify(body)}),
  createTask:(id:string,body:unknown)=>request<{id:string}>("/api/work-items/"+id+"/tasks",{method:"POST",body:JSON.stringify(body)}),
  updateTask:(id:string,body:unknown)=>request<{ok:boolean}>("/api/tasks/"+id,{method:"PATCH",body:JSON.stringify(body)}),
  setParticipation:(id:string,body:unknown)=>request<{ok:boolean}>("/api/work-items/"+id+"/participations",{method:"POST",body:JSON.stringify(body)}),
  uploadAttachment:async(id:string,file:File)=>{
    const form=new FormData(); form.append("file",file);
    const response=await fetch("/api/work-items/"+id+"/attachments",{method:"POST",headers:{"x-demo-user-id":currentActor},body:form});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error || "Upload failed");
    return payload as {id:string;name:string;size:number;contentType:string};
  },
  createDecision:(id:string,body:unknown)=>request<{id:string;technicalDebtId:string|null}>("/api/work-items/"+id+"/decisions",{method:"POST",body:JSON.stringify(body)}),
  comment:(id:string,body:string)=>request<{id:string}>("/api/work-items/"+id+"/comments",{method:"POST",body:JSON.stringify({body})}),
  createDebt:(body:unknown)=>request<{id:string;code:string}>("/api/tech-debts",{method:"POST",body:JSON.stringify(body)}),
  updateDebt:(id:string,body:unknown)=>request<{ok:boolean}>("/api/tech-debts/"+id,{method:"PATCH",body:JSON.stringify(body)}),
  contextCapsule:(id:string)=>request<Record<string,unknown>>("/api/work-items/"+id+"/context-capsule")
};
