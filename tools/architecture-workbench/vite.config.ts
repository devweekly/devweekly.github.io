import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "client",
  plugins: [react()],
  server: { host: true, port: 5173, proxy: { "/api": "http://localhost:4000", "/uploads": "http://localhost:4000" } },
  build: { outDir: "../dist", emptyOutDir: true }
});