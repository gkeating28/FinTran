import assert from "node:assert/strict";
import test from "node:test";
import { agingBands, creditNotesOffWhatIsOwed } from "./tools";

test("ageing counts what is still due after payments, and a credit note's balance comes off what the party owes", () => {
  const documents = creditNotesOffWhatIsOwed([
    { party_name: "Acme", due_date: "2026-10-01", amount_due: "60.00", transaction_types: { type: "Sales", document_kind: "invoice" } },
    { party_name: "Acme", due_date: "2026-10-05", amount_due: "36.90", transaction_types: { type: "Sales", document_kind: "credit_note" } },
    { party_name: "Beta", due_date: "2026-12-01", amount_due: "10.00", transaction_types: [{ type: "Sales", document_kind: "invoice" }] },
  ]);
  const bands = agingBands(documents, "2026-11-09", 10);
  const acme = bands.find((band) => band.party === "Acme");
  // 39 days late on the invoice, 35 on the credit note: both in the 31 to 60 band, so it nets to 23.10.
  assert.equal(acme?.days31to60, "23.10");
  assert.equal(bands.find((band) => band.party === "Beta")?.current, "10.00");
});
