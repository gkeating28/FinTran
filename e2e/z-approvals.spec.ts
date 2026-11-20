import type { Browser, Locator, Page } from "@playwright/test";
import { apiAs } from "./api";
import { expect, test } from "./fixtures";
import { backOnList, documentDialog, expectNoError, lineRows, openList, openRow, press, rowText, saveDocument, startDocument, typeInto } from "./documents";
import { signIn } from "./sign-in";
import type { Role } from "./people";

// Purchase approvals and price tolerance (specs/QULAPLUS_APPROVALS_SPEC.md). This file is named so that it runs after
// every other one: these flows leave a rule on purchase invoices and many Vodafone documents on the list, and the
// other flows look for their own rows by supplier name. The amounts are not used by any other flow. The rule is from
// 7,000.00, with VAT, so nothing another flow posts is held back, and the last flow removes it again.
//
// Flow 25 runs first on purpose: it is the proof that with no rule nothing changes, so it must run before one exists.

const ORG_ONE_PEPPOL = "IE1234567T";

/** Runs something as one of the test people in a browser of their own, and closes it afterwards. */
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

/** A draft purchase invoice for Vodafone, with one line at the price, saved and closed. */
async function draftInvoice(page: Page, price: string, reference: string) {
  await openList(page, "PIN");
  await startDocument(page, { party: "VOD", sales: false, supplierReference: reference, lines: [{ description: `Approval ${reference}`, quantity: "1", price, gl: "6000", vat: "P23" }] });
  await saveDocument(page);
}

/** Opens the invoice with this total from the list. */
async function openInvoice(page: Page, total: RegExp) {
  await openList(page, "PIN");
  await openRow(page, total);
}

function button(page: Page, name: string | RegExp): Locator {
  return documentDialog(page).getByRole("button", { name, exact: typeof name === "string" });
}

/** Presses Request approval and waits until the document says it is waiting. */
async function requestApproval(page: Page, total: RegExp) {
  await openInvoice(page, total);
  await expect(async () => {
    if (await button(page, "Request approval").isVisible()) await button(page, "Request approval").click();
    await expect(documentDialog(page).getByText(/Waiting for approval from an admin or owner/)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

/** Changes the price on one line of the open document. */
async function setLinePrice(page: Page, line: number, price: string) {
  await lineRows(page).nth(line - 1).locator("td").nth(2).click();
  const editor = page.locator("form").filter({ has: page.getByRole("button", { name: "Save line" }) });
  await typeInto(editor.getByLabel("Price", { exact: true }), price);
  await editor.getByRole("button", { name: "Save line" }).click();
  await expect(editor).toHaveCount(0);
}

async function setLineQuantity(page: Page, line: number, quantity: string) {
  await lineRows(page).nth(line - 1).locator("td").nth(2).click();
  const editor = page.locator("form").filter({ has: page.getByRole("button", { name: "Save line" }) });
  await typeInto(editor.getByLabel("Quantity", { exact: true }), quantity);
  await editor.getByRole("button", { name: "Save line" }).click();
  await expect(editor).toHaveCount(0);
}

async function organisationOneId() {
  const api = await apiAs("owner");
  const [row] = await api.select<{ organisation_id: string }>("organisation_defaults", `select=organisation_id&peppol_id=eq.${ORG_ONE_PEPPOL}`);
  expect(row?.organisation_id, "the id of Qula Test One").toBeTruthy();
  return { api, id: row.organisation_id };
}

test("flow 25: with no rule, a member posts a large purchase invoice as before", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "member");
  await openList(page, "PIN");
  await startDocument(page, { party: "VOD", sales: false, supplierReference: "VOD-FLOW25", lines: [{ description: "Flow twenty five freight", quantity: "1", price: "7400", gl: "6000", vat: "P23" }] });
  await documentDialog(page).getByRole("button", { name: "Save and post", exact: true }).click();
  await backOnList(page, "PIN");
  await expectNoError(page);
  expect(await rowText(page, /9,?102\.00/)).toContain("Posted");
});

test("flow 20: an owner sets a rule, and a member's invoice over it needs a request, an approval and then a post", async ({ browser, page }) => {
  test.setTimeout(240_000);

  // The owner sets a rule: from 7,000.00 a purchase invoice needs an admin or owner.
  await signIn(page, "owner");
  await page.goto("/approval-rules");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const rule = page.getByRole("dialog").filter({ has: page.locator('input[name="amount"]') });
  await rule.locator('select[name="transaction_type_id"]').selectOption({ label: "PIN Purchase invoice" });
  await typeInto(rule.locator('input[name="amount"]'), "7000");
  await rule.getByRole("button", { name: "Save", exact: true }).click();
  await expect(rule).toHaveCount(0);
  await expect(page.locator("tbody tr").filter({ hasText: "PIN" })).toContainText(/7,?000\.00/);

  // The member's invoice is 6,100.00 plus VAT, 7,503.00. There is no Post, only Request approval.
  await as(browser, "member", async (member) => {
    await draftInvoice(member, "6100", "VOD-FLOW20");
    await openInvoice(member, /7,?503\.00/);
    await expect(documentDialog(member).getByText(/Needs approval from an admin or owner/)).toBeVisible();
    await expect(button(member, "Post")).toHaveCount(0);
    await expect(button(member, "Request approval")).toBeVisible();
    await requestApproval(member, /7,?503\.00/);
  });

  // The admin sees who asked, and approves.
  await as(browser, "admin", async (admin) => {
    await openInvoice(admin, /7,?503\.00/);
    await expect(documentDialog(admin).getByText(/Mary Member asked for approval/)).toBeVisible();
    await expect(async () => {
      if (await button(admin, "Approve").isVisible()) await button(admin, "Approve").click();
      await expect(documentDialog(admin).getByText(/Approved by Adam Admin/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });

  // Now the member can post it.
  await as(browser, "member", async (member) => {
    await openInvoice(member, /7,?503\.00/);
    await expect(button(member, "Post")).toBeVisible();
    // A click made before the page is ready can be lost, so press again until the document has closed.
    await expect(async () => {
      if (await button(member, "Post").isVisible()) await press(member, /^Post$/);
      await expect(member.locator("form#purchase-document")).toHaveCount(0, { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await backOnList(member, "PIN");
    await expectNoError(member);
    expect(await rowText(member, /7,?503\.00/)).toContain("Posted");
  });
});

test("flow 21: editing an approved invoice cancels the approval", async ({ browser }) => {
  test.setTimeout(240_000);
  await as(browser, "member", async (member) => {
    await draftInvoice(member, "6200", "VOD-FLOW21");
    await requestApproval(member, /7,?626\.00/);
  });
  await as(browser, "admin", async (admin) => {
    await openInvoice(admin, /7,?626\.00/);
    await expect(async () => {
      if (await button(admin, "Approve").isVisible()) await button(admin, "Approve").click();
      await expect(documentDialog(admin).getByText(/Approved by Adam Admin/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });
  await as(browser, "member", async (member) => {
    // Approved, so it can be posted. Changing the quantity to 2 makes it a different document: 15,252.00.
    await openInvoice(member, /7,?626\.00/);
    await expect(button(member, "Post")).toBeVisible();
    await setLineQuantity(member, 1, "2");
    await saveDocument(member);
    await openInvoice(member, /15,?252\.00/);
    await expect(documentDialog(member).getByText(/Needs approval from an admin or owner/)).toBeVisible();
    await expect(button(member, "Post")).toHaveCount(0);
    await expect(button(member, "Request approval")).toBeVisible();
  });
});

test("flow 22: a refusal needs a reason, the member sees it, changes the invoice and asks again", async ({ browser }) => {
  test.setTimeout(240_000);
  await as(browser, "member", async (member) => {
    await draftInvoice(member, "6300", "VOD-FLOW22");
    await requestApproval(member, /7,?749\.00/);
  });
  await as(browser, "admin", async (admin) => {
    await openInvoice(admin, /7,?749\.00/);
    await expect(async () => {
      if (await button(admin, "Refuse").isVisible()) await button(admin, "Refuse").click();
      await expect(admin.getByRole("dialog", { name: "Refuse approval" })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    const refusing = admin.getByRole("dialog", { name: "Refuse approval" });
    await typeInto(refusing.getByLabel("Reason"), "Too dear for this supplier");
    await refusing.getByRole("button", { name: "Refuse", exact: true }).click();
    await expect(documentDialog(admin).getByText(/refused by Adam Admin: Too dear for this supplier/)).toBeVisible();
  });
  await as(browser, "member", async (member) => {
    await openInvoice(member, /7,?749\.00/);
    await expect(documentDialog(member).getByText(/Too dear for this supplier/)).toBeVisible();
    // Change the quantity to 2 and ask again, which saves first: 15,498.00.
    await setLineQuantity(member, 1, "2");
    await expect(async () => {
      if (await button(member, "Save and request approval").isVisible()) await button(member, "Save and request approval").click();
      await expect(documentDialog(member).getByText(/Waiting for approval from an admin or owner/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });
});

test("flow 23: an invoice raised from an order and priced over the tolerance needs approval, and one within it does not", async ({ browser }) => {
  test.setTimeout(300_000);

  // A tolerance of 5 per cent, set as an owner would on the Organisations screen.
  const { api, id } = await organisationOneId();
  const set = await api.update("organisation_defaults", `organisation_id=eq.${id}`, { price_tolerance_percent: 5, price_tolerance_needs_approval: true });
  expect(set.rows).toHaveLength(1);

  await as(browser, "owner", async (owner) => {
    // Two purchase orders, for 111.00 and 112.00 plus VAT (136.53 and 137.76), activated and turned into invoices.
    for (const [reference, orderPrice, orderTotal, newPrice] of [["VOD-FLOW23A", "111", /136\.53/, "115"], ["VOD-FLOW23B", "112", /137\.76/, "119"]] as const) {
      await openList(owner, "POR");
      await startDocument(owner, { party: "VOD", sales: false, lines: [{ description: `Flow twenty three ${reference}`, quantity: "1", price: orderPrice, gl: "6000", vat: "P23" }] });
      await saveDocument(owner);
      await openRow(owner, orderTotal);
      await press(owner, /activate order$/i);
      await expect(button(owner, /close order$/i)).toBeVisible();
      await press(owner, /create invoice$/i);
      await owner.waitForURL(/\/transactions\/PIN\?open=/);
      await expect(owner.locator("form#purchase-document")).toBeVisible();
      await typeInto(owner.locator('input[name="supplier_reference"]'), reference);
      await setLinePrice(owner, 1, newPrice);
      await saveDocument(owner);
    }

    // 115.00 is 3.6 per cent over 111.00: within. 119.00 is 6.3 per cent over 112.00: needs approval, and the line says so.
    await openInvoice(owner, /141\.45/);
    await expect(button(owner, "Post")).toBeVisible();
    await expect(button(owner, "Request approval")).toHaveCount(0);
    await documentDialog(owner).getByRole("button", { name: "Cancel", exact: true }).click();

    await openInvoice(owner, /146\.37/);
    await expect(documentDialog(owner).getByText(/Needs approval from an admin or owner because of a price over the order/)).toBeVisible();
    await expect(documentDialog(owner).getByText("Over order price")).toBeVisible();
    await expect(button(owner, "Post")).toHaveCount(0);
  });
});

test("flow 24: Ask Qula shows no Confirm button for a draft that needs approval", async ({ browser }) => {
  test.setTimeout(180_000);
  await as(browser, "owner", async (page) => {
    // 6,400.00 plus VAT, 7,872.00, for Harbour Supplies: over the rule.
    await openList(page, "PIN");
    await startDocument(page, { party: "HARB", sales: false, supplierReference: "HARB-FLOW24", lines: [{ description: "Flow twenty four rope", quantity: "1", price: "6400", gl: "6000", vat: "P23" }] });
    await saveDocument(page);

    const drawer = page.getByRole("dialog", { name: /^Ask Qula/ });
    await page.getByRole("button", { name: "Ask Qula", exact: true }).click();
    await expect(drawer).toBeVisible();
    const exchanges = drawer.getByRole("log").locator("article:not([aria-live])");
    const before = await exchanges.count();
    await drawer.getByLabel("Question").fill("Post the draft for Harbour");
    await drawer.getByRole("button", { name: "Send", exact: true }).click();
    await expect(exchanges).toHaveCount(before + 2, { timeout: 30_000 });

    await expect(drawer.getByText(/Qula cannot ask for or give approval/), `the card, in a log that said: ${await drawer.getByRole("log").innerText()}`).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Post it", exact: true })).toHaveCount(0);
    expect(await rowText(page, /7,?872\.00/)).toContain("Draft");
  });
});

test("flow 26: a request emails each approver and not the requester, and the decision emails the requester", async ({ browser }) => {
  test.setTimeout(240_000);
  const { api } = await organisationOneId();
  const subject = encodeURIComponent("*7,995.00*");

  await as(browser, "member", async (member) => {
    // 6,500.00 plus VAT, 7,995.00.
    await draftInvoice(member, "6500", "VOD-FLOW26");
    await requestApproval(member, /7,?995\.00/);
  });
  // The mock adapter accepts every email, so each one is recorded as sent and nothing leaves the system.
  const asked = await api.select<{ recipient_email: string; status: string }>("email_outbox", `select=recipient_email,status&reason=eq.approval%20requested&subject=like.${subject}`);
  expect(asked.map((row) => row.recipient_email).sort()).toEqual(["admin@qula.test", "owner@qula.test"]);
  expect(asked.every((row) => row.status === "sent")).toBe(true);

  await as(browser, "admin", async (admin) => {
    await openInvoice(admin, /7,?995\.00/);
    await expect(async () => {
      if (await button(admin, "Approve").isVisible()) await button(admin, "Approve").click();
      await expect(documentDialog(admin).getByText(/Approved by Adam Admin/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });
  const decided = await api.select<{ recipient_email: string; status: string }>("email_outbox", `select=recipient_email,status&reason=eq.approved&body=like.${subject}`);
  expect(decided).toEqual([{ recipient_email: "member@qula.test", status: "sent" }]);

  // Leave things as they were found: no rule and no tolerance.
  const { id } = await organisationOneId();
  const owner = await apiAs("owner");
  await owner.update("organisation_defaults", `organisation_id=eq.${id}`, { price_tolerance_percent: null });
  const rules = await owner.select<{ id: string }>("approval_rules", "select=id");
  for (const row of rules) await owner.remove("approval_rules", `id=eq.${row.id}`);
});
