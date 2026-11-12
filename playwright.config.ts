import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. They run the built app against a local Supabase stack that has been seeded with
 * `npm run e2e:seed`. The AI and Access Point providers are the mock ones, so nothing calls a real service.
 *
 * The tests share one database and some of them post documents, so they run one at a time, in file order.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One action that cannot happen fails in 20 seconds, not at the end of the whole test.

  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    // A failing test keeps its trace, a screenshot and a video, which CI uploads.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "en-IE",
    timezoneId: "Europe/Dublin",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // What the app logs goes into the test output, so a request that errors or hangs leaves a line to read.
    stdout: "pipe",
    stderr: "pipe",
  },
});
