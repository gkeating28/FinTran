import type { Browser, Locator, Page } from "@playwright/test";
import { apiAs } from "./api";
import { expect, test } from "./fixtures";
import { backOnList, documentDialog, expectNoError, listRows, openList, rowText, startDocument, typeInto } from "./documents";
import type { Role } from "./people";
import { signIn } from "./sign-in";

// Payment approvals, supplier bank details and payment runs (specs/QULAPLUS_PAYMENT_APPROVALS_SPEC.md). They run after
// the payment flows, which offer the standard payment types and add the bank account these pay from, and after the other
// approvals flows, which leave no rule behind. The rule here is from 9,000.00 on a supplier payment, and the last flow
// removes it. Every amount is one no other flow uses. These flows have not been run before CI, so expect small fixes.
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

/** The total of a document of net price `net` at 23% VAT. */
function withVat(net: number) {
  return (Math.round(net * 123) / 100).toFixed(2);
}

/** A pattern for an amount the grids may show with a thousands separator. */
function amount(total: string) {
  const [whole, cents] = total.split(".");
  const grouped = whole.length > 3 ? `${whole.slice(0, -3)},?${whole.slice(-3)}` : whole;
  // The text of a row has no gaps between its cells, so an exact match is not possible. Each flow uses amounts of its own.
  return new RegExp(`${grouped}\\.${cents}`);
}

/** Posts a purchase invoice for a supplier, of one line at the net price. */
async function postInvoice(page: Page, supplier: "VOD" | "HARB", net: number, reference: string) {
  await openList(page, "PIN");
  await startDocument(page, { party: supplier, sales: false, supplierReference: reference, lines: [{ description: `Payments ${reference}`, quantity: "1", price: String(net), gl: "6000", vat: "P23" }] });
  await documentDialog(page).getByRole("button", { name: "Save and post", exact: true }).click();
  await backOnList(page, "PIN");
  await expectNoError(page);
  expect(await rowText(page, amount(withVat(net)))).toContain("Posted");
}

function paymentForm(page: Page): Locator {
  return page.getByRole("dialog").filter({ has: page.locator("form#payment-document") });
}

/** Saves a draft supplier payment that pays the invoice with this total in full, and returns once the form has closed. */
async function draftPayment(page: Page, supplier: "VOD" | "HARB", total: string) {
  await openList(page, "PPY");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = paymentForm(page);
  await chooseByCode(dialog.locator('select[name="supplier_id"]'), supplier);
  await typeInto(dialog.locator('input[name="amount"]'), total);
  const box = dialog.getByRole("row").filter({ hasText: amount(total) }).getByRole("textbox");
  await typeInto(box, total);
  await chooseByCode(dialog.locator('select[name="bank_account_id"]'), BANK);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("form#payment-document")).toHaveCount(0);
}

/** Opens the payment on the open list with this total. */
async function openPayment(page: Page, total: string) {
  await openList(page, "PPY");
  const row = listRows(page).filter({ hasText: amount(total) }).first();
  await expect(row).toBeVisible();
  await row.locator("td").nth(1).click();
  await expect(page.locator("form#payment-document")).toBeVisible();
}

function button(page: Page, name: string): Locator {
  return paymentForm(page).getByRole("button", { name, exact: true });
}

/** Presses a button on the open payment until the form closes: the first click can come before the page is ready. */
async function pressAndClose(page: Page, name: string) {
  await expect(async () => {
    if (await page.locator("form#payment-document").isVisible()) await button(page, name).click();
    await expect(page.locator("form#payment-document")).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

/** Opens the draft run on the Payment runs screen. Earlier flows leave posted runs on it, which sort first. */
async function openDraftRun(page: Page) {
  await page.locator("tbody tr").filter({ hasText: "Draft" }).first().getByRole("button", { name: "Open" }).click();
}

async function organisationOneId() {
  const api = await apiAs("owner");
  const [row] = await api.select<{ organisation_id: string }>("organisation_defaults", `select=organisation_id&peppol_id=eq.${ORG_ONE_PEPPOL}`);
  expect(row?.organisation_id, "the id of Qula Test One").toBeTruthy();
  return { api, id: row.organisation_id };
}

test("flow 28: an owner sets a payment rule, and a member's payment over it is requested, approved by an admin and then posted", async ({ browser, page }) => {
  test.setTimeout(300_000);

  // The owner sets a rule: from 9,000.00 a supplier payment needs an admin or owner.
  await signIn(page, "owner");
  await page.goto("/approval-rules");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const rule = page.getByRole("dialog").filter({ has: page.locator('input[name="amount"]') });
  await chooseByCode(rule.locator('select[name="transaction_type_id"]'), "PPY");
  await typeInto(rule.locator('input[name="amount"]'), "9000");
  await rule.getByRole("button", { name: "Save", exact: true }).click();
  await expect(rule).toHaveCount(0);
  await expect(page.locator("tbody tr").filter({ hasText: "PPY" })).toContainText(/9,?000\.00/);

  // 8,000.00 plus VAT is 9,840.00.
  const total = withVat(8000);
  await as(browser, "member", async (member) => {
    await postInvoice(member, "VOD", 8000, "VOD-FLOW28");
    await draftPayment(member, "VOD", total);
    await openPayment(member, total);
    await expect(paymentForm(member).getByText(/Needs approval from an admin or owner/)).toBeVisible();
    await expect(button(member, "Post")).toHaveCount(0);
    await pressAndClose(member, "Request approval");
  });
  await as(browser, "admin", async (admin) => {
    await openPayment(admin, total);
    await expect(paymentForm(admin).getByText(/Mary Member asked for approval/)).toBeVisible();
    await pressAndClose(admin, "Approve");
  });
  await as(browser, "member", async (member) => {
    await openPayment(member, total);
    await expect(button(member, "Post")).toBeVisible();
    await pressAndClose(member, "Post");
    await openList(member, "PPY");
    expect(await rowText(member, amount(total))).toContain("Posted");
  });
});

test("flow 29: the person who asked can never approve, and another person with the role can", async ({ browser }) => {
  test.setTimeout(240_000);
  const total = withVat(8100);
  await as(browser, "admin", async (admin) => {
    await postInvoice(admin, "VOD", 8100, "VOD-FLOW29");
    await draftPayment(admin, "VOD", total);
    await openPayment(admin, total);
    await pressAndClose(admin, "Request approval");
    // The admin asked, so there is no Approve or Refuse, though their role is high enough.
    await openPayment(admin, total);
    await expect(paymentForm(admin).getByText(/Waiting for approval from an admin or owner/)).toBeVisible();
    await expect(button(admin, "Approve")).toHaveCount(0);
    await expect(button(admin, "Refuse")).toHaveCount(0);
  });
  await as(browser, "owner", async (owner) => {
    await openPayment(owner, total);
    await expect(paymentForm(owner).getByText(/Adam Admin asked for approval/)).toBeVisible();
    await pressAndClose(owner, "Approve");
  });
});

test("flow 30: changing a requested payment cancels the request", async ({ browser }) => {
  test.setTimeout(240_000);
  const total = withVat(8200);
  await as(browser, "member", async (member) => {
    await postInvoice(member, "VOD", 8200, "VOD-FLOW30");
    await draftPayment(member, "VOD", total);
    await openPayment(member, total);
    await pressAndClose(member, "Request approval");
    await openPayment(member, total);
    await expect(paymentForm(member).getByText(/Waiting for approval/)).toBeVisible();
    // A change to the payment, here its bank reference, saves and sends it back to needing approval.
    await typeInto(paymentForm(member).locator('input[name="bank_reference"]'), "CHANGED-30");
    await pressAndClose(member, "Save");
    await openPayment(member, total);
    await expect(paymentForm(member).getByText(/Needs approval from an admin or owner/)).toBeVisible();
    await expect(button(member, "Request approval")).toBeVisible();
  });
});

test("flow 31: a changed supplier IBAN holds a small payment to that supplier, and a supplier with no change is not held", async ({ browser }) => {
  test.setTimeout(300_000);
  const { api, id } = await organisationOneId();
  const set = await api.update("organisation_defaults", `organisation_id=eq.${id}`, { bank_change_days: 14 });
  expect(set.rows).toHaveLength(1);

  // Harbour's IBAN is set and then changed, as a member can on the supplier form.
  const member = await apiAs("member");
  const first = await member.update("suppliers", "code=eq.HARB", { iban: "IE29AIBK93115212345678" });
  expect(first.rows.length).toBeGreaterThan(0);
  const second = await member.update("suppliers", "code=eq.HARB", { iban: "GB29NWBK60161331926819" });
  expect(second.rows.length).toBeGreaterThan(0);
  const changes = await api.select<{ new_iban: string }>("supplier_bank_changes", "select=new_iban&new_iban=eq.GB29NWBK60161331926819");
  expect(changes.length).toBeGreaterThan(0);

  const held = withVat(50);
  const free = withVat(52);
  await as(browser, "member", async (page) => {
    await postInvoice(page, "HARB", 50, "HARB-FLOW31");
    await draftPayment(page, "HARB", held);
    await openPayment(page, held);
    await expect(paymentForm(page).getByText(/bank details changing recently/)).toBeVisible();
    await expect(button(page, "Post")).toHaveCount(0);
    await expect(button(page, "Request approval")).toBeVisible();
    await button(page, "Cancel").click();

    // Vodafone's details never changed, so a small payment posts as before.
    await postInvoice(page, "VOD", 52, "VOD-FLOW31");
    await openList(page, "PPY");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = paymentForm(page);
    await chooseByCode(dialog.locator('select[name="supplier_id"]'), "VOD");
    await typeInto(dialog.locator('input[name="amount"]'), free);
    await typeInto(dialog.getByRole("row").filter({ hasText: amount(free) }).getByRole("textbox"), free);
    await chooseByCode(dialog.locator('select[name="bank_account_id"]'), BANK);
    await dialog.getByRole("button", { name: "Save and post", exact: true }).click();
    await expect(page.locator("form#payment-document")).toHaveCount(0);
    await openList(page, "PPY");
    expect(await rowText(page, amount(free))).toContain("Posted");
  });

  // Switch the window off again so the later flows are not held back by it.
  const off = await api.update("organisation_defaults", `organisation_id=eq.${id}`, { bank_change_days: null });
  expect(off.rows).toHaveLength(1);
});

test("flow 32: a payment run of two suppliers is made, approved by an admin who did not ask, posted, and every payment is posted", async ({ browser }) => {
  test.setTimeout(360_000);
  // 4,000 and 2,000 for Vodafone and 3,000 for Harbour, plus VAT: 11,070.00 in all, over the rule.
  await as(browser, "member", async (member) => {
    await postInvoice(member, "VOD", 4000, "VOD-FLOW32A");
    await postInvoice(member, "HARB", 3000, "HARB-FLOW32");
    await postInvoice(member, "VOD", 2000, "VOD-FLOW32B");
    await member.goto("/payment-runs");
    await member.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = member.getByRole("dialog").filter({ has: member.getByRole("button", { name: "Make the run" }) });
    for (const net of [4000, 3000, 2000]) {
      await dialog.getByRole("row").filter({ hasText: amount(withVat(net)) }).getByRole("checkbox").check();
    }
    await expect(dialog.getByRole("status")).toContainText(/3 invoices for 2 suppliers/);
    await dialog.getByRole("button", { name: "Make the run" }).click();
    const run = member.getByRole("dialog").filter({ hasText: /Payment run RUN-/ });
    await expect(run).toBeVisible();
    await expect(run.getByText(/Needs approval from an admin or owner/)).toBeVisible();
    await expect(run.getByRole("button", { name: "Post run" })).toHaveCount(0);
    await expect(async () => {
      if (await run.getByRole("button", { name: "Request approval" }).isVisible()) await run.getByRole("button", { name: "Request approval" }).click();
      await expect(run.getByText(/Waiting for approval from an admin or owner/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });
  await as(browser, "admin", async (admin) => {
    await admin.goto("/payment-runs");
    await openDraftRun(admin);
    const run = admin.getByRole("dialog").filter({ hasText: /Payment run RUN-/ });
    await expect(run.getByText(/Mary Member asked for approval/)).toBeVisible();
    await expect(async () => {
      if (await run.getByRole("button", { name: "Approve" }).isVisible()) await run.getByRole("button", { name: "Approve" }).click();
      await expect(run.getByText(/Approved by Adam Admin/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });
  await as(browser, "member", async (member) => {
    await member.goto("/payment-runs");
    await openDraftRun(member);
    const run = member.getByRole("dialog").filter({ hasText: /Payment run RUN-/ });
    await expect(async () => {
      if (await run.getByRole("button", { name: "Post run" }).isVisible()) await run.getByRole("button", { name: "Post run" }).click();
      await expect(run.getByText(/Every payment in the run is posted/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    const api = await apiAs("member");
    const posted = await api.select<{ id: string }>("payments", "select=id&status=eq.posted&payment_run_id=not.is.null");
    expect(posted.length).toBeGreaterThanOrEqual(2);
  });
});

test("flow 33: a payment in a run cannot be posted alone, and taking a supplier out of an approved run cancels the approval", async ({ browser }) => {
  test.setTimeout(360_000);
  // Vodafone 4,500 and 4,600 plus VAT is 11,193.00, over the rule on its own. Harbour 110 plus VAT is 135.30.
  const vod = withVat(4500 + 4600);
  await as(browser, "member", async (member) => {
    await postInvoice(member, "VOD", 4500, "VOD-FLOW33A");
    await postInvoice(member, "VOD", 4600, "VOD-FLOW33B");
    await postInvoice(member, "HARB", 110, "HARB-FLOW33");
    await member.goto("/payment-runs");
    await member.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = member.getByRole("dialog").filter({ has: member.getByRole("button", { name: "Make the run" }) });
    for (const net of [4500, 4600, 110]) {
      await dialog.getByRole("row").filter({ hasText: amount(withVat(net)) }).getByRole("checkbox").check();
    }
    await dialog.getByRole("button", { name: "Make the run" }).click();
    const run = member.getByRole("dialog").filter({ hasText: /Payment run RUN-/ });
    await expect(run).toBeVisible();
    await expect(async () => {
      if (await run.getByRole("button", { name: "Request approval" }).isVisible()) await run.getByRole("button", { name: "Request approval" }).click();
      await expect(run.getByText(/Waiting for approval/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });
  await as(browser, "admin", async (admin) => {
    await admin.goto("/payment-runs");
    await openDraftRun(admin);
    const run = admin.getByRole("dialog").filter({ hasText: /Payment run RUN-/ });
    await expect(async () => {
      if (await run.getByRole("button", { name: "Approve" }).isVisible()) await run.getByRole("button", { name: "Approve" }).click();
      await expect(run.getByText(/Approved by Adam Admin/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });
  await as(browser, "member", async (member) => {
    // The Vodafone payment of the run cannot be posted on its own.
    await openPayment(member, vod);
    await expect(button(member, "Post")).toBeVisible();
    await button(member, "Post").click();
    await expect(paymentForm(member).getByRole("alert")).toContainText(/part of payment run RUN-\d+\. Post the run instead/);
    await button(member, "Cancel").click();

    // Taking Harbour out of the approved run sends it back to needing approval, because Vodafone alone is still over the rule.
    await member.goto("/payment-runs");
    await openDraftRun(member);
    const run = member.getByRole("dialog").filter({ hasText: /Payment run RUN-/ });
    await expect(run.getByRole("button", { name: "Post run" })).toBeVisible();
    await expect(async () => {
      const row = run.getByRole("row").filter({ hasText: "Harbour" });
      if (await row.getByRole("button", { name: "Take out" }).isVisible()) await row.getByRole("button", { name: "Take out" }).click();
      await expect(run.getByText(/Needs approval from an admin or owner/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await expect(run.getByRole("button", { name: "Post run" })).toHaveCount(0);
    await expect(run.getByRole("button", { name: "Request approval" })).toBeVisible();
  });
});

test("flow 34: with the mock email adapter a payment request emails each approver and not the requester, and the decision emails the requester", async () => {
  test.setTimeout(120_000);
  const { api, id } = await organisationOneId();
  const subject = encodeURIComponent("*9,840.00*");

  // The request of flow 28: to the owner and the admin, not to the member who asked.
  const asked = await api.select<{ recipient_email: string; status: string }>("email_outbox", `select=recipient_email,status&reason=eq.approval%20requested&subject=like.${subject}`);
  expect(asked.map((row) => row.recipient_email).sort()).toEqual(["admin@qula.test", "owner@qula.test"]);
  expect(asked.every((row) => row.status === "sent")).toBe(true);
  const decided = await api.select<{ recipient_email: string; status: string }>("email_outbox", `select=recipient_email,status&reason=eq.approved&body=like.${subject}`);
  expect(decided).toEqual([{ recipient_email: "member@qula.test", status: "sent" }]);

  // The run of flow 32 emailed its approvers too.
  const runs = await api.select<{ recipient_email: string }>("email_outbox", "select=recipient_email&run_id=not.is.null&reason=eq.approval%20requested");
  expect(runs.length).toBeGreaterThanOrEqual(2);
  expect(runs.some((row) => row.recipient_email === "member@qula.test")).toBe(false);

  // Leave things as they were found: no rule and no window.
  const owner = await apiAs("owner");
  await owner.update("organisation_defaults", `organisation_id=eq.${id}`, { bank_change_days: null });
  const rules = await owner.select<{ id: string }>("approval_rules", "select=id");
  for (const row of rules) await owner.remove("approval_rules", `id=eq.${row.id}`);
});
