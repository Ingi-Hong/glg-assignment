import { defineConfig } from "vitest/config";

export default defineConfig({
  /* The receipt is rendered with React (pipeline/src/services/receipt) */
  esbuild: { jsx: "automatic" },
  test: {
    globalSetup: ["./globalSetup.ts"],
    /* Every test shares one DynamoDB table, so run them one at a time */
    fileParallelism: false,
    testTimeout: 30_000,
    restoreMocks: true,
  },
});
