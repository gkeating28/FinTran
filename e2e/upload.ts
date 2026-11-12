import { expect, type Page } from "@playwright/test";

/**
 * Uploads a UBL file on the received e-documents page and returns the id of the e-document it opens. When the upload is
 * refused, the test fails with what the server said, not with a timeout.
 */
export async function uploadEInvoice(page: Page, file: string) {
  await page.goto("/e-documents?direction=inbound");
  await page.locator('input[type="file"][name="file"]').setInputFiles(file);
  const answered = page.waitForResponse((response) => response.url().endsWith("/api/einvoice/inbound") && response.request().method() === "POST", { timeout: 90_000 });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const response = await answered;
  const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
  expect(response.ok() && body.id, `the upload was refused (${response.status()}): ${body.error ?? "no message"}`).toBeTruthy();
  await page.waitForURL(`**/e-documents/${body.id}`, { timeout: 30_000 });
  return body.id ?? "";
}
