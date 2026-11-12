import { expect, type Locator, type Page } from "@playwright/test";

export type LineInput = { description: string; quantity: string; price: string; gl: string; vat?: string };

/** The list of documents of one type, such as SO or PI. */
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

/** Rows of the line grid in the open document. */
export function lineRows(page: Page): Locator {
  return page
    .locator("tbody tr")
    .filter({ hasNot: page.getByRole("link", { name: "Print", exact: true }) })
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
  await page.getByRole("button", { name: "Save", exact: true }).click();
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
  await page.getByRole("button", { name: label }).first().click();
  const confirm = page.getByRole("alertdialog").getByRole("button", { name: label });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

/** Changes the quantity on one line of the open document. */
export async function setLineQuantity(page: Page, lineNumber: number, quantity: string) {
  await lineRows(page).nth(lineNumber - 1).locator("td").nth(2).click();
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
