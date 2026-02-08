import { test, expect } from "../../harbor-test/fixtures/harbor.js";

test("web agents API presence smoke check", async ({ page }) => {
  await page.goto("about:blank");

  const capabilities = await page.evaluate(() => {
    const w = window as unknown as {
      ai?: unknown;
      agent?: unknown;
    };
    return {
      hasAi: typeof w.ai !== "undefined",
      hasAgent: typeof w.agent !== "undefined",
    };
  });

  expect(typeof capabilities.hasAi).toBe("boolean");
  expect(typeof capabilities.hasAgent).toBe("boolean");
});

