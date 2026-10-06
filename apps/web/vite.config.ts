import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { operatorSessionPlugin } from "./operator-session.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
  const hostEnv = loadEnv(mode, workspaceRoot, "");
  for (const key of ["PLATFORM_ENCRYPTION_KEY", "PLATFORM_ADMIN_KEY", "AGENT_SECRET_KEY"]) {
    if (process.env[key] === undefined && hostEnv[key]) process.env[key] = hostEnv[key];
  }
  const apiUrl = `http://127.0.0.1:${process.env.AGENT_PORT || hostEnv.AGENT_PORT || "3001"}`;
  return {
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  plugins: [react(), tailwindcss(), operatorSessionPlugin(workspaceRoot)],
  preview: { proxy: { "/api": { target: apiUrl, changeOrigin: true } } },
  server: {
    port: 3000,
    host: true,
    proxy: {
      "/api": {
        target: apiUrl,
        changeOrigin: true,
      },
    },
  },
  };
});
