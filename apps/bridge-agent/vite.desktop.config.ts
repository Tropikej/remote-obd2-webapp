import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  root: path.resolve(__dirname, "src/desktop/renderer"),
  plugins: [react()],
  resolve: {
    alias: {
      "@dashboard/ui": path.resolve(__dirname, "..", "..", "packages", "ui", "src"),
    },
  },
  server: {
    port: 5174,
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./setupTests.ts"],
  },
}));
