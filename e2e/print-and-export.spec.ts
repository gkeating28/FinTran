import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { apiAs } from "./api";
import { expect, test } from "./fixtures";
import { backOnList, documentDialog, expectNoError, listRows, openList, rowText, startDocument, typeInto } from "./documents";
import { signIn } from "./sign-in";

// A customer name that a spreadsheet would run as a formula if it were written as one.
const FORMULA_NAME = '=HYPERLINK("https://example.com/pay","Pay here")';

function unescapeXml(text: string) {
  return text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

test("flow 9: a grid with a formula-like party name exports it as plain text", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "owner");

  // Add the customer through the screen.
  await page.goto("/customers");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Add customer" });
  await typeInto(form.locator('input[name="code"]'), "FORM");
  await typeInto(form.locator('input[name="name"]'), FORMULA_NAME);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.locator("tbody tr").filter({ hasText: "FORM" }).first()).toContainText(FORMULA_NAME);

  // Export the grid and read the downloaded workbook.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const files = unzipSync(new Uint8Array(await readFile(await download.path())));
  const sheetPath = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  expect(sheetPath, "a worksheet in the workbook").toBeTruthy();
  const sheet = strFromU8(files[sheetPath ?? ""]);

  // The name is an explicit text cell holding exactly what was typed, and the workbook has no formula anywhere.
  const cells = [...sheet.matchAll(/<c [^>]*t="inlineStr"[^>]*><is><t[^>]*>([^<]*)<\/t><\/is><\/c>/g)].map((match) => unescapeXml(match[1]));
  expect(cells).toContain(FORMULA_NAME);
  for (const [name, content] of Object.entries(files)) {
    expect(strFromU8(content), `no formula in ${name}`).not.toMatch(/<f[ >]/);
  }
});

test("flow 10: print and PDF of a posted invoice keep the customer's address as it was when posted", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "owner");

  // A sales invoice for Beta Stores, 1 at 13.00 plus VAT, 15.99, posted while Beta is at 9 Main Street.
  await openList(page, "SIN");
  await startDocument(page, { party: "BETA", sales: true, lines: [{ description: "Flow ten lamp", quantity: "1", price: "13", gl: "4000", vat: "S23" }] });
  await documentDialog(page).getByRole("button", { name: "Save and post", exact: true }).click();
  await backOnList(page, "SIN");
  await expectNoError(page);
  expect(await rowText(page, "15.99")).toContain("Posted");
  const printHref = await listRows(page).filter({ hasText: "15.99" }).first().getByRole("link", { name: "Print", exact: true }).getAttribute("href");
  expect(printHref).toMatch(/^\/print\/SI\//);

  await page.goto(printHref ?? "");
  await expect(page.locator("body")).toContainText("9 Main Street");

  // Beta moves. The customer record changes.
  const owner = await apiAs("owner");
  const moved = await owner.update("customers", "code=eq.BETA", { address_line1: "77 Harbour Road" });
  expect(moved.rows).toHaveLength(1);
  try {
    // The posted invoice still prints the address it was posted with.
    await page.goto(printHref ?? "");
    await expect(page.locator("body")).toContainText("9 Main Street");
    await expect(page.locator("body")).not.toContainText("77 Harbour Road");

    // The PDF is made from the same printed page, and it downloads as a PDF.
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  } finally {
    await owner.update("customers", "code=eq.BETA", { address_line1: "9 Main Street" });
  }
});
