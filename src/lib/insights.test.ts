import assert from "node:assert/strict";
import test from "node:test";
import { buildInsights, findDuplicates, findDueSoon, findLargeInvoices, findOverdue, type InsightDoc } from "./insights";

const today = "2026-11-09";

function doc(overrides: Partial<InsightDoc>): InsightDoc {
  return { id: "d", number: "PI-1", status: "posted", direction: "Purchases", typeCode: "PI", party: "Acme", partyId: "s1", date: "2026-10-01", dueDate: null, amountDue: 0, total: 100, supplierReference: "", ...overrides };
}

test("the same party, amount and supplier reference is a duplicate, and a void one is not", () => {
  const groups = findDuplicates([
    doc({ id: "a", number: "PI-1", total: 250, supplierReference: "INV-9" }),
    doc({ id: "b", number: "PI-2", total: 250, supplierReference: "inv-9", date: "2026-10-20" }),
    doc({ id: "c", number: "PI-3", total: 250, supplierReference: "INV-9", status: "void" }),
    doc({ id: "d", number: "PI-4", total: 250, supplierReference: "OTHER" }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((item) => item.id), ["a", "b"]);
});

test("without a reference only the same date counts", () => {
  assert.equal(findDuplicates([doc({ id: "a", total: 80 }), doc({ id: "b", total: 80, date: "2026-10-02" })]).length, 0);
  assert.equal(findDuplicates([doc({ id: "a", total: 80 }), doc({ id: "b", total: 80 })]).length, 1);
});

test("a recent document far above the usual amount is flagged, and a small one is not", () => {
  const prior = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"].map((date, index) => doc({ id: `p${index}`, date, total: 500 }));
  const large = findLargeInvoices([...prior, doc({ id: "big", date: "2026-11-01", total: 4000 }), doc({ id: "ok", date: "2026-11-02", total: 900 })], today);
  assert.deepEqual(large.map((item) => item.doc.id), ["big"]);
  assert.equal(findLargeInvoices([doc({ id: "big", date: "2026-11-01", total: 4000 })], today).length, 0, "too little history to judge");
});

test("overdue and due soon use the due date and the amount still due", () => {
  const docs = [
    doc({ id: "late", dueDate: "2026-11-01", amountDue: 50 }),
    doc({ id: "paid", dueDate: "2026-11-01", amountDue: 0 }),
    doc({ id: "soon", dueDate: "2026-11-12", amountDue: 75 }),
    doc({ id: "later", dueDate: "2026-12-20", amountDue: 75 }),
    doc({ id: "draft", status: "draft", dueDate: "2026-11-01", amountDue: 75 }),
  ];
  assert.deepEqual(findOverdue(docs, today).map((item) => item.id), ["late"]);
  assert.deepEqual(findDueSoon(docs, today).map((item) => item.id), ["soon"]);
});

test("insights read in plain words and link to a document", () => {
  const insights = buildInsights(
    [doc({ id: "late", number: "PI-7", party: "Vodafone", dueDate: "2026-11-01", amountDue: 4920 })],
    [{ id: "dr", number: "SI-3", direction: "Sales", typeCode: "SI", errors: ["The buyer electronic address is missing."] }],
    today,
  );
  assert.deepEqual(insights.map((item) => item.id), ["overdue", "not-ready"]);
  assert.match(insights[0].detail, /€4,920\.00/);
  assert.match(insights[0].detail, /8 days late/);
  assert.match(buildInsights([doc({ id: "s", dueDate: "2026-11-12", amountDue: 10 })], [], today)[0].detail, /due 12 Nov 2026/);
  assert.equal(insights[0].href, "/transactions/PI?open=late");
  assert.deepEqual(buildInsights([], [], today), []);
});
