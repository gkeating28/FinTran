import { expect, test } from "@playwright/test";
import { PEOPLE, type Role } from "./people";
import { signIn, watchForErrors } from "./sign-in";

/**
 * Smoke checks (spec 7.3): each main page loads for each role without console errors.
 * A page an ordinary member may not open sends them somewhere they may, which is fine. It must not break.
 */
const PAGES = [
  "/",
  "/transactions",
  "/transactions/PI",
  "/transactions/SI",
  "/transactions/PO",
  "/transactions/SO",
  "/customers",
  "/suppliers",
  "/products",
  "/e-documents",
  "/currencies",
  "/gl-codes",
  "/vat-rates",
  "/departments",
  "/cost-centres",
  "/transaction-types",
  "/forms",
  "/history",
  "/admin",
  "/access",
  "/defaults",
  "/organisations",
  "/ask-qula",
  "/access-point",
];

for (const role of Object.keys(PEOPLE) as Role[]) {
  test(`every main page loads for the ${role} without errors`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchForErrors(page);
    await signIn(page, role);
    for (const path of PAGES) {
      const before = errors.length;
      const response = await page.goto(path, { waitUntil: "networkidle" });
      expect(response?.status(), `${path} for the ${role}`).toBeLessThan(400);
      await expect(page.locator("body"), `${path} for the ${role}`).not.toContainText("Application error");
      expect(errors.slice(before), `${path} for the ${role}`).toEqual([]);
    }
  });
}

test("a visitor who is not signed in is sent to the sign-in page", async ({ page }) => {
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/login/);
});
