import { expect, test } from "./fixtures";
import { lineRows, openList, openRow, press, rowText, saveDocument, setLineQuantity, startDocument } from "./documents";
import { signIn } from "./sign-in";

/**
 * A failed action sends the person back to the list with the message in the address, as ?error=. Checking the
 * address is exact: the page also has alert regions that are not errors, such as the one that announces page changes.
 */
async function expectNoError(page: Parameters<typeof lineRows>[0]) {
  expect(new URL(page.url()).searchParams.get("error"), "an error message after the action").toBeNull();
}

/** One line of the open document's line grid as text, such as "1 Widgets C62 4000 S23 10.00 4.00 0.00 6.00 ...". */
async function lineText(page: Parameters<typeof lineRows>[0], lineNumber: number) {
  return (await lineRows(page).nth(lineNumber - 1).innerText()).replace(/\s+/g, " ").trim();
}

test("flow 1: a sales order is activated, invoiced in two parts, and closes by itself", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // A sales order for 10 units.
  await openList(page, "SO");
  await startDocument(page, { party: "ACME", sales: true, lines: [{ description: "Flow one widgets", quantity: "10", price: "25", gl: "4000", vat: "S23" }] });
  await saveDocument(page);
  expect(await rowText(page, "Acme")).toContain("Draft");

  // Activate it.
  await openRow(page, "Acme");
  await press(page, /activate order$/i);
  await expect(page.locator("form#purchase-document")).toBeVisible();
  await expect(page.getByRole("button", { name: /^(save and )?close order$/i })).toBeVisible();

  // Invoice 4 of the 10. The quantity is changed on the new invoice and Save and post saves it first.
  await press(page, /create invoice$/i);
  await page.waitForURL(/\/transactions\/SI\?open=/);
  await expect(page.locator("form#purchase-document")).toBeVisible();
  expect(await lineText(page, 1)).toContain("10.00");
  await setLineQuantity(page, 1, "4");
  await page.getByRole("button", { name: "Save and post", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/transactions/SI" && !url.searchParams.has("open"));
  await expectNoError(page);
  expect(await rowText(page, "Acme")).toContain("Posted");

  // The order is still active, with 4 invoiced and 6 left.
  await openList(page, "SO");
  expect(await rowText(page, "Acme")).toContain("Active");
  await openRow(page, "Acme");
  expect(await lineText(page, 1)).toMatch(/10\.00 4\.00 0\.00 6\.00/);

  // Invoice the rest. Create invoice starts with what is left.
  await press(page, /create invoice$/i);
  await page.waitForURL(/\/transactions\/SI\?open=/);
  await expect(page.locator("form#purchase-document")).toBeVisible();
  expect(await lineText(page, 1)).toContain("6.00");
  await page.getByRole("button", { name: /^(save and )?post$/i }).click();
  await page.waitForURL((url) => url.pathname === "/transactions/SI" && !url.searchParams.has("open"));
  await expectNoError(page);

  // Posted invoices now cover every line, so the order closed by itself.
  await openList(page, "SO");
  expect(await rowText(page, "Acme")).toContain("Closed");
  await openRow(page, "Acme");
  expect(await lineText(page, 1)).toMatch(/10\.00 10\.00 0\.00 0\.00/);
});
