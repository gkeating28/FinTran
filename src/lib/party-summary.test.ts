import assert from "node:assert/strict";
import test from "node:test";
import { partyChecks, partyReadiness } from "./party-readiness";
import { buildPartySummary, type PartyDocument } from "./party-summary";

const today = "2026-11-11";

function doc(overrides: Partial<PartyDocument>): PartyDocument {
  return { id: "d", typeCode: "PI", kind: "invoice", number: "1", status: "posted", date: "2026-10-01", dueDate: null, total: 100, amountDue: 0, ...overrides };
}

test("due is posted invoices less credit notes, and overdue needs a past due date", () => {
  const summary = buildPartySummary(
    [
      doc({ id: "a", total: 500, amountDue: 500, dueDate: "2026-10-31" }),
      doc({ id: "b", total: 300, amountDue: 300, dueDate: "2026-12-01" }),
      doc({ id: "c", kind: "credit_note", total: 100, amountDue: 100 }),
      doc({ id: "d", status: "draft", total: 900, amountDue: 900, dueDate: "2026-01-01" }),
      doc({ id: "e", status: "void", total: 900, amountDue: 900 }),
    ],
    today,
  );
  assert.equal(summary.due, 700);
  assert.equal(summary.overdue, 500);
  assert.equal(summary.overdueCount, 1);
});

test("the year total counts this year's posted invoices less credit notes", () => {
  const summary = buildPartySummary(
    [doc({ total: 400 }), doc({ kind: "credit_note", total: 50 }), doc({ date: "2025-12-31", total: 999 }), doc({ status: "draft", total: 999 })],
    today,
  );
  assert.equal(summary.yearTotal, 350);
  assert.equal(summary.year, 2026);
});

test("orders are counted when active and never count as money due", () => {
  const summary = buildPartySummary(
    [doc({ kind: "order", status: "open", typeCode: "PO", total: 800, amountDue: 800 }), doc({ kind: "order", status: "closed", typeCode: "PO" })],
    today,
    320,
  );
  assert.equal(summary.activeOrders, 1);
  assert.equal(summary.toInvoice, 320);
  assert.equal(summary.due, 0);
  assert.equal(summary.yearTotal, 0);
});

test("a customer missing a Peppol ID is not ready, and a supplier only gets a warning", () => {
  const input = { name: "Acme", addressLine1: "1 Main St", city: "Dublin", countryCode: "IE", vatNumber: "IE1", peppolScheme: "", peppolId: "" };
  assert.equal(partyReadiness(partyChecks("customers", input)), "error");
  assert.equal(partyReadiness(partyChecks("suppliers", input)), "warning");
  assert.equal(partyReadiness(partyChecks("customers", { ...input, peppolScheme: "9935", peppolId: "IE1" })), "ready");
  assert.equal(partyReadiness(partyChecks("customers", { ...input, peppolScheme: "9935", peppolId: "IE1", vatNumber: "" })), "warning");
});
