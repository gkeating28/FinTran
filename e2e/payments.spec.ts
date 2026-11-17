import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { backOnList, documentDialog, expectNoError, listRows, openList, openRow, startDocument, typeInto } from "./documents";
import { signIn } from "./sign-in";

/*
 * Payments release B, phase 6: the five acceptance flows (QULAPLUS_PAYMENTS_SPEC.md, "Acceptance (also as end-to-end
 * flows)"). They run in order and share one database: flow 12 offers the standard payment types and adds the bank
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
async function postSalesDocument(page: Page, typeCode: "SIN" | "SCN", party: string, net: string, description: string) {
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
async function openPaymentsTab(page: Page, typeCode: "SIN" | "SCN", total: string) {
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

test("flow 12: the standard payment types are offered once, a receipt is recorded from a posted invoice, and the invoice shows paid", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  // A bank account to pay from. The IBAN is the German example number.
  await page.goto("/bank-accounts");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const bank = page.getByRole("dialog");
  await typeInto(bank.getByLabel("Code", { exact: true }), BANK);
  await typeInto(bank.getByLabel("Name", { exact: true }), "Flow eleven current account");
  await typeInto(bank.getByLabel("IBAN"), "DE89 3704 0044 0532 0130 00");
  await bank.getByLabel("Default for its currency").check();
  await bank.getByRole("button", { name: "Save", exact: true }).click();
  await expect(bank).toBeHidden();

  // The organisation has no payment types yet, so the Transactions menu offers the four standard ones.
  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add payment and receipt types" }).click();
  await page.waitForURL((url) => url.pathname === "/transactions");
  await expectNoError(page);
  for (const code of ["SRC", "PPY", "SRF", "PRF"]) {
    await expect(page.getByRole("link", { name: new RegExp(`${code} · `) })).toBeVisible();
  }
  // Once the types exist the offer is gone.
  await expect(page.getByRole("button", { name: "Add payment and receipt types" })).toHaveCount(0);

  // An invoice, posted.
  const total = withVat(100);
  await postSalesDocument(page, "SIN", "ACME", "100", "Flow eleven goods");

  // Record receipt opens a new receipt for the customer with the whole amount due already allocated.
  await openPaymentsTab(page, "SIN", total);
  await documentDialog(page).getByRole("link", { name: "Record receipt" }).click();
  await page.waitForURL(/\/transactions\/SRC\?new=1/);
  const receipt = paymentDialog(page, /receipt/i);
  await expect(receipt).toBeVisible();
  await expect(receipt.locator('input[name="amount"]')).toHaveValue(total);
  await payFromBank(page, receipt);
  await expectNoError(page);
  await expect(listRows(page).filter({ hasText: total }).first()).toContainText("Posted");

  // The invoice now shows paid.
  await openList(page, "SIN");
  await filterByPayment(page, "Paid");
  await expect(listRows(page).filter({ hasText: total })).toHaveCount(1);
  await filterByPayment(page, "Unpaid");
  await expect(listRows(page).filter({ hasText: total })).toHaveCount(0);
});

test("flow 13: one receipt pays two invoices with Allocate oldest first", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const first = withVat(110);
  const second = withVat(210);
  await postSalesDocument(page, "SIN", "BETA", "110", "Flow twelve A");
  await postSalesDocument(page, "SIN", "BETA", "210", "Flow twelve B");
  const sum = (Number(first) + Number(second)).toFixed(2);

  // A receipt for the two together. Allocate oldest first fills both boxes, and nothing is left on account.
  await openList(page, "SRC");
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
  await openList(page, "SIN");
  await filterByPayment(page, "Paid");
  await expect(listRows(page).filter({ hasText: first })).toHaveCount(1);
  await expect(listRows(page).filter({ hasText: second })).toHaveCount(1);
});

test("flow 14: a credit note's balance is applied to a second invoice", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const invoice = withVat(417);
  const credit = withVat(30);
  await postSalesDocument(page, "SIN", "ACME", "417", "Flow thirteen goods");
  await postSalesDocument(page, "SCN", "ACME", "30", "Flow thirteen allowance");

  // The credit note has its whole total as balance. Apply it to the invoice with this total.
  await openPaymentsTab(page, "SCN", credit);
  await documentDialog(page).getByRole("button", { name: "Apply to an invoice" }).click();
  const apply = page.getByRole("dialog", { name: "Apply to an invoice" });
  await expect(apply).toBeVisible();
  await typeInto(apply.getByRole("row").filter({ hasText: invoice }).getByRole("textbox"), credit);
  await apply.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(apply).toHaveCount(0);

  // The credit note shows its balance used up, and the invoice part paid.
  await expect(documentDialog(page).getByText("Nothing has been applied yet.")).toHaveCount(0);
  await openList(page, "SCN");
  await filterByPayment(page, "Paid");
  await expect(listRows(page).filter({ hasText: credit })).toHaveCount(1);
  await openList(page, "SIN");
  await filterByPayment(page, "Part paid");
  await expect(listRows(page).filter({ hasText: invoice })).toHaveCount(1);
});

test("flow 15: a customer is refunded the unallocated balance of a credit note", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const credit = withVat(20);
  await postSalesDocument(page, "SCN", "ACME", "20", "Flow fourteen allowance");

  // Refund opens a customer refund for the whole balance. It settles the credit note, not an invoice.
  await openPaymentsTab(page, "SCN", credit);
  await documentDialog(page).getByRole("link", { name: "Refund" }).click();
  await page.waitForURL(/\/transactions\/SRF\?new=1/);
  const refund = paymentDialog(page, /refund/i);
  await expect(refund).toBeVisible();
  await expect(refund.locator('input[name="amount"]')).toHaveValue(credit);
  await payFromBank(page, refund);
  await expectNoError(page);

  // The credit note has nothing left.
  await openList(page, "SCN");
  await filterByPayment(page, "Paid");
  await expect(listRows(page).filter({ hasText: credit })).toHaveCount(1);
});

test("flow 16: an allocation on a posted receipt is removed with a reason and the money goes to another invoice", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const first = withVat(71);
  const second = withVat(73);
  await postSalesDocument(page, "SIN", "ACME", "71", "Flow fifteen A");
  await postSalesDocument(page, "SIN", "ACME", "73", "Flow fifteen B");

  // A receipt for the first invoice.
  await openPaymentsTab(page, "SIN", first);
  await documentDialog(page).getByRole("link", { name: "Record receipt" }).click();
  await page.waitForURL(/\/transactions\/SRC\?new=1/);
  await payFromBank(page, paymentDialog(page, /receipt/i));
  await expectNoError(page);

  // Open the posted receipt and remove its allocation. The dialog asks for a reason.
  await page.goto("/transactions/SRC");
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
  await openList(page, "SIN");
  await filterByPayment(page, "Unpaid");
  await expect(listRows(page).filter({ hasText: first })).toHaveCount(1);
  await filterByPayment(page, "Part paid");
  await expect(listRows(page).filter({ hasText: second })).toHaveCount(1);
});

test("flow 17: a double tap on an open invoice allocates what is open on it, and fills in a blank amount", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const total = withVat(61);
  await postSalesDocument(page, "SIN", "ACME", "61", "Flow sixteen goods");

  await openList(page, "SRC");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const receipt = paymentDialog(page, /receipt/i);
  await chooseByCode(receipt.locator('select[name="customer_id"]'), "ACME");
  const amount = receipt.locator('input[name="amount"]');
  const row = receipt.getByRole("row").filter({ hasText: total });
  const box = row.getByRole("textbox");
  // The tap is on the first cell, not on the allocation box, which keeps its own text selection.
  const tap = () => row.locator("td").first().dblclick();

  // With no amount entered, one double tap fills in the amount and the allocation.
  await expect(amount).toHaveValue("");
  await tap();
  await expect(amount).toHaveValue(total);
  await expect(box).toHaveValue(total);

  // An amount smaller than what is open refuses it, says what is left, and changes nothing.
  await box.fill("");
  await typeInto(amount, "10.00");
  await tap();
  await expect(receipt.getByRole("alert")).toContainText("is more than the 10.00 left to allocate");
  await expect(box).toHaveValue("");
  await expect(amount).toHaveValue("10.00");

  // An amount that is enough takes it, and leaves the rest on account.
  await typeInto(amount, "100.00");
  await tap();
  await expect(box).toHaveValue(total);
  await expect(receipt.getByText("On account")).toBeVisible();

  // Nothing is saved, so the invoice stays open.
  await receipt.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(receipt).toHaveCount(0);
});

test("flow 18: a supplier payment for three invoices prints a remittance advice listing all three, a draft prints with DRAFT and a void one with VOID", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "owner");

  // Three purchase invoices for one supplier. Their totals tell them apart: nets of 31, 37 and 41 at 23% VAT.
  const nets = ["31", "37", "41"];
  for (const [index, net] of nets.entries()) {
    await openList(page, "PIN");
    await startDocument(page, {
      party: "HARB",
      sales: false,
      supplierReference: `HARB-F18-${index + 1}`,
      lines: [{ description: `Flow eighteen ${index + 1}`, quantity: "1", price: net, gl: "6000", vat: "P23" }],
    });
    await documentDialog(page).getByRole("button", { name: "Save and post", exact: true }).click();
    await backOnList(page, "PIN");
    await expectNoError(page);
  }
  const totals = nets.map((net) => withVat(Number(net)));
  const sum = totals.reduce((acc, value) => acc + Number(value), 0).toFixed(2);

  // One supplier payment for all three, allocated oldest first, then posted.
  await openList(page, "PPY");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const payment = paymentDialog(page, /payment/i);
  await chooseByCode(payment.locator('select[name="supplier_id"]'), "HARB");
  await typeInto(payment.locator('input[name="amount"]'), sum);
  await payment.getByRole("button", { name: "Allocate oldest first" }).click();
  await payFromBank(page, payment);
  await expectNoError(page);

  // Print it. The page is a remittance advice that lists every invoice and what was applied to it.
  const row = listRows(page).filter({ hasText: sum }).first();
  await row.getByRole("link", { name: "Print", exact: true }).click();
  await page.waitForURL(/\/print\/PPY\//);
  const body = page.locator("body");
  await expect(body).toContainText("Remittance advice");
  await expect(body).toContainText("Harbour Supplies");
  for (const total of totals) await expect(body).toContainText(total);
  await expect(body).toContainText(sum);
  await expect(body).not.toContainText("DRAFT");
  await expect(body).not.toContainText("VOID");

  // A draft has no number and prints with DRAFT on it.
  await openList(page, "PPY");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const draft = paymentDialog(page, /payment/i);
  await chooseByCode(draft.locator('select[name="supplier_id"]'), "HARB");
  await typeInto(draft.locator('input[name="amount"]'), "5.55");
  await chooseByCode(draft.locator('select[name="bank_account_id"]'), BANK);
  await draft.getByRole("button", { name: "Save", exact: true }).click();
  await expect(draft).toHaveCount(0);
  await listRows(page).filter({ hasText: "5.55" }).first().getByRole("link", { name: "Print", exact: true }).click();
  await page.waitForURL(/\/print\/PPY\//);
  await expect(body).toContainText("DRAFT");
  await expect(body).toContainText("Not applied to any document");

  // Voiding the first payment makes its print say so, with the reason.
  await openList(page, "PPY");
  await listRows(page).filter({ hasText: sum }).first().locator("td").nth(1).click();
  const posted = paymentDialog(page, /payment/i);
  await posted.getByRole("button", { name: "Void", exact: true }).click();
  const voiding = page.getByRole("dialog", { name: /void/i });
  await typeInto(voiding.getByLabel("Void reason"), "Flow eighteen void");
  await voiding.getByRole("button", { name: /^void/i }).click();
  await expect(posted).toHaveCount(0);
  await listRows(page).filter({ hasText: sum }).first().getByRole("link", { name: "Print", exact: true }).click();
  await page.waitForURL(/\/print\/PPY\//);
  await expect(body).toContainText("VOID");
  await expect(body).toContainText("Voided: Flow eighteen void");
});
