import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.mjs", "harbor-test/example.test.mjs"],
    clearMocks: true,
    restoreMocks: true,
  },
});
