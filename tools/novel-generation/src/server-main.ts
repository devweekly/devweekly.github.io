// 本地 Web Workbench 入口：开发态挂 Vite 中间件，生产态托管 web/dist。
// 默认只绑回环 127.0.0.1——Agent 服务持有本地模型凭据，绝不能默认暴露到局域网。
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type RequestHandler } from "express";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { createApp, recoverWorkbenchRuns, recoverKnowledgeBuilds } from "./server.js";
import { WORKBENCH_DEFAULT_PORT, WORKBENCH_MAX_PORT } from "./constants.js";

const here=path.dirname(fileURLToPath(import.meta.url));
const webRoot=path.resolve(here,"../web");
const host=process.env.HOST??"127.0.0.1";
const port=Number(process.env.PORT??WORKBENCH_DEFAULT_PORT);
if(!["127.0.0.1","localhost","::1"].includes(host))throw new Error("Novel Generation Workbench must bind to loopback; set HOST=127.0.0.1.");
if(!Number.isInteger(port)||port<1||port>WORKBENCH_MAX_PORT)throw new Error("PORT must be between 1 and " + WORKBENCH_MAX_PORT + ".");

async function main():Promise<void>{
 await recoverWorkbenchRuns();
 await recoverKnowledgeBuilds();
 const app=createApp();
 let vite:ViteDevServer|undefined;
 if(process.env.NODE_ENV!=="production"){
  vite=await createViteServer({root:webRoot,server:{middlewareMode:true},appType:"spa"});
  app.use(vite.middlewares as unknown as RequestHandler);
 }else{
  app.use(express.static(path.join(webRoot,"dist")));
  app.use((_req,res)=>res.sendFile(path.join(webRoot,"dist","index.html")));
 }
 const server=createHttpServer(app);
 server.on("error",(error:NodeJS.ErrnoException)=>{
  if(error.code==="EADDRINUSE"){
   console.error(`[workbench] 端口 ${port} 已被占用。已有实例在 http://${host}:${port} 运行，直接访问即可；` +
    `如需另起一个实例，用 PORT=<其他端口> npm run start:web。`);
  }else{
   console.error("[workbench] 服务启动失败：",error);
  }
  process.exit(1);
 });
 server.listen(port,host,()=>console.info("[workbench] http://"+host+":"+port));
 const shutdown=async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await vite?.close();};
 process.once("SIGINT",()=>void shutdown());process.once("SIGTERM",()=>void shutdown());
}
main().catch(error=>{console.error(error);process.exit(1);});
