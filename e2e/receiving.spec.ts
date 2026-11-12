import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectNoError, openList, press, rowText } from "./documents";
import { signIn } from "./sign-in";
import { uploadEInvoice as upload } from "./upload";

// Flow 6 uses the e-invoice that flow 5 imported, so the two run in order and flow 6 is skipped if flow 5 fails.
test.describe.configure({ mode: "serial" });

// Two valid Peppol invoices from a supplier the seed does not have. They share the number NP-1001 and differ only
// in a note, so the second is a different file with the same number.
const FIRST = path.join(__dirname, "files", "northside-np-1001.xml");
const RESENT = path.join(__dirname, "files", "northside-np-1001-resent.xml");

/** Rows of the received e-documents list that show the given document number. */
function receivedRows(page: Page, number: string) {
  return page.locator("tbody tr").filter({ has: page.getByRole("link", { name: number, exact: true }) });
}

function importDialog(page: Page) {
  return page.getByRole("dialog").filter({ has: page.locator("form#import-document") });
}

test("flow 5: a received e-invoice from a new supplier is uploaded, the supplier is created in the modal, and it is imported and posted", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  await upload(page, FIRST);
  const dialog = importDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("No supplier matched");

  // Create New opens the supplier form, filled in from the e-invoice.
  await dialog.getByLabel("Supplier code").selectOption({ label: "Create New" });
  const supplier = page.getByRole("dialog", { name: "Add supplier" });
  await expect(supplier).toBeVisible();
  await expect(supplier.locator('input[name="name"]')).toHaveValue("Northside Print");
  await supplier.getByRole("button", { name: "Save", exact: true }).click();
  await expect(supplier).toBeHidden();
  await expect(dialog.getByLabel("Supplier code")).toHaveValue(/[0-9a-f-]{36}/);
  await expect(dialog.getByLabel("Supplier code").locator("option:checked")).toContainText("Northside Print");

  // Import makes a draft purchase invoice and opens it.
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/transactions\/PI\?open=/);
  await expect(page.locator("form#purchase-document")).toBeVisible();
  await press(page, /^(save and )?post$/i);
  await expect(page.locator("form#purchase-document")).toHaveCount(0, { timeout: 30_000 });
  await expectNoError(page);

  await openList(page, "PI");
  const row = await rowText(page, "Northside");
  expect(row).toContain("Posted");
  expect(row).toContain("123.00");

  // The e-document now points at the posted invoice.
  await page.goto("/e-documents?direction=inbound");
  await expect(receivedRows(page, "NP-1001")).toHaveCount(1);
  await expect(receivedRows(page, "NP-1001").first()).toContainText("Imported");
});

test("flow 6: the same file again adds nothing, a different file with the same number is a duplicate, and an admin releases it", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // The same file opens the e-document already received. There is still one row for NP-1001.
  await page.goto("/e-documents?direction=inbound");
  const firstId = await receivedRows(page, "NP-1001").first().getByRole("link", { name: "NP-1001", exact: true }).getAttribute("href");
  const againId = await upload(page, FIRST);
  expect(firstId).toBe(`/e-documents/${againId}`);
  await page.goto("/e-documents?direction=inbound");
  await expect(receivedRows(page, "NP-1001")).toHaveCount(1);

  // A different file with the same number and sender is held as a duplicate.
  const duplicateId = await upload(page, RESENT);
  expect(`/e-documents/${duplicateId}`).not.toBe(firstId);
  await expect(page.getByText("duplicate", { exact: true })).toBeVisible();
  await page.goto("/e-documents?direction=inbound");
  await expect(receivedRows(page, "NP-1001")).toHaveCount(2);

  // An admin releases it, with a reason, and it can then be imported.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  try {
    await signIn(admin, "admin");
    await admin.goto(`/e-documents/${duplicateId}`);
    await admin.getByRole("button", { name: "Release duplicate", exact: true }).click();
    const release = admin.getByRole("dialog", { name: "Release duplicate" });
    await release.getByLabel("Reason").fill("The supplier sent a corrected copy");
    await release.getByRole("button", { name: "Release", exact: true }).click();
    await expect(importDialog(admin)).toBeVisible({ timeout: 30_000 });
    await expect(importDialog(admin)).toContainText("Matched supplier");
  } finally {
    await adminContext.close();
  }
});

