import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@dashboard/ui": path.resolve(__dirname, "..", "..", "packages", "ui", "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: path.resolve(__dirname, "src", "setupTests.ts"),
    globals: true,
    css: true
  }
});
