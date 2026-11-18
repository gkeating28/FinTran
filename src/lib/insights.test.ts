import assert from "node:assert/strict";
import test from "node:test";
import { buildApprovalInsights, buildInsights, findDuplicates, findDueSoon, findLargeInvoices, findLikelyMatches, findMoneyOnAccount, findOverdue, findPartPaidOverdue, findStaleDrafts, type InsightDoc, type InsightPayment } from "./insights";

const today = "2026-11-09";

function doc(overrides: Partial<InsightDoc>): InsightDoc {
  return { id: "d", number: "PI-1", status: "posted", direction: "Purchases", typeCode: "PI", party: "Acme", partyId: "s1", date: "2026-10-01", dueDate: null, amountDue: 0, paidAmount: 0, total: 100, supplierReference: "", kind: "invoice", currencyCode: "EUR", ...overrides };
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

test("open orders are reported as still to invoice or ready to close", () => {
  const order = { typeCode: "PO", direction: "Purchases" as const, party: "Acme", date: "2026-10-01", ordered: 100 };
  const insights = buildInsights([], [], today, [
    { ...order, id: "a", number: "PO-1", invoiced: 0, remaining: 100, state: "none" },
    { ...order, id: "b", number: "PO-2", invoiced: 40, remaining: 60, state: "part" },
    { ...order, id: "c", number: "PO-3", invoiced: 100, remaining: 0, state: "full" },
  ]);
  assert.deepEqual(insights.map((item) => item.id), ["orders-to-invoice", "orders-to-close"]);
  assert.match(insights[0].title, /2 active orders still to invoice/);
  assert.match(insights[0].detail, /€160\.00 nett is left/);
  assert.match(insights[0].detail, /1 order is part invoiced/);
  assert.equal(insights[0].href, "/transactions/PO?open=a");
  assert.match(insights[1].detail, /PO-3 for Acme has nothing left to invoice/);
});

test("a draft holding order quantity is flagged after 14 days, and a hand-closed order with quantity left is listed", () => {
  const day = (ago: number) => new Date(Date.parse("2026-11-12") - ago * 86_400_000).toISOString();
  const drafts = [
    { id: "old", number: "Draft", typeCode: "PI", party: "Acme", created: day(15), held: 4 },
    { id: "edge", number: "Draft", typeCode: "PI", party: "Acme", created: day(14), held: 1 },
    { id: "new", number: "Draft", typeCode: "PI", party: "Beta", created: day(13), held: 2 },
  ];
  assert.deepEqual(findStaleDrafts(drafts, "2026-11-12").map((draft) => draft.id), ["old"]);

  const insights = buildInsights([], [], "2026-11-12", [], {
    closedWithLeft: [{ id: "o1", number: "PO-0007", typeCode: "PO", party: "Acme", left: 3 }],
    holdingDrafts: drafts,
  });
  const closed = insights.find((item) => item.id === "closed-orders-with-quantity-left");
  assert.equal(closed?.title, "Closed orders with quantity left");
  assert.match(closed?.detail ?? "", /PO-0007 for Acme has 3 left/);
  assert.equal(closed?.href, "/transactions/PO?open=o1");
  const held = insights.find((item) => item.id === "drafts-holding-order-quantity");
  assert.equal(held?.title, "Drafts holding order quantity");
  assert.match(held?.detail ?? "", /1 draft invoice older than 14 days holds 4 of quantity/);
  assert.equal(held?.href, "/transactions/PI?open=old");

  // Nothing is said when only young drafts hold quantity and no hand-closed order has anything left.
  assert.deepEqual(buildInsights([], [], "2026-11-12", [], { closedWithLeft: [], holdingDrafts: drafts.slice(1) }), []);
});

function payment(overrides: Partial<InsightPayment>): InsightPayment {
  return { id: "p", number: "SRC-1", typeCode: "SRC", direction: "Sales", kind: "receipt", party: "Acme", partyId: "c1", date: "2026-10-01", currencyCode: "EUR", unallocated: 100, ...overrides };
}

test("money left on account for more than a week is flagged, for payments and for credit notes", () => {
  const items = findMoneyOnAccount(
    [
      doc({ id: "cn", number: "SCN-1", kind: "credit_note", direction: "Sales", amountDue: 36.9, date: "2026-10-20" }),
      doc({ id: "cn-used", kind: "credit_note", amountDue: 0, date: "2026-10-01" }),
      doc({ id: "cn-draft", kind: "credit_note", status: "draft", amountDue: 10, date: "2026-10-01" }),
      doc({ id: "inv", amountDue: 500, date: "2026-10-01" }),
    ],
    [
      payment({ id: "old", date: "2026-10-30", unallocated: 200 }),
      payment({ id: "eight", date: "2026-11-01", unallocated: 5 }),
      payment({ id: "seven", date: "2026-11-02", unallocated: 5 }),
      payment({ id: "none", date: "2026-10-01", unallocated: 0 }),
    ],
    today,
  );
  // Eight days is flagged and seven is not. The oldest comes first.
  assert.deepEqual(items.map((item) => item.id), ["cn", "old", "eight"]);
  assert.equal(items[0].credit, true);
});

test("an invoice that is past due with something applied is part paid and overdue, and an unpaid or settled one is not", () => {
  const found = findPartPaidOverdue(
    [
      doc({ id: "part", dueDate: "2026-11-01", amountDue: 60, paidAmount: 40 }),
      doc({ id: "unpaid", dueDate: "2026-11-01", amountDue: 100, paidAmount: 0 }),
      doc({ id: "settled", dueDate: "2026-11-01", amountDue: 0, paidAmount: 100 }),
      doc({ id: "not-due", dueDate: "2026-11-20", amountDue: 60, paidAmount: 40 }),
      doc({ id: "credit", kind: "credit_note", dueDate: "2026-11-01", amountDue: 60, paidAmount: 40 }),
    ],
    today,
  );
  assert.deepEqual(found.map((item) => item.id), ["part"]);
});

test("unapplied money equal to what is open on exactly one invoice of that party is a likely match", () => {
  const sales = (id: string, amountDue: number, overrides: Partial<InsightDoc> = {}) => doc({ id, direction: "Sales", partyId: "c1", amountDue, ...overrides });
  const one = findLikelyMatches([sales("a", 100), sales("b", 250)], [payment({ unallocated: 100 })]);
  assert.deepEqual(one.map((match) => [match.payment.id, match.invoice.id]), [["p", "a"]]);
  // Two invoices with the same open amount are not a match, nor is another customer's, another currency or a credit note.
  assert.equal(findLikelyMatches([sales("a", 100), sales("b", 100)], [payment({ unallocated: 100 })]).length, 0);
  assert.equal(findLikelyMatches([sales("a", 100, { partyId: "c2" })], [payment({ unallocated: 100 })]).length, 0);
  assert.equal(findLikelyMatches([sales("a", 100, { currencyCode: "GBP" })], [payment({ unallocated: 100 })]).length, 0);
  assert.equal(findLikelyMatches([sales("a", 100, { kind: "credit_note" })], [payment({ unallocated: 100 })]).length, 0);
  // Money paid to a supplier is matched to that supplier's purchase invoices. A refund is not matched to an invoice.
  const supplier = findLikelyMatches([doc({ id: "pi", direction: "Purchases", partyId: "s1", amountDue: 75 })], [payment({ id: "pay", kind: "payment", direction: "Purchases", partyId: "s1", unallocated: 75 })]);
  assert.equal(supplier.length, 1);
  assert.equal(findLikelyMatches([sales("a", 100)], [payment({ kind: "payment", direction: "Sales", unallocated: 100 })]).length, 0);
});

test("the three payment rules read in plain words and link to the document", () => {
  const insights = buildInsights(
    [
      doc({ id: "part", number: "SIN-9", direction: "Sales", partyId: "c1", party: "Acme", typeCode: "SIN", dueDate: "2026-11-01", amountDue: 60, paidAmount: 40 }),
      doc({ id: "open", number: "SIN-10", direction: "Sales", partyId: "c1", party: "Acme", typeCode: "SIN", amountDue: 150, total: 150 }),
    ],
    [],
    today,
    [],
    undefined,
    [payment({ id: "rec", number: "SRC-4", date: "2026-10-20", unallocated: 150 })],
  );
  assert.deepEqual(insights.map((item) => item.id), ["overdue", "part-paid-overdue", "money-on-account", "likely-matches"]);
  const byId = Object.fromEntries(insights.map((item) => [item.id, item]));
  assert.match(byId["part-paid-overdue"].detail, /EUR 40\.00 paid and EUR 60\.00 still due, 8 days late/);
  assert.match(byId["money-on-account"].detail, /SRC-4 for Acme has EUR 150\.00 not applied to any document since 20 Oct 2026/);
  assert.match(byId["likely-matches"].detail, /the same as what is open on SIN-10/);
  assert.equal(byId["money-on-account"].href, "/transactions/SRC?open=rec");
  assert.equal(byId["likely-matches"].tone, "info");
});

test("documents waiting for approval are listed with the oldest, and a refusal shows its reason", () => {
  const item = { id: "w1", state: "waiting" as const, typeCode: "PI", number: "7", party: "Acme", amount: 1500, requestedAt: "2026-11-02T10:00:00Z", note: "", decidedBy: "" };
  const insights = buildApprovalInsights([
    { ...item, id: "w2", number: "8", requestedAt: "2026-11-05T10:00:00Z" },
    item,
    { ...item, id: "r1", state: "refused" as const, number: "9", note: "Too dear", decidedBy: "Ann" },
  ]);
  assert.deepEqual(insights.map((entry) => entry.id), ["approvals-waiting", "approvals-refused"]);
  assert.match(insights[0].title, /^2 documents waiting for your approval/);
  assert.match(insights[0].detail, /PI 7 for Acme/);
  assert.equal(insights[0].href, "/transactions/PI?open=w1");
  assert.match(insights[1].detail, /refused by Ann: Too dear/);
  assert.deepEqual(buildApprovalInsights([]), []);
});
