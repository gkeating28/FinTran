import assert from "node:assert/strict";
import test from "node:test";
import {
  agingBand,
  agingSummary,
  docHref,
  documentSummary,
  parseDocumentQuery,
  parseTransactionQuery,
  routeQuestion,
  transactionSummary,
} from "./ask-qula";

test("routes questions to a lookup, not a model", () => {
  assert.equal(routeQuestion("What is overdue?"), "aging");
  assert.equal(routeQuestion("Show the aging for suppliers"), "aging");
  assert.equal(routeQuestion("Received e-documents"), "documents");
  assert.equal(routeQuestion("Any Peppol files?"), "documents");
  assert.equal(routeQuestion("Recent transactions"), "transactions");
  assert.equal(routeQuestion("Draft transactions"), "transactions");
  assert.equal(routeQuestion("invoice PI-1042"), "transactions");
  assert.equal(routeQuestion("Hello"), "help");
});

test("reads transaction filters from the question", () => {
  assert.deepEqual(parseTransactionQuery("Draft purchase invoices from Harbour Trading"), {
    status: "draft",
    kind: "invoice",
    direction: "Purchases",
    number: undefined,
    party: "Harbour Trading",
    limit: 8,
  });
  assert.equal(parseTransactionQuery("last 3 sales credit notes").limit, 3);
  assert.equal(parseTransactionQuery("last 3 sales credit notes").kind, "credit_note");
  assert.equal(parseTransactionQuery("invoice PI-12").number, "PI-12");
  assert.equal(parseTransactionQuery("Show the aging for suppliers").party, undefined);
  assert.equal(parseTransactionQuery("Show the aging for suppliers").direction, "Purchases");
});

test("reads e-document filters from the question", () => {
  assert.deepEqual(parseDocumentQuery("Received e-documents"), {
    direction: "inbound",
    status: "received",
    number: undefined,
    party: undefined,
    limit: 8,
  });
  assert.equal(parseDocumentQuery("invalid sent e-invoices").status, "invalid");
  assert.equal(parseDocumentQuery("invalid sent e-invoices").direction, "outbound");
});

test("ages posted invoices from the due date", () => {
  const today = "2026-11-02";
  assert.equal(agingBand("2026-11-02", today), "current");
  assert.equal(agingBand("2026-10-20", today), "1-30");
  assert.equal(agingBand("2026-10-02", today), "31-60");
  assert.equal(agingBand("2026-09-02", today), "61-90");
  assert.equal(agingBand("2026-01-01", today), "over-90");
  assert.equal(agingBand(null, today), "undated");
  assert.equal(
    agingSummary(
      [
        { dueDate: "2026-11-20", amountDue: 10, currency: "EUR" },
        { dueDate: "2026-10-20", amountDue: 1200, currency: "EUR" },
        { dueDate: "2026-01-01", amountDue: 50, currency: "USD" },
      ],
      today,
    ),
    "3 posted invoices still have an amount due. 2 are overdue (1,200.00 EUR and 50.00 USD): 1 in 1–30 days, 1 over 90 days.",
  );
  assert.equal(agingSummary([], today), "No posted invoice still has an amount due.");
});

test("summarises a lookup and builds the viewer link", () => {
  assert.equal(transactionSummary(0, { limit: 8 }), "No transactions match that.");
  assert.equal(transactionSummary(2, { limit: 8 }), "Latest 2 transactions.");
  assert.equal(documentSummary(1, { direction: "inbound", limit: 8 }), "1 received e-document.");
  assert.equal(
    docHref({
      ref: "PI-1",
      title: "Harbour",
      store: "transactions",
      status: "Posted",
      statusColor: "#217a56",
      recordId: "8d0b6b2e-1c3a-4f21-9a55-1b2c3d4e5f60",
      instanceId: "PI",
    }),
    "/transactions/PI?open=8d0b6b2e-1c3a-4f21-9a55-1b2c3d4e5f60",
  );
  assert.equal(
    docHref({
      ref: "INV-9",
      title: "Seller",
      store: "e-documents",
      status: "Received",
      statusColor: "#2c4c78",
      recordId: "8d0b6b2e-1c3a-4f21-9a55-1b2c3d4e5f60",
    }),
    "/e-documents/8d0b6b2e-1c3a-4f21-9a55-1b2c3d4e5f60",
  );
});
