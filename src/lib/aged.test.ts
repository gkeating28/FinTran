import assert from "node:assert/strict";
import test from "node:test";
import { agedBands, agedBasis, agedDate, bandOf, buildAged, daysLate, type AgedItem } from "./aged";

const asOf = "2026-11-19";

function item(overrides: Partial<AgedItem>): AgedItem {
  return { id: "i", kind: "invoice", typeCode: "SIN", number: "1", partyId: "c1", party: "Acme", date: "2026-10-01", dueDate: "2026-11-01", amount: 100, ...overrides };
}

test("bands start the day after the due date", () => {
  assert.equal(bandOf(-5), "current");
  assert.equal(bandOf(0), "current");
  assert.equal(bandOf(1), "d30");
  assert.equal(bandOf(30), "d30");
  assert.equal(bandOf(31), "d60");
  assert.equal(bandOf(60), "d60");
  assert.equal(bandOf(61), "d90");
  assert.equal(bandOf(90), "d90");
  assert.equal(bandOf(91), "over");
  assert.equal(daysLate("2026-11-19", asOf), 0);
  assert.equal(daysLate("2026-11-18", asOf), 1);
  assert.equal(daysLate(null, asOf), 0);
});

test("a party's balance is split into bands, with credit notes and money on account taken off", () => {
  const report = buildAged(
    [
      item({ id: "a", amount: 500, dueDate: "2026-12-01" }),
      item({ id: "b", amount: 200, dueDate: "2026-11-09" }),
      item({ id: "c", amount: 300, dueDate: "2026-09-01" }),
      item({ id: "d", kind: "credit_note", typeCode: "SCN", amount: -50, dueDate: "2026-11-09" }),
      item({ id: "e", kind: "on_account", typeCode: "SRC", number: "R1", amount: -120, dueDate: null }),
    ],
    asOf,
  );
  assert.equal(report.parties.length, 1);
  const [party] = report.parties;
  assert.deepEqual([party.current, party.d30, party.d60, party.d90, party.over, party.onAccount, party.total], [500, 150, 0, 300, 0, -120, 830]);
  assert.equal(party.lines.length, 5);
  assert.equal(party.lines.find((line) => line.id === "e")?.band, "on_account");
  assert.deepEqual(report.totals, { current: 500, d30: 150, d60: 0, d90: 300, over: 0, onAccount: -120, total: 830 });
});

test("parties are listed largest first, and the ageing date moves amounts between bands", () => {
  const items = [item({ id: "a", partyId: "c1", party: "Acme", amount: 100 }), item({ id: "b", partyId: "c2", party: "Beta", amount: 900 })];
  assert.deepEqual(buildAged(items, asOf).parties.map((party) => party.party), ["Beta", "Acme"]);
  assert.equal(buildAged(items, asOf).parties[0].d30, 900);
  assert.equal(buildAged(items, "2026-10-15").parties[0].current, 900);
  assert.equal(buildAged(items, "2027-03-01").parties[0].over, 900);
});

test("nothing owed gives an empty report, and cents do not drift", () => {
  assert.deepEqual(buildAged([], asOf).parties, []);
  assert.equal(buildAged([item({ amount: 0 })], asOf).parties.length, 0);
  const sum = buildAged([item({ id: "a", amount: 0.1 }), item({ id: "b", amount: 0.2 })], asOf).parties[0].total;
  assert.equal(sum, 0.3);
});

test("the ageing date is a real date or today", () => {
  assert.equal(agedDate("2026-10-31", "2026-11-19"), "2026-10-31");
  assert.equal(agedDate("not a date", "2026-11-19"), "2026-11-19");
  assert.equal(agedDate("2026-13-45", "2026-11-19"), "2026-11-19");
  assert.equal(agedDate(undefined, "2026-11-19"), "2026-11-19");
});

test("by transaction date the bands are the age of the document, 0 to 30 first and 120 last", () => {
  assert.equal(bandOf(0, "document"), "current");
  assert.equal(bandOf(30, "document"), "current");
  assert.equal(bandOf(31, "document"), "d30");
  assert.equal(bandOf(60, "document"), "d30");
  assert.equal(bandOf(61, "document"), "d60");
  assert.equal(bandOf(90, "document"), "d60");
  assert.equal(bandOf(91, "document"), "d90");
  assert.equal(bandOf(120, "document"), "d90");
  assert.equal(bandOf(121, "document"), "over");
  assert.deepEqual(agedBands("document").map((band) => band.label), ["0 to 30 days", "31 to 60 days", "61 to 90 days", "91 to 120 days", "Over 120 days"]);
  assert.deepEqual(agedBands("due").map((band) => band.label), ["Not yet due", "1 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days"]);
  assert.equal(agedBasis("document"), "document");
  assert.equal(agedBasis("whatever"), "due");
  assert.equal(agedBasis(undefined), "due");
});

test("the same items fall in different bands depending on what the age counts from", () => {
  // Dated 2026-09-10 and due 2026-11-10 (9 days late, 70 days old) on 2026-11-19.
  const items = [item({ id: "a", amount: 100, date: "2026-09-10", dueDate: "2026-11-10" })];
  const byDue = buildAged(items, asOf, "due");
  assert.equal(byDue.basis, "due");
  assert.equal(byDue.parties[0].d30, 100);
  assert.equal(byDue.parties[0].lines[0].days, 9);
  const byDate = buildAged(items, asOf, "document");
  assert.equal(byDate.basis, "document");
  assert.equal(byDate.parties[0].d60, 100);
  assert.equal(byDate.parties[0].lines[0].days, 70);
  assert.equal(byDate.parties[0].total, byDue.parties[0].total);
  // A document with no due date still ages from its transaction date.
  assert.equal(buildAged([item({ id: "b", amount: 50, date: "2026-11-01", dueDate: null })], asOf, "document").parties[0].current, 50);
  // Money on account is not aged either way.
  assert.equal(buildAged([item({ id: "c", kind: "on_account", amount: -30, dueDate: null })], asOf, "document").parties[0].onAccount, -30);
});
