import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/**/*.test.ts",
      "webview/src/**/*.test.{ts,tsx}"
    ],
    setupFiles: [
      "./webview/src/test/setup.ts"
    ],
    css: true,
    coverage: {
      provider: "v8",
      reporter: [
        "text",
        "html"
      ],
      include: [
        "src/**/*.ts",
        "webview/src/**/*.{ts,tsx}"
      ]
    }
  }
});
