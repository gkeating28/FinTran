import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openList, rowText, saveDocument, startDocument } from "./documents";
import { signIn } from "./sign-in";

// The first organisation uses the mock AI provider with actions switched on. The mock follows a fixed script: a
// question about drafts looks them up, and a question that asks to post proposes posting the first draft it finds.
// The lookup, the cards, the proposal and its single-use token are the real code.

async function ask(page: Page, question: string) {
  const drawer = page.getByRole("dialog", { name: /^Ask Qula/ });
  if (!(await drawer.isVisible())) await page.getByRole("button", { name: "Ask Qula", exact: true }).click();
  await expect(drawer).toBeVisible();
  // Each finished exchange adds the question and the answer to the log. The answer being written has aria-live="off".
  const exchanges = drawer.getByRole("log").locator("article:not([aria-live])");
  const before = await exchanges.count();
  await drawer.getByLabel("Question").fill(question);
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(exchanges).toHaveCount(before + 2, { timeout: 30_000 });
  return drawer;
}

test("flow 7: Ask Qula answers with a card, and a proposed post is confirmed once and refused the second time", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // A draft purchase invoice for Harbour Supplies: 1 at 40.00 plus VAT, 49.20.
  await openList(page, "PI");
  await startDocument(page, { party: "HARB", sales: false, supplierReference: "HARB-FLOW7", lines: [{ description: "Flow seven rope", quantity: "1", price: "40", gl: "6000", vat: "P23" }] });
  await saveDocument(page);
  expect(await rowText(page, "Harbour")).toContain("Draft");

  // A question about drafts is answered with a card for the draft.
  const drawer = await ask(page, "Which drafts do we have for Harbour?");
  const card = drawer.getByRole("log").getByRole("button").filter({ hasText: "Harbour Supplies" });
  await expect(card, `a card in the answer, which was: ${await drawer.getByRole("log").innerText()}`).toHaveCount(1);
  await expect(card).toContainText("draft");

  // Asked to post it, Ask Qula proposes, and nothing has happened yet.
  await ask(page, "Post the draft for Harbour");
  await expect(drawer.getByRole("button", { name: "Post it", exact: true })).toBeVisible();
  expect(await rowText(page, "Harbour")).toContain("Draft");

  // Confirmed once, it posts. The request is kept so the same confirmation can be sent again.
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/ask-qula/action") && request.method() === "POST");
  await drawer.getByRole("button", { name: "Post it", exact: true }).click();
  const body = (await sent).postDataJSON() as { token?: string };
  expect(body.token, "the confirmation token").toBeTruthy();
  const proposal = drawer.locator("section[data-state]").last();
  await expect(proposal).toHaveAttribute("data-state", "done", { timeout: 30_000 });

  await openList(page, "PI");
  expect(await rowText(page, "Harbour")).toContain("Posted");

  // The same confirmation a second time is refused, and nothing is done twice.
  const again = await page.request.post("/api/ask-qula/action", { data: body });
  expect(again.status()).toBe(409);
  expect(((await again.json()) as { error?: string }).error).toContain("already been used");
});
