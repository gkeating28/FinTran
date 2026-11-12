import { test as base, expect } from "@playwright/test";

/**
 * The test object every flow uses. When a test fails it prints what was on the page, as the accessibility tree,
 * so a failure in CI can be understood from the log as well as from the uploaded trace.
 */
export const test = base.extend<{ describePageOnFailure: void }>({
  describePageOnFailure: [
    async ({ page }, use, testInfo) => {
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        try {
          const snapshot = await page.locator("body").ariaSnapshot({ timeout: 5_000 });
          console.log(`\n--- Page at failure: ${page.url()} ---\n${snapshot.slice(0, 7_000)}\n--- end ---`);
        } catch {
          console.log(`\n--- Page at failure: ${page.url()} (it could not be described) ---`);
        }
      }
    },
    { auto: true },
  ],
});

export { expect };
