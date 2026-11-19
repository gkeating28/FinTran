import { expect, test } from "./fixtures";
import { backOnList, documentDialog, expectNoError, openList, rowText, startDocument } from "./documents";
import { signIn } from "./sign-in";

// Named to run after the other files, with the approvals flows (which need no rule to exist when they start, and this
// file sets none). The amount is not used by any other flow.

test("flow 27: a posted purchase invoice is on aged creditors under the supplier, and the same report opens for a member", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // 3.33 plus VAT at 23 per cent, 4.10.
  await openList(page, "PIN");
  await startDocument(page, { party: "VOD", sales: false, supplierReference: "VOD-FLOW27", lines: [{ description: "Flow twenty seven stamps", quantity: "1", price: "3.33", gl: "6000", vat: "P23" }] });
  await documentDialog(page).getByRole("button", { name: "Save and post", exact: true }).click();
  await backOnList(page, "PIN");
  await expectNoError(page);
  expect(await rowText(page, "4.10")).toContain("Posted");

  // It is on the report under Vodafone, and the documents behind the row list it.
  await page.goto("/aged-creditors");
  await expect(page.getByRole("heading", { name: "Aged creditors" })).toBeVisible();
  const row = page.locator("tbody tr").filter({ hasText: "Vodafone" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Documents" }).click();
  const documents = page.getByRole("dialog");
  await expect(documents.locator("tr").filter({ hasText: "4.10" }).first()).toBeVisible();
  // The dialog has a close button in its title bar as well as the one at the foot.
  await documents.getByRole("button", { name: "Close" }).last().click();
  await expect(documents).toHaveCount(0);

  // A purchase invoice is not a debt of a customer.
  await page.goto("/aged-debtors");
  await expect(page.getByRole("heading", { name: "Aged debtors" })).toBeVisible();
  await expect(page.locator("tbody tr").filter({ hasText: "Vodafone" })).toHaveCount(0);

  // A date that is not a date is ignored, and the report still opens.
  await page.goto("/aged-creditors?asOf=not-a-date");
  await expect(page.getByRole("heading", { name: "Aged creditors" })).toBeVisible();

  // A member can read the report.
  const context = await browser.newContext();
  try {
    const member = await context.newPage();
    await signIn(member, "member");
    await member.goto("/aged-creditors");
    await expect(member.getByRole("heading", { name: "Aged creditors" })).toBeVisible();
    await expect(member.locator("tbody tr").filter({ hasText: "Vodafone" }).first()).toBeVisible();
  } finally {
    await context.close();
  }
});
