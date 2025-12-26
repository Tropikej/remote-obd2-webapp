import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@dashboard/shared": path.resolve(__dirname, "../..", "packages/shared/src"),
    },
  },
});
