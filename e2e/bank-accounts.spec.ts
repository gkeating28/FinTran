import { apiAs } from "./api";
import { expect, test } from "./fixtures";
import { expectNoError } from "./documents";
import { signIn } from "./sign-in";

// Payments release A: the Bank accounts setup list. The owner adds accounts, a member can only look.
test("flow 9: bank accounts are set up by an owner, and a member can only read them", async ({ browser, page }) => {
  test.setTimeout(120_000);

  await signIn(page, "owner");
  await page.goto("/bank-accounts");
  await expectNoError(page);
  await expect(page.getByRole("heading", { name: "Bank accounts" })).toBeVisible();

  // An IBAN typed with spaces and lower case is saved in one form, and a bad one is refused with a plain message.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog");
  // A form opens with the first field to type in focused. Here that is Code, not the Currency list below it.
  await expect(dialog.getByLabel("Code")).toBeFocused();
  await dialog.getByLabel("Code").fill("e2e-main");
  await dialog.getByLabel("Name").fill("Flow nine current account");
  await dialog.getByLabel("IBAN").fill("ie29 aibk 9311 5212 3456 79");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("IBAN");

  await dialog.getByLabel("IBAN").fill("ie29 aibk 9311 5212 3456 78");
  await dialog.getByLabel("BIC").fill("aibkie2d");
  await dialog.getByLabel("Default for its currency").check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole("row").filter({ hasText: "E2E-MAIN" });
  await expect(row).toContainText("IE29 AIBK 9311 5212 3456 78");
  await expect(row).toContainText("AIBKIE2D");
  await expect(row).toContainText("Default");

  // The same IBAN again, spaced differently, is a duplicate.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.getByLabel("Code").fill("E2E-COPY");
  await dialog.getByLabel("Name").fill("Same IBAN");
  await dialog.getByLabel("IBAN").fill("IE29AIBK93115212345678");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("already used");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  // The code is fixed once saved.
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(dialog.getByLabel("Code")).toHaveAttribute("readonly", "");
  // The code is locked, so the first field to type in is the name.
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  // A member sees the account but has no Add, Edit or Remove, and the database refuses a direct write.
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  try {
    await signIn(member, "member");
    await member.goto("/bank-accounts");
    await expect(member.getByRole("row").filter({ hasText: "E2E-MAIN" })).toBeVisible();
    await expect(member.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
    await expect(member.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(member.getByRole("button", { name: "Remove" })).toHaveCount(0);

    const api = await apiAs("member");
    const [account] = await api.select<{ id: string; organisation_id: string }>("bank_accounts", "select=id,organisation_id&code=eq.E2E-MAIN");
    expect(account?.id, "the account, as the member sees it").toBeTruthy();
    const changed = await api.update("bank_accounts", `id=eq.${account.id}`, { name: "Changed by a member" });
    expect(changed.rows).toHaveLength(0);
  } finally {
    await memberContext.close();
  }

  // The owner removes the account again, so the flow can run twice on one database.
  await page.reload();
  await page.getByRole("row").filter({ hasText: "E2E-MAIN" }).getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).last().click();
  await expect(page.getByRole("row").filter({ hasText: "E2E-MAIN" })).toHaveCount(0);
});
