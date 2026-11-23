import { expect, test } from "./fixtures";
import { apiAs } from "./api";
import { signIn } from "./sign-in";

// Back returns to where the person came from (src/lib/nav-history.ts). When there is nowhere to go back to, as when a page is
// opened by its address, it goes to the screen that leads to it. These flows need no data, so they do not depend on others.
test("flow 39: Back returns to where the person came from, and to the screen's parent when there is nowhere to go back to", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  const back = page.getByRole("button", { name: "Back", exact: true });
  const arrivesAt = (path: string) => page.waitForURL((url) => url.pathname === path);

  // Opened by its address with no record, GL codes goes back to Admin, which is where its tile is. It used to go to Home.
  await page.goto("/gl-codes");
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto("/gl-codes");
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

// Ask Qula, the Access Point and the Accounting accounts are settings of one organisation, so they are tabs of its edit screen.
test("flow 40: the Ask Qula, Access Point and Accounting settings are tabs of the organisation edit, and a save changes the organisation being edited", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const api = await apiAs("owner");
  const [two] = await api.select<{ id: string }>("organisations", "select=id&name=eq.Qula Test Two");
  expect(two?.id, "the id of Qula Test Two").toBeTruthy();

  // The settings have no tiles on Admin. Journal export, which is something to do and not a setting, keeps its tile.
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: /^Journal export/ })).toBeVisible();
  for (const name of [/^Ask Qula/, /^Access Point/, /^Accounting/]) await expect(page.getByRole("link", { name })).toHaveCount(0);

  // Edit Qula Test Two, which is not the organisation the owner is working in, and open each tab.
  await page.goto("/organisations");
  await page.getByRole("row", { name: /Qula Test Two/ }).getByRole("button", { name: "Edit" }).click();
  const tabs = page.getByRole("tablist", { name: "Organisation" });
  await expect(tabs.getByRole("tab")).toHaveText(["Details", "Ask Qula", "Access Point", "Accounting"]);
  await tabs.getByRole("tab", { name: "Ask Qula" }).click();
  await expect(page.getByRole("button", { name: "Test connection" })).toBeVisible();
  await tabs.getByRole("tab", { name: "Accounting" }).click();
  await expect(page.locator('select[name="receivables_gl_code_id"]')).toBeVisible();

  // A save on the Access Point tab is for the organisation being edited, and the person stays on that tab.
  await tabs.getByRole("tab", { name: "Access Point" }).click();
  await page.locator('input[name="accountId"]').fill("FLOW40-ACCOUNT");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Access Point", selected: true })).toBeVisible();
  await expect(page.locator('input[name="accountId"]')).toHaveValue("FLOW40-ACCOUNT");
  const saved = await api.select<{ organisation_id: string; config: { accountId?: string } }>("access_point_settings", "select=organisation_id,config");
  expect(saved.find((row) => row.organisation_id === two.id)?.config.accountId).toBe("FLOW40-ACCOUNT");
  expect(saved.filter((row) => row.organisation_id !== two.id && row.config.accountId === "FLOW40-ACCOUNT")).toEqual([]);

  // Closing the edit returns to the list.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/organisations" && !url.searchParams.has("edit"));

  // The old addresses open the tab for the organisation being worked in, and Back goes to where the link was.
  await page.goto("/admin");
  await page.goto("/accounting");
  await expect(page.getByRole("tab", { name: "Accounting", selected: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/admin");

  // A member is shown the organisation without the tabs, and none of the settings forms.
  const member = await browser.newContext();
  const memberPage = await member.newPage();
  await signIn(memberPage, "member");
  await memberPage.goto(`/organisations?edit=${two.id}&tab=access-point`);
  await expect(memberPage.getByRole("tablist", { name: "Organisation" })).toHaveCount(0);
  await expect(memberPage.locator('input[name="accountId"]')).toHaveCount(0);
  await member.close();
});
