import { expect, type Page } from "@playwright/test";
import { PEOPLE, type Role } from "./people";

/** Signs in through the real sign-in page, as the spec asks, and waits for the home page. */
export async function signIn(page: Page, role: Role) {
  const person = PEOPLE[role];
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(person.email);
  await page.locator('input[name="password"]').fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await expect(page.locator("body")).not.toContainText("Sign in to open the organisations");
}

/**
 * Collects what the browser reports as an error while a page is used: uncaught exceptions and console errors.
 * A failed request for something the test did not ask for shows up here too.
 */
export function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`exception: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}
