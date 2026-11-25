import { readFileSync } from "node:fs";
import type { Browser, Locator, Page } from "@playwright/test";
import { apiAs } from "./api";
import { expect, test } from "./fixtures";
import { backOnList, documentDialog, expectNoError, listRows, openList, rowText, startDocument, typeInto } from "./documents";
import type { Role } from "./people";
import { signIn } from "./sign-in";

// Journal export (specs/QULAPLUS_JOURNAL_EXPORT_SPEC.md, phase 5). This file is named so that it runs after every other
// one: the first batch holds everything posted before it, so every earlier flow has to have finished. The amounts are
// not used by any other flow. The flows have not been run before CI, so expect small fixes.
test.describe.configure({ mode: "serial" });

const BANK = "E2E-PAY";
const ORG_ONE_PEPPOL = "IE1234567T";

async function as<T>(browser: Browser, role: Role, run: (page: Page) => Promise<T>) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, role);
    return await run(page);
  } finally {
    await context.close();
  }
}

async function chooseByCode(select: Locator, code: string) {
  await expect(select).toBeVisible();
  const value = await select.evaluate((element, wanted) => {
    const options = [...(element as HTMLSelectElement).options];
    return options.find((option) => option.text.trim().startsWith(wanted))?.value ?? null;
  }, code);
  expect(value, `an option starting with ${code}`).toBeTruthy();
  await select.selectOption(value as string);
}

function paymentForm(page: Page): Locator {
  return page.getByRole("dialog").filter({ has: page.locator("form#payment-document") });
}

async function organisationOneId() {
  const api = await apiAs("owner");
  const [row] = await api.select<{ organisation_id: string }>("organisation_defaults", `select=organisation_id&peppol_id=eq.${ORG_ONE_PEPPOL}`);
  expect(row?.organisation_id, "the id of Qula Test One").toBeTruthy();
  return { api, id: row.organisation_id };
}

/** The fields of a CSV that always quotes them, one array for each row. */
function parseCsv(text: string) {
  return text
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((line) => line.length > 0)
    .map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => match[1].replace(/""/g, '"')));
}

/** Presses Download on the batch row and returns the CSV it saves. */
async function downloadBatch(page: Page, batch: string) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("tbody tr").filter({ hasText: batch }).getByRole("button", { name: "Download", exact: true }).click(),
  ]);
  return parseCsv(readFileSync((await download.path()) as string, "utf8"));
}

test("flow 35: an owner sets the accounting accounts, every bank account already has a GL code, and the preview has no problems", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  await page.goto("/accounting");
  // Each account is a system role on a GL code. The control, exchange and suspense accounts exist already, and the list offers
  // only codes of the right type. These two move a role to another code.
  await chooseByCode(page.locator('select[name="receivables_gl_code_id"]'), "1100");
  await chooseByCode(page.locator('select[name="payables_gl_code_id"]'), "2100");
  await chooseByCode(page.locator('select[name="vat_sales_gl_code_id"]'), "2200");
  await chooseByCode(page.locator('select[name="vat_purchases_gl_code_id"]'), "1300");
  await chooseByCode(page.locator('select[name="exchange_gl_code_id"]'), "7900");
  await chooseByCode(page.locator('select[name="rounding_gl_code_id"]'), "7950");
  // An e-invoice imported by an earlier flow was posted with a line that has no GL code, and a posted line cannot be changed.
  // The suspense account is how it is exported anyway.
  await chooseByCode(page.locator('select[name="suspense_gl_code_id"]'), "9990");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await page.reload();
  await expect(page.locator('select[name="receivables_gl_code_id"] option:checked')).toContainText("1100");
  await expect(page.locator('select[name="vat_purchases_gl_code_id"] option:checked')).toContainText("1300");
  await expect(page.locator('select[name="rounding_gl_code_id"] option:checked')).toContainText("7950");

  // Earlier flows made bank accounts without choosing a GL code, so each was given one of its own.
  const { api, id } = await organisationOneId();
  expect(await api.select("bank_accounts", `select=id&organisation_id=eq.${id}&gl_code_id=is.null`)).toEqual([]);

  await page.goto("/journal-export?new=1");
  await expect(page.getByRole("heading", { name: "Journal export" })).toBeVisible();
  // Say what is listed in the failure message, so a problem no earlier flow could fix is easy to see.
  const problems = page.getByRole("alert").filter({ hasText: "Fix these before a batch can be made" });
  const left = (await problems.count()) > 0 ? await problems.innerText() : "";
  expect(left, "problems listed in the preview").toBe("");
});

test("flow 36: a purchase invoice and a supplier payment are previewed as balanced journals, exported as a batch and downloaded", async ({ browser, page }) => {
  test.setTimeout(300_000);
  // 3,456.78 plus 23% VAT of 795.06 is 4,251.84.
  await as(browser, "member", async (member) => {
    await openList(member, "PIN");
    await startDocument(member, { party: "VOD", sales: false, supplierReference: "VOD-FLOW36", lines: [{ description: "=Flow36 calls", quantity: "1", price: "3456.78", gl: "6000", vat: "P23" }] });
    await documentDialog(member).getByRole("button", { name: "Save and post", exact: true }).click();
    await backOnList(member, "PIN");
    await expectNoError(member);
    expect(await rowText(member, /4,?251\.84/)).toContain("Posted");

    await openList(member, "PPY");
    await member.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = paymentForm(member);
    await chooseByCode(dialog.locator('select[name="supplier_id"]'), "VOD");
    await typeInto(dialog.locator('input[name="amount"]'), "4251.84");
    await typeInto(dialog.getByRole("row").filter({ hasText: /4,?251\.84/ }).getByRole("textbox"), "4251.84");
    await chooseByCode(dialog.locator('select[name="bank_account_id"]'), BANK);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(member.locator("form#payment-document")).toHaveCount(0);
    await listRows(member).filter({ hasText: /4,?251\.84/ }).first().locator("td").nth(1).click();
    await expect(async () => {
      if (await member.locator("form#payment-document").isVisible()) await paymentForm(member).getByRole("button", { name: "Post", exact: true }).click();
      await expect(member.locator("form#payment-document")).toHaveCount(0, { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });

  await signIn(page, "owner");
  await page.goto("/journal-export?new=1");
  await expect(page.getByRole("alert").filter({ hasText: "Fix these before a batch can be made" })).toHaveCount(0);
  const preview = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Journal", exact: true }) }).last();
  await expect(preview.locator("tbody tr").filter({ hasText: "=Flow36 calls" })).toContainText("3,456.78");
  await expect(preview.locator("tbody tr").filter({ hasText: "VAT" }).filter({ hasText: "795.06" }).first()).toBeVisible();
  await expect(preview.locator("tbody tr").filter({ hasText: "2100" }).filter({ hasText: "4,251.84" }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Create batch of \d+ journals? and \d+ lines$/ }).click();
  await expect(page.getByRole("status")).toContainText("Batch JB-0001 was made");
  await expect(page.locator("tbody tr").filter({ hasText: "JB-0001" })).toBeVisible();

  // The file has a header row, amounts with two decimals, debits equal to credits, and text that could run as a formula is made safe.
  const rows = await downloadBatch(page, "JB-0001");
  expect(rows[0]).toEqual(["Batch", "Journal", "Date", "Account code", "Account name", "Description", "Debit", "Credit", "Currency", "Amount in currency", "Department", "Cost centre", "Source kind", "Source number", "Party"]);
  const lines = rows.slice(1);
  expect(lines.length).toBeGreaterThan(2);
  const sum = (column: number) => lines.reduce((total, line) => total + Math.round(Number(line[column]) * 100), 0);
  expect(sum(6)).toBe(sum(7));
  expect(lines.every((line) => /^\d+\.\d{2}$/.test(line[6]) && /^\d+\.\d{2}$/.test(line[7]))).toBe(true);
  expect(lines.every((line) => line[0] === "JB-0001" && /^JB-0001-\d{4}$/.test(line[1]))).toBe(true);
  // The imported e-invoice with a line that has no GL code is exported to the suspense account and marked.
  const suspense = lines.filter((line) => line[3] === "9990");
  expect(suspense.length).toBeGreaterThan(0);
  expect(suspense.every((line) => line[5].endsWith("(no GL code)"))).toBe(true);
  const own = lines.filter((line) => line[5].includes("Flow36 calls"));
  expect(own).toHaveLength(1);
  expect(own[0][5]).toBe("'=Flow36 calls");
  expect(own[0][3]).toBe("6000");
  expect(own[0][6]).toBe("3456.78");
});

test("flow 37: running the export again finds nothing, and voiding the exported invoice puts a reversal in the next batch", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  await page.goto("/journal-export?new=1");
  await expect(page.getByText(/Nothing is waiting to be exported/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Create batch/ })).toHaveCount(0);

  // Voiding the invoice needs its payment voided first, which frees the allocation. Both were exported, so both are reversed.
  const { api, id } = await organisationOneId();
  const owner = await apiAs("owner");
  const [payment] = await api.select<{ id: string }>("payments", `select=id&organisation_id=eq.${id}&amount=eq.4251.84&status=eq.posted`);
  const [invoice] = await api.select<{ id: string }>("transaction_headers", `select=id&organisation_id=eq.${id}&foreign_total_amount=eq.4251.84&status=eq.posted`);
  expect(payment?.id && invoice?.id, "the payment and the invoice of flow 36").toBeTruthy();
  // A function that returns nothing answers 204.
  expect((await owner.rpc("void_payment", { p_payment_id: payment.id, p_reason: "Flow 37" })).status).toBe(204);
  expect((await owner.rpc("void_document", { p_header_id: invoice.id, p_reason: "Flow 37" })).status).toBe(204);

  await page.goto("/journal-export?new=1");
  const preview = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Journal", exact: true }) }).last();
  await expect(preview.locator("tbody tr").filter({ hasText: /Reversal of purchase invoice/ })).toBeVisible();
  await expect(preview.locator("tbody tr").filter({ hasText: /Reversal of supplier payment/ })).toBeVisible();
  await page.getByRole("button", { name: /^Create batch of \d+ journals? and \d+ lines$/ }).click();
  await expect(page.getByRole("status")).toContainText("Batch JB-0002 was made");

  // The reversal is in the second batch and the first is as it was made.
  const second = await downloadBatch(page, "JB-0002");
  expect(second.slice(1).every((line) => line[12].startsWith("reversal of "))).toBe(true);
  expect(second.slice(1).some((line) => line[3] === "6000" && line[7] === "3456.78")).toBe(true);
  const first = await downloadBatch(page, "JB-0001");
  expect(first.slice(1).some((line) => line[5] === "'=Flow36 calls" && line[6] === "3456.78")).toBe(true);
  expect(first.slice(1).some((line) => line[12].startsWith("reversal of "))).toBe(false);
});

test("flow 38: a member sees neither the Accounting nor the Journal export tile and is refused when calling the database directly", async ({ browser }) => {
  test.setTimeout(120_000);
  const { id } = await organisationOneId();
  await as(browser, "member", async (member) => {
    await member.goto("/admin");
    await expect(member.getByRole("link", { name: /GL codes/ })).toBeVisible();
    await expect(member.getByRole("link", { name: /^Accounting/ })).toHaveCount(0);
    await expect(member.getByRole("link", { name: /^Journal export/ })).toHaveCount(0);

    await member.goto("/accounting");
    await expect(member).toHaveURL(/\/admin$/);
    await member.goto("/journal-export");
    await expect(member).toHaveURL(/\/admin$/);
  });

  const member = await apiAs("member");
  expect(await member.select("accounting_settings", `select=id&organisation_id=eq.${id}`)).toEqual([]);
  expect(await member.select("journal_batches", `select=id&organisation_id=eq.${id}`)).toEqual([]);
  const made = await member.rpc("create_journal_batch", { p_organisation_id: id, p_up_to: "2099-12-31" });
  expect(made.status).not.toBe(200);
  expect(made.message).toMatch(/owner or admin/);
  const [batch] = await (await apiAs("owner")).select<{ id: string }>("journal_batches", `select=id&organisation_id=eq.${id}&number=eq.1`);
  const downloaded = await member.rpc("journal_batch_lines_for", { p_batch_id: batch.id });
  expect(downloaded.status).not.toBe(200);
});
