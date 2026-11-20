import { expect, test } from "./fixtures";
import { signIn } from "./sign-in";

// Back returns to where the person came from (src/lib/nav-history.ts). When there is nowhere to go back to, as when a page is
// opened by its address, it goes to the screen that leads to it. These flows need no data, so they do not depend on others.
test("flow 39: Back returns to where the person came from, and to the screen's parent when there is nowhere to go back to", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  const back = page.getByRole("button", { name: "Back", exact: true });
  const arrivesAt = (path: string) => page.waitForURL((url) => url.pathname === path);

  // Opened by its address with no record, Access Point goes back to Admin, which is where its tile is. It used to go to Home.
  await page.goto("/access-point");
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto("/access-point");
  await back.click();
  await arrivesAt("/admin");

  // Customers then Suppliers from the menu: Back goes to Customers, not to a fixed parent such as Home.
  await page.goto("/customers");
  await page.getByRole("link", { name: "Suppliers", exact: true }).first().click();
  await arrivesAt("/suppliers");
  await back.click();
  await arrivesAt("/customers");

  // From Reports into a report, and changing what the report ages from, is one step: Back goes to Reports.
  await page.getByRole("link", { name: "Reports", exact: true }).first().click();
  await arrivesAt("/reports");
  await page.getByRole("link", { name: /Aged debtors/ }).click();
  await arrivesAt("/reports/aged-debtors");
  await page.getByLabel("Age from").selectOption("document");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("basis") === "document");
  await back.click();
  await arrivesAt("/reports");

  // And Back from Reports goes to Customers, where Reports was reached from.
  await back.click();
  await arrivesAt("/customers");
});
