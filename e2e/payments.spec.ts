import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { backOnList, documentDialog, expectNoError, listRows, openList, openRow, startDocument, typeInto } from "./documents";
import { signIn } from "./sign-in";

/*
 * Payments release B, phase 6: the five acceptance flows (QULAPLUS_PAYMENTS_SPEC.md, "Acceptance (also as end-to-end
 * flows)"). They run in order and share one database: flow 11 offers the standard payment types and adds the bank
 * account the others pay from, so the rest are skipped if it fails.
 *
 * Every invoice here has an amount no other flow uses, so a row can be found by its total. A price of 100 at 23% VAT
 * is a total of 123.00.
 *
 * These flows have not been run against a local Supabase stack. Selectors for the payment screen are taken from the
 * components, not from a run, so expect small fixes the first time they run.
 */
test.describe.configure({ mode: "serial" });

const BANK = "E2E-PAY";

/** Chooses the option of a select whose text starts with the given code, such as ACME or E2E-PAY. */
async function chooseByCode(select: Locator, code: string) {
  await expect(select).toBeVisible();
  const value = await select.evaluate((element, wanted) => {
    const options = [...(element as HTMLSelectElement).options];
    return options.find((option) => option.text.trim().startsWith(wanted))?.value ?? null;
  }, code);
  expect(value, `an option starting with ${code}`).toBeTruthy();
  await select.selectOption(value as string);
}

/** Posts a sales invoice or credit note of one line, and returns once the list shows it posted. */
async function postSalesDocument(page: Page, typeCode: "SI" | "SC", party: string, net: string, description: string) {
  await openList(page, typeCode);
  await startDocument(page, { party, sales: true, lines: [{ description, quantity: "1", price: net, gl: "4000", vat: "S23" }] });
  await documentDialog(page).getByRole("button", { name: "Save and post", exact: true }).click();
  await backOnList(page, typeCode);
  await expectNoError(page);
}

/** The total of a document of net price `net` at 23% VAT, as the grids show it. */
function withVat(net: number) {
  return (Math.round(net * 123) / 100).toFixed(2);
}

/** The open payment form. */
function paymentDialog(page: Page, noun: RegExp) {
  return page.getByRole("dialog", { name: noun });
}

/** Opens the posted invoice or credit note with this total and shows its Payments tab. */
async function openPaymentsTab(page: Page, typeCode: "SI" | "SC", total: string) {
  await openList(page, typeCode);
  await openRow(page, total);
  await documentDialog(page).getByRole("tab", { name: "Payments" }).click();
}

/** Chooses the bank account, then saves and posts the open payment, and waits for it to close. */
async function payFromBank(page: Page, dialog: Locator) {
  await chooseByCode(dialog.locator('select[name="bank_account_id"]'), BANK);
  await dialog.getByRole("button", { name: "Save and post", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** Sets the payment filter on a document list, which shows only posted documents in that state. */
async function filterByPayment(page: Page, state: "Unpaid" | "Part paid" | "Paid" | "Any payment") {
  await page.getByLabel("Payment", { exact: true }).selectOption({ label: state });
}

test("flow 11: the standard payment types are offered once, a receipt is recorded from a posted invoice, and the invoice shows paid", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  // A bank account to pay from. The IBAN is the German example number.
  await page.goto("/bank-accounts");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const bank = page.getByRole("dialog");
  await bank.getByLabel("Code").fill(BANK);
  await bank.getByLabel("Name").fill("Flow eleven current account");
  await bank.getByLabel("IBAN").fill("DE89 3704 0044 0532 0130 00");
  await bank.getByLabel("Default for its currency").check();
  await bank.getByRole("button", { name: "Save", exact: true }).click();
  await expect(bank).toBeHidden();

  // The organisation has no payment types yet, so the Transactions menu offers the four standard ones.
  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add payment and receipt types" }).click();
  await page.waitForURL((url) => url.pathname === "/transactions");
  await expectNoError(page);
  for (const code of ["SR", "PP", "SF", "PF"]) {
    await expect(page.getByRole("link", { name: new RegExp(`${code} · `) })).toBeVisible();
  }
  // Once the types exist the offer is gone.
  await expect(page.getByRole("button", { name: "Add payment and receipt types" })).toHaveCount(0);

  // An invoice, posted.
  const total = withVat(100);
  await postSalesDocument(page, "SI", "ACME", "100", "Flow eleven goods");

  // Record receipt opens a new receipt for the customer with the whole amount due already allocated.
  await openPaymentsTab(page, "SI", total);
  await documentDialog(page).getByRole("link", { name: "Record receipt" }).click();
  await page.waitForURL(/\/transactions\/SR\?new=1/);
  const receipt = paymentDialog(page, /receipt/i);
  await expect(receipt).toBeVisible();
  await expect(receipt.locator('input[name="amount"]')).toHaveValue(total);
  await payFromBank(page, receipt);
  await expectNoError(page);
  await expect(listRows(page).filter({ hasText: total }).first()).toContainText("Posted");

  // The invoice now shows paid.
  await openList(page, "SI");
  await filterByPayment(page, "Paid");
  await expect(listRows(page).filter({ hasText: total })).toHaveCount(1);
  await filterByPayment(page, "Unpaid");
  await expect(listRows(page).filter({ hasText: total })).toHaveCount(0);
});

test("flow 12: one receipt pays two invoices with Allocate oldest first", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const first = withVat(110);
  const second = withVat(210);
  await postSalesDocument(page, "SI", "BETA", "110", "Flow twelve A");
  await postSalesDocument(page, "SI", "BETA", "210", "Flow twelve B");
  const sum = (Number(first) + Number(second)).toFixed(2);

  // A receipt for the two together. Allocate oldest first fills both boxes, and nothing is left on account.
  await openList(page, "SR");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const receipt = paymentDialog(page, /receipt/i);
  await chooseByCode(receipt.locator('select[name="customer_id"]'), "BETA");
  await typeInto(receipt.locator('input[name="amount"]'), sum);
  await receipt.getByRole("button", { name: "Allocate oldest first" }).click();
  await expect(receipt.getByRole("row").filter({ hasText: first }).getByRole("textbox")).not.toHaveValue("");
  await expect(receipt.getByRole("row").filter({ hasText: second }).getByRole("textbox")).not.toHaveValue("");
  await expect(receipt.getByText("On account")).toHaveCount(0);
  await payFromBank(page, receipt);
  await expectNoError(page);

  // Both invoices are paid.
  await openList(page, "SI");
  await filterByPayment(page, "Paid");
  await expect(listRows(page).filter({ hasText: first })).toHaveCount(1);
  await expect(listRows(page).filter({ hasText: second })).toHaveCount(1);
});

test("flow 13: a credit note's balance is applied to a second invoice", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const invoice = withVat(417);
  const credit = withVat(30);
  await postSalesDocument(page, "SI", "ACME", "417", "Flow thirteen goods");
  await postSalesDocument(page, "SC", "ACME", "30", "Flow thirteen allowance");

  // The credit note has its whole total as balance. Apply it to the invoice with this total.
  await openPaymentsTab(page, "SC", credit);
  await documentDialog(page).getByRole("button", { name: "Apply to an invoice" }).click();
  const apply = page.getByRole("dialog", { name: "Apply to an invoice" });
  await expect(apply).toBeVisible();
  await typeInto(apply.getByRole("row").filter({ hasText: invoice }).getByRole("textbox"), credit);
  await apply.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(apply).toHaveCount(0);

  // The credit note shows its balance used up, and the invoice part paid.
  await expect(documentDialog(page).getByText("Nothing has been applied yet.")).toHaveCount(0);
  await openList(page, "SC");
  await filterByPayment(page, "Paid");
  await expect(listRows(page).filter({ hasText: credit })).toHaveCount(1);
  await openList(page, "SI");
  await filterByPayment(page, "Part paid");
  await expect(listRows(page).filter({ hasText: invoice })).toHaveCount(1);
});

test("flow 14: a customer is refunded the unallocated balance of a credit note", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const credit = withVat(20);
  await postSalesDocument(page, "SC", "ACME", "20", "Flow fourteen allowance");

  // Refund opens a customer refund for the whole balance. It settles the credit note, not an invoice.
  await openPaymentsTab(page, "SC", credit);
  await documentDialog(page).getByRole("link", { name: "Refund" }).click();
  await page.waitForURL(/\/transactions\/SF\?new=1/);
  const refund = paymentDialog(page, /refund/i);
  await expect(refund).toBeVisible();
  await expect(refund.locator('input[name="amount"]')).toHaveValue(credit);
  await payFromBank(page, refund);
  await expectNoError(page);

  // The credit note has nothing left.
  await openList(page, "SC");
  await filterByPayment(page, "Paid");
  await expect(listRows(page).filter({ hasText: credit })).toHaveCount(1);
});

test("flow 15: an allocation on a posted receipt is removed with a reason and the money goes to another invoice", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const first = withVat(71);
  const second = withVat(73);
  await postSalesDocument(page, "SI", "ACME", "71", "Flow fifteen A");
  await postSalesDocument(page, "SI", "ACME", "73", "Flow fifteen B");

  // A receipt for the first invoice.
  await openPaymentsTab(page, "SI", first);
  await documentDialog(page).getByRole("link", { name: "Record receipt" }).click();
  await page.waitForURL(/\/transactions\/SR\?new=1/);
  await payFromBank(page, paymentDialog(page, /receipt/i));
  await expectNoError(page);

  // Open the posted receipt and remove its allocation. The dialog asks for a reason.
  await page.goto("/transactions/SR");
  await listRows(page).filter({ hasText: first }).first().locator("td").nth(1).click();
  const posted = paymentDialog(page, /receipt/i);
  await expect(posted).toBeVisible();
  await posted.getByRole("button", { name: "Remove", exact: true }).first().click();
  const remove = page.getByRole("dialog", { name: "Remove allocation" });
  await typeInto(remove.getByLabel("Reason"), "Paid the wrong invoice");
  await remove.getByRole("button", { name: "Remove allocation" }).click();
  await expect(remove).toHaveCount(0);
  await expect(posted).toContainText("Removed: Paid the wrong invoice");
  await expect(posted).toContainText("on account");

  // The money is on account again, so it is allocated to the second invoice.
  await typeInto(posted.getByRole("row").filter({ hasText: second }).getByRole("textbox"), first);
  await posted.getByRole("button", { name: "Allocate", exact: true }).click();
  await expect(posted.getByRole("alert")).toHaveCount(0);

  // The first invoice is open again, and the second is part paid.
  await openList(page, "SI");
  await filterByPayment(page, "Unpaid");
  await expect(listRows(page).filter({ hasText: first })).toHaveCount(1);
  await filterByPayment(page, "Part paid");
  await expect(listRows(page).filter({ hasText: second })).toHaveCount(1);
});
