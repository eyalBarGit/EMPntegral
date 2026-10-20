import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The backend port lives in backend/.env, so it is read from there rather than
 * duplicated here. Otherwise changing PORT silently breaks the dev proxy and
 * every API call 500s with no obvious cause.
 */
function backendPort() {
  if (process.env.BACKEND_PORT) return process.env.BACKEND_PORT;

  try {
    const env = fs.readFileSync(path.resolve(import.meta.dirname, "../backend/.env"), "utf8");
    const match = /^\s*PORT\s*=\s*"?(\d+)"?/m.exec(env);
    if (match) return match[1];
  } catch {
    // No .env yet: fall through to the same default the backend itself uses.
  }

  return "3000";
}

const target = `http://127.0.0.1:${backendPort()}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the React app runs on its own port, so API and webhook
    // calls are proxied to the backend. This keeps cookies same-origin, which
    // the session cookie depends on.
    proxy: {
      "/api": { target, changeOrigin: true },
      "/webhooks": { target, changeOrigin: true },
      "/health": { target, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
