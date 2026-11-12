import { test as base, expect, type Request } from "@playwright/test";

/** A request that takes longer than this is reported with the failure, finished or not. */
const SLOW_MS = 4_000;

/**
 * The test object every flow uses. When a test fails it prints what was on the page, as the accessibility tree,
 * and which requests were slow or never answered, so a failure in CI can be understood from the log as well as from
 * the uploaded trace. The open dialog and its buttons come last in the tree, so the end of it is kept as well as the start.
 */
export const test = base.extend<{ describePageOnFailure: void }>({
  describePageOnFailure: [
    async ({ page }, use, testInfo) => {
      const started = new Map<Request, number>();
      const slow: string[] = [];
      const describe = (request: Request) => `${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, "")}`;
      page.on("request", (request) => started.set(request, Date.now()));
      page.on("requestfinished", (request) => {
        const took = Date.now() - (started.get(request) ?? Date.now());
        started.delete(request);
        if (took >= SLOW_MS) slow.push(`${(took / 1000).toFixed(1)}s  ${describe(request)}`);
      });
      page.on("requestfailed", (request) => {
        started.delete(request);
        slow.push(`failed  ${describe(request)}  ${request.failure()?.errorText ?? ""}`);
      });

      await use();

      if (testInfo.status !== testInfo.expectedStatus) {
        const now = Date.now();
        const unanswered = [...started].map(([request, at]) => `${((now - at) / 1000).toFixed(1)}s and still waiting  ${describe(request)}`);
        console.log(
          `\n--- Requests that were slow, failed or never answered ---\n${[...slow, ...unanswered].join("\n") || "none"}\n--- end ---`,
        );
        try {
          const snapshot = await page.locator("body").ariaSnapshot({ timeout: 5_000 });
          const kept = snapshot.length > 9_000 ? `${snapshot.slice(0, 2_500)}\n  ... (middle left out) ...\n${snapshot.slice(-6_500)}` : snapshot;
          console.log(`\n--- Page at failure: ${page.url()} ---\n${kept}\n--- end ---`);
        } catch {
          console.log(`\n--- Page at failure: ${page.url()} (it could not be described) ---`);
        }
      }
    },
    { auto: true },
  ],
});

export { expect };
