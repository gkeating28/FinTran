import assert from "node:assert/strict";
import test from "node:test";
import { allocationTotals, distributeOldestFirst, parseAllocationAmount, parsePaymentPrefill, paymentNoun, recordPaymentHref, settlementState, targetKindFor } from "./payments";

test("a receipt or a payment clears invoices and a refund clears credit notes", () => {
  assert.equal(targetKindFor("receipt", "Sales"), "invoice");
  assert.equal(targetKindFor("payment", "Purchases"), "invoice");
  assert.equal(targetKindFor("payment", "Sales"), "credit_note");
  assert.equal(targetKindFor("receipt", "Purchases"), "credit_note");
  assert.equal(paymentNoun("receipt", "Sales"), "receipt");
  assert.equal(paymentNoun("payment", "Sales"), "customer refund");
  assert.equal(paymentNoun("receipt", "Purchases"), "supplier refund");
});

test("oldest first fills the earliest due date, then the earliest date", () => {
  const items = [
    { id: "c", dueDate: "", date: "2026-11-01", open: "50.00" },
    { id: "b", dueDate: "2026-12-20", date: "2026-11-01", open: "600.00" },
    { id: "a", dueDate: "2026-11-20", date: "2026-11-02", open: "700.00" },
  ];
  assert.deepEqual(distributeOldestFirst(items, 1000), { a: "700.00", b: "300.00" });
  assert.deepEqual(distributeOldestFirst(items, 100), { a: "100.00" });
  assert.deepEqual(distributeOldestFirst(items, 5000), { a: "700.00", b: "600.00", c: "50.00" });
});

test("oldest first breaks a tie on due date by date, then id, and skips what is settled", () => {
  const items = [
    { id: "z", dueDate: "2026-11-20", date: "2026-11-01", open: "10.00" },
    { id: "y", dueDate: "2026-11-20", date: "2026-11-01", open: "10.00" },
    { id: "x", dueDate: "2026-11-20", date: "2026-10-01", open: "0.00" },
  ];
  assert.deepEqual(distributeOldestFirst(items, 15), { y: "10.00", z: "5.00" });
});

test("cents add up exactly", () => {
  const items = [
    { id: "a", dueDate: "2026-11-01", date: "2026-11-01", open: "0.10" },
    { id: "b", dueDate: "2026-11-02", date: "2026-11-01", open: "0.20" },
  ];
  assert.deepEqual(distributeOldestFirst(items, 0.3), { a: "0.10", b: "0.20" });
});

test("totals say what is on account and when the allocations ask for too much", () => {
  assert.deepEqual(allocationTotals(1000, [600, 200]), { allocated: 800, unallocated: 200, over: false });
  assert.deepEqual(allocationTotals(100, [60, 50]), { allocated: 110, unallocated: -10, over: true });
  assert.deepEqual(allocationTotals(100, []), { allocated: 0, unallocated: 100, over: false });
});

test("an allocation amount is blank, a positive amount, or not valid", () => {
  assert.equal(parseAllocationAmount(""), null);
  assert.equal(parseAllocationAmount("0"), null);
  assert.equal(parseAllocationAmount("1,250.50"), 1250.5);
  assert.equal(parseAllocationAmount("12.345"), undefined);
  assert.equal(parseAllocationAmount("abc"), undefined);
  assert.equal(parseAllocationAmount("-5"), undefined);
});

test("parsePaymentPrefill reads the party and sums the allocations", () => {
  assert.deepEqual(parsePaymentPrefill({ party: "p1", allocate: "a:10.50,b:4.5" }), {
    partyId: "p1",
    amount: "15.00",
    allocations: { a: "10.50", b: "4.50" },
  });
});

test("parsePaymentPrefill ignores bad amounts and needs a party", () => {
  assert.equal(parsePaymentPrefill({ allocate: "a:10" }), null);
  assert.deepEqual(parsePaymentPrefill({ party: "p1", allocate: "a:x,b:0,:5,c:1.234" }), { partyId: "p1", amount: "", allocations: {} });
  assert.deepEqual(parsePaymentPrefill({ party: "p1" }), { partyId: "p1", amount: "", allocations: {} });
});

test("recordPaymentHref round-trips through parsePaymentPrefill", () => {
  const href = recordPaymentHref("SR", "doc-1", "party-1", "120.50");
  const query = new URL(href, "http://x").searchParams;
  assert.equal(new URL(href, "http://x").pathname, "/transactions/SR");
  assert.equal(query.get("new"), "1");
  assert.deepEqual(parsePaymentPrefill({ party: query.get("party") ?? "", allocate: query.get("allocate") ?? "" }), {
    partyId: "party-1",
    amount: "120.50",
    allocations: { "doc-1": "120.50" },
  });
});

test("settlementState tells unpaid, part paid and paid apart", () => {
  assert.equal(settlementState("0.00", "120.00"), "unpaid");
  assert.equal(settlementState("20.00", "1,100.00"), "part");
  assert.equal(settlementState("120.00", "0.00"), "paid");
  assert.equal(settlementState(0, 0), "paid");
});
