import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.spec.ts"],
    testTimeout: 45_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
