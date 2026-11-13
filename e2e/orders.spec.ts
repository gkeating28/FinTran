import { expect, test } from "./fixtures";
import { backOnList, bringInFromOrders, documentDialog, expectNoError, lineText, openList, openRow, press, rowText, saveDocument, setLineQuantity, startDocument, typeInto } from "./documents";
import { signIn } from "./sign-in";

test("flow 1: a sales order is activated, invoiced in two parts, and closes by itself", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // A sales order for 10 units.
  await openList(page, "SOR");
  await startDocument(page, { party: "ACME", sales: true, lines: [{ description: "Flow one widgets", quantity: "10", price: "25", gl: "4000", vat: "S23" }] });
  await saveDocument(page);
  expect(await rowText(page, "Acme")).toContain("Draft");

  // Activate it.
  await openRow(page, "Acme");
  await press(page, /activate order$/i);
  await expect(page.locator("form#purchase-document")).toBeVisible();
  await expect(documentDialog(page).getByRole("button", { name: /^(save and )?close order$/i })).toBeVisible();

  // Invoice 4 of the 10. The quantity is changed on the new invoice and Save and post saves it first.
  await press(page, /create invoice$/i);
  await page.waitForURL(/\/transactions\/SI\?open=/);
  await expect(page.locator("form#purchase-document")).toBeVisible();
  expect(await lineText(page, 1)).toContain("10.00");
  await setLineQuantity(page, 1, "4");
  await documentDialog(page).getByRole("button", { name: "Save and post", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/transactions/SIN" && !url.searchParams.has("open"));
  await expectNoError(page);
  expect(await rowText(page, "Acme")).toContain("Posted");

  // The order is still active, with 4 invoiced and 6 left.
  await openList(page, "SOR");
  expect(await rowText(page, "Acme")).toContain("Active");
  await openRow(page, "Acme");
  expect(await lineText(page, 1)).toMatch(/10\.00 4\.00 0\.00 6\.00/);

  // Invoice the rest. Create invoice starts with what is left.
  await press(page, /create invoice$/i);
  await page.waitForURL(/\/transactions\/SI\?open=/);
  await expect(page.locator("form#purchase-document")).toBeVisible();
  expect(await lineText(page, 1)).toContain("6.00");
  await documentDialog(page).getByRole("button", { name: /^(save and )?post$/i }).click();
  await page.waitForURL((url) => url.pathname === "/transactions/SIN" && !url.searchParams.has("open"));
  await expectNoError(page);

  // Posted invoices now cover every line, so the order closed by itself.
  await openList(page, "SOR");
  expect(await rowText(page, "Acme")).toContain("Closed");
  await openRow(page, "Acme");
  expect(await lineText(page, 1)).toMatch(/10\.00 10\.00 0\.00 0\.00/);
});

test("flow 2: one invoice from two sales orders, and each order shows its own Invoiced and Left", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // Two orders for Beta. Their totals tell them apart in the list: 5 at 11.00 is 67.65, 3 at 7.00 is 25.83.
  await openList(page, "SOR");
  await startDocument(page, { party: "BETA", sales: true, lines: [{ description: "Flow two A", quantity: "5", price: "11", gl: "4000", vat: "S23" }] });
  await saveDocument(page);
  await startDocument(page, { party: "BETA", sales: true, lines: [{ description: "Flow two B", quantity: "3", price: "7", gl: "4000", vat: "S23" }] });
  await saveDocument(page);
  for (const total of ["67.65", "25.83"]) {
    await openList(page, "SOR");
    await openRow(page, total);
    await press(page, /activate order$/i);
    await expect(documentDialog(page).getByRole("button", { name: /close order$/i })).toBeVisible();
  }

  // One invoice that brings in both orders. 2 of A's 5 are invoiced, and all 3 of B.
  await openList(page, "SIN");
  await startDocument(page, { party: "BETA", sales: true, lines: [] });
  await bringInFromOrders(page);
  expect(await lineText(page, "Flow two A")).toContain("5.00");
  expect(await lineText(page, "Flow two B")).toContain("3.00");
  await setLineQuantity(page, "Flow two A", "2");
  await documentDialog(page).getByRole("button", { name: "Save and post", exact: true }).click();
  await backOnList(page, "SIN");
  await expectNoError(page);

  // Order A: Invoiced 2, Reserved 0, Left 3, still active. Order B: Invoiced 3, Left 0, closed by itself.
  await openList(page, "SOR");
  expect(await rowText(page, "67.65")).toContain("Active");
  expect(await rowText(page, "25.83")).toContain("Closed");
  await openRow(page, "67.65");
  expect(await lineText(page, 1)).toMatch(/5\.00 2\.00 0\.00 3\.00/);
  await openList(page, "SOR");
  await openRow(page, "25.83");
  expect(await lineText(page, 1)).toMatch(/3\.00 3\.00 0\.00 0\.00/);
});

test("flow 3: requisition to purchase order to invoice, and voiding the invoice reopens the order", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // A requisition for 8 at 15.00, activated and turned into a purchase order.
  await openList(page, "PRQ");
  await startDocument(page, { party: "VOD", sales: false, lines: [{ description: "Flow three paper", quantity: "8", price: "15", gl: "6000", vat: "P23" }] });
  await saveDocument(page);
  await openRow(page, "Vodafone");
  await press(page, /activate requisition$/i);
  await press(page, /create purchase order$/i);
  await page.waitForURL(/\/transactions\/PO\?open=/);
  await expect(page.locator("form#purchase-document")).toBeVisible();
  expect(await lineText(page, 1)).toContain("8.00");

  // Activate the order and invoice all of it.
  await press(page, /activate order$/i);
  await expect(documentDialog(page).getByRole("button", { name: /close order$/i })).toBeVisible();
  await press(page, /create invoice$/i);
  await page.waitForURL(/\/transactions\/PI\?open=/);
  await expect(page.locator("form#purchase-document")).toBeVisible();
  await typeInto(page.locator('input[name="supplier_reference"]'), "VOD-FLOW3");
  await documentDialog(page).getByRole("button", { name: "Save and post", exact: true }).click();
  await backOnList(page, "PIN");
  await expectNoError(page);

  await openList(page, "POR");
  expect(await rowText(page, "Vodafone")).toContain("Closed");

  // Void the invoice. The order the system closed reopens with all 8 left.
  await openList(page, "PIN");
  await openRow(page, "Vodafone");
  await documentDialog(page).getByRole("button", { name: "Void", exact: true }).click();
  const voiding = page.getByRole("dialog", { name: "Void document" });
  await typeInto(voiding.getByLabel("Void reason"), "Entered against the wrong order");
  await voiding.getByRole("button", { name: "Void document" }).click();
  await backOnList(page, "PIN");
  await expectNoError(page);
  expect(await rowText(page, "Vodafone")).toContain("Void");

  await openList(page, "POR");
  expect(await rowText(page, "Vodafone")).toContain("Active");
  await openRow(page, "Vodafone");
  expect(await lineText(page, 1)).toMatch(/8\.00 0\.00 0\.00 8\.00/);
});

test("flow 4: a credit note marked Return to order gives the quantity back and reopens the order", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // An order for Acme of 2 at 30.00, which is 73.80, invoiced in full so it closes by itself.
  await openList(page, "SOR");
  await startDocument(page, { party: "ACME", sales: true, lines: [{ description: "Flow four chairs", quantity: "2", price: "30", gl: "4000", vat: "S23" }] });
  await saveDocument(page);
  await openRow(page, "73.80");
  await press(page, /activate order$/i);
  await press(page, /create invoice$/i);
  await page.waitForURL(/\/transactions\/SI\?open=/);
  await documentDialog(page).getByRole("button", { name: /^(save and )?post$/i }).click();
  await backOnList(page, "SIN");
  await expectNoError(page);
  await openList(page, "SOR");
  expect(await rowText(page, "73.80")).toContain("Closed");

  // Credit the invoice. Create credit note copies the line with Return to order ticked, because it came from an order.
  await openList(page, "SIN");
  await openRow(page, "73.80");
  await documentDialog(page).getByRole("button", { name: "Credit notes", exact: true }).click();
  const credits = page.getByRole("dialog", { name: "Credit notes" });
  await credits.getByRole("button", { name: "Create credit note" }).click();
  await page.waitForURL(/\/transactions\/SC\?open=/);
  await expect(page.locator("form#purchase-document")).toBeVisible();
  expect(await lineText(page, 1)).toContain("Yes");

  // A draft credit note gives nothing back yet.
  await openList(page, "SOR");
  expect(await rowText(page, "73.80")).toContain("Closed");

  // Posted, it gives the 2 back and the order reopens.
  await openList(page, "SCN");
  await openRow(page, "Acme");
  await documentDialog(page).getByRole("button", { name: /^(save and )?post$/i }).click();
  await backOnList(page, "SCN");
  await expectNoError(page);
  await openList(page, "SOR");
  expect(await rowText(page, "73.80")).toContain("Active");
  await openRow(page, "73.80");
  expect(await lineText(page, 1)).toMatch(/2\.00 0\.00 0\.00 2\.00/);
});
