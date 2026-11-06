import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { createApp, recoverWorkbenchRuns } from "./server.js";

const here=path.dirname(fileURLToPath(import.meta.url));
const webRoot=path.resolve(here,"../web");
const host=process.env.HOST??"127.0.0.1";
const port=Number(process.env.PORT??4173);
if(!["127.0.0.1","localhost","::1"].includes(host))throw new Error("Novel Generation Workbench must bind to loopback; set HOST=127.0.0.1.");
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("PORT must be between 1 and 65535.");

async function main():Promise<void>{
 await recoverWorkbenchRuns();
 const app=createApp();
 let vite:ViteDevServer|undefined;
 if(process.env.NODE_ENV!=="production"){
  vite=await createViteServer({root:webRoot,server:{middlewareMode:true},appType:"spa"});
  app.use(vite.middlewares);
 }else{
  app.use(express.static(path.join(webRoot,"dist")));
  app.use((_req,res)=>res.sendFile(path.join(webRoot,"dist","index.html")));
 }
 const server=createHttpServer(app);
 server.listen(port,host,()=>console.info("[workbench] http://"+host+":"+port));
 const shutdown=async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await vite?.close();};
 process.once("SIGINT",()=>void shutdown());process.once("SIGTERM",()=>void shutdown());
}
main().catch(error=>{console.error(error);process.exit(1);});
