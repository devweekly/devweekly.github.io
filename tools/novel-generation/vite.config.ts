import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const root=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:path.join(root,"web"),plugins:[react()],build:{outDir:path.join(root,"web/dist"),emptyOutDir:true},server:{host:"127.0.0.1",port:5173}});
