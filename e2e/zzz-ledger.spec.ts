import type { Browser, Locator, Page } from "@playwright/test";
import { apiAs } from "./api";
import { backOnList, documentDialog, expectNoError, listRows, openList, openRow, startDocument, typeInto } from "./documents";
import { expect, test } from "./fixtures";
import type { Role } from "./people";
import { signIn } from "./sign-in";

// The ledger screens (specs/QULAPLUS_LEDGER_SPEC.md, phase 8). The file is named to run after the journal export flows, whose first
// batch holds everything posted before it. The amounts and words are not used by any other flow. The flows have not been run
// before CI, so expect small fixes.
test.describe.configure({ mode: "serial" });

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

/** The journal form or the entry view, whichever is open. */
function ledgerDialog(page: Page): Locator {
  return page.getByRole("dialog").last();
}

test("flow 41: an owner sees the postings of the earlier flows in the Ledger and opens one, and a member sees no Ledger", async ({ browser, page }) => {
  test.setTimeout(120_000);
  await signIn(page, "owner");
  await page.getByRole("link", { name: "Ledger", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ledger", exact: true })).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(2);

  // Only the documents.
  await page.locator('select[name="source"]').selectOption("document");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page).toHaveURL(/source=document/);
  const documents = page.locator("tbody tr");
  await expect(documents.first()).toBeVisible();
  for (const text of await documents.allInnerTexts()) expect(text).toContain("Document");

  // An entry opens with its lines, and the debits equal the credits.
  await documents.first().locator("td").nth(1).click();
  const entry = ledgerDialog(page);
  await expect(entry.getByRole("table")).toBeVisible();
  const totals = entry.locator("tfoot td");
  await expect(totals.nth(1)).toHaveText((await totals.nth(2).innerText()).trim());
  await entry.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A member has no menu item, and the address sends them home.
  await as(browser, "member", async (member) => {
    await expect(member.getByRole("link", { name: "Ledger", exact: true })).toHaveCount(0);
    await member.goto("/ledger");
    await expect(member).toHaveURL(/\/$/);
    await member.goto("/ledger/trial-balance");
    await expect(member).toHaveURL(/\/$/);
  });
});

test("flow 42: an owner posts a manual journal, reverses it, and saves and deletes a draft", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  await page.goto("/ledger");
  await page.getByRole("button", { name: "New journal", exact: true }).click();
  const form = ledgerDialog(page);
  await expect(form.locator("form#manual-journal")).toBeVisible();
  await typeInto(form.locator('input[name="journal_description"]'), "Flow42 accrual");
  await chooseByCode(form.getByRole("combobox", { name: "GL code, line 1" }), "6000");
  await typeInto(form.getByLabel("Debit, line 1"), "77.25");
  await chooseByCode(form.getByRole("combobox", { name: "GL code, line 2" }), "4000");
  await typeInto(form.getByLabel("Credit, line 2"), "70.00");
  // Out by 7.25: it can be saved as a draft but not posted.
  await expect(form.getByTestId("journal-totals")).toContainText("out by 7.25");
  await expect(form.getByRole("button", { name: "Save and post", exact: true })).toBeDisabled();
  await typeInto(form.getByLabel("Credit, line 2"), "77.25");
  await expect(form.getByTestId("journal-totals")).toContainText("balanced");
  await form.getByRole("button", { name: "Save and post", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("The journal was posted.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.locator("tbody tr").filter({ hasText: "Flow42 accrual" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Posted");
  await expect(row).toContainText("77.25");

  // Reversed on a later date than its own, or today, as the form offers.
  await row.locator("td").nth(1).click();
  const entry = ledgerDialog(page);
  await entry.getByRole("button", { name: "Reverse", exact: true }).click();
  await entry.getByRole("button", { name: "Reverse journal", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("The journal was reversed.");
  await expect(page.locator("tbody tr").filter({ hasText: "Flow42 accrual" })).toHaveCount(2);
  await expect(page.locator("tbody tr").filter({ hasText: "Reversed" })).toHaveCount(1);

  // A draft is saved, comes back for editing and is deleted.
  await page.getByRole("button", { name: "New journal", exact: true }).click();
  const draft = ledgerDialog(page);
  await typeInto(draft.locator('input[name="journal_description"]'), "Flow42 draft");
  await chooseByCode(draft.getByRole("combobox", { name: "GL code, line 1" }), "6000");
  await typeInto(draft.getByLabel("Debit, line 1"), "5.00");
  await draft.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("The journal was saved as a draft.");
  const draftRow = page.locator("tbody tr").filter({ hasText: "Flow42 draft" });
  await expect(draftRow).toContainText("Draft");
  await draftRow.locator("td").nth(1).click();
  const editing = ledgerDialog(page);
  await expect(editing.locator('input[name="journal_description"]')).toHaveValue("Flow42 draft");
  // One line, and it cannot be posted: the journal needs two lines and a balance.
  await expect(editing.getByRole("button", { name: "Save and post", exact: true })).toBeDisabled();
  await editing.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("The draft was deleted.");
  await expect(page.locator("tbody tr").filter({ hasText: "Flow42 draft" })).toHaveCount(0);
  await expectNoError(page);
});

test("flow 43: the trial balance agrees, says the ledger reconciles, and an account's enquiry ends on its closing balance", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "owner");
  await page.goto("/ledger/trial-balance");
  await expect(page.getByRole("heading", { name: "Trial balance", exact: true })).toBeVisible();
  await expect(page.getByText("The ledger agrees with debtors, creditors and every bank account.")).toBeVisible();
  await expect(page.getByTestId("tb-debit")).toHaveText((await page.getByTestId("tb-credit").innerText()).trim());
  await expect(page.getByRole("table", { name: "Trial balance" })).toContainText("(agrees)");

  // The purchases account: its closing balance on the trial balance is the one the enquiry ends on.
  const purchases = page.getByRole("table", { name: "Trial balance" }).locator("tr").filter({ hasText: /^\s*6000/ });
  await expect(purchases).toHaveCount(1);
  const closing = (await purchases.locator("td").last().innerText()).trim();
  await purchases.getByRole("link").click();
  await expect(page.getByRole("heading", { name: /^6000/ })).toBeVisible();
  await expect(page.getByTestId("enquiry-closing")).toHaveText(closing);
  await expect(page.getByRole("table", { name: "Account enquiry" }).locator("tbody tr").nth(1)).toBeVisible();
});

test("flow 44: a posted document has a Ledger tab for an owner, listing the entry it made", async ({ browser, page }) => {
  test.setTimeout(180_000);
  // 41.00 plus 23% VAT of 9.43 is 50.43.
  await as(browser, "member", async (member) => {
    await openList(member, "PIN");
    await startDocument(member, { party: "VOD", sales: false, supplierReference: "VOD-FLOW44", lines: [{ description: "Flow44 ledger tab", quantity: "1", price: "41.00", gl: "6000", vat: "P23" }] });
    await documentDialog(member).getByRole("button", { name: "Save and post", exact: true }).click();
    await backOnList(member, "PIN");
    await expectNoError(member);
    // A member does not get the tab.
    await openRow(member, /50\.43/);
    await expect(member.getByRole("tab", { name: "Ledger", exact: true })).toHaveCount(0);
  });

  await signIn(page, "owner");
  await openList(page, "PIN");
  await openRow(page, /50\.43/);
  await page.getByRole("tab", { name: "Ledger", exact: true }).click();
  const entries = page.getByRole("table", { name: "Ledger entries" });
  await expect(entries).toBeVisible();
  await expect(entries.locator("tbody tr")).toHaveCount(1);
  await expect(entries).toContainText("Document");
  await expect(entries).toContainText("50.43");
});

test("flow 45: the GL code screen shows the role, Active and the external fields, and the organisation shows its mode", async ({ browser, page }) => {
  test.setTimeout(120_000);
  await signIn(page, "owner");
  await page.goto("/gl-codes");
  await listRows(page).filter({ hasText: /^\s*1100/ }).first().locator("td").nth(1).click();
  const gl = page.getByRole("dialog").last();
  await expect(gl).toContainText("System role: Debtors control");
  await expect(gl).toContainText("control account");
  await expect(gl.getByRole("checkbox", { name: /Active/ })).toBeDisabled();
  await expect(gl.locator('input[name="external_code"]')).toBeVisible();
  await expect(gl.locator('input[name="external_name"]')).toBeVisible();
  await expect(gl.locator('input[name="report_group"]')).toBeVisible();
  await expect(gl.locator('select[name="account_type"] optgroup')).toHaveCount(5);
  await gl.getByRole("button", { name: "Cancel", exact: true }).click();

  const api = await apiAs("owner");
  const [row] = await api.select<{ organisation_id: string }>("organisation_defaults", `select=organisation_id&peppol_id=eq.${ORG_ONE_PEPPOL}`);
  expect(row?.organisation_id, "the id of Qula Test One").toBeTruthy();
  await page.goto(`/organisations?edit=${row.organisation_id}&tab=accounting`);
  await expect(page.getByTestId("ledger-mode")).toBeVisible();
  const mode = (await page.getByTestId("ledger-mode").innerText()).toLowerCase();
  expect(mode.startsWith("book") || mode.startsWith("feed")).toBe(true);
  // Only an owner can switch, and the switch waits for a reason.
  const target = mode.startsWith("book") ? "feed" : "book of record";
  await expect(page.getByRole("button", { name: `Switch to ${target}`, exact: true })).toBeDisabled();
  await as(browser, "admin", async (admin) => {
    await admin.goto(`/organisations?edit=${row.organisation_id}&tab=accounting`);
    await expect(admin.getByText("Only an owner can switch the mode.")).toBeVisible();
    await expect(admin.getByRole("button", { name: /^Switch to/ })).toHaveCount(0);
  });
});
