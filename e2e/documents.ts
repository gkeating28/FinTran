import { expect, type Locator, type Page } from "@playwright/test";

export type LineInput = { description: string; quantity: string; price: string; gl: string; vat?: string };

/** The list of documents of one type, such as SOR or PIN. */
export async function openList(page: Page, typeCode: string) {
  await page.goto(`/transactions/${typeCode}`);
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
}

/**
 * Rows of the list grid. Every row of a document list has a Print link, which the lines inside an open document do
 * not, and that is what tells the two tables apart.
 */
export function listRows(page: Page): Locator {
  return page.locator("tbody tr").filter({ has: page.getByRole("link", { name: "Print", exact: true }) });
}

/** Rows of the line grid in the open document: the table with a Qty column. Its totals row is in the footer. */
export function lineRows(page: Page): Locator {
  return page
    .locator("table")
    .filter({ has: page.getByRole("columnheader", { name: "Qty", exact: true }) })
    .locator("tbody tr")
    .filter({ hasNotText: "No lines yet." });
}

/**
 * Chooses an option of a select by the code its label starts with, such as ACME or 4000. The options are read from
 * the select itself, because the text of an option in a closed list is not something the page shows.
 */
async function chooseByCode(select: Locator, code: string) {
  await expect(select).toBeVisible();
  const value = await select.evaluate((element, wanted) => {
    const options = [...(element as HTMLSelectElement).options];
    return options.find((option) => option.text.trim().startsWith(wanted))?.value ?? null;
  }, code);
  expect(value, `an option starting with ${code}`).toBeTruthy();
  await select.selectOption(value as string);
}

/**
 * Types into one of the app's text fields. They are read-only until they are clicked, which keeps password managers
 * from filling them in, so the field is clicked first, as a person would.
 */
export async function typeInto(field: Locator, value: string) {
  await field.click();
  await expect(field).toBeEditable();
  await field.fill(value);
}

/** Fills in the line editor, which is already open, and saves the line. */
async function fillLine(page: Page, line: LineInput) {
  const editor = page.locator("form").filter({ has: page.getByRole("button", { name: "Save line" }) });
  await typeInto(editor.getByLabel("Description", { exact: true }), line.description);
  // A list is found by its accessible name. Its label text also holds every option, so it cannot be matched exactly.
  await chooseByCode(editor.getByRole("combobox", { name: "GL code", exact: true }), line.gl);
  if (line.vat) await chooseByCode(editor.getByRole("combobox", { name: "VAT code", exact: true }), line.vat);
  await typeInto(editor.getByLabel("Quantity", { exact: true }), line.quantity);
  await typeInto(editor.getByLabel("Price", { exact: true }), line.price);
  await editor.getByRole("button", { name: "Save line" }).click();
  await expect(editor).toHaveCount(0);
}

/** Starts a new document on the open list: chooses the customer or supplier and adds the lines. It is not saved yet. */
export async function startDocument(page: Page, options: { party: string; sales: boolean; lines: LineInput[]; supplierReference?: string }) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await chooseByCode(page.locator(`select[name="${options.sales ? "customer_id" : "supplier_id"}"]`), options.party);
  if (options.supplierReference) await typeInto(page.locator('input[name="supplier_reference"]'), options.supplierReference);
  for (const line of options.lines) {
    await page.getByRole("button", { name: "Add line", exact: true }).click();
    await fillLine(page, line);
  }
}

/** Presses Save on the open document and waits for it to close. */
export async function saveDocument(page: Page) {
  await documentDialog(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("form#purchase-document")).toHaveCount(0);
}

/** Opens the first row of the list that mentions the text, for example a customer name. */
export async function openRow(page: Page, text: string | RegExp) {
  const row = listRows(page).filter({ hasText: text }).first();
  await expect(row).toBeVisible();
  await row.locator("td").nth(1).click();
  await expect(page.locator("form#purchase-document")).toBeVisible();
}

/**
 * Presses a button on the open document and, when it asks, confirms. The label is matched loosely, so
 * "Activate order" also finds "Save and activate order", which is what the button says with unsaved changes.
 */
export async function press(page: Page, label: RegExp) {
  await documentDialog(page).getByRole("button", { name: label }).first().click();
  const confirm = page.getByRole("alertdialog").getByRole("button", { name: label });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

/**
 * The open document. The list behind it has its own buttons, such as Post on a draft row, so buttons are looked up
 * inside the document's dialog.
 */
export function documentDialog(page: Page): Locator {
  return page.getByRole("dialog").filter({ has: page.locator("form#purchase-document") });
}

/** Changes the quantity on one line of the open document, chosen by its number or by text on the line. */
export async function setLineQuantity(page: Page, line: number | string, quantity: string) {
  const row = typeof line === "number" ? lineRows(page).nth(line - 1) : lineRows(page).filter({ hasText: line }).first();
  await row.locator("td").nth(2).click();
  const editor = page.locator("form").filter({ has: page.getByRole("button", { name: "Save line" }) });
  await typeInto(editor.getByLabel("Quantity", { exact: true }), quantity);
  await editor.getByRole("button", { name: "Save line" }).click();
  await expect(editor).toHaveCount(0);
}

/** The text of the first list row that mentions the given text, with spaces tidied. */
export async function rowText(page: Page, text: string | RegExp) {
  const row = listRows(page).filter({ hasText: text }).first();
  await expect(row).toBeVisible();
  return (await row.innerText()).replace(/\s+/g, " ").trim();
}

/** Brings lines into the open invoice from active orders of its customer or supplier: every line of every order listed. */
export async function bringInFromOrders(page: Page) {
  await documentDialog(page).getByRole("button", { name: "From order", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Bring in from an order" });
  await expect(dialog).toBeVisible();
  for (const box of await dialog.locator('input[type="checkbox"][aria-label^="Bring in "]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await dialog.getByRole("button", { name: /^Bring in \d+ lines?$/ }).click();
  await expect(dialog).toHaveCount(0);
}

/** The text of one line of the open document, chosen by its number or by text on the line. */
export async function lineText(page: Page, line: number | string) {
  const row = typeof line === "number" ? lineRows(page).nth(line - 1) : lineRows(page).filter({ hasText: line }).first();
  await expect(row).toBeVisible();
  return (await row.innerText()).replace(/\s+/g, " ").trim();
}

/** Waits until a posting or another action has sent the person back to the list of the given type. */
export async function backOnList(page: Page, typeCode: string) {
  await page.waitForURL((url) => url.pathname === `/transactions/${typeCode}` && !url.searchParams.has("open"));
  // A document opened from a row of the list never changes the address, so the address alone says nothing. The
  // document closes when the action's answer arrives, and only then is the list behind it up to date.
  await expect(page.locator("form#purchase-document")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

/**
 * A failed action sends the person back to the list with the message in the address, as ?error=. Checking the
 * address is exact: the page also has alert regions that are not errors, such as the one that announces page changes.
 */
export async function expectNoError(page: Page) {
  expect(new URL(page.url()).searchParams.get("error"), "an error message after the action").toBeNull();
}
