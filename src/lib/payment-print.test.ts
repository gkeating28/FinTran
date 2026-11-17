import assert from "node:assert/strict";
import test from "node:test";
import { emptyOrganisation } from "@/lib/form-document";
import { buildPaymentPrint, printedDate, printTitle, type PaymentPrintSource } from "./payment-print";

function source(overrides: Partial<PaymentPrintSource> = {}): PaymentPrintSource {
  return {
    kind: "payment",
    direction: "Purchases",
    status: "posted",
    documentNumber: "PPY-00007",
    paymentDate: "2026-11-17",
    organisation: { ...emptyOrganisation(), name: "Qula Test One", address: "1 Dock Road\nDublin\nD01 AB12", vatNumber: "IE1234567T", logoUrl: null },
    partyName: "Irish Solutions Ltd",
    partyLines: ["2 Quay Street", "Cork"],
    currencyCode: "EUR",
    amount: 2460,
    meansLabel: "58 SEPA credit transfer",
    bankReference: "INV 5 and 6",
    bankAccount: "B01 AIB Current Account",
    notes: "",
    voidReason: "",
    allocations: [
      { documentNumber: "PIN-1", date: "2026-10-01", total: 1000, applied: 1000 },
      { documentNumber: "PIN-2", date: "2026-10-09", total: 800, applied: 800 },
      { documentNumber: "PIN-3", date: "2026-10-20", total: 1000, applied: 660 },
    ],
    ...overrides,
  };
}

test("money paid out is a remittance advice and money received is a receipt", () => {
  assert.equal(printTitle("payment"), "Remittance advice");
  assert.equal(printTitle("receipt"), "Receipt");
  assert.equal(buildPaymentPrint(source()).title, "Remittance advice");
  assert.equal(buildPaymentPrint(source({ kind: "receipt", direction: "Sales" })).title, "Receipt");
  // A customer refund is money out, so it is a remittance advice. A supplier refund is money in, so it is a receipt.
  assert.equal(buildPaymentPrint(source({ kind: "payment", direction: "Sales" })).title, "Remittance advice");
  assert.equal(buildPaymentPrint(source({ kind: "receipt", direction: "Purchases" })).title, "Receipt");
});

test("a payment allocated to three invoices lists all three with their totals and the amount applied", () => {
  const view = buildPaymentPrint(source());
  assert.equal(view.rows.length, 3);
  assert.deepEqual(view.rows[0].map((cell) => cell.text), ["PIN-1", "01-10-2026", "1,000.00", "1,000.00"]);
  assert.deepEqual(view.rows[2].map((cell) => cell.text), ["PIN-3", "20-10-2026", "1,000.00", "660.00"]);
  assert.deepEqual(view.headers.map((header) => header.label), ["Invoice", "Date", "Document total", "Amount applied"]);
  assert.deepEqual(view.rows[0].map((cell) => cell.align), ["left", "left", "right", "right"]);
});

test("the totals show the amount, what was applied, and what is left on account", () => {
  const view = buildPaymentPrint(source());
  assert.deepEqual(view.totals.map((line) => [line.label, line.value]), [
    ["Amount (EUR)", "2,460.00"],
    ["Applied to invoices", "2,460.00"],
  ]);
  const part = buildPaymentPrint(source({ amount: 3000 }));
  assert.deepEqual(part.totals.at(-1), { label: "On account", value: "540.00" });
});

test("a refund is applied to credit notes", () => {
  const view = buildPaymentPrint(source({ kind: "payment", direction: "Sales", allocations: [{ documentNumber: "SCN-1", date: "2026-11-01", total: 36.9, applied: 36.9 }], amount: 36.9 }));
  assert.equal(view.headers[0].label, "Credit note");
  assert.equal(view.totals[1].label, "Applied to credit notes");
});

test("a draft prints with DRAFT and no number, a void payment with VOID and its reason, and a posted one with neither", () => {
  const draft = buildPaymentPrint(source({ status: "draft", documentNumber: "" }));
  assert.equal(draft.watermark, "DRAFT");
  assert.equal(draft.details[0].value, "Draft");
  assert.equal(draft.downloadName, "Remittance advice draft");
  const voided = buildPaymentPrint(source({ status: "void", voidReason: "Paid the wrong supplier" }));
  assert.equal(voided.watermark, "VOID");
  assert.equal(voided.voidNote, "Voided: Paid the wrong supplier");
  // A void payment has nothing left on account, whatever it once held.
  assert.ok(!voided.totals.some((line) => line.label === "On account"));
  const posted = buildPaymentPrint(source());
  assert.equal(posted.watermark, null);
  assert.equal(posted.voidNote, "");
  assert.equal(posted.downloadName, "Remittance advice PPY-00007");
});

test("the organisation and the party are shown with their address and tax details", () => {
  const view = buildPaymentPrint(source());
  assert.equal(view.organisationName, "Qula Test One");
  assert.deepEqual(view.organisationLines, ["1 Dock Road", "Dublin", "D01 AB12", "VAT ID: IE1234567T"]);
  assert.equal(view.partyLabel, "Paid to");
  assert.equal(view.partyName, "Irish Solutions Ltd");
  assert.equal(buildPaymentPrint(source({ kind: "receipt", direction: "Sales" })).partyLabel, "Received from");
});

test("the details leave out anything that is empty and say which way the money moved", () => {
  const view = buildPaymentPrint(source({ bankReference: "", meansLabel: "" }));
  assert.deepEqual(view.details.map((line) => line.label), ["Number", "Date", "Paid from", "Currency"]);
  assert.equal(buildPaymentPrint(source({ kind: "receipt", direction: "Sales" })).details.some((line) => line.label === "Paid into"), true);
});

test("dates print as day, month and year", () => {
  assert.equal(printedDate("2026-11-17"), "17-11-2026");
  assert.equal(printedDate("2026-11-17T10:00:00Z"), "17-11-2026");
  assert.equal(printedDate("nonsense"), "");
});
