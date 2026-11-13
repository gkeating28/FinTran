import path from "node:path";
import { apiAs } from "./api";
import { expect, test } from "./fixtures";
import { backOnList, documentDialog, expectNoError, openList, openRow, rowText, startDocument } from "./documents";
import { signIn } from "./sign-in";
import { uploadEInvoice } from "./upload";

// An e-invoice whose payable amount does not add up, so it is received as invalid and could be rejected.
const WRONG_TOTAL = path.join(__dirname, "files", "northside-np-9008-wrong-total.xml");

test("flow 8: a member does not see void, reject or the settings, and is refused when calling them directly", async ({ browser, page }) => {
  test.setTimeout(180_000);

  // The owner posts a purchase invoice for Vodafone: 1 at 10.00 plus VAT, 12.30.
  await signIn(page, "owner");
  await openList(page, "PIN");
  await startDocument(page, { party: "VOD", sales: false, supplierReference: "VOD-FLOW8", lines: [{ description: "Flow eight calls", quantity: "1", price: "10", gl: "6000", vat: "P23" }] });
  await documentDialog(page).getByRole("button", { name: "Save and post", exact: true }).click();
  await backOnList(page, "PIN");
  await expectNoError(page);
  expect(await rowText(page, "12.30")).toContain("Posted");

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  try {
    await signIn(member, "member");

    // The posted invoice has no Void for a member.
    await openList(member, "PIN");
    await openRow(member, "12.30");
    await expect(documentDialog(member).getByRole("button", { name: "Void", exact: true })).toHaveCount(0);

    // A received e-invoice that is invalid has no Reject for a member.
    const eDocumentId = await uploadEInvoice(member, WRONG_TOTAL);
    await expect(member.getByText("invalid", { exact: true })).toBeVisible();
    await expect(member.getByRole("button", { name: /^Reject/ })).toHaveCount(0);

    // The settings are not offered, and the Ask Qula settings page sends a member back to Admin.
    await member.goto("/admin");
    await expect(member.getByRole("link", { name: /GL codes/ })).toBeVisible();
    await expect(member.getByRole("link", { name: /AI settings/ })).toHaveCount(0);
    await expect(member.getByRole("link", { name: /Peppol settings/ })).toHaveCount(0);
    await member.goto("/ask-qula");
    await member.waitForURL((url) => url.pathname === "/admin");

    // Called directly, the database refuses each of them.
    const api = await apiAs("member");
    const [invoice] = await api.select<{ id: string }>("transaction_headers", "select=id&status=eq.posted&supplier_reference=eq.VOD-FLOW8");
    expect(invoice?.id, "the posted invoice, as the member sees it").toBeTruthy();
    const voided = await api.rpc("void_document", { p_header_id: invoice.id, p_reason: "Trying without the role" });
    expect(voided.status).toBeGreaterThanOrEqual(400);
    expect(voided.message).toContain("owner or admin");

    const rejected = await api.rpc("reject_e_document", { p_id: eDocumentId, p_reason: "Trying without the role" });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(rejected.message).toContain("owner or admin");

    const [settings] = await api.select<{ organisation_id: string; actions_enabled: boolean }>("ai_settings", "select=organisation_id,actions_enabled");
    expect(settings?.actions_enabled).toBe(true);
    const changed = await api.update("ai_settings", `organisation_id=eq.${settings.organisation_id}`, { actions_enabled: false });
    expect(changed.rows).toHaveLength(0);
    const [after] = await api.select<{ actions_enabled: boolean }>("ai_settings", `select=actions_enabled&organisation_id=eq.${settings.organisation_id}`);
    expect(after?.actions_enabled).toBe(true);

    // Still posted: the refusal changed nothing.
    await openList(member, "PIN");
    expect(await rowText(member, "12.30")).toContain("Posted");
  } finally {
    await memberContext.close();
  }
});
